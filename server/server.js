/**
 * ============================================================
 * LOCUS MULTIPLAYER — Self-Hosted Game Server
 * ============================================================
 * Express + Socket.IO server. Geen Firebase, geen cloud,
 * geen betaalplan nodig. Draait op je eigen PC.
 *
 * Start:  cd server && npm install && npm start
 * ============================================================
 */

const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const GameRules = require('../shared/game-rules');

// ──────────────────────────────────────────────
//  CONFIG
// ──────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

// ──────────────────────────────────────────────
//  IN-MEMORY STORAGE
// ──────────────────────────────────────────────

/** @type {Map<string, object>} gameId → gameState */
const games = new Map();

/** @type {Map<string, string>} inviteCode → gameId */
const inviteCodes = new Map();

/** @type {Map<string, {gameId: string, playerId: string}>} socket.id → { gameId, playerId } */
const socketToPlayer = new Map();

/** @type {Map<string, NodeJS.Timeout>} gameId → turn timer */
const turnTimers = new Map();
/** @type {Map<string, number>} playerId → last taunt timestamp */
const tauntCooldowns = new Map();

const TAUNT_COOLDOWN_MS = 2000;
const ALLOWED_TAUNTS = new Set([
	'Nooo!',
	'HAHA',
	'Well played!',
	'Oeps...',
	'Kom op!'
]);

const TURN_TIMER_MS = 40000; // 40 seconden per beurt

function _startTurnTimer(gameId, playerId, durationMs = TURN_TIMER_MS) {
	_clearTurnTimer(gameId);
	const gameState = games.get(gameId);
	if (!gameState) return;
	const duration = Math.max(1, Number(durationMs) || TURN_TIMER_MS);
	gameState._turnTimerStart = Date.now();
	gameState._turnTimerDurationMs = duration;
	gameState._turnTimerRemainingMs = duration;
	gameState.paused = false;
	gameState.pausedAt = null;
	gameState.updatedAt = Date.now();

	const timer = setTimeout(() => {
		turnTimers.delete(gameId);
		const gameState = games.get(gameId);
		if (!gameState || gameState.phase !== 'playing') return;
		if (gameState.paused) return;
		const currentPid = gameState.playerOrder[gameState.currentTurnIndex];
		if (currentPid !== playerId) return; // beurt al gewisseld
		gameState._turnTimerRemainingMs = 0;
		// Auto-end turn
		const endResult = GameRules.endTurn(gameState, playerId);
		console.log(`[Locus] Timer verlopen voor ${playerId} — auto endTurn (ended: ${endResult.gameEnded})`);
		if (endResult.gameEnded) {
			broadcastGameState(io, gameId);
			io.to(gameId).emit('levelComplete', {
				levelScores: gameState.levelScores,
				levelWinner: gameState.levelWinner,
				level: gameState.level
			});
		} else {
			// Start fresh timer voor de volgende speler
			_startTimerForCurrentPlayer(gameId, true);
			broadcastGameState(io, gameId);
		}
	}, duration);
	turnTimers.set(gameId, timer);
}

/** Start timer voor de huidige speler in een game (na beurt-wissel) */
function _startTimerForCurrentPlayer(gameId, forceFull = false) {
	const gameState = games.get(gameId);
	if (!gameState || gameState.phase !== 'playing') return;
	if (gameState.paused) return;
	const currentPid = gameState.playerOrder[gameState.currentTurnIndex];
	if (currentPid) {
		const duration = forceFull
			? TURN_TIMER_MS
			: Math.max(1, Number(gameState._turnTimerRemainingMs) || TURN_TIMER_MS);
		_startTurnTimer(gameId, currentPid, duration);
	}
}

function _grantExtraTurnTime(gameId, playerId, extraMs = 5000) {
	const gameState = games.get(gameId);
	if (!gameState || gameState.phase !== 'playing' || gameState.paused) return;
	const currentPid = gameState.playerOrder?.[gameState.currentTurnIndex];
	if (!currentPid || currentPid !== playerId) return;
	const remainingMs = _getRemainingTurnMs(gameState);
	const nextRemaining = Math.max(1, remainingMs + Math.max(0, Number(extraMs) || 0));
	_startTurnTimer(gameId, currentPid, nextRemaining);
}

function _clearTurnTimer(gameId) {
	const existing = turnTimers.get(gameId);
	if (existing) {
		clearTimeout(existing);
		turnTimers.delete(gameId);
	}
}

function _getRemainingTurnMs(gameState) {
	const duration = Math.max(1, Number(gameState?._turnTimerDurationMs) || TURN_TIMER_MS);
	const startedAt = Number(gameState?._turnTimerStart || 0);
	if (!Number.isFinite(startedAt) || startedAt <= 0) {
		return Math.max(1, Number(gameState?._turnTimerRemainingMs) || duration);
	}
	const elapsed = Math.max(0, Date.now() - startedAt);
	return Math.max(1, duration - elapsed);
}

