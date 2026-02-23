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

		// Genereer room code
		this.roomCode = this._generateRoomCode();
		const peerId = `locus-${this.roomCode}`;

		return new Promise((resolve, reject) => {
			// PeerJS met gratis cloud signaling
			this.peer = new Peer(peerId, {
				debug: 1,
				config: {
					iceServers: [
						{ urls: 'stun:stun.l.google.com:19302' },
						{ urls: 'stun:stun1.l.google.com:19302' }
					]
				}
			});

			this.peer.on('open', (id) => {
				console.log('[P2P Host] Peer geopend:', id);

				// Maak game state aan
				this.hostPlayerId = 'P_host_' + Date.now().toString(36);
				const seed = Date.now() + Math.floor(Math.random() * 100000);

				this.gameState = this.Rules.createGameState(
					'p2p-' + this.roomCode,
					this.hostPlayerId,
					{
						seed,
						maxPlayers: options.maxPlayers || 4,
						cardsPerPlayer: options.cardsPerPlayer || 8,
						handSize: 3
					}
				);

				// Voeg host toe als speler
				this.Rules.addPlayer(this.gameState, this.hostPlayerId, playerName);
				this.gameState.inviteCode = this.roomCode;

				resolve({ roomCode: this.roomCode, hostPlayerId: this.hostPlayerId });
			});

			this.peer.on('connection', (conn) => this._handleConnection(conn));

			this.peer.on('error', (err) => {
				console.error('[P2P Host] Peer error:', err);
				if (this.onError) this.onError(err.message || 'P2P verbinding mislukt');
				reject(err);
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
						this._startTimerForCurrentPlayer();
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
			case 'joinGame': {
				const name = String(msg.playerName || 'Speler').slice(0, 20);
				const reconnectPlayerId = msg.reconnectPlayerId ? String(msg.reconnectPlayerId) : null;
				if (reconnectPlayerId && this.gameState.players[reconnectPlayerId]) {
					const reconnectPlayer = this.gameState.players[reconnectPlayerId];
					if (reconnectPlayer.connected === false) {
						reconnectPlayer.connected = true;
						if (name) reconnectPlayer.name = name;
						this.playerMap.set(conn.peer, reconnectPlayerId);
						conn.send({ type: 'joinResult', success: true, playerId: reconnectPlayerId, roomCode: this.roomCode, reconnected: true });
						this._broadcastState();
						break;
					}
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
				if (result.allChosen) this._startTimerForCurrentPlayer();
				this._broadcastState();
				break;
			}

			case 'playMove': {
				if (!playerId) return;
				const result = this.Rules.playMove(
					this.gameState, playerId, msg.cardId, msg.zoneName,
					msg.baseX, msg.baseY, msg.rotation || 0, !!msg.mirrored, msg.subgridId || null
				);
				conn.send({ type: 'result', action: 'playMove', ...result });
				if (result.success) {
					this._broadcastEvent('movePlayed', { playerId, zoneName: msg.zoneName });
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
					this._startTimerForCurrentPlayer();
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
					this._startTimerForCurrentPlayer();
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
					this._startTimerForCurrentPlayer();
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
				if (!result.gameEnded) this._startTimerForCurrentPlayer();
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
					if (this.gameState.phase === 'playing') this._startTimerForCurrentPlayer();
				} else {
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
			case 'startGame':
				result = this.Rules.startGame(this.gameState);
				break;
			case 'chooseStartingDeck':
				result = this.Rules.chooseStartingDeck(this.gameState, playerId, data.deckType);
				break;
			case 'chooseGoal':
				result = this.Rules.chooseObjective(this.gameState, playerId, data.objectiveIndex);
				if (result.allChosen) this._startTimerForCurrentPlayer();
				break;
			case 'playMove':
				result = this.Rules.playMove(this.gameState, playerId, data.cardId, data.zoneName,
					data.baseX, data.baseY, data.rotation || 0, !!data.mirrored, data.subgridId || null);
				if (result.success) this._broadcastEvent('movePlayed', { playerId, zoneName: data.zoneName });
				break;
			case 'playBonus':
				result = this.Rules.playBonus(this.gameState, playerId, data.bonusColor, data.zoneName,
					data.baseX, data.baseY, data.subgridId || null, data.rotation || 0);
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
					this._startTimerForCurrentPlayer();
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
					this._startTimerForCurrentPlayer();
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
			case 'shopReady':
				result = this.Rules.shopReady(this.gameState, playerId);
				if (result.allReady) {
					this.Rules.startNextLevel(this.gameState);
					this._broadcastEvent('nextLevelStarted', { level: this.gameState.level });
				}
				if (result.allReady && this.gameState.phase === 'playing') {
					this._startTimerForCurrentPlayer();
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
				if (!result?.gameEnded) this._startTimerForCurrentPlayer();
				break;
			case 'togglePause': {
				// Host toggled pause
				if (this.gameState.paused) {
					this.gameState.paused = false;
					this.gameState.pausedBy = null;
					this.gameState.pausedAt = null;
					if (this.gameState.phase === 'playing') this._startTimerForCurrentPlayer();
				} else {
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

	// ── Sanitize state per speler (verberg andermans kaarten) ──

	_sanitizeForPlayer(playerId) {
		const sanitized = JSON.parse(JSON.stringify(this.gameState));
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
				if (sanitized.players[pid].chosenObjective) {
					sanitized.players[pid].chosenObjective = { hidden: true };
				}
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

	_startTimerForCurrentPlayer() {
		this._clearTimer();
		if (!this.gameState || this.gameState.phase !== 'playing') return;

		const currentPid = this.gameState.playerOrder[this.gameState.currentTurnIndex];
		if (!currentPid) return;

		this._turnTimerStart = Date.now();
		this.gameState._turnTimerStart = this._turnTimerStart;
		this.gameState._turnTimerDurationMs = this._turnTimerDuration;
		this.gameState._turnTimerRemainingMs = this._turnTimerDuration;

		this._turnTimer = setTimeout(() => {
			// Auto-end turn
			const result = this.Rules.endTurn(this.gameState, currentPid);
			console.log(`[P2P Host] Timer verlopen voor ${currentPid}`);
			this._broadcastState();
			if (result.gameEnded) {
				this._broadcastEvent('levelComplete', {
					levelScores: this.gameState.levelScores,
					levelWinner: this.gameState.levelWinner,
					level: this.gameState.level
				});
			} else {
				this._startTimerForCurrentPlayer();
			}
		}, this._turnTimerDuration);
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
	async setShopReady() { return this._sendCommand('shopReady'); }
	async useTimeBomb() { return this._sendCommand('useTimeBomb'); }
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

	previewPlacement(zoneName, baseX, baseY, matrix, subgridId) {
		if (!this.gameState?.boardState) return { valid: false };
		const Rules = window.LocusGameRules;
		if (!Rules) return { valid: false };
		let zoneData;
		if (zoneName === 'red') {
			const subgridsToCheck = subgridId
				? (this.gameState.boardState.zones.red?.subgrids || []).filter(sg => sg.id === subgridId)
				: (this.gameState.boardState.zones.red?.subgrids || []);
			for (const sg of subgridsToCheck) {
				const cells = Rules.collectPlacementCellsData(sg, baseX, baseY, matrix);
				if (cells) {
					const valid = Rules.validatePlacement(zoneName, sg, cells);
					return { valid, cells };
				}
			}
			return { valid: false };
		}
		zoneData = this.gameState.boardState.zones[zoneName];
		if (!zoneData) return { valid: false };
		const cells = Rules.collectPlacementCellsData(zoneData, baseX, baseY, matrix);
		if (!cells) return { valid: false };
		const valid = Rules.validatePlacement(zoneName, zoneData, cells);
		return { valid, cells };
	}

	disconnect() {
		if (this.connection) { try { this.connection.close(); } catch (e) { /* */ } }
		if (this.peer) { this.peer.destroy(); this.peer = null; }
		this.gameState = null;
		this.userId = null;
		this.connected = false;
	}
}

// Browser globals
if (typeof window !== 'undefined') {
	window.LocusP2PHost = LocusP2PHost;
	window.LocusP2PGuest = LocusP2PGuest;
}
