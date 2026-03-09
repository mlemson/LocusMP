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
		this._aiDifficulty = new Map();
		this._aiPersonality = new Map();
		this._aiTurnInProgress = false;
		this._aiTurnPlayerId = null;
		this._aiTurnWatchdog = null;

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

				// Rebuild runtime AI indexes/maps from restored state after refresh.
				this._rehydrateAIRuntimeState();

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

				// Ensure bots resume thinking immediately after a host refresh/reconnect.
				this._scheduleAI();

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
				const result = this._addAIPlayer(msg.difficulty || 'normal');
				conn.send({ type: 'result', action: 'addAIPlayer', ...result });
				this._broadcastState();
				break;
			}

			case 'removeAIPlayer': {
				if (playerId !== this.hostPlayerId && playerId) {
					conn.send({ type: 'result', action: 'removeAIPlayer', success: false, error: 'Alleen de host kan AI verwijderen.' });
					return;
				}
				const rmResult = this._removeAIPlayer(msg.playerId);
				conn.send({ type: 'result', action: 'removeAIPlayer', ...rmResult });
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
				if (result.startedPlaying) this._startTimerForCurrentPlayer(true);
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
				if (result.startedPlaying) this._startTimerForCurrentPlayer(true);
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
					const thiefName = (this.gameState.players[playerId] || {}).name || 'Speler';
					const victimName = (this.gameState.players[msg.targetPlayerId] || {}).name || 'Speler';
					this._broadcastEvent('cardStolen', {
						thiefId: playerId,
						thiefName,
						victimId: msg.targetPlayerId,
						victimName,
						cardId: msg.cardId
					});
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

				// Bot auto-reply: each bot has independent chance to respond (aggressive 85%, normal 60%)
				const aiPlayers = (this.gameState.playerOrder || []).filter(pid =>
					pid !== playerId && this.gameState.players[pid]?.isAI
				);
				const aggroTaunts = ['fuck off', 'your mum', 'cheater', 'HAHA', 'Nooo!'];
				const normalTaunts = ['Nooo!', 'HAHA', 'Well played!', 'Oeps...', 'Kom op!', 'cheater', 'fuck off', 'your mum'];
				let replyCount = 0;
				for (const botId of aiPlayers) {
					if (replyCount >= 2) break; // Max 2 replies
					const botPers = this._aiPersonality?.get(botId) || 'normal';
					const chance = botPers === 'aggressive' ? 0.85 : 0.60;
					if (Math.random() > chance) continue;
					const pool = botPers === 'aggressive' ? aggroTaunts : normalTaunts;
					const replyText = pool[Math.floor(Math.random() * pool.length)];
					const replyDelay = 1000 + Math.floor(Math.random() * 2000);
					replyCount++;
					setTimeout(() => {
						if (!this.gameState || this.gameState.phase !== 'playing') return;
						const botPlayer = this.gameState.players[botId];
						if (!botPlayer) return;
						this._broadcastEvent('taunt', {
							playerId: botId,
							playerName: botPlayer.name,
							text: replyText,
							timestamp: Date.now()
						});
					}, replyDelay);
				}

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
				result = this._addAIPlayer(data.difficulty || 'normal');
				break;
			case 'removeAIPlayer':
				result = this._removeAIPlayer(data.playerId);
				break;
			case 'startGame':
				result = this.Rules.startGame(this.gameState);
				break;
			case 'chooseStartingDeck':
				result = this.Rules.chooseStartingDeck(this.gameState, playerId, data.deckType);
				break;
			case 'chooseGoal':
				result = this.Rules.chooseObjective(this.gameState, playerId, data.objectiveIndex);
				if (result.startedPlaying) this._startTimerForCurrentPlayer(true);
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
				if (result.startedPlaying) this._startTimerForCurrentPlayer(true);
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

		// Time bomb check: if a human's turn just started, AI bots can bomb immediately
		this._checkAITimeBomb();
	}

	/** AI bots use time bombs at the very start of a human player's turn */
	_checkAITimeBomb() {
		if (!this.gameState || this.gameState.phase !== 'playing' || this.gameState.paused) return;
		if (this.aiPlayerIds.size === 0) return;
		if (this._timeBombPending) return; // Already queued

		const currentPid = this.gameState.playerOrder?.[this.gameState.currentTurnIndex];
		if (!currentPid || this.aiPlayerIds.has(currentPid)) return; // Only bomb humans

		// Check if any AI bot has time bombs
		for (const aiId of this.aiPlayerIds) {
			const aiPlayer = this.gameState.players?.[aiId];
			if (!aiPlayer || (aiPlayer.timeBombs || 0) <= 0) continue;
			// 40% chance to use time bomb
			if (Math.random() >= 0.4) continue;

			// Fire after a very short delay so the player sees their turn start
			this._timeBombPending = true;
			setTimeout(() => {
				this._timeBombPending = false;
				if (!this.gameState || this.gameState.phase !== 'playing') return;
				const stillCurrentPid = this.gameState.playerOrder?.[this.gameState.currentTurnIndex];
				if (stillCurrentPid !== currentPid) return; // Turn already changed

				const bombResult = this.Rules.useTimeBomb(this.gameState, aiId);
				if (bombResult && !bombResult.error) {
					console.log(`💣 Bot ${aiPlayer.name} used TIME BOMB on ${this.gameState.players?.[currentPid]?.name}!`);
					this._broadcastEvent('timeBombUsed', {
						bomberPlayerId: bombResult.bomberPlayerId,
						bomberPlayerName: bombResult.bomberPlayerName,
						bombedPlayerId: bombResult.bombedPlayerId,
						bombedPlayerName: bombResult.bombedPlayerName
					});
					this._broadcastState();
				}
			}, 500);
			break; // Only one bomb per turn
		}
	}

	_addAIPlayer(difficulty = 'normal') {
		if (!this.gameState) return { success: false, error: 'Geen game state.' };
		if (this.gameState.phase !== 'waiting') return { success: false, error: 'Kan alleen AI toevoegen in de wachtkamer.' };

		const maxPlayers = Number(this.gameState.settings?.maxPlayers) || 4;
		const currentPlayers = Object.keys(this.gameState.players || {}).length;
		if (currentPlayers >= maxPlayers) return { success: false, error: 'Maximum spelers bereikt.' };

		const aiCount = this.aiPlayerIds.size + 1;
		const aiId = 'AI_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
		const baseName = `Bot ${aiCount}`;
		const aiName = difficulty === 'hard' ? `${baseName} \ud83e\udde0` : difficulty === 'random' ? `${baseName} \ud83c\udfb2` : baseName;
		const addResult = this.Rules.addPlayer(this.gameState, aiId, aiName);
		if (addResult?.error) return { success: false, error: addResult.error };

		this.aiPlayerIds.add(aiId);
		if (!this._aiDifficulty) this._aiDifficulty = new Map();
		this._aiDifficulty.set(aiId, difficulty);
		// Assign personality (25% aggressive)
		if (!this._aiPersonality) this._aiPersonality = new Map();
		const personalities = ['normal', 'normal', 'normal', 'aggressive'];
		const personality = personalities[Math.floor(Math.random() * personalities.length)];
		this._aiPersonality.set(aiId, personality);
		if (personality === 'aggressive') {
			const aggroName = aiName + ' \ud83d\udca2';
			if (addResult?.player) addResult.player.name = aggroName;
			if (this.gameState.players?.[aiId]) this.gameState.players[aiId].name = aggroName;
		}
		if (this.gameState.players?.[aiId]) {
			this.gameState.players[aiId].isAI = true;
			this.gameState.players[aiId].connected = true;
			this.gameState.players[aiId].aiDifficulty = difficulty;
			this.gameState.players[aiId].aiPersonality = personality;
		}
		if (this.onPlayerJoined) this.onPlayerJoined({ playerId: aiId, name: aiName, isAI: true });
		return { success: true, playerId: aiId, name: aiName, isAI: true };
	}

	_rehydrateAIRuntimeState() {
		this.aiPlayerIds = new Set();
		this._aiDifficulty = new Map();
		this._aiPersonality = new Map();
		const players = this.gameState?.players || {};
		for (const [pid, p] of Object.entries(players)) {
			if (!p?.isAI) continue;
			this.aiPlayerIds.add(pid);
			const savedDifficulty = String(p.aiDifficulty || '').toLowerCase();
			const inferredHard = /\b(hard|\ud83e\udde0)\b/i.test(String(p.name || ''));
			const inferredRandom = /\b(random|\ud83c\udfb2)\b/i.test(String(p.name || ''));
			const difficulty = (savedDifficulty === 'hard' || savedDifficulty === 'normal' || savedDifficulty === 'random')
				? savedDifficulty
				: (inferredHard ? 'hard' : inferredRandom ? 'random' : 'normal');
			this._aiDifficulty.set(pid, difficulty);
			const savedPersonality = String(p.aiPersonality || '').toLowerCase();
			const personality = savedPersonality === 'aggressive' ? 'aggressive' : 'normal';
			this._aiPersonality.set(pid, personality);
			p.aiDifficulty = difficulty;
			p.aiPersonality = personality;
			p.connected = true;
		}
	}

	_removeAIPlayer(aiPlayerId) {
		if (!this.gameState) return { success: false, error: 'Geen game state.' };
		if (this.gameState.phase !== 'waiting') return { success: false, error: 'Kan alleen AI verwijderen in de wachtkamer.' };
		if (!this.aiPlayerIds.has(aiPlayerId)) return { success: false, error: 'Geen AI speler met dit ID.' };

		const result = this.Rules.removePlayer(this.gameState, aiPlayerId);
		if (result?.error) return { success: false, error: result.error };

		this.aiPlayerIds.delete(aiPlayerId);
		if (this._aiDifficulty) this._aiDifficulty.delete(aiPlayerId);
		if (this._aiPersonality) this._aiPersonality.delete(aiPlayerId);
		if (this.onPlayerLeft) this.onPlayerLeft({ playerId: aiPlayerId });
		return { success: true };
	}

	_scheduleAI() {
		if (!this.gameState) return;
		if (this.aiPlayerIds.size === 0) return;
		if (this.gameState.phase === 'playing' && !this.gameState.paused && !this._turnTimer) {
			const pid = this.gameState.playerOrder?.[this.gameState.currentTurnIndex];
			if (pid && !this.aiPlayerIds.has(pid)) {
				// Safety net: if timer was lost unexpectedly, restore it for human turns.
				this._startTimerForCurrentPlayer(false);
			}
		}
		if (this._aiTimer) return;
		if (this._aiTurnInProgress) return;

		const phase = this.gameState.phase;
		const currentPid = this.gameState.playerOrder?.[this.gameState.currentTurnIndex];
		const aiTurnActive = phase === 'playing' && !!currentPid && this.aiPlayerIds.has(currentPid) && !this.gameState.paused;

		// During an active AI turn, react quickly so the timer does not appear stuck at ~37s.
		if (aiTurnActive) {
			const fastDelay = 220 + Math.floor(Math.random() * 220);
			this._aiTimer = setTimeout(() => {
				this._aiTimer = null;
				this._runAI();
			}, fastDelay);
			return;
		}
		// Use longer delay if any hard AI is present
		let hasHard = false;
		if (this._aiDifficulty) {
			for (const aiId of this.aiPlayerIds) {
				if (this._aiDifficulty.get(aiId) === 'hard') { hasHard = true; break; }
			}
		}
		const delay = hasHard
			? (900 + Math.floor(Math.random() * 700))   // 0.9-1.6s for hard
			: (700 + Math.floor(Math.random() * 700));  // 0.7-1.4s for normal
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

				const pers = this._aiPersonality?.get(aiId) || 'normal';
				const isAggressive = pers === 'aggressive';
				const isRandom = this._aiDifficulty?.get(aiId) === 'random';
				const playerOrder = Array.isArray(this.gameState.playerOrder) ? this.gameState.playerOrder : [];
				const myOrderIndex = playerOrder.indexOf(aiId);
				const nextPlayerId = myOrderIndex >= 0 ? playerOrder[(myOrderIndex + 1) % Math.max(1, playerOrder.length)] : null;

				// Analyze hand card colors
				const hand = p.hand || [];
				const colorCounts = { yellow: 0, green: 0, blue: 0, red: 0, purple: 0 };
				for (const card of hand) {
					const zones = this.Rules.getAllowedZones(card);
					for (const z of zones) {
						if (colorCounts[z] !== undefined) colorCounts[z]++;
					}
				}
				let dominant = 'yellow';
				let maxCount = 0;
				for (const [zone, count] of Object.entries(colorCounts)) {
					if (count > maxCount) { maxCount = count; dominant = zone; }
				}
				const distinctColors = Object.values(colorCounts).filter(count => count > 0).length;
				const totalCards = Object.values(colorCounts).reduce((sum, count) => sum + count, 0);
				const getPlayerZoneCounts = (playerId) => {
					const player = this.gameState.players?.[playerId];
					const counts = { yellow: 0, green: 0, blue: 0, red: 0, purple: 0 };
					for (const card of (player?.hand || [])) {
						const zones = this.Rules.getAllowedZones(card);
						for (const zone of zones) {
							if (counts[zone] !== undefined) counts[zone]++;
						}
					}
					return counts;
				};

				let bestIdx = 0;
				let bestScore = -Infinity;

				// Random bots just pick a random objective
				if (isRandom) {
					bestIdx = Math.floor(Math.random() * choices.length);
				} else {
				for (let i = 0; i < choices.length; i++) {
					const c = choices[i] || {};
					let score = (c.points || 0) + ((c.coins || 0) * 2) + ((c.randomBonuses || 0) * 3);

					const objId = c.id || '';
					const isSabotage = objId.includes('deny_') || c.dynamicType === 'deny_named_objective';

					// Aggressive bots heavily prefer sabotage
					if (isAggressive && isSabotage) score += 50;
					else if (isAggressive && !isSabotage) score -= 5;

					// Match objectives to dominant hand colors
					if (objId.includes('yellow')) score += (colorCounts.yellow || 0) * 5 + (dominant === 'yellow' ? 10 : 0);
					else if (objId.includes('green')) score += (colorCounts.green || 0) * 5 + (dominant === 'green' ? 10 : 0);
					else if (objId.includes('blue')) score += (colorCounts.blue || 0) * 5 + (dominant === 'blue' ? 10 : 0);
					else if (objId.includes('red')) score += (colorCounts.red || 0) * 5 + (dominant === 'red' ? 10 : 0);
					else if (objId.includes('purple')) score += (colorCounts.purple || 0) * 5 + (dominant === 'purple' ? 10 : 0);

					if (objId.includes('balance_')) {
						const averageCoverage = totalCards > 0 ? totalCards / 5 : 0;
						const spreadPenalty = Object.values(colorCounts).reduce((sum, count) => sum + Math.abs(count - averageCoverage), 0);
						score += distinctColors * 12;
						score -= spreadPenalty * 2.5;
						if (distinctColors >= 4) score += 16;
					}

					if (objId.includes('combo_')) {
						const comboZones = ['yellow', 'green', 'blue', 'red', 'purple'].filter(zone => objId.includes(zone));
						score += comboZones.reduce((sum, zone) => sum + ((colorCounts[zone] || 0) * 4), 0);
						if (comboZones.every(zone => (colorCounts[zone] || 0) > 0)) score += 12;
					}

					if (objId === 'deny_adjacent_green' && nextPlayerId) {
						const nextCounts = getPlayerZoneCounts(nextPlayerId);
						score += Math.max(0, 18 - ((nextCounts.green || 0) * 6));
					}

					if (objId === 'deny_blue_top_anyone') {
						let totalBluePressure = 0;
						for (const pid of playerOrder) totalBluePressure += getPlayerZoneCounts(pid).blue || 0;
						score += Math.max(-18, 24 - (totalBluePressure * 3));
					}

					if (c.dynamicType === 'deny_named_objective') {
						const targetPid = c.targetPlayerId;
						const targetObjectiveId = String(c.targetObjectiveId || '').toLowerCase();
						const targetCounts = targetPid ? getPlayerZoneCounts(targetPid) : null;
						if (targetCounts) {
							for (const zone of ['yellow', 'green', 'blue', 'red', 'purple']) {
								if (!targetObjectiveId.includes(zone)) continue;
								score += Math.max(0, 12 - ((targetCounts[zone] || 0) * 3));
								score += (colorCounts[zone] || 0) * 2;
							}
							if (targetObjectiveId.includes('balance_')) {
								score += distinctColors >= 4 ? 6 : -6;
							}
						}
					}

					if (score > bestScore) { bestScore = score; bestIdx = i; }
				}
				} // end if !isRandom
				const result = this.Rules.chooseObjective(this.gameState, aiId, bestIdx);
				if (!result?.error) {
					changed = true;
					if (result.startedPlaying) this._startTimerForCurrentPlayer(true);
				}
			}

			for (const aiId of this.aiPlayerIds) {
				const p = this.gameState.players?.[aiId];
				if (!p || !p.chosenObjective) continue;
				if (p.goalPerksDone) continue;
				const aiDiff = this._aiDifficulty?.get(aiId);
				const chosenId = aiDiff === 'random'
					? this._aiPickRandomPerk(aiId)
					: this._aiPickPerk(aiId, aiDiff === 'hard');
				const perkChoice = chosenId || '__skip__';
				const perkRes = this.Rules.choosePerk(this.gameState, aiId, perkChoice);
				if (perkRes?.error) continue;
				changed = true;
				if (perkChoice === '__skip__') {
					this._broadcastEvent('botActivity', {
						playerId: aiId,
						playerName: p.name,
						text: '🎯 Klaar met perks'
					});
				} else {
					this._broadcastEvent('botActivity', {
						playerId: aiId,
						playerName: p.name,
						text: `${perkRes?.perk?.icon || '🎯'} Perk: ${perkRes?.perk?.name || chosenId}`
					});
				}
				if (perkRes.startedPlaying) this._startTimerForCurrentPlayer(true);
			}
		}

		if (phase === 'playing' && !this.gameState.paused) {
			const currentPid = this.gameState.playerOrder?.[this.gameState.currentTurnIndex];
			if (currentPid && this.aiPlayerIds.has(currentPid)) {
				// Don't start if already processing an AI turn
				if (this._aiTurnInProgress) return;
				this._aiTurnInProgress = true;
				this._aiTurnPlayerId = currentPid;
				this._clearTimer();
				this._runAITurnAsync(currentPid);
				// Don't set changed — the async queue handles broadcasting
				return;
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
				const isHard = this._aiDifficulty?.get(aiId) === 'hard';
				const isRandomBot = this._aiDifficulty?.get(aiId) === 'random';

				// Geen perk-keuze in shopping: choosePerk is alleen geldig tijdens choosingGoals.

				// Koop shop items met beschikbare coins
				let remainingCoins = p.goldCoins || 0;
				if (remainingCoins >= 1) {
					const claimPendingFreeChoice = () => {
						const choices = p._pendingFreeChoices || [];
						if (!Array.isArray(choices) || choices.length === 0) return false;
						let picked = choices[0];
						if (isRandomBot) {
							picked = choices[Math.floor(Math.random() * choices.length)] || choices[0];
						} else {
							let best = -Infinity;
							for (const c of choices) {
								const cells = c?.matrix ? c.matrix.flat().filter(Boolean).length : 1;
								const score = cells + (c?.isGolden ? 2 : 0) + ((c?.color?.zone === 'any' || c?.color?.name === 'multikleur') ? 2 : 0);
								if (score > best) { best = score; picked = c; }
							}
						}
						const claim = this.Rules.claimFreeCard(this.gameState, aiId, picked.id);
						if (claim && !claim.error) {
							this._broadcastEvent('botActivity', {
								playerId: aiId,
								playerName: p.name,
								text: `🎁 Gratis kaart gekozen: ${picked.shapeName || 'kaart'}`
							});
							changed = true;
							return true;
						}
						return false;
					};

					claimPendingFreeChoice();
					let guard = 0;
					while (remainingCoins >= 1 && guard++ < 16) {
						let boughtSomething = false;

						// 1) Prioriteit: blijvende shop-card offerings (incl. gesloten random offer)
						const offerings = p.shopOfferings || [];
						let bestOffer = null;
						for (let ci = 0; ci < offerings.length; ci++) {
							const card = offerings[ci];
							if (!card) continue;
							const price = card.shopPrice || this.Rules.getCardPrice?.(card) || 2;
							if (price > remainingCoins) continue;
							let value = 10 - price;
							if (card.isRandomOffer) value += 8;
							if (card.isGolden) value += 6;
							if (card.color?.zone === 'any' || card.color?.name === 'multikleur') value += 6;
							const cells = card.matrix ? card.matrix.flat().filter(Boolean).length : 1;
							value += Math.min(6, cells);
							if (isHard) value += 2;
							if (isRandomBot) value += Math.random() * 5;
							if (!bestOffer || value > bestOffer.value) bestOffer = { ci, card, price, value };
						}
						if (bestOffer) {
							const buyResult = this.Rules.buyShopItem(this.gameState, aiId, `shop-card-${bestOffer.ci}`, {});
							if (buyResult && !buyResult.error) {
								console.log(`🛒 Bot ${p.name} bought card from shop (slot ${bestOffer.ci}, cost: ${bestOffer.price})`);
								this._broadcastEvent('botActivity', {
									playerId: aiId,
									playerName: p.name,
									text: `🃏 Kocht blijvende kaart: ${bestOffer.card.shapeName || 'kaart'} (${bestOffer.price} 💰)`
								});
								remainingCoins -= bestOffer.price;
								changed = true;
								boughtSomething = true;
								claimPendingFreeChoice();
							}
						}

						// 2) Daarna reguliere shop-items (incl. unlocks)
						if (!boughtSomething) {
							const shopItems = this.Rules.getShopItems(this.gameState.level || 1, p) || [];
							const affordable = shopItems.filter(item => item.cost <= remainingCoins);
							let bestItem = null;
							for (const item of affordable) {
								let value = 0;
								if (item.unlockOnly) value += 30; // blijvende unlocks eerst
								if (item.id === 'extra-bonus') value += isHard ? 16 : 12;
								if (item.id === 'time-bomb') value += isHard ? 10 : 7;
								if (item.id === 'random-card') value += 5; // tijdelijk, lagere prioriteit
								value -= item.cost * 1.2;
								if (isRandomBot) value += Math.random() * 8;
								if (!bestItem || value > bestItem.value) bestItem = { item, value };
							}
							if (bestItem && bestItem.item) {
								const item = bestItem.item;
								const extra = {};
								if (item.id === 'extra-bonus') {
									const inv = p.bonusInventory || {};
									const colors = ['yellow', 'red', 'green', 'purple', 'blue'];
									if (isRandomBot) {
										extra.bonusColor = colors[Math.floor(Math.random() * colors.length)];
									} else {
										colors.sort((a, b) => (inv[a] || 0) - (inv[b] || 0));
										extra.bonusColor = colors[0];
									}
								}
								const buyResult = this.Rules.buyShopItem(this.gameState, aiId, item.id, extra);
								if (buyResult && !buyResult.error) {
									console.log(`🛒 Bot ${p.name} bought: ${item.id} (cost: ${item.cost}) ${extra.bonusColor ? '→ ' + extra.bonusColor : ''}`);
									this._broadcastEvent('botActivity', {
										playerId: aiId,
										playerName: p.name,
										text: `🛒 Kocht: ${item.name || item.id} (${item.cost} 💰)`
									});
									remainingCoins -= item.cost;
									changed = true;
									boughtSomething = true;
									claimPendingFreeChoice();
								}
							}
						}

						if (!boughtSomething) break;
					}
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

	// ── ASYNC AI TURN — sequential actions with delays and preview ──

	_runAITurnAsync(playerId) {
		const player = this.gameState?.players?.[playerId];
		if (!player) { this._aiTurnInProgress = false; return; }
		this._aiTurnPlayerId = playerId;
		const isHard = this._aiDifficulty?.get(playerId) === 'hard';
		const isRandom = this._aiDifficulty?.get(playerId) === 'random';
		const playerName = player.name || 'Bot';
		const ACTION_DELAY = isHard ? 260 : isRandom ? 500 : 700;
		const BONUS_PREVIEW_DELAY = isHard ? 700 : isRandom ? 850 : 1000;
		const watchdogMs = isHard ? 14000 : 18000;

		const resetWatchdog = () => {
			if (this._aiTurnWatchdog) {
				clearTimeout(this._aiTurnWatchdog);
				this._aiTurnWatchdog = null;
			}
			this._aiTurnWatchdog = setTimeout(() => {
				if (!this.gameState || this.gameState.phase !== 'playing') return;
				const cp = this.gameState.playerOrder?.[this.gameState.currentTurnIndex];
				if (cp !== playerId || this._aiTurnPlayerId !== playerId) return;
				console.warn(`[P2P Host] AI watchdog triggered for ${playerId}; forcing safe endTurn`);
				const forced = this.Rules.endTurn(this.gameState, playerId, null);
				this._aiTurnInProgress = false;
				this._aiTurnPlayerId = null;
				this._aiTurnWatchdog = null;
				this._broadcastState();
				if (forced?.gameEnded) {
					this._broadcastEvent('levelComplete', {
						levelScores: this.gameState.levelScores,
						levelWinner: this.gameState.levelWinner,
						level: this.gameState.level
					});
				} else {
					this._startTimerForCurrentPlayer(true);
					this._scheduleAI();
				}
			}, watchdogMs);
		};

		const recoverAI = (reason) => {
			console.warn(`[P2P Host] AI recovery for ${playerId}: ${reason}`);
			if (this._aiTurnWatchdog) {
				clearTimeout(this._aiTurnWatchdog);
				this._aiTurnWatchdog = null;
			}
			this._aiTurnInProgress = false;
			this._aiTurnPlayerId = null;
			if (!this.gameState || this.gameState.phase !== 'playing') return;
			const currentPid = this.gameState.playerOrder?.[this.gameState.currentTurnIndex];
			if (currentPid === playerId) {
				const safeEnd = this.Rules.endTurn(this.gameState, playerId, null);
				this._broadcastState();
				if (safeEnd?.gameEnded) {
					this._broadcastEvent('levelComplete', {
						levelScores: this.gameState.levelScores,
						levelWinner: this.gameState.levelWinner,
						level: this.gameState.level
					});
				} else {
					this._startTimerForCurrentPlayer(true);
				}
			}
			this._scheduleAI();
		};

		// Build the action queue
		const actions = [];

		// 1. Use mine if has perk and hasn't used it this level
		if (this.Rules.playerHasPerk(player, 'agg_mine') &&
			(player.perks?.minesPerRound || 0) > 0 &&
			(player.perks?.minesUsedThisLevel || 0) < 1) {
			const mineTarget = this._aiFindMineTarget(playerId);
			if (mineTarget) actions.push({ type: 'useMine', ...mineTarget });
		}

		// 2. Steal card if has perk and hasn't used it this level
		if (this.Rules.playerHasPerk(player, 'agg_steal') &&
			(player.perks?.stealsPerRound || 0) > 0 &&
			(player.perks?.stealsUsedThisLevel || 0) < (player.perks?.stealsPerRound || 0)) {
			const stealTarget = this._aiFindStealTarget(playerId);
			if (stealTarget) actions.push({ type: 'stealCard', ...stealTarget });
		}

		// 3. Play card (with preview)
		const bestMove = isRandom ? this._aiFindRandomMove(playerId) : this._aiFindBestMove(playerId, isHard);
		if (bestMove) {
			actions.push({ type: 'previewCard', move: bestMove });
			actions.push({ type: 'playCard', move: bestMove });
		}

		// 4. Play bonuses
		const bonusColors = ['yellow', 'red', 'green', 'purple', 'blue', 'any'];
		for (const color of bonusColors) {
			const charges = player.bonusInventory?.[color] || 0;
			for (let i = 0; i < charges; i++) {
				actions.push({ type: 'playBonus', bonusColor: color });
			}
		}

		// 5. If the bot cannot play a card and has no bonuses, explicitly pass
		// (discard a non-golden card, or forfeit if only golden cards remain)
		const hasBonusTurns = actions.some(a => a.type === 'playBonus');
		if (!bestMove && !hasBonusTurns) {
			const discardCardId = this._aiPickDiscardCard(playerId);
			actions.push({ type: 'pass', discardCardId });
		} else {
			// 6. Normal end turn (card was played or bonuses played)
			actions.push({ type: 'endTurn', discardCardId: null });
		}

		// Start the watchdog AFTER building the action queue (so heavy sync computation doesn't count)
		resetWatchdog();

		// Process actions sequentially with delays
		let idx = 0;
		const processNext = () => {
			try {
			const currentPid = this.gameState?.playerOrder?.[this.gameState?.currentTurnIndex];
			if (currentPid !== playerId || this._aiTurnPlayerId !== playerId) {
				this._aiTurnInProgress = false;
				this._aiTurnPlayerId = null;
				if (this._aiTurnWatchdog) {
					clearTimeout(this._aiTurnWatchdog);
					this._aiTurnWatchdog = null;
				}
				this._scheduleAI();
				return;
			}
			if (!this.gameState || this.gameState.paused) {
				this._aiTurnInProgress = false;
				this._aiTurnPlayerId = null;
				if (this._aiTurnWatchdog) {
					clearTimeout(this._aiTurnWatchdog);
					this._aiTurnWatchdog = null;
				}
				this._scheduleAI();
				return;
			}
			if (idx >= actions.length) {
				this._aiTurnInProgress = false;
				this._aiTurnPlayerId = null;
				if (this._aiTurnWatchdog) {
					clearTimeout(this._aiTurnWatchdog);
					this._aiTurnWatchdog = null;
				}
				this._aiMaybeTaunt(playerId);
				return;
			}

			const action = actions[idx++];

			switch (action.type) {
				case 'choosePerk': {
					const perkResult = this.Rules.choosePerk(this.gameState, playerId, action.perkId);
					if (!perkResult?.error) {
						const perkName = perkResult?.perk?.name || action.perkId;
						const perkIcon = perkResult?.perk?.icon || '🎯';
						console.log(`[AI ${playerName}] 🎯 Perk gekozen: ${perkName}`);
						this._broadcastEvent('botActivity', {
							playerId, playerName,
							text: `${perkIcon} Perk: ${perkName}`
						});
						this._broadcastState();
					}
					resetWatchdog();
					setTimeout(processNext, ACTION_DELAY);
					break;
				}

				case 'useMine': {
					const mineResult = this.Rules.useMine(this.gameState, playerId, action.zoneName, action.cellX, action.cellY);
					if (!mineResult?.error) {
						console.log(`[AI ${playerName}] 💣 Mijn geplaatst op ${action.zoneName} (${action.cellX},${action.cellY})`);
						this._broadcastEvent('botActivity', {
							playerId,
							playerName,
							text: `💣 Mijn geplaatst in ${action.zoneName}`
						});
						this._broadcastState();
					} else {
						console.log(`[AI ${playerName}] Mijn mislukt: ${mineResult.error}`);
					}
					resetWatchdog();
					setTimeout(processNext, ACTION_DELAY);
					break;
				}

				case 'stealCard': {
					const stealResult = this.Rules.stealCard(this.gameState, playerId, action.targetPlayerId, action.cardId);
					if (!stealResult?.error) {
						console.log(`[AI ${playerName}] 🕵️ Kaart gestolen van ${stealResult.targetPlayerName}: ${stealResult.stolenCard?.shapeName}`);
						this._broadcastEvent('botActivity', {
							playerId,
							playerName,
							text: `🕵️ Steel van ${stealResult.targetPlayerName}`
						});
						this._broadcastEvent('cardStolen', {
							thiefId: playerId,
							thiefName: playerName,
							targetId: action.targetPlayerId,
							targetName: stealResult.targetPlayerName,
							cardName: stealResult.stolenCard?.shapeName || '???'
						});
						this._broadcastState();
					} else {
						console.log(`[AI ${playerName}] Steal mislukt: ${stealResult.error}`);
					}
					resetWatchdog();
					setTimeout(processNext, ACTION_DELAY);
					break;
				}

				case 'previewCard': {
					const m = action.move;
					// Broadcast opponent preview (ghost cells)
					this._broadcastEvent('opponentInteraction', {
						playerId,
						playerName,
						type: 'start',
						mode: 'card',
						cardName: m.card?.shapeName || ''
					});
					setTimeout(() => {
						this._broadcastEvent('opponentInteraction', {
							playerId,
							playerName,
							type: 'move',
							mode: 'card',
							zoneName: m.zoneName,
							baseX: m.x,
							baseY: m.y,
							matrix: m.matrix,
							subgridId: m.subgridId,
							isValid: true
						});
						// After showing preview for 1 second, proceed to actual placement
						setTimeout(processNext, 1000);
					}, 300);
					break;
				}

				case 'playCard': {
					const m = action.move;
					// Clear the preview
					this._broadcastEvent('opponentInteraction', { playerId, playerName, type: 'end' });

					const result = this.Rules.playMove(
						this.gameState, playerId, m.card.id, m.zoneName,
						m.x, m.y, m.rotation, !!m.mirrored, m.subgridId
					);
					if (!result?.error) {
						console.log(`[AI ${playerName}] 🃏 Kaart gespeeld: ${m.card.shapeName || m.card.id} op ${m.zoneName} (${m.x},${m.y})`);
						this._broadcastEvent('movePlayed', {
							playerId,
							playerName,
							zoneName: m.zoneName,
							baseX: m.x,
							baseY: m.y,
							rotation: m.rotation,
							mirrored: !!m.mirrored,
							subgridId: m.subgridId || null,
							matrix: m.matrix,
							goldCollected: result.goldCollected || 0,
							bonusesCollected: result.bonusesCollected || [],
							pearlsCollected: result.pearlsCollected || 0,
							objectivesRevealed: this._shouldRevealObjectives(),
							mineTriggered: result.mineTriggered || null
						});
						this._broadcastState();
					} else {
						console.log(`[AI ${playerName}] Kaart mislukt: ${result.error}`);
					}
					resetWatchdog();
					setTimeout(processNext, ACTION_DELAY);
					break;
				}

				case 'playBonus': {
					const previewData = this._aiBonusPreview(playerId, action.bonusColor);
					if (previewData) {
						this._broadcastEvent('bonusPreview', previewData);
						setTimeout(() => {
							// Snapshot bonus inventory before placement to detect chaining
							const invBefore = { ...(this.gameState.players[playerId]?.bonusInventory || {}) };
							const bonusResult = this._aiPlayOneBonus(playerId, action.bonusColor);
							if (bonusResult) {
								const zl = {yellow:'Geel',green:'Groen',blue:'Blauw',red:'Rood',purple:'Paars',any:'Multi'};
								console.log(`[AI ${playerName}] 🎁 Bonus gespeeld: ${action.bonusColor} op ${bonusResult.zoneName}`);
								this._broadcastEvent('botActivity', {
									playerId, playerName,
									text: `🎁 Bonus ${zl[action.bonusColor]||action.bonusColor} → ${zl[bonusResult.zoneName]||bonusResult.zoneName}`
								});
								// Check for bonus chaining: if placement earned new bonus charges, queue them (max 12 total bonus actions)
								const bonusActionsInQueue = actions.filter(a => a.type === 'playBonus').length;
								if (bonusActionsInQueue < 12) {
									const invAfter = this.gameState.players[playerId]?.bonusInventory || {};
									const colors = ['yellow', 'red', 'green', 'purple', 'blue', 'any'];
									for (const col of colors) {
										const gained = (invAfter[col] || 0) - (invBefore[col] || 0) + (col === action.bonusColor ? 1 : 0);
										for (let g = 0; g < gained; g++) {
											actions.splice(idx, 0, { type: 'playBonus', bonusColor: col });
										}
									}
								}
								this._broadcastState();
							}
							resetWatchdog();
							setTimeout(processNext, ACTION_DELAY);
						}, BONUS_PREVIEW_DELAY);
					} else {
						setTimeout(processNext, ACTION_DELAY);
					}
					break;
				}

				case 'endTurn': {
					// 1 second pause before ending turn so the placement is visible
					setTimeout(() => {
						if (!this.gameState) { this._aiTurnInProgress = false; this._aiTurnPlayerId = null; return; }
						const result = this.Rules.endTurn(this.gameState, playerId, null);
						if (result?.error) {
							console.log(`[AI ${playerName}] EndTurn mislukt: ${result.error}`);
							this._aiTurnInProgress = false;
							this._aiTurnPlayerId = null;
							if (this._aiTurnWatchdog) {
								clearTimeout(this._aiTurnWatchdog);
								this._aiTurnWatchdog = null;
							}
							this._scheduleAI();
							return;
						}
						console.log(`[AI ${playerName}] ✅ Beurt beëindigd`);
						if (result?.gameEnded) {
							this._broadcastEvent('levelComplete', {
								levelScores: this.gameState.levelScores,
								levelWinner: this.gameState.levelWinner,
								level: this.gameState.level
							});
						} else {
							this._startTimerForCurrentPlayer(true);
						}
						this._aiTurnInProgress = false;
						this._aiTurnPlayerId = null;
						if (this._aiTurnWatchdog) {
							clearTimeout(this._aiTurnWatchdog);
							this._aiTurnWatchdog = null;
						}
						this._broadcastState();
						this._scheduleAI();
						this._aiMaybeTaunt(playerId);
					}, 1000);
					break;
				}

				case 'pass': {
					// Bot can't play a card and has no bonuses — pass by discarding a non-golden card
					setTimeout(() => {
						if (!this.gameState) { this._aiTurnInProgress = false; this._aiTurnPlayerId = null; return; }
						// Only call passMove if we have a non-golden card to discard
						// (passMove with null cardId would discard index 0, risking a golden card)
						const canPass = !!action.discardCardId;
						const result = canPass
							? this.Rules.passMove(this.gameState, playerId, action.discardCardId)
							: this.Rules.endTurn(this.gameState, playerId, null);
						if (result?.error) {
							console.log(`[AI ${playerName}] Pas mislukt (${result.error})`);
							this._aiTurnInProgress = false;
							this._aiTurnPlayerId = null;
							if (this._aiTurnWatchdog) {
								clearTimeout(this._aiTurnWatchdog);
								this._aiTurnWatchdog = null;
							}
							this._broadcastState();
							this._scheduleAI();
							return;
						}
						console.log(`[AI ${playerName}] ↩️ Gepast (kaart weggegooid)`);
						if (result?.gameEnded) {
							this._broadcastEvent('levelComplete', {
								levelScores: this.gameState.levelScores,
								levelWinner: this.gameState.levelWinner,
								level: this.gameState.level
							});
						} else {
							this._startTimerForCurrentPlayer(true);
						}
						this._aiTurnInProgress = false;
						this._aiTurnPlayerId = null;
						if (this._aiTurnWatchdog) {
							clearTimeout(this._aiTurnWatchdog);
							this._aiTurnWatchdog = null;
						}
						this._broadcastState();
						this._scheduleAI();
					}, 800);
					break;
				}

				default:
					setTimeout(processNext, ACTION_DELAY);
			}
				} catch (err) {
					console.error('[P2P Host] AI processNext crash:', err);
					recoverAI('processNext exception');
				}
		};

		processNext();
	}

	/** Find a random valid card placement (for 'random' difficulty) */
	_aiFindRandomMove(playerId) {
		const player = this.gameState?.players?.[playerId];
		const board = this.gameState?.boardState;
		if (!player || !board) return null;

		const hand = Array.isArray(player.hand) ? player.hand : [];
		const validMoves = [];
		const perkFlags = {
			greenGapAllowed: !!player.perks?.greenGapAllowed,
			redGapAllowed: !!player.perks?.redGapAllowed,
			diagonalRotation: !!player.perks?.diagonalRotation
		};

		// Collect all valid placements (sample up to ~200 to avoid perf issues)
		const MAX_VALID = 200;
		for (const card of hand) {
			if (validMoves.length >= MAX_VALID) break;
			const allowedZones = this.Rules.getAllowedZones(card);
			const rotation = Math.floor(Math.random() * 4);
			const mirrored = Math.random() < 0.5;
			for (const zoneName of allowedZones) {
				if (validMoves.length >= MAX_VALID) break;
				const tryZone = (zoneData, subgridId = null) => {
					if (!zoneData) return;
					for (let rot = 0; rot < 4 && validMoves.length < MAX_VALID; rot++) {
						for (const mir of [false, true]) {
							if (validMoves.length >= MAX_VALID) break;
							let matrix = this.Rules.cloneMatrix(card.matrix);
							matrix = this.Rules.getEnhancedMatrix ? this.Rules.getEnhancedMatrix(matrix, zoneName, perkFlags) : matrix;
							matrix = this.Rules.rotateMatrixN(matrix, rot);
							if (mir) matrix = this.Rules.mirrorMatrix(matrix);
							for (let y = 0; y < (zoneData.rows || 0); y++) {
								for (let x = 0; x < (zoneData.cols || 0); x++) {
									if (validMoves.length >= MAX_VALID) break;
									const cells = this.Rules.collectPlacementCellsData(zoneData, x, y, matrix);
									if (!cells || cells.length === 0) continue;
									if (!this.Rules.validatePlacement(zoneName, zoneData, cells, perkFlags)) continue;
									validMoves.push({ card, zoneName, x, y, rotation: rot, mirrored: mir, subgridId, matrix });
								}
							}
						}
					}
				};
				if (zoneName === 'red') {
					for (const sg of (board.zones?.red?.subgrids || [])) tryZone(sg, sg.id);
				} else {
					tryZone(board.zones?.[zoneName], null);
				}
			}
		}

		if (validMoves.length === 0) return null;
		return validMoves[Math.floor(Math.random() * validMoves.length)];
	}

	/** Find the best card placement for AI */
	_aiFindBestMove(playerId, isHard = false) {
		const player = this.gameState?.players?.[playerId];
		const board = this.gameState?.boardState;
		if (!player || !board) return null;

		const nowMs = () => (typeof performance !== 'undefined' && performance.now)
			? performance.now()
			: Date.now();
		const evalStart = nowMs();
		const evalBudgetMs = isHard ? 220 : 140;
		const maxPlanSims = isHard ? 22 : 0;
		let planSims = 0;
		let stopSearch = false;

		const hand = Array.isArray(player.hand) ? player.hand : [];
		let bestMove = null;
		let bestScore = -Infinity;
		const perkFlags = {
			greenGapAllowed: !!player.perks?.greenGapAllowed,
			redGapAllowed: !!player.perks?.redGapAllowed,
			diagonalRotation: !!player.perks?.diagonalRotation
		};
		// Check if the player has any bonus charges — if so, empty cell placements are even worse
		const inv = player.bonusInventory || {};
		const totalBonuses = Object.values(inv).reduce((s, v) => s + (v || 0), 0);
		const hasBonuses = totalBonuses > 0;

		for (const card of hand) {
			if (stopSearch) break;
			const allowedZones = this.Rules.getAllowedZones(card);
			const rotations = [0, 1, 2, 3];
			const mirrors = [false, true];
			for (const zoneName of allowedZones) {
				if (stopSearch) break;
				const scoreOnZone = (zoneData, subgridId = null) => {
					if (!zoneData) return;
					for (const rotation of rotations) {
						if (stopSearch) break;
						for (const mirrored of mirrors) {
						if (stopSearch) break;
						let matrix = this.Rules.cloneMatrix(card.matrix);
						matrix = this.Rules.getEnhancedMatrix ? this.Rules.getEnhancedMatrix(matrix, zoneName, perkFlags) : matrix;
						matrix = this.Rules.rotateMatrixN(matrix, rotation);
						if (mirrored) matrix = this.Rules.mirrorMatrix(matrix);
						for (let y = 0; y < zoneData.rows; y++) {
							if (stopSearch) break;
							for (let x = 0; x < zoneData.cols; x++) {
								if (stopSearch) break;
								if ((x & 7) === 0 && (nowMs() - evalStart) >= evalBudgetMs) {
									stopSearch = true;
									break;
								}
								const cells = this.Rules.collectPlacementCellsData(zoneData, x, y, matrix);
								if (!cells || cells.length === 0) continue;
								if (!this.Rules.validatePlacement(zoneName, zoneData, cells, perkFlags)) continue;

								// Score this placement
								let score = 0;
								let hasFlaggedCell = false;
								// For blue zone, pre-compute reached bold rows so we can ignore already-scored bold cells
								let blueReachedRows = null;
								let blueBoldSet = null;
								if (zoneName === 'blue') {
									blueReachedRows = this._getReachedBoldRows(zoneData);
									blueBoldSet = new Set(zoneData.boldRows || []);
								}
								for (const c of cells) {
									const cell = this.Rules.getDataCell(zoneData, c.x, c.y);
									if (cell?.flags?.includes('gold')) { score += 8; hasFlaggedCell = true; }
									else if (cell?.flags?.includes('bonus')) { score += 7; hasFlaggedCell = true; }
									else if (cell?.flags?.includes('pearl')) { score += 6; hasFlaggedCell = true; }
									else if (cell?.flags?.includes('end')) { score += 5; hasFlaggedCell = true; }
									else if (cell?.flags?.includes('bold')) {
										// Blue zone bold: only value if this bold row is NOT yet reached
										if (zoneName === 'blue' && blueBoldSet?.has(c.y) && blueReachedRows?.has(c.y)) {
											score += 1; // Already scored row — treat as normal cell
										} else {
											score += 2; hasFlaggedCell = true;
										}
									}
									else { score += 1; }
								}

								// Penalize placements on empty/plain cells unless strategically valuable
								if (!hasFlaggedCell) {
									let hasStrategicValue = false;

									// Adjacency to existing territory = building/connecting
									for (const c of cells) {
										if (this._hasAdjacentActive(zoneData, c.x, c.y)) {
											hasStrategicValue = true;
											break;
										}
									}

									// Zone-specific strategic checks when no adjacency
									if (!hasStrategicValue) {
										if (zoneName === 'blue') {
											// Near unscored bold rows = progressing upward
											const minY = Math.min(...cells.map(c => c.y));
											const nextBold = (zoneData.boldRows || []).filter(by => !blueReachedRows.has(by) && by >= minY - 2 && by <= minY + 2);
											if (nextBold.length > 0) hasStrategicValue = true;
										} else if (zoneName === 'green') {
											// Near unreached end cells
											for (const c of cells) {
												for (const k in zoneData.cells) {
													const ec = zoneData.cells[k];
													if (ec?.flags?.includes('end') && !ec.active) {
														const dist = Math.abs(c.x - (ec.x || 0)) + Math.abs(c.y - (ec.y || 0));
														if (dist <= 3) { hasStrategicValue = true; break; }
													}
												}
												if (hasStrategicValue) break;
											}
										} else if (zoneName === 'yellow') {
											// In columns already partially filled (>30%)
											const colXs = new Set(cells.map(c => c.x));
											for (const cx of colXs) {
												let filled = 0, total = 0;
												for (let cy = 0; cy < (zoneData.rows || 0); cy++) {
													const cc = this.Rules.getDataCell(zoneData, cx, cy);
													if (cc) { total++; if (cc.active) filled++; }
												}
												if (total > 0 && filled / total >= 0.3) { hasStrategicValue = true; break; }
											}
										} else if (zoneName === 'purple') {
											// Near bold cells (even inactive ones — heading toward them)
											for (const c of cells) {
												const neighbors = [
													this.Rules.getDataCell(zoneData, c.x - 1, c.y),
													this.Rules.getDataCell(zoneData, c.x + 1, c.y),
													this.Rules.getDataCell(zoneData, c.x, c.y - 1),
													this.Rules.getDataCell(zoneData, c.x, c.y + 1)
												];
												for (const n of neighbors) {
													if (n?.flags?.includes('bold')) { hasStrategicValue = true; break; }
												}
												if (hasStrategicValue) break;
											}
										} else if (zoneName === 'red') {
											// In a subgrid already partially filled (>30%)
											if (subgridId) {
												const sg = board?.zones?.red?.subgrids?.find(s => s.id === subgridId);
												if (sg) {
													let filled = 0, total = 0;
													for (const k in sg.cells) { total++; if (sg.cells[k]?.active) filled++; }
													if (total > 0 && filled / total >= 0.3) hasStrategicValue = true;
												}
											}
										}
									}

									if (hasStrategicValue) {
										score = Math.max(1, Math.floor(score * (hasBonuses ? 0.3 : 0.5))); // Moderate penalty — on track; stronger when bonuses available
									} else {
										score = Math.max(1, Math.floor(score * (hasBonuses ? 0.05 : 0.15))); // Heavy penalty — wasted cells; near-zero when bonuses available
									}
								}

								// Blue zone: new tier bonus + favor going upward
								if (zoneName === 'blue') {
									const counted = new Set();
									let newTiers = 0;
									for (const c of cells) {
										if (blueBoldSet.has(c.y) && !blueReachedRows.has(c.y) && !counted.has(c.y)) {
											newTiers++;
											counted.add(c.y);
										}
									}
									score += newTiers * 10;
									const minY = Math.min(...cells.map(c => c.y));
									score += Math.max(0, Math.floor(((zoneData.rows || 20) - minY) / 3));
								}

								// Adjacency bonus — both bots prefer extending territory
								for (const c of cells) {
									if (this._hasAdjacentActive(zoneData, c.x, c.y)) score += isHard ? 2 : 1;
								}

								// Hard AI: zone-strategic impact scoring
								if (isHard) {
									score += this._hardZoneBonus(zoneName, zoneData, cells, subgridId, board);
									score += this._objectiveMoveWeight(playerId, zoneName, zoneData, cells, subgridId, hasFlaggedCell);
									const shouldSimulatePlan = (hasBonuses || hasFlaggedCell || score >= 10)
										&& planSims < maxPlanSims
										&& (nowMs() - evalStart) < evalBudgetMs;
									if (shouldSimulatePlan) {
										planSims++;
										const followUpBonusScore = this._estimateHardMoveBonusPlan(playerId, {
											card,
											zoneName,
											x,
											y,
											rotation,
											mirrored,
											subgridId,
											matrix
										});
										if (followUpBonusScore > 0) {
											score += Math.round(followUpBonusScore * 0.6);
										} else if (hasBonuses && !hasFlaggedCell) {
											score -= 12;
										}
									} else if (hasBonuses && !hasFlaggedCell) {
										score -= 6;
									}
								}

								// Blue zone: penalize horizontal-only placements without valuable flags
								if (zoneName === 'blue') {
									const blueYs = new Set(cells.map(c => c.y));
									const blueXs = new Set(cells.map(c => c.x));
									if (blueYs.size === 1 && blueXs.size >= 3 && !hasFlaggedCell) {
										score -= 15; // Strong penalty for horizontal waste
									}
									if (blueYs.size >= 2) score += blueYs.size * 5; // Reward vertical span
								}

								if (score > bestScore) {
									bestScore = score;
									bestMove = { card, zoneName, x, y, rotation, mirrored, subgridId, matrix };
								}
							}
						}
						}
					}
				};

				if (zoneName === 'red') {
					const subgrids = board.zones?.red?.subgrids || [];
					for (const sg of subgrids) {
						scoreOnZone(sg, sg.id);
					}
				} else {
					scoreOnZone(board.zones?.[zoneName], null);
				}
			}
		}

		if (!bestMove) return null;
		return bestMove;
	}

	_evaluateObjectiveState(state, playerId) {
		const player = state?.players?.[playerId];
		const objective = player?.chosenObjective;
		if (!player || !objective || player.objectiveAchieved) {
			return { score: 0, achieved: false, current: 0, target: 0, objective: null };
		}
		const result = this.Rules.checkObjective(state, playerId, objective);
		if (!result || objective.endOnly) {
			return {
				score: 0,
				achieved: !!result?.achieved,
				current: Number(result?.current) || 0,
				target: Number(result?.target) || 0,
				objective
			};
		}
		const current = Math.max(0, Number(result.current) || 0);
		const target = Math.max(1, Number(result.target) || 1);
		let score = (Math.min(current, target) / target) * 24;
		score += Math.min(current, target) * 7;
		if (result.achieved) {
			score += 45;
			score += Math.max(0, Number(result.points) || 0) * 0.6;
			score += Math.max(0, Number(result.coins) || 0) * 3;
			score += Math.max(0, Number(result.randomBonuses) || 0) * 5;
		}
		if (result.failed) score -= 25;
		return { score, achieved: !!result.achieved, current, target, objective };
	}

	_estimateObjectiveProgressGain(beforeState, afterState, playerId) {
		const before = this._evaluateObjectiveState(beforeState, playerId);
		const after = this._evaluateObjectiveState(afterState, playerId);
		return (after.score || 0) - (before.score || 0);
	}

	_objectiveMoveWeight(playerId, zoneName, zoneData, cells, subgridId, hasFlaggedCell) {
		const player = this.gameState?.players?.[playerId];
		const objective = player?.chosenObjective;
		if (!player || !objective || player.objectiveAchieved) return 0;

		const objectiveId = String(objective.id || '').toLowerCase();
		let score = 0;
		const cellCount = Array.isArray(cells) ? cells.length : 0;

		if (objectiveId.includes('yellow') && zoneName === 'yellow') {
			score += 8;
			const touchedColumns = new Set(cells.map(cell => cell.x));
			for (const column of touchedColumns) {
				let filled = 0;
				let total = 0;
				for (let y = 0; y < (zoneData?.rows || 0); y++) {
					const cell = this.Rules.getDataCell(zoneData, column, y);
					if (!cell) continue;
					total++;
					if (cell.active) filled++;
				}
				if (total > 0) score += (filled / total) * 7;
			}
		}

		if (objectiveId.includes('green') && zoneName === 'green') {
			score += 8;
			for (const cell of cells) {
				if (cell.flags?.includes('end')) score += 12;
				const neighbors = [
					this.Rules.getDataCell(zoneData, cell.x - 1, cell.y),
					this.Rules.getDataCell(zoneData, cell.x + 1, cell.y),
					this.Rules.getDataCell(zoneData, cell.x, cell.y - 1),
					this.Rules.getDataCell(zoneData, cell.x, cell.y + 1)
				];
				if (neighbors.some(neighbor => neighbor?.flags?.includes('end'))) score += 4;
			}
		}

		if (objectiveId.includes('deny_blue_top_anyone') && zoneName === 'blue') {
			const highestAdvance = Math.max(...cells.map(cell => Math.max(0, (zoneData?.rows || 0) - cell.y)), 0);
			score -= 6 + (highestAdvance * 0.7);
		}

		if (objectiveId.includes('deny_adjacent_green') && zoneName === 'green') {
			for (const cell of cells) {
				if (cell.flags?.includes('end')) score += 16;
				const neighbors = [
					this.Rules.getDataCell(zoneData, cell.x - 1, cell.y),
					this.Rules.getDataCell(zoneData, cell.x + 1, cell.y),
					this.Rules.getDataCell(zoneData, cell.x, cell.y - 1),
					this.Rules.getDataCell(zoneData, cell.x, cell.y + 1)
				];
				if (neighbors.some(neighbor => neighbor?.flags?.includes('end'))) score += 6;
			}
		}

		if (objectiveId.includes('blue') && !objectiveId.includes('deny_blue_top_anyone') && zoneName === 'blue') {
			score += 8;
			const highestAdvance = Math.max(...cells.map(cell => Math.max(0, (zoneData?.rows || 0) - cell.y)), 0);
			score += highestAdvance * 0.6;
		}

		if (objectiveId.includes('red') && zoneName === 'red') {
			score += 8;
			const subgrid = this.gameState?.boardState?.zones?.red?.subgrids?.find(grid => grid.id === subgridId);
			if (subgrid) {
				const subgridCells = Object.values(subgrid.cells || {});
				const filled = subgridCells.filter(cell => cell?.active).length;
				if (subgridCells.length > 0) score += (filled / subgridCells.length) * 8;
			}
		}

		if (objectiveId.includes('purple') && zoneName === 'purple') {
			score += 8;
			for (const cell of cells) {
				if (cell.flags?.includes('bold')) score += 10;
				const neighbors = [
					this.Rules.getDataCell(zoneData, cell.x - 1, cell.y),
					this.Rules.getDataCell(zoneData, cell.x + 1, cell.y),
					this.Rules.getDataCell(zoneData, cell.x, cell.y - 1),
					this.Rules.getDataCell(zoneData, cell.x, cell.y + 1)
				];
				score += neighbors.filter(neighbor => neighbor?.flags?.includes('bold')).length * 3;
			}
		}

		if (objectiveId.includes('gold') && hasFlaggedCell) {
			score += cells.filter(cell => cell.flags?.includes('gold')).length * 12;
		}

		if (objectiveId.includes('balance_')) {
			const targetScore = objectiveId.includes('15') ? 15 : 10;
			const scoreBreakdown = player.scoreBreakdown || {};
			const zones = ['yellow', 'green', 'blue', 'red', 'purple'];
			let weakestZone = zones[0];
			let weakestValue = Number(scoreBreakdown[weakestZone]) || 0;
			for (const candidateZone of zones.slice(1)) {
				const candidateValue = Number(scoreBreakdown[candidateZone]) || 0;
				if (candidateValue < weakestValue) {
					weakestValue = candidateValue;
					weakestZone = candidateZone;
				}
			}
			const zoneValue = Number(scoreBreakdown[zoneName]) || 0;
			if (zoneName === weakestZone) score += 12;
			if (zoneValue < targetScore) score += Math.max(0, (targetScore - zoneValue) * 1.2);
			else score -= Math.min(10, (zoneValue - targetScore) * 0.7);
		}

		if (objectiveId.includes('deny_named')) {
			const targetObjectiveId = String(objective.targetObjectiveId || '').toLowerCase();
			if (targetObjectiveId.includes(zoneName)) score += 8;
			if (targetObjectiveId.includes('gold') && hasFlaggedCell) {
				score += cells.filter(cell => cell.flags?.includes('gold')).length * 10;
			}
			if (targetObjectiveId.includes('green') && zoneName === 'green') {
				score += cells.filter(cell => cell.flags?.includes('end')).length * 10;
			}
			if (targetObjectiveId.includes('purple') && zoneName === 'purple') {
				score += cells.filter(cell => cell.flags?.includes('bold')).length * 8;
			}
		}

		if (objectiveId.includes('combo_')) score += cellCount * 1.5;
		if (objective.zone && objective.zone === zoneName) score += 6;
		return score;
	}

	_estimateHardMoveBonusPlan(playerId, move) {
		if (!move?.card?.id || !this.gameState) return 0;
		const beforeState = this.gameState;
		const simState = JSON.parse(JSON.stringify(this.gameState));
		const result = this.Rules.playMove(
			simState,
			playerId,
			move.card.id,
			move.zoneName,
			move.x,
			move.y,
			move.rotation,
			!!move.mirrored,
			move.subgridId || null
		);
		if (result?.error) return 0;
		const objectiveGain = this._estimateObjectiveProgressGain(beforeState, simState, playerId);
		return objectiveGain + this._estimateBonusChainValue(simState, playerId, 3);
	}

	_estimateBonusChainValue(state, playerId, maxSteps = 2) {
		if (!state?.players?.[playerId] || maxSteps <= 0) return 0;
		let total = 0;
		for (let step = 0; step < maxSteps; step++) {
			const bestPlacement = this._findBestBonusPlacementForState(state, playerId);
			if (!bestPlacement) break;
			const stepWeight = step === 0 ? 1 : (step === 1 ? 0.8 : 0.65);
			total += Math.round(bestPlacement.score * stepWeight);
			const result = this.Rules.playBonus(
				state,
				playerId,
				bestPlacement.bonusColor,
				bestPlacement.zoneName,
				bestPlacement.baseX,
				bestPlacement.baseY,
				bestPlacement.subgridId || null,
				bestPlacement.rotation || 0
			);
			if (result?.error) break;
		}
		return total;
	}

	_findBestBonusPlacementForState(state, playerId) {
		const player = state?.players?.[playerId];
		const board = state?.boardState;
		if (!player || !board) return null;
		const colors = ['yellow', 'red', 'green', 'purple', 'blue', 'any'];
		let bestPlacement = null;
		let bestScore = -Infinity;
		for (const bonusColor of colors) {
			if (!player.bonusInventory?.[bonusColor] || player.bonusInventory[bonusColor] <= 0) continue;
			const bonusMatrix = this.Rules.getBonusShapeForPlayer(bonusColor, player);
			if (!bonusMatrix) continue;
			const targetZones = bonusColor === 'any'
				? ['yellow', 'green', 'blue', 'red', 'purple']
				: [bonusColor];
			for (const zoneName of targetZones) {
				if (zoneName === 'red') {
					for (const sg of (board.zones?.red?.subgrids || [])) {
						this._scoreBonusPlacements(bonusMatrix, sg, zoneName, sg.id, bonusColor, (placement) => {
							const totalScore = placement.score + this._bonusObjectiveWeight(state, playerId, player, placement);
							if (totalScore > bestScore) {
								bestScore = totalScore;
								bestPlacement = { ...placement, score: totalScore };
							}
						});
					}
				} else {
					const zoneData = board.zones?.[zoneName];
					if (!zoneData) continue;
					this._scoreBonusPlacements(bonusMatrix, zoneData, zoneName, null, bonusColor, (placement) => {
						const totalScore = placement.score + this._bonusObjectiveWeight(state, playerId, player, placement);
						if (totalScore > bestScore) {
							bestScore = totalScore;
							bestPlacement = { ...placement, score: totalScore };
						}
					});
				}
			}
		}
		return bestPlacement;
	}

	_bonusObjectiveWeight(state, playerId, player, placement) {
		const obj = player?.chosenObjective;
		if (!obj || player?.objectiveAchieved || !placement) return 0;
		let score = 0;
		if (obj.zone && obj.zone === placement.zoneName) score += 8;
		if (obj.type === 'density') score += placement.zoneName === 'purple' || placement.zoneName === 'red' ? 4 : 1;
		const simState = JSON.parse(JSON.stringify(state));
		const result = this.Rules.playBonus(
			simState,
			playerId,
			placement.bonusColor,
			placement.zoneName,
			placement.baseX,
			placement.baseY,
			placement.subgridId || null,
			placement.rotation || 0
		);
		if (!result?.error) {
			score += this._estimateObjectiveProgressGain(state, simState, playerId);
		}
		return score;
	}

	/** Play a single bonus of the given color, returns {zoneName} or null */
	_aiPlayOneBonus(playerId, bonusColor) {
		const player = this.gameState?.players?.[playerId];
		const board = this.gameState?.boardState;
		if (!player || !board) return null;

		if (!player.bonusInventory?.[bonusColor] || player.bonusInventory[bonusColor] <= 0) return null;

		const bonusMatrix = this.Rules.getBonusShapeForPlayer(bonusColor, player);
		if (!bonusMatrix) return null;

		// Find best bonus placement
		let bestPlacement = null;
		let bestScore = -Infinity;
		const targetZones = bonusColor === 'any'
			? ['yellow', 'green', 'blue', 'red', 'purple']
			: [bonusColor];

		for (const zoneName of targetZones) {
			if (zoneName === 'red') {
				const subgrids = board.zones?.red?.subgrids || [];
				for (const sg of subgrids) {
					this._scoreBonusPlacements(bonusMatrix, sg, zoneName, sg.id, bonusColor, (p) => {
						const totalScore = p.score + this._bonusObjectiveWeight(this.gameState, playerId, player, p);
						if (totalScore > bestScore) { bestScore = totalScore; bestPlacement = { ...p, score: totalScore }; }
					});
				}
			} else {
				const zoneData = board.zones?.[zoneName];
				if (zoneData) {
					this._scoreBonusPlacements(bonusMatrix, zoneData, zoneName, null, bonusColor, (p) => {
						const totalScore = p.score + this._bonusObjectiveWeight(this.gameState, playerId, player, p);
						if (totalScore > bestScore) { bestScore = totalScore; bestPlacement = { ...p, score: totalScore }; }
					});
				}
			}
		}

		if (!bestPlacement) return null;

		const result = this.Rules.playBonus(
			this.gameState, playerId, bonusColor,
			bestPlacement.zoneName, bestPlacement.baseX, bestPlacement.baseY,
			bestPlacement.subgridId, bestPlacement.rotation || 0
		);
		if (result?.error) {
			console.log(`[AI] Bonus ${bonusColor} mislukt: ${result.error}`);
			return null;
		}
		return { zoneName: bestPlacement.zoneName };
	}

	/** Returns preview data for the best bonus placement without executing it */
	_aiBonusPreview(playerId, bonusColor) {
		const player = this.gameState?.players?.[playerId];
		const board = this.gameState?.boardState;
		if (!player || !board) return null;
		if (!player.bonusInventory?.[bonusColor] || player.bonusInventory[bonusColor] <= 0) return null;

		const bonusMatrix = this.Rules.getBonusShapeForPlayer(bonusColor, player);
		if (!bonusMatrix) return null;

		let bestPlacement = null;
		let bestScore = -Infinity;
		const targetZones = bonusColor === 'any'
			? ['yellow', 'green', 'blue', 'red', 'purple']
			: [bonusColor];

		for (const zoneName of targetZones) {
			if (zoneName === 'red') {
				for (const sg of (board.zones?.red?.subgrids || [])) {
					this._scoreBonusPlacements(bonusMatrix, sg, zoneName, sg.id, bonusColor, (p) => {
						if (p.score > bestScore) { bestScore = p.score; bestPlacement = p; }
					});
				}
			} else {
				const zoneData = board.zones?.[zoneName];
				if (zoneData) {
					this._scoreBonusPlacements(bonusMatrix, zoneData, zoneName, null, bonusColor, (p) => {
						if (p.score > bestScore) { bestScore = p.score; bestPlacement = p; }
					});
				}
			}
		}

		if (!bestPlacement) return null;

		let matrix = this.Rules.cloneMatrix(bonusMatrix);
		if (bestPlacement.rotation) matrix = this.Rules.rotateMatrixN(matrix, bestPlacement.rotation);

		return {
			playerId,
			playerName: player.name,
			bonusColor,
			zoneName: bestPlacement.zoneName,
			baseX: bestPlacement.baseX,
			baseY: bestPlacement.baseY,
			subgridId: bestPlacement.subgridId || null,
			matrix
		};
	}

	/** Pick the card to discard when no valid placement found */
	_aiPickDiscardCard(playerId) {
		const player = this.gameState?.players?.[playerId];
		if (!player) return null;
		const regularCards = (player.hand || []).filter(c => !c.isGolden);
		if (regularCards.length === 0) return null;
		return regularCards[0].id;
	}

	/** Pick a random perk for the 'random' difficulty AI */
	_aiPickRandomPerk(playerId) {
		const player = this.gameState?.players?.[playerId];
		if (!player?.perks || (player.perks.perkPoints || 0) < 1) return null;
		const available = this.Rules.getAvailablePerks(player) || [];
		if (available.length === 0) return null;
		return available[Math.floor(Math.random() * available.length)]?.id || null;
	}

	/** Pick a perk for the AI (returns perkId or null) */
	_aiPickPerk(playerId, isHard = false) {
		const player = this.gameState?.players?.[playerId];
		if (!player?.perks || (player.perks.perkPoints || 0) < 1) return null;
		const available = this.Rules.getAvailablePerks(player) || [];
		if (available.length === 0) return null;
		const personality = this._aiPersonality?.get(playerId) || 'normal';
		const isAggressive = personality === 'aggressive';

		// Global random branch for variety
		if (Math.random() < (isHard ? 0.25 : 0.30)) {
			return available[Math.floor(Math.random() * available.length)]?.id || null;
		}

		const candidates = [];
		const addIfAvailable = (id, weight) => {
			if (available.find(p => p.id === id)) candidates.push({ id, weight });
		};

		if (isAggressive || isHard) {
			addIfAvailable('agg_steal', 14);
			addIfAvailable('agg_stone', 11);
			if (Math.random() < 0.35) addIfAvailable('agg_mine', 1);
			addIfAvailable('flex_wildcard', 10);
			addIfAvailable('flex_double_coins', 9);
			addIfAvailable('flex_gap', 8);
			addIfAvailable('flex_gap_red', 8);
			addIfAvailable('flex_rotate', 8);
			addIfAvailable('bonus_multi_double', 8);
		} else {
			addIfAvailable('bonus_multi_double', 12);
			addIfAvailable('flex_wildcard', 10);
			addIfAvailable('flex_double_coins', 9);
			addIfAvailable('flex_gap', 8);
			addIfAvailable('flex_rotate', 8);
			addIfAvailable('flex_gap_red', 7);
			addIfAvailable('agg_stone', 4);
			if (Math.random() < 0.30) addIfAvailable('agg_mine', 1);
			addIfAvailable('agg_steal', 3);
		}

		addIfAvailable('bonus_yellow', 6);
		addIfAvailable('bonus_red', 6);
		addIfAvailable('bonus_green', 6);
		addIfAvailable('bonus_purple', 6);
		addIfAvailable('bonus_blue', 6);

		if (candidates.length === 0) {
			return available[Math.floor(Math.random() * available.length)]?.id || null;
		}

		const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
		let roll = Math.random() * totalWeight;
		for (const c of candidates) {
			roll -= c.weight;
			if (roll <= 0) return c.id;
		}
		return candidates[candidates.length - 1]?.id || null;
	}

	/** Find a good mine target (empty cell in opponent's likely zone) */
	_aiFindMineTarget(playerId) {
		const board = this.gameState?.boardState;
		if (!board) return null;
		const candidates = [];
		const pushCandidate = (zoneName, zoneData) => {
			if (!zoneData) return;
			for (let y = 0; y < (zoneData.rows || 0); y++) {
				for (let x = 0; x < (zoneData.cols || 0); x++) {
					const cell = this.Rules.getDataCell(zoneData, x, y);
					if (!cell || cell.active) continue;
					if (cell.flags?.includes('void')) continue;
					let score = 1;
					if (cell.flags?.includes('bonus')) score += 18;
					if (cell.flags?.includes('gold')) score += 12;
					if (cell.flags?.includes('bold')) score += 9;
					if (cell.flags?.includes('end')) score += 8;
					if (cell.flags?.includes('portal')) score += 6;
					if (this._hasAdjacentActive(zoneData, x, y)) score += 5;
					score += Math.random() * 3;
					candidates.push({ zoneName, cellX: x, cellY: y, score });
				}
			}
		};
		for (const zoneName of ['yellow', 'green', 'blue', 'purple']) {
			pushCandidate(zoneName, board.zones?.[zoneName]);
		}
		for (const sg of (board.zones?.red?.subgrids || [])) {
			pushCandidate('red', sg);
		}
		if (candidates.length === 0) return null;
		candidates.sort((a, b) => b.score - a.score);
		const top = candidates.slice(0, Math.min(14, candidates.length));
		const picked = top[Math.floor(Math.random() * top.length)];
		if (picked) return { zoneName: picked.zoneName, cellX: picked.cellX, cellY: picked.cellY };
		return null;
	}

	/** Find a target to steal a card from */
	_aiFindStealTarget(playerId) {
		const players = this.gameState?.players || {};
		const candidates = [];
		for (const pid of Object.keys(players)) {
			if (pid === playerId) continue;
			const target = players[pid];
			if (!target) continue;
			const stealable = (target.hand || []).filter(c => !c.isGolden && !c.isStone);
			if (stealable.length > 0) {
				for (const card of stealable) {
					const count = card.matrix ? card.matrix.flat().filter(v => v > 0).length : 0;
					const score = (count * 3) + Math.random() * 4;
					candidates.push({ targetPlayerId: pid, cardId: card.id, score });
				}
			}
		}
		if (candidates.length === 0) return null;
		candidates.sort((a, b) => b.score - a.score);
		const top = candidates.slice(0, Math.min(8, candidates.length));
		return top[Math.floor(Math.random() * top.length)] || null;
		return null;
	}

	_scoreBonusPlacements(bonusMatrix, zoneData, zoneName, subgridId, bonusColor, onFound) {
		if (!zoneData) return;
		const rotations = [0, 1, 2, 3];
		for (const rotation of rotations) {
			let matrix = this.Rules.cloneMatrix(bonusMatrix);
			matrix = this.Rules.rotateMatrixN(matrix, rotation);
			for (let y = 0; y < (zoneData.rows || 0); y++) {
				for (let x = 0; x < (zoneData.cols || 0); x++) {
					const cells = this.Rules.collectPlacementCellsData(zoneData, x, y, matrix);
					if (!cells || cells.length === 0) continue;
					if (!this.Rules.validatePlacement(zoneName, zoneData, cells, {})) continue;
					let score = cells.length;
					let bonusCount = 0;
					let valueCount = 0;
					for (const c of cells) {
						const cell = this.Rules.getDataCell(zoneData, c.x, c.y);
						if (cell?.flags?.includes('gold')) { score += 14; valueCount++; }
						if (cell?.flags?.includes('bonus')) { bonusCount++; score += 34; valueCount++; }
						if (cell?.flags?.includes('bold')) score += 5;
						if (cell?.flags?.includes('pearl')) { score += 9; valueCount++; }
						if (cell?.flags?.includes('end')) { score += 8; valueCount++; }
						if (this._hasAdjacentActive(zoneData, c.x, c.y)) score += 2;
					}
					// Extra scaling for multi-bonus grabs
					if (bonusCount >= 2) score += bonusCount * 15;
					if (bonusCount >= 3) score += 25;
					if (valueCount >= 2) score += valueCount * 4;
					if (bonusColor === 'any') score += 2;
					onFound({ zoneName, baseX: x, baseY: y, rotation, subgridId, score, bonusColor });
				}
			}
		}
	}

	_hardZoneBonus(zoneName, zoneData, cells, subgridId, board) {
		let bonus = 0;
		if (zoneName === 'yellow') {
			// Favor column completion
			const colXs = new Set(cells.map(c => c.x));
			for (const colX of colXs) {
				let filled = 0, total = 0;
				for (let y = 0; y < (zoneData.rows || 0); y++) {
					const cell = this.Rules.getDataCell(zoneData, colX, y);
					if (cell) { total++; if (cell.active) filled++; }
				}
				const newFilled = filled + cells.filter(c => c.x === colX).length;
				if (newFilled >= total) bonus += 8;
				else if (filled / Math.max(total, 1) > 0.6) bonus += 3;
			}
		} else if (zoneName === 'green') {
			for (const c of cells) {
				const cell = this.Rules.getDataCell(zoneData, c.x, c.y);
				if (cell?.flags?.includes('end')) bonus += 12;
				// Proximity to end cells
				const endCells = zoneData.endCells || [];
				for (const ec of endCells) {
					const dist = Math.abs(c.x - ec.x) + Math.abs(c.y - ec.y);
					if (dist <= 2) bonus += 4;
					else if (dist <= 4) bonus += 1;
				}
			}
		} else if (zoneName === 'blue') {
			// Hard AI blue: reward gold/bonus/pearl cells extra
			for (const c of cells) {
				const cell = this.Rules.getDataCell(zoneData, c.x, c.y);
				if (cell?.flags?.includes('gold')) bonus += 5;
				else if (cell?.flags?.includes('bonus')) bonus += 4;
				else if (cell?.flags?.includes('pearl')) bonus += 4;
			}
			// Favor going upward (already scored new tiers in base scoring)
			const minY = Math.min(...cells.map(c => c.y));
			bonus += Math.max(0, Math.floor(((zoneData.rows || 20) - minY) / 3));
		} else if (zoneName === 'red' && subgridId) {
			const sg = board?.zones?.red?.subgrids?.find(s => s.id === subgridId);
			if (sg) {
				let filled = 0, total = 0;
				const sgCells = sg.cells || {};
				for (const key in sgCells) { total++; if (sgCells[key]?.active) filled++; }
				const newRatio = (filled + (cells.length || 1)) / Math.max(total, 1);
				const oldRatio = filled / Math.max(total, 1);
				if (newRatio >= 0.8 && oldRatio < 0.8) bonus += 15;
				else if (newRatio >= 1.0) bonus += 10;
				else if (oldRatio >= 0.5) bonus += 4;
			}
		} else if (zoneName === 'purple') {
			for (const c of cells) {
				if (this._hasAdjacentActive(zoneData, c.x, c.y)) bonus += 2;
				const cell = this.Rules.getDataCell(zoneData, c.x, c.y);
				if (cell?.flags?.includes('bold')) bonus += 3;
			}
		}
		return bonus;
	}

	/** Check if any orthogonal neighbor of (x,y) is active in zoneData */
	_hasAdjacentActive(zoneData, x, y) {
		const neighbors = [
			this.Rules.getDataCell(zoneData, x - 1, y),
			this.Rules.getDataCell(zoneData, x + 1, y),
			this.Rules.getDataCell(zoneData, x, y - 1),
			this.Rules.getDataCell(zoneData, x, y + 1)
		];
		return neighbors.some(n => n && n.active && !n.isStone);
	}

	/** Returns a Set of bold row Y-values that already have at least one active bold cell */
	_getReachedBoldRows(zoneData) {
		const reached = new Set();
		for (const boldY of (zoneData.boldRows || [])) {
			for (let x = 0; x < (zoneData.cols || 0); x++) {
				const cell = this.Rules.getDataCell(zoneData, x, boldY);
				if (cell?.active && cell?.flags?.includes('bold')) {
					reached.add(boldY);
					break;
				}
			}
		}
		return reached;
	}

	_aiMaybeTaunt(playerId) {
		const player = this.gameState?.players?.[playerId];
		if (!player) return;

		const pers = this._aiPersonality?.get(playerId) || 'normal';
		const isAggressive = pers === 'aggressive';
		// Aggressive bots taunt ~25%, normal ~8%
		const chance = isAggressive ? 0.25 : 0.08;
		if (Math.random() > chance) return;

		const aggroPool = ['fuck off', 'your mum', 'cheater', 'HAHA', 'Nooo!'];
		const normalPool = ['Nooo!', 'HAHA', 'Well played!', 'Oeps...', 'Kom op!', 'cheater', 'fuck off', 'your mum'];
		const pool = isAggressive ? aggroPool : normalPool;
		const text = pool[Math.floor(Math.random() * pool.length)];

		this._broadcastEvent('taunt', {
			playerId,
			playerName: player.name,
			text,
			timestamp: Date.now()
		});
	}

	// Keep legacy method name as alias
	_aiPlayCardIfPossible(playerId) {
		return this._aiPlayCardWithScoring(playerId);
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
			// Running AI chain is stale once the timer forces a turn end.
			this._aiTurnInProgress = false;
			this._aiTurnPlayerId = null;
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
		if (this._aiTurnWatchdog) {
			clearTimeout(this._aiTurnWatchdog);
			this._aiTurnWatchdog = null;
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
		this.onBonusPreview = null;
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
			case 'bonusPreview': if (this.onBonusPreview) this.onBonusPreview(data); break;
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
			redGapAllowed: !!player?.perks?.redGapAllowed,
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
		try {
			sessionStorage.removeItem('locus_p2p_role');
			sessionStorage.removeItem('locus_p2p_roomCode');
			sessionStorage.removeItem('locus_p2p_playerId');
			sessionStorage.removeItem('locus_p2p_userName');
			sessionStorage.removeItem('locus_p2p_state');
		} catch (_) {}
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