function _togglePause(gameId, playerId) {
	const gameState = games.get(gameId);
	if (!gameState) return { error: 'Spel niet gevonden.' };
	if (gameState.phase !== 'playing') return { error: 'Pauze kan alleen tijdens het spelen.' };

	if (!gameState.paused) {
		const remainingMs = _getRemainingTurnMs(gameState);
		_clearTurnTimer(gameId);
		gameState.paused = true;
		gameState.pausedBy = playerId;
		gameState.pausedAt = Date.now();
		gameState._turnTimerRemainingMs = remainingMs;
		gameState.updatedAt = Date.now();
		return { success: true, paused: true, remainingMs };
	}

	const currentPid = gameState.playerOrder[gameState.currentTurnIndex];
	const remainingMs = Math.max(1, Number(gameState._turnTimerRemainingMs) || TURN_TIMER_MS);
	gameState.paused = false;
	gameState.pausedBy = playerId;
	gameState.pausedAt = null;
	gameState.updatedAt = Date.now();
	if (currentPid) {
		_startTurnTimer(gameId, currentPid, remainingMs);
	}
	return { success: true, paused: false, remainingMs };
}

// ──────────────────────────────────────────────
//  HELPERS
// ──────────────────────────────────────────────

function generateId() {
	return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function generateInviteCode() {
	const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	let code = '';
	for (let i = 0; i < 6; i++) {
		code += chars[Math.floor(Math.random() * chars.length)];
	}
	// Zorg dat code uniek is
	if (inviteCodes.has(code)) return generateInviteCode();
	return code;
}

function generatePlayerId() {
	return 'P_' + generateId();
}

/** Tel hoeveel kaarten een speler heeft gespeeld (niet passes) */
function countCardsPlayed(gameState, playerId) {
	if (!gameState.moveHistory) return 0;
	return gameState.moveHistory.filter(m => m.playerId === playerId && !m.pass && !m.bonusMove && m.cardId).length;
}

/** Check of objectives moeten worden onthuld (na 4 kaarten per speler) */
function shouldRevealObjectives(gameState) {
	const round = Number(gameState?.turnCount || 0);
	return round > 4;
}

/** Verberg kaarten/doelstellingen van andere spelers */
function sanitizeGameStateForPlayer(gameState, playerId) {
	const sanitized = JSON.parse(JSON.stringify(gameState));

	// Check of objectives onthuld moeten worden
	const revealObjectives = shouldRevealObjectives(gameState);
	sanitized._objectivesRevealed = revealObjectives;

	for (const pid of Object.keys(sanitized.players)) {
		if (pid !== playerId) {
			// Laat hand zichtbaar voor tegenstanders (gevraagd UX-gedrag)
			sanitized.players[pid].drawPile = Array.isArray(sanitized.players[pid].drawPile)
				? sanitized.players[pid].drawPile.length
				: (sanitized.players[pid].drawPile || 0);
			sanitized.players[pid].discardPile = Array.isArray(sanitized.players[pid].discardPile)
				? sanitized.players[pid].discardPile.length
				: (sanitized.players[pid].discardPile || 0);
			sanitized.players[pid].deck = [];

			// Verberg shop offerings van tegenstanders
			sanitized.players[pid].shopOfferings = [];

			// Verberg pendingFreeChoices van tegenstanders
			delete sanitized.players[pid]._pendingFreeChoices;

			// Onthul objective na 4 kaarten gespeeld, anders verberg
			if (sanitized.players[pid].chosenObjective) {
				if (revealObjectives) {
					// Laat de objective zien!
					sanitized.players[pid].chosenObjective._revealed = true;
				} else {
					sanitized.players[pid].chosenObjective = { hidden: true };
				}
			}
		}

		// Voeg cardsPlayed count toe voor elke speler
		sanitized.players[pid].cardsPlayed = countCardsPlayed(gameState, pid);

		// Check of objective behaald is (zichtbaar voor iedereen)
		if (gameState.players[pid].chosenObjective && gameState.boardState) {
			const objectiveDef = gameState.players[pid].chosenObjective || {};
			const isEndOnlyObjective = !!objectiveDef.endOnly;
			const objResult = GameRules.checkObjective(gameState, pid, gameState.players[pid].chosenObjective);
			const shouldDelayOutcome = isEndOnlyObjective && gameState.phase === 'playing';
			if (shouldDelayOutcome) {
				sanitized.players[pid].objectiveAchieved = !!gameState.players[pid].objectiveAchieved;
				sanitized.players[pid].objectiveFailed = false;
				sanitized.players[pid].objectiveAchievedPoints = gameState.players[pid].objectiveAchievedPoints || 0;
			} else {
				// Use already-awarded flag if set by checkAndAwardObjective, otherwise use checkObjective result
				sanitized.players[pid].objectiveAchieved = gameState.players[pid].objectiveAchieved || objResult.achieved;
				sanitized.players[pid].objectiveFailed = !sanitized.players[pid].objectiveAchieved && !!objResult.failed;
				sanitized.players[pid].objectiveAchievedPoints = gameState.players[pid].objectiveAchievedPoints || 0;
			}
			sanitized.players[pid].objectiveProgress = {
				current: objResult.current,
				target: objResult.target,
				points: objResult.points,
				coins: objResult.coins || 0,
				randomBonuses: objResult.randomBonuses || 0
			};
		}

		// Verberg objective keuzes van anderen
		if (pid !== playerId && sanitized.objectiveChoices && sanitized.objectiveChoices[pid]) {
			sanitized.objectiveChoices[pid] = [];
		}
	}

	return sanitized;
}

/** Stuur game state naar alle spelers in een kamer (gesanitized per speler) */
function broadcastGameState(io, gameId) {
	const gameState = games.get(gameId);
	if (!gameState) return;

	const room = io.sockets.adapter.rooms.get(gameId);
	if (!room) return;

	for (const socketId of room) {
		const info = socketToPlayer.get(socketId);
		if (!info) continue;
		const socket = io.sockets.sockets.get(socketId);
		if (!socket) continue;

		const sanitized = sanitizeGameStateForPlayer(gameState, info.playerId);
		socket.emit('gameState', sanitized);
	}
}

// ──────────────────────────────────────────────
//  EXPRESS + STATIC FILES
// ──────────────────────────────────────────────

const app = express();
const server = http.createServer(app);

// Serve de frontend vanuit de root folder (parent van server/)
const clientRoot = path.join(__dirname, '..');
app.use(express.static(clientRoot, {
	index: false, // we doen zelf de routing
	etag: false,
	maxAge: 0,
	setHeaders: (res) => {
		res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
		res.setHeader('Pragma', 'no-cache');
	}
}));

// Root → multiplayer.html
app.get('/', (req, res) => {
	res.sendFile(path.join(clientRoot, 'multiplayer.html'));
});

// Fallback
app.get('*', (req, res) => {
	res.sendFile(path.join(clientRoot, 'multiplayer.html'));
});

// ──────────────────────────────────────────────
//  SOCKET.IO
// ──────────────────────────────────────────────

const io = new Server(server, {
	cors: { origin: '*' }
});

io.on('connection', (socket) => {
	console.log(`[Locus] Client verbonden: ${socket.id}`);

	// ── CREATE GAME ──────────────────────────

	socket.on('createGame', (data, callback) => {
		try {
			const playerName = String(data.playerName || 'Speler').slice(0, 20);
			const maxPlayers = Math.min(8, Math.max(2, Number(data.maxPlayers) || 4));
			const cardsPerPlayer = Math.min(16, Math.max(4, Number(data.cardsPerPlayer) || 8));

			const gameId = generateId();
			const playerId = generatePlayerId();
			const inviteCode = generateInviteCode();
			const seed = Date.now() + Math.floor(Math.random() * 100000);

			const gameState = GameRules.createGameState(gameId, playerId, {
				seed,
				maxPlayers,
				cardsPerPlayer,
				handSize: 3
			});

			GameRules.addPlayer(gameState, playerId, playerName);

			// Opslaan
			games.set(gameId, gameState);
			inviteCodes.set(inviteCode, gameId);
			gameState.inviteCode = inviteCode;

			// Socket koppelen
			socketToPlayer.set(socket.id, { gameId, playerId });
			socket.join(gameId);

			console.log(`[Locus] Game aangemaakt: ${gameId} (code: ${inviteCode}) door ${playerName}`);

			callback({
				success: true,
				gameId,
				inviteCode,
				playerId
			});

			// Stuur initiële state
			broadcastGameState(io, gameId);

		} catch (error) {
			console.error('[Locus] createGame error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── JOIN GAME ────────────────────────────

	socket.on('joinGame', (data, callback) => {
		try {
			const playerName = String(data.playerName || 'Speler').slice(0, 20);
			const code = String(data.inviteCode || '').toUpperCase().trim();

			if (!code || code.length !== 6) {
				return callback({ success: false, error: 'Ongeldige invite code.' });
			}

			const gameId = inviteCodes.get(code);
			if (!gameId) {
				return callback({ success: false, error: 'Invite code niet gevonden.' });
			}

			const gameState = games.get(gameId);
			if (!gameState) {
				return callback({ success: false, error: 'Spel niet gevonden.' });
			}

			// Check of deze socket al een playerId heeft in dit spel
			const existing = socketToPlayer.get(socket.id);
			if (existing && existing.gameId === gameId) {
				return callback({
					success: true,
					gameId,
					playerId: existing.playerId,
					alreadyJoined: true
				});
			}

			// Check voor speler met dezelfde naam (herverbinden — ook bij race-conditions waar connected nog true is)
			const nameMatch = Object.entries(gameState.players || {}).find(([pid, p]) =>
				String(p.name || '').trim().toLowerCase() === playerName.trim().toLowerCase()
			);
			if (nameMatch) {
				const [existingPlayerId, existingPlayer] = nameMatch;
				// Verwijder stale socket-mapping voor deze speler (race condition fix)
				for (const [sid, mappedInfo] of socketToPlayer.entries()) {
					if (mappedInfo.gameId === gameId && mappedInfo.playerId === existingPlayerId && sid !== socket.id) {
						socketToPlayer.delete(sid);
					}
				}
				existingPlayer.connected = true;
				socketToPlayer.set(socket.id, { gameId, playerId: existingPlayerId });
				socket.join(gameId);
				console.log(`[Locus] ${playerName} herverbonden via naam in game ${gameId}`);
				callback({ success: true, gameId, playerId: existingPlayerId, reconnected: true });
				broadcastGameState(io, gameId);
				socket.to(gameId).emit('playerReconnected', { playerId: existingPlayerId, name: existingPlayer.name });
				return;
			}

			const playerId = generatePlayerId();
			const addResult = GameRules.addPlayer(gameState, playerId, playerName);
			if (addResult.error) {
				return callback({ success: false, error: addResult.error });
			}

			// Socket koppelen
			socketToPlayer.set(socket.id, { gameId, playerId });
			socket.join(gameId);

			console.log(`[Locus] ${playerName} joined game ${gameId}`);

			callback({
				success: true,
				gameId,
				playerId
			});

			// Broadcast update naar alle spelers
			broadcastGameState(io, gameId);

			// Notificeer andere spelers
			socket.to(gameId).emit('playerJoined', {
				playerId,
				name: playerName
			});

		} catch (error) {
			console.error('[Locus] joinGame error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── START GAME ───────────────────────────

	socket.on('startGame', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });

			if (gameState.hostPlayerId !== info.playerId) {
				return callback({ success: false, error: 'Alleen de host kan het spel starten.' });
			}

			const startResult = GameRules.startGame(gameState);
			if (startResult.error) {
				return callback({ success: false, error: startResult.error });
			}

			console.log(`[Locus] Game ${info.gameId} gestart!`);

			callback({ success: true });

			// Stuur state naar iedereen (inclusief objectiveChoices per speler)
			broadcastGameState(io, info.gameId);

		} catch (error) {
			console.error('[Locus] startGame error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── CHOOSE GOAL ──────────────────────────

	socket.on('chooseStartingDeck', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });

			const deckType = String(data?.deckType || '').trim().toLowerCase();
			const result = GameRules.chooseStartingDeck(gameState, info.playerId, deckType);
			if (result.error) {
				return callback({ success: false, error: result.error });
			}

			console.log(`[Locus] Speler ${info.playerId} koos startdeck ${result.deckType}`);
			callback({ success: true, allChosen: !!result.allChosen, deckType: result.deckType });

			broadcastGameState(io, info.gameId);
		} catch (error) {
			console.error('[Locus] chooseStartingDeck error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── CHOOSE GOAL ──────────────────────────

	socket.on('chooseGoal', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });

			const objectiveIndex = Number(data.objectiveIndex);
			if (!Number.isFinite(objectiveIndex) || objectiveIndex < 0 || objectiveIndex > 2) {
				return callback({ success: false, error: 'objectiveIndex moet 0, 1 of 2 zijn.' });
			}

			const chooseResult = GameRules.chooseObjective(gameState, info.playerId, objectiveIndex);
			if (chooseResult.error) {
				return callback({ success: false, error: chooseResult.error });
			}

			console.log(`[Locus] Speler ${info.playerId} koos objective ${objectiveIndex}`);

			callback({ success: true, allChosen: chooseResult.allChosen });

			// Start timer voor de eerste speler als het spel begint
			if (chooseResult.allChosen) {
				_startTimerForCurrentPlayer(info.gameId, true);
			}
			broadcastGameState(io, info.gameId);

		} catch (error) {
			console.error('[Locus] chooseGoal error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── PLAY MOVE ────────────────────────────

	socket.on('playMove', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });
			if (gameState.paused) return callback({ success: false, error: 'Spel staat op pauze.' });

			const cardId = String(data.cardId || '');
			const zoneName = String(data.zoneName || '');
			const baseX = Number(data.baseX);
			const baseY = Number(data.baseY);
			const rotation = Number(data.rotation || 0);
			const mirrored = !!data.mirrored;
			const subgridId = data.subgridId ? String(data.subgridId) : null;

			if (!cardId || !zoneName) {
				return callback({ success: false, error: 'cardId en zoneName zijn verplicht.' });
			}
			if (!Number.isFinite(baseX) || !Number.isFinite(baseY)) {
				return callback({ success: false, error: 'baseX en baseY moeten getallen zijn.' });
			}

			const moveResult = GameRules.playMove(
				gameState, info.playerId, cardId, zoneName,
				baseX, baseY, rotation, mirrored, subgridId
			);

			if (moveResult.error) {
				return callback({ success: false, error: moveResult.error });
			}

			const gameStateCurrent = games.get(info.gameId);
			const playerData = gameStateCurrent?.players[info.playerId];
			console.log(`[Locus] Speler ${info.playerId} speelde ${cardId} op ${zoneName} (${baseX},${baseY})`);

			callback({
				success: true,
				goldCollected: moveResult.goldCollected || 0,
				bonusesCollected: moveResult.bonusesCollected || [],
				gameEnded: false
			});

			// Broadcast gedetailleerde move info aan alle spelers voor animaties
			io.to(info.gameId).emit('movePlayed', {
				playerId: info.playerId,
				playerName: playerData?.name || '???',
				zoneName,
				baseX, baseY,
				rotation: rotation,
				cardId,
				colorCode: moveResult.scores ? undefined : '#666',
				goldCollected: moveResult.goldCollected || 0,
				bonusesCollected: moveResult.bonusesCollected || [],
				cardsPlayed: countCardsPlayed(gameStateCurrent, info.playerId),
				objectivesRevealed: shouldRevealObjectives(gameStateCurrent)
			});

			broadcastGameState(io, info.gameId);
			_grantExtraTurnTime(info.gameId, info.playerId, 5000);

			// Timer loopt al vanuit begin van beurt — niet herstarten

		} catch (error) {
			console.error('[Locus] playMove error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── PLAY BONUS ───────────────────────────

	socket.on('playBonus', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });
			if (gameState.paused) return callback({ success: false, error: 'Spel staat op pauze.' });

			const bonusColor = String(data.bonusColor || '');
			const zoneName = String(data.zoneName || '');
			const baseX = Number(data.baseX);
			const baseY = Number(data.baseY);
			const rotation = Number(data.rotation || 0);

			const subgridId = data.subgridId ? String(data.subgridId) : null;

			if (!bonusColor || !zoneName) {
				return callback({ success: false, error: 'bonusColor en zoneName zijn verplicht.' });
			}
			if (!Number.isFinite(baseX) || !Number.isFinite(baseY)) {
				return callback({ success: false, error: 'baseX en baseY moeten getallen zijn.' });
			}

			const bonusResult = GameRules.playBonus(
				gameState, info.playerId, bonusColor, zoneName, baseX, baseY, subgridId, rotation
			);

			if (bonusResult.error) {
				return callback({ success: false, error: bonusResult.error });
			}

			console.log(`[Locus] Speler ${info.playerId} speelde ${bonusColor} bonus op ${zoneName} (${baseX},${baseY})`);

			callback({
				success: true,
				gameEnded: false,
				bonusesCollected: bonusResult.bonusesCollected || [],
				goldCollected: bonusResult.goldCollected || 0
			});

			// Broadcast animatie-info als bonus placement iets oplevert
			if ((bonusResult.bonusesCollected?.length > 0) || (bonusResult.goldCollected > 0)) {
				io.to(info.gameId).emit('movePlayed', {
					playerId: info.playerId,
					zoneName,
					goldCollected: bonusResult.goldCollected || 0,
					bonusesCollected: bonusResult.bonusesCollected || []
				});
			}

			broadcastGameState(io, info.gameId);
			_grantExtraTurnTime(info.gameId, info.playerId, 5000);

		} catch (error) {
			console.error('[Locus] playBonus error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── PASS MOVE ────────────────────────────

	socket.on('passMove', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });
			if (gameState.paused) return callback({ success: false, error: 'Spel staat op pauze.' });

			_clearTurnTimer(info.gameId);

			const cardId = data?.cardId ? String(data.cardId) : null;
			const passResult = GameRules.passMove(gameState, info.playerId, cardId);
			if (passResult.error) {
				return callback({ success: false, error: passResult.error });
			}

			console.log(`[Locus] Speler ${info.playerId} paste (discard: ${cardId || 'first'})`);

			callback({
				success: true,
				gameEnded: passResult.gameEnded || false,
				finalScores: passResult.finalScores || null,
				levelScores: passResult.levelScores || null,
				winner: passResult.winner || null
			});

			if (passResult.gameEnded) {
				broadcastGameState(io, info.gameId);
				io.to(info.gameId).emit('levelComplete', {
					levelScores: gameState.levelScores,
					levelWinner: gameState.levelWinner,
					level: gameState.level
				});
			} else {
				// Start fresh timer voor de volgende speler
				_startTimerForCurrentPlayer(info.gameId, true);
				broadcastGameState(io, info.gameId);
			}

		} catch (error) {
			console.error('[Locus] passMove error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── START SHOP PHASE ─────────────────────

	// ── END TURN ────────────────────────────

	socket.on('endTurn', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });
			if (gameState.paused) return callback({ success: false, error: 'Spel staat op pauze.' });

			_clearTurnTimer(info.gameId);

			const cardId = data?.cardId ? String(data.cardId) : null;
			const endResult = GameRules.endTurn(gameState, info.playerId, cardId);
			if (endResult.error) {
				return callback({ success: false, error: endResult.error });
			}

			console.log(`[Locus] Speler ${info.playerId} beëindigde beurt (discard: ${cardId || 'auto'}, gameEnded: ${endResult.gameEnded}, phase: ${gameState.phase})`);

			callback({
				success: true,
				gameEnded: endResult.gameEnded || false,
				levelScores: endResult.levelScores || null,
				winner: endResult.winner || null
			});

			if (endResult.gameEnded) {
				broadcastGameState(io, info.gameId);
				io.to(info.gameId).emit('levelComplete', {
					levelScores: gameState.levelScores,
					levelWinner: gameState.levelWinner,
					level: gameState.level
				});
			} else {
				// Start fresh timer voor de volgende speler
				_startTimerForCurrentPlayer(info.gameId, true);
				broadcastGameState(io, info.gameId);
			}

		} catch (error) {
			console.error('[Locus] endTurn error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── UNDO MOVE ───────────────────────────

	socket.on('undoMove', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });
			if (gameState.paused) return callback({ success: false, error: 'Spel staat op pauze.' });

			_clearTurnTimer(info.gameId);

			const undoResult = GameRules.undoMove(gameState, info.playerId);
			if (undoResult.error) {
				return callback({ success: false, error: undoResult.error });
			}

			console.log(`[Locus] Speler ${info.playerId} maakte zet ongedaan`);

			callback({ success: true });

			broadcastGameState(io, info.gameId);

			// Herstart timer na undo (speler is nog steeds aan de beurt)
			_startTimerForCurrentPlayer(info.gameId);

		} catch (error) {
			console.error('[Locus] undoMove error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── START SHOP PHASE ─────────────────────

	socket.on('startShopPhase', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });

			const result = GameRules.startShopPhase(gameState);
			if (result.error) return callback({ success: false, error: result.error });

			console.log(`[Locus] Shop fase gestart voor game ${info.gameId}`);
			callback({ success: true });
			broadcastGameState(io, info.gameId);

		} catch (error) {
			console.error('[Locus] startShopPhase error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── BUY SHOP ITEM ────────────────────────

	socket.on('buyShopItem', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });

			const itemId = String(data.itemId || '');
			const extra = data.extra || {};
			const result = GameRules.buyShopItem(gameState, info.playerId, itemId, extra);
			if (result.error) return callback({ success: false, error: result.error });

			console.log(`[Locus] Speler ${info.playerId} kocht ${itemId}`);
			callback(result);
			broadcastGameState(io, info.gameId);

		} catch (error) {
			console.error('[Locus] buyShopItem error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── CLAIM FREE CARD (from unlock popup) ──

	socket.on('claimFreeCard', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });

			const cardId = String(data.cardId || '');
			const result = GameRules.claimFreeCard(gameState, info.playerId, cardId);
			if (result.error) return callback({ success: false, error: result.error });

			console.log(`[Locus] Speler ${info.playerId} koos gratis kaart ${cardId}`);
			callback(result);
			broadcastGameState(io, info.gameId);

		} catch (error) {
			console.error('[Locus] claimFreeCard error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── SHOP READY ───────────────────────────

	socket.on('shopReady', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });

			const result = GameRules.shopReady(gameState, info.playerId);
			if (result.error) return callback({ success: false, error: result.error });

			console.log(`[Locus] Speler ${info.playerId} is klaar met winkelen`);

			callback({ success: true, allReady: result.allReady });

			if (result.allReady) {
				// Start volgend level
				const levelResult = GameRules.startNextLevel(gameState);
				console.log(`[Locus] Level ${gameState.level} gestart voor game ${info.gameId}`);
				io.to(info.gameId).emit('nextLevelStarted', { level: gameState.level });
			}

			// Start timer als het spel meteen naar playing gaat (niet bij choosingGoals)
			if (result.allReady && gameState.phase === 'playing') {
				_startTimerForCurrentPlayer(info.gameId, true);
			}
			broadcastGameState(io, info.gameId);

		} catch (error) {
			console.error('[Locus] shopReady error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── USE TIME BOMB ────────────────────────

	socket.on('useTimeBomb', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });
			if (gameState.paused) return callback({ success: false, error: 'Spel staat op pauze.' });

			_clearTurnTimer(info.gameId);

			const result = GameRules.useTimeBomb(gameState, info.playerId);
			if (result.error) {
				return callback({ success: false, error: result.error });
			}

			console.log(`[Locus] Speler ${info.playerId} (${result.bomberPlayerName}) gebruikte een tijdbom op ${result.bombedPlayerId} (${result.bombedPlayerName})`);

			callback({
				success: true,
				bombedPlayerId: result.bombedPlayerId,
				bombedPlayerName: result.bombedPlayerName,
				gameEnded: result.gameEnded || false
			});

			// Broadcast time bomb event aan alle spelers voor animatie/geluid
			io.to(info.gameId).emit('timeBombUsed', {
				bomberPlayerId: result.bomberPlayerId,
				bomberPlayerName: result.bomberPlayerName,
				bombedPlayerId: result.bombedPlayerId,
				bombedPlayerName: result.bombedPlayerName
			});

			if (result.gameEnded) {
				broadcastGameState(io, info.gameId);
				io.to(info.gameId).emit('levelComplete', {
					levelScores: gameState.levelScores,
					levelWinner: gameState.levelWinner,
					level: gameState.level
				});
			} else {
				// Start fresh timer voor de volgende speler
				_startTimerForCurrentPlayer(info.gameId, true);
				broadcastGameState(io, info.gameId);
			}

		} catch (error) {
			console.error('[Locus] useTimeBomb error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── TOGGLE PAUSE ─────────────────────────

	socket.on('togglePause', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });

			const result = _togglePause(info.gameId, info.playerId);
			if (result.error) return callback({ success: false, error: result.error });

			const actorName = gameState.players?.[info.playerId]?.name || 'Speler';
			console.log(`[Locus] ${actorName} ${result.paused ? 'pauzeerde' : 'hervatte'} game ${info.gameId}`);

			callback({ success: true, paused: !!result.paused, remainingMs: result.remainingMs || TURN_TIMER_MS });
			io.to(info.gameId).emit('pauseChanged', {
				paused: !!result.paused,
				playerId: info.playerId,
				playerName: actorName,
				remainingMs: result.remainingMs || TURN_TIMER_MS
			});
			broadcastGameState(io, info.gameId);
		} catch (error) {
			console.error('[Locus] togglePause error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── LIVE PLAYER INTERACTION (SELECT/DRAG) ──

	socket.on('playerInteraction', (data = {}) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return;

			const gameState = games.get(info.gameId);
			if (!gameState) return;

			const type = String(data.type || '');
			if (!['start', 'move', 'end'].includes(type)) return;

			const player = gameState.players[info.playerId];
			socket.to(info.gameId).emit('opponentInteraction', {
				playerId: info.playerId,
				playerName: player?.name || 'Speler',
				type,
				mode: data.mode || null,
				cardId: data.cardId ? String(data.cardId) : null,
				cardName: data.cardName || null,
				colorCode: data.colorCode || null,
				zoneName: data.zoneName || null,
				baseX: Number.isFinite(Number(data.baseX)) ? Number(data.baseX) : null,
				baseY: Number.isFinite(Number(data.baseY)) ? Number(data.baseY) : null,
				subgridId: data.subgridId ? String(data.subgridId) : null,
				matrix: Array.isArray(data.matrix) ? data.matrix : null,
				timestamp: Date.now()
			});
		} catch (error) {
			console.error('[Locus] playerInteraction error:', error);
		}
	});

	// ── TAUNTS ────────────────────────────────

	socket.on('sendTaunt', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });
			if (gameState.phase !== 'playing') return callback({ success: false, error: 'Taunts kunnen alleen tijdens spelen.' });

			const text = String(data?.text || '').trim();
			if (!ALLOWED_TAUNTS.has(text)) {
				return callback({ success: false, error: 'Ongeldige taunt.' });
			}

			const now = Date.now();
			const last = tauntCooldowns.get(info.playerId) || 0;
			if ((now - last) < TAUNT_COOLDOWN_MS) {
				return callback({ success: false, error: 'Wacht even voor je volgende taunt.' });
			}

			tauntCooldowns.set(info.playerId, now);
			const playerName = gameState.players?.[info.playerId]?.name || 'Speler';

			io.to(info.gameId).emit('taunt', {
				playerId: info.playerId,
				playerName,
				text,
				timestamp: now
			});

			callback({ success: true });
		} catch (error) {
			console.error('[Locus] sendTaunt error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── DISCONNECT ───────────────────────────────

	socket.on('disconnect', (reason) => {
		const info = socketToPlayer.get(socket.id);
		if (info) {
			console.log(`[Locus] Speler ${info.playerId} disconnected (${reason})`);

			const gameState = games.get(info.gameId);
			if (gameState && gameState.players[info.playerId]) {
				gameState.players[info.playerId].connected = false;

				const currentPid = gameState.playerOrder?.[gameState.currentTurnIndex];
				if (gameState.phase === 'playing' && currentPid === info.playerId) {
					_clearTurnTimer(info.gameId);
					const autoResult = GameRules.passMove(gameState, info.playerId, null);
					if (!autoResult?.error && !autoResult?.gameEnded) {
						_startTimerForCurrentPlayer(info.gameId, true);
					}
					if (autoResult?.gameEnded) {
						io.to(info.gameId).emit('levelComplete', {
							levelScores: gameState.levelScores,
							levelWinner: gameState.levelWinner,
							level: gameState.level
						});
					}
				}

				// Broadcast disconnect
				socket.to(info.gameId).emit('playerDisconnected', {
					playerId: info.playerId,
					name: gameState.players[info.playerId].name
				});

				broadcastGameState(io, info.gameId);

				// Als alle spelers weg zijn, verwijder game na 5 minuten
				const allDisconnected = Object.values(gameState.players)
					.every(p => p.connected === false);
				if (allDisconnected) {
					setTimeout(() => {
						const current = games.get(info.gameId);
						if (current) {
							const stillAllGone = Object.values(current.players)
								.every(p => p.connected === false);
							if (stillAllGone) {
								games.delete(info.gameId);
								if (current.inviteCode) inviteCodes.delete(current.inviteCode);
								console.log(`[Locus] Game ${info.gameId} verwijderd (alle spelers weg)`);
							}
						}
					}, 5 * 60 * 1000);
				}
			}

			socketToPlayer.delete(socket.id);
		} else {
			console.log(`[Locus] Onbekende client disconnected: ${socket.id}`);
		}
	});

	// ── RECONNECT ────────────────────────────

	socket.on('reconnect', (data, callback) => {
		try {
			const gameId = String(data.gameId || '');
			const playerId = String(data.playerId || '');

			if (!gameId || !playerId) {
				return callback({ success: false, error: 'gameId en playerId zijn verplicht.' });
			}

			const gameState = games.get(gameId);
			if (!gameState) {
				return callback({ success: false, error: 'Spel niet meer actief.' });
			}

			if (!gameState.players[playerId]) {
				return callback({ success: false, error: 'Speler niet gevonden in dit spel.' });
			}

			// Herverbind
			gameState.players[playerId].connected = true;
			socketToPlayer.set(socket.id, { gameId, playerId });
			socket.join(gameId);

			console.log(`[Locus] Speler ${playerId} herverbonden met game ${gameId}`);

			callback({ success: true, inviteCode: gameState.inviteCode || '' });

			broadcastGameState(io, gameId);

			socket.to(gameId).emit('playerReconnected', {
				playerId,
				name: gameState.players[playerId].name
			});

		} catch (error) {
			console.error('[Locus] reconnect error:', error);
			callback({ success: false, error: error.message });
		}
	});
});

// ──────────────────────────────────────────────
//  START SERVER
// ──────────────────────────────────────────────

server.listen(PORT, () => {
	console.log('');
	console.log('  ╔═══════════════════════════════════════════╗');
	console.log('  ║   LOCUS MULTIPLAYER SERVER                ║');
	console.log('  ║                                           ║');
	console.log(`  ║   🌐  http://localhost:${PORT}              ║`);
	console.log('  ║                                           ║');
	console.log('  ║   Deel je lokale IP met medespelers       ║');
	console.log('  ║   op hetzelfde netwerk!                   ║');
	console.log('  ╚═══════════════════════════════════════════╝');
	console.log('');

	// Toon lokale IP adressen
	const os = require('os');
	const nets = os.networkInterfaces();
	for (const name of Object.keys(nets)) {
		for (const net of nets[name]) {
			if (net.family === 'IPv4' && !net.internal) {
				console.log(`  📡 Netwerk: http://${net.address}:${PORT}`);
			}
		}
	}
	console.log('');
});
