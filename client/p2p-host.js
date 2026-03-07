/**
 * ============================================================
 * LOCUS MULTIPLAYER — P2P Host Engine (WebRTC via PeerJS)
 * ============================================================
 * Laat één client fungeren als game-server via WebRTC.
 * Andere spelers verbinden direct via een room-code.
 *
 * Architectuur:
 *   Host client ─── PeerJS ──→ Guest A
 *                          ──→ Guest B
 *                          ──→ Guest C
 *
 * De host draait de volledige game-rules engine.
 * Gasten sturen commands, host stuurt state terug.
 *
 * Gebruikt PeerJS (https://peerjs.com) als signaling server.
 * Gratis, geen eigen server nodig.
 * ============================================================
 */

class LocusP2PHost {
	constructor() {
		this.peer = null;
		this.connections = new Map(); // peerId → DataConnection
		this.playerMap = new Map(); // peerId → playerId
		this.gameState = null;
		this.roomCode = null;
		this.hostPlayerId = null;
		this.Rules = window.LocusGameRules;
		this._turnTimer = null;
		this._turnTimerStart = 0;
		this._turnTimerDuration = 40000;
		this.aiPlayerIds = new Set();
		this._aiTimer = null;

		// Callbacks voor de host-UI
		this.onStateChanged = null; // (sanitizedState) => {}
		this.onPlayerJoined = null;
		this.onPlayerLeft = null;
		this.onError = null;
	}

	/**
	 * Start als host. Maakt een PeerJS peer aan en wacht op verbindingen.
	 * @returns {Promise<{roomCode: string, hostPlayerId: string}>}
	 */
	async startHost(playerName, options = {}) {
		if (!this.Rules) throw new Error('LocusGameRules niet geladen');
		const resumeState = options.resumeState && typeof options.resumeState === 'object'
			? JSON.parse(JSON.stringify(options.resumeState))
			: null;
		const preferredRoomCode = String(options.roomCode || '').trim().toUpperCase();

		// Genereer room code
		this.roomCode = /^[A-Z0-9]{6}$/.test(preferredRoomCode)
			? preferredRoomCode
			: this._generateRoomCode();
		const peerId = `locus-${this.roomCode}`;

		return new Promise((resolve, reject) => {
			// PeerJS met gratis cloud signaling + meerdere STUN/TURN servers voor mobiel
			this.peer = new Peer(peerId, {
				debug: 2,
				config: {
					iceServers: [
						{ urls: 'stun:stun.l.google.com:19302' },
						{ urls: 'stun:stun1.l.google.com:19302' },
						{ urls: 'stun:stun2.l.google.com:19302' },
						{ urls: 'stun:stun3.l.google.com:19302' },
						{ urls: 'stun:stun4.l.google.com:19302' },
						{
							urls: 'turn:openrelay.metered.ca:80',
							username: 'openrelayproject',
							credential: 'openrelayproject'
						},
						{
							urls: 'turn:openrelay.metered.ca:443',
							username: 'openrelayproject',
							credential: 'openrelayproject'
						},
						{
							urls: 'turn:openrelay.metered.ca:443?transport=tcp',
							username: 'openrelayproject',
							credential: 'openrelayproject'
						}
					]
				}
			});

			this.peer.on('open', (id) => {
				console.log('[P2P Host] Peer geopend:', id);
				const requestedHostPlayerId = typeof options.hostPlayerId === 'string' ? options.hostPlayerId : null;

				if (resumeState && resumeState.players && Array.isArray(resumeState.playerOrder)) {
					this.gameState = resumeState;
					this.gameState.id = this.gameState.id || ('p2p-' + this.roomCode);
					this.gameState.inviteCode = this.roomCode;
					this.hostPlayerId = requestedHostPlayerId || this.gameState.hostPlayerId || this.hostPlayerId;
					if (this.hostPlayerId && this.gameState.players?.[this.hostPlayerId]) {
						this.gameState.players[this.hostPlayerId].connected = true;
						if (playerName) this.gameState.players[this.hostPlayerId].name = playerName;
					} else {
						this.hostPlayerId = this.hostPlayerId || ('P_host_' + Date.now().toString(36));
						this.gameState.hostPlayerId = this.hostPlayerId;
						this.Rules.addPlayer(this.gameState, this.hostPlayerId, playerName);
					}
				} else {
					// Maak game state aan
					this.hostPlayerId = requestedHostPlayerId || ('P_host_' + Date.now().toString(36));
					const seed = Date.now() + Math.floor(Math.random() * 100000);

					this.gameState = this.Rules.createGameState(
						'p2p-' + this.roomCode,
						this.hostPlayerId,
						{
							seed,
							maxPlayers: options.maxPlayers || 4,
							mapSize: options.mapSize || 4,
							cardsPerPlayer: options.cardsPerPlayer || 8,
							handSize: 3
						}
					);

					// Voeg host toe als speler
					this.Rules.addPlayer(this.gameState, this.hostPlayerId, playerName);
					this.gameState.inviteCode = this.roomCode;
				}

				// Herstel timer-consistentie na host (auto-)reconnect.
				// De oude setTimeout bestaat niet meer na refresh; zonder herstart blijft de beurt hangen op 0s.
				if (this.gameState?.phase === 'playing') {
					this._clearTimer();
					if (!this.gameState.paused) {
						this.gameState._turnTimerRemainingMs = Math.max(1, Number(this._turnTimerDuration) || 40000);
						this._startTimerForCurrentPlayer(true);
					} else {
						const rem = Math.max(0, Number(this.gameState._turnTimerRemainingMs) || 0);
						this.gameState._turnTimerRemainingMs = rem;
						this.gameState._turnTimerStart = 0;
					}
				}

				resolve({ roomCode: this.roomCode, hostPlayerId: this.hostPlayerId });
			});

			this.peer.on('connection', (conn) => this._handleConnection(conn));

			this.peer.on('error', (err) => {
				console.error('[P2P Host] Peer error:', err);
				LocusP2PHost._logMobile('[P2P Host] Error: ' + (err.type || '') + ' — ' + (err.message || err));
				if (this.onError) this.onError(err.message || 'P2P verbinding mislukt');
				reject(err);
			});

			this.peer.on('disconnected', () => {
				LocusP2PHost._logMobile('[P2P Host] Peer disconnected — probeer opnieuw te verbinden...');
				try { this.peer.reconnect(); } catch (e) { LocusP2PHost._logMobile('[P2P Host] Reconnect mislukt: ' + e.message); }
			});
		});
	}

	_handleConnection(conn) {
		console.log('[P2P Host] Nieuwe verbinding van:', conn.peer);

		conn.on('open', () => {
			this.connections.set(conn.peer, conn);
			console.log('[P2P Host] Verbinding geopend met:', conn.peer);
		});

		conn.on('data', (data) => {
			try {
				this._handleMessage(conn, data);
			} catch (err) {
				console.error('[P2P Host] Message handling error:', err, '| msg type:', data?.type);
				try { conn.send({ type: 'error', error: err.message }); } catch (e) { /* ignore */ }
			}
		});

		conn.on('close', () => {
			console.log('[P2P Host] Verbinding gesloten:', conn.peer);
			const playerId = this.playerMap.get(conn.peer);
			if (playerId && this.gameState?.players[playerId]) {
				this.gameState.players[playerId].connected = false;
				const currentPid = this.gameState.playerOrder?.[this.gameState.currentTurnIndex];
				if (this.gameState.phase === 'playing' && currentPid === playerId) {
					this._clearTimer();
					const autoResult = this.Rules.passMove(this.gameState, playerId, null);
					if (autoResult?.gameEnded) {
						this._broadcastEvent('levelComplete', {
							levelScores: this.gameState.levelScores,
							levelWinner: this.gameState.levelWinner,
							level: this.gameState.level
						});
					} else {
						this._startTimerForCurrentPlayer(true);
					}
				}
				if (this.onPlayerLeft) this.onPlayerLeft(playerId);
				this._broadcastState();
			}
			this.connections.delete(conn.peer);
			this.playerMap.delete(conn.peer);
		});
	}

