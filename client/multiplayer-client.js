/**
 * ============================================================
 * LOCUS MULTIPLAYER — Frontend Client Adapter (Socket.IO)
 * ============================================================
 * Verbindt de browser UI met de eigen Node.js server via
 * Socket.IO. Geen Firebase nodig!
 *
 * Laad dit script NA socket.io.js en game-rules.js.
 *
 * Gebruik:
 *   const mp = new LocusMultiplayer();
 *   await mp.init();
 *   await mp.createGame('MijnNaam', { maxPlayers: 4 });
 * ============================================================
 */

class LocusMultiplayer {
	constructor(serverUrl) {
		// Server URL — standaard zelfde host als de pagina
		this.serverUrl = serverUrl || window.location.origin;
		this.socket = null;
		this.userId = null;   // = playerId van de server
		this.userName = null;
		this.gameId = null;
		this.inviteCode = null;
		this.gameState = null;
		this.connected = false;

		// Callbacks die de UI kan registreren
		this.onGameStateChanged = null;   // (gameState) => {}
		this.onPlayerJoined = null;        // (player) => {}
		this.onPlayerLeft = null;          // (playerId) => {}
		this.onTurnChanged = null;         // (currentPlayerId, turnCount) => {}
		this.onGameStarted = null;         // (gameState) => {}
		this.onGameEnded = null;           // (finalScores, winner) => {}
		this.onGoalPhase = null;           // (choices) => {}
		this.onError = null;               // (error) => {}
		this.onConnectionChanged = null;   // (connected) => {}
		this.onMovePlayed = null;          // ({ playerId, zoneName, goldCollected, bonusesCollected, playerName, cardsPlayed, objectivesRevealed }) => {}
		this.onLevelComplete = null;       // (levelScores, levelWinner, level) => {}
		this.onShopPhase = null;           // (shopItems) => {}
		this.onNextLevel = null;           // (level) => {}
		this.onObjectivesRevealed = null;  // () => {} — wanneer geheime doelstellingen onthuld worden
		this.onTimeBombed = null;          // ({ bomberPlayerId, bomberPlayerName, bombedPlayerId, bombedPlayerName }) => {}
		this.onOpponentInteraction = null; // ({ playerId, playerName, type, mode, ... }) => {}
		this.onTaunt = null;               // ({ playerId, playerName, text, timestamp }) => {}
		this.onPauseChanged = null;        // ({ paused, playerId, playerName, remainingMs }) => {}
	}

	// ──────────────────────────────────────────
	//  INITIALISATIE
	// ──────────────────────────────────────────

