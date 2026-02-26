/**
 * ============================================================
 * LOCUS MULTIPLAYER — Lobby & Game UI Controller (v2)
 * ============================================================
 * Verbindt multiplayer-client.js met de visuele UI.
 * Beheert: lobby, scoreboard, turn indicator, 
 *          goal keuze, hand rendering, board sync,
 *          drag-and-drop, bonussen.
 *
 * Laad NA: game-rules.js, multiplayer-client.js
 * ============================================================
 */

class LocusLobbyUI {
	constructor(mp) {
		/** @type {LocusMultiplayer} */
		this.mp = mp;
		this.elements = {};

		// Drag-and-drop state
		this._dragState = null;   // { card, matrix, rotation, mirrored, ghostEl, originEl }
		this._isDragging = false;
		this._lastPreviewZone = null;
		this._lastPreviewCells = null;
		this._lastPreviewBaseX = null;
		this._lastPreviewBaseY = null;
		this._lastPreviewSubgridId = null;
		this._throttleTimer = null;
		this._lastDragBaseX = null;
		this._lastDragBaseY = null;
		this._ghostOffsetX = 0;
		this._ghostOffsetY = 0;

		// Bonus state
		this._bonusMode = null; // null | { color, matrix }

		// Bound handlers (voor cleanup)
		this._clickPlacementHandler = null;
		this._cellHoverHandler = null;
		this._bonusClickHandler = null;
		this._bonusHoverHandler = null;
		this._bonusMoveHandler = null;

		// Score animation tracking
		this._prevScores = {};

		// Sound effects (Web Audio API)
		this._audioCtx = null;
		this._objectivesRevealed = false;
		this._oppPreviewCells = [];
		this._interactionMoveThrottleTs = 0;
		this._lastMobileBoardIndex = 0;
		this._forcedMobileBoardIndex = null;
		this._lastMobileZoneName = null;
		this._forceBlueBottomOnce = false;
		this._lastBonusBaseX = null;
		this._lastBonusBaseY = null;
		this._lastBonusZone = null;
		this._lastBonusSubgridId = null;
		this._pendingBonusSpawnCells = [];
		this._mobileGestureGuardsBound = false;
		this._startDeckOverlay = null;
		this._oppTimerInterval = null;
		this._pauseTogglePending = false;
		this._turnTimerPausedRemainingMs = 0;
		this._activeSelections = {};
		this._touchDragScrollLocked = false;
		this._ignoreNextBonusClickUntil = 0;
	}

	// ──────────────────────────────────────────
	//  INITIALISATIE
	// ──────────────────────────────────────────

	init() {
		this._cacheElements();
		this._bindEvents();
		this._bindMobileGestureGuards();
		this._registerCallbacks();
		this._bindKeyboard();
		this._setVersionBadge();
		this._showScreen('lobby-screen');
	}

	_setVersionBadge() {
		const lobbyEl = document.getElementById('mp-version-badge');
		if (!lobbyEl) return;
		if (window.__locusBuildMeta?.badgeText) {
			lobbyEl.textContent = window.__locusBuildMeta.badgeText;
			lobbyEl.title = window.__locusBuildMeta.badgeText;
			return;
		}

		const fallbackDate = new Date(document.lastModified || Date.now());
		const now = Number.isNaN(fallbackDate.getTime()) ? new Date() : fallbackDate;
		const pad = (n) => String(n).padStart(2, '0');
		const buildTag = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
		const dateText = now.toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
		const timeText = now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
		const badgeText = `Build ${buildTag} • ${dateText} ${timeText}`;
		window.__locusBuildMeta = { buildDate: now, badgeText };
		lobbyEl.textContent = badgeText;
		lobbyEl.title = badgeText;
	}

	_bindMobileGestureGuards() {
		if (this._mobileGestureGuardsBound) return;
		if (!this._isTouchLikeDevice()) return;
		this._mobileGestureGuardsBound = true;

		const blockGesture = (e) => {
			e.preventDefault();
		};

		document.addEventListener('gesturestart', blockGesture, { passive: false });
		document.addEventListener('gesturechange', blockGesture, { passive: false });
		document.addEventListener('gestureend', blockGesture, { passive: false });

		let lastTouchEndTs = 0;
		document.addEventListener('touchend', (e) => {
			const now = Date.now();
			if (now - lastTouchEndTs < 300) {
				e.preventDefault();
			}
			lastTouchEndTs = now;
		}, { passive: false });
	}

	/** Herstart UI na auto-reconnect (pagina refresh) */
	handleReconnect() {
		const state = this.mp.gameState;
		if (!state) return;

		switch (state.phase) {
			case 'waiting':
				this._showWaitingRoom(this.mp.inviteCode || '???', state.hostPlayerId === this.mp.userId);
				break;
			case 'choosingStartDeck':
				this._onStartDeckPhase();
				break;
			case 'choosingGoals': {
				const choices = state.objectiveChoices?.[this.mp.userId] || [];
				if (choices.length > 0) this._onGoalPhase(choices);
				else this._showToast('Wachten op andere spelers...', 'info');
				break;
			}
			case 'playing':
				this._onGameStarted(state);
				break;
			case 'levelComplete':
				if (state.levelScores) this._onLevelComplete(state.levelScores, state.levelWinner, state.level);
				break;
			case 'shopping':
				this._onShopPhase();
				break;
			case 'ended':
				if (state.finalScores) this._onGameEnded(state.finalScores, state.winner);
				break;
		}
	}

	_cacheElements() {
		const ids = [
			'lobby-screen', 'waiting-screen', 'goal-screen',
			'game-screen', 'results-screen', 'shop-screen',
			'level-complete-overlay',
			'player-name-input', 'create-game-btn', 'join-game-btn',
			'invite-code-input', 'max-players-select', 'cards-per-player-select',
			'invite-code-display', 'player-list', 'start-game-btn',
			'waiting-status',
			'goal-choices-container',
			'mp-scoreboard', 'mp-turn-indicator', 'mp-hand-container',
			'mp-board-container', 'mp-pass-btn', 'mp-timer',
			'mp-my-objective', 'mp-bonus-bar',
			'mp-room-code-badge',
			'mp-end-turn-btn', 'mp-undo-btn', 'mp-turn-timer',
			'mp-deck-overview-btn', 'mp-deck-overlay', 'mp-deck-close-btn', 'mp-deck-cards', 'mp-deck-count',
			'results-container', 'play-again-btn',
			'shop-container', 'shop-ready-btn'
		];
		for (const id of ids) {
			this.elements[id] = document.getElementById(id);
		}
	}

	_showScreen(screenId) {
		const screens = ['lobby-screen', 'waiting-screen', 'goal-screen', 'game-screen', 'results-screen', 'shop-screen'];
		for (const id of screens) {
			const el = this.elements[id];
			if (!el) continue;
			if (id !== screenId) {
				el.style.display = 'none';
				continue;
			}
			el.style.display = (id === 'game-screen') ? 'grid' : 'flex';
		}
		// Hide level complete overlay when switching screens
		const overlay = this.elements['level-complete-overlay'];
		if (overlay && screenId !== 'game-screen') overlay.style.display = 'none';
	}

	// ──────────────────────────────────────────
	//  EVENT BINDINGS
	// ──────────────────────────────────────────