	_handleMessage(conn, msg) {
		if (!msg || !msg.type) return;

		const playerId = this.playerMap.get(conn.peer);

		switch (msg.type) {
			case 'addAIPlayer': {
				if (playerId !== this.hostPlayerId && playerId) {
					conn.send({ type: 'result', action: 'addAIPlayer', success: false, error: 'Alleen de host kan AI toevoegen.' });
					return;
				}
				const result = this._addAIPlayer();
				conn.send({ type: 'result', action: 'addAIPlayer', ...result });
				this._broadcastState();
				break;
			}

			case 'joinGame': {
				const name = String(msg.playerName || 'Speler').slice(0, 20);
				const reconnectPlayerId = msg.reconnectPlayerId ? String(msg.reconnectPlayerId) : null;

					const players = this.gameState?.players || {};
					let reconnectTargetId = null;

					// 1) Primaire route: expliciete reconnect op bekende playerId
					if (reconnectPlayerId && players[reconnectPlayerId]) {
						reconnectTargetId = reconnectPlayerId;
					}

					// 2) Fallback: zelfde naam + offline speler
					if (!reconnectTargetId && name) {
						const offlineByName = Object.values(players).find(p =>
							p &&
							p.connected === false &&
							String(p.name || '').trim().toLowerCase() === String(name).trim().toLowerCase()
						);
						if (offlineByName?.id) reconnectTargetId = offlineByName.id;
					}

					// 3) Race-condition fallback: tijdens lopend spel kan oude connectie nog kort als connected staan
					if (!reconnectTargetId && name && this.gameState?.phase !== 'waiting') {
						const byNameInRunningGame = Object.values(players).find(p =>
							p && String(p.name || '').trim().toLowerCase() === String(name).trim().toLowerCase()
						);
						if (byNameInRunningGame?.id) reconnectTargetId = byNameInRunningGame.id;
					}

					if (reconnectTargetId) {
						const reconnectPlayer = players[reconnectTargetId];

						// Verwijder stale peer mappings voor dezelfde speler
						for (const [peerId, mappedPid] of this.playerMap.entries()) {
							if (mappedPid === reconnectTargetId && peerId !== conn.peer) {
								this.playerMap.delete(peerId);
								const staleConn = this.connections.get(peerId);
								if (staleConn) {
									try { staleConn.close(); } catch (_) {}
								}
							}
						}

						reconnectPlayer.connected = true;
						if (name) reconnectPlayer.name = name;
						this.playerMap.set(conn.peer, reconnectTargetId);
						conn.send({ type: 'joinResult', success: true, playerId: reconnectTargetId, roomCode: this.roomCode, reconnected: true });
						this._broadcastState();
						break;
					}

				const pid = 'P_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
				const result = this.Rules.addPlayer(this.gameState, pid, name);
				if (result.error) {
					conn.send({ type: 'joinResult', success: false, error: result.error });
					return;
				}
				this.playerMap.set(conn.peer, pid);
				conn.send({ type: 'joinResult', success: true, playerId: pid, roomCode: this.roomCode });
				if (this.onPlayerJoined) this.onPlayerJoined({ playerId: pid, name });
				this._broadcastState();
				break;
			}

			case 'startGame': {
				if (playerId !== this.hostPlayerId && playerId) {
					conn.send({ type: 'result', action: 'startGame', success: false, error: 'Alleen de host kan starten.' });
					return;
				}
				const result = this.Rules.startGame(this.gameState);
				conn.send({ type: 'result', action: 'startGame', ...result });
				this._broadcastState();
				break;
			}

			case 'chooseStartingDeck': {
				if (!playerId) return;
				const result = this.Rules.chooseStartingDeck(this.gameState, playerId, msg.deckType);
				conn.send({ type: 'result', action: 'chooseStartingDeck', ...result });
				this._broadcastState();
				break;
			}

			case 'chooseGoal': {
				if (!playerId) return;
				const result = this.Rules.chooseObjective(this.gameState, playerId, msg.objectiveIndex);
				conn.send({ type: 'result', action: 'chooseGoal', ...result });
				if (result.allChosen) this._startTimerForCurrentPlayer(true);
				this._broadcastState();
				break;
			}

			case 'playMove': {
				if (!playerId) return;
				const movePlayerName = this.gameState?.players?.[playerId]?.name || 'Speler';
				const transformedMatrix = this._getTransformedMoveMatrix(
					playerId,
					msg.cardId,
					msg.zoneName,
					msg.rotation || 0,
					!!msg.mirrored
				);
				const result = this.Rules.playMove(
					this.gameState, playerId, msg.cardId, msg.zoneName,
					msg.baseX, msg.baseY, msg.rotation || 0, !!msg.mirrored, msg.subgridId || null
				);
				conn.send({ type: 'result', action: 'playMove', ...result });
				if (result.success) {
					this._grantExtraTurnTime(playerId, 5000);
					this._broadcastEvent('movePlayed', {
						playerId,
						playerName: movePlayerName,
						zoneName: msg.zoneName,
						baseX: msg.baseX,
						baseY: msg.baseY,
						rotation: msg.rotation || 0,
						mirrored: !!msg.mirrored,
						subgridId: msg.subgridId || null,
						matrix: transformedMatrix,
						objectivesRevealed: this._shouldRevealObjectives(),
						mineTriggered: result.mineTriggered || null
					});
				}
				this._broadcastState();
				break;
			}

			case 'playBonus': {
				if (!playerId) return;
				const result = this.Rules.playBonus(
					this.gameState, playerId, msg.bonusColor, msg.zoneName,
					msg.baseX, msg.baseY, msg.subgridId || null, msg.rotation || 0
				);
				conn.send({ type: 'result', action: 'playBonus', ...result });
				if (result.success) {
					this._grantExtraTurnTime(playerId, 5000);
				}
				this._broadcastState();
				break;
			}

			case 'passMove': {
				if (!playerId) return;
				this._clearTimer();
				const result = this.Rules.passMove(this.gameState, playerId, msg.cardId || null);
				conn.send({ type: 'result', action: 'passMove', ...result });
				this._broadcastState();
				if (result.gameEnded) {
					this._broadcastEvent('levelComplete', {
						levelScores: this.gameState.levelScores,
						levelWinner: this.gameState.levelWinner,
						level: this.gameState.level
					});
				} else {
					this._startTimerForCurrentPlayer(true);
				}
				break;
			}

			case 'endTurn': {
				if (!playerId) return;
				this._clearTimer();
				const result = this.Rules.endTurn(this.gameState, playerId, msg.cardId || null);
				conn.send({ type: 'result', action: 'endTurn', ...result });
				this._broadcastState();
				if (result.gameEnded) {
					this._broadcastEvent('levelComplete', {
						levelScores: this.gameState.levelScores,
						levelWinner: this.gameState.levelWinner,
						level: this.gameState.level
					});
				} else {
					this._startTimerForCurrentPlayer(true);
				}
				break;
			}

			case 'undoMove': {
				if (!playerId) return;
				const result = this.Rules.undoMove(this.gameState, playerId);
				conn.send({ type: 'result', action: 'undoMove', ...result });
				this._broadcastState();
				break;
			}

			case 'startShopPhase': {
				const result = this.Rules.startShopPhase(this.gameState);
				conn.send({ type: 'result', action: 'startShopPhase', ...result });
				this._broadcastState();
				break;
			}

			case 'buyShopItem': {
				if (!playerId) return;
				const result = this.Rules.buyShopItem(this.gameState, playerId, msg.itemId, msg.extra);
				conn.send({ type: 'result', action: 'buyShopItem', ...result });
				this._broadcastState();
				break;
			}

			case 'claimFreeCard': {
				if (!playerId) return;
				const result = this.Rules.claimFreeCard(this.gameState, playerId, msg.cardId);
				conn.send({ type: 'result', action: 'claimFreeCard', ...result });
				this._broadcastState();
				break;
			}

			case 'sellCard': {
				if (!playerId) return;
				const result = this.Rules.sellCard(this.gameState, playerId, msg.cardId);
				conn.send({ type: 'result', action: 'sellCard', ...result });
				this._broadcastState();
				break;
			}

			case 'choosePerk': {
				if (!playerId) return;
				const result = this.Rules.choosePerk(this.gameState, playerId, msg.perkId);
				conn.send({ type: 'result', action: 'choosePerk', ...result });
				this._broadcastState();
				break;
			}

			case 'shopReady': {
				if (!playerId) return;
				const result = this.Rules.shopReady(this.gameState, playerId);
				conn.send({ type: 'result', action: 'shopReady', ...result });
				if (result.allReady) {
					const levelResult = this.Rules.startNextLevel(this.gameState);
					this._broadcastEvent('nextLevelStarted', { level: this.gameState.level });
				}
				this._broadcastState();
				if (result.allReady && this.gameState.phase === 'playing') {
					this._startTimerForCurrentPlayer(true);
				}
				break;
			}

			case 'useTimeBomb': {
				if (!playerId) return;
				this._clearTimer();
				const result = this.Rules.useTimeBomb(this.gameState, playerId);
				conn.send({ type: 'result', action: 'useTimeBomb', ...result });
				if (result.success) {
					this._broadcastEvent('timeBombUsed', {
						bomberPlayerId: result.bomberPlayerId,
						bombedPlayerId: result.bombedPlayerId,
						bomberPlayerName: result.bomberPlayerName,
						bombedPlayerName: result.bombedPlayerName
					});
				}
				this._broadcastState();
				if (!result.gameEnded) this._startTimerForCurrentPlayer(true);
				break;
			}

			case 'useMine': {
				if (!playerId) return;
				const result = this.Rules.useMine(this.gameState, playerId, msg.zoneName, msg.cellX, msg.cellY);
				conn.send({ type: 'result', action: 'useMine', ...result });
				if (result.success) {
					this._broadcastState();
				}
				break;
			}

			case 'stealCard': {
				if (!playerId) return;
				const result = this.Rules.stealCard(this.gameState, playerId, msg.targetPlayerId, msg.cardId);
				conn.send({ type: 'result', action: 'stealCard', ...result });
				if (result.success) {
					this._broadcastState();
				}
				break;
			}

			case 'getStealableCards': {
				if (!playerId) return;
				const result = this.Rules.getStealableCards(this.gameState, playerId, msg.targetPlayerId);
				conn.send({ type: 'result', action: 'getStealableCards', ...result });
				break;
			}

			case 'sendTaunt': {
				if (!playerId) return;
				const playerName = this.gameState.players[playerId]?.name || 'Speler';
				this._broadcastEvent('taunt', { playerId, playerName, text: msg.text, timestamp: Date.now() });
				conn.send({ type: 'result', action: 'sendTaunt', success: true });
				break;
			}

			case 'togglePause': {
				if (!playerId) return;
				// Alleen host mag pauzeren (of configureerbaar)
				if (playerId !== this.hostPlayerId) {
					conn.send({ type: 'result', action: 'togglePause', success: false, error: 'Alleen de host kan pauzeren.' });
					return;
				}
				if (this.gameState.paused) {
					this.gameState.paused = false;
					this.gameState.pausedBy = null;
					this.gameState.pausedAt = null;
					// Herstart timer met de opgeslagen resterende tijd
					if (this.gameState.phase === 'playing') this._startTimerForCurrentPlayer(false);
				} else {
					// Sla resterende tijd op vóór pauzeren
					const _pauseElapsed = Math.max(0, Date.now() - (this._turnTimerStart || 0));
					const _pauseDuration = Math.max(1, Number(this.gameState._turnTimerDurationMs) || this._turnTimerDuration);
					this.gameState._turnTimerRemainingMs = Math.max(1, _pauseDuration - _pauseElapsed);
					this.gameState.paused = true;
					this.gameState.pausedBy = playerId;
					this.gameState.pausedAt = Date.now();
					this._clearTimer();
				}
				this._broadcastEvent('pauseChanged', { paused: this.gameState.paused, pausedBy: playerId });
				conn.send({ type: 'result', action: 'togglePause', success: true, paused: this.gameState.paused });
				this._broadcastState();
				break;
			}

			case 'playerInteraction': {
				if (!playerId) return;
				const playerName = this.gameState.players[playerId]?.name || 'Speler';
				const interactionType = msg.interactionType || msg.interaction || 'move';
				this._broadcastEventExcept(conn.peer, 'opponentInteraction', {
					type: interactionType,
					mode: msg.mode,
					zoneName: msg.zoneName,
					baseX: msg.baseX,
					baseY: msg.baseY,
					subgridId: msg.subgridId || null,
					matrix: msg.matrix,
					cardName: msg.cardName,
					colorCode: msg.colorCode,
					playerId,
					playerName
				});
				break;
			}

			case 'start':
			case 'move':
			case 'end': {
				if (!playerId) return;
				const playerName = this.gameState.players[playerId]?.name || 'Speler';
				this._broadcastEventExcept(conn.peer, 'opponentInteraction', {
					type: msg.type,
					mode: msg.mode,
					zoneName: msg.zoneName,
					baseX: msg.baseX,
					baseY: msg.baseY,
					subgridId: msg.subgridId || null,
					matrix: msg.matrix,
					cardName: msg.cardName,
					colorCode: msg.colorCode,
					playerId,
					playerName
				});
				break;
			}

			default:
				console.warn('[P2P Host] Onbekend bericht type:', msg.type);
		}
	}