	async init() {
		try {
			this.socket = io(this.serverUrl, {
				transports: ['websocket', 'polling'],
				reconnection: true,
				reconnectionDelay: 1000,
				reconnectionAttempts: 10
			});

			// Wacht tot verbinding er is
			await new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error('Verbinding mislukt — is de server aan?'));
				}, 8000);

				this.socket.on('connect', () => {
					clearTimeout(timeout);
					this.connected = true;
					console.log('[Locus MP] Verbonden met server, socket:', this.socket.id);
					if (this.onConnectionChanged) this.onConnectionChanged(true);
					resolve();
				});

				this.socket.on('connect_error', (err) => {
					clearTimeout(timeout);
					reject(new Error('Kan niet verbinden met server: ' + err.message));
				});
			});

			// Registreer listeners
			this._registerSocketListeners();

			// Auto-reconnect: check sessionStorage voor bestaande sessie
			const savedGameId = sessionStorage.getItem('locus_gameId');
			const savedPlayerId = sessionStorage.getItem('locus_playerId');
			const savedUserName = sessionStorage.getItem('locus_userName');

			if (savedGameId && savedPlayerId) {
				try {
					const result = await this._emitWithAck('reconnect', {
						gameId: savedGameId,
						playerId: savedPlayerId
					});

					if (result.success) {
						this.gameId = savedGameId;
						this.userId = savedPlayerId;
						this.userName = savedUserName || 'Speler';
						this.inviteCode = result.inviteCode || null;
						console.log('[Locus MP] Auto-reconnect geslaagd');
						return { userId: this.userId, reconnected: true };
					}
				} catch (err) {
					console.warn('[Locus MP] Auto-reconnect mislukt:', err.message);
					sessionStorage.removeItem('locus_gameId');
					sessionStorage.removeItem('locus_playerId');
					sessionStorage.removeItem('locus_userName');
				}
			}

			return { userId: this.socket.id };

		} catch (error) {
			console.error('[Locus MP] Init failed:', error);
			if (this.onError) this.onError(error);
			throw error;
		}
	}

	_registerSocketListeners() {
		// Game state updates van server
		this.socket.on('gameState', (state) => {
			const prevState = this.gameState;
			this.gameState = state;

			if (this.onGameStateChanged) {
				this.onGameStateChanged(state, prevState);
			}

			// Detecteer fase-overgangen
			if (prevState?.phase !== state.phase) {
				switch (state.phase) {
					case 'choosingGoals':
						if (this.onGoalPhase) {
							const choices = state.objectiveChoices?.[this.userId] || [];
							this.onGoalPhase(choices);
						}
						break;
					case 'playing':
						if (this.onGameStarted) {
							this.onGameStarted(state);
						}
						break;
					case 'levelComplete':
						// Afgehandeld via _onGameStateChanged en apart 'levelComplete' event
						break;
					case 'shopping':
						// Afgehandeld via _onGameStateChanged
						break;
					case 'ended':
						if (this.onGameEnded) {
							this.onGameEnded(state.finalScores, state.winner);
						}
						break;
				}
			}

			// Detecteer beurt-veranderingen
			const turnChanged = state.phase === 'playing' && (
				prevState?.currentTurnIndex !== state.currentTurnIndex ||
				prevState?.turnCount !== state.turnCount
			);
			if (turnChanged) {
				const currentPid = state.playerOrder[state.currentTurnIndex];
				if (this.onTurnChanged) {
					this.onTurnChanged(currentPid, state.turnCount);
				}
			}
		});

		// Nieuwe speler gejoind
		this.socket.on('playerJoined', (player) => {
			if (this.onPlayerJoined) {
				this.onPlayerJoined(player);
			}
		});

		// Speler disconnected
		this.socket.on('playerDisconnected', (data) => {
			if (this.onPlayerLeft) {
				this.onPlayerLeft(data.playerId);
			}
		});

		// Move played event (voor animaties bij andere spelers)
		this.socket.on('movePlayed', (data) => {
			if (this.onMovePlayed) {
				this.onMovePlayed(data);
			}
			// Check of objectives net onthuld zijn
			if (data.objectivesRevealed && this.onObjectivesRevealed) {
				this.onObjectivesRevealed();
			}
		});

		// Level complete event (aanvullend op gameState phase detection)
		this.socket.on('levelComplete', (data) => {
			// Skip als we al in levelComplete fase zitten (al afgehandeld door gameState)
			if (this.gameState?.phase === 'levelComplete') return;
			if (this.onLevelComplete) {
				this.onLevelComplete(data.levelScores, data.levelWinner, data.level);
			}
		});

		// Next level started
		this.socket.on('nextLevelStarted', (data) => {
			if (this.onNextLevel) {
				this.onNextLevel(data.level);
			}
		});

		// Game ended event (final)
		this.socket.on('gameEnded', (data) => {
			if (this.onGameEnded) {
				this.onGameEnded(data.finalScores, data.winner);
			}
		});

		// Time bomb event
		this.socket.on('timeBombUsed', (data) => {
			if (this.onTimeBombed) {
				this.onTimeBombed(data);
			}
		});

		// Live interactie van tegenstander (kaart selecteren / slepen)
		this.socket.on('opponentInteraction', (data) => {
			if (this.onOpponentInteraction) {
				this.onOpponentInteraction(data);
			}
		});

		this.socket.on('taunt', (data) => {
			if (this.onTaunt) {
				this.onTaunt(data);
			}
		});

		this.socket.on('pauseChanged', (data) => {
			if (this.onPauseChanged) {
				this.onPauseChanged(data);
			}
		});

		// Reconnect handling
		this.socket.on('disconnect', () => {
			this.connected = false;
			console.log('[Locus MP] Verbinding verloren');
			if (this.onConnectionChanged) this.onConnectionChanged(false);
		});

		this.socket.on('reconnect', () => {
			this.connected = true;
			console.log('[Locus MP] Herverbonden');
			if (this.onConnectionChanged) this.onConnectionChanged(true);

			// Probeer terug te joinen als we in een game zaten
			if (this.gameId && this.userId) {
				this._emitWithAck('reconnect', {
					gameId: this.gameId,
					playerId: this.userId
				}).then(result => {
					if (result.success) {
						console.log('[Locus MP] Herverbonden met game');
					}
				}).catch(err => {
					console.error('[Locus MP] Reconnect met game mislukt:', err);
				});
			}
		});
	}

	// ──────────────────────────────────────────
	//  HELPER: emit met callback als Promise
	// ──────────────────────────────────────────

	_emitWithAck(event, data) {
		return new Promise((resolve, reject) => {
			if (!this.socket || !this.connected) {
				return reject(new Error('Niet verbonden met server.'));
			}

			const timeout = setTimeout(() => {
				reject(new Error('Server reageert niet (timeout).'));
			}, 10000);

			this.socket.emit(event, data, (response) => {
				clearTimeout(timeout);
				if (response.success) {
					resolve(response);
				} else {
					reject(new Error(response.error || 'Onbekende fout'));
				}
			});
		});
	}

	// ──────────────────────────────────────────
	//  GAME LIFECYCLE
	// ──────────────────────────────────────────

	/** Maak een nieuw spel aan */
	async createGame(playerName, options = {}) {
		try {
			this.userName = playerName;
			const result = await this._emitWithAck('createGame', {
				playerName,
				maxPlayers: options.maxPlayers || 4,
				cardsPerPlayer: options.cardsPerPlayer || 8
			});

			this.gameId = result.gameId;
			this.inviteCode = result.inviteCode;
			this.userId = result.playerId;

			// Sla op in sessionStorage voor reconnect
			sessionStorage.setItem('locus_gameId', this.gameId);
			sessionStorage.setItem('locus_playerId', this.userId);
			sessionStorage.setItem('locus_userName', this.userName);

			console.log('[Locus MP] Game aangemaakt:', this.gameId, 'Code:', this.inviteCode);
			return {
				gameId: this.gameId,
				inviteCode: this.inviteCode
			};
		} catch (error) {
			console.error('[Locus MP] Create game failed:', error);
			if (this.onError) this.onError(error);
			throw error;
		}
	}

	/** Join een bestaand spel via invite code */
	async joinGame(playerName, inviteCode) {
		try {
			this.userName = playerName;
			const result = await this._emitWithAck('joinGame', {
				playerName,
				inviteCode
			});

			this.gameId = result.gameId;
			this.inviteCode = inviteCode;
			this.userId = result.playerId;

			// Sla op voor reconnect
			sessionStorage.setItem('locus_gameId', this.gameId);
			sessionStorage.setItem('locus_playerId', this.userId);
			sessionStorage.setItem('locus_userName', this.userName);

			console.log('[Locus MP] Joined game:', this.gameId);
			return {
				gameId: this.gameId,
				alreadyJoined: result.alreadyJoined
			};
		} catch (error) {
			console.error('[Locus MP] Join game failed:', error);
			if (this.onError) this.onError(error);
			throw error;
		}
	}

	/** Host start het spel */
	async startGame() {
		try {
			await this._emitWithAck('startGame', {});
			console.log('[Locus MP] Game started');
			return { success: true };
		} catch (error) {
			console.error('[Locus MP] Start game failed:', error);
			if (this.onError) this.onError(error);
			throw error;
		}
	}

	async chooseStartingDeck(deckType) {
		try {
			return await this._emitWithAck('chooseStartingDeck', { deckType });
		} catch (error) {
			console.error('[Locus MP] Choose starting deck failed:', error);
			if (this.onError) this.onError(error);
			throw error;
		}
	}

	// ──────────────────────────────────────────
	//  GAMEPLAY
	// ──────────────────────────────────────────

	/** Kies een objective (index 0-2) */
	async chooseGoal(objectiveIndex) {
		try {
			const result = await this._emitWithAck('chooseGoal', { objectiveIndex });
			return result;
		} catch (error) {
			console.error('[Locus MP] Choose goal failed:', error);
			if (this.onError) this.onError(error);
			throw error;
		}
	}

	/** Speel een kaart op het bord */
	async playCard(cardId, zoneName, baseX, baseY, rotation = 0, mirrored = false, subgridId = null) {
		try {
			const payload = {
				cardId,
				zoneName,
				baseX,
				baseY,
				rotation,
				mirrored
			};
			if (subgridId) payload.subgridId = subgridId;
			const result = await this._emitWithAck('playMove', payload);
			// Level complete wordt afgehandeld via gameState broadcast
			return result;
		} catch (error) {
			console.error('[Locus MP] Play card failed:', error);
			if (this.onError) this.onError(error);
			throw error;
		}
	}

	/** Verstuur live interactie (zonder ack) voor opponent visualisatie */
	sendInteraction(data = {}) {
		if (!this.socket || !this.connected) return;
		this.socket.emit('playerInteraction', data);
	}

	async sendTaunt(text) {
		try {
			return await this._emitWithAck('sendTaunt', { text });
		} catch (error) {
			console.error('[Locus MP] Send taunt failed:', error);
			if (this.onError) this.onError(error);
			throw error;
		}
	}

	/** Sla je beurt over (discard 1 kaart) */
	async pass(cardId = null) {
		try {
			const result = await this._emitWithAck('passMove', { cardId });
			// Level complete wordt afgehandeld via gameState broadcast
			return result;
		} catch (error) {
			console.error('[Locus MP] Pass failed:', error);
			if (this.onError) this.onError(error);
			throw error;
		}
	}

	/** Speel een bonus charge */
	async playBonus(bonusColor, zoneName, baseX, baseY, subgridId = null, rotation = 0) {
		try {
			const payload = {
				bonusColor,
				zoneName,
				baseX,
				baseY,
				rotation
			};
			if (subgridId) payload.subgridId = subgridId;
			const result = await this._emitWithAck('playBonus', payload);
			return result;
		} catch (error) {
			console.error('[Locus MP] Play bonus failed:', error);
			if (this.onError) this.onError(error);
			throw error;
		}
	}

	/** Beëindig je beurt — advance turn */
	async endTurn(cardId = null) {
		try {
			const result = await this._emitWithAck('endTurn', { cardId });
			return result;
		} catch (error) {
			console.error('[Locus MP] End turn failed:', error);
			if (this.onError) this.onError(error);
			throw error;
		}
	}

	/** Maak je laatste kaartplaatsing ongedaan (Ctrl+Z) */
	async undoMove() {
		try {
			const result = await this._emitWithAck('undoMove', {});
			return result;
		} catch (error) {
			console.error('[Locus MP] Undo failed:', error);
			if (this.onError) this.onError(error);
			throw error;
		}
	}

	/** Pauze toggle (space) — iedereen kan pauzeren/hervatten */
	async togglePause() {
		try {
			return await this._emitWithAck('togglePause', {});
		} catch (error) {
			console.error('[Locus MP] Toggle pause failed:', error);
			if (this.onError) this.onError(error);
			throw error;
		}
	}

	// ──────────────────────────────────────────
	//  SHOP & LEVEL METHODS
	// ──────────────────────────────────────────

	/** Start de shop fase */
	async startShopPhase() {
		try {
			return await this._emitWithAck('startShopPhase', {});
		} catch (error) {
			console.error('[Locus MP] Start shop failed:', error);
			throw error;
		}
	}

	/** Koop een shop item */
	async buyShopItem(itemId, extra = {}) {
		try {
			return await this._emitWithAck('buyShopItem', { itemId, extra });
		} catch (error) {
			console.error('[Locus MP] Buy item failed:', error);
			throw error;
		}
	}

	/** Claim a free card from unlock popup (pick 1 of 3) */
	async claimFreeCard(cardId) {
		try {
			return await this._emitWithAck('claimFreeCard', { cardId });
		} catch (error) {
			console.error('[Locus MP] Claim free card failed:', error);
			throw error;
		}
	}

	/** Gebruik een tijdbom op de huidige speler */
	async useTimeBomb() {
		try {
			return await this._emitWithAck('useTimeBomb', {});
		} catch (error) {
			console.error('[Locus MP] Use time bomb failed:', error);
			throw error;
		}
	}

	/** Klaar met winkelen → ready */
	async setShopReady() {
		try {
			return await this._emitWithAck('shopReady', {});
		} catch (error) {
			console.error('[Locus MP] Shop ready failed:', error);
			throw error;
		}
	}
	//  STATE HELPERS
	// ──────────────────────────────────────────

	/** Is het mijn beurt? */
	isMyTurn() {
		if (!this.gameState || this.gameState.phase !== 'playing') return false;
		return this.gameState.playerOrder[this.gameState.currentTurnIndex] === this.userId;
	}

	/** Wie is er aan de beurt? */
	getCurrentPlayer() {
		if (!this.gameState) return null;
		const pid = this.gameState.playerOrder[this.gameState.currentTurnIndex];
		return this.gameState.players[pid] || null;
	}

	/** Mijn speler data */
	getMyPlayer() {
		if (!this.gameState) return null;
		return this.gameState.players[this.userId] || null;
	}

	/** Mijn hand (kaarten) */
	getMyHand() {
		const player = this.getMyPlayer();
		return player ? player.hand : [];
	}

	/** Alle spelers met scores */
	getScoreboard() {
		if (!this.gameState) return [];
		return this.gameState.playerOrder.map(pid => {
			const p = this.gameState.players[pid];
			return {
				id: pid,
				name: p.name,
				score: p.score || 0,
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

	/** Board state voor rendering */
	getBoardState() {
		if (!this.gameState) return null;
		return this.gameState.boardState;
	}

	// ──────────────────────────────────────────
	//  CLIENT-SIDE PREVIEW (local validatie)
	// ──────────────────────────────────────────

	/**
	 * Preview of een plaatsing geldig zou zijn.
	 * Gebruikt shared game rules voor instant feedback.
	 * Definitieve validatie gebeurt server-side.
	 */
	previewPlacement(zoneName, baseX, baseY, matrix, subgridId = null) {
		if (!this.gameState?.boardState) return { valid: false };
		const Rules = window.LocusGameRules;
		if (!Rules) return { valid: false };

		let zoneData;
		if (zoneName === 'red') {
			const red = this.gameState.boardState.zones.red;
			if (!red?.subgrids) return { valid: false };
			// If subgridId is provided, only check that specific subgrid
			const subgridsToCheck = subgridId
				? red.subgrids.filter(sg => sg.id === subgridId)
				: red.subgrids;
			for (const sg of subgridsToCheck) {
				const cells = Rules.collectPlacementCellsData(sg, baseX, baseY, matrix);
				if (cells && Rules.validatePlacement('red', sg, cells)) {
					return { valid: true, cells, zoneName: 'red', subgridId: sg.id };
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

	/** Stop met luisteren en disconnect */
	disconnect() {
		if (this.socket) {
			this.socket.disconnect();
			this.socket = null;
		}
		this.gameState = null;
		this.gameId = null;
		this.userId = null;
		this.connected = false;

		sessionStorage.removeItem('locus_gameId');
		sessionStorage.removeItem('locus_playerId');
	}
}

// Browser global
if (typeof window !== 'undefined') {
	window.LocusMultiplayer = LocusMultiplayer;
}
