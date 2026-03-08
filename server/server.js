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
const AIPlayer = require('./ai-player');

// ──────────────────────────────────────────────
//  CONFIG
// ──────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

function applyCorsHeaders(req, res) {
	const requestOrigin = req.headers.origin;
	res.setHeader('Vary', 'Origin');
	res.setHeader('Access-Control-Allow-Origin', requestOrigin || '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
	res.setHeader('Access-Control-Max-Age', '86400');
}

// ──────────────────────────────────────────────
//  IN-MEMORY STORAGE
// ──────────────────────────────────────────────

/** @type {Map<string, object>} gameId → gameState */
const games = new Map();

/** @type {Map<string, string>} inviteCode → gameId */
const inviteCodes = new Map();

/** @type {Map<string, object>} roomCode → p2p lobby metadata */
const p2pLobbies = new Map();

/** @type {Map<string, {gameId: string, playerId: string}>} socket.id → { gameId, playerId } */
const socketToPlayer = new Map();

/** @type {Map<string, NodeJS.Timeout>} gameId → turn timer */
const turnTimers = new Map();
/** @type {Map<string, number>} playerId → last taunt timestamp */
const tauntCooldowns = new Map();

/** @type {Map<string, Set<string>>} gameId → set of AI player IDs */
const aiPlayers = new Map();
/** @type {Map<string, Map<string, string>>} gameId → Map<aiPlayerId, difficulty> */
const aiDifficulty = new Map();

const TAUNT_COOLDOWN_MS = 2000;
const ALLOWED_TAUNTS = new Set([
	'Nooo!',
	'HAHA',
	'Well played!',
	'Oeps...',
	'Kom op!',
	'cheater',
	'fuck off',
	'your mum'
]);

const TURN_TIMER_MS = 40000; // 40 seconden per beurt
const P2P_LOBBY_TTL_MS = 45000;

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

function buildTransformedCardMatrix(gameState, playerId, cardId, zoneName, rotation = 0, mirrored = false) {
	const player = gameState?.players?.[playerId];
	if (!player) return null;
	const hand = Array.isArray(player.hand) ? player.hand : [];
	const card = hand.find((c) => c && c.id === cardId);
	if (!card || !Array.isArray(card.matrix)) return null;

	const perkFlags = {
		greenGapAllowed: !!player.perks?.greenGapAllowed,
		diagonalRotation: !!player.perks?.diagonalRotation
	};

	let matrix = GameRules.cloneMatrix(card.matrix);
	matrix = GameRules.getEnhancedMatrix(matrix, zoneName, perkFlags);
	matrix = GameRules.rotateMatrixN(matrix, Number(rotation) || 0);
	if (mirrored) matrix = GameRules.mirrorMatrix(matrix);
	return matrix;
}

function _cleanupP2PLobbies() {
	const now = Date.now();
	for (const [roomCode, lobby] of p2pLobbies) {
		if (!lobby || Number(lobby.expiresAt || 0) <= now) {
			p2pLobbies.delete(roomCode);
		}
	}
}

function _serializeOpenP2PLobbies() {
	_cleanupP2PLobbies();
	const now = Date.now();
	const result = [];
	for (const lobby of p2pLobbies.values()) {
		if (!lobby) continue;
		if ((lobby.phase || 'waiting') !== 'waiting') continue;
		const playerCount = Number(lobby.playerCount || 0);
		const maxPlayers = Number(lobby.maxPlayers || 4);
		if (playerCount < 1 || playerCount >= maxPlayers) continue;
		result.push({
			mode: 'p2p',
			roomCode: lobby.roomCode,
			inviteCode: lobby.roomCode,
			hostName: lobby.hostName || 'P2P Host',
			playerCount,
			maxPlayers,
			mapSize: Number(lobby.mapSize || 4),
			createdAt: Number(lobby.createdAt || now),
			expiresAt: Number(lobby.expiresAt || (now + P2P_LOBBY_TTL_MS))
		});
	}
	result.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
	return result;
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

			// Verberg tegenstanders' actieve mijnen
			if (sanitized.players[pid].perks) {
				sanitized.players[pid].perks.activeMines = [];
			}

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

	// Na elke broadcast: check of AI actie nodig is
	scheduleAIActions(gameId);

	// Check of een AI bot een time bomb wil gebruiken op de huidige menselijke speler
	_checkAITimeBomb(gameId);
}

/** AI bots use time bombs at the start of a human player's turn (40% chance) */
const _timeBombPending = new Set(); // gameId set to prevent double-firing
function _checkAITimeBomb(gameId) {
	const gameState = games.get(gameId);
	if (!gameState || gameState.phase !== 'playing' || gameState.paused) return;
	if (_timeBombPending.has(gameId)) return;

	const gameAIs = aiPlayers.get(gameId);
	if (!gameAIs || gameAIs.size === 0) return;

	const currentPid = gameState.playerOrder?.[gameState.currentTurnIndex];
	if (!currentPid || isAIPlayer(gameId, currentPid)) return; // Only bomb humans

	for (const aiId of gameAIs) {
		const aiPlayer = gameState.players?.[aiId];
		if (!aiPlayer || (aiPlayer.timeBombs || 0) <= 0) continue;
		// 40% chance to use time bomb (can save for later turns)
		if (Math.random() >= 0.4) continue;

		_timeBombPending.add(gameId);
		setTimeout(() => {
			_timeBombPending.delete(gameId);
			const gs = games.get(gameId);
			if (!gs || gs.phase !== 'playing' || gs.paused) return;
			const stillCurrentPid = gs.playerOrder?.[gs.currentTurnIndex];
			if (stillCurrentPid !== currentPid) return; // Turn already changed

			_clearTurnTimer(gameId);

			const bombResult = GameRules.useTimeBomb(gs, aiId);
			if (bombResult && !bombResult.error) {
				console.log(`[Locus AI] 💣 ${aiPlayer.name} used TIME BOMB on ${gs.players?.[currentPid]?.name}`);

				io.to(gameId).emit('timeBombUsed', {
					bomberPlayerId: bombResult.bomberPlayerId,
					bomberPlayerName: bombResult.bomberPlayerName,
					bombedPlayerId: bombResult.bombedPlayerId,
					bombedPlayerName: bombResult.bombedPlayerName
				});

				if (bombResult.gameEnded) {
					broadcastGameState(io, gameId);
					io.to(gameId).emit('levelComplete', {
						levelScores: gs.levelScores,
						levelWinner: gs.levelWinner,
						level: gs.level
					});
				} else {
					_startTimerForCurrentPlayer(gameId, true);
					broadcastGameState(io, gameId);
				}
			}
		}, 500);
		break; // Only one bomb per turn start
	}
}

// ──────────────────────────────────────────────
//  AI SPELER LOGICA
// ──────────────────────────────────────────────

/** @type {Map<string, NodeJS.Timeout>} gameId → pending AI timer */
const aiTimers = new Map();

function isAIPlayer(gameId, playerId) {
	return aiPlayers.get(gameId)?.has(playerId) || false;
}

function scheduleAIActions(gameId) {
	// Debounce: voorkom dubbele AI timers
	if (aiTimers.has(gameId)) return;

	const gameState = games.get(gameId);
	if (!gameState) return;

	const gameAIs = aiPlayers.get(gameId);
	if (!gameAIs || gameAIs.size === 0) return;

	// Use longer delay if any hard AI is active for the current action
	const diffMap = aiDifficulty.get(gameId);
	let hasHard = false;
	if (diffMap) {
		for (const aiId of gameAIs) {
			if (diffMap.get(aiId) === 'hard') { hasHard = true; break; }
		}
	}
	const delay = hasHard ? AIPlayer.getHardAIThinkDelay() : AIPlayer.getAIThinkDelay();

	const timer = setTimeout(() => {
		aiTimers.delete(gameId);
		executeAIActions(gameId);
	}, delay);
	aiTimers.set(gameId, timer);
}

function executeAIActions(gameId) {
	const gameState = games.get(gameId);
	if (!gameState) return;

	const gameAIs = aiPlayers.get(gameId);
	if (!gameAIs || gameAIs.size === 0) return;

	const phase = gameState.phase;

	// ── CHOOSING START DECK ──
	if (phase === 'choosingStartDeck') {
		let changed = false;
		for (const aiId of gameAIs) {
			const player = gameState.players[aiId];
			if (!player || player.startingDeckType) continue;
			const deckType = AIPlayer.chooseStartingDeck();
			const result = GameRules.chooseStartingDeck(gameState, aiId, deckType);
			if (result.success) {
				console.log(`[Locus AI] ${player.name} koos startdeck "${deckType}"`);
				changed = true;
			}
		}
		if (changed) broadcastGameState(io, gameId);
		return;
	}

	// ── CHOOSING GOALS ──
	if (phase === 'choosingGoals') {
		let changed = false;
		for (const aiId of gameAIs) {
			const player = gameState.players[aiId];
			if (!player || player.chosenObjective) continue;
			const choices = gameState.objectiveChoices?.[aiId] || [];
			if (choices.length === 0) continue;
			const idx = AIPlayer.chooseObjective(choices);
			const result = GameRules.chooseObjective(gameState, aiId, idx);
			if (!result.error) {
				console.log(`[Locus AI] ${player.name} koos objective ${idx}`);
				changed = true;
				if (result.allChosen) {
					_startTimerForCurrentPlayer(gameId, true);
				}
			}
		}
		if (changed) broadcastGameState(io, gameId);
		return;
	}

	// ── PLAYING ──
	if (phase === 'playing') {
		if (gameState.paused) return;
		const currentPid = gameState.playerOrder[gameState.currentTurnIndex];
		if (!currentPid || !gameAIs.has(currentPid)) return;

		executeAITurn(gameId, currentPid);
		return;
	}

	// ── LEVEL COMPLETE → start shop ──
	if (phase === 'levelComplete') {
		// Check als alle echte spelers ook level-complete gezien hebben
		// Start shop meteen als er AI in zit
		setTimeout(() => {
			const gs = games.get(gameId);
			if (!gs || gs.phase !== 'levelComplete') return;
			const result = GameRules.startShopPhase(gs);
			if (result.success) {
				console.log(`[Locus AI] Shop fase auto-gestart voor game ${gameId}`);
				broadcastGameState(io, gameId);
			}
		}, 2000);
		return;
	}

	// ── SHOPPING ──
	if (phase === 'shopping') {
		let changed = false;
		for (const aiId of gameAIs) {
			const player = gameState.players[aiId];
			if (!player || player.shopReady) continue;

			// Perk kiezen
			const aiDiff = aiDifficulty.get(gameId)?.get(aiId) || 'normal';
			const perkId = aiDiff === 'hard'
				? AIPlayer.chooseHardPerk(gameState, aiId)
				: AIPlayer.choosePerk(gameState, aiId);
			if (perkId) {
				const perkResult = GameRules.choosePerk(gameState, aiId, perkId);
				if (!perkResult.error) {
					console.log(`[Locus AI] ${player.name} koos perk "${perkResult.perk?.name}"`);
					changed = true;
				}
			}

			// Shop acties
			const shopActions = aiDiff === 'hard'
				? AIPlayer.planShopHard(gameState, aiId)
				: AIPlayer.planShop(gameState, aiId);
			for (const action of shopActions) {
				if (action.type === 'buyShopItem') {
					const buyResult = GameRules.buyShopItem(gameState, aiId, action.itemId, action.extra || {});
					if (buyResult.success) {
						console.log(`[Locus AI] ${player.name} kocht ${action.itemId}`);
						// Als er free choices zijn (unlock), kies de eerste
						if (buyResult.freeChoices?.length > 0) {
							GameRules.claimFreeCard(gameState, aiId, buyResult.freeChoices[0].id);
						}
						changed = true;
					}
				} else if (action.type === 'shopReady') {
					const readyResult = GameRules.shopReady(gameState, aiId);
					if (!readyResult.error) {
						console.log(`[Locus AI] ${player.name} is klaar met winkelen`);
						changed = true;
						if (readyResult.allReady) {
							const levelResult = GameRules.startNextLevel(gameState);
							console.log(`[Locus AI] Level ${gameState.level} gestart voor game ${gameId}`);
							io.to(gameId).emit('nextLevelStarted', { level: gameState.level });
							if (gameState.phase === 'playing') {
								_startTimerForCurrentPlayer(gameId, true);
							}
						}
					}
				}
			}
		}
		if (changed) broadcastGameState(io, gameId);
		return;
	}
}

function _maybeAITaunt(gameId, aiPlayerId) {
	const gs = games.get(gameId);
	if (!gs) return;
	const player = gs.players[aiPlayerId];
	if (!player) return;

	const taunt = AIPlayer.pickAITaunt(gs, aiPlayerId, null);
	if (taunt) {
		io.to(gameId).emit('taunt', {
			playerId: aiPlayerId,
			playerName: player.name,
			text: taunt.text,
			timestamp: Date.now()
		});
	}
}

function executeAITurn(gameId, aiPlayerId) {
	const gameState = games.get(gameId);
	if (!gameState || gameState.phase !== 'playing') return;
	if (gameState.paused) return;

	const currentPid = gameState.playerOrder[gameState.currentTurnIndex];
	if (currentPid !== aiPlayerId) return;

	const player = gameState.players[aiPlayerId];
	if (!player) return;

	_clearTurnTimer(gameId);

	const difficulty = aiDifficulty.get(gameId)?.get(aiPlayerId) || 'normal';
	const actions = difficulty === 'hard'
		? AIPlayer.planTurnHard(gameState, aiPlayerId)
		: AIPlayer.planTurn(gameState, aiPlayerId);
	let gameEnded = false;
	let actionIndex = 0;

	function processNextAction() {
		const gs = games.get(gameId);
		if (!gs || gs.phase !== 'playing' || gs.paused) return;
		if (gameEnded || actionIndex >= actions.length) {
			// All actions done — optionally taunt, then finalize
			_maybeAITaunt(gameId, aiPlayerId);
			if (!gameEnded) {
				_startTimerForCurrentPlayer(gameId, true);
				broadcastGameState(io, gameId);
			}
			return;
		}

		const action = actions[actionIndex++];

		if (action.type === 'choosePerk') {
			const perkResult = GameRules.choosePerk(gs, aiPlayerId, action.perkId);
			if (!perkResult.error) {
				console.log(`[Locus AI] ${player.name} koos perk "${perkResult.perk?.name}"`);
				broadcastGameState(io, gameId);
			}
			setTimeout(processNextAction, AIPlayer.AI_ACTION_DELAY_MS);
		} else if (action.type === 'playCard') {
			const transformedMatrix = buildTransformedCardMatrix(
				gs,
				aiPlayerId,
				action.cardId,
				action.zoneName,
				action.rotation || 0,
				!!action.mirrored
			);
			const moveResult = GameRules.playMove(
				gs, aiPlayerId, action.cardId, action.zoneName,
				action.baseX, action.baseY, action.rotation || 0, !!action.mirrored, action.subgridId
			);
			if (moveResult.error) {
				console.log(`[Locus AI] ${player.name} move mislukt: ${moveResult.error}`);
				setTimeout(processNextAction, AIPlayer.AI_ACTION_DELAY_MS);
				return;
			}
			console.log(`[Locus AI] ${player.name} speelde ${action.cardId} op ${action.zoneName} (${action.baseX},${action.baseY})`);

			io.to(gameId).emit('movePlayed', {
				playerId: aiPlayerId,
				playerName: player.name,
				zoneName: action.zoneName,
				baseX: action.baseX,
				baseY: action.baseY,
				rotation: action.rotation || 0,
				mirrored: !!action.mirrored,
				subgridId: action.subgridId || null,
				matrix: transformedMatrix,
				cardId: action.cardId,
				goldCollected: moveResult.goldCollected || 0,
				bonusesCollected: moveResult.bonusesCollected || [],
				pearlsCollected: moveResult.pearlsCollected || 0,
				cardsPlayed: countCardsPlayed(gs, aiPlayerId),
				objectivesRevealed: shouldRevealObjectives(gs),
				mineTriggered: moveResult.mineTriggered || null
			});
			setTimeout(processNextAction, AIPlayer.AI_ACTION_DELAY_MS);
		} else if (action.type === 'playBonus') {
			// Herbereken bonus plaatsingen na eerdere acties
			const bonusPlacements = AIPlayer.findValidBonusPlacements(gs, aiPlayerId, action.bonusColor);
			if (bonusPlacements.length === 0) { setTimeout(processNextAction, AIPlayer.AI_ACTION_DELAY_MS); return; }
			bonusPlacements.sort((a, b) => b.score - a.score);
			const best = bonusPlacements[0];

			// Build the bonus matrix for preview
			let bonusMatrix = GameRules.getBonusShapeForPlayer(action.bonusColor, player);
			if (bonusMatrix && best.rotation) bonusMatrix = GameRules.rotateMatrixN(GameRules.cloneMatrix(bonusMatrix), best.rotation);

			// Emit preview so clients can show the hover before actual placement
			io.to(gameId).emit('bonusPreview', {
				playerId: aiPlayerId,
				playerName: player.name,
				bonusColor: action.bonusColor,
				zoneName: best.zoneName,
				baseX: best.baseX,
				baseY: best.baseY,
				subgridId: best.subgridId || null,
				matrix: bonusMatrix
			});

			// Delay before actually placing the bonus (gives time to see the preview)
			setTimeout(() => {
				const gs2 = games.get(gameId);
				if (!gs2 || gs2.phase !== 'playing' || gs2.paused) return;
				const bonusResult = GameRules.playBonus(
					gs2, aiPlayerId, action.bonusColor, best.zoneName, best.baseX, best.baseY, best.subgridId, best.rotation || 0
				);
				if (bonusResult.error) {
					console.log(`[Locus AI] ${player.name} bonus mislukt: ${bonusResult.error}`);
				} else {
					console.log(`[Locus AI] ${player.name} speelde ${action.bonusColor} bonus op ${best.zoneName}`);
				}
				broadcastGameState(io, gameId);
				setTimeout(processNextAction, AIPlayer.AI_ACTION_DELAY_MS);
			}, 1200);
		} else if (action.type === 'useMine') {
			const mineResult = GameRules.useMine(gs, aiPlayerId, action.zoneName, action.cellX, action.cellY);
			if (mineResult.error) {
				console.log(`[Locus AI] ${player.name} mijn mislukt: ${mineResult.error}`);
			} else {
				console.log(`[Locus AI] ${player.name} plaatste een mijn op ${action.zoneName} (${action.cellX},${action.cellY})`);
				broadcastGameState(io, gameId);
			}
			setTimeout(processNextAction, AIPlayer.AI_ACTION_DELAY_MS);
		} else if (action.type === 'stealCard') {
			const stealResult = GameRules.stealCard(gs, aiPlayerId, action.targetPlayerId, action.cardId);
			if (stealResult.error) {
				console.log(`[Locus AI] ${player.name} steal mislukt: ${stealResult.error}`);
			} else {
				console.log(`[Locus AI] ${player.name} stal een kaart van ${stealResult.targetPlayerName}`);
				// Emit cardStolen event to notify the target player
				io.to(gameId).emit('cardStolen', {
					thiefId: aiPlayerId,
					thiefName: player.name,
					targetId: action.targetPlayerId,
					targetName: stealResult.targetPlayerName,
					cardName: stealResult.stolenCard?.shapeName || '???'
				});
				broadcastGameState(io, gameId);
			}
			setTimeout(processNextAction, AIPlayer.AI_ACTION_DELAY_MS);
		} else if (action.type === 'endTurn') {
			const endResult = GameRules.endTurn(gs, aiPlayerId, action.discardCardId || null);
			if (endResult.error) {
				console.log(`[Locus AI] ${player.name} endTurn mislukt: ${endResult.error}`);
				return;
			}
			console.log(`[Locus AI] ${player.name} beëindigde beurt (gameEnded: ${endResult.gameEnded})`);

			if (endResult.gameEnded) {
				gameEnded = true;
				broadcastGameState(io, gameId);
				io.to(gameId).emit('levelComplete', {
					levelScores: gs.levelScores,
					levelWinner: gs.levelWinner,
					level: gs.level
				});
				return;
			}
			setTimeout(processNextAction, AIPlayer.AI_ACTION_DELAY_MS);
		} else {
			setTimeout(processNextAction, AIPlayer.AI_ACTION_DELAY_MS);
		}
	}

	// Start processing the first action
	processNextAction();
}

// ──────────────────────────────────────────────
//  EXPRESS + STATIC FILES
// ──────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
app.use((req, res, next) => {
	applyCorsHeaders(req, res);
	if (req.method === 'OPTIONS') {
		return res.status(204).end();
	}
	next();
});
app.use(express.json({ limit: '64kb' }));

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

// ── SERVER BROWSER API ───────────────────────
app.get('/api/games', (req, res) => {
	const activeGames = [];
	for (const [gameId, gs] of games) {
		// Alleen wachtende games tonen (die nog niet gestart zijn)
		if (gs.phase !== 'waiting') continue;
		const playerCount = Object.keys(gs.players).length;
		const maxPlayers = gs.settings?.maxPlayers || 4;
		// Toon alleen games met tenminste 1 speler en minder dan max
		if (playerCount < 1 || playerCount >= maxPlayers) continue;

		// Zoek de invite code
		let inviteCode = null;
		for (const [code, gid] of inviteCodes) {
			if (gid === gameId) { inviteCode = code; break; }
		}

		activeGames.push({
			gameId,
			inviteCode,
			hostName: gs.players[gs.hostPlayerId]?.name || '???',
			playerCount,
			maxPlayers,
			mapSize: gs.settings?.mapSize || 4,
			createdAt: gs.createdAt
		});
	}
	// Sorteer op meest recent eerst
	activeGames.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
	res.json({ games: activeGames });
});

app.get('/api/p2p-lobbies', (req, res) => {
	res.json({ lobbies: _serializeOpenP2PLobbies() });
});

app.post('/api/p2p-lobbies', (req, res) => {
	try {
		const body = req.body || {};
		const roomCode = String(body.roomCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
		if (!roomCode || roomCode.length !== 6) {
			return res.status(400).json({ success: false, error: 'Geldige roomCode vereist.' });
		}

		const now = Date.now();
		const maxPlayers = Math.min(8, Math.max(2, Number(body.maxPlayers) || 4));
		const playerCount = Math.min(maxPlayers, Math.max(1, Number(body.playerCount) || 1));
		p2pLobbies.set(roomCode, {
			roomCode,
			hostName: String(body.hostName || 'P2P Host').slice(0, 32),
			playerCount,
			maxPlayers,
			mapSize: Math.min(8, Math.max(2, Number(body.mapSize) || 4)),
			phase: String(body.phase || 'waiting'),
			createdAt: Number(body.createdAt) || now,
			expiresAt: now + P2P_LOBBY_TTL_MS
		});

		return res.json({ success: true });
	} catch (error) {
		return res.status(500).json({ success: false, error: error.message || 'Kon P2P lobby niet registreren.' });
	}
});

app.delete('/api/p2p-lobbies/:roomCode', (req, res) => {
	const roomCode = String(req.params.roomCode || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
	if (!roomCode) {
		return res.status(400).json({ success: false, error: 'roomCode vereist.' });
	}
	const removed = p2pLobbies.delete(roomCode);
	return res.json({ success: true, removed });
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
			const mapSize = Math.min(8, Math.max(2, Number(data.mapSize) || 4));

			const gameId = generateId();
			const playerId = generatePlayerId();
			const inviteCode = generateInviteCode();
			const seed = Date.now() + Math.floor(Math.random() * 100000);

			const gameState = GameRules.createGameState(gameId, playerId, {
				seed,
				maxPlayers,
				mapSize,
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

	// ── ADD AI PLAYER ────────────────────────

	socket.on('addAIPlayer', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });

			if (gameState.hostPlayerId !== info.playerId) {
				return callback({ success: false, error: 'Alleen de host kan AI spelers toevoegen.' });
			}

			if (gameState.phase !== 'waiting') {
				return callback({ success: false, error: 'Kan alleen AI toevoegen in de wachtkamer.' });
			}

			// Bepaal AI naam en difficulty
			const difficulty = (data?.difficulty === 'hard') ? 'hard' : 'normal';
			const existingAIs = aiPlayers.get(info.gameId) || new Set();
			const aiIndex = existingAIs.size;
			if (aiIndex >= AIPlayer.AI_NAMES.length) {
				return callback({ success: false, error: 'Maximum aantal AI spelers bereikt.' });
			}
			const baseName = AIPlayer.AI_NAMES[aiIndex];
			const aiName = difficulty === 'hard' ? `${baseName} 🧠` : baseName;
			const aiPlayerId = 'AI_' + generateId();

			const addResult = GameRules.addPlayer(gameState, aiPlayerId, aiName);
			if (addResult.error) {
				return callback({ success: false, error: addResult.error });
			}

			// Markeer als AI
			gameState.players[aiPlayerId].isAI = true;
			gameState.players[aiPlayerId].connected = true;

			// Track AI speler
			if (!aiPlayers.has(info.gameId)) aiPlayers.set(info.gameId, new Set());
			aiPlayers.get(info.gameId).add(aiPlayerId);

			// Track difficulty
			if (!aiDifficulty.has(info.gameId)) aiDifficulty.set(info.gameId, new Map());
			aiDifficulty.get(info.gameId).set(aiPlayerId, difficulty);

			console.log(`[Locus] AI speler "${aiName}" (${aiPlayerId}, ${difficulty}) toegevoegd aan game ${info.gameId}`);

			callback({
				success: true,
				playerId: aiPlayerId,
				name: aiName
			});

			// Broadcast de update
			io.to(info.gameId).emit('playerJoined', {
				playerId: aiPlayerId,
				name: aiName,
				isAI: true
			});

			broadcastGameState(io, info.gameId);

		} catch (error) {
			console.error('[Locus] addAIPlayer error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── REMOVE AI PLAYER ─────────────────────

	socket.on('removeAIPlayer', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });

			if (gameState.hostPlayerId !== info.playerId) {
				return callback({ success: false, error: 'Alleen de host kan AI spelers verwijderen.' });
			}

			const aiPlayerId = String(data?.playerId || '');
			const existingAIs = aiPlayers.get(info.gameId);
			if (!existingAIs || !existingAIs.has(aiPlayerId)) {
				return callback({ success: false, error: 'Geen AI speler met dit ID.' });
			}

			const result = GameRules.removePlayer(gameState, aiPlayerId);
			if (result.error) return callback({ success: false, error: result.error });

			existingAIs.delete(aiPlayerId);
			const diffMap = aiDifficulty.get(info.gameId);
			if (diffMap) diffMap.delete(aiPlayerId);

			console.log(`[Locus] AI speler ${aiPlayerId} verwijderd uit game ${info.gameId}`);
			callback({ success: true });

			io.to(info.gameId).emit('playerLeft', { playerId: aiPlayerId });
			broadcastGameState(io, info.gameId);
		} catch (error) {
			console.error('[Locus] removeAIPlayer error:', error);
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

			const transformedMatrix = buildTransformedCardMatrix(gameState, info.playerId, cardId, zoneName, rotation, mirrored);

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
				pearlsCollected: moveResult.pearlsCollected || 0,
				mineTriggered: moveResult.mineTriggered || null,
				gameEnded: false
			});

			// Broadcast gedetailleerde move info aan alle spelers voor animaties
			io.to(info.gameId).emit('movePlayed', {
				playerId: info.playerId,
				playerName: playerData?.name || '???',
				zoneName,
				baseX, baseY,
				rotation: rotation,
				mirrored,
				subgridId,
				matrix: transformedMatrix,
				cardId,
				colorCode: moveResult.scores ? undefined : '#666',
				goldCollected: moveResult.goldCollected || 0,
				bonusesCollected: moveResult.bonusesCollected || [],
				pearlsCollected: moveResult.pearlsCollected || 0,
				cardsPlayed: countCardsPlayed(gameStateCurrent, info.playerId),
				objectivesRevealed: shouldRevealObjectives(gameStateCurrent),
				mineTriggered: moveResult.mineTriggered || null
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

			console.log(`[Locus] Speler ${info.playerId} maakte zet ongedaan (type: ${undoResult.undoneType})`);

			callback({ success: true, undoneType: undoResult.undoneType });

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

	// ── SELL CARD ────────────────────────

	socket.on('sellCard', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });

			const cardId = String(data.cardId || '');
			const result = GameRules.sellCard(gameState, info.playerId, cardId);
			if (result.error) return callback({ success: false, error: result.error });

			console.log(`[Locus] Speler ${info.playerId} verkocht kaart ${cardId} voor ${result.sellPrice} coins`);
			callback(result);
			broadcastGameState(io, info.gameId);

		} catch (error) {
			console.error('[Locus] sellCard error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── CHOOSE PERK ────────────────────────

	socket.on('choosePerk', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });

			const perkId = String(data.perkId || '');
			if (!perkId) return callback({ success: false, error: 'perkId is verplicht.' });

			const result = GameRules.choosePerk(gameState, info.playerId, perkId);
			if (result.error) return callback({ success: false, error: result.error });

			const playerData = gameState.players[info.playerId];
			console.log(`[Locus] Speler ${info.playerId} ontgrendelde perk: ${result.perk?.name}`);

			callback({ success: true, perk: result.perk });

			// Broadcast perk unlock aan alle spelers
			io.to(info.gameId).emit('perkUnlocked', {
				playerId: info.playerId,
				playerName: playerData?.name || '???',
				perk: result.perk
			});

			broadcastGameState(io, info.gameId);

		} catch (error) {
			console.error('[Locus] choosePerk error:', error);
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

	// ── USE MINE ─────────────────────────────

	socket.on('useMine', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });

			const { zoneName, cellX, cellY } = data || {};
			const result = GameRules.useMine(gameState, info.playerId, zoneName, cellX, cellY);
			if (result.error) {
				return callback({ success: false, error: result.error });
			}

			console.log(`[Locus] Speler ${info.playerId} plaatste een mijn op ${zoneName} (${cellX},${cellY})`);
			callback({ success: true, mine: result.mine });
			broadcastGameState(io, info.gameId);

		} catch (error) {
			console.error('[Locus] useMine error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── STEAL CARD ───────────────────────────

	socket.on('stealCard', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });

			const { targetPlayerId, cardId } = data || {};
			const result = GameRules.stealCard(gameState, info.playerId, targetPlayerId, cardId);
			if (result.error) {
				return callback({ success: false, error: result.error });
			}

			console.log(`[Locus] Speler ${info.playerId} stal een kaart van ${result.targetPlayerName}`);
			callback({ success: true, stolenCard: result.stolenCard, targetPlayerName: result.targetPlayerName });
			// Notify all players about the steal
			io.to(info.gameId).emit('cardStolen', {
				thiefId: info.playerId,
				thiefName: gameState.players[info.playerId]?.name || '???',
				targetId: targetPlayerId,
				targetName: result.targetPlayerName,
				cardName: result.stolenCard?.shapeName || '???'
			});
			broadcastGameState(io, info.gameId);

		} catch (error) {
			console.error('[Locus] stealCard error:', error);
			callback({ success: false, error: error.message });
		}
	});

	// ── GET STEALABLE CARDS ──────────────────

	socket.on('getStealableCards', (data, callback) => {
		try {
			const info = socketToPlayer.get(socket.id);
			if (!info) return callback({ success: false, error: 'Niet in een spel.' });

			const gameState = games.get(info.gameId);
			if (!gameState) return callback({ success: false, error: 'Spel niet gevonden.' });

			const { targetPlayerId } = data || {};
			const result = GameRules.getStealableCards(gameState, info.playerId, targetPlayerId);
			callback(result);
		} catch (error) {
			console.error('[Locus] getStealableCards error:', error);
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

				// Als alle menselijke spelers weg zijn, verwijder game na 5 minuten
				const allHumansDisconnected = Object.values(gameState.players)
					.filter(p => !p.isAI)
					.every(p => p.connected === false);
				if (allHumansDisconnected) {
					setTimeout(() => {
						const current = games.get(info.gameId);
						if (current) {
							const stillAllGone = Object.values(current.players)
								.filter(p => !p.isAI)
								.every(p => p.connected === false);
							if (stillAllGone) {
								games.delete(info.gameId);
								aiPlayers.delete(info.gameId);
								aiDifficulty.delete(info.gameId);
								const pendingAiTimer = aiTimers.get(info.gameId);
								if (pendingAiTimer) { clearTimeout(pendingAiTimer); aiTimers.delete(info.gameId); }
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