	/** Host speelt zelf een actie (roep direct de game rules aan) */
	hostAction(type, data = {}) {
		console.log('[P2P Host] hostAction:', type, data);
		const playerId = this.hostPlayerId;
		let result;

		switch (type) {
			case 'addAIPlayer':
				result = this._addAIPlayer();
				break;
			case 'startGame':
				result = this.Rules.startGame(this.gameState);
				break;
			case 'chooseStartingDeck':
				result = this.Rules.chooseStartingDeck(this.gameState, playerId, data.deckType);
				break;
			case 'chooseGoal':
				result = this.Rules.chooseObjective(this.gameState, playerId, data.objectiveIndex);
				if (result.allChosen) this._startTimerForCurrentPlayer(true);
				break;
			case 'playMove': {
				const transformedMatrix = this._getTransformedMoveMatrix(
					playerId,
					data.cardId,
					data.zoneName,
					data.rotation || 0,
					!!data.mirrored
				);
				result = this.Rules.playMove(this.gameState, playerId, data.cardId, data.zoneName,
					data.baseX, data.baseY, data.rotation || 0, !!data.mirrored, data.subgridId || null);
				if (result.success) {
					this._grantExtraTurnTime(playerId, 5000);
					this._broadcastEvent('movePlayed', {
						playerId,
						playerName: this.gameState?.players?.[playerId]?.name || 'Host',
						zoneName: data.zoneName,
						baseX: data.baseX,
						baseY: data.baseY,
						rotation: data.rotation || 0,
						mirrored: !!data.mirrored,
						subgridId: data.subgridId || null,
						matrix: transformedMatrix,
						objectivesRevealed: this._shouldRevealObjectives(),
						mineTriggered: result.mineTriggered || null
					});
				}
				break;
			}
			case 'playBonus':
				result = this.Rules.playBonus(this.gameState, playerId, data.bonusColor, data.zoneName,
					data.baseX, data.baseY, data.subgridId || null, data.rotation || 0);
				if (result.success) this._grantExtraTurnTime(playerId, 5000);
				break;
			case 'passMove':
				this._clearTimer();
				result = this.Rules.passMove(this.gameState, playerId, data.cardId || null);
				if (result.gameEnded) {
					this._broadcastEvent('levelComplete', {
						levelScores: this.gameState.levelScores,
						levelWinner: this.gameState.levelWinner,
						level: this.gameState.level
					});
				} else {
					this._startTimerForCurrentPlayer(true);
				}
				break;
			case 'endTurn':
				this._clearTimer();
				result = this.Rules.endTurn(this.gameState, playerId, data.cardId || null);
				if (result.gameEnded) {
					this._broadcastEvent('levelComplete', {
						levelScores: this.gameState.levelScores,
						levelWinner: this.gameState.levelWinner,
						level: this.gameState.level
					});
				} else {
					this._startTimerForCurrentPlayer(true);
				}
				break;
			case 'undoMove':
				result = this.Rules.undoMove(this.gameState, playerId);
				break;
			case 'startShopPhase':
				result = this.Rules.startShopPhase(this.gameState);
				break;
			case 'buyShopItem':
				result = this.Rules.buyShopItem(this.gameState, playerId, data.itemId, data.extra);
				break;
			case 'claimFreeCard':
				result = this.Rules.claimFreeCard(this.gameState, playerId, data.cardId);
				break;
			case 'sellCard':
				result = this.Rules.sellCard(this.gameState, playerId, data.cardId);
				break;
			case 'choosePerk':
				result = this.Rules.choosePerk(this.gameState, playerId, data.perkId);
				break;
			case 'shopReady':
				result = this.Rules.shopReady(this.gameState, playerId);
				if (result.allReady) {
					this.Rules.startNextLevel(this.gameState);
					this._broadcastEvent('nextLevelStarted', { level: this.gameState.level });
				}
				if (result.allReady && this.gameState.phase === 'playing') {
					this._startTimerForCurrentPlayer(true);
				}
				break;
			case 'useTimeBomb':
				this._clearTimer();
				result = this.Rules.useTimeBomb(this.gameState, playerId);
				if (result.success) {
					this._broadcastEvent('timeBombUsed', {
						bomberPlayerId: result.bomberPlayerId,
						bombedPlayerId: result.bombedPlayerId,
						bomberPlayerName: result.bomberPlayerName,
						bombedPlayerName: result.bombedPlayerName
					});
				}
				if (!result?.gameEnded) this._startTimerForCurrentPlayer(true);
				break;
			case 'useMine':
				result = this.Rules.useMine(this.gameState, playerId, data.zoneName, data.cellX, data.cellY);
				break;
			case 'stealCard':
				result = this.Rules.stealCard(this.gameState, playerId, data.targetPlayerId, data.cardId);
				break;
			case 'getStealableCards':
				result = this.Rules.getStealableCards(this.gameState, playerId, data.targetPlayerId);
				break;
			case 'togglePause': {
				// Host toggled pause
				if (this.gameState.paused) {
					this.gameState.paused = false;
					this.gameState.pausedBy = null;
					this.gameState.pausedAt = null;
					// Herstart timer met de opgeslagen resterende tijd
					if (this.gameState.phase === 'playing') this._startTimerForCurrentPlayer(false);
				} else {
					// Sla resterende tijd op vóór pauzeren
					const _pauseElapsed = Math.max(0, Date.now() - (this._turnTimerStart || 0));
					const _pauseDuration = Math.max(1, Number(this.gameState._turnTimerDurationMs) || this._turnTimerDuration);
					this.gameState._turnTimerRemainingMs = Math.max(1, _pauseDuration - _pauseElapsed);
					this.gameState.paused = true;
					this.gameState.pausedBy = playerId;
					this.gameState.pausedAt = Date.now();
					this._clearTimer();
				}
				this._broadcastEvent('pauseChanged', { paused: this.gameState.paused, pausedBy: playerId });
				result = { success: true, paused: this.gameState.paused };
				break;
			}
			default:
				result = { error: 'Onbekende actie: ' + type };
		}

		console.log('[P2P Host] hostAction result:', type, '→ phase:', this.gameState?.phase, 'result:', JSON.stringify(result)?.slice(0, 200));
		this._broadcastState();
		return result;
	}