	_bindEvents() {
		this.elements['create-game-btn']?.addEventListener('click', () => this._handleCreateGame());
		this.elements['join-game-btn']?.addEventListener('click', () => this._handleJoinGame());
		this.elements['start-game-btn']?.addEventListener('click', () => this._handleStartGame());
		this.elements['mp-pass-btn']?.addEventListener('click', () => this._handlePass());
		this.elements['mp-end-turn-btn']?.addEventListener('click', () => this._handleEndTurn());
		this.elements['mp-undo-btn']?.addEventListener('click', () => this._handleUndo());
		this.elements['play-again-btn']?.addEventListener('click', () => {
			this.mp.disconnect();
			this._showScreen('lobby-screen');
		});
		this.elements['shop-ready-btn']?.addEventListener('click', () => this._handleShopReady());
		this.elements['mp-deck-overview-btn']?.addEventListener('click', () => this._toggleDeckOverview());
		this.elements['mp-deck-close-btn']?.addEventListener('click', () => this._closeDeckOverview());
		document.querySelectorAll('.mp-taunt-btn').forEach(btn => {
			btn.addEventListener('click', () => this._handleTaunt(btn.dataset.taunt || ''));
		});
		this.elements['invite-code-input']?.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') this._handleJoinGame();
		});

		// Live naam-validatie: highlight name field en schakel buttons in/uit
		const nameInput = this.elements['player-name-input'];
		if (nameInput) {
			nameInput.addEventListener('input', () => this._validateLobbyName());
			// Initial check
			this._validateLobbyName();
		}
	}

	_validateLobbyName() {
		const nameInput = this.elements['player-name-input'];
		const name = nameInput?.value?.trim() || '';
		const hasName = name.length > 0;
		const createBtn = this.elements['create-game-btn'];
		const joinBtn = this.elements['join-game-btn'];
		if (createBtn) {
			createBtn.disabled = !hasName;
			createBtn.title = hasName ? '' : 'Vul eerst je naam in';
		}
		if (joinBtn) {
			joinBtn.disabled = !hasName;
			joinBtn.title = hasName ? '' : 'Vul eerst je naam in';
		}
		// Visual feedback on name field
		if (nameInput) {
			nameInput.classList.toggle('mp-name-filled', hasName);
		}
	}

	_shakeNameInput() {
		const nameInput = this.elements['player-name-input'];
		if (!nameInput) return;
		nameInput.classList.add('mp-shake');
		nameInput.focus();
		setTimeout(() => nameInput.classList.remove('mp-shake'), 600);
	}

	_bindKeyboard() {
		document.addEventListener('keydown', (e) => {
			const targetTag = e.target?.tagName;
			const isTypingTarget = targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT' || e.target?.isContentEditable;
			const isSpace = e.key === ' ' || e.code === 'Space' || e.key === 'Spacebar';

			if (!isTypingTarget && isSpace && this.mp?.gameState?.phase === 'playing') {
				e.preventDefault();
				if (!e.repeat) this._handlePauseToggle();
				return;
			}

			if (!isTypingTarget && e.key === 'Enter' && this.mp?.gameState?.phase === 'playing' && this.mp?.isMyTurn?.()) {
				e.preventDefault();
				this._handleEndTurn();
				return;
			}

			// Ctrl+Z / Cmd+Z — Undo
			if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
				e.preventDefault();
				this._handleUndo();
				return;
			}

			if (!this._dragState && !this._bonusMode) return;

			if (e.key === 'r' || e.key === 'R') {
				e.preventDefault();
				this._rotateCurrentShape();
			} else if (e.key === 't' || e.key === 'T') {
				e.preventDefault();
				this._mirrorCurrentShape();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				this._cancelDrag();
				this._cancelBonusMode();
			}
		});

		// Mouse wheel voor rotatie
		document.addEventListener('wheel', (e) => {
			if (!this._dragState && !this._bonusMode) return;
			e.preventDefault();
			this._rotateCurrentShape();
		}, { passive: false });
	}

	_registerCallbacks() {
		this.mp.onGameStateChanged = (state, prevState) => this._onGameStateChanged(state, prevState);
		this.mp.onPlayerJoined = (player) => this._onPlayerJoined(player);
		this.mp.onTurnChanged = (pid, turn) => this._onTurnChanged(pid, turn);
		this.mp.onGoalPhase = (choices) => this._onGoalPhase(choices);
		this.mp.onGameStarted = (state) => this._onGameStarted(state);
		this.mp.onGameEnded = (scores, winner) => this._onGameEnded(scores, winner);
		this.mp.onLevelComplete = (scores, winner, level) => this._onLevelComplete(scores, winner, level);
		this.mp.onShopPhase = () => this._onShopPhase();
		this.mp.onNextLevel = (level) => this._onNextLevel(level);
		this.mp.onError = (error) => this._onError(error);
		this.mp.onConnectionChanged = (connected) => this._onConnectionChanged(connected);
		this.mp.onMovePlayed = (data) => this._onMovePlayed(data);
		this.mp.onObjectivesRevealed = () => this._onObjectivesRevealed();
		this.mp.onTimeBombed = (data) => this._onTimeBombed(data);
		this.mp.onOpponentInteraction = (data) => this._onOpponentInteraction(data);
		this.mp.onTaunt = (data) => this._onTaunt(data);
		this.mp.onPauseChanged = (data) => this._onPauseChanged(data);
	}

	async _handlePauseToggle() {
		if (this._pauseTogglePending) return;
		if (!this.mp?.gameState || this.mp.gameState.phase !== 'playing') return;
		this._pauseTogglePending = true;
		try {
			await this.mp.togglePause();
		} catch (err) {
			this._showToast('Pauze mislukt: ' + (err.message || err), 'error');
		} finally {
			this._pauseTogglePending = false;
		}
	}

	_onPauseChanged(data = {}) {
		const paused = !!data.paused;
		const name = data.playerName ? this._escapeHtml(data.playerName) : 'Speler';
		this._showToast(paused ? `⏸ Pauze door ${name}` : `▶ Hervat door ${name}`, 'info');
		if (paused) {
			this._stopTurnTimer();
		}
	}

	// ──────────────────────────────────────────
	//  SOUND EFFECTS (Web Audio API)
	// ──────────────────────────────────────────

	_getAudioCtx() {
		if (!this._audioCtx) {
			this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
		}
		return this._audioCtx;
	}

	_playTone(freq, duration = 0.15, type = 'sine', volume = 0.15) {
		try {
			const ctx = this._getAudioCtx();
			const osc = ctx.createOscillator();
			const gain = ctx.createGain();
			osc.type = type;
			osc.frequency.value = freq;
			gain.gain.setValueAtTime(volume, ctx.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
			osc.connect(gain);
			gain.connect(ctx.destination);
			osc.start();
			osc.stop(ctx.currentTime + duration);
		} catch (e) { /* silent fail */ }
	}

	_playPlaceSound() {
		this._playTone(440, 0.1, 'sine', 0.12);
		setTimeout(() => this._playTone(660, 0.08, 'sine', 0.08), 60);
	}

	_playScoreSound() {
		this._playTone(523, 0.12, 'sine', 0.15);
		setTimeout(() => this._playTone(659, 0.12, 'sine', 0.12), 80);
		setTimeout(() => this._playTone(784, 0.15, 'sine', 0.12), 160);
	}

	_playOpponentScoreSound() {
		this._playTone(330, 0.15, 'triangle', 0.08);
	}

	_playTimerWarningSound() {
		this._playTone(880, 0.2, 'sine', 0.1);
	}

	_playRevealSound() {
		this._playTone(392, 0.2, 'sine', 0.15);
		setTimeout(() => this._playTone(494, 0.2, 'sine', 0.12), 150);
		setTimeout(() => this._playTone(587, 0.2, 'sine', 0.12), 300);
		setTimeout(() => this._playTone(784, 0.3, 'sine', 0.15), 450);
	}

	_playTurnStartSound() {
		this._playTone(587, 0.12, 'sine', 0.1);
		setTimeout(() => this._playTone(784, 0.15, 'sine', 0.12), 100);
	}

	_playBombSound() {
		// Explosie-achtig geluid: laag rommelend + hoge impact
		this._playTone(80, 0.4, 'sawtooth', 0.25);
		setTimeout(() => this._playTone(60, 0.3, 'square', 0.2), 50);
		setTimeout(() => this._playTone(120, 0.2, 'sawtooth', 0.15), 100);
		setTimeout(() => this._playTone(200, 0.15, 'sine', 0.1), 200);
	}

	_playGoldSound() {
		this._playTone(1047, 0.1, 'sine', 0.15);
		setTimeout(() => this._playTone(1319, 0.12, 'sine', 0.12), 80);
		setTimeout(() => this._playTone(1568, 0.15, 'sine', 0.1), 160);
	}

	_playTauntSound() {
		this._playTone(520, 0.07, 'triangle', 0.11);
		setTimeout(() => this._playTone(660, 0.08, 'triangle', 0.1), 70);
	}

	// ──────────────────────────────────────────
	//  LOBBY HANDLERS
	// ──────────────────────────────────────────

	async _handleCreateGame() {
		const name = this.elements['player-name-input']?.value?.trim();
		if (!name) {
			this._showToast('Vul je naam in!', 'warning');
			this._shakeNameInput();
			return;
		}

		const maxPlayers = Number(this.elements['max-players-select']?.value) || 4;
		const cardsPerPlayer = Number(this.elements['cards-per-player-select']?.value) || 8;

		this._setLoading(true);
		try {
			await this.mp.init();
			const result = await this.mp.createGame(name, { maxPlayers, cardsPerPlayer });
			this._showWaitingRoom(result.inviteCode, true);
		} catch (err) {
			this._showToast('Kan spel niet aanmaken: ' + (err.message || err), 'error');
		}
		this._setLoading(false);
	}

	async _handleJoinGame() {
		const name = this.elements['player-name-input']?.value?.trim();
		const code = this.elements['invite-code-input']?.value?.trim().toUpperCase();

		if (!name) {
			this._showToast('Vul je naam in!', 'warning');
			this._shakeNameInput();
			return;
		}
		if (!code || code.length !== 6) { this._showToast('Vul een geldige 6-letter code in!', 'warning'); return; }

		this._setLoading(true);
		try {
			const initResult = await this.mp.init();
			if (initResult?.reconnected) {
				this.handleReconnect();
				this._setLoading(false);
				return;
			}
			const joinResult = await this.mp.joinGame(name, code);
			if (joinResult.reconnected) {
				// Spel loopt al — navigeer direct naar het juiste scherm
				this.handleReconnect();
			} else {
				this._showWaitingRoom(code, false);
			}
		} catch (err) {
			this._showToast('Kan niet joinen: ' + (err.message || err), 'error');
		}
		this._setLoading(false);
	}

	async _handleStartGame() {
		this._setLoading(true);
		try { await this.mp.startGame(); }
		catch (err) { this._showToast('Kan spel niet starten: ' + (err.message || err), 'error'); }
		this._setLoading(false);
	}

	async _handlePass() {
		if (!this.mp.isMyTurn()) return;
		const gs = this.mp.gameState;
		const currentPid = gs?.playerOrder?.[gs?.currentTurnIndex || 0];
		if (currentPid && currentPid !== this.mp.userId) return;
		const hand = this.mp.getMyHand();
		const cardId = await this._pickDiscardCardId(hand, {
			title: 'Kies een kaart om weg te gooien (passen)',
			filterFn: () => true
		});
		if (cardId === undefined) return;
		this._cancelDrag();
		this._cancelBonusMode();
		this._stopTurnTimer();
		try { await this.mp.pass(cardId); }
		catch (err) {
			const msg = String(err?.message || err || '');
			if (/Niet jouw beurt/i.test(msg)) return;
			this._showToast('Passen mislukt: ' + msg, 'error');
		}
	}

	async _handleEndTurn() {
		if (!this.mp.isMyTurn()) return;
		const cardPlayedThisTurn = !!this.mp.gameState?._cardPlayedThisTurn;
		let discardCardId = null;
		if (!cardPlayedThisTurn) {
			discardCardId = await this._pickDiscardCardId(this.mp.getMyHand(), {
				title: 'Kies een kaart om weg te gooien (beurt beëindigen)',
				filterFn: (card) => !card?.isGolden
			});
			if (discardCardId === undefined) return;
		}
		this._cancelDrag();
		this._cancelBonusMode();
		this._stopTurnTimer();
		try {
			const result = (!cardPlayedThisTurn && discardCardId)
				? await this.mp.pass(discardCardId)
				: await this.mp.endTurn(discardCardId);
			if (result?.gameEnded) {
				// levelComplete wordt via gameState broadcast afgehandeld
			}
		} catch (err) {
			this._showToast('Beurt beëindigen mislukt: ' + (err.message || err), 'error');
		}
	}

	async _pickDiscardCardId(hand, options = {}) {
		const cards = Array.isArray(hand) ? hand : [];
		const filterFn = typeof options.filterFn === 'function' ? options.filterFn : (() => true);
		const candidates = cards.filter(filterFn);

		if (candidates.length === 0) return null;
		if (candidates.length === 1) return candidates[0].id;
		return this._showDiscardPicker(candidates, options.title || 'Kies een kaart om weg te gooien');
	}

	_showDiscardPicker(cards, title) {
		return new Promise((resolve) => {
			const overlay = document.createElement('div');
			overlay.className = 'mp-discard-overlay';
			overlay.innerHTML = `
				<div class="mp-discard-modal">
					<div class="mp-discard-title">${this._escapeHtml(title || 'Kies een kaart')}</div>
					<div class="mp-discard-cards"></div>
					<div class="mp-discard-actions">
						<button class="mp-btn mp-btn-secondary" data-action="cancel">Annuleren</button>
					</div>
				</div>
			`;

			const cardsWrap = overlay.querySelector('.mp-discard-cards');
			for (const card of cards) {
				const btn = document.createElement('button');
				btn.className = 'mp-discard-card';
				const colorCode = card?.color?.code === 'rainbow'
					? 'linear-gradient(135deg, #b56069, #cfba51, #92c28c, #5689b0, #8f76b8)'
					: (card?.color?.code || '#666');
				btn.innerHTML = `
					<div class="mp-discard-color" style="background:${colorCode}"></div>
					<div class="mp-discard-shape">${this._renderMiniGrid(card.matrix, card.color)}</div>
					<div class="mp-discard-name">${this._escapeHtml(card.shapeName || 'Kaart')}</div>
				`;
				btn.addEventListener('click', () => {
					overlay.remove();
					resolve(card.id);
				});
				cardsWrap.appendChild(btn);
			}

			overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
				overlay.remove();
				resolve(undefined);
			});

			overlay.addEventListener('click', (e) => {
				if (e.target === overlay) {
					overlay.remove();
					resolve(undefined);
				}
			});

			document.body.appendChild(overlay);
		});
	}

	async _handleUndo() {
		if (!this.mp.isMyTurn()) return;
		const undoData = this.mp.gameState?._turnUndoData;
		const canUndo = !!(
			undoData &&
			undoData.playerId === this.mp.userId &&
			(
				(Array.isArray(undoData.bonusMoves) && undoData.bonusMoves.length > 0) ||
				(Array.isArray(undoData.placedCells) && undoData.placedCells.length > 0)
			)
		);
		if (!canUndo) {
			this._showToast('Niets om ongedaan te maken', 'info');
			return;
		}
		this._cancelDrag();
		this._cancelBonusMode();
		this._stopTurnTimer();
		try {
			const result = await this.mp.undoMove();
			if (result?.success) {
				this._showToast('Zet ongedaan gemaakt! ↩', 'info');
			}
		} catch (err) {
			this._showToast('Undo mislukt: ' + (err.message || err), 'error');
		}
	}

	// ──────────────────────────────────────────
	//  TURN TIMER (40 seconden)
	// ──────────────────────────────────────────

	_startTurnTimer() {
		this._stopTurnTimer();
		if (this.mp?.gameState?.paused) return;
		if (!Number.isFinite(this._turnTimerEnd) || this._turnTimerEnd <= Date.now()) {
			this._turnTimerEnd = Date.now() + 40000;
		}
		this._lastTimerBeep = null;
		const timerEl = this.elements['mp-turn-timer'];
		if (timerEl && this.mp.isMyTurn()) timerEl.style.display = 'flex';

		this._turnTimerInterval = setInterval(() => {
			const gs = this.mp?.gameState;
			const paused = !!gs?.paused;
			const remaining = paused
				? Math.max(0, Number(gs?._turnTimerRemainingMs || this._turnTimerPausedRemainingMs || 0))
				: Math.max(0, this._turnTimerEnd - Date.now());
			const pct = (remaining / 40000) * 100;
			const secs = Math.ceil(remaining / 1000);

			document.querySelectorAll('.mp-timer-fill').forEach(fill => {
				fill.style.width = `${pct}%`;
				fill.classList.toggle('timer-warning', secs <= 10 && secs > 5);
				fill.classList.toggle('timer-critical', secs <= 5);
			});
			document.querySelectorAll('.mp-timer-text').forEach(text => {
				text.textContent = `${secs}s`;
			});

			// Beep elke seconde in de laatste 5 seconden (zelfde toonhoogte)
			if (!paused && this.mp.isMyTurn() && secs <= 5 && secs > 0 && this._lastTimerBeep !== secs) {
				this._lastTimerBeep = secs;
				this._playTimerWarningSound();
			}

			if (!paused && remaining <= 0) {
				this._stopTurnTimer();
				// Server handelt auto-endTurn af, geen actie nodig
			}
		}, 100);
	}

	_stopTurnTimer() {
		if (this._turnTimerInterval) {
			clearInterval(this._turnTimerInterval);
			this._turnTimerInterval = null;
		}
		const timerEl = this.elements['mp-turn-timer'];
		if (timerEl) timerEl.style.display = 'none';
	}

	_syncTurnTimerFromState(state) {
		const durationMs = Math.max(1, Number(state?._turnTimerDurationMs) || 40000);
		if (state?.paused) {
			const rem = Number(state?._turnTimerRemainingMs || 0);
			this._turnTimerPausedRemainingMs = Math.max(0, rem);
			this._turnTimerEnd = Date.now() + this._turnTimerPausedRemainingMs;
			return;
		}
		this._turnTimerPausedRemainingMs = 0;
		const startTs = Number(state?._turnTimerStart || 0);
		if (Number.isFinite(startTs) && startTs > 0) {
			this._turnTimerEnd = startTs + durationMs;
		} else if (!Number.isFinite(this._turnTimerEnd) || this._turnTimerEnd <= Date.now()) {
			this._turnTimerEnd = Date.now() + durationMs;
		}
	}

	// ──────────────────────────────────────────
	//  WAITING ROOM
	// ──────────────────────────────────────────

	_showWaitingRoom(inviteCode, isHost) {
		this._showScreen('waiting-screen');
		const codeDisplay = this.elements['invite-code-display'];
		if (codeDisplay) {
			codeDisplay.textContent = inviteCode;
			codeDisplay.onclick = () => {
				navigator.clipboard?.writeText(inviteCode).then(() => {
					this._showToast('Code gekopieerd!', 'success');
				});
			};
		}

		const startBtn = this.elements['start-game-btn'];
		if (startBtn) startBtn.style.display = isHost ? 'block' : 'none';

		this._updatePlayerList();
	}

	_updatePlayerList() {
		const list = this.elements['player-list'];
		if (!list || !this.mp.gameState) return;

		const players = this.mp.gameState.playerOrder.map(pid => {
			const p = this.mp.gameState.players[pid];
			return p || { id: pid, name: '???' };
		});

		list.innerHTML = players.map((p, i) => `
			<div class="mp-player-item ${p.id === this.mp.userId ? 'is-me' : ''}">
				<span class="mp-player-number">${i + 1}</span>
				<span class="mp-player-name">${this._escapeHtml(p.name)}</span>
				${p.id === this.mp.gameState.hostPlayerId ? '<span class="mp-host-badge">HOST</span>' : ''}
				${p.id === this.mp.userId ? '<span class="mp-you-badge">JIJ</span>' : ''}
			</div>
		`).join('');

		const status = this.elements['waiting-status'];
		if (status) {
			const count = players.length;
			const max = this.mp.gameState.settings.maxPlayers;
			status.textContent = `${count}/${max} spelers`;
		}

		const startBtn = this.elements['start-game-btn'];
		if (startBtn && this.mp.gameState.hostPlayerId === this.mp.userId) {
			startBtn.disabled = players.length < 2;
		}
	}

	_normalizeObjectiveReward(value) {
		if (!Number.isFinite(value)) return 0;
		return Math.max(0, Math.floor(value));
	}

	_stripObjectiveRewardText(description) {
		const raw = String(description || '');
		return raw
			.replace(/\s*Reward:\s*[^.]*\.?/gi, '')
			.replace(/\s{2,}/g, ' ')
			.trim();
	}

	_renderObjectiveRewardBadges(objective, options = {}) {
		const points = this._normalizeObjectiveReward(objective?.points);
		const coins = this._normalizeObjectiveReward(objective?.coins);
		const randomBonuses = this._normalizeObjectiveReward(objective?.randomBonuses);
		const includeFallbackPoints = options.includeFallbackPoints === true;
		const fallbackPoints = this._normalizeObjectiveReward(options.fallbackPoints ?? 15);

		const rewards = [];
		if (points > 0) rewards.push({ icon: '🏆', value: points, label: 'punten', cls: 'is-points' });
		if (coins > 0) rewards.push({ icon: '🪙', value: coins, label: 'munten', cls: 'is-coins' });
		if (randomBonuses > 0) {
			rewards.push({
				icon: '🎁',
				value: randomBonuses,
				label: randomBonuses === 1 ? 'bonus' : 'bonussen',
				cls: 'is-bonuses'
			});
		}

		if (rewards.length === 0 && includeFallbackPoints && fallbackPoints > 0) {
			rewards.push({ icon: '🏆', value: fallbackPoints, label: 'punten', cls: 'is-points' });
		}

		if (rewards.length === 0) return '';

		const wrapperClass = options.wrapperClass || 'mp-goal-rewards';
		return `<div class="${wrapperClass}">${rewards.map(r =>
			`<span class="mp-goal-reward-badge ${r.cls}">${r.icon} ${r.value} ${r.label}</span>`
		).join('')}</div>`;
	}

	// ──────────────────────────────────────────
	//  GOAL KEUZE
	// ──────────────────────────────────────────

	_onGoalPhase(choices) {
		console.log('[Locus UI] _onGoalPhase called, choices:', choices?.length);
		try {
			if (this._startDeckOverlay) {
				this._startDeckOverlay.remove();
				this._startDeckOverlay = null;
			}
			this._showScreen('goal-screen');
			const container = this.elements['goal-choices-container'];
			if (!container) {
				console.error('[Locus UI] goal-choices-container element niet gevonden!');
				return;
			}

			const level = this.mp.gameState?.level || 1;
			container.innerHTML = `
				<h2 class="mp-section-title">Kies je Doelstelling — Level ${level}</h2>
				<p class="mp-section-subtitle">Andere spelers zien niet welk doel jij kiest!</p>
				<div class="mp-goal-grid">
					${choices.map((goal, i) => `
						<button class="mp-goal-card" data-index="${i}">
							<div class="mp-goal-name">${this._escapeHtml(goal?.name || 'Onbekend doel')}</div>
							<div class="mp-goal-desc">${this._escapeHtml(this._stripObjectiveRewardText(goal?.description || ''))}</div>
							${this._renderObjectiveRewardBadges(goal, { includeFallbackPoints: true, fallbackPoints: 15 })}
						</button>
					`).join('')}
				</div>
			`;

			container.querySelectorAll('.mp-goal-card').forEach(btn => {
				btn.addEventListener('click', async () => {
					const index = Number(btn.dataset.index);
					container.querySelectorAll('.mp-goal-card').forEach(b => b.disabled = true);
					btn.classList.add('selected');

					try {
						await this.mp.chooseGoal(index);
						this._showToast('Doelstelling gekozen! Wachten op andere spelers...', 'success');
					} catch (err) {
						this._showToast('Fout bij kiezen: ' + err.message, 'error');
						container.querySelectorAll('.mp-goal-card').forEach(b => b.disabled = false);
						btn.classList.remove('selected');
					}
				});
			});
		} catch (err) {
			console.error('[Locus UI] _onGoalPhase ERROR:', err);
		}
	}

	_onStartDeckPhase() {
		console.log('[Locus UI] _onStartDeckPhase, userId:', this.mp.userId, 'inviteCode:', this.mp.inviteCode);
		this._showWaitingRoom(this.mp.inviteCode || '???', this.mp.gameState?.hostPlayerId === this.mp.userId);
		const myType = this.mp.gameState?.players?.[this.mp.userId]?.startingDeckType;
		if (myType) {
			if (this._startDeckOverlay) {
				this._startDeckOverlay.remove();
				this._startDeckOverlay = null;
			}
			this._showToast('Startdeck gekozen. Wachten op andere spelers...', 'info');
			return;
		}
		this._showStartDeckPicker();
	}

	_showStartDeckPicker() {
		if (this._startDeckOverlay) return;

		const options = [
			{
				id: 'adventurer',
				icon: '🧭',
				title: 'Avonturier',
				desc: 'Veelal 2 kleuren',
				meta: 'Flexibele opening'
			},
			{
				id: 'spread',
				icon: '🎨',
				title: 'Verspreid',
				desc: 'Van elke kleur 2 kaarten',
				meta: 'Gebalanceerde start'
			},
			{
				id: 'random',
				icon: '🎲',
				title: 'Random',
				desc: 'Volledig willekeurige mix',
				meta: 'Hoge variatie'
			}
		];

		const overlay = document.createElement('div');
		overlay.className = 'mp-discard-overlay mp-startdeck-overlay';
		overlay.innerHTML = `
			<div class="mp-discard-modal mp-startdeck-modal">
				<div class="mp-discard-title mp-startdeck-title">Kies je startdeck voor Level 1</div>
				<div class="mp-startdeck-subtitle">Kies een speelstijl — je beginkaarten worden hierop afgestemd.</div>
				<div class="mp-discard-cards mp-startdeck-cards">
					${options.map(opt => `
						<button class="mp-discard-card mp-startdeck-card" data-deck-type="${opt.id}">
							<div class="mp-startdeck-head">
								<span class="mp-startdeck-icon">${this._escapeHtml(opt.icon)}</span>
								<span class="mp-startdeck-name">${this._escapeHtml(opt.title)}</span>
							</div>
							<div class="mp-startdeck-desc">${this._escapeHtml(opt.desc)}</div>
							<div class="mp-startdeck-meta">${this._escapeHtml(opt.meta)}</div>
						</button>
					`).join('')}
				</div>
			</div>
		`;

		overlay.querySelectorAll('.mp-startdeck-card').forEach(btn => {
			btn.addEventListener('click', async () => {
				const deckType = btn.dataset.deckType;
				overlay.querySelectorAll('.mp-startdeck-card').forEach(b => b.disabled = true);
				btn.classList.add('selected');
				try {
					await this.mp.chooseStartingDeck(deckType);
					this._showToast('Startdeck gekozen! Wachten op andere spelers...', 'success');
					overlay.remove();
					if (this._startDeckOverlay === overlay) this._startDeckOverlay = null;
				} catch (err) {
					this._showToast('Kiezen mislukt: ' + (err.message || err), 'error');
					overlay.querySelectorAll('.mp-startdeck-card').forEach(b => b.disabled = false);
					btn.classList.remove('selected');
				}
			});
		});

		document.body.appendChild(overlay);
		this._startDeckOverlay = overlay;
	}

	// ──────────────────────────────────────────
	//  GAME SCREEN
	// ──────────────────────────────────────────

	_onGameStarted(state) {
		this._syncTurnTimerFromState(state);
		this._startOpponentTimerTicker();
		this._showScreen('game-screen');
		this._updateRoomCodeBadge();
		this._renderBoard(state.boardState);
		this._renderScoreboard();
		this._renderHand();
		this._updateTurnIndicator();
		this._renderMyObjective();
		this._renderBonusBar();
		this._renderOpponentPanels();
	}

	_onTurnChanged(currentPlayerId, turnCount) {
		this._syncTurnTimerFromState(this.mp.gameState);
		this._lastTimerBeep = null;
		this._startOpponentTimerTicker();
		this._stopTurnTimer();
		this._updateTurnIndicator();
		this._renderHand();
		this._renderScoreboard();
		this._renderBonusBar();
		this._renderOpponentPanels();
		this._cancelDrag();
		this._cancelBonusMode();

		if (currentPlayerId === this.mp.userId) {
			this._showToast('Jouw beurt!', 'info');
			this._playTurnStartSound();
		}
	}

	_startOpponentTimerTicker() {
		if (this._oppTimerInterval) return;
		this._oppTimerInterval = setInterval(() => {
			const gs = this.mp?.gameState;
			if (!gs || gs.phase !== 'playing') return;
			const currentPid = gs.playerOrder?.[gs.currentTurnIndex];
			if (!currentPid) return;
			const isPaused = !!gs.paused;

			if (!Number.isFinite(this._turnTimerEnd)) {
				this._turnTimerEnd = Date.now() + 40000;
			}

			const remaining = isPaused
				? Math.max(0, Number(gs._turnTimerRemainingMs || this._turnTimerPausedRemainingMs || 0))
				: Math.max(0, this._turnTimerEnd - Date.now());
			const secs = Math.ceil(remaining / 1000);
			const nodes = document.querySelectorAll(`.mp-opp-timer[data-player-id="${currentPid}"]`);
			nodes.forEach(el => {
				el.textContent = isPaused ? `⏸ ${secs}s` : `⏱ ${secs}s`;
				el.classList.toggle('is-warning', secs <= 10 && secs > 5);
				el.classList.toggle('is-critical', secs <= 5);
			});
		}, 150);
	}

	_stopOpponentTimerTicker() {
		if (this._oppTimerInterval) {
			clearInterval(this._oppTimerInterval);
			this._oppTimerInterval = null;
		}
	}

	_updateTurnIndicator() {
		const indicator = this.elements['mp-turn-indicator'];
		if (!indicator || !this.mp.gameState) return;
		this._updateRoomCodeBadge();

		const isMyTurn = this.mp.isMyTurn();
		const current = this.mp.getCurrentPlayer();
		const turnCount = this.mp.gameState.turnCount || 0;
		const cardPlayed = this.mp.gameState._cardPlayedThisTurn || false;
		const isPaused = !!this.mp.gameState.paused;
		const pausedById = this.mp.gameState.pausedBy || null;
		const pausedByName = pausedById ? (this.mp.gameState.players?.[pausedById]?.name || 'iemand') : 'iemand';

		indicator.className = `mp-turn-indicator ${isMyTurn ? 'my-turn' : 'other-turn'}`;

		// Gold counter — show goldCoins (spendable currency)
		const myPlayer = this.mp.getMyPlayer();
		const goldCoins = myPlayer?.goldCoins || 0;
		const level = this.mp.gameState?.level || 1;

		indicator.innerHTML = `
			<div class="mp-turn-label">Level ${level} — Ronde ${turnCount}</div>
			<div class="mp-turn-player">
				${isPaused
					? `⏸ Gepauzeerd door ${this._escapeHtml(pausedByName)}`
					: (isMyTurn
					? (cardPlayed ? '🎯 Speel bonussen of beëindig beurt!' : '🎯 Jouw beurt!')
					: `⏳ ${this._escapeHtml(current?.name || '???')} is aan zet`)}
			</div>
			${!isPaused ? `
				<div class="mp-turn-meta-row">
					<div class="mp-turn-inline-timer">
						<div class="mp-timer-bar"><div class="mp-timer-fill"></div></div>
						<span class="mp-timer-text">40s</span>
					</div>
					${goldCoins > 0 ? `<div class="mp-gold-counter">💰 ${goldCoins} goud</div>` : ''}
				</div>
			` : ''}
		`;

		// Toon/verberg knoppen
		const passBtn = this.elements['mp-pass-btn'];
		const endTurnBtn = this.elements['mp-end-turn-btn'];
		const undoBtn = this.elements['mp-undo-btn'];

		if (isPaused) {
			if (passBtn) passBtn.style.display = 'none';
			if (endTurnBtn) endTurnBtn.style.display = 'none';
			if (undoBtn) undoBtn.style.display = 'none';
			this._stopTurnTimer();
			return;
		}

		if (isMyTurn) {
			const hand = this.mp.getMyHand();
			const hasCards = hand && hand.length > 0;
			const undoData = this.mp.gameState?._turnUndoData;
			const canUndo = !!(
				undoData &&
				undoData.playerId === this.mp.userId &&
				(
					(Array.isArray(undoData.bonusMoves) && undoData.bonusMoves.length > 0) ||
					(Array.isArray(undoData.placedCells) && undoData.placedCells.length > 0)
				)
			);

			// Start timer altijd wanneer het mijn beurt is
			if (!this._turnTimerInterval) this._startTurnTimer();

			if (cardPlayed) {
				// Na kaart geplaatst: End Turn + Undo, geen Pas
				if (passBtn) passBtn.style.display = 'none';
				if (endTurnBtn) endTurnBtn.style.display = 'inline-flex';
				if (undoBtn) undoBtn.style.display = canUndo ? 'inline-flex' : 'none';
			} else if (!hasCards) {
				// Bonus-only beurt: End Turn, Undo alleen na bonusplaatsing
				if (passBtn) passBtn.style.display = 'none';
				if (endTurnBtn) endTurnBtn.style.display = 'inline-flex';
				if (undoBtn) undoBtn.style.display = canUndo ? 'inline-flex' : 'none';
			} else {
				// Nog geen kaart gespeeld: Pas beschikbaar + End Turn
				if (passBtn) passBtn.style.display = 'inline-flex';
				if (endTurnBtn) endTurnBtn.style.display = 'none';
				if (undoBtn) undoBtn.style.display = canUndo ? 'inline-flex' : 'none';
			}
		} else {
			if (passBtn) passBtn.style.display = 'none';
			if (endTurnBtn) endTurnBtn.style.display = 'none';
			if (undoBtn) undoBtn.style.display = 'none';
			const timerEl = this.elements['mp-turn-timer'];
			if (timerEl) timerEl.style.display = 'none';
			if (!this._turnTimerInterval) this._startTurnTimer();
		}
	}

	_updateRoomCodeBadge() {
		const badge = this.elements['mp-room-code-badge'];
		if (!badge) return;
		const code = String(this.mp?.inviteCode || this.mp?.roomCode || '').toUpperCase().trim();
		badge.textContent = `Room: ${code || '------'}`;
	}

	_repositionScoreboardForMobile() {
		const scoreboard = this.elements['mp-scoreboard'];
		if (!scoreboard) return;
		const isTouch = this._isTouchLikeDevice();
		const topRight = document.querySelector('.mp-top-right');
		const sidebar = document.querySelector('.mp-sidebar');

		if (isTouch && topRight) {
			if (scoreboard.parentElement !== topRight) {
				topRight.insertBefore(scoreboard, topRight.firstChild || null);
			}
			scoreboard.classList.add('mp-scoreboard-inline');
			scoreboard.style.display = '';
			return;
		}

		scoreboard.classList.remove('mp-scoreboard-inline');
		if (sidebar && scoreboard.parentElement !== sidebar) {
			sidebar.insertBefore(scoreboard, sidebar.firstChild || null);
		}
	}

	// ──────────────────────────────────────────
	//  SCOREBOARD
	// ──────────────────────────────────────────

	_renderScoreboard() {
		const container = this.elements['mp-scoreboard'];
		if (!container) return;
		this._repositionScoreboardForMobile();

		const scoreboard = this.mp.getScoreboard();
		const sorted = [...scoreboard];

		container.innerHTML = sorted.map((p, rank) => {
			const bd = p.scoreBreakdown || {};
			const inv = p.bonusInventory || {};
			const totalBonuses = Object.values(inv).reduce((sum, v) => sum + v, 0);
			const cardsRemaining = p.cardsLeft + p.handSize;
			const discardCount = typeof p.discardPileSize === 'number' ? p.discardPileSize : (Array.isArray(p.discardPile) ? p.discardPile.length : 0);

			const bonusColors = {
				yellow: '#cfba51', green: '#92c28c', blue: '#5689b0',
				red: '#b56069', purple: '#8f76b8', any: '#c47bd7'
			};
			const bonusDots = totalBonuses > 0
				? Object.entries(inv).filter(([,v]) => v > 0).map(([c, v]) => {
					const dotStyle = c === 'any'
						? 'background: linear-gradient(135deg, #cfba51 0%, #92c28c 24%, #5689b0 48%, #b56069 72%, #8f76b8 100%); border: 1px solid rgba(255,255,255,0.45);'
						: `background:${bonusColors[c] || '#888'}`;
					return `<span class="mp-sb-bonus-dot" style="${dotStyle}" title="${c}: ${v}">x${v}</span>`;
				}).join('')
				: '';

			return `
				<div class="mp-score-row ${p.isMe ? 'is-me' : ''} ${p.isCurrentTurn ? 'is-active' : ''} ${!p.connected ? 'disconnected' : ''}">
					<div class="mp-score-header">
						<span class="mp-score-rank">${rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : rank + 1}</span>
						<span class="mp-score-name">
							${p.isCurrentTurn ? '▶ ' : ''}${this._escapeHtml(p.name)}
							${p.isMe ? ' <small>(jij)</small>' : ''}
							${!p.connected ? ' <small class="mp-offline-badge">offline</small>' : ''}
						</span>
						<span class="mp-score-value-big">${p.score}<small>pt</small></span>
					</div>
					<div class="mp-score-details">
						<div class="mp-score-zones">
							<span class="mp-sz" style="background:#cfba51" title="Geel">${bd.yellow || 0}</span>
							<span class="mp-sz" style="background:#92c28c" title="Groen">${bd.green || 0}</span>
							<span class="mp-sz" style="background:#5689b0" title="Blauw">${bd.blue || 0}</span>
							<span class="mp-sz" style="background:#b56069" title="Rood">${bd.red || 0}</span>
							<span class="mp-sz" style="background:#8f76b8" title="Paars">${bd.purple || 0}</span>
						</div>
						<div class="mp-score-meta">
							<span class="mp-score-cards" title="Kaarten over" data-count="${cardsRemaining}">🃏 ${cardsRemaining}</span>
							${discardCount > 0 ? `<span class="mp-score-discard" title="Aflegstapel" data-count="${discardCount}">🗑 ${discardCount}</span>` : ''}
							${totalBonuses > 0 ? `<span class="mp-score-bonuses" title="Bonussen">${bonusDots}</span>` : ''}
						</div>
					</div>
				</div>
			`;
		}).join('');
	}

	// ──────────────────────────────────────────
	//  OPPONENT PANELS
	// ──────────────────────────────────────────

	_renderOpponentPanels() {
		let container = document.getElementById('mp-opponent-panels');
		if (!container) {
			container = document.createElement('div');
			container.id = 'mp-opponent-panels';
			container.className = 'mp-opponent-panels';
			// Insert after scoreboard
			const scoreboard = this.elements['mp-scoreboard'];
			if (scoreboard) scoreboard.after(container);
			else return;
		}

		if (!this.mp.gameState) {
			container.innerHTML = '';
			if (this.elements['mp-scoreboard']) this.elements['mp-scoreboard'].style.display = '';
			return;
		}

		const isTouch = this._isTouchLikeDevice();
		if (this.elements['mp-scoreboard']) {
			this.elements['mp-scoreboard'].style.display = isTouch ? '' : 'none';
		}

		const unifiedPlayers = this.mp.getScoreboard()
			.map((sb, rank) => {
				const p = this.mp.gameState.players[sb.id] || {};
				return {
					id: sb.id,
					rank,
					isMe: sb.isMe,
					name: sb.name,
					score: sb.score,
					connected: sb.connected,
					cardsLeft: sb.cardsLeft,
					handSizeScore: sb.handSize,
					...p
				};
			});

		const objectivesRevealed = this.mp.gameState._objectivesRevealed || false;

		container.innerHTML = unifiedPlayers.map(opp => {
			const hand = Array.isArray(opp.hand) ? opp.hand : [];
			const handSize = hand.length;
			const drawPileSize = typeof opp.drawPile === 'number' ? opp.drawPile : (Array.isArray(opp.drawPile) ? opp.drawPile.length : 0);
			const totalCards = handSize + drawPileSize;
			const isCurrentTurn = this.mp.gameState.playerOrder[this.mp.gameState.currentTurnIndex] === opp.id;
			const cardsPlayed = opp.cardsPlayed || 0;
			const selection = this._activeSelections[opp.id] || null;
			const selectedCardId = (selection && selection.mode === 'card') ? (selection.cardId || null) : null;
			const selectedCardName = (selection && selection.mode === 'card') ? (selection.cardName || null) : null;

			// Hand kaarten als mini-cards met vorm
			const handCards = hand.map(c => {
				const colorCode = c.colorCode || c.color?.code || '#555';
				const isSelected = selectedCardId
					? c.id === selectedCardId
					: (selectedCardName ? c.shapeName === selectedCardName : false);
				if (c.matrix) {
					// Toon de vorm als mini-grid
					const miniGrid = this._renderMiniGrid(c.matrix, { code: colorCode });
					return `<div class="mp-opp-card-detail ${isSelected ? 'is-selected-by-player' : ''}" title="${this._escapeHtml(c.shapeName || c.category || '?')}">
						<div class="mp-opp-card-shape">${miniGrid}</div>
						${c.shapeName ? `<div class="mp-opp-card-label">${this._escapeHtml(c.shapeName)}</div>` : ''}
					</div>`;
				}
				return `<div class="mp-opp-card-mini ${isSelected ? 'is-selected-by-player' : ''}" style="background:${colorCode}" title="${c.category || '?'}"></div>`;
			}).join('');

			// Objective
			let objectiveHtml = '';
			if (opp.chosenObjective) {
				const achieved = opp.objectiveAchieved || false;
				const failed = !achieved && !!opp.objectiveFailed;
				const progress = opp.objectiveProgress || null;
				if (achieved) {
					// Objective behaald — altijd zichtbaar
					const obj = opp.chosenObjective.hidden ? null : opp.chosenObjective;
					const objName = obj ? this._escapeHtml(obj.name || '???') : 'Doel behaald';
					const pts = progress ? progress.points : '';
					objectiveHtml = `<div class="mp-opp-objective mp-opp-objective-achieved">
						<span class="mp-opp-obj-icon">✅</span>
						<span class="mp-opp-obj-text">${objName}</span>
						${pts ? `<span class="mp-opp-obj-points">+${pts}pt</span>` : ''}
					</div>`;
				} else if (opp.chosenObjective.hidden && !objectivesRevealed) {
					objectiveHtml = `<div class="mp-opp-objective mp-opp-objective-hidden">
						<span class="mp-opp-obj-icon">🎯</span>
						<span class="mp-opp-obj-text">Geheim doel</span>
					</div>`;
				} else {
					const obj = opp.chosenObjective;
					const progressText = progress ? `${progress.current}/${progress.target}` : '';
					objectiveHtml = `<div class="mp-opp-objective ${failed ? 'mp-opp-objective-failed' : 'mp-opp-objective-revealed'} ${obj._revealed ? 'just-revealed' : ''}">
						<span class="mp-opp-obj-icon">${failed ? '❌' : '🎯'}</span>
						<span class="mp-opp-obj-text">${this._escapeHtml(obj.name || '???')}</span>
						${failed
							? `<span class="mp-opp-obj-cards">Niet haalbaar</span>`
							: (progressText ? `<span class="mp-opp-obj-cards">${progressText}</span>` : '')}
					</div>`;
				}
			}

			return `
				<div class="mp-opponent-panel ${isCurrentTurn ? 'is-active' : ''} ${!opp.connected ? 'disconnected' : ''}">
					<div class="mp-opp-header">
						<div class="mp-opp-head-main">
							<span class="mp-opp-name">${opp.rank === 0 ? '🥇 ' : opp.rank === 1 ? '🥈 ' : opp.rank === 2 ? '🥉 ' : ''}${isCurrentTurn ? '▶ ' : ''}${this._escapeHtml(opp.name)}${opp.isMe ? ' (jij)' : ''}</span>
							${isCurrentTurn ? `<span class="mp-opp-timer" data-player-id="${opp.id}">⏱ 40s</span>` : ''}
						</div>
						<span class="mp-opp-score">${opp.score || 0}pt</span>
					</div>
					<div class="mp-opp-hand">
						<span class="mp-opp-hand-label">Hand (${handSize}):</span>
						<div class="mp-opp-hand-cards">${handCards || '<span class="mp-opp-no-cards">leeg</span>'}</div>
					</div>
					<div class="mp-opp-stats">
						<span class="mp-opp-cards-left" title="Totaal kaarten over" data-count="${totalCards}">🃏 ${totalCards}</span>
						<span title="Kaarten gespeeld">✅ ${cardsPlayed} gespeeld</span>
					</div>
					${objectiveHtml}
				</div>
			`;
		}).join('');
	}

	_onObjectivesRevealed() {
		if (this._objectivesRevealed) return;
		this._objectivesRevealed = true;
		this._playRevealSound();
		setTimeout(() => this._playRevealSound(), 220);
		this._showToast('🎯 Geheime doelstellingen onthuld!', 'info');
		this._renderOpponentPanels();
		this._showObjectiveRevealOverlay();

		// Flash animation op alle opponent objective panels
		setTimeout(() => {
			document.querySelectorAll('.mp-opp-objective-revealed.just-revealed').forEach(el => {
				el.classList.add('reveal-flash');
			});
		}, 100);
	}

	_showObjectiveRevealOverlay() {
		const overlay = document.createElement('div');
		overlay.className = 'mp-objective-reveal-overlay';
		overlay.innerHTML = `
			<div class="mp-objective-reveal-icon">🎯</div>
			<div class="mp-objective-reveal-title">GEHEIME DOELSTELLINGEN ONTHULD</div>
			<div class="mp-objective-reveal-sub">Iedereen ziet nu elkaars doel</div>
		`;
		document.body.appendChild(overlay);

		requestAnimationFrame(() => overlay.classList.add('active'));
		setTimeout(() => {
			overlay.classList.remove('active');
			overlay.classList.add('fade-out');
			setTimeout(() => overlay.remove(), 450);
		}, 1700);
	}

	_onTimeBombed(data) {
		const { bomberPlayerName, bombedPlayerId, bombedPlayerName } = data;
		const isMe = bombedPlayerId === this.mp.userId;

		// Geluid
		this._playBombSound();

		// Volledig scherm explosie-overlay
		const overlay = document.createElement('div');
		overlay.className = 'mp-bomb-overlay';
		overlay.innerHTML = `
			<div class="mp-bomb-emoji">💣💥</div>
			<div class="mp-bomb-text">
				${isMe
					? `${bomberPlayerName} heeft een tijdbom op jou gebruikt!<br>Je beurt is voorbij!`
					: `${bomberPlayerName} heeft een tijdbom op ${bombedPlayerName} gebruikt!`
				}
			</div>
		`;
		document.body.appendChild(overlay);

		// Animatie starten
		requestAnimationFrame(() => overlay.classList.add('active'));

		// Na 2 seconden verwijderen
		setTimeout(() => {
			overlay.classList.remove('active');
			overlay.classList.add('fade-out');
			setTimeout(() => overlay.remove(), 500);
		}, 2000);

		// Toast
		if (isMe) {
			this._showToast('💣 Je beurt is gestopt door een tijdbom!', 'warning');
		} else {
			this._showToast(`💣 ${bomberPlayerName} bombardeerde ${bombedPlayerName}!`, 'info');
		}
	}

	async _handleTaunt(text) {
		if (!text) return;
		if (this.mp.gameState?.phase !== 'playing') return;

		try {
			await this.mp.sendTaunt(text);
			const tauntMenu = document.getElementById('mp-taunt-menu');
			if (tauntMenu && tauntMenu.hasAttribute('open')) tauntMenu.removeAttribute('open');
		} catch (err) {
			this._showToast('Taunt mislukt: ' + (err.message || err), 'warning');
		}
	}

	_onTaunt(data) {
		const playerName = data?.playerName || 'Speler';
		const text = data?.text || '';
		if (!text) return;
		const isMe = data?.playerId === this.mp.userId;
		this._showTauntBubble(playerName, text, isMe);
		this._playTauntSound();
	}

	_showTauntBubble(playerName, text, isMe = false) {
		let feed = document.getElementById('mp-taunt-feed');
		if (!feed) {
			feed = document.createElement('div');
			feed.id = 'mp-taunt-feed';
			feed.className = 'mp-taunt-feed';
			document.body.appendChild(feed);
		}

		const bubble = document.createElement('div');
		bubble.className = `mp-taunt-bubble ${isMe ? 'is-me' : 'is-other'}`;
		bubble.innerHTML = `
			<div class="mp-taunt-bubble-name">${this._escapeHtml(playerName)}</div>
			<div class="mp-taunt-bubble-text">${this._escapeHtml(text)}</div>
		`;
		feed.prepend(bubble);

		const bubbles = feed.querySelectorAll('.mp-taunt-bubble');
		if (bubbles.length > 4) {
			bubbles[bubbles.length - 1].remove();
		}

		requestAnimationFrame(() => bubble.classList.add('visible'));
		setTimeout(() => {
			bubble.classList.remove('visible');
			bubble.classList.add('leaving');
			setTimeout(() => bubble.remove(), 260);
		}, 2400);
	}

	// ──────────────────────────────────────────
	//  HAND (kaarten) — met DRAG en DROP
	// ──────────────────────────────────────────

	_renderHand() {
		const container = this.elements['mp-hand-container'];
		if (!container) return;

		const hand = this.mp.getMyHand();
		const isMyTurn = this.mp.isMyTurn();

		if (!hand || hand.length === 0) {
			// Check if player still has bonuses
			const myPlayer = this.mp.getMyPlayer();
			const hasBonuses = myPlayer?.bonusInventory &&
				Object.values(myPlayer.bonusInventory).some(v => v > 0);

			if (isMyTurn && hasBonuses) {
				container.innerHTML = `<div class="mp-hand-empty mp-hand-bonus-turn">
					⚡ Geen kaarten meer — speel je bonussen of pas!
				</div>`;
			} else if (hasBonuses) {
				container.innerHTML = `<div class="mp-hand-empty">
					⏳ Wacht op je beurt om bonussen te spelen...
				</div>`;
			} else {
				container.innerHTML = `<div class="mp-hand-empty">
					${isMyTurn ? 'Geen kaarten meer — wachten...' : 'Wacht op je beurt...'}
				</div>`;
			}
			return;
		}

		const cardPlayed = this.mp.gameState?._cardPlayedThisTurn || false;

		container.innerHTML = hand.map(card => {
			const colorStyle = card.isGolden
				? `background: linear-gradient(135deg, ${card.color?.code || '#f5d76e'}, #f5d76e, ${card.color?.code || '#f5d76e'})`
				: card.color?.code === 'rainbow'
					? 'background: linear-gradient(135deg, #b56069, #cfba51, #92c28c, #5689b0, #8f76b8)'
					: `background: ${card.color?.code || '#666'}`;

			const allowedZones = this._getAllowedZoneLabels(card);

			// Na het plaatsen van 1 kaart: overige kaarten worden 'spent' (transparant, niet speelbaar)
			// Gouden kaarten blijven speelbaar (extra play)
			let cardClass = 'mp-card';
			if (!isMyTurn) {
				cardClass += ' disabled';
			} else if (cardPlayed && !card.isGolden) {
				cardClass += ' card-spent';
			} else {
				cardClass += ' playable';
			}
			if (card.isGolden) cardClass += ' golden';

			return `
				<div class="${cardClass}"
					 data-card-id="${card.id}"
					 data-shape="${card.shapeName}"
					 touch-action="none">
					<div class="mp-card-color" style="${colorStyle}"></div>
					<div class="mp-card-shape">
						${this._renderMiniGrid(card.matrix, card.color)}
					</div>
					<div class="mp-card-name">${this._escapeHtml(card.shapeName)}</div>
					<div class="mp-card-info">
						<span class="mp-card-category">${card.category}</span>
						<span class="mp-card-zones">${allowedZones}</span>
					</div>
					${card.isGolden ? '<div class="mp-card-extra-badge">⭐ EXTRA</div>' : ''}
				</div>
			`;
		}).join('');

		// Bind pointer events voor drag (ook golden kaarten na card played)
		if (isMyTurn) {
			container.querySelectorAll('.mp-card.playable').forEach(cardEl => {
				cardEl.addEventListener('pointerdown', (e) => this._onCardPointerDown(e, cardEl));
			});
		}
	}

	_getAllowedZoneLabels(card) {
		const Rules = window.LocusGameRules;
		if (!Rules) return '';
		const zones = Rules.getAllowedZones(card);
		if (zones.length === 5) return '★';
		const labels = { yellow: 'G', green: 'Gr', blue: 'B', red: 'R', purple: 'P' };
		return zones.map(z => labels[z] || z).join('');
	}

	// ──────────────────────────────────────────
	//  DECK OVERVIEW
	// ──────────────────────────────────────────

	_updateDeckCount() {
		const player = this.mp.getMyPlayer();
		if (!player) return;
		const pile = player.drawPile;
		const count = Array.isArray(pile) ? pile.length : (pile || 0);
		const el = this.elements['mp-deck-count'];
		if (el) el.textContent = count;
	}

	_toggleDeckOverview() {
		const overlay = this.elements['mp-deck-overlay'];
		if (!overlay) return;
		if (overlay.style.display === 'none' || !overlay.style.display) {
			this._renderDeckOverview();
			overlay.style.display = 'flex';
		} else {
			overlay.style.display = 'none';
		}
	}

	_closeDeckOverview() {
		const overlay = this.elements['mp-deck-overlay'];
		if (overlay) overlay.style.display = 'none';
	}

	_renderDeckOverview() {
		const container = this.elements['mp-deck-cards'];
		if (!container) return;

		const player = this.mp.getMyPlayer();
		if (!player) { container.innerHTML = '<p>Geen deck beschikbaar.</p>'; return; }

		const pile = player.drawPile || [];
		const hand = player.hand || [];
		const deck = player.deck || [];

		// Determine used cards: in original deck but NOT in drawPile and NOT in hand
		const remainingIds = new Set([...pile.map(c => c.id), ...hand.map(c => c.id)]);
		const usedCards = deck.filter(c => !remainingIds.has(c.id));

		const renderCardList = (cards, dimmed = false) => {
			if (!cards.length) return '<p style="color: var(--mp-text-dim); font-style: italic; margin: 4px 0;">Geen kaarten</p>';
			return `<div class="mp-deck-group-cards">
				${cards.map(card => {
					const colorStyle = card.isGolden
						? `background: linear-gradient(135deg, ${card.color?.code || '#f5d76e'}, #f5d76e, ${card.color?.code || '#f5d76e'})`
						: card.color?.code === 'rainbow'
							? 'background: linear-gradient(135deg, #b56069, #cfba51, #92c28c, #5689b0, #8f76b8)'
							: `background: ${card.color?.code || '#666'}`;
					return `
						<div class="mp-deck-card ${dimmed ? 'mp-deck-card-used' : ''}">
							<div class="mp-card-color" style="${colorStyle}"></div>
							<div class="mp-card-shape">
								${this._renderMiniGrid(card.matrix, card.color)}
							</div>
							<div class="mp-card-name">${this._escapeHtml(card.shapeName)}</div>
						</div>
					`;
				}).join('')}
			</div>`;
		};

		container.innerHTML = `
			<div class="mp-deck-section">
				<h4 class="mp-deck-section-title">📥 Nog in stapel (${pile.length})</h4>
				${renderCardList(pile)}
			</div>
			${hand.length > 0 ? `
				<div class="mp-deck-section">
					<h4 class="mp-deck-section-title">✋ In hand (${hand.length})</h4>
					${renderCardList(hand)}
				</div>
			` : ''}
			${usedCards.length > 0 ? `
				<div class="mp-deck-section">
					<h4 class="mp-deck-section-title">✅ Gespeeld / weggegooid (${usedCards.length})</h4>
					${renderCardList(usedCards, true)}
				</div>
			` : ''}
		`;
	}

	// ──────────────────────────────────────────
	//  DRAG AND DROP
	// ──────────────────────────────────────────

	_onCardPointerDown(e, cardEl) {
		// Cancel bonus mode als die actief is
		this._cancelBonusMode();

		// Blokkeer als er al een kaart gespeeld is deze beurt
		if (this.mp.gameState?._cardPlayedThisTurn) return;

		if (this._isDragging) {
			// Klik op dezelfde kaart? Toggle uit. Andere kaart? Wissel.
			const isSameCard = this._dragState?.card?.id === cardEl.dataset.cardId;
			this._cancelDrag();
			if (isSameCard) return;
		}
		e.preventDefault();

		const cardId = cardEl.dataset.cardId;
		const hand = this.mp.getMyHand();
		const card = hand.find(c => c.id === cardId);
		if (!card) return;

		const Rules = window.LocusGameRules;
		if (!Rules) return;

		// State setup
		this._dragState = {
			card,
			matrix: Rules.cloneMatrix(card.matrix),
			rotation: 0,
			mirrored: false,
			originEl: cardEl
		};
		this._isDragging = true;
		this._setTouchDragScrollLock(e.pointerType === 'touch' || e.pointerType === 'pen' || this._isTouchLikeDevice());

		// Verberg cursor tijdens plaatsing
		document.body.classList.add('mp-placing');

		// Selecteer kaart visueel
		document.querySelectorAll('.mp-card').forEach(el => el.classList.remove('selected', 'dragging'));
		cardEl.classList.add('selected', 'dragging');

		// Maak ghost element
		this._createGhost(e);
		this._sendInteraction('start', {
			mode: 'card',
			cardId: card.id,
			cardName: card.shapeName,
			colorCode: card.color?.code || null,
			matrix: this._dragState.matrix
		});

		// Placement controls
		this._showPlacementControls(card);

		// Board in placement mode
		const board = document.querySelector('.mp-board');
		if (board) board.classList.add('placement-mode');

		// Touch/coarse: spring direct naar de bijbehorende kleur-zone bij single-color kaarten
		const allowedZones = Rules.getAllowedZones(card);
		if (allowedZones.length === 1 && (e.pointerType === 'touch' || e.pointerType === 'pen' || this._isTouchLikeDevice())) {
			this._scrollMobileBoardToZone(allowedZones[0], true);
		}

		// Ghost volgt muis (click-move-click: geen knop ingedrukt houden)
		document.addEventListener('pointermove', this._onPointerMove);
		document.addEventListener('pointerup', this._onPlacementPointerUpCancel);

		// Klik op bord-cellen om te plaatsen
		this._enableClickPlacement();
	}

	_createGhost(e) {
		if (!this._dragState) return;

		const ghost = document.createElement('div');
		ghost.className = 'mp-drag-ghost';
		ghost.innerHTML = this._renderMiniGrid(
			this._dragState.matrix,
			this._dragState.card.color,
			true,
			true  // forGhost: use CSS-based sizing
		);
		ghost.style.pointerEvents = 'none';
		document.body.appendChild(ghost);
		this._dragState.ghostEl = ghost;

		// Compute center offsets for the shape so cursor stays at shape center
		this._computeGhostOffsets();
		this._positionGhost(e);
	}

	_computeGhostOffsets() {
		const ghost = this._dragState?.ghostEl;
		if (!ghost) { this._ghostOffsetX = 0; this._ghostOffsetY = 0; return; }

		// Force layout
		void ghost.offsetHeight;

		const matrix = this._dragState.matrix;
		if (!matrix || !matrix.length) { this._ghostOffsetX = 0; this._ghostOffsetY = 0; return; }

		// Measure cell size from rendered ghost
		const sampleCell = ghost.querySelector('.mp-mini-cell');
		if (!sampleCell) { this._ghostOffsetX = 0; this._ghostOffsetY = 0; return; }

		const cellRect = sampleCell.getBoundingClientRect();
		const cellSize = Math.min(cellRect.width, cellRect.height);
		const gridEl = ghost.querySelector('.mp-mini-grid');
		const gridStyle = gridEl ? getComputedStyle(gridEl) : null;
		const gap = gridStyle ? (parseFloat(gridStyle.gap) || parseFloat(gridStyle.columnGap) || 0) : 0;
		const step = cellSize + gap;

		// Find center of filled cells
		let sumC = 0, sumR = 0, count = 0;
		for (let r = 0; r < matrix.length; r++) {
			for (let c = 0; c < (matrix[r]?.length || 0); c++) {
				if (matrix[r][c]) { sumR += r; sumC += c; count++; }
			}
		}
		if (count === 0) { this._ghostOffsetX = 0; this._ghostOffsetY = 0; return; }

		const avgC = sumC / count;
		const avgR = sumR / count;
		this._ghostOffsetX = (avgC + 0.5) * step;
		this._ghostOffsetY = (avgR + 0.5) * step;
	}

	_positionGhost(e) {
		const ghost = this._dragState?.ghostEl;
		if (!ghost) return;

		// Touch offset like index.html: lift shape above finger
		const touchOffsetY = this._getFingerLiftOffset(e);
		ghost.style.left = (e.clientX - (this._ghostOffsetX || 0)) + 'px';
		ghost.style.top = (e.clientY - (this._ghostOffsetY || 0) - touchOffsetY) + 'px';
	}

	/** Touch finger lift offset (matches index.html TOUCH_FINGER_LIFT_PX = 28) */
	_getFingerLiftOffset(e) {
		if (e.pointerType === 'touch' || e.pointerType === 'pen') return 28;
		// Fallback: mobile layout with touch capability
		if (window.innerWidth <= 480 && ('ontouchstart' in window) && window.matchMedia?.('(pointer: coarse)')?.matches) return 28;
		return 0;
	}

	_updateGhost() {
		if (!this._dragState?.ghostEl) return;
		this._dragState.ghostEl.innerHTML = this._renderMiniGrid(
			this._dragState.matrix,
			this._dragState.card.color,
			true,
			true  // forGhost
		);
		this._computeGhostOffsets();
	}

	_onPointerMove = (e) => {
		if (!this._isDragging || !this._dragState) return;
		if (this._touchDragScrollLocked && (e.pointerType === 'touch' || e.pointerType === 'pen')) {
			e.preventDefault();
		}

		this._positionGhost(e);

		// Throttle preview ~30fps
		if (this._throttleTimer) return;
		this._throttleTimer = setTimeout(() => {
			this._throttleTimer = null;
			this._updateDragPreview(e);
		}, 33);
	};

	_onPlacementPointerUpCancel = (e) => {
		if (!this._isDragging || !this._dragState) return;

		const isTouchLikeRelease = e.pointerType === 'touch' || e.pointerType === 'pen';
		if (isTouchLikeRelease) {
			// Mobiel: plaats direct op release als preview geldig is; annuleer niet agressief op loslaten.
			if (this._attemptPlacementFromCurrentPreview()) return;
			return;
		}

		const target = e.target;
		const insideBoard = target?.closest?.('#mp-board-container .mp-cell:not(.void), #mp-board-container .mp-grid, #mp-board-container .mp-zone');
		const inControls = target?.closest?.('#mp-placement-controls');
		const inHand = target?.closest?.('.mp-card');
		if (!insideBoard && !inControls && !inHand) {
			this._cancelDrag();
			this._showToast('Plaatsing geannuleerd', 'info');
		}
	};

	_onPointerUp = (e) => {
		if (!this._isDragging || !this._dragState) return;

		document.removeEventListener('pointermove', this._onPointerMove);
		document.removeEventListener('pointerup', this._onPointerUp);

		// Als preview al groen/geldig was, plaats exact die preview-locatie
		if (this._attemptPlacementFromCurrentPreview()) return;

		const ghost = this._dragState.ghostEl;
		const matrix = this._dragState.matrix;

		// Per-cell hit testing for drop (same approach as hover)
		if (ghost && matrix && matrix.length) {
			const gridEl = ghost.querySelector('.mp-mini-grid');
			if (gridEl) {
				// CRITICAL: Measure cell metrics BEFORE hiding the ghost
				const sampleCell = ghost.querySelector('.mp-mini-cell');
				const cellRect = sampleCell ? sampleCell.getBoundingClientRect() : null;
				const cellSize = cellRect ? Math.max(Math.min(cellRect.width, cellRect.height), 1) : 20;
				const gridStyle = getComputedStyle(gridEl);
				const gap = gridStyle ? (parseFloat(gridStyle.gap) || parseFloat(gridStyle.columnGap) || 0) : 0;
				const step = cellSize + gap;
				const ghostRect = gridEl.getBoundingClientRect();

				ghost.style.display = 'none';

				const cellHits = [];
				for (let row = 0; row < matrix.length; row++) {
					for (let col = 0; col < (matrix[row]?.length || 0); col++) {
						if (!matrix[row][col]) continue;
						const hitX = ghostRect.left + (col * step) + (cellSize / 2);
						const hitY = ghostRect.top + (row * step) + (cellSize / 2);
						const elem = document.elementFromPoint(hitX, hitY);
						const gridCell = elem ? elem.closest('.mp-cell:not(.void)') : null;
						if (!gridCell || gridCell.dataset.x === undefined || gridCell.dataset.y === undefined) continue;
						cellHits.push({
							shapeRow: row, shapeCol: col,
							gridX: parseInt(gridCell.dataset.x, 10),
							gridY: parseInt(gridCell.dataset.y, 10),
							zoneName: gridCell.dataset.zone,
							subgridId: gridCell.dataset.subgrid || null
						});
					}
				}

				ghost.style.display = '';

				if (cellHits.length > 0) {
					const zoneCounts = {};
					cellHits.forEach(h => { if (h.zoneName) zoneCounts[h.zoneName] = (zoneCounts[h.zoneName] || 0) + 1; });
					const bestZone = Object.keys(zoneCounts).reduce((a, b) => zoneCounts[a] > zoneCounts[b] ? a : b);
					const zoneHits = cellHits.filter(h => h.zoneName === bestZone);
					if (zoneHits.length > 0) {
						const baseX = this._pickBestVote(zoneHits.map(h => h.gridX - h.shapeCol), null);
						const baseY = this._pickBestVote(zoneHits.map(h => h.gridY - h.shapeRow), null);
						const subgridId = zoneHits[0]?.subgridId || null;
						this._attemptPlacement(bestZone, baseX, baseY, subgridId);
						return;
					}
				}
			}
		}

		// Fallback: single-point detection
		if (ghost) ghost.style.display = 'none';
		const target = document.elementFromPoint(e.clientX, e.clientY);
		if (ghost) ghost.style.display = '';

		const cell = target?.closest('.mp-cell:not(.void)');

		if (cell) {
			const x = Number(cell.dataset.x);
			const y = Number(cell.dataset.y);
			const zoneName = cell.dataset.zone;
			const subgridId = cell.dataset.subgrid || null;

			if (zoneName && Number.isFinite(x) && Number.isFinite(y)) {
				const adj = this._adjustBaseForMatrix(x, y, this._dragState.matrix);
				this._attemptPlacement(zoneName, adj.x, adj.y, subgridId);
				return;
			}
		}

		// Drop niet op een cell → ghost verwijderen, click-fallback aanzetten
		this._removeGhost();
		this._isDragging = false;
		this._enableClickPlacement();
	};

	_removeGhost() {
		if (this._dragState?.ghostEl) {
			this._dragState.ghostEl.remove();
			this._dragState.ghostEl = null;
		}
	}

	_attemptPlacementFromCurrentPreview() {
		if (!this._dragState) return false;
		if (!this._lastPreviewZone || !Array.isArray(this._lastPreviewCells) || this._lastPreviewCells.length === 0) return false;
		if (!Number.isFinite(this._lastPreviewBaseX) || !Number.isFinite(this._lastPreviewBaseY)) return false;

		this._attemptPlacement(
			this._lastPreviewZone,
			this._lastPreviewBaseX,
			this._lastPreviewBaseY,
			this._lastPreviewSubgridId || null
		);
		this._sendInteraction('end', { mode: 'card' });
		return true;
	}

	_updateDragPreview(e) {
		if (!this._dragState) return;

		this._clearPreview();

		const ghost = this._dragState.ghostEl;
		const matrix = this._dragState.matrix;
		if (!ghost || !matrix || !matrix.length) return;

		const cellHits = this._collectHoveredShapeCellHits(ghost, matrix, 3);

		if (cellHits.length === 0) return;

		// Vote for best zone
		const zoneCounts = {};
		cellHits.forEach(h => {
			if (!h.zoneName) return;
			zoneCounts[h.zoneName] = (zoneCounts[h.zoneName] || 0) + 1;
		});
		const bestZone = Object.keys(zoneCounts).reduce((a, b) => zoneCounts[a] > zoneCounts[b] ? a : b);
		const zoneHits = cellHits.filter(h => h.zoneName === bestZone);
		if (zoneHits.length === 0) return;

		// Vote for best base coordinates
		const baseXCandidates = zoneHits.map(h => h.gridX - h.shapeCol);
		const baseYCandidates = zoneHits.map(h => h.gridY - h.shapeRow);
		const baseX = this._pickBestVote(baseXCandidates, this._lastDragBaseX);
		const baseY = this._pickBestVote(baseYCandidates, this._lastDragBaseY);
		this._lastDragBaseX = baseX;
		this._lastDragBaseY = baseY;

		const subgridId = zoneHits[0]?.subgridId || null;

		// Kleur-check: kaart mag alleen op matching zone geplaatst worden
		const Rules = window.LocusGameRules;
		if (this._dragState?.card && Rules) {
			const allowedZones = Rules.getAllowedZones(this._dragState.card);
			if (!allowedZones.includes(bestZone)) {
				this._sendInteraction('move', {
					mode: 'card',
					cardName: this._dragState.card?.shapeName || null,
					zoneName: bestZone,
					baseX,
					baseY,
					subgridId,
					matrix,
					isValid: false
				});
				// Verkeerde kleur/zone — toon rode preview
				if (ghost) { ghost.classList.add('preview-denied'); ghost.classList.remove('preview-ok'); }
				const boardState = this.mp.gameState?.boardState;
				if (boardState) {
					this._showDeniedPreviewCells(bestZone, baseX, baseY, matrix, boardState, zoneHits[0]?.gridCell);
				}
				return;
			}
		}

		const adjPreview = this.mp.previewPlacement(bestZone, baseX, baseY, matrix, subgridId);

		if (adjPreview.valid && adjPreview.cells) {
			this._lastPreviewZone = bestZone;
			this._lastPreviewCells = adjPreview.cells;
			this._lastPreviewBaseX = baseX;
			this._lastPreviewBaseY = baseY;
			this._lastPreviewSubgridId = subgridId;
			this._sendInteraction('move', {
				mode: 'card',
				cardName: this._dragState.card?.shapeName || null,
				zoneName: bestZone,
				baseX,
				baseY,
				subgridId,
				matrix,
				isValid: true
			});
			for (const coord of adjPreview.cells) {
				const sel = subgridId
					? `.mp-cell[data-zone="${bestZone}"][data-subgrid="${subgridId}"][data-x="${coord.x}"][data-y="${coord.y}"]`
					: `.mp-cell[data-zone="${bestZone}"][data-x="${coord.x}"][data-y="${coord.y}"]`;
				const el = document.querySelector(sel);
				if (el) el.classList.add('preview-valid');
			}
			if (ghost) { ghost.classList.remove('preview-denied'); ghost.classList.add('preview-ok'); }
		} else {
			this._sendInteraction('move', {
				mode: 'card',
				cardName: this._dragState.card?.shapeName || null,
				zoneName: bestZone,
				baseX,
				baseY,
				subgridId,
				matrix,
				isValid: false
			});
			if (ghost) { ghost.classList.add('preview-denied'); ghost.classList.remove('preview-ok'); }
			const boardState = this.mp.gameState?.boardState;
			if (boardState) {
				this._showDeniedPreviewCells(bestZone, baseX, baseY, matrix, boardState, zoneHits[0]?.gridCell);
			}
		}
	}

	_collectHoveredShapeCellHits(ghost, matrix, tolerancePx = 3) {
		if (!ghost || !matrix || !matrix.length) return [];

		const gridEl = ghost.querySelector('.mp-mini-grid');
		if (!gridEl) return [];

		const gridStyle = getComputedStyle(gridEl);
		const sampleCell = ghost.querySelector('.mp-mini-cell');
		const cellRect = sampleCell ? sampleCell.getBoundingClientRect() : null;
		const cellSize = cellRect ? Math.max(Math.min(cellRect.width, cellRect.height), 1) : 20;
		const gap = gridStyle ? (parseFloat(gridStyle.gap) || parseFloat(gridStyle.columnGap) || 0) : 0;
		const step = cellSize + gap;
		const ghostRect = gridEl.getBoundingClientRect();

		const prevPointerEvents = ghost.style.pointerEvents;
		const prevDisplay = ghost.style.display;
		ghost.style.pointerEvents = 'none';
		ghost.style.display = 'none';

		const originX = ghostRect.left;
		const originY = ghostRect.top;
		const sampleOffsets = [
			[0, 0],
			[tolerancePx, 0], [-tolerancePx, 0],
			[0, tolerancePx], [0, -tolerancePx],
			[tolerancePx, tolerancePx], [-tolerancePx, tolerancePx],
			[tolerancePx, -tolerancePx], [-tolerancePx, -tolerancePx]
		];

		const hits = [];
		const shapeHeight = matrix.length;
		const shapeWidth = matrix[0]?.length || 0;

		for (let row = 0; row < shapeHeight; row++) {
			for (let col = 0; col < shapeWidth; col++) {
				if (!matrix[row][col]) continue;

				const centerX = originX + (col * step) + (cellSize / 2);
				const centerY = originY + (row * step) + (cellSize / 2);
				let matchedCell = null;

				for (const [dx, dy] of sampleOffsets) {
					const elem = document.elementFromPoint(centerX + dx, centerY + dy);
					const gridCell = elem ? elem.closest('.mp-cell:not(.void)') : null;
					if (!gridCell || gridCell.dataset.x === undefined || gridCell.dataset.y === undefined) continue;
					matchedCell = gridCell;
					break;
				}

				if (!matchedCell) continue;
				hits.push({
					gridCell: matchedCell,
					shapeRow: row,
					shapeCol: col,
					gridX: parseInt(matchedCell.dataset.x, 10),
					gridY: parseInt(matchedCell.dataset.y, 10),
					zoneName: matchedCell.dataset.zone,
					subgridId: matchedCell.dataset.subgrid || null
				});
			}
		}

		ghost.style.display = prevDisplay || '';
		ghost.style.pointerEvents = prevPointerEvents || '';
		return hits;
	}

	/** Count occurrences and pick the most common value (tie-break: closest to previous) */
	_pickBestVote(values, previous) {
		const counts = new Map();
		for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
		let bestVal = null, bestCount = -1;
		for (const [val, cnt] of counts.entries()) {
			if (cnt > bestCount || (cnt === bestCount && Number.isFinite(previous) && Math.abs(val - previous) < Math.abs(bestVal - previous))) {
				bestCount = cnt;
				bestVal = val;
			}
		}
		return bestVal ?? values[0];
	}

	_enableClickPlacement() {
		// Event delegation op container (overleeft re-renders)
		const container = this.elements['mp-board-container'];
		if (!container) return;

		this._clickPlacementHandler = (e) => {
			if (!this._dragState) return;

			// Als preview geldig is, plaats exact die preview (niet opnieuw afleiden uit klikpunt)
			if (this._attemptPlacementFromCurrentPreview()) return;

			const cell = e.target.closest('.mp-cell:not(.void)');
			if (!cell) {
				this._cancelDrag();
				this._showToast('Plaatsing geannuleerd', 'info');
				return;
			}
			const x = Number(cell.dataset.x);
			const y = Number(cell.dataset.y);
			const zoneName = cell.dataset.zone;
			const subgridId = cell.dataset.subgrid || null;
			if (!zoneName || !Number.isFinite(x) || !Number.isFinite(y)) return;

			const adj = this._adjustBaseForMatrix(x, y, this._dragState.matrix);
			this._attemptPlacement(zoneName, adj.x, adj.y, subgridId);
		};

		container.addEventListener('click', this._clickPlacementHandler);
	}

	_disableClickPlacement() {
		const container = this.elements['mp-board-container'];
		if (container && this._clickPlacementHandler) {
			container.removeEventListener('click', this._clickPlacementHandler);
		}
		this._clickPlacementHandler = null;
	}

	async _attemptPlacement(zoneName, baseX, baseY, subgridId = null) {
		if (!this._dragState) return;
		const zoneIdx = this._getMobileZoneIndex(zoneName);
		if (Number.isFinite(zoneIdx)) {
			this._forcedMobileBoardIndex = zoneIdx;
			this._lastMobileBoardIndex = zoneIdx;
		}
		const stillInHand = (this.mp.getMyHand() || []).some(c => c.id === this._dragState.card.id);
		if (!stillInHand) {
			this._cancelDrag();
			this._showToast('Deze kaart is niet meer beschikbaar in je hand.', 'warning');
			return;
		}

		const preview = this.mp.previewPlacement(zoneName, baseX, baseY, this._dragState.matrix, subgridId);
		if (!preview.valid) {
			this._showToast('Ongeldige plaatsing!', 'warning');
			return;
		}

		// Use the subgridId from preview if we didn't have one (fallback)
		const resolvedSubgridId = subgridId || preview.subgridId || null;

		try {
			const result = await this.mp.playCard(
				this._dragState.card.id,
				zoneName, baseX, baseY,
				this._dragState.rotation,
				this._dragState.mirrored,
				resolvedSubgridId
			);

			this._cancelDrag();
			if (result.success) {
				// Timer loopt al vanuit begin van beurt
			}
		} catch (err) {
			this._showToast('Plaatsing mislukt: ' + err.message, 'error');
		}
	}

	_rotateCurrentShape() {
		const Rules = window.LocusGameRules;
		if (!Rules) return;

		if (this._dragState) {
			this._dragState.rotation = (this._dragState.rotation + 1) % 4;
			this._dragState.matrix = Rules.rotateMatrixN(this._dragState.card.matrix, this._dragState.rotation);
			if (this._dragState.mirrored) this._dragState.matrix = Rules.mirrorMatrix(this._dragState.matrix);
			this._updateGhost();
			this._clearPreview();
		}
		if (this._bonusMode) {
			this._bonusMode.rotation = ((this._bonusMode.rotation || 0) + 1) % 4;
			this._bonusMode.matrix = Rules.rotateMatrix90(this._bonusMode.matrix);
			this._updateBonusGhost();
		}
	}

	_mirrorCurrentShape() {
		const Rules = window.LocusGameRules;
		if (!Rules) return;

		if (this._dragState) {
			this._dragState.mirrored = !this._dragState.mirrored;
			this._dragState.matrix = Rules.rotateMatrixN(this._dragState.card.matrix, this._dragState.rotation);
			if (this._dragState.mirrored) this._dragState.matrix = Rules.mirrorMatrix(this._dragState.matrix);
			this._updateGhost();
			this._clearPreview();
		}
		if (this._bonusMode) {
			this._bonusMode.matrix = Rules.mirrorMatrix(this._bonusMode.matrix);
			this._updateBonusGhost();
		}
	}

	_cancelDrag() {
		this._sendInteraction('end', { mode: 'card' });
		this._removeGhost();
		this._clearPreview();
		this._disableClickPlacement();
		this._isDragging = false;
		this._dragState = null;
		this._lastDragBaseX = null;
		this._lastDragBaseY = null;
		this._ghostOffsetX = 0;
		this._ghostOffsetY = 0;

		// Herstel cursor
		document.body.classList.remove('mp-placing');

		const controls = document.getElementById('mp-placement-controls');
		if (controls) controls.remove();

		document.querySelectorAll('.mp-card').forEach(el => el.classList.remove('selected', 'dragging'));
		document.removeEventListener('pointermove', this._onPointerMove);
		document.removeEventListener('pointerup', this._onPointerUp);
		document.removeEventListener('pointerup', this._onPlacementPointerUpCancel);
		this._setTouchDragScrollLock(false);

		const board = document.querySelector('.mp-board');
		if (board) board.classList.remove('placement-mode');
	}

	_setTouchDragScrollLock(locked) {
		if (locked === this._touchDragScrollLocked) return;
		this._touchDragScrollLocked = !!locked;
		document.body.classList.toggle('mp-touch-drag-lock', this._touchDragScrollLocked);
		const boardContainer = this.elements['mp-board-container'] || document.getElementById('mp-board-container');
		if (boardContainer) boardContainer.classList.toggle('mp-touch-drag-lock', this._touchDragScrollLocked);
		const board = boardContainer?.querySelector('.mp-board') || document.querySelector('.mp-board');
		if (board) board.classList.toggle('mp-touch-drag-lock', this._touchDragScrollLocked);
	}

	/**
	 * Pas baseX/baseY aan zodat de geklikte cel overeenkomt met de eerste
	 * gevulde cel in de (geroteerde) matrix, niet met matrix[0][0].
	 * Zonder deze correctie vallen shapes met lege [0][0] naast de klik.
	 */
	_adjustBaseForMatrix(clickX, clickY, matrix) {
		if (!matrix || !matrix.length) return { x: clickX, y: clickY };
		// Bereken het centrum van alle gevulde cellen
		let filledCells = [];
		for (let r = 0; r < matrix.length; r++) {
			for (let c = 0; c < (matrix[r]?.length || 0); c++) {
				if (matrix[r][c]) {
					filledCells.push({ r, c });
				}
			}
		}
		if (filledCells.length === 0) return { x: clickX, y: clickY };
		// Centrum van de gevulde cellen
		const avgR = Math.round(filledCells.reduce((s, f) => s + f.r, 0) / filledCells.length);
		const avgC = Math.round(filledCells.reduce((s, f) => s + f.c, 0) / filledCells.length);
		return { x: clickX - avgC, y: clickY - avgR };
	}

	_clearPreview() {
		document.querySelectorAll('.mp-cell.preview-valid, .mp-cell.preview-denied').forEach(el => {
			el.classList.remove('preview-valid', 'preview-denied');
		});
		this._lastPreviewZone = null;
		this._lastPreviewCells = null;
		this._lastPreviewBaseX = null;
		this._lastPreviewBaseY = null;
		this._lastPreviewSubgridId = null;
	}

	_showPlacementControls(card) {
		const existing = document.getElementById('mp-placement-controls');
		if (existing) existing.remove();

		const controls = document.createElement('div');
		controls.id = 'mp-placement-controls';
		controls.innerHTML = `
			<span class="mp-ctrl-label">Plaatst: <strong>${this._escapeHtml(card.shapeName)}</strong></span>
			<button class="mp-ctrl-btn" id="mp-rotate-btn" title="Draai (R / scroll)">🔄</button>
			<button class="mp-ctrl-btn" id="mp-mirror-btn" title="Spiegel (T)">↔️</button>
			<button class="mp-ctrl-btn mp-ctrl-cancel" id="mp-cancel-btn" title="Annuleer (Esc)">✕</button>
		`;

		document.getElementById('game-screen')?.appendChild(controls);

		document.getElementById('mp-rotate-btn')?.addEventListener('click', () => this._rotateCurrentShape());
		document.getElementById('mp-mirror-btn')?.addEventListener('click', () => this._mirrorCurrentShape());
		document.getElementById('mp-cancel-btn')?.addEventListener('click', () => this._cancelDrag());
	}

	// ──────────────────────────────────────────
	//  BONUS BAR
	// ──────────────────────────────────────────

	_renderBonusBar(prevState) {
		const container = this.elements['mp-bonus-bar'];
		if (!container) return;

		const player = this.mp.getMyPlayer();
		if (!player) return;

		const inv = player.bonusInventory || {};
		const hasAny = Object.values(inv).some(v => v > 0);
		const hasTimeBombs = (player.timeBombs || 0) > 0;
		const isMyTurn = this.mp.isMyTurn();

		if (!hasAny && !hasTimeBombs) {
			container.innerHTML = '';
			container.style.display = 'none';
			return;
		}

		container.style.display = 'flex';

		// Detecteer nieuw verzamelde bonussen
		const prevInv = prevState?.players?.[this.mp.userId]?.bonusInventory || {};
		const newBonuses = [];
		for (const [color, count] of Object.entries(inv)) {
			const prevCount = prevInv[color] || 0;
			if (count > prevCount) {
				newBonuses.push(color);
			}
		}
		if (newBonuses.length > 0) {
			// Toon melding voor nieuwe bonussen
			const bonusLabelsMap = {
				yellow: 'Geel', green: 'Groen', blue: 'Blauw', red: 'Rood', purple: 'Paars', any: 'Multikleur'
			};
			const names = newBonuses.map(c => bonusLabelsMap[c] || c).join(', ');
			this._showToast(`🎁 Nieuwe bonus: ${names}! Speel deze in je beurt.`, 'success');
		}

		const bonusLabels = {
			yellow: { label: 'Geel', color: '#cfba51' },
			green: { label: 'Groen', color: '#92c28c' },
			blue: { label: 'Blauw', color: '#5689b0' },
			red: { label: 'Rood', color: '#b56069' },
			purple: { label: 'Paars', color: '#8f76b8' },
			any: { label: 'Multikleur', color: '#c47bd7' }
		};

		container.innerHTML = `
			<span class="mp-bonus-label">Bonussen:</span>
			${Object.entries(inv).filter(([, v]) => v > 0).map(([color, count]) => {
				const b = bonusLabels[color] || {};
				const disabled = !isMyTurn;
				const isNew = newBonuses.includes(color);
				return `
					<button class="mp-bonus-btn ${disabled ? 'disabled' : ''} ${isNew ? 'mp-bonus-new' : ''}"
							data-bonus-color="${color}"
							style="border-color: ${b.color}"
							${disabled ? 'disabled' : ''}>
						<span style="color: ${b.color}">${b.label}</span>
						<span class="mp-bonus-count">×${count}</span>
					</button>
				`;
			}).join('')}
			${hasTimeBombs ? `
				<button class="mp-bonus-btn mp-bomb-btn ${isMyTurn ? 'disabled' : ''}"
						id="mp-timebomb-btn"
						style="border-color: #ff6b35"
						${isMyTurn ? 'disabled title="Kan alleen tijdens andermans beurt"' : ''}>
					<span style="color: #ff6b35">💣 Tijdbom</span>
					<span class="mp-bonus-count">×${player.timeBombs}</span>
				</button>
			` : ''}
		`;

		if (isMyTurn) {
			container.querySelectorAll('.mp-bonus-btn:not(.disabled):not(.mp-bomb-btn)').forEach(btn => {
				btn.addEventListener('click', () => {
					if (Date.now() < (this._ignoreNextBonusClickUntil || 0)) return;
					this._activateBonusMode(btn.dataset.bonusColor);
				});
				btn.addEventListener('pointerdown', (e) => {
					if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
					e.preventDefault();
					try { btn.setPointerCapture?.(e.pointerId); } catch (_) {}
					this._ignoreNextBonusClickUntil = Date.now() + 500;
					this._activateBonusMode(btn.dataset.bonusColor, e);
				});
			});
		}

		// Tijdbom click handler — alleen als het NIET jouw beurt is
		if (hasTimeBombs && !isMyTurn) {
			const bombBtn = document.getElementById('mp-timebomb-btn');
			if (bombBtn) {
				bombBtn.addEventListener('click', () => this._useTimeBomb());
			}
		}
	}

	async _useTimeBomb() {
		if (this.mp.isMyTurn()) {
			this._showToast('Je kan alleen een tijdbom gebruiken tijdens andermans beurt!', 'warning');
			return;
		}
		try {
			const result = await this.mp.useTimeBomb();
			if (result.success) {
				console.log('[Locus UI] Tijdbom gebruikt op', result.bombedPlayerName);
			}
		} catch (err) {
			this._showToast('Tijdbom mislukt: ' + (err.message || err), 'error');
		}
	}

	_activateBonusMode(bonusColor, startPointerEvent = null) {
		const Rules = window.LocusGameRules;
		if (!Rules) return;
		if (!this.mp.isMyTurn()) return;

		this._cancelDrag();
		this._cancelBonusMode();

		// Verberg cursor tijdens bonus plaatsing
		document.body.classList.add('mp-placing');

		const matrix = bonusColor === 'red'
			? Rules.cloneMatrix(Rules.BONUS_SHAPES.red)
			: (bonusColor === 'any' ? Rules.cloneMatrix(Rules.BONUS_SHAPES.any) : Rules.cloneMatrix(Rules.BONUS_SHAPES.default));

		this._bonusMode = { color: bonusColor, matrix, rotation: 0, baseRotation: 0, ghostEl: null };
		this._setTouchDragScrollLock(this._isTouchLikeDevice());
		this._sendInteraction('start', {
			mode: 'bonus',
			cardName: `${bonusColor} bonus`,
			colorCode: bonusColor,
			matrix
		});

		const bonusLabels = {
			yellow: { label: 'Geel', color: '#cfba51' },
			green: { label: 'Groen', color: '#92c28c' },
			blue: { label: 'Blauw', color: '#5689b0' },
			red: { label: 'Rood', color: '#b56069' },
			purple: { label: 'Paars', color: '#8f76b8' },
			any: { label: 'Multikleur', color: '#c47bd7' }
		};
		const bInfo = bonusLabels[bonusColor] || { label: bonusColor, color: '#888' };

		// Maak ghost element (zelfde patroon als kaarten)
		const ghost = document.createElement('div');
		ghost.className = 'mp-drag-ghost mp-bonus-ghost';
		ghost.innerHTML = this._renderMiniGrid(matrix, { code: bInfo.color }, true, true);
		ghost.style.pointerEvents = 'none';
		document.body.appendChild(ghost);
		this._bonusMode.ghostEl = ghost;

		// Compute center offsets (same as card ghosts)
		this._computeBonusGhostOffsets();

		// Placement controls
		const existing = document.getElementById('mp-placement-controls');
		if (existing) existing.remove();

		const controls = document.createElement('div');
		controls.id = 'mp-placement-controls';
		controls.innerHTML = `
			<span class="mp-ctrl-label">Bonus: <strong>${bInfo.label}</strong> — klik op ${bonusColor === 'any' ? 'een zone naar keuze' : `de ${bInfo.label} zone`}</span>
			<button class="mp-ctrl-btn" id="mp-rotate-btn" title="Draai (R)">🔄</button>
			<button class="mp-ctrl-btn mp-ctrl-cancel" id="mp-cancel-btn" title="Annuleer (Esc)">✕</button>
		`;

		document.getElementById('game-screen')?.appendChild(controls);
		document.getElementById('mp-rotate-btn')?.addEventListener('click', () => this._rotateCurrentShape());
		document.getElementById('mp-cancel-btn')?.addEventListener('click', () => this._cancelBonusMode());

		const board = document.querySelector('.mp-board');
		if (board) board.classList.add('placement-mode');

		// Mobiel/touch: ga direct naar de juiste kleurzone
		if (this._isTouchLikeDevice() || startPointerEvent?.pointerType === 'touch' || startPointerEvent?.pointerType === 'pen') {
			this._scrollMobileBoardToZone(bonusColor, true);
		}

		// Ghost volgt muis + preview (centered, like card ghosts)
		this._bonusMoveHandler = (e) => {
			if (!this._bonusMode?.ghostEl) return;
			if (this._touchDragScrollLocked && (e.pointerType === 'touch' || e.pointerType === 'pen')) {
				e.preventDefault();
			}
			const ox = this._bonusGhostOffsetX || 0;
			const oy = this._bonusGhostOffsetY || 0;
			this._bonusMode.ghostEl.style.left = (e.clientX - ox) + 'px';
			this._bonusMode.ghostEl.style.top = (e.clientY - oy) + 'px';

			// Throttled preview
			if (this._throttleTimer) return;
			this._throttleTimer = setTimeout(() => {
				this._throttleTimer = null;
				this._updateBonusPreview(e);
			}, 33);
		};
		document.addEventListener('pointermove', this._bonusMoveHandler);
		document.addEventListener('pointerup', this._onBonusPointerUpCancel);

		// Touch-start: toon ghost direct onder vinger zodat hold+sleep meteen werkt
		if (startPointerEvent) {
			this._bonusMoveHandler(startPointerEvent);
			setTimeout(() => {
				if (!this._bonusMode || !this._bonusMoveHandler) return;
				this._bonusMoveHandler(startPointerEvent);
			}, 0);
		}

		// Klik om te plaatsen (event delegation op container)
		const container = this.elements['mp-board-container'];
		if (!container) return;

		this._bonusClickHandler = async (e) => {
			if (!this._bonusMode || !this.mp.isMyTurn()) return;

			const matrix = this._bonusMode.matrix;
			if (!matrix || !matrix.length) return;

			const cell = e.target.closest('.mp-cell:not(.void)');
			if (!cell) {
				this._cancelBonusMode();
				this._showToast('Bonusplaatsing geannuleerd', 'info');
				return;
			}

			const rawX = Number(cell.dataset.x);
			const rawY = Number(cell.dataset.y);
			const zoneName = cell.dataset.zone;
			const subgridId = cell.dataset.subgrid || null;
			if (!zoneName || !Number.isFinite(rawX) || !Number.isFinite(rawY)) return;

			// Alleen plaatsen op toegestane zone(s)
			if (!this._isBonusZoneAllowed(zoneName)) return;

			// Prioriteit 1: gebruik de actieve preview-positie als die geldig was op dezelfde zone
			const hasPreview = this._lastBonusZone === zoneName
				&& Number.isFinite(this._lastBonusBaseX)
				&& Number.isFinite(this._lastBonusBaseY);
			if (hasPreview) {
				const previewResult = this.mp.previewPlacement(
					zoneName,
					this._lastBonusBaseX,
					this._lastBonusBaseY,
					matrix,
					this._lastBonusSubgridId || null
				);
				if (previewResult.valid) {
					await this._attemptBonusPlacement(
						zoneName,
						this._lastBonusBaseX,
						this._lastBonusBaseY,
						previewResult.subgridId || this._lastBonusSubgridId || null
					);
					return;
				}
			}

			// Prioriteit 2: aangepaste basis op basis van matrixvorm (centroid-offset)
			const adj = this._adjustBaseForMatrix(rawX, rawY, matrix);
			const adjResult = this.mp.previewPlacement(zoneName, adj.x, adj.y, matrix, subgridId);
			if (adjResult.valid) {
				await this._attemptBonusPlacement(
					zoneName, adj.x, adj.y,
					adjResult.subgridId || subgridId || null
				);
				return;
			}

			// Prioriteit 3: onbewerkte klikpositie
			const rawResult = this.mp.previewPlacement(zoneName, rawX, rawY, matrix, subgridId);
			if (rawResult.valid) {
				await this._attemptBonusPlacement(
					zoneName, rawX, rawY,
					rawResult.subgridId || subgridId || null
				);
				return;
			}

			this._showToast('Ongeldige positie — hover eerst over de gewenste plek', 'warning');
		};

		container.addEventListener('click', this._bonusClickHandler);
	}

	_isBonusZoneAllowed(zoneName) {
		if (!this._bonusMode) return false;
		return this._bonusMode.color === 'any' || zoneName === this._bonusMode.color;
	}

	_updateBonusPreview(e) {
		if (!this._bonusMode) return;
		this._clearPreview();

		const ghost = this._bonusMode.ghostEl;
		const matrix = this._bonusMode.matrix;
		if (!ghost || !matrix || !matrix.length) return;

		const boardState = this.mp.gameState?.boardState;
		if (!boardState) return;

		const cellHits = this._collectHoveredShapeCellHits(ghost, matrix, 3);

		if (cellHits.length === 0) return;

		// Vote for best zone
		const zoneCounts = {};
		cellHits.forEach(h => { if (h.zoneName) zoneCounts[h.zoneName] = (zoneCounts[h.zoneName] || 0) + 1; });
		const bestZone = Object.keys(zoneCounts).reduce((a, b) => zoneCounts[a] > zoneCounts[b] ? a : b);
		const zoneHits = cellHits.filter(h => h.zoneName === bestZone);
		if (zoneHits.length === 0) return;

		// Vote for best base coordinates
		const baseXCandidates = zoneHits.map(h => h.gridX - h.shapeCol);
		const baseYCandidates = zoneHits.map(h => h.gridY - h.shapeRow);
		const baseX = this._pickBestVote(baseXCandidates, this._lastBonusBaseX);
		const baseY = this._pickBestVote(baseYCandidates, this._lastBonusBaseY);
		this._lastBonusBaseX = baseX;
		this._lastBonusBaseY = baseY;

		const hoverSubgridId = zoneHits[0]?.subgridId || null;
		this._lastBonusZone = bestZone;
		this._lastBonusSubgridId = hoverSubgridId;

		// Verkeerde zone?
		if (!this._isBonusZoneAllowed(bestZone)) {
			if (ghost) { ghost.classList.add('preview-denied'); ghost.classList.remove('preview-ok'); }
			this._showDeniedPreviewCells(bestZone, baseX, baseY, matrix, boardState, zoneHits[0]?.gridCell);
			return;
		}

		const preview = this.mp.previewPlacement(bestZone, baseX, baseY, matrix, hoverSubgridId);
		const resolvedSubgridId = preview.subgridId || hoverSubgridId;
		if (preview.valid) {
			this._lastBonusSubgridId = resolvedSubgridId || null;
			preview.cells.forEach(coord => {
				const sel = resolvedSubgridId
					? `.mp-cell[data-zone="${bestZone}"][data-subgrid="${resolvedSubgridId}"][data-x="${coord.x}"][data-y="${coord.y}"]`
					: `.mp-cell[data-zone="${bestZone}"][data-x="${coord.x}"][data-y="${coord.y}"]`;
				const el = document.querySelector(sel);
				if (el) el.classList.add('preview-valid');
			});
		}

		if (preview.valid) {
			this._sendInteraction('move', {
				mode: 'bonus',
				cardName: `${this._bonusMode.color} bonus`,
				zoneName: bestZone,
				baseX,
				baseY,
				subgridId: resolvedSubgridId || null,
				matrix,
				isValid: true
			});
			if (ghost) { ghost.classList.remove('preview-denied'); ghost.classList.add('preview-ok'); }
		} else {
			this._sendInteraction('move', {
				mode: 'bonus',
				cardName: `${this._bonusMode.color} bonus`,
				zoneName: bestZone,
				baseX,
				baseY,
				subgridId: hoverSubgridId || null,
				matrix,
				isValid: false
			});
			if (ghost) { ghost.classList.add('preview-denied'); ghost.classList.remove('preview-ok'); }
			this._showDeniedPreviewCells(bestZone, baseX, baseY, matrix, boardState, zoneHits[0]?.gridCell);
		}
	}

	/** Toon rode preview-cellen wanneer plaatsing ongeldig is */
	_showDeniedPreviewCells(zoneName, baseX, baseY, matrix, boardState, hoveredCell) {
		if (!matrix) return;
		const subgridId = hoveredCell?.dataset?.subgrid || null;
		for (let r = 0; r < matrix.length; r++) {
			for (let c = 0; c < matrix[r].length; c++) {
				if (!matrix[r][c]) continue;
				const cx = baseX + c;
				const cy = baseY + r;
				const sel = subgridId
					? `.mp-cell[data-zone="${zoneName}"][data-subgrid="${subgridId}"][data-x="${cx}"][data-y="${cy}"]`
					: `.mp-cell[data-zone="${zoneName}"][data-x="${cx}"][data-y="${cy}"]`;
				const el = document.querySelector(sel);
				if (el) el.classList.add('preview-denied');
			}
		}
	}

	_updateBonusGhost() {
		if (!this._bonusMode?.ghostEl) return;
		const bonusColors = { yellow: '#cfba51', green: '#92c28c', blue: '#5689b0', red: '#b56069', purple: '#8f76b8', any: '#c47bd7' };
		const colorCode = bonusColors[this._bonusMode.color] || '#888';
		this._bonusMode.ghostEl.innerHTML = this._renderMiniGrid(this._bonusMode.matrix, { code: colorCode }, true, true);
		this._computeBonusGhostOffsets();
	}

	async _attemptBonusPlacement(zoneName, baseX, baseY, subgridId = null) {
		if (!this._bonusMode || !this.mp.isMyTurn()) return;
		const zoneIdx = this._getMobileZoneIndex(zoneName);
		if (Number.isFinite(zoneIdx)) {
			this._forcedMobileBoardIndex = zoneIdx;
			this._lastMobileBoardIndex = zoneIdx;
		}
		try {
			const result = await this.mp.playBonus(this._bonusMode.color, zoneName, baseX, baseY, subgridId, this._bonusMode.rotation || 0);
			if (result?.error) throw new Error(result.error);
			if (result?.success) {
				this._playPlaceSound();
				this._cancelBonusMode();
			}
		} catch (err) {
			this._showToast('Bonus mislukt: ' + (err.message || err), 'error');
		}
	}

	_computeBonusGhostOffsets() {
		const ghost = this._bonusMode?.ghostEl;
		if (!ghost) { this._bonusGhostOffsetX = 0; this._bonusGhostOffsetY = 0; return; }
		void ghost.offsetHeight;
		const matrix = this._bonusMode.matrix;
		if (!matrix || !matrix.length) { this._bonusGhostOffsetX = 0; this._bonusGhostOffsetY = 0; return; }

		const sampleCell = ghost.querySelector('.mp-mini-cell');
		if (!sampleCell) { this._bonusGhostOffsetX = 0; this._bonusGhostOffsetY = 0; return; }

		const cellRect = sampleCell.getBoundingClientRect();
		const cellSize = Math.min(cellRect.width, cellRect.height);
		const gridEl = ghost.querySelector('.mp-mini-grid');
		const gridStyle = gridEl ? getComputedStyle(gridEl) : null;
		const gap = gridStyle ? (parseFloat(gridStyle.gap) || parseFloat(gridStyle.columnGap) || 0) : 0;
		const step = cellSize + gap;

		let sumC = 0, sumR = 0, count = 0;
		for (let r = 0; r < matrix.length; r++) {
			for (let c = 0; c < (matrix[r]?.length || 0); c++) {
				if (matrix[r][c]) { sumR += r; sumC += c; count++; }
			}
		}
		if (count === 0) { this._bonusGhostOffsetX = 0; this._bonusGhostOffsetY = 0; return; }

		const avgC = sumC / count;
		const avgR = sumR / count;
		this._bonusGhostOffsetX = (avgC + 0.5) * step;
		this._bonusGhostOffsetY = (avgR + 0.5) * step;
	}

	_cancelBonusMode() {
		this._sendInteraction('end', { mode: 'bonus' });
		// Verwijder ghost
		if (this._bonusMode?.ghostEl) {
			this._bonusMode.ghostEl.remove();
		}
		// Verwijder move handler
		if (this._bonusMoveHandler) {
			document.removeEventListener('pointermove', this._bonusMoveHandler);
			this._bonusMoveHandler = null;
		}
		document.removeEventListener('pointerup', this._onBonusPointerUpCancel);
		this._setTouchDragScrollLock(false);
		// Verwijder click handler van container
		const container = this.elements['mp-board-container'];
		if (container) {
			if (this._bonusClickHandler) container.removeEventListener('click', this._bonusClickHandler);
		}
		this._bonusClickHandler = null;
		this._bonusHoverHandler = null;
		this._bonusMode = null;

		// Reset bonus positioning state
		this._lastBonusBaseX = null;
		this._lastBonusBaseY = null;
		this._lastBonusZone = null;
		this._lastBonusSubgridId = null;
		this._bonusGhostOffsetX = 0;
		this._bonusGhostOffsetY = 0;

		this._clearPreview();

		// Herstel cursor
		document.body.classList.remove('mp-placing');

		const controls = document.getElementById('mp-placement-controls');
		if (controls) controls.remove();

		const board = document.querySelector('.mp-board');
		if (board) board.classList.remove('placement-mode');
	}

	_onBonusPointerUpCancel = (e) => {
		if (!this._bonusMode) return;

		const isTouchLikeRelease = e.pointerType === 'touch' || e.pointerType === 'pen';
		if (isTouchLikeRelease) {
			const hasPreview = Number.isFinite(this._lastBonusBaseX)
				&& Number.isFinite(this._lastBonusBaseY)
				&& this._lastBonusZone === this._bonusMode.color;
			if (hasPreview) {
				void this._attemptBonusPlacement(
					this._lastBonusZone,
					this._lastBonusBaseX,
					this._lastBonusBaseY,
					this._lastBonusSubgridId || null
				);
			}
			return;
		}

		const target = e.target;
		const insideBoard = target?.closest?.('#mp-board-container .mp-cell:not(.void), #mp-board-container .mp-grid, #mp-board-container .mp-zone');
		const inControls = target?.closest?.('#mp-placement-controls');
		const inBonusBar = target?.closest?.('#mp-bonus-bar, .mp-bonus-btn');
		if (!insideBoard && !inControls && !inBonusBar) {
			this._cancelBonusMode();
			this._showToast('Bonusplaatsing geannuleerd', 'info');
		}
	}

	_sendInteraction(type, payload = {}) {
		if (!this.mp?.sendInteraction) return;
		if (type === 'start') {
			this._activeSelections[this.mp.userId] = {
				mode: payload.mode || 'card',
				cardId: payload.cardId || null,
				cardName: payload.cardName || null,
				updatedAt: Date.now()
			};
			this._renderOpponentPanels();
		}
		if (type === 'end') {
			delete this._activeSelections[this.mp.userId];
			this._renderOpponentPanels();
		}
		if (type === 'move') {
			const now = Date.now();
			if (now - this._interactionMoveThrottleTs < 80) return;
			this._interactionMoveThrottleTs = now;
		}
		this.mp.sendInteraction({ type, ...payload });
	}

	_clearOpponentPreview() {
		if (!Array.isArray(this._oppPreviewCells)) {
			this._oppPreviewCells = [];
			return;
		}
		for (const el of this._oppPreviewCells) {
			if (el && el.classList) el.classList.remove('preview-opponent', 'preview-opponent-denied');
		}
		this._oppPreviewCells = [];
	}

	_onOpponentInteraction(data) {
		if (!data || data.playerId === this.mp.userId) return;
		if (data.type === 'start') {
			this._activeSelections[data.playerId] = {
				mode: data.mode || 'card',
				cardId: data.cardId || null,
				cardName: data.cardName || null,
				updatedAt: Date.now()
			};
			this._renderOpponentPanels();
			return;
		}

		if (data.type === 'end') {
			delete this._activeSelections[data.playerId];
			this._renderOpponentPanels();
			this._clearOpponentPreview();
			return;
		}

		if (data.type !== 'move') return;
		if (!data.zoneName || !Array.isArray(data.matrix)) return;
		if (!Number.isFinite(data.baseX) || !Number.isFinite(data.baseY)) return;
		this._scrollMobileBoardToZone(data.zoneName, true);

		if (!this._activeSelections[data.playerId]) {
			this._activeSelections[data.playerId] = {
				mode: data.mode || 'card',
				cardId: data.cardId || null,
				cardName: data.cardName || null,
				updatedAt: Date.now()
			};
			this._renderOpponentPanels();
		}

		this._clearOpponentPreview();
		const isValid = data.isValid !== false;
		for (let r = 0; r < data.matrix.length; r++) {
			for (let c = 0; c < (data.matrix[r]?.length || 0); c++) {
				if (!data.matrix[r][c]) continue;
				const x = data.baseX + c;
				const y = data.baseY + r;
				const sel = data.subgridId
					? `.mp-cell[data-zone="${data.zoneName}"][data-subgrid="${data.subgridId}"][data-x="${x}"][data-y="${y}"]`
					: `.mp-cell[data-zone="${data.zoneName}"][data-x="${x}"][data-y="${y}"]`;
				const el = document.querySelector(sel);
				if (el) {
					el.classList.add('preview-opponent');
					el.classList.toggle('preview-opponent-denied', !isValid);
					this._oppPreviewCells.push(el);
				}
			}
		}
	}

	// ──────────────────────────────────────────
	//  BOARD RENDERING
	// ──────────────────────────────────────────

	_isTouchLikeDevice() {
		if (window.matchMedia?.('(pointer: coarse)')?.matches) return true;
		return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
	}

	_getCurrentMobileBoardIndex() {
		if (!this._isTouchLikeDevice()) return null;
		const board = this.elements['mp-board-container']?.querySelector('.mp-board');
		if (!board) return null;
		const width = Math.max(1, board.clientWidth || 1);
		return Math.max(0, Math.round(board.scrollLeft / width));
	}

	_restoreMobileBoardIndex(index) {
		if (!this._isTouchLikeDevice()) return;
		if (!Number.isFinite(index)) return;
		const board = this.elements['mp-board-container']?.querySelector('.mp-board');
		if (!board) return;
		const zones = board.querySelectorAll('.mp-zone');
		if (!zones.length) return;
		const clamped = Math.max(0, Math.min(zones.length - 1, index));
		const target = zones[clamped];
		if (!target) return;
		board.scrollTo({ left: target.offsetLeft, top: 0, behavior: 'auto' });
		this._lastMobileBoardIndex = clamped;
		const zoneName = target.dataset.zone || null;
		if (zoneName === 'blue' && (this._forceBlueBottomOnce || this._lastMobileZoneName !== 'blue')) {
			requestAnimationFrame(() => this._scrollBlueZoneToBottom(target));
		}
		this._lastMobileZoneName = zoneName;
		this._forceBlueBottomOnce = false;
	}

	_scrollBlueZoneToBottom(zoneEl = null) {
		const board = this.elements['mp-board-container']?.querySelector('.mp-board');
		const target = zoneEl || board?.querySelector('.mp-zone[data-zone="blue"]');
		if (!target) return;
		target.scrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
	}

	_getMobileZoneIndex(zoneName) {
		if (!this._isTouchLikeDevice()) return null;
		if (!zoneName) return null;
		const board = this.elements['mp-board-container']?.querySelector('.mp-board');
		if (!board) return null;
		const zones = Array.from(board.querySelectorAll('.mp-zone'));
		if (!zones.length) return null;
		const idx = zones.findIndex(z => z.dataset.zone === zoneName);
		return idx >= 0 ? idx : null;
	}

	_scrollMobileBoardToZone(zoneName, smooth = true) {
		if (!this._isTouchLikeDevice()) return;
		const board = this.elements['mp-board-container']?.querySelector('.mp-board');
		if (!board) return;
		const zoneEl = board.querySelector(`.mp-zone[data-zone="${zoneName}"]`);
		if (!zoneEl) return;
		board.scrollTo({
			left: zoneEl.offsetLeft,
			top: 0,
			behavior: smooth ? 'smooth' : 'auto'
		});
		if (zoneName === 'blue') {
			this._forceBlueBottomOnce = true;
			requestAnimationFrame(() => this._scrollBlueZoneToBottom(zoneEl));
		}
		const zones = Array.from(board.querySelectorAll('.mp-zone'));
		const idx = zones.indexOf(zoneEl);
		if (idx >= 0) this._lastMobileBoardIndex = idx;
		this._lastMobileZoneName = zoneName || null;
	}

	_renderBoard(boardState) {
		const container = this.elements['mp-board-container'];
		if (!container || !boardState) return;
		const prevMobileIdx = this._getCurrentMobileBoardIndex();

		const zones = boardState.zones;
		const isTouch = this._isTouchLikeDevice();
		if (isTouch) {
			container.innerHTML = `
				<div class="mp-board">
					${this._renderZone('yellow', zones.yellow, 'Geel')}
					${this._renderZone('green', zones.green, 'Groen')}
					${this._renderZone('blue', zones.blue, 'Blauw')}
					${this._renderRedZone(zones.red)}
					${this._renderZone('purple', zones.purple, 'Paars')}
				</div>
			`;
			const boardEl = container.querySelector('.mp-board');
			if (boardEl) {
				let rafId = null;
				boardEl.addEventListener('scroll', () => {
					if (rafId) return;
					rafId = requestAnimationFrame(() => {
						rafId = null;
						const width = Math.max(1, boardEl.clientWidth || 1);
						const idx = Math.max(0, Math.round(boardEl.scrollLeft / width));
						const prevIdx = this._lastMobileBoardIndex;
						this._lastMobileBoardIndex = idx;
						const order = ['yellow', 'green', 'blue', 'red', 'purple'];
						const zoneName = order[idx] || null;
						if (zoneName === 'blue' && prevIdx !== 2) {
							const blueZone = boardEl.querySelector('.mp-zone[data-zone="blue"]');
							if (blueZone) this._scrollBlueZoneToBottom(blueZone);
						}
						this._lastMobileZoneName = zoneName;
					});
				}, { passive: true });
			}
		} else {
			container.innerHTML = `
				<div class="mp-board mp-board-desktop">
					<div class="mp-board-col mp-board-col-left">
						${this._renderZone('yellow', zones.yellow, 'Geel')}
						${this._renderZone('green', zones.green, 'Groen')}
					</div>
					<div class="mp-board-col mp-board-col-middle">
						${this._renderZone('blue', zones.blue, 'Blauw')}
					</div>
					<div class="mp-board-col mp-board-col-right">
						${this._renderRedZone(zones.red)}
						${this._renderZone('purple', zones.purple, 'Paars')}
					</div>
				</div>
			`;
		}

		if (isTouch) {
			const targetIdx = Number.isFinite(this._forcedMobileBoardIndex)
				? this._forcedMobileBoardIndex
				: (Number.isFinite(this._lastMobileBoardIndex)
					? this._lastMobileBoardIndex
					: (Number.isFinite(prevMobileIdx) ? prevMobileIdx : 0));
			requestAnimationFrame(() => this._restoreMobileBoardIndex(targetIdx || 0));
			this._forcedMobileBoardIndex = null;
		}
	}

	_renderZone(zoneName, zoneData, label) {
		if (!zoneData) return '';
		const Rules = window.LocusGameRules;
		const theme = (Rules?.ZONE_THEMES || {})[zoneName] || { bg: '#2d2d2d', border: '#555', label };
		const yellowPairPoints = Array.isArray(Rules?.YELLOW_COLUMN_PAIR_POINTS) && Rules.YELLOW_COLUMN_PAIR_POINTS.length > 0
			? Rules.YELLOW_COLUMN_PAIR_POINTS
			: [10, 14, 20, 28, 38];
		const blueRowPoints = Array.isArray(Rules?.BLUE_ROW_POINTS) && Rules.BLUE_ROW_POINTS.length > 0
			? Rules.BLUE_ROW_POINTS
			: [10, 30];
		const claimedBlueRows = new Set();
		const blueRowTierByY = new Map();
		if (zoneName === 'blue') {
			const boldRows = [...new Set(zoneData.boldRows || Object.values(zoneData.cells).filter(c => c.flags?.includes('bold')).map(c => c.y))];
			const sortedBoldRows = [...boldRows].sort((a, b) => b - a);
			for (let tierIndex = 0; tierIndex < sortedBoldRows.length; tierIndex++) {
				blueRowTierByY.set(sortedBoldRows[tierIndex], tierIndex);
			}
			for (const rowY of boldRows) {
				let rowClaimed = false;
				for (let x = 0; x < zoneData.cols; x++) {
					const c = zoneData.cells[`${x},${rowY}`];
					if (c?.active && c.flags?.includes('bold')) { rowClaimed = true; break; }
				}
				if (rowClaimed) claimedBlueRows.add(rowY);
			}
		}

		let gridHtml = '<div class="mp-grid" style="grid-template-columns: repeat(' + zoneData.cols + ', var(--mp-cell-size));">';
		for (let y = 0; y < zoneData.rows; y++) {
			for (let x = 0; x < zoneData.cols; x++) {
				const cell = zoneData.cells[`${x},${y}`];
				if (!cell) {
					gridHtml += `<div class="mp-cell void"></div>`;
					continue;
				}
				gridHtml += this._renderCell(cell, zoneName, null, {
					isBlueClaimedRow: zoneName === 'blue' && claimedBlueRows.has(cell.y)
				});
			}
		}
		gridHtml += '</div>';

		if (zoneName === 'blue') {
			const rowLabels = [];
			const blueTierPoints = Array.isArray(blueRowPoints) && blueRowPoints.length > 0
				? blueRowPoints
				: [10, 15, 20, 25, 40];
			for (let y = 0; y < zoneData.rows; y++) {
				if (!blueRowTierByY.has(y)) {
					rowLabels.push('<div class="mp-blue-row-point-spacer"></div>');
					continue;
				}
				const tierIndex = blueRowTierByY.get(y);
				const points = blueTierPoints[Math.min(tierIndex, blueTierPoints.length - 1)] || blueTierPoints[blueTierPoints.length - 1] || 10;
				const isClaimed = claimedBlueRows.has(y);
				rowLabels.push(`<div class="mp-blue-row-point ${isClaimed ? 'is-claimed' : ''}" title="+${points} punten voor deze bold-rij">+${points}</div>`);
			}
			gridHtml = `
				<div class="mp-blue-grid-wrap">
					${gridHtml}
					<div class="mp-blue-row-points" style="grid-template-rows: repeat(${zoneData.rows}, var(--mp-cell-size));">
						${rowLabels.join('')}
					</div>
				</div>
			`;
		}

		let yellowColumnPointsHtml = '';
		if (zoneName === 'yellow') {
			const pointCells = [];
			for (let x = 0; x < zoneData.cols; x++) {
				const pairIndex = Math.min(Math.floor(x / 2), yellowPairPoints.length - 1);
				const points = yellowPairPoints[pairIndex];
				let isComplete = true;
				for (let y = 0; y < zoneData.rows; y++) {
					const c = zoneData.cells[`${x},${y}`];
					if (!c?.active) {
						isComplete = false;
						break;
					}
				}
				pointCells.push(`<div class="mp-yellow-col-point ${isComplete ? 'is-complete' : ''}" title="+${points} punten bij volle kolom">+${points}</div>`);
			}
			yellowColumnPointsHtml = `
				<div class="mp-yellow-col-points" style="grid-template-columns: repeat(${zoneData.cols}, var(--mp-cell-size));">
					${pointCells.join('')}
				</div>
			`;
		}

		let greenPointsGuideHtml = '';
		if (zoneName === 'green') {
			greenPointsGuideHtml = `<div class="mp-green-points-guide">End-cel: ~5 → 25pt (verder = meer)</div>`;
		}

		let purplePointsGuideHtml = '';
		if (zoneName === 'purple') {
			purplePointsGuideHtml = `
				<div class="mp-purple-points-guide" title="Punten per verbonden bold-cellen">
					2 bold=6 • 3 bold=12 • 4 bold=18 • 5 bold=24 • 6 bold=32
				</div>
			`;
		}

		return `
			<div class="mp-zone mp-zone-${zoneName}" data-zone="${zoneName}"
				 style="background: ${theme.bg}; border-color: ${theme.border};">
				${yellowColumnPointsHtml}
				${greenPointsGuideHtml}
				${gridHtml}
				${purplePointsGuideHtml}
			</div>
		`;
	}

	_renderCell(cell, zoneName, subgridId, meta = {}) {
		const classes = ['mp-cell'];
		if (cell.active) classes.push('active');
		if (cell.isStone) classes.push('stone');
		if (meta.isBlueClaimedRow) classes.push('blue-row-claimed');
		if (cell.flags.includes('bold')) classes.push('bold');
		if (meta.isBlueClaimedRow && cell.flags.includes('bold')) classes.push('blue-bold-claimed');
		if (cell.flags.includes('end')) classes.push('end');
		// portal visuals disabled (unlock later)
		// if (cell.flags.includes('portal')) classes.push('portal');
		if (cell.flags.includes('gold')) classes.push('gold');
		if (cell.flags.includes('outer-ring-0')) classes.push('outer-ring-0');
		if (cell.flags.includes('outer-ring-1')) classes.push('outer-ring-1');
		if (cell.bonusSymbol) classes.push('has-bonus', `bonus-${cell.bonusSymbol}`);
		if (zoneName === 'green' && cell.flags.includes('end') && cell.active) classes.push('end-claimed');
		if (zoneName === 'green' && cell.flags.includes('end')) classes.push('green-end');

		// Bepaal achtergrondkleur: rainbow/multikleur neemt de zone-kleur over
		let bgStyle = '';
		if (cell.active && cell.isStone) {
			bgStyle = 'background: #8a8a8a;';
		} else if (cell.active && cell.color?.code) {
			if (cell.color.code === 'rainbow') {
				const Rules = window.LocusGameRules;
				const zoneTheme = Rules?.ZONE_THEMES?.[zoneName];
				bgStyle = zoneTheme ? `background: ${zoneTheme.border};` : '';
			} else {
				bgStyle = `background: ${cell.color.code};`;
			}
		}

		let inner = '';
		if (cell.bonusSymbol && !cell.active) {
			const bonusColors = {
				yellow: '#cfba51', green: '#92c28c', blue: '#5689b0',
				red: '#b56069', purple: '#8f76b8',
				any: 'linear-gradient(135deg, #cfba51 0%, #92c28c 24%, #5689b0 48%, #b56069 72%, #8f76b8 100%)'
			};
			inner = `<span class="mp-cell-bonus-dot" style="background:${bonusColors[cell.bonusSymbol] || '#888'}"></span>`;
		}
		if (cell.flags.includes('gold') && !cell.active) {
			inner += `<span class="mp-cell-gold-dot"></span>`;
		}
		if (cell.treasureCoins && !cell.active) {
			inner += `<span class="mp-cell-pearl-dot" title="Parel: +${cell.treasureCoins} munten"></span>`;
		}
		if (zoneName === 'green' && cell.flags.includes('end') && cell.active) {
			inner += `<span class="mp-green-end-check">✓</span>`;
		}
		// portal indicators disabled (unlock later)
		// if (cell.flags.includes('portal') && !cell.active) { ... }

		const dataAttrs = `data-x="${cell.x}" data-y="${cell.y}" data-zone="${zoneName}"${subgridId ? ` data-subgrid="${subgridId}"` : ''}`;

		return `<div class="${classes.join(' ')}" ${dataAttrs} style="${bgStyle}">${inner}</div>`;
	}

	_renderRedZone(redData) {
		if (!redData || !redData.subgrids) return '';
		const Rules = window.LocusGameRules;
		const theme = (Rules?.ZONE_THEMES || {}).red || { bg: '#2a1f20', border: '#b56069' };

		const subgridsHtml = redData.subgrids.map(sg => {
			const scoreInfo = Rules?.getRedSubgridScoreInfo ? Rules.getRedSubgridScoreInfo(sg) : null;
			let gridHtml = `<div class="mp-grid mp-red-subgrid" 
				style="grid-template-columns: repeat(${sg.cols}, var(--mp-cell-size));"
				data-subgrid-id="${sg.id}">`;

			for (let y = 0; y < sg.rows; y++) {
				for (let x = 0; x < sg.cols; x++) {
					const cell = sg.cells[`${x},${y}`];
					if (!cell) {
						gridHtml += `<div class="mp-cell void"></div>`;
						continue;
					}
					gridHtml += this._renderCell(cell, 'red', sg.id);
				}
			}
			gridHtml += '</div>';

			const allCells = Object.values(sg.cells);
			const filledCount = allCells.filter(c => c.active).length;
			const totalCount = allCells.length;
			const fillPct = totalCount > 0 ? Math.round((filledCount / totalCount) * 100) : 0;
			const isPartial = !!scoreInfo?.isPartialReached;
			const isFull = !!scoreInfo?.isFull;
			const basePts = scoreInfo?.basePoints || (sg.targetPoints || 0);
			const fullBonusPts = scoreInfo?.fullBonusPoints || 0;
			const totalPts = scoreInfo?.totalPoints || 0;
			const thresholdCells = Math.ceil((totalCount || 0) * 0.8);
			const statusIcon = isFull ? '⭐' : (isPartial ? '✅' : '⏳');
			const progressWidth = Math.max(0, Math.min(100, fillPct));
			const labelText = isFull
				? `${totalPts}pt`
				: (isPartial
					? `vol = ${basePts + fullBonusPts}pt`
					: `>${thresholdCells} vakjes → ${basePts}pt`);

			return `
				<div class="mp-red-subgrid-wrap ${isFull ? 'is-full' : (isPartial ? 'is-partial' : '')}">
					${gridHtml}
					<div class="mp-red-subgrid-progress"><span style="width:${progressWidth}%"></span></div>
					<div class="mp-red-subgrid-label"><span>${statusIcon}</span><span>${labelText}</span></div>
				</div>
			`;
		}).join('');

		return `
			<div class="mp-zone mp-zone-red" data-zone="red"
				 style="background: ${theme.bg}; border-color: ${theme.border};">
				<div class="mp-red-group">${subgridsHtml}</div>
			</div>
		`;
	}

	_getZoneScoreHint(zoneName, zoneData) {
		const Rules = window.LocusGameRules;
		if (!Rules || !this.mp.gameState?.boardState) return '';

		switch (zoneName) {
			case 'yellow': {
				const score = Rules.scoreYellowData(zoneData);
				// Tel voltooide kolommen
				let fullCols = 0;
				for (let x = 0; x < zoneData.cols; x++) {
					let ok = true;
					for (let y = 0; y < zoneData.rows; y++) {
						const c = zoneData.cells[`${x},${y}`];
						if (!c?.active) { ok = false; break; }
					}
					if (ok) fullCols++;
				}
				const pairs = Math.floor(fullCols / 2);
				return `${fullCols} kol (${pairs} paar) → ${score}pt`;
			}
			case 'green': {
				const score = Rules.scoreGreenData(zoneData);
				const endCount = Object.values(zoneData.cells).filter(c => c.active && c.flags.includes('end')).length;
				const totalEnds = Object.values(zoneData.cells).filter(c => c.flags.includes('end')).length;
				return `${endCount}/${totalEnds} ends → ${score}pt`;
			}
			case 'blue': {
				const score = Rules.scoreBlueData(zoneData);
				const bys = zoneData.boldRows || [];
				let filledBoldRows = 0;
				for (const by of bys) {
					let ok = true;
					for (let x = 0; x < zoneData.cols; x++) {
						if (!zoneData.cells[`${x},${by}`]?.active) { ok = false; break; }
					}
					if (ok) filledBoldRows++;
				}
				return `${filledBoldRows}/${bys.length} rijen → ${score}pt`;
			}
			case 'purple': {
				const score = Rules.scorePurpleData(zoneData);
				const boldTotal = Object.values(zoneData.cells).filter(c => c.flags.includes('bold')).length;
				const boldActive = Object.values(zoneData.cells).filter(c => c.active && c.flags.includes('bold')).length;
				return `${boldActive}/${boldTotal} bold → ${score}pt`;
			}
			default: return '';
		}
	}

	_renderMiniGrid(matrix, color, large = false, forGhost = false) {
		if (!matrix) return '';
		const colorCode = color?.code || '#666';
		const isGolden = color?.isGolden;
		const isStone = color?.isStone;
		const isRainbow = colorCode === 'rainbow';
		const fillStyle = isStone
			? 'background: linear-gradient(135deg, #a0a0a0, #8a8a8a, #707070); border: 1px solid #555;'
			: isRainbow
					? 'background: linear-gradient(135deg, #b56069, #cfba51, #92c28c, #5689b0, #8f76b8)'
					: `background: ${colorCode}`;

		// For ghost: no inline size, let CSS handle it via --mp-cell-size
		const cellSize = forGhost ? '' : (large ? '20px' : '10px');
		const sizeStyle = cellSize ? `width:${cellSize}; height:${cellSize};` : '';
		const colTemplate = forGhost
			? `grid-template-columns: repeat(${matrix[0]?.length || 1}, var(--mp-cell-size, 20px));`
			: `grid-template-columns: repeat(${matrix[0]?.length || 1}, ${cellSize || '10px'});`;
		let html = `<div class="mp-mini-grid" style="${colTemplate}">`;
		for (const row of matrix) {
			for (const cell of row) {
				html += `<div class="mp-mini-cell ${cell ? 'filled' : ''}" style="${cell ? fillStyle : ''}; ${sizeStyle}"></div>`;
			}
		}
		html += '</div>';
		return html;
	}

	// ──────────────────────────────────────────
	//  MY OBJECTIVE
	// ──────────────────────────────────────────

	_renderMyObjective() {
		const container = this.elements['mp-my-objective'];
		if (!container) return;
		const player = this.mp.getMyPlayer();
		if (!player?.chosenObjective) {
			container.innerHTML = '';
			return;
		}
		const achieved = player.objectiveAchieved || false;
		const failed = !achieved && !!player.objectiveFailed;
		const progress = player.objectiveProgress || null;
		const progressText = progress ? `${progress.current}/${progress.target}` : '';
		const pts = player.objectiveAchievedPoints || (progress ? progress.points : '');
		const obj = player.chosenObjective;

		container.innerHTML = `
			<div class="mp-objective-badge ${achieved ? 'objective-achieved' : ''} ${failed ? 'objective-failed' : ''}">
				<div class="mp-objective-title">${achieved ? '✅' : (failed ? '❌' : '🎯')} ${this._escapeHtml(obj.name)} ${pts ? `<span style="color: var(--mp-gold); font-size: 0.8rem;">(${pts}pt)</span>` : ''}</div>
				<div class="mp-objective-desc">${this._escapeHtml(this._stripObjectiveRewardText(obj.description))}</div>
				${this._renderObjectiveRewardBadges(progress || obj, { wrapperClass: 'mp-objective-rewards' })}
				${failed
					? `<div class="mp-objective-progress objective-progress-failed">❌ Niet meer haalbaar</div>`
					: (progressText ? `<div class="mp-objective-progress">${achieved ? `🏆 Behaald! +${pts}pt` : `Voortgang: ${progressText}`}</div>` : '')}
			</div>
		`;
	}

	/** Detect objective achievement transitions and show celebration */
	_checkObjectiveAchievement(state, prevState) {
		if (!state || !prevState) return;

		// Check all players for newly achieved objectives
		for (const pid of (state.playerOrder || [])) {
			const cur = state.players[pid];
			const prev = prevState?.players?.[pid];
			if (!cur) continue;

			const wasAchieved = prev?.objectiveAchieved || false;
			const nowAchieved = cur.objectiveAchieved || false;

			if (nowAchieved && !wasAchieved) {
				const isMe = pid === this.mp.userId;
				const pts = cur.objectiveAchievedPoints || cur.objectiveProgress?.points || 15;
				const name = cur.name || '???';

				if (isMe) {
					// Big celebration for own objective
					this._showToast(`🏆 Doelstelling behaald! +${pts} punten!`, 'success');
					this._playRevealSound();
					// Flash the objective badge
					const badge = document.querySelector('.mp-objective-badge');
					if (badge) {
						badge.classList.add('objective-celebrate');
						setTimeout(() => badge.classList.remove('objective-celebrate'), 2000);
					}
				} else {
					// Notification for opponent achievement
					this._showToast(`🎯 ${this._escapeHtml(name)} heeft een doelstelling behaald! +${pts}pt`, 'info');
				}
			}

			// Detect newly-failed objective
			const wasFailed = prev?.objectiveFailed || false;
			const nowFailed = cur.objectiveFailed || false;
			if (nowFailed && !wasFailed && !cur.objectiveAchieved) {
				const isMe = pid === this.mp.userId;
				const name = cur.name || '???';
				if (isMe) {
					this._showToast('❌ Doelstelling niet meer haalbaar!', 'error');
					const badge = document.querySelector('.mp-objective-badge');
					if (badge) {
						badge.classList.add('objective-failed');
						badge.classList.add('objective-fail-flash');
						setTimeout(() => badge.classList.remove('objective-fail-flash'), 1500);
					}
				} else {
					this._showToast(`❌ ${this._escapeHtml(name)} heeft de doelstelling niet gehaald.`, 'info');
				}
			}
		}
	}

	// ──────────────────────────────────────────
	//  GAME END
	// ──────────────────────────────────────────

	_onGameEnded(finalScores, winnerId) {
		this._showScreen('results-screen');
		const container = this.elements['results-container'];
		if (!container || !finalScores) return;
		const winsTarget = Math.max(1, Number(this.mp.gameState?.winsToEnd) || 4);

		const players = this.mp.gameState.playerOrder.map(pid => ({
			id: pid,
			name: this.mp.gameState.players[pid]?.name || '???',
			matchWins: this.mp.gameState.players[pid]?.matchWins || finalScores[pid]?.matchWins || 0,
			...finalScores[pid]
		}));
		const sorted = [...players].sort((a, b) => (b.matchWins - a.matchWins) || (b.finalTotal - a.finalTotal));

		container.innerHTML = `
			<h2 class="mp-results-title">🏆 Spel Afgelopen!</h2>
			<div class="mp-results-winner">
				Winnaar: <strong>${this._escapeHtml(sorted[0].name)}</strong>
				met ${sorted[0].matchWins || 0}/${winsTarget} wins!
			</div>
			<div class="mp-results-table">
				${sorted.map((p, rank) => `
					<div class="mp-result-row ${p.id === this.mp.userId ? 'is-me' : ''} ${rank === 0 ? 'winner' : ''}">
						<span class="mp-result-rank">${rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : rank + 1}</span>
						<span class="mp-result-name">${this._escapeHtml(p.name)} ${p.id === this.mp.userId ? '(jij)' : ''}</span>
						<div class="mp-result-breakdown">
							<span style="color:#f5d76e">🏅:${p.matchWins || 0}</span>
							<span style="color:#cfba51">G:${p.yellow || 0}</span>
							<span style="color:#92c28c">Gr:${p.green || 0}</span>
							<span style="color:#5689b0">B:${p.blue || 0}</span>
							<span style="color:#b56069">R:${p.red || 0}</span>
							<span style="color:#8f76b8">P:${p.purple || 0}</span>
							${p.bonus ? `<span style="color:#4caf50">⚖:${p.bonus}</span>` : ''}
							${p.gold ? `<span style="color:#f5d76e">⬤:${p.gold}</span>` : ''}
							${p.objectiveBonus ? `<span style="color:#f5d76e">🎯:+${p.objectiveBonus}</span>` : ''}
						</div>
						<span class="mp-result-total">${p.finalTotal} pt</span>
					</div>
				`).join('')}
			</div>
		`;
	}

	// ──────────────────────────────────────────
	//  LEVEL COMPLETE & SHOP
	// ──────────────────────────────────────────

	_onLevelComplete(levelScores, levelWinner, level) {
		console.log('[Locus UI] _onLevelComplete called', { levelScores, levelWinner, level });
		this._cancelDrag();
		this._cancelBonusMode();
		this._stopTurnTimer();

		const scores = levelScores || this.mp.gameState?.levelScores;
		const winner = levelWinner || this.mp.gameState?.levelWinner;
		const currentLevel = level || this.mp.gameState?.level || 1;
		const winsTarget = Math.max(1, Number(this.mp.gameState?.winsToEnd) || 4);

		if (!scores) {
			console.warn('[Locus UI] _onLevelComplete: geen scores beschikbaar, skip overlay');
			return;
		}
		// Ensure game screen is still visible underneath
		this.elements['game-screen'].style.display = 'flex';

		// Remove any existing overlay first
		const existingOverlay = document.getElementById('level-complete-overlay');
		if (existingOverlay) existingOverlay.remove();

		// Show overlay on top of game screen
		const overlay = document.createElement('div');
		overlay.id = 'level-complete-overlay';
		overlay.className = 'mp-level-overlay';
		document.body.appendChild(overlay);
		this.elements['level-complete-overlay'] = overlay;

		const players = this.mp.gameState.playerOrder.map(pid => ({
			id: pid,
			name: this.mp.gameState.players[pid]?.name || '???',
			goldCoins: this.mp.gameState.players[pid]?.goldCoins || 0,
			matchWins: this.mp.gameState.players[pid]?.matchWins || 0,
			...scores[pid]
		}));
		const sorted = [...players].sort((a, b) => b.finalTotal - a.finalTotal);
		const winSorted = [...players].sort((a, b) => (b.matchWins - a.matchWins) || (b.finalTotal - a.finalTotal));
		const isHost = this.mp.gameState.hostPlayerId === this.mp.userId;
		const matchWinner = this.mp.gameState.matchWinner || null;
		const isMatchFinished = !!matchWinner;
		const maxLevels = Math.max(1, Number(this.mp.gameState?.maxLevels) || 10);

		overlay.innerHTML = `
			<div class="mp-level-popup">
				<h2 class="mp-level-title">🎉 Level ${currentLevel}/${maxLevels} Compleet!</h2>
				<div class="mp-level-winner">
					${sorted[0].name} wint dit level met ${sorted[0].finalTotal} punten!
				</div>
				<div class="mp-level-scores">
					${sorted.map((p, rank) => `
						<div class="mp-level-score-row ${p.id === this.mp.userId ? 'is-me' : ''} ${rank === 0 ? 'winner' : ''}">
							<span class="mp-result-rank">${rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : rank + 1}</span>
							<span class="mp-result-name">${this._escapeHtml(p.name)}</span>
							<div class="mp-result-breakdown">
								<span style="color:#cfba51">G:${p.yellow || 0}</span>
								<span style="color:#92c28c">Gr:${p.green || 0}</span>
								<span style="color:#5689b0">B:${p.blue || 0}</span>
								<span style="color:#b56069">R:${p.red || 0}</span>
								<span style="color:#8f76b8">P:${p.purple || 0}</span>
								${p.gold ? `<span style="color:#f5d76e">⬤:${p.gold}</span>` : ''}
							</div>
							<span class="mp-result-total">${p.finalTotal} pt</span>
							<span class="mp-gold-coins">💰 ${p.goldCoins}</span>
						</div>
					`).join('')}
				</div>
				<div class="mp-level-winner" style="margin-top:8px; margin-bottom:10px;">
					Ranglijst wins — eerste tot ${winsTarget} wins wint! (Level ${currentLevel}/${maxLevels})
				</div>
				<div class="mp-level-scores" style="margin-bottom: 16px;">
					${winSorted.map((p, rank) => `
						<div class="mp-level-score-row ${p.id === this.mp.userId ? 'is-me' : ''} ${rank === 0 ? 'winner' : ''}">
							<span class="mp-result-rank">${rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : rank + 1}</span>
							<span class="mp-result-name">${this._escapeHtml(p.name)}${p.id === this.mp.userId ? ' (jij)' : ''}</span>
							<span class="mp-result-total">${p.matchWins || 0}/${winsTarget} wins</span>
						</div>
					`).join('')}
				</div>
				${isMatchFinished ? `
					<div class="mp-level-winner" style="margin-bottom:12px;">
						🏁 ${this._escapeHtml(this.mp.gameState.players[matchWinner]?.name || sorted[0].name)} wint de match met ${this.mp.gameState.players[matchWinner]?.matchWins || winsTarget} wins!
					</div>
				` : `
					<div class="mp-level-progress" style="margin-bottom:12px; text-align:center; opacity:0.7; font-size:0.9em;">
						${maxLevels - currentLevel} levels te gaan
					</div>
				`}
				${isHost ? `
					<button class="mp-btn mp-btn-primary mp-to-shop-btn" id="mp-go-shop-btn">
						${isMatchFinished ? '🏁 Naar eindresultaat' : '🛒 Naar de Shop'}
					</button>
				` : `
					<div class="mp-waiting-for-host">${isMatchFinished ? 'Wachten tot de host het eindresultaat opent...' : 'Wachten tot de host de shop opent...'}</div>
				`}
			</div>
		`;

		// Bind shop button
		const shopBtn = document.getElementById('mp-go-shop-btn');
		console.log('[Locus UI] _onLevelComplete overlay rendered, shopBtn:', !!shopBtn, 'isHost:', isHost);
		if (shopBtn) {
			shopBtn.addEventListener('click', async () => {
				shopBtn.disabled = true;
				try {
					const result = await this.mp.startShopPhase();
					console.log('[Locus UI] startShopPhase result:', result);
					// Ga direct naar shop na succesvolle aanroep
					// (broadcastGameState zal ook _onShopPhase triggeren, maar dit is zekerder)
					this._onShopPhase();
				} catch (err) {
					console.error('[Locus UI] startShopPhase error:', err);
					this._showToast('Fout: ' + (err.message || err), 'error');
					shopBtn.disabled = false;
				}
			});
		}

	}

	_onShopPhase() {
		console.log('[Locus UI] _onShopPhase called');
		// Hide level complete overlay
		const overlay = document.getElementById('level-complete-overlay');
		if (overlay) {
			console.log('[Locus UI] Removing level-complete overlay');
			overlay.remove();
		}
		this.elements['level-complete-overlay'] = null;
		this._showScreen('shop-screen');
		console.log('[Locus UI] Shop screen display:', this.elements['shop-screen']?.style.display);
		this._renderShop();
	}

	_renderShop() {
		const container = this.elements['shop-container'] || document.getElementById('shop-container');
		if (!container) {
			console.error('[Locus UI] _renderShop: shop-container niet gevonden!');
			return;
		}

		const Rules = window.LocusGameRules;
		const myPlayer = this.mp.getMyPlayer();
		const shopItems = Rules ? Rules.getShopItems(this.mp.gameState?.level, myPlayer) : [];
		const goldCoins = myPlayer?.goldCoins || 0;
		const isReady = myPlayer?.shopReady || false;
		const level = this.mp.gameState?.level || 1;

		// Card offerings
		const offerings = myPlayer?.shopOfferings || [];

		// Gekochte kaarten
		const shopCards = myPlayer?.shopCards || [];

		container.innerHTML = `
			<div class="mp-shop-card">
				<h2 class="mp-shop-title">🛒 Shop — Level ${level}</h2>
				<div class="mp-shop-gold">
					💰 <strong>${goldCoins}</strong> goudmunten beschikbaar
				</div>

				<div class="mp-shop-offerings">
					<h3 class="mp-shop-section-title">🃏 Kaarten te koop</h3>
					<div class="mp-shop-offering-grid">
						${offerings.map((card, i) => {
							if (!card) return `<div class="mp-shop-offering sold"><div class="mp-shop-offering-sold-label">Gekocht ✓</div></div>`;
							const price = card.shopPrice || (Rules ? Rules.getCardPrice(card) : 4);
							const canAfford = goldCoins >= price;
							if (card.isRandomOffer) {
								return `
									<div class="mp-shop-offering mystery ${canAfford && !isReady ? '' : 'cant-afford'}">
										<div class="mp-shop-offering-color" style="background: linear-gradient(135deg, #2f3448, #4a4f6d, #2f3448)"></div>
										<div class="mp-card-shape" style="display:flex;align-items:center;justify-content:center;min-height:54px;font-size:1.25rem;">🎲</div>
										<div class="mp-shop-offering-name">Gesloten random kaart</div>
										<div class="mp-shop-offering-meta">
											<span class="mp-shop-offering-cells">Onbekende vorm</span>
											<span class="mp-shop-offering-zone">Gesloten</span>
										</div>
										<button class="mp-shop-buy-btn ${canAfford && !isReady ? '' : 'disabled'}"
												data-item-id="shop-card-${i}"
												${(!canAfford || isReady) ? 'disabled' : ''}>
											💰 ${price} kopen
										</button>
									</div>
								`;
							}
							const colorStyle = card.isGolden
								? `background: linear-gradient(135deg, ${card.color?.code || '#f5d76e'}, #f5d76e, ${card.color?.code || '#f5d76e'})`
								: card.color?.code === 'rainbow'
									? 'background: linear-gradient(135deg, #b56069, #cfba51, #92c28c, #5689b0, #8f76b8)'
									: `background: ${card.color?.code || '#666'}`;
							// Count cells for display
							let cells = 0;
							if (card.matrix) for (const row of card.matrix) for (const c of row) { if (c) cells++; }
							return `
								<div class="mp-shop-offering ${canAfford && !isReady ? '' : 'cant-afford'}">
									<div class="mp-shop-offering-color" style="${colorStyle}"></div>
									<div class="mp-card-shape">${this._renderMiniGrid(card.matrix, card.color)}</div>
									<div class="mp-shop-offering-name">${this._escapeHtml(card.shapeName)}</div>
									<div class="mp-shop-offering-meta">
										<span class="mp-shop-offering-cells">${cells} cellen</span>
										<span class="mp-shop-offering-zone">${card.color?.name || ''}</span>
									</div>
									<button class="mp-shop-buy-btn ${canAfford && !isReady ? '' : 'disabled'}"
											data-item-id="shop-card-${i}"
											${(!canAfford || isReady) ? 'disabled' : ''}>
										💰 ${price} kopen
									</button>
								</div>
							`;
						}).join('')}
					</div>
				</div>

				<div class="mp-shop-items">
					<h3 class="mp-shop-section-title">⚡ Acties</h3>
					${shopItems.map(item => {
						const canAfford = goldCoins >= item.cost;
						const isUnlock = item.unlockOnly;
						return `
							<button class="mp-shop-item ${isUnlock ? 'mp-shop-unlock' : ''} ${canAfford ? '' : 'cant-afford'} ${isReady ? 'disabled' : ''}"
									data-item-id="${item.id}"
									${(!canAfford || isReady) ? 'disabled' : ''}>
								<span class="mp-shop-icon">${item.icon}</span>
								<div class="mp-shop-item-info">
									<div class="mp-shop-item-name">${this._escapeHtml(item.name)}</div>
									<div class="mp-shop-item-desc">${this._escapeHtml(item.description)}</div>
								</div>
								<span class="mp-shop-cost">💰 ${item.cost}</span>
							</button>
						`;
					}).join('')}
				</div>

				${shopCards.length > 0 ? `
					<div class="mp-shop-bought">
						<h3>Gekochte kaarten (${shopCards.length}):</h3>
						<div class="mp-shop-bought-cards">
							${shopCards.map(c => `
								<span class="mp-shop-bought-card" style="background:${c.color?.code || '#666'}">
									${this._escapeHtml(c.shapeName)}
								</span>
							`).join('')}
						</div>
					</div>
				` : ''}

				<div class="mp-shop-ready-section">
					${this._renderShopReadyStatus()}
				</div>
			</div>
		`;

		// Bind card buy buttons
		container.querySelectorAll('.mp-shop-buy-btn:not(.disabled)').forEach(btn => {
			btn.addEventListener('click', () => this._handleBuyItem(btn.dataset.itemId, btn));
		});

		// Bind other shop item clicks
		container.querySelectorAll('.mp-shop-item:not(.disabled)').forEach(btn => {
			btn.addEventListener('click', () => this._handleBuyItem(btn.dataset.itemId, btn));
		});

		// Bind ready button
		const readyBtn = container.querySelector('#mp-shop-ready-btn');
		if (readyBtn && !isReady) {
			readyBtn.addEventListener('click', () => this._handleShopReady());
		}
	}

	_renderShopReadyStatus() {
		const players = this.mp.gameState?.playerOrder || [];
		const readyList = players.map(pid => {
			const p = this.mp.gameState.players[pid];
			return { name: p?.name || '???', ready: p?.shopReady || false, isMe: pid === this.mp.userId };
		});
		const myReady = readyList.find(r => r.isMe)?.ready || false;

		return `
			<div class="mp-shop-ready-list">
				${readyList.map(r => `
					<span class="mp-ready-player ${r.ready ? 'is-ready' : ''} ${r.isMe ? 'is-me' : ''}">
						${r.ready ? '✅' : '⏳'} ${this._escapeHtml(r.name)}
					</span>
				`).join('')}
			</div>
			${!myReady ? `
				<button id="mp-shop-ready-btn" class="mp-btn mp-btn-primary mp-shop-ready">
					✅ Klaar — Start Level ${(this.mp.gameState?.level || 1) + 1}
				</button>
			` : `
				<div class="mp-ready-waiting">✅ Je bent klaar! Wachten op anderen...</div>
			`}
		`;
	}

	async _handleBuyItem(itemId, sourceEl = null) {
		try {
			if (itemId === 'extra-bonus') {
				this._showBonusColorPicker(itemId);
				return;
			}

			const result = await this.mp.buyShopItem(itemId);
			if (!result.success) {
				this._showToast(result.error || 'Koop mislukt', 'error');
				return;
			}

			// Unlock items return free choices — show popup
			if (result.freeChoices && result.freeChoices.length > 0) {
				const unlockNames = {
					'unlock-golden': '✨ Gouden kaarten ontgrendeld!',
					'unlock-multikleur': '🌈 Multikleur kaarten ontgrendeld!',
					'unlock-steen': '🪨 Steen vormen ontgrendeld!'
				};
				this._showToast(unlockNames[itemId] || 'Ontgrendeld!', 'success');
				this._showFreeCardChoice(result.freeChoices);
				return;
			}

			if (itemId === 'random-card' && result.card) {
				this._showShopRandomCardReveal(result.card, sourceEl);
				this._showToast('🎲 Random kaart gekocht!', 'success');
				setTimeout(() => this._renderShop(), 220);
				return;
			}

			if (itemId.startsWith('shop-card-') && sourceEl?.closest('.mp-shop-offering.mystery') && result.card) {
				this._showShopRandomCardReveal(result.card, sourceEl);
				this._showToast('🎲 Gesloten kaart onthuld!', 'success');
				setTimeout(() => this._renderShop(), 220);
				return;
			}

			this._showToast('Gekocht! ✓', 'success');
			this._renderShop();
		} catch (err) {
			this._showToast('Fout: ' + (err.message || err), 'error');
		}
	}

	_showShopRandomCardReveal(card, sourceEl) {
		if (!card) return;
		const Rules = window.LocusGameRules;
		const rect = sourceEl?.getBoundingClientRect?.();
		const startLeft = rect ? (rect.left + rect.width / 2) : (window.innerWidth / 2);
		const startTop = rect ? (rect.top + 6) : Math.max(120, window.innerHeight * 0.35);
		const zones = Rules?.getAllowedZones ? Rules.getAllowedZones(card) : [];
		const zoneNames = {
			yellow: 'Geel', green: 'Groen', blue: 'Blauw', red: 'Rood', purple: 'Paars'
		};
		const zonesText = (zones || []).map(z => zoneNames[z] || z).join(', ') || 'Onbekend';

		let cells = 0;
		if (card.matrix) for (const row of card.matrix) for (const c of row) { if (c) cells++; }

		const colorCode = card.color?.code || '#666';
		const isStone = card.isStone || card.color?.isStone;
		const isGolden = card.isGolden;
		const isRainbow = colorCode === 'rainbow' || card.color?.name === 'multikleur';
		let colorStyle = `background: ${colorCode};`;
		if (isStone) {
			colorStyle = 'background: linear-gradient(135deg, #a0a0a0, #8a8a8a, #707070);';
		} else if (isGolden) {
			colorStyle = `background: linear-gradient(135deg, ${colorCode}, #f5d76e, ${colorCode});`;
		} else if (isRainbow) {
			colorStyle = 'background: linear-gradient(135deg, #b56069, #cfba51, #92c28c, #5689b0, #8f76b8);';
		}

		const reveal = document.createElement('div');
		reveal.className = 'mp-random-reveal';
		reveal.style.left = `${Math.round(startLeft)}px`;
		reveal.style.top = `${Math.round(startTop)}px`;
		reveal.innerHTML = `
			<div class="mp-random-reveal-card">
				<div class="mp-random-reveal-head">🎲 Random kaart!</div>
				<div class="mp-random-reveal-color" style="${colorStyle}"></div>
				<div class="mp-random-reveal-shape">${this._renderMiniGrid(card.matrix, card.color, true)}</div>
				<div class="mp-random-reveal-name">${this._escapeHtml(card.shapeName || 'Onbekende kaart')}</div>
				<div class="mp-random-reveal-meta">
					<span>${cells} cellen</span>
					<span>${this._escapeHtml(card.category || 'standard')}</span>
				</div>
				<div class="mp-random-reveal-zones">Zones: ${this._escapeHtml(zonesText)}</div>
			</div>
		`;

		document.body.appendChild(reveal);
		requestAnimationFrame(() => reveal.classList.add('show'));
		setTimeout(() => reveal.classList.add('hide'), 1700);
		setTimeout(() => reveal.remove(), 2200);

		if (typeof this._playRevealSound === 'function') {
			this._playRevealSound();
		}
	}

	/** Show popup modal to pick 1 of 3 free cards after unlock */
	_showFreeCardChoice(choices) {
		const modal = document.createElement('div');
		modal.className = 'mp-card-choice-modal';

		const cardsHtml = choices.map(card => {
			const colorCode = card.color?.code || '#666';
			const isStone = card.isStone || card.color?.isStone;
			const isGolden = card.isGolden;
			const isRainbow = colorCode === 'rainbow' || card.color?.name === 'multikleur';

			let colorStyle;
			if (isStone) {
				colorStyle = 'background: linear-gradient(135deg, #a0a0a0, #8a8a8a, #707070)';
			} else if (isGolden) {
				colorStyle = `background: linear-gradient(135deg, ${colorCode}, #f5d76e, ${colorCode})`;
			} else if (isRainbow) {
				colorStyle = 'background: linear-gradient(135deg, #b56069, #cfba51, #92c28c, #5689b0, #8f76b8)';
			} else {
				colorStyle = `background: ${colorCode}`;
			}

			let cells = 0;
			if (card.matrix) for (const row of card.matrix) for (const c of row) { if (c) cells++; }

			return `
				<div class="mp-free-card-option" data-card-id="${card.id}">
					<div class="mp-shop-offering-color" style="${colorStyle}"></div>
					<div class="mp-card-shape">
						${this._renderMiniGrid(card.matrix, card.color, true)}
					</div>
					<div class="mp-card-name">${this._escapeHtml(card.shapeName)}</div>
					<div style="font-size: 0.7rem; color: var(--mp-text-dim);">${cells} cellen</div>
					<div class="mp-free-label">GRATIS</div>
				</div>
			`;
		}).join('');

		modal.innerHTML = `
			<div class="mp-card-choice-content">
				<h3>🎁 Kies 1 gratis kaart</h3>
				<p style="color: var(--mp-text-dim); font-size: 0.85rem; margin: 0 0 12px;">Selecteer een kaart om aan je deck toe te voegen</p>
				<div class="mp-free-card-grid">
					${cardsHtml}
				</div>
			</div>
		`;

		modal.addEventListener('click', async (e) => {
			const option = e.target.closest('.mp-free-card-option');
			if (!option) return;

			const cardId = option.dataset.cardId;
			if (!cardId) return;

			try {
				const result = await this.mp.claimFreeCard(cardId);
				if (result.success) {
					this._showToast('✅ Kaart toegevoegd aan je deck!', 'success');
					this._playRevealSound();
					modal.remove();
					this._renderShop();
				} else {
					this._showToast(result.error || 'Kies mislukt', 'error');
				}
			} catch (err) {
				this._showToast('Fout: ' + (err.message || err), 'error');
			}
		});

		document.body.appendChild(modal);
	}

	_showBonusColorPicker(itemId) {
		const colors = ['yellow', 'green', 'blue', 'red', 'purple'];
		const colorNames = { yellow: 'Geel', green: 'Groen', blue: 'Blauw', red: 'Rood', purple: 'Paars' };
		const colorCodes = { yellow: '#cfba51', green: '#92c28c', blue: '#5689b0', red: '#b56069', purple: '#8f76b8' };

		const modal = document.createElement('div');
		modal.className = 'mp-card-choice-modal';
		modal.innerHTML = `
			<div class="mp-card-choice-content">
				<h3>Kies een bonus kleur</h3>
				<div class="mp-bonus-color-grid">
					${colors.map(c => `
						<button class="mp-bonus-color-option" data-color="${c}" style="background:${colorCodes[c]}">
							${colorNames[c]}
						</button>
					`).join('')}
				</div>
			</div>
		`;
		document.body.appendChild(modal);

		modal.querySelectorAll('.mp-bonus-color-option').forEach(btn => {
			btn.addEventListener('click', async () => {
				const color = btn.dataset.color;
				try {
					const result = await this.mp.buyShopItem(itemId, { bonusColor: color });
					modal.remove();
					if (result.success) {
						this._showToast(`${colorNames[color]} bonus verkregen!`, 'success');
						this._renderShop();
					} else {
						this._showToast(result.error, 'error');
					}
				} catch (err) {
					this._showToast('Fout: ' + (err.message || err), 'error');
				}
			});
		});
	}

	async _handleShopReady() {
		try {
			const result = await this.mp.setShopReady();
			if (result.success) {
				this._showToast('Klaar! Wachten op anderen...', 'success');
				this._renderShop();
			}
		} catch (err) {
			this._showToast('Fout: ' + (err.message || err), 'error');
		}
	}

	_onNextLevel(level) {
		this._showToast(`Level ${level} begint!`, 'success');
		// Game state will update via gameStateChanged → playing phase → shows game screen
	}

	// ──────────────────────────────────────────
	//  STATE UPDATES
	// ──────────────────────────────────────────

	_onGameStateChanged(state, prevState) {
		if (state.phase !== prevState?.phase) {
			console.log('[Locus UI] Phase transition:', prevState?.phase, '→', state.phase);
		}
		try { this._checkBonusSpawnNotifications(state, prevState); } catch (e) { console.error('[Locus UI] bonus spawn notification error:', e); }
		if (state.phase === 'playing') {
			this._syncTurnTimerFromState(state);
		}

		if (state.phase === 'waiting') {
			this._stopOpponentTimerTicker();
			if (this._startDeckOverlay) {
				this._startDeckOverlay.remove();
				this._startDeckOverlay = null;
			}
			this._updatePlayerList();
			// Als we nog op het lobby-screen staan, schakel naar wachtkamer
			const lobbyVisible = this.elements['lobby-screen']?.style.display !== 'none';
			if (lobbyVisible && this.mp.inviteCode) {
				const isHost = state.hostPlayerId === this.mp.userId;
				this._showWaitingRoom(this.mp.inviteCode, isHost);
			}
		}
		if (state.phase === 'choosingStartDeck') {
			this._onStartDeckPhase();
		}
		if (state.phase === 'choosingGoals') {
			console.log('[Locus UI] choosingGoals detected, userId:', this.mp.userId,
				'objectiveChoices keys:', Object.keys(state.objectiveChoices || {}),
				'myChoices:', state.objectiveChoices?.[this.mp.userId]?.length || 0);
			// Verberg startdeck overlay als die er nog is
			if (this._startDeckOverlay) {
				this._startDeckOverlay.remove();
				this._startDeckOverlay = null;
			}
			// Haal objective keuzes uit de state en toon ze
			const myChoices = state.objectiveChoices?.[this.mp.userId];
			const myPlayer = state.players?.[this.mp.userId];
			if (myPlayer?.chosenObjective) {
				// Al gekozen, wacht op andere spelers
				console.log('[Locus UI] Goal al gekozen, wacht op anderen');
				this._showScreen('goal-screen');
				const container = this.elements['goal-choices-container'];
				if (container) container.innerHTML = '<h2 class="mp-section-title">Doelstelling gekozen!</h2><p class="mp-section-subtitle">Wachten op andere spelers...</p>';
			} else if (myChoices && myChoices.length > 0) {
				this._onGoalPhase(myChoices);
			} else {
				console.warn('[Locus UI] choosingGoals maar GEEN choices gevonden voor userId:', this.mp.userId,
					'| objectiveChoices:', JSON.stringify(state.objectiveChoices ? Object.keys(state.objectiveChoices) : 'null'),
					'| players keys:', Object.keys(state.players || {}));
				// Forceer toch naar goal-screen zodat de UI niet vasthangt
				this._showScreen('goal-screen');
				const container = this.elements['goal-choices-container'];
				if (container) container.innerHTML = '<h2 class="mp-section-title">Wachten op doelstellingen...</h2>';
			}
		}
		if (state.phase === 'playing') {
			if (prevState?.phase !== 'playing') {
				this._lastTimerBeep = null;
				this._syncTurnTimerFromState(state);
				// Schakel naar game-screen als we er nog niet zijn
				this._showScreen('game-screen');
			}
			this._startOpponentTimerTicker();
			if (this._startDeckOverlay) {
				this._startDeckOverlay.remove();
				this._startDeckOverlay = null;
			}
			// Bewaar huidige scores voor animatie (van vorige state)
			this._capturePrevScores(prevState);

			// Cancel bonus mode voor re-render (cellen worden vervangen)
			this._cancelBonusMode();

			try { this._renderBoard(state.boardState); } catch (e) { console.error('[Locus UI] renderBoard error:', e); }
			try { this._playPendingBonusSpawnAnimations(); } catch (e) { console.error('[Locus UI] playPendingBonusSpawnAnimations error:', e); }
			try { this._renderScoreboard(); } catch (e) { console.error('[Locus UI] renderScoreboard error:', e); }
			try { this._renderHand(); } catch (e) { console.error('[Locus UI] renderHand error:', e); }
			try { this._updateTurnIndicator(); } catch (e) { console.error('[Locus UI] updateTurnIndicator error:', e); }
			try { this._renderBonusBar(prevState); } catch (e) { console.error('[Locus UI] renderBonusBar error:', e); }
			try { this._renderOpponentPanels(); } catch (e) { console.error('[Locus UI] renderOpponentPanels error:', e); }
			try { this._updateDeckCount(); } catch (e) { console.error('[Locus UI] updateDeckCount error:', e); }
			try { this._renderMyObjective(); } catch (e) { console.error('[Locus UI] renderMyObjective error:', e); }

			// Check objective achievement (detect transition)
			try { this._checkObjectiveAchievement(state, prevState); } catch (e) { console.error('[Locus UI] checkObjectiveAchievement error:', e); }

			// Score animaties
			try { this._showScoreAnimations(); } catch (e) { console.error('[Locus UI] showScoreAnimations error:', e); }

			// Check objective reveal
			if (state._objectivesRevealed && !this._objectivesRevealed) {
				this._onObjectivesRevealed();
			}
		}
		if (state.phase === 'levelComplete' && state.levelScores) {
			this._stopOpponentTimerTicker();
			if (this._startDeckOverlay) {
				this._startDeckOverlay.remove();
				this._startDeckOverlay = null;
			}
			console.log('[Locus UI] gameStateChanged: phase=levelComplete, scores:', Object.keys(state.levelScores));
			// Always show overlay when phase is levelComplete — force re-render
			this._cancelDrag();
			this._cancelBonusMode();
			this._stopTurnTimer();
			this._onLevelComplete(state.levelScores, state.levelWinner, state.level);
		}
		if (state.phase === 'shopping') {
			this._stopOpponentTimerTicker();
			if (this._startDeckOverlay) {
				this._startDeckOverlay.remove();
				this._startDeckOverlay = null;
			}
			// Re-render shop when state updates (e.g. other player bought something / ready)
			if (this.elements['shop-screen']?.style.display !== 'none') {
				this._renderShop();
			} else {
				this._onShopPhase();
			}
		}
		if (state.phase === 'ended' && state.finalScores) {
			this._stopOpponentTimerTicker();
			if (this._startDeckOverlay) {
				this._startDeckOverlay.remove();
				this._startDeckOverlay = null;
			}
			this._cancelDrag();
			this._cancelBonusMode();
			this._onGameEnded(state.finalScores, state.winner);
		}
	}

	_checkBonusSpawnNotifications(state, prevState) {
		if (!state || state.phase !== 'playing' || !prevState || prevState.phase !== 'playing') return;
		const currentHistory = Array.isArray(state.moveHistory) ? state.moveHistory : [];
		const prevHistoryLen = Array.isArray(prevState.moveHistory) ? prevState.moveHistory.length : 0;
		if (currentHistory.length <= prevHistoryLen) return;

		const newEntries = currentHistory.slice(prevHistoryLen);
		const spawnEntries = newEntries.filter(entry => entry && entry.type === 'bonus-spawn');
		if (spawnEntries.length === 0) return;

		for (const entry of spawnEntries) {
			const spawned = Number(entry.spawned || 0);
			const requested = Number(entry.requested || 0);
			const round = Number(entry.round || state.turnCount || 0);
			const isRoundStart = !!entry.isRoundStart;

			if (!isRoundStart && spawned <= 0) continue;
			if (spawned > 0) {
				const detail = requested > 0 && requested !== spawned
					? `+${spawned}/${requested} extra bonussen`
					: `+${spawned} extra bonussen`;
				this._showToast(isRoundStart ? `Ronde ${round}: ${detail}` : `Halverwege: ${detail}`, 'success');
				this._playRevealSound();
				this._pendingBonusSpawnCells = this._collectNewBonusSpawnCells(prevState?.boardState, state?.boardState);
			} else if (isRoundStart) {
				this._showToast(`Ronde ${round}: geen ruimte voor extra bonussen`, 'info');
			}
		}
	}

	_collectNewBonusSpawnCells(prevBoard, nextBoard) {
		const additions = [];
		if (!prevBoard?.zones || !nextBoard?.zones) return additions;

		const zoneNames = ['yellow', 'green', 'blue', 'purple'];
		for (const zoneName of zoneNames) {
			const prevZone = prevBoard.zones?.[zoneName];
			const nextZone = nextBoard.zones?.[zoneName];
			if (!prevZone?.cells || !nextZone?.cells) continue;
			for (const [key, nextCell] of Object.entries(nextZone.cells)) {
				const prevCell = prevZone.cells?.[key];
				if (!nextCell || nextCell.active) continue;
				if (!prevCell?.bonusSymbol && nextCell.bonusSymbol) {
					additions.push({ zoneName, subgridId: null, x: nextCell.x, y: nextCell.y, bonusSymbol: nextCell.bonusSymbol });
				}
			}
		}

		const prevRed = prevBoard.zones?.red?.subgrids || [];
		const nextRed = nextBoard.zones?.red?.subgrids || [];
		for (const nextSubgrid of nextRed) {
			const prevSubgrid = prevRed.find(sg => sg.id === nextSubgrid.id);
			if (!nextSubgrid?.cells || !prevSubgrid?.cells) continue;
			for (const [key, nextCell] of Object.entries(nextSubgrid.cells)) {
				const prevCell = prevSubgrid.cells?.[key];
				if (!nextCell || nextCell.active) continue;
				if (!prevCell?.bonusSymbol && nextCell.bonusSymbol) {
					additions.push({ zoneName: 'red', subgridId: nextSubgrid.id, x: nextCell.x, y: nextCell.y, bonusSymbol: nextCell.bonusSymbol });
				}
			}
		}

		return additions;
	}

	_playPendingBonusSpawnAnimations() {
		const pending = Array.isArray(this._pendingBonusSpawnCells) ? this._pendingBonusSpawnCells : [];
		if (pending.length === 0) return;
		this._pendingBonusSpawnCells = [];

		const bonusColors = {
			yellow: '#cfba51', green: '#92c28c', blue: '#5689b0',
			red: '#b56069', purple: '#8f76b8', any: '#c47bd7'
		};

		pending.forEach((entry, idx) => {
			const selector = entry.subgridId
				? `.mp-cell[data-zone="${entry.zoneName}"][data-subgrid="${entry.subgridId}"][data-x="${entry.x}"][data-y="${entry.y}"]`
				: `.mp-cell[data-zone="${entry.zoneName}"][data-x="${entry.x}"][data-y="${entry.y}"]`;
			const cellEl = document.querySelector(selector);
			if (!cellEl) return;

			cellEl.classList.add('bonus-just-spawned');
			setTimeout(() => cellEl.classList.remove('bonus-just-spawned'), 1700);

			if (idx < 8) {
				const rect = cellEl.getBoundingClientRect();
				const cx = rect.left + rect.width / 2;
				const cy = rect.top + rect.height / 2;
				this._showSparkle(cx, cy, 4);
				this._showConfetti(cx, cy, 6, [bonusColors[entry.bonusSymbol] || '#ffffff', '#ffffff']);
			}
		});
	}

	_capturePrevScores(prevState) {
		this._prevScores = {};
		if (!prevState || !prevState.playerOrder) return;
		for (const pid of prevState.playerOrder) {
			const p = prevState.players[pid];
			if (p) {
				this._prevScores[pid] = {
					score: p.score || 0,
					breakdown: p.scoreBreakdown ? { ...p.scoreBreakdown } : {}
				};
			}
		}
	}

	_showScoreAnimations() {
		const scoreboard = this.mp.getScoreboard();
		const zoneColors = {
			yellow: '#cfba51', green: '#92c28c', blue: '#5689b0',
			red: '#b56069', purple: '#8f76b8'
		};

		let myScoreChanged = false;
		let opponentScoreChanged = false;

		for (const p of scoreboard) {
			const prev = this._prevScores[p.id];
			if (!prev) continue;
			const totalDelta = p.score - prev.score;
			if (totalDelta <= 0) continue;

			if (p.isMe) myScoreChanged = true;
			else opponentScoreChanged = true;

			// Per-zone score deltas → floating text op de zone
			const bd = p.scoreBreakdown || {};
			const prevBd = prev.breakdown || {};
			const zoneKeys = ['yellow', 'green', 'blue', 'red', 'purple'];
			for (const z of zoneKeys) {
				const zoneDelta = (bd[z] || 0) - (prevBd[z] || 0);
				if (zoneDelta > 0) {
					const zoneEl = document.querySelector(`.mp-zone-${z}`);
					if (zoneEl) {
						this._showFloatingScore(zoneEl, `+${zoneDelta}`, zoneColors[z] || '#fff');
					}
				}
			}

			// Bonus delta
			const bonusDelta = (bd.bonus || 0) - (prevBd.bonus || 0);
			if (bonusDelta > 0) {
				const rows = document.querySelectorAll('.mp-score-row');
				for (const row of rows) {
					const nameEl = row.querySelector('.mp-score-name');
					if (nameEl && nameEl.textContent.includes(p.name)) {
						this._createScorePopup(row, `+${bonusDelta} bonus`);
						break;
					}
				}
			}

			// Total score popup op scoreboard
			if (totalDelta > 0) {
				const rows = document.querySelectorAll('.mp-score-row');
				for (const row of rows) {
					const nameEl = row.querySelector('.mp-score-name');
					if (!nameEl) continue;
					if (nameEl.textContent.includes(p.name)) {
						this._createScorePopup(row, `+${totalDelta} pt`);
						const isBloom = document.documentElement.classList.contains('theme-bloom');
						if (isBloom) {
							const rr = row.getBoundingClientRect();
							this._showConfetti(rr.left + rr.width / 2, rr.top + rr.height / 2, 8);
						}
						break;
					}
				}
			}
		}

		// Play sounds
		if (myScoreChanged) this._playScoreSound();
		else if (opponentScoreChanged) this._playOpponentScoreSound();
	}

	/** Floating score text op een zone element (zoals index.html showScoreAnimation) */
	_showFloatingScore(zoneEl, text, color = '#fff') {
		const rect = zoneEl.getBoundingClientRect();
		const el = document.createElement('div');
		el.className = 'mp-float-score';
		el.textContent = text;
		el.style.color = color;
		el.style.left = `${rect.left + rect.width / 2}px`;
		el.style.top = `${rect.top + rect.height / 2}px`;
		document.body.appendChild(el);
		setTimeout(() => el.remove(), 1300);
	}

	/** Sparkle burst effect (bij goud) */
	_showSparkle(x, y, count = 6) {
		const isBloom = document.documentElement.classList.contains('theme-bloom');
		for (let i = 0; i < count; i++) {
			const s = document.createElement('div');
			s.className = 'mp-sparkle';
			const angle = Math.random() * 2 * Math.PI;
			const dist = isBloom ? (35 + Math.random() * 30) : (30 + Math.random() * 20);
			s.style.left = `${x}px`;
			s.style.top = `${y}px`;
			s.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
			s.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
			if (isBloom) s.style.animationDelay = `${i * 40}ms`;
			document.body.appendChild(s);
			setTimeout(() => s.remove(), isBloom ? 1100 : 900);
		}
	}

	/** Confetti burst (Bloom theme dopamine) */
	_showConfetti(x, y, count = 8, colors = ['#e07a5f', '#4caf68', '#5a9ec9', '#d4a820', '#9678c4', '#f0a030', '#d46b7a']) {
		for (let i = 0; i < count; i++) {
			const c = document.createElement('div');
			c.className = 'mp-confetti';
			const angle = Math.random() * 2 * Math.PI;
			const dist = 40 + Math.random() * 60;
			c.style.left = `${x + (Math.random() - 0.5) * 20}px`;
			c.style.top = `${y + (Math.random() - 0.5) * 20}px`;
			c.style.background = colors[Math.floor(Math.random() * colors.length)];
			c.style.setProperty('--dx', `${Math.cos(angle) * dist}px`);
			c.style.setProperty('--dy', `${-20 - Math.random() * 80}px`);
			c.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
			c.style.animationDelay = `${i * 30}ms`;
			c.style.width = `${6 + Math.random() * 6}px`;
			c.style.height = `${4 + Math.random() * 4}px`;
			document.body.appendChild(c);
			setTimeout(() => c.remove(), 1200);
		}
	}

	/** Bouncing coin animation (Bloom gold reward) */
	_showCoinBounce(x, y) {
		const coin = document.createElement('div');
		coin.className = 'mp-coin-bounce';
		coin.textContent = '🪙';
		coin.style.left = `${x}px`;
		coin.style.top = `${y}px`;
		document.body.appendChild(coin);
		setTimeout(() => coin.remove(), 1000);
	}

	/** Wordt aangeroepen als een move wordt gebroadcast (met bonus/goud info) */
	_onMovePlayed(data) {
		const { playerId, playerName, zoneName, goldCollected, bonusesCollected, cardsPlayed, objectivesRevealed } = data;
		const isMe = playerId === this.mp.userId;
		const zoneEl = document.querySelector(`.mp-zone-${zoneName}`);
		if (!zoneEl) return;
		const rect = zoneEl.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;

		// Play placement sound
		this._playPlaceSound();

		// Animate: show "player played on zone" banner for opponents
		if (!isMe && playerName) {
			this._showMoveNotification(playerName, zoneName);
			this._scrollMobileBoardToZone(zoneName, true);
		}

		// Animate cells flashing on the zone
		if (zoneEl) {
			zoneEl.classList.add('mp-zone-flash');
			setTimeout(() => zoneEl.classList.remove('mp-zone-flash'), 700);
		}

		// Bloom effects policy: geen confetti op gewone plaatsing
		const isBloom = document.documentElement.classList.contains('theme-bloom');

		// Goud sparkle + tekst
		if (goldCollected > 0) {
			const sparkleCount = isBloom ? 14 : 8;
			this._showSparkle(cx, cy, sparkleCount);
			this._showFloatingScore(zoneEl, `💰 +${goldCollected} goud`, '#f5d76e');
			this._playGoldSound();
			// Bloom: coin bounce + geel spray/confetti op coin pickup
			if (isBloom) {
				this._showCoinBounce(cx, cy);
				this._showConfetti(cx, cy, 10, ['#fff3a1', '#f5d76e', '#e8c547', '#d4a820']);
			}
		}

		// Bonus collectie tekst
		if (bonusesCollected && bonusesCollected.length > 0) {
			const bonusColors = {
				yellow: '#cfba51', green: '#92c28c', blue: '#5689b0',
				red: '#b56069', purple: '#8f76b8', any: '#c47bd7'
			};
			for (let i = 0; i < bonusesCollected.length; i++) {
				const bc = bonusesCollected[i];
				setTimeout(() => {
					this._showFloatingScore(zoneEl, '↙ BONUS', bonusColors[bc] || '#fff');
				}, 200 + i * 300);
			}
		}

		// Check objective reveal
		if (objectivesRevealed && !this._objectivesRevealed) {
			setTimeout(() => this._onObjectivesRevealed(), 800);
		}

		// Update opponent panels
		this._renderOpponentPanels();
	}

	/** Toon een notificatie wanneer een andere speler een kaart speelt */
	_showMoveNotification(playerName, zoneName) {
		const zoneLabels = { yellow: 'Geel', green: 'Groen', blue: 'Blauw', red: 'Rood', purple: 'Paars' };
		const zoneColors = { yellow: '#cfba51', green: '#92c28c', blue: '#5689b0', red: '#b56069', purple: '#8f76b8' };

		const notif = document.createElement('div');
		notif.className = 'mp-move-notification';
		notif.innerHTML = `
			<span class="mp-move-notif-name">${this._escapeHtml(playerName)}</span>
			<span>speelde op</span>
			<span class="mp-move-notif-zone" style="color:${zoneColors[zoneName] || '#fff'}">${zoneLabels[zoneName] || zoneName}</span>
		`;
		document.body.appendChild(notif);
		requestAnimationFrame(() => notif.classList.add('visible'));
		setTimeout(() => {
			notif.classList.remove('visible');
			setTimeout(() => notif.remove(), 300);
		}, 2000);
	}

	_createScorePopup(anchor, text) {
		const popup = document.createElement('div');
		popup.className = 'mp-score-popup';
		popup.textContent = text;
		anchor.style.position = 'relative';
		anchor.appendChild(popup);
		// Verwijder na animatie
		popup.addEventListener('animationend', () => popup.remove());
	}

	_onPlayerJoined(player) {
		this._updatePlayerList();
		this._showToast(`${player.name} is gejoind!`, 'info');
	}

	_onConnectionChanged(connected) {
		if (!connected) {
			this._showToast('Verbinding verloren...', 'warning');
		} else {
			this._showToast('Verbonden!', 'success');
		}
	}

	_onError(error) {
		console.error('[Locus UI] Error:', error);
		this._showToast(error.message || 'Er ging iets mis', 'error');
	}

	// ──────────────────────────────────────────
	//  UTILITY
	// ──────────────────────────────────────────

	_escapeHtml(str) {
		const div = document.createElement('div');
		div.textContent = str || '';
		return div.innerHTML;
	}

	_setLoading(loading) {
		document.body.classList.toggle('mp-loading', loading);
	}

	_showToast(message, type = 'info') {
		const existing = document.getElementById('mp-toast');
		if (existing) existing.remove();
		let layer = document.getElementById('mp-toast-layer');
		if (!layer) {
			layer = document.createElement('div');
			layer.id = 'mp-toast-layer';
			layer.className = 'mp-toast-layer';
			document.body.appendChild(layer);
		}

		const toast = document.createElement('div');
		toast.id = 'mp-toast';
		toast.className = `mp-toast mp-toast-${type}`;
		toast.textContent = message;
		layer.appendChild(toast);

		requestAnimationFrame(() => toast.classList.add('visible'));

		setTimeout(() => {
			toast.classList.remove('visible');
			setTimeout(() => toast.remove(), 300);
		}, 3000);
	}
}

// Browser global
if (typeof window !== 'undefined') {
	window.LocusLobbyUI = LocusLobbyUI;
}