	_countCardsPlayed(playerId) {
		if (!this.gameState?.moveHistory) return 0;
		return this.gameState.moveHistory.filter(m => m.playerId === playerId && !m.pass && !m.bonusMove && m.cardId).length;
	}

	_shouldRevealObjectives() {
		const round = Number(this.gameState?.turnCount || 0);
		return round > 4;
	}

	// ── Sanitize state per speler (verberg andermans kaarten) ──

	_sanitizeForPlayer(playerId) {
		const sanitized = JSON.parse(JSON.stringify(this.gameState));
		const revealObjectives = this._shouldRevealObjectives();
		sanitized._objectivesRevealed = revealObjectives;
		for (const pid of Object.keys(sanitized.players)) {
			if (pid !== playerId) {
				// Laat hand zichtbaar voor tegenstanders (gevraagd UX-gedrag)
				sanitized.players[pid].drawPile = Array.isArray(sanitized.players[pid].drawPile)
					? sanitized.players[pid].drawPile.length : 0;
				sanitized.players[pid].discardPile = Array.isArray(sanitized.players[pid].discardPile)
					? sanitized.players[pid].discardPile.length : 0;
				sanitized.players[pid].deck = [];
				sanitized.players[pid].shopOfferings = [];
				delete sanitized.players[pid]._pendingFreeChoices;
				// Verberg tegenstanders' actieve mijnen
				if (sanitized.players[pid].perks) {
					sanitized.players[pid].perks.activeMines = [];
				}
				if (sanitized.players[pid].chosenObjective) {
					if (revealObjectives) {
						sanitized.players[pid].chosenObjective._revealed = true;
					} else {
						sanitized.players[pid].chosenObjective = { hidden: true };
					}
				}
			}

			// Voeg cardsPlayed count toe voor elke speler
			sanitized.players[pid].cardsPlayed = this._countCardsPlayed(pid);

			// Objective status + voortgang (zelfde gedrag als server-mode)
			if (this.gameState.players[pid].chosenObjective && this.gameState.boardState) {
				const objectiveDef = this.gameState.players[pid].chosenObjective || {};
				const isEndOnlyObjective = !!objectiveDef.endOnly;
				const objResult = this.Rules.checkObjective(this.gameState, pid, this.gameState.players[pid].chosenObjective);
				const shouldDelayOutcome = isEndOnlyObjective && this.gameState.phase === 'playing';
				if (shouldDelayOutcome) {
					sanitized.players[pid].objectiveAchieved = !!this.gameState.players[pid].objectiveAchieved;
					sanitized.players[pid].objectiveFailed = false;
					sanitized.players[pid].objectiveAchievedPoints = this.gameState.players[pid].objectiveAchievedPoints || 0;
				} else {
					sanitized.players[pid].objectiveAchieved = this.gameState.players[pid].objectiveAchieved || objResult.achieved;
					sanitized.players[pid].objectiveFailed = !sanitized.players[pid].objectiveAchieved && !!objResult.failed;
					sanitized.players[pid].objectiveAchievedPoints = this.gameState.players[pid].objectiveAchievedPoints || 0;
				}
				sanitized.players[pid].objectiveProgress = {
					current: objResult.current,
					target: objResult.target,
					points: objResult.points,
					coins: objResult.coins || 0,
					randomBonuses: objResult.randomBonuses || 0
				};
			}
		}
		// Verberg objectiveChoices van andere spelers
		if (sanitized.objectiveChoices) {
			for (const pid of Object.keys(sanitized.objectiveChoices)) {
				if (pid !== playerId) {
					sanitized.objectiveChoices[pid] = [];
				}
			}
		}
		return sanitized;
	}

	// ── Broadcasting ──

	_broadcastState() {
		// Stuur naar host UI
		if (this.onStateChanged) {
			try {
				this.onStateChanged(this._sanitizeForPlayer(this.hostPlayerId));
			} catch (err) {
				console.error('[P2P Host] onStateChanged error:', err);
			}
		}

		// Stuur naar alle gasten (per-speler gesanitized)
		for (const [peerId, conn] of this.connections) {
			const playerId = this.playerMap.get(peerId);
			if (!playerId) continue;
			try {
				conn.send({ type: 'gameState', state: this._sanitizeForPlayer(playerId) });
			} catch (err) {
				console.error('[P2P Host] Broadcast error naar', peerId, err);
			}
		}

		// Laat AI reageren na state-updates
		this._scheduleAI();
	}

	_addAIPlayer() {
		if (!this.gameState) return { success: false, error: 'Geen game state.' };
		if (this.gameState.phase !== 'waiting') return { success: false, error: 'Kan alleen AI toevoegen in de wachtkamer.' };

		const maxPlayers = Number(this.gameState.settings?.maxPlayers) || 4;
		const currentPlayers = Object.keys(this.gameState.players || {}).length;
		if (currentPlayers >= maxPlayers) return { success: false, error: 'Maximum spelers bereikt.' };

		const aiCount = this.aiPlayerIds.size + 1;
		const aiId = 'AI_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
		const aiName = `Bot ${aiCount}`;
		const addResult = this.Rules.addPlayer(this.gameState, aiId, aiName);
		if (addResult?.error) return { success: false, error: addResult.error };

		this.aiPlayerIds.add(aiId);
		if (this.gameState.players?.[aiId]) {
			this.gameState.players[aiId].isAI = true;
			this.gameState.players[aiId].connected = true;
		}
		if (this.onPlayerJoined) this.onPlayerJoined({ playerId: aiId, name: aiName, isAI: true });
		return { success: true, playerId: aiId, name: aiName, isAI: true };
	}

	_scheduleAI() {
		if (!this.gameState) return;
		if (this.aiPlayerIds.size === 0) return;
		if (this._aiTimer) return;
		const delay = 2000 + Math.floor(Math.random() * 2000); // 2-4 seconds
		this._aiTimer = setTimeout(() => {
			this._aiTimer = null;
			this._runAI();
		}, delay);
	}

	_runAI() {
		if (!this.gameState || this.aiPlayerIds.size === 0) return;

		let changed = false;
		const phase = this.gameState.phase;

		if (phase === 'choosingStartDeck') {
			for (const aiId of this.aiPlayerIds) {
				const p = this.gameState.players?.[aiId];
				if (!p || p.startingDeckType) continue;
				const result = this.Rules.chooseStartingDeck(this.gameState, aiId, 'random');
				if (!result?.error) changed = true;
			}
		}

		if (phase === 'choosingGoals') {
			for (const aiId of this.aiPlayerIds) {
				const p = this.gameState.players?.[aiId];
				if (!p || p.chosenObjective) continue;
				const choices = this.gameState.objectiveChoices?.[aiId] || [];
				if (!choices.length) continue;
				let bestIdx = 0;
				let bestScore = -Infinity;
				for (let i = 0; i < choices.length; i++) {
					const c = choices[i] || {};
					const score = (c.points || 0) + ((c.coins || 0) * 2) + ((c.randomBonuses || 0) * 3);
					if (score > bestScore) { bestScore = score; bestIdx = i; }
				}
				const result = this.Rules.chooseObjective(this.gameState, aiId, bestIdx);
				if (!result?.error) {
					changed = true;
					if (result.allChosen) this._startTimerForCurrentPlayer(true);
				}
			}
		}

		if (phase === 'playing' && !this.gameState.paused) {
			const currentPid = this.gameState.playerOrder?.[this.gameState.currentTurnIndex];
			if (currentPid && this.aiPlayerIds.has(currentPid)) {
				this._clearTimer();
				// Use perk if available
				this._aiUsePerkIfPossible(currentPid);
				// Play card with scoring
				const playResult = this._aiPlayCardWithScoring(currentPid);
				// Play bonuses if collected
				this._aiPlayBonusesIfPossible(currentPid);
				// End turn
				const result = this.Rules.endTurn(this.gameState, currentPid, null);
				changed = true;
				// Maybe taunt
				this._aiMaybeTaunt(currentPid);
				if (result?.gameEnded) {
					this._broadcastEvent('levelComplete', {
						levelScores: this.gameState.levelScores,
						levelWinner: this.gameState.levelWinner,
						level: this.gameState.level
					});
				} else {
					this._startTimerForCurrentPlayer(true);
				}
			}
		}

		if (phase === 'levelComplete') {
			const result = this.Rules.startShopPhase(this.gameState);
			if (!result?.error) changed = true;
		}

		if (phase === 'shopping') {
			for (const aiId of this.aiPlayerIds) {
				const p = this.gameState.players?.[aiId];
				if (!p || p.shopReady) continue;

				// Perk kiezen als beschikbaar
				if ((p.perks?.perkPoints || 0) > 0) {
					const available = this.Rules.getAvailablePerks(p) || [];
					if (available.length > 0) {
						this.Rules.choosePerk(this.gameState, aiId, available[0].id);
						changed = true;
					}
				}

				// Koop goedkope waarde-items
				if ((p.goldCoins || 0) >= 1) {
					this.Rules.buyShopItem(this.gameState, aiId, 'random-card', {});
					changed = true;
				}

				const readyResult = this.Rules.shopReady(this.gameState, aiId);
				if (!readyResult?.error) {
					changed = true;
					if (readyResult.allReady) {
						this.Rules.startNextLevel(this.gameState);
						this._broadcastEvent('nextLevelStarted', { level: this.gameState.level });
						if (this.gameState.phase === 'playing') this._startTimerForCurrentPlayer(true);
					}
				}
			}
		}

		if (changed) {
			this._broadcastState();
		}
	}

	_aiPlayCardIfPossible(playerId) {
		const player = this.gameState?.players?.[playerId];
		const board = this.gameState?.boardState;
		if (!player || !board) return false;

		const hand = Array.isArray(player.hand) ? player.hand : [];
		for (const card of hand) {
			const allowedZones = this.Rules.getAllowedZones(card);
			const rotations = [0, 1, 2, 3];
			for (const zoneName of allowedZones) {
				const tryOnZone = (zoneData, subgridId = null) => {
					if (!zoneData) return false;
					for (const rotation of rotations) {
						let matrix = this.Rules.cloneMatrix(card.matrix);
						matrix = this.Rules.rotateMatrixN(matrix, rotation);
						for (let y = 0; y < zoneData.rows; y++) {
							for (let x = 0; x < zoneData.cols; x++) {
								const cells = this.Rules.collectPlacementCellsData(zoneData, x, y, matrix);
								if (!cells) continue;
								if (!this.Rules.validatePlacement(zoneName, zoneData, cells, {
									greenGapAllowed: !!player.perks?.greenGapAllowed,
									diagonalRotation: !!player.perks?.diagonalRotation
								})) continue;
								const result = this.Rules.playMove(this.gameState, playerId, card.id, zoneName, x, y, rotation, false, subgridId);
								if (!result?.error) {
									this._broadcastEvent('movePlayed', {
										playerId,
										playerName: player.name,
										zoneName,
										baseX: x,
										baseY: y,
										rotation,
										mirrored: false,
										subgridId: subgridId || null,
										matrix,
										objectivesRevealed: this._shouldRevealObjectives(),
										mineTriggered: result.mineTriggered || null
									});
									return true;
								}
							}
						}
					}
					return false;
				};

				if (zoneName === 'red') {
					const subgrids = board.zones?.red?.subgrids || [];
					for (const sg of subgrids) {
						if (tryOnZone(sg, sg.id)) return true;
					}
				} else {
					if (tryOnZone(board.zones?.[zoneName], null)) return true;
				}
			}
		}

		return false;
	}

	_getTransformedMoveMatrix(playerId, cardId, zoneName, rotation = 0, mirrored = false) {
		const player = this.gameState?.players?.[playerId];
		if (!player) return null;
		const hand = Array.isArray(player.hand) ? player.hand : [];
		const card = hand.find((c) => c && c.id === cardId);
		if (!card || !Array.isArray(card.matrix)) return null;

		let matrix = this.Rules.cloneMatrix(card.matrix);
		matrix = this.Rules.getEnhancedMatrix(matrix, zoneName, {
			greenGapAllowed: !!player.perks?.greenGapAllowed,
			diagonalRotation: !!player.perks?.diagonalRotation
		});
		matrix = this.Rules.rotateMatrixN(matrix, Number(rotation) || 0);
		if (mirrored) matrix = this.Rules.mirrorMatrix(matrix);
		return matrix;
	}

	_broadcastEvent(eventType, data) {
		const msg = { type: 'event', event: eventType, data };

		// Naar gasten
		for (const [, conn] of this.connections) {
			try { conn.send(msg); } catch (e) { /* skip */ }
		}

		// Host UI krijgt events via onEvent callback
		if (this.onEvent) {
			try { this.onEvent(eventType, data); } catch (e) { console.error('[P2P Host] onEvent error:', e); }
		}
	}

	_broadcastEventExcept(excludePeerId, eventType, data) {
		const msg = { type: 'event', event: eventType, data };
		for (const [peerId, conn] of this.connections) {
			if (peerId === excludePeerId) continue;
			try { conn.send(msg); } catch (e) { /* skip */ }
		}
		// Host UI ontvangt ook events van gasten
		if (this.onEvent) {
			try { this.onEvent(eventType, data); } catch (e) { /* skip */ }
		}
	}

	// ── Turn Timer ──

	_startTimerForCurrentPlayer(forceFull = false) {
		this._clearTimer();
		if (!this.gameState || this.gameState.phase !== 'playing') return;

		const currentPid = this.gameState.playerOrder[this.gameState.currentTurnIndex];
		if (!currentPid) return;
		// forceFull=true geeft de volgende speler altijd een verse volledige timer;
		// forceFull=false (hervatten na pauze) gebruikt de opgeslagen resterende tijd.
		const remaining = forceFull
			? this._turnTimerDuration
			: Math.max(1, Number(this.gameState._turnTimerRemainingMs) || this._turnTimerDuration);
		this._startTimerForPlayer(currentPid, remaining);
	}

	_startTimerForPlayer(playerId, durationMs) {
		this._clearTimer();
		if (!this.gameState || this.gameState.phase !== 'playing') return;
		if (!playerId) return;

		const duration = Math.max(1, Number(durationMs) || this._turnTimerDuration);
		this._turnTimerStart = Date.now();
		this.gameState._turnTimerStart = this._turnTimerStart;
		this.gameState._turnTimerDurationMs = duration;
		this.gameState._turnTimerRemainingMs = duration;

		this._turnTimer = setTimeout(() => {
			// Auto-end turn
			const result = this.Rules.endTurn(this.gameState, playerId);
			console.log(`[P2P Host] Timer verlopen voor ${playerId}`);
			this._broadcastState();
			if (result.gameEnded) {
				this._broadcastEvent('levelComplete', {
					levelScores: this.gameState.levelScores,
					levelWinner: this.gameState.levelWinner,
					level: this.gameState.level
				});
			} else {
				this._startTimerForCurrentPlayer(true);
			}
		}, duration);
}

	_grantExtraTurnTime(playerId, extraMs = 5000) {
		if (!this.gameState || this.gameState.phase !== 'playing') return;
		const currentPid = this.gameState.playerOrder?.[this.gameState.currentTurnIndex];
		if (!currentPid || currentPid !== playerId) return;
		const startedAt = Number(this.gameState._turnTimerStart || this._turnTimerStart || 0);
		const duration = Math.max(1, Number(this.gameState._turnTimerDurationMs) || this._turnTimerDuration);
		const elapsed = startedAt > 0 ? Math.max(0, Date.now() - startedAt) : 0;
		const remaining = Math.max(1, duration - elapsed);
		const nextRemaining = Math.max(1, remaining + Math.max(0, Number(extraMs) || 0));
		this._startTimerForPlayer(currentPid, nextRemaining);
	}

	_clearTimer() {
		if (this._turnTimer) {
			clearTimeout(this._turnTimer);
			this._turnTimer = null;
		}
	}

	// ── Utils ──

	_generateRoomCode() {
		const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
		let code = '';
		for (let i = 0; i < 6; i++) {
			code += chars[Math.floor(Math.random() * chars.length)];
		}
		return code;
	}

	destroy() {
		this._clearTimer();
		if (this._aiTimer) {
			clearTimeout(this._aiTimer);
			this._aiTimer = null;
		}
		for (const [, conn] of this.connections) {
			try { conn.close(); } catch (e) { /* skip */ }
		}
		this.connections.clear();
		this.playerMap.clear();
		if (this.peer) {
			this.peer.destroy();
			this.peer = null;
		}
		this.gameState = null;
	}
}

/**
 * ============================================================
 * LOCUS MULTIPLAYER — P2P Guest Client
 * ============================================================
 * Verbindt met een P2P Host via room-code.
 * Vervangt Socket.IO als transport.
 * ============================================================
 */
class LocusP2PGuest {
	constructor() {
		this.peer = null;
		this.connection = null;
		this.userId = null;
		this.roomCode = null;
		this.gameState = null;
		this.connected = false;

		// Callbacks (zelfde interface als LocusMultiplayer)
		this.onGameStateChanged = null;
		this.onPlayerJoined = null;
		this.onPlayerLeft = null;
		this.onTurnChanged = null;
		this.onGameStarted = null;
		this.onGameEnded = null;
		this.onGoalPhase = null;
		this.onError = null;
		this.onConnectionChanged = null;
		this.onMovePlayed = null;
		this.onLevelComplete = null;
		this.onShopPhase = null;
		this.onNextLevel = null;
		this.onObjectivesRevealed = null;
		this.onTimeBombed = null;
		this.onOpponentInteraction = null;
		this.onTaunt = null;
		this.onPauseChanged = null;

		this._pendingCallbacks = new Map();
		this._callbackId = 0;
	}

	async init() {
		this.peer = new Peer(undefined, {
			debug: 1,
			config: {
				iceServers: [
					{ urls: 'stun:stun.l.google.com:19302' },
					{ urls: 'stun:stun1.l.google.com:19302' }
				]
			}
		});

		await new Promise((resolve, reject) => {
			this.peer.on('open', resolve);
			this.peer.on('error', reject);
		});

		return { userId: this.peer.id };
	}

	async joinGame(playerName, roomCode) {
		const options = arguments[2] || {};
		this.roomCode = roomCode.toUpperCase().trim();
		const hostPeerId = `locus-${this.roomCode}`;

		return new Promise((resolve, reject) => {
			const conn = this.peer.connect(hostPeerId, { reliable: true });
			
			const timeout = setTimeout(() => {
				reject(new Error('Verbinding timeout — controleer de room code'));
			}, 10000);

			conn.on('open', () => {
				clearTimeout(timeout);
				this.connection = conn;
				this.connected = true;
				if (this.onConnectionChanged) this.onConnectionChanged(true);

				// Registreer data listener
				conn.on('data', (data) => this._handleMessage(data));

				// Stuur join request
				conn.send({ type: 'joinGame', playerName, reconnectPlayerId: options.reconnectPlayerId || null });

				// Wacht op joinResult
				const joinHandler = (msg) => {
					if (msg.type === 'joinResult') {
						conn.off('data', joinHandler);
						if (msg.success) {
							this.userId = msg.playerId;
							this.inviteCode = msg.roomCode;
							try {
								sessionStorage.setItem('locus_p2p_role', 'guest');
								sessionStorage.setItem('locus_p2p_roomCode', this.roomCode);
								sessionStorage.setItem('locus_p2p_playerId', this.userId);
								sessionStorage.setItem('locus_p2p_userName', playerName);
							} catch (_) {}
							resolve({ gameId: 'p2p-' + msg.roomCode, playerId: msg.playerId });
						} else {
							reject(new Error(msg.error || 'Joinen mislukt'));
						}
					}
				};
				conn.on('data', joinHandler);
			});

			conn.on('close', () => {
				clearTimeout(timeout);
				this.connected = false;
				if (this.onConnectionChanged) this.onConnectionChanged(false);
			});

			conn.on('error', (err) => {
				clearTimeout(timeout);
				reject(err);
			});
		});
	}

	_handleMessage(msg) {
		if (!msg || !msg.type) return;

		switch (msg.type) {
			case 'gameState': {
				const prevState = this.gameState;
				this.gameState = msg.state;
				if (this.onGameStateChanged) this.onGameStateChanged(msg.state, prevState);
				break;
			}
			case 'event': {
				this._handleEvent(msg.event, msg.data);
				break;
			}
			case 'result': {
				// Handled inline
				break;
			}
		}
	}

	_handleEvent(event, data) {
		switch (event) {
			case 'movePlayed': if (this.onMovePlayed) this.onMovePlayed(data); break;
			case 'levelComplete': if (this.onLevelComplete) this.onLevelComplete(data.levelScores, data.levelWinner, data.level); break;
			case 'nextLevelStarted': if (this.onNextLevel) this.onNextLevel(data.level); break;
			case 'gameEnded': if (this.onGameEnded) this.onGameEnded(data); break;
			case 'timeBombUsed': if (this.onTimeBombed) this.onTimeBombed(data); break;
			case 'opponentInteraction': if (this.onOpponentInteraction) this.onOpponentInteraction(data); break;
			case 'taunt': if (this.onTaunt) this.onTaunt(data); break;
			case 'pauseChanged': if (this.onPauseChanged) this.onPauseChanged(data); break;
		}
	}

	// ── Command helpers (zelfde interface als LocusMultiplayer) ──

	_sendCommand(type, data = {}) {
		return new Promise((resolve, reject) => {
			if (!this.connection || !this.connected) {
				return reject(new Error('Niet verbonden'));
			}
			this.connection.send({ type, ...data });
			// P2P host stuurt resultaat terug via 'result' messages
			const handler = (msg) => {
				if (msg.type === 'result' && msg.action === type) {
					this.connection.off('data', handler);
					if (msg.error) reject(new Error(msg.error));
					else resolve(msg);
				}
			};
			this.connection.on('data', handler);
			// Timeout
			setTimeout(() => {
				this.connection.off('data', handler);
				resolve({ success: true }); // assume ok
			}, 5000);
		});
	}

	async createGame() { /* Host-only */ }
	async startGame() { return this._sendCommand('startGame'); }
	async chooseStartingDeck(deckType) { return this._sendCommand('chooseStartingDeck', { deckType }); }
	async chooseGoal(objectiveIndex) { return this._sendCommand('chooseGoal', { objectiveIndex }); }
	async playCard(cardId, zoneName, baseX, baseY, rotation, mirrored, subgridId) {
		return this._sendCommand('playMove', { cardId, zoneName, baseX, baseY, rotation, mirrored, subgridId });
	}
	async playBonus(bonusColor, zoneName, baseX, baseY, subgridId, rotation) {
		return this._sendCommand('playBonus', { bonusColor, zoneName, baseX, baseY, subgridId, rotation });
	}
	async pass(cardId) { return this._sendCommand('passMove', { cardId }); }
	async endTurn(cardId) { return this._sendCommand('endTurn', { cardId }); }
	async undoMove() { return this._sendCommand('undoMove'); }
	async startShopPhase() { return this._sendCommand('startShopPhase'); }
	async buyShopItem(itemId, extra) { return this._sendCommand('buyShopItem', { itemId, extra }); }
	async claimFreeCard(cardId) { return this._sendCommand('claimFreeCard', { cardId }); }
	async sellCard(cardId) { return this._sendCommand('sellCard', { cardId }); }
	async choosePerk(perkId) { return this._sendCommand('choosePerk', { perkId }); }
	async setShopReady() { return this._sendCommand('shopReady'); }
	async useTimeBomb() { return this._sendCommand('useTimeBomb'); }
	async useMine(zoneName, cellX, cellY) { return this._sendCommand('useMine', { zoneName, cellX, cellY }); }
	async stealCard(targetPlayerId, cardId) { return this._sendCommand('stealCard', { targetPlayerId, cardId }); }
	async getStealableCards(targetPlayerId) { return this._sendCommand('getStealableCards', { targetPlayerId }); }
	async togglePause() { return this._sendCommand('togglePause'); }
	async sendTaunt(text) { return this._sendCommand('sendTaunt', { text }); }
	sendInteraction(data) {
		if (this.connection && this.connected) {
			const interactionType = data?.type || 'move';
			const payload = { ...(data || {}) };
			delete payload.type;
			this.connection.send({ type: 'playerInteraction', interactionType, ...payload });
		}
	}

	// ── State helpers (zelfde als LocusMultiplayer) ──

	isMyTurn() {
		if (!this.gameState || this.gameState.phase !== 'playing') return false;
		return this.gameState.playerOrder[this.gameState.currentTurnIndex] === this.userId;
	}

	getCurrentPlayer() {
		if (!this.gameState) return null;
		const pid = this.gameState.playerOrder[this.gameState.currentTurnIndex];
		return this.gameState.players[pid] || null;
	}

	getMyPlayer() {
		if (!this.gameState) return null;
		return this.gameState.players[this.userId] || null;
	}

	getMyHand() {
		const player = this.getMyPlayer();
		return player ? player.hand : [];
	}

	getScoreboard() {
		if (!this.gameState) return [];
		return this.gameState.playerOrder.map(pid => {
			const p = this.gameState.players[pid];
			return {
				id: pid, name: p.name, score: p.score || 0,
				scoreBreakdown: p.scoreBreakdown || null,
				isCurrentTurn: this.gameState.playerOrder[this.gameState.currentTurnIndex] === pid,
				isMe: pid === this.userId,
				cardsLeft: Array.isArray(p.drawPile) ? p.drawPile.length : (p.drawPile || 0),
				handSize: Array.isArray(p.hand) ? p.hand.length : 0,
				discardPileSize: Array.isArray(p.discardPile) ? p.discardPile.length : (typeof p.discardPile === 'number' ? p.discardPile : 0),
				bonusInventory: p.bonusInventory || {},
				connected: p.connected
			};
		});
	}

	getBoardState() {
		if (!this.gameState) return null;
		return this.gameState.boardState;
	}

	previewPlacement(zoneName, baseX, baseY, matrix, subgridId, rotation, mirrored) {
		if (!this.gameState?.boardState) return { valid: false };
		const Rules = window.LocusGameRules;
		if (!Rules) return { valid: false };

		// Bouw perk flags en pas matrix aan voor preview (zoals server dat doet)
		const player = this.gameState.players[this.userId || this.hostPlayerId];
		const perkFlags = {
			greenGapAllowed: !!player?.perks?.greenGapAllowed,
			diagonalRotation: !!player?.perks?.diagonalRotation
		};

		// Als rotation info is meegegeven, pas enhancement toe VÓÓR rotatie
		let enhancedMatrix;
		if (rotation !== undefined) {
			enhancedMatrix = Rules.getEnhancedMatrix(matrix, zoneName, perkFlags);
			enhancedMatrix = Rules.rotateMatrixN(enhancedMatrix, ((Number(rotation) || 0) + 4) % 4);
			if (mirrored) enhancedMatrix = Rules.mirrorMatrix(enhancedMatrix);
		} else {
			enhancedMatrix = Rules.getEnhancedMatrix(matrix, zoneName, perkFlags);
		}

		let zoneData;
		if (zoneName === 'red') {
			const subgridsToCheck = subgridId
				? (this.gameState.boardState.zones.red?.subgrids || []).filter(sg => sg.id === subgridId)
				: (this.gameState.boardState.zones.red?.subgrids || []);
			for (const sg of subgridsToCheck) {
				const cells = Rules.collectPlacementCellsData(sg, baseX, baseY, enhancedMatrix);
				if (cells) {
					const valid = Rules.validatePlacement(zoneName, sg, cells, perkFlags);
					return { valid, cells, enhancedMatrix };
				}
			}
			return { valid: false };
		}
		zoneData = this.gameState.boardState.zones[zoneName];
		if (!zoneData) return { valid: false };
		const cells = Rules.collectPlacementCellsData(zoneData, baseX, baseY, enhancedMatrix);
		if (!cells) return { valid: false };
		const valid = Rules.validatePlacement(zoneName, zoneData, cells, perkFlags);
		return { valid, cells, enhancedMatrix };
	}

	disconnect() {
		if (this.connection) { try { this.connection.close(); } catch (e) { /* */ } }
		if (this.peer) { this.peer.destroy(); this.peer = null; }
		this.gameState = null;
		this.userId = null;
		this.connected = false;
	}
}

/**
 * Mobile debug log — toont een overlay met foutmeldingen op telefoons
 * waar de browser console niet beschikbaar is.
 */
LocusP2PHost._mobileLogEntries = [];
LocusP2PHost._logMobile = function(msg) {
	console.log(msg);
	LocusP2PHost._mobileLogEntries.push({ ts: Date.now(), msg: String(msg) });
	// Update overlay als deze bestaat
	const el = document.getElementById('locus-mobile-debug');
	if (el) {
		const lines = LocusP2PHost._mobileLogEntries.slice(-20).map(e => {
			const d = new Date(e.ts);
			return `[${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}] ${e.msg}`;
		}).join('\n');
		el.querySelector('.lmdb-content').textContent = lines;
		el.querySelector('.lmdb-content').scrollTop = 9999;
	}
};

LocusP2PHost.showMobileDebug = function() {
	if (document.getElementById('locus-mobile-debug')) return;
	const wrap = document.createElement('div');
	wrap.id = 'locus-mobile-debug';
	Object.assign(wrap.style, {
		position: 'fixed', bottom: '0', left: '0', right: '0', zIndex: '999999',
		background: 'rgba(0,0,0,0.92)', color: '#0f0', fontSize: '11px',
		fontFamily: 'monospace', maxHeight: '35vh', display: 'flex', flexDirection: 'column'
	});
	wrap.innerHTML = `
		<div style="display:flex;justify-content:space-between;padding:4px 8px;background:#111;color:#aaa;">
			<span>📱 Debug Log</span>
			<button onclick="this.closest('#locus-mobile-debug').remove()" style="background:none;border:none;color:#f66;font-size:14px;cursor:pointer;">✕</button>
		</div>
		<pre class="lmdb-content" style="margin:0;padding:8px;overflow:auto;flex:1;white-space:pre-wrap;word-break:break-all;"></pre>
	`;
	document.body.appendChild(wrap);
	// Populate with existing entries
	LocusP2PHost._logMobile('Debug overlay geopend');
};

// Catch global errors for mobile debugging
if (typeof window !== 'undefined') {
	window.addEventListener('error', (e) => {
		LocusP2PHost._logMobile('❌ JS Error: ' + (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || ''));
	});
	window.addEventListener('unhandledrejection', (e) => {
		LocusP2PHost._logMobile('❌ Promise rejected: ' + (e.reason?.message || e.reason || ''));
	});
}

// Browser globals
if (typeof window !== 'undefined') {
	window.LocusP2PHost = LocusP2PHost;
	window.LocusP2PGuest = LocusP2PGuest;
}
