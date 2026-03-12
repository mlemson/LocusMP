/**
 * ============================================================
 * LOCUS MULTIPLAYER — AI Player Logic
 * ============================================================
 * Server-side AI dat automatisch beslissingen neemt voor
 * virtuele spelers. Kan kaarten spelen, bonussen gebruiken,
 * doelen kiezen, perks selecteren en in de shop kopen.
 * ============================================================
 */

const GameRules = require('../shared/game-rules');

const AI_NAMES = ['Bot Alpha', 'Bot Beta', 'Bot Gamma', 'Bot Delta', 'Bot Epsilon', 'Bot Zeta'];
const AI_THINK_DELAY_MIN_MS = 2000;
const AI_THINK_DELAY_MAX_MS = 4000;
const AI_ACTION_DELAY_MS = 800; // Delay between individual actions within a turn (normal)
const HARD_ACTION_DELAY_MS = 260; // Snappier hard AI so turns don't feel stuck

// ── AI PERSONALITY SYSTEM ──
// 25% chance a bot gets 'aggressive' personality at creation
const AI_PERSONALITIES = ['normal', 'normal', 'normal', 'aggressive']; // 25% aggressive
function pickAIPersonality() {
	return AI_PERSONALITIES[Math.floor(Math.random() * AI_PERSONALITIES.length)];
}

function getAIThinkDelay() {
	return AI_THINK_DELAY_MIN_MS + Math.floor(Math.random() * (AI_THINK_DELAY_MAX_MS - AI_THINK_DELAY_MIN_MS));
}

// ── AI TAUNT SYSTEM ──
const AI_TAUNTS = [
	'Nooo!', 'HAHA', 'Well played!', 'Oeps...', 'Kom op!',
	'cheater', 'fuck off', 'your mum'
];
const AI_REACTIVE_TAUNTS = {
	bigScore: ['HAHA', 'Nooo!', 'cheater', 'your mum'],
	objectiveAchieved: ['Well played!', 'Nooo!', 'cheater'],
	random: ['Oeps...', 'Kom op!', 'HAHA', 'fuck off', 'your mum']
};

const AI_AGGRESSIVE_TAUNTS = ['fuck off', 'your mum', 'cheater', 'HAHA', 'Nooo!'];

/**
 * Decide if the AI should taunt and pick a message.
 * Returns { text } or null. Aggressive bots taunt more frequently.
 */
function pickAITaunt(gameState, aiPlayerId, context, personality) {
	const isAggressive = personality === 'aggressive';
	const aggroPool = AI_AGGRESSIVE_TAUNTS;

	// context: { type: 'bigScore', playerId, points } or { type: 'objectiveAchieved', playerId }
	if (!context) {
		// Aggressive bots taunt ~25%, normal ~8%
		const chance = isAggressive ? 0.25 : 0.08;
		if (Math.random() > chance) return null;
		const pool = isAggressive ? aggroPool : AI_REACTIVE_TAUNTS.random;
		return { text: pool[Math.floor(Math.random() * pool.length)] };
	}

	if (context.type === 'bigScore' && context.points >= 25) {
		const chance = isAggressive ? 0.70 : 0.40;
		if (Math.random() > chance) return null;
		const pool = isAggressive ? aggroPool : AI_REACTIVE_TAUNTS.bigScore;
		return { text: pool[Math.floor(Math.random() * pool.length)] };
	}

	if (context.type === 'objectiveAchieved') {
		const chance = isAggressive ? 0.60 : 0.30;
		if (Math.random() > chance) return null;
		const pool = isAggressive ? aggroPool : AI_REACTIVE_TAUNTS.objectiveAchieved;
		return { text: pool[Math.floor(Math.random() * pool.length)] };
	}

	return null;
}

/**
 * Pick reply taunts from AI bots when a human sends a taunt.
 * Each bot has an independent 60% chance to reply (aggressive: 85%).
 * Returns array of { aiPlayerId, text, delay }.
 */
function pickAIReplyToTaunt(gameState, humanPlayerId, personalityMap) {
	// Find AI players in the game
	const aiPlayerIds = (gameState.playerOrder || []).filter(pid =>
		pid !== humanPlayerId && gameState.players[pid]?.isAI
	);
	if (aiPlayerIds.length === 0) return [];

	const replies = [];
	for (const aiId of aiPlayerIds) {
		const pers = personalityMap?.get?.(aiId) || 'normal';
		const chance = pers === 'aggressive' ? 0.85 : 0.60;
		if (Math.random() > chance) continue;
		const pool = pers === 'aggressive' ? AI_AGGRESSIVE_TAUNTS : AI_REACTIVE_TAUNTS.random;
		const text = pool[Math.floor(Math.random() * pool.length)];
		const delay = 1000 + Math.floor(Math.random() * 2000);
		replies.push({ aiPlayerId: aiId, text, delay });
	}

	// Limit to max 2 replies to avoid spam
	return replies.slice(0, 2);
}

/**
 * Geeft alle geldige plaatsingen terug voor een kaart in een zone.
 * Returns array van { zoneName, baseX, baseY, rotation, mirrored, subgridId, score }
 */
function findValidPlacements(gameState, playerId, card) {
	const player = gameState.players[playerId];
	if (!player) return [];

	const allowedZones = GameRules.getAllowedZones(card);
	const perkFlags = {
		greenGapAllowed: !!player.perks?.greenGapAllowed,
		redGapAllowed: !!player.perks?.redGapAllowed,
		diagonalRotation: !!player.perks?.diagonalRotation
	};

	const placements = [];
	const rotations = [0, 1, 2, 3];
	const mirrors = [false, true];

	for (const zoneName of allowedZones) {
		if (zoneName === 'red') {
			const redZone = gameState.boardState?.zones?.red;
			if (!redZone?.subgrids) continue;
			for (const subgrid of redZone.subgrids) {
				_tryPlacementsOnZone(card, subgrid, zoneName, rotations, mirrors, perkFlags, subgrid.id, placements);
			}
		} else {
			const zoneData = gameState.boardState?.zones?.[zoneName];
			if (!zoneData) continue;
			_tryPlacementsOnZone(card, zoneData, zoneName, rotations, mirrors, perkFlags, null, placements);
		}
	}

	return placements;
}

function _tryPlacementsOnZone(card, zoneData, zoneName, rotations, mirrors, perkFlags, subgridId, result) {
	const rows = zoneData.rows || 0;
	const cols = zoneData.cols || 0;

	for (const rotation of rotations) {
		for (const mirrored of mirrors) {
			let matrix = GameRules.cloneMatrix(card.matrix);
			matrix = GameRules.getEnhancedMatrix(matrix, zoneName, perkFlags);
			matrix = GameRules.rotateMatrixN(matrix, rotation);
			if (mirrored) matrix = GameRules.mirrorMatrix(matrix);

			for (let baseY = -1; baseY < rows + 1; baseY++) {
				for (let baseX = -1; baseX < cols + 1; baseX++) {
					const cells = GameRules.collectPlacementCellsData(zoneData, baseX, baseY, matrix);
					if (!cells || cells.length === 0) continue;
					if (!GameRules.validatePlacement(zoneName, zoneData, cells, perkFlags)) continue;

					// Base score: simple flag-based (used as tiebreaker)
					let score = 0;
					for (const c of cells) {
						const cell = GameRules.getDataCell(zoneData, c.x, c.y);
						if (cell?.flags?.includes('gold')) score += 8;
						else if (cell?.flags?.includes('bonus')) score += 12;
						else if (cell?.flags?.includes('pearl')) score += 6;
						else if (cell?.flags?.includes('end')) score += 5;
						else if (cell?.flags?.includes('bold')) score += 3;
						else score += 1;
					}

					result.push({
						zoneName, baseX, baseY, rotation, mirrored, subgridId,
						cellCount: cells.length, score, cardId: card.id
					});
				}
			}
		}
	}
}

/**
 * Vind geldige bonus plaatsingen.
 */
function findValidBonusPlacements(gameState, playerId, bonusColor) {
	const player = gameState.players[playerId];
	if (!player) return [];

	const bonusMatrix = GameRules.getBonusShapeForPlayer(bonusColor, player);
	const zones = bonusColor === 'any'
		? ['yellow', 'green', 'blue', 'red', 'purple']
		: [bonusColor];

	const placements = [];
	const rotations = bonusColor === 'any' ? [0] : [0, 1]; // 1x1 bonus hoeft niet te roteren

	for (const zoneName of zones) {
		if (zoneName === 'red') {
			const redZone = gameState.boardState?.zones?.red;
			if (!redZone?.subgrids) continue;
			for (const subgrid of redZone.subgrids) {
				_tryBonusPlacements(bonusMatrix, subgrid, zoneName, rotations, subgrid.id, placements, bonusColor);
			}
		} else {
			const zoneData = gameState.boardState?.zones?.[zoneName];
			if (!zoneData) continue;
			_tryBonusPlacements(bonusMatrix, zoneData, zoneName, rotations, null, placements, bonusColor);
		}
	}

	return placements;
}

function _tryBonusPlacements(bonusMatrix, zoneData, zoneName, rotations, subgridId, result, bonusColor) {
	const rows = zoneData.rows || 0;
	const cols = zoneData.cols || 0;

	for (const rotation of rotations) {
		let matrix = GameRules.cloneMatrix(bonusMatrix);
		matrix = GameRules.rotateMatrixN(matrix, rotation);

		for (let baseY = 0; baseY < rows; baseY++) {
			for (let baseX = 0; baseX < cols; baseX++) {
				const cells = GameRules.collectPlacementCellsData(zoneData, baseX, baseY, matrix);
				if (!cells || cells.length === 0) continue;
				if (!GameRules.validatePlacement(zoneName, zoneData, cells, {})) continue;

				let score = cells.length;
				let bonusCount = 0;
				let goldCount = 0;
				for (const c of cells) {
					const cell = GameRules.getDataCell(zoneData, c.x, c.y);
					if (cell?.flags?.includes('gold')) { score += 10; goldCount++; }
					if (cell?.flags?.includes('bonus')) {
						// Heavily reward bonus chaining: picking up a same-color bonus with a bonus = free extra placement
						bonusCount++;
						score += 25;
					}
					if (cell?.flags?.includes('pearl')) score += 6;
					if (cell?.flags?.includes('bold')) score += 3;
					if (cell?.flags?.includes('end')) score += 5;
				}
				// Extra scaling for multi-bonus grabs (3 bonuses >> 3x one bonus)
				if (bonusCount >= 2) score += bonusCount * 15;
				if (bonusCount >= 3) score += 25;
				// Gold + bonus combo synergy
				if (goldCount > 0 && bonusCount > 0) score += (goldCount + bonusCount) * 8;

				// Zone-specific bonus impact (lighter than full card impact)
				if (zoneName === 'yellow') score += _scoreYellowImpact(zoneData, cells);
				else if (zoneName === 'green') score += _scoreGreenImpact(zoneData, cells);
				else if (zoneName === 'blue') score += _scoreBlueImpact(zoneData, cells);
				else if (zoneName === 'red') {
					// Simplified red scoring using subgrid fill info
					const info = _getSubgridFillInfo(zoneData);
					const newFilled = info.filled + cells.length;
					const newRatio = info.total > 0 ? newFilled / info.total : 0;
					if (newRatio >= 0.8 && info.ratio < 0.8) score += 20;
					if (newRatio >= 1.0 && info.ratio < 1.0) score += 15;
					if (info.ratio >= 0.5) score += 8;
					else if (info.ratio >= 0.3) score += 4;
				}
				else if (zoneName === 'purple') score += _scorePurpleImpact(zoneData, cells);

				// Adjacency — prefer extending existing territory
				let adjacentCount = 0;
				for (const c of cells) {
					if (GameRules.hasAdjacentActive(zoneData, c.x, c.y)) adjacentCount++;
				}
				score += adjacentCount * 3;

				// Penalty for isolated bonus placement (no adjacent active cells when zone has active cells)
				if (adjacentCount === 0) {
					let zoneHasActive = false;
					const zCells = zoneData.cells || {};
					for (const k in zCells) {
						if (zCells[k]?.active) { zoneHasActive = true; break; }
					}
					if (zoneHasActive) score -= 20;
				}

				result.push({ zoneName, baseX, baseY, rotation, subgridId, score, bonusColor });
			}
		}
	}
}

/**
 * Evaluate the best bonus placement for a given color without placing it.
 * Returns { score } or null if no valid placement exists.
 */
function _evaluateBestBonus(gameState, playerId, bonusColor) {
	const placements = findValidBonusPlacements(gameState, playerId, bonusColor);
	if (placements.length === 0) return null;
	placements.sort((a, b) => b.score - a.score);
	return placements[0];
}

/**
 * Order bonus colors by strategic priority: objective zone first, weakest zone second.
 */
function _getBonusPlayOrder(player) {
	const colors = ['yellow', 'red', 'green', 'purple', 'blue'];
	const objective = player.chosenObjective;
	const scores = player.scoreBreakdown || {};

	// Sort by: objective-relevant first, then weakest zone
	colors.sort((a, b) => {
		const aObj = _isObjectiveZone(objective, a) ? -100 : 0;
		const bObj = _isObjectiveZone(objective, b) ? -100 : 0;
		const aScore = scores[a] || 0;
		const bScore = scores[b] || 0;
		return (aObj - bObj) || (aScore - bScore);
	});

	// Always add 'any' at end
	colors.push('any');
	return colors;
}

function _isObjectiveZone(objective, zoneName) {
	if (!objective) return false;
	const objId = objective.id || '';
	if (objId === 'fill_yellow_cols' && zoneName === 'yellow') return true;
	if (objId === 'reach_green_ends' && zoneName === 'green') return true;
	if (objId === 'complete_blue_rows' && zoneName === 'blue') return true;
	if (objId === 'fill_red_grids' && zoneName === 'red') return true;
	if (objId === 'purple_cluster' && zoneName === 'purple') return true;
	if (objective.zone === zoneName) return true;
	if (objective.zones?.includes(zoneName)) return true;
	return false;
}

/**
 * AI kiest een mijn-doelwit: een lege cel dicht bij actieve cellen van tegenstanders.
 */
function _chooseMineTarget(gameState, playerId) {
	const board = gameState.boardState;
	if (!board) return null;

	const opponents = (gameState.playerOrder || []).filter(pid => pid !== playerId);
	if (opponents.length === 0) return null;

	const candidates = [];
	for (const zoneName of ['yellow', 'green', 'blue', 'purple']) {
		_findMineCandidates(board.zones?.[zoneName], zoneName, candidates);
	}
	for (const sg of (board.zones?.red?.subgrids || [])) {
		_findMineCandidates(sg, 'red', candidates);
	}

	if (candidates.length === 0) return null;
	candidates.sort((a, b) => b.score - a.score);
	const top = candidates.slice(0, Math.min(16, candidates.length));
	const picked = top[Math.floor(Math.random() * top.length)] || top[0];
	if (!picked) return null;
	return { type: 'useMine', zoneName: picked.zoneName, cellX: picked.x, cellY: picked.y };
}

function _findMineCandidates(zoneData, zoneName, result) {
	if (!zoneData) return;
	const rows = zoneData.rows || 0;
	const cols = zoneData.cols || 0;
	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const cell = GameRules.getDataCell(zoneData, x, y);
			if (!cell || cell.active) continue;
			if (cell.flags?.includes('void')) continue;
			let score = 1;
			if (cell.flags?.includes('bonus')) score += 18;
			if (cell.flags?.includes('gold')) score += 12;
			if (cell.flags?.includes('bold')) score += 9;
			if (cell.flags?.includes('end')) score += 8;
			if (cell.flags?.includes('portal')) score += 6;
			if (GameRules.hasAdjacentActive(zoneData, x, y)) score += 5;
			score += Math.random() * 3;
			result.push({ zoneName, x, y, score });
		}
	}
}

/**
 * AI kiest een steal-doelwit: de tegenstander met de beste kaarten.
 */
function _chooseStealTarget(gameState, playerId) {
	const opponents = (gameState.playerOrder || []).filter(pid => pid !== playerId);
	if (opponents.length === 0) return null;

	const candidates = [];
	for (const oppId of opponents) {
		const opp = gameState.players[oppId];
		if (!opp) continue;
		const stealable = (opp.hand || []).filter(c => !c.isGolden && !c.isStone);
		for (const card of stealable) {
			const cells = card.matrix ? card.matrix.flat().filter(v => v > 0).length : 0;
			const score = (cells * 3) + Math.random() * 4;
			candidates.push({ targetPlayerId: oppId, cardId: card.id, score });
		}
	}

	if (candidates.length === 0) return null;
	candidates.sort((a, b) => b.score - a.score);
	const top = candidates.slice(0, Math.min(8, candidates.length));
	const picked = top[Math.floor(Math.random() * top.length)] || top[0];
	if (!picked) return null;
	return { type: 'stealCard', targetPlayerId: picked.targetPlayerId, cardId: picked.cardId };
}

/**
 * AI kiest een startdeck type.
 */
function chooseStartingDeck() {
	const types = GameRules.STARTING_DECK_TYPES;
	return types[Math.floor(Math.random() * types.length)];
}

/**
 * Analyze which zone colors a player's hand favors.
 * Returns { yellow, green, blue, red, purple, dominant } counts.
 */
function _getHandColorProfile(player) {
	const hand = player?.hand || [];
	const counts = { yellow: 0, green: 0, blue: 0, red: 0, purple: 0 };
	for (const card of hand) {
		const zones = GameRules.getAllowedZones(card);
		for (const z of zones) {
			if (counts[z] !== undefined) counts[z]++;
		}
	}
	let dominant = 'yellow';
	let maxCount = 0;
	for (const [zone, count] of Object.entries(counts)) {
		if (count > maxCount) { maxCount = count; dominant = zone; }
	}
	return { ...counts, dominant };
}

/**
 * AI kiest een objective (index 0-2).
 * Analyzes hand card colors to pick objectives that match dominant zones.
 * Aggressive bots prefer sabotage objectives.
 */
function chooseObjective(choices, gameState, playerId, personality) {
	if (!choices || choices.length === 0) return 0;

	const player = gameState?.players?.[playerId];
	const colorProfile = player ? _getHandColorProfile(player) : null;
	const isAggressive = personality === 'aggressive';

	let bestIdx = 0;
	let bestScore = -Infinity;
	for (let i = 0; i < choices.length; i++) {
		const obj = choices[i];
		const points = obj.points || 0;
		const coins = obj.coins || 0;
		const bonuses = obj.randomBonuses || 0;
		let score = points + coins * 2 + bonuses * 4;

		const objId = obj.id || '';
		const isSabotage = objId.includes('deny_') || obj.dynamicType === 'deny_named_objective';

		// Aggressive bots heavily prefer sabotage/blocking objectives
		if (isAggressive && isSabotage) {
			score += 50;
		} else if (isAggressive && !isSabotage) {
			score -= 5; // Slight penalty for non-aggressive objectives
		}

		// Match objectives to dominant hand colors
		if (colorProfile) {
			const zoneMatch = _objectiveZoneMatch(objId);
			if (zoneMatch) {
				// Boost by how many cards of this color the bot has
				score += (colorProfile[zoneMatch] || 0) * 5;
				if (zoneMatch === colorProfile.dominant) score += 10;
			}
		}

		// Higher reward objectives are worth chasing
		if (points >= 30) score += 5;

		if (score > bestScore) {
			bestScore = score;
			bestIdx = i;
		}
	}
	return bestIdx;
}

/** Map objective IDs to their primary zone. */
function _objectiveZoneMatch(objId) {
	if (objId.includes('yellow')) return 'yellow';
	if (objId.includes('green')) return 'green';
	if (objId.includes('blue')) return 'blue';
	if (objId.includes('red')) return 'red';
	if (objId.includes('purple')) return 'purple';
	return null;
}

/**
 * AI kiest een perk based on hand colors and personality.
 * Aggressive bots always pick aggressive perks first.
 */
function choosePerk(gameState, playerId, personality) {
	const player = gameState.players[playerId];
	if (!player?.perks || (player.perks.perkPoints || 0) < 1) return null;

	const available = GameRules.getAvailablePerks(player);
	if (!available || available.length === 0) return null;

	const isAggressive = personality === 'aggressive';

	// Filter out agg_stone — bots cannot use stone blocks effectively
	const filteredAvailable = available.filter(p => p.id !== 'agg_stone');
	if (filteredAvailable.length === 0) return null;

	// 30% kans op volledig random keuze voor variatie
	if (Math.random() < 0.30) {
		return filteredAvailable[Math.floor(Math.random() * filteredAvailable.length)].id;
	}

	if (isAggressive) {
		// Aggressive bot: weighted pick — never pick agg_stone (bots can't use it well)
		const candidates = [];
		if (available.find(p => p.id === 'agg_steal')) candidates.push({ id: 'agg_steal', weight: 13 });
		// agg_stone skipped — bots cannot strategically place stone blocks
		if (available.find(p => p.id === 'agg_mine') && Math.random() < 0.45) candidates.push({ id: 'agg_mine', weight: 2 });
		if (available.find(p => p.id === 'flex_wildcard')) candidates.push({ id: 'flex_wildcard', weight: 10 });
		if (available.find(p => p.id === 'flex_double_coins')) candidates.push({ id: 'flex_double_coins', weight: 9 });
		if (available.find(p => p.id === 'flex_gap')) candidates.push({ id: 'flex_gap', weight: 8 });
		if (available.find(p => p.id === 'flex_gap_red')) candidates.push({ id: 'flex_gap_red', weight: 8 });
		if (available.find(p => p.id === 'flex_rotate')) candidates.push({ id: 'flex_rotate', weight: 8 });
		if (available.find(p => p.id === 'bonus_multi_double')) candidates.push({ id: 'bonus_multi_double', weight: 8 });
		if (available.find(p => p.id === 'bonus_yellow')) candidates.push({ id: 'bonus_yellow', weight: 6 });
		if (available.find(p => p.id === 'bonus_red')) candidates.push({ id: 'bonus_red', weight: 6 });
		if (available.find(p => p.id === 'bonus_green')) candidates.push({ id: 'bonus_green', weight: 6 });
		if (available.find(p => p.id === 'bonus_purple')) candidates.push({ id: 'bonus_purple', weight: 6 });
		if (available.find(p => p.id === 'bonus_blue')) candidates.push({ id: 'bonus_blue', weight: 6 });

		if (candidates.length > 0) {
			const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
			let roll = Math.random() * totalWeight;
			for (const c of candidates) {
				roll -= c.weight;
				if (roll <= 0) return c.id;
			}
			return candidates[candidates.length - 1].id;
		}
	} else {
		// Normal bot: pick perks based on hand card colors with weighted randomness
		const colorProfile = _getHandColorProfile(player);
		const candidates = []; // { id, weight }

		// Bonus perks matching dominant hand colors
		const colorPerks = [
			{ id: 'bonus_yellow', zone: 'yellow' },
			{ id: 'bonus_red', zone: 'red' },
			{ id: 'bonus_green', zone: 'green' },
			{ id: 'bonus_purple', zone: 'purple' },
			{ id: 'bonus_blue', zone: 'blue' }
		];
		for (const cp of colorPerks) {
			if (available.find(p => p.id === cp.id)) {
				const colorCount = colorProfile[cp.zone] || 0;
				candidates.push({ id: cp.id, weight: 5 + colorCount * 3 + (cp.zone === colorProfile.dominant ? 8 : 0) });
			}
		}
		if (available.find(p => p.id === 'bonus_multi_double')) candidates.push({ id: 'bonus_multi_double', weight: 12 });

		// Flex perks
		if (available.find(p => p.id === 'flex_gap')) candidates.push({ id: 'flex_gap', weight: 8 + (colorProfile.green >= 2 ? 5 : 0) });
		if (available.find(p => p.id === 'flex_rotate')) candidates.push({ id: 'flex_rotate', weight: 8 + (colorProfile.purple >= 2 ? 5 : 0) });
		if (available.find(p => p.id === 'flex_gap_red')) candidates.push({ id: 'flex_gap_red', weight: 7 + (colorProfile.red >= 2 ? 5 : 0) });
		if (available.find(p => p.id === 'flex_wildcard')) candidates.push({ id: 'flex_wildcard', weight: 10 });
		if (available.find(p => p.id === 'flex_double_coins')) candidates.push({ id: 'flex_double_coins', weight: 9 });

		// Aggressive perks (lower weight for normal bots — skip agg_stone entirely)
		if (available.find(p => p.id === 'agg_mine') && Math.random() < 0.35) candidates.push({ id: 'agg_mine', weight: 1 });
		if (available.find(p => p.id === 'agg_steal')) candidates.push({ id: 'agg_steal', weight: 3 });

		// Weighted random selection
		if (candidates.length > 0) {
			const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
			let roll = Math.random() * totalWeight;
			for (const c of candidates) {
				roll -= c.weight;
				if (roll <= 0) return c.id;
			}
			return candidates[candidates.length - 1].id;
		}
	}

	// Fallback: pak random beschikbare (excluding agg_stone)
	return filteredAvailable[Math.floor(Math.random() * filteredAvailable.length)].id;
}

/**
 * AI speelt een volledige beurt: kaart + bonussen + endTurn.
 * Geeft een reeks acties terug die de server moet uitvoeren.
 */
function planTurn(gameState, playerId, personality) {
	const player = gameState.players[playerId];
	if (!player) return [];

	const actions = [];

	// 1. Evaluate ALL placements across ALL cards (like hard AI, but deterministic pick)
	const hand = player.hand || [];
	const regularCards = hand.filter(c => !c.isGolden);
	const goldenCards = hand.filter(c => c.isGolden);

	let allPlacements = [];
	for (const card of regularCards) {
		const placements = findValidPlacements(gameState, playerId, card);
		for (const p of placements) {
			p.impactScore = _evaluatePlacementImpact(gameState, playerId, card, p);
			p._card = card;
		}
		allPlacements.push(...placements);
	}

	let cardPlayed = false;
	if (allPlacements.length > 0) {
		allPlacements.sort((a, b) => b.impactScore - a.impactScore);

		// Normal AI: weighted randomization among top-3 (smarter card/rotation pick)
		const topN = Math.min(3, allPlacements.length);
		const weights = [0.55, 0.30, 0.15];
		let r = Math.random();
		let chosenIdx = 0;
		for (let i = 0; i < topN; i++) {
			r -= weights[i] || 0;
			if (r <= 0) { chosenIdx = i; break; }
		}

		const best = allPlacements[chosenIdx];
		actions.push({
			type: 'playCard',
			cardId: best.cardId,
			zoneName: best.zoneName,
			baseX: best.baseX,
			baseY: best.baseY,
			rotation: best.rotation,
			mirrored: best.mirrored,
			subgridId: best.subgridId
		});
		cardPlayed = true;
	}

	// 2. Probeer gouden kaarten als extra (also impact-scored)
	for (const card of goldenCards) {
		const placements = findValidPlacements(gameState, playerId, card);
		if (placements.length === 0) continue;
		for (const p of placements) {
			p.impactScore = _evaluatePlacementImpact(gameState, playerId, card, p);
		}
		placements.sort((a, b) => b.impactScore - a.impactScore);
		const best = placements[0];
		actions.push({
			type: 'playCard',
			cardId: card.id,
			zoneName: best.zoneName,
			baseX: best.baseX,
			baseY: best.baseY,
			rotation: best.rotation,
			mirrored: best.mirrored,
			subgridId: best.subgridId
		});
	}

	// 3. Perk kiezen als perkPoints beschikbaar
	const perkId = choosePerk(gameState, playerId, personality);
	if (perkId) {
		actions.push({ type: 'choosePerk', perkId });
	}

	// 4. Bonussen spelen — prioritize objective-relevant zones
	const bonusOrder = _getBonusPlayOrder(player);
	for (const color of bonusOrder) {
		const charges = player.bonusInventory?.[color] || 0;
		for (let i = 0; i < charges; i++) {
			actions.push({ type: 'playBonus', bonusColor: color });
		}
	}

	// 5. Mijn plaatsen als perk beschikbaar
	if (GameRules.playerHasPerk(player, 'agg_mine') && (player.perks.minesUsedThisLevel || 0) < 1) {
		const mineAction = _chooseMineTarget(gameState, playerId);
		if (mineAction) actions.push(mineAction);
	}

	// 6. Kaart stelen als perk beschikbaar
	if (GameRules.playerHasPerk(player, 'agg_steal') && (player.perks.stealsUsedThisLevel || 0) < (player.perks.stealsPerRound || 0)) {
		const stealAction = _chooseStealTarget(gameState, playerId);
		if (stealAction) actions.push(stealAction);
	}

	// 7. Einde beurt
	if (!cardPlayed && regularCards.length > 0) {
		// Geen geldige plaatsing gevonden, discard een kaart
		actions.push({ type: 'endTurn', discardCardId: regularCards[0].id });
	} else {
		actions.push({ type: 'endTurn' });
	}

	return actions;
}

/**
 * AI kiest items in de shop.
 * Koopt de meest waardevolle items die het kan betalen.
 * Prioriteert permanente kaarten (shop card offerings) boven eenmalige items.
 */
function planShop(gameState, playerId) {
	const player = gameState.players[playerId];
	if (!player) return [];

	const actions = [];
	const coins = player.goldCoins || 0;

	if (coins <= 0) return [{ type: 'shopReady' }];

	let remainingCoins = coins;

	// 1. Shop card offerings FIRST (permanent cards — high strategic value)
	const offerings = player.shopOfferings || [];
	const cardScores = offerings.map((card, i) => {
		if (!card) return { idx: i, score: -1, price: Infinity };
		const price = card.shopPrice || GameRules.getCardPrice(card);
		const cellCount = card.matrix ? card.matrix.flat().filter(v => v > 0).length : 0;
		return { idx: i, score: cellCount, price };
	});
	cardScores.sort((a, b) => b.score - a.score);

	for (const cs of cardScores) {
		if (cs.score <= 0 || cs.price > remainingCoins) continue;
		actions.push({ type: 'buyShopItem', itemId: `shop-card-${cs.idx}` });
		remainingCoins -= cs.price;
	}

	// 2. Dan eenmalige shop items (skip unlock-steen — bots can't use stones well)
	const shopItems = GameRules.getShopItems(gameState.level || 1, player);
	const affordableItems = shopItems.filter(item => item.cost <= remainingCoins && !item.unlockOnly && item.id !== 'unlock-steen');
	affordableItems.sort((a, b) => a.cost - b.cost);

	for (const item of affordableItems) {
		if (item.cost > remainingCoins) continue;
		const extra = {};
		if (item.id === 'extra-bonus') {
			const inv = player.bonusInventory || {};
			const colors = ['yellow', 'red', 'green', 'purple', 'blue'];
			colors.sort((a, b) => (inv[a] || 0) - (inv[b] || 0));
			extra.bonusColor = colors[0];
		}
		actions.push({ type: 'buyShopItem', itemId: item.id, extra });
		remainingCoins -= item.cost;
	}

	// 3. Als we nog niets gekocht hebben en er IS iets betaalbaar, koop het goedkoopste
	if (actions.length === 0 && coins > 0) {
		const allBuyable = [
			...shopItems.filter(item => item.cost <= coins && !item.unlockOnly && item.id !== 'unlock-steen').map(item => ({ id: item.id, cost: item.cost, extra: {} })),
			...offerings.map((card, i) => {
				if (!card) return null;
				const price = card.shopPrice || GameRules.getCardPrice(card);
				return price <= coins ? { id: `shop-card-${i}`, cost: price, extra: {} } : null;
			}).filter(Boolean)
		];
		if (allBuyable.length > 0) {
			allBuyable.sort((a, b) => a.cost - b.cost);
			actions.push({ type: 'buyShopItem', itemId: allBuyable[0].id, extra: allBuyable[0].extra });
		}
	}

	// Perk kiezen als punten beschikbaar
	const perkId = choosePerk(gameState, playerId);
	if (perkId) {
		actions.push({ type: 'choosePerk', perkId });
	}

	actions.push({ type: 'shopReady' });
	return actions;
}

// ══════════════════════════════════════════════
//  HARD AI — Advanced heuristic (ML-style)
// ══════════════════════════════════════════════

const HARD_THINK_DELAY_MIN_MS = 900;
const HARD_THINK_DELAY_MAX_MS = 1700;

function getHardAIThinkDelay() {
	return HARD_THINK_DELAY_MIN_MS + Math.floor(Math.random() * (HARD_THINK_DELAY_MAX_MS - HARD_THINK_DELAY_MIN_MS));
}

/**
 * Evaluates the actual scoring impact of a placement by simulating its effect.
 * Uses zone-specific scoring rules to predict real point gains.
 */
function _evaluatePlacementImpact(gameState, playerId, card, placement) {
	const player = gameState.players[playerId];
	if (!player) return placement.score;

	let impactScore = 0;
	const board = gameState.boardState;
	const zoneName = placement.zoneName;
	const zoneData = _getZoneData(board, zoneName, placement.subgridId);
	if (!zoneData) return placement.score;

	const cells = _getPlacementCells(card, placement, zoneData);
	if (!cells || cells.length === 0) return placement.score;

	// ── Collect valuable cell resources ──
	let bonusFlagsCollected = 0;
	let goldCoinsCollected = 0;
	let hasAnyValueFlag = false;
	for (const c of cells) {
		const cell = GameRules.getDataCell(zoneData, c.x, c.y);
		if (cell?.flags?.includes('gold')) {
			goldCoinsCollected++;
			hasAnyValueFlag = true;
			const coinValue = player.perks?.doubleCoins ? 20 : 10;
			impactScore += coinValue;
		}
		if (cell?.flags?.includes('bonus')) {
			bonusFlagsCollected++;
			hasAnyValueFlag = true;
			// Bonuses are extremely valuable: they chain into more bonuses and points
			impactScore += 35;
		}
		if (cell?.flags?.includes('pearl')) { impactScore += 8; hasAnyValueFlag = true; }
		if (cell?.flags?.includes('bold')) hasAnyValueFlag = true;
		if (cell?.flags?.includes('end')) hasAnyValueFlag = true;
	}

	// ── 2-step lookahead: bonus cells captured → future bonus placements ──
	// Collecting bonuses gives free extra placements which can grab MORE bonuses and points
	// Multiple bonuses from one card = exponential value (3 bonuses >> 1 bonus)
	if (bonusFlagsCollected >= 2) {
		impactScore += bonusFlagsCollected * 30;
	}
	if (bonusFlagsCollected >= 3) {
		// 3+ bonuses in one placement is a massive strategic win
		impactScore += 50;
	}
	// Gold + bonus combo: extra synergy
	if (goldCoinsCollected > 0 && bonusFlagsCollected > 0) {
		impactScore += (goldCoinsCollected + bonusFlagsCollected) * 10;
	}

	// ── Bonus collection ALWAYS beats empty cells when no direct points ──
	// If this placement has no zone-scoring value (no bold, no end, no column completion etc.)
	// then bonus cells should be strongly preferred over plain empty cells
	if (!hasAnyValueFlag) {
		impactScore -= 10; // Penalize pure empty-cell placements
	}

	// ── Zone-specific scoring simulation ──
	if (zoneName === 'yellow') {
		impactScore += _scoreYellowImpact(zoneData, cells);
	} else if (zoneName === 'green') {
		impactScore += _scoreGreenImpact(zoneData, cells);
	} else if (zoneName === 'blue') {
		impactScore += _scoreBlueImpact(zoneData, cells);
	} else if (zoneName === 'red') {
		impactScore += _scoreRedImpact(board, placement, cells);
	} else if (zoneName === 'purple') {
		impactScore += _scorePurpleImpact(zoneData, cells);
	}

	// ── Objective awareness — HEAVY weighting ──
	const objective = player.chosenObjective;
	if (objective && !player.objectiveAchieved) {
		impactScore += _scoreObjectiveImpact(objective, zoneName, cells, board, placement);
	}

	// ── Balance bonus awareness ──
	const scoreBreakdown = player.scoreBreakdown || {};
	const zoneScores = {
		yellow: scoreBreakdown.yellow || 0,
		green: scoreBreakdown.green || 0,
		blue: scoreBreakdown.blue || 0,
		red: scoreBreakdown.red || 0,
		purple: scoreBreakdown.purple || 0
	};
	const currentMin = Math.min(...Object.values(zoneScores));
	if (zoneScores[zoneName] === currentMin && currentMin < 15) {
		impactScore += 8; // Boost weakest zone for balance bonus
	}

	// ── Adjacency — prefer extending existing territory ──
	let adjacentCount = 0;
	let totalActiveCells = 0;
	for (const c of cells) {
		if (GameRules.hasAdjacentActive(zoneData, c.x, c.y)) adjacentCount++;
	}
	// Count total active cells in zone to know if this is zoneOpening
	const zCells = zoneData.cells || {};
	for (const k in zCells) {
		if (zCells[k]?.active) totalActiveCells++;
	}
	impactScore += adjacentCount * 3;

	// ── STRONG penalize isolated placements with no strategic value ──
	const hasAnyFlag = cells.some(c => {
		const cell = GameRules.getDataCell(zoneData, c.x, c.y);
		return cell?.flags?.some(f => ['gold', 'bonus', 'pearl', 'end', 'bold'].includes(f));
	});
	if (adjacentCount === 0 && totalActiveCells > 0) {
		// There ARE active cells on the zone but we're not adjacent to any — strongly penalize
		impactScore -= 30;
		if (!hasAnyFlag) {
			impactScore -= 20; // Even worse if no valuable flags
		}
	} else if (!hasAnyFlag && adjacentCount === 0 && totalActiveCells === 0) {
		// First placement on an empty zone — mild penalty if no flags
		impactScore -= 5;
	}

	// ── Cell count bonus — bigger placements are inherently better ──
	impactScore += cells.length * 2;

	return impactScore;
}

/** Yellow: simulate column completion. Complete columns = 10/14/20/28/38 per pair slot. */
function _scoreYellowImpact(zoneData, placedCells) {
	let impact = 0;
	const columnsAffected = new Set(placedCells.map(c => c.x));

	for (const colX of columnsAffected) {
		let emptyCount = 0;
		let totalCells = 0;
		const placedInCol = placedCells.filter(c => c.x === colX).length;

		for (let y = 0; y < (zoneData.rows || 0); y++) {
			const cell = GameRules.getDataCell(zoneData, colX, y);
			if (!cell) continue;
			totalCells++;
			if (!cell.active) emptyCount++;
		}

		// After placement, remaining empty = emptyCount - placedInCol
		const remainingEmpty = Math.max(0, emptyCount - placedInCol);

		if (remainingEmpty === 0 && totalCells > 0) {
			// Column will be complete! Award the actual column pair points.
			const pairIndex = Math.min(Math.floor(colX / 2), 4);
			const pairPoints = [10, 14, 20, 28, 38];
			impact += pairPoints[pairIndex] * 2; // Double because scoring is huge
		} else if (remainingEmpty <= 2) {
			// Nearly complete — high value
			impact += 12;
		} else if (remainingEmpty <= 4) {
			impact += 4;
		}
	}

	return impact;
}

/** Green: simulate reaching end cells (5-25 pts each) and path advancement. */
function _scoreGreenImpact(zoneData, placedCells) {
	let impact = 0;
	const startX = Number.isFinite(zoneData.startX) ? zoneData.startX : Math.floor((zoneData.cols || 1) / 2);
	const startY = Number.isFinite(zoneData.startY) ? zoneData.startY : Math.floor((zoneData.rows || 1) / 2);

	for (const c of placedCells) {
		const cell = GameRules.getDataCell(zoneData, c.x, c.y);
		if (cell?.flags?.includes('end')) {
			// Reaching an end cell gives 5-25 points based on distance
			const dist = Math.abs(c.x - startX) + Math.abs(c.y - startY);
			let maxDist = 1;
			for (const k in zoneData.cells) {
				const ec = zoneData.cells[k];
				if (ec?.flags?.includes('end')) {
					const d = Math.abs((ec.x || 0) - startX) + Math.abs((ec.y || 0) - startY);
					if (d > maxDist) maxDist = d;
				}
			}
			const ratio = Math.min(1, dist / maxDist);
			impact += Math.round(5 + ratio * 20) * 2;
		}
	}

	// Proximity to nearest unreached end cell
	const unreachedEnds = [];
	for (const k in zoneData.cells) {
		const ec = zoneData.cells[k];
		if (ec?.flags?.includes('end') && !ec.active) {
			unreachedEnds.push(ec);
		}
	}
	if (unreachedEnds.length > 0) {
		for (const c of placedCells) {
			let minDist = Infinity;
			for (const ec of unreachedEnds) {
				const d = Math.abs(c.x - (ec.x || 0)) + Math.abs(c.y - (ec.y || 0));
				if (d < minDist) minDist = d;
			}
			if (minDist <= 1) impact += 10;
			else if (minDist <= 3) impact += 5;
			else if (minDist <= 5) impact += 2;
		}
	}

	// Adjacency to start/existing active cells (path building)
	let adjacentActive = 0;
	for (const c of placedCells) {
		if (GameRules.hasAdjacentActive(zoneData, c.x, c.y)) adjacentActive++;
	}
	impact += adjacentActive * 3;

	return impact;
}

/** Blue: simulate bold row tier unlocking (10/15/20/25/40 pts). */
function _scoreBlueImpact(zoneData, placedCells) {
	let impact = 0;
	const boldYs = [...new Set(zoneData.boldRows || [])].sort((a, b) => b - a);
	const reachedBoldRows = _getReachedBoldRows(zoneData);
	const tierPoints = [10, 15, 20, 25, 40];

	for (const c of placedCells) {
		const cell = GameRules.getDataCell(zoneData, c.x, c.y);
		if (cell?.flags?.includes('bold')) {
			const tierIdx = boldYs.indexOf(c.y);
			if (tierIdx >= 0) {
				if (!reachedBoldRows.has(c.y)) {
					// This placement unlocks a new tier!
					const pts = tierPoints[Math.min(tierIdx, tierPoints.length - 1)] || 10;
					impact += pts * 2;
				} else {
					// Bold row already scored — STRONG penalize wasting placement here
					impact -= 25;
				}
			}
		}
	}

	// Check if ALL bold rows already scored — placement on blue is low value
	if (reachedBoldRows.size >= boldYs.length && boldYs.length > 0) {
		// All bold rows already reached, placements here give diminishing returns
		const hitsBonus = placedCells.some(c => {
			const cell = GameRules.getDataCell(zoneData, c.x, c.y);
			return cell?.flags?.some(f => ['gold', 'bonus', 'pearl'].includes(f));
		});
		if (!hitsBonus) impact -= 20; // Strong penalty if no bonus/gold either
	}

	// Favor building upward — higher cells are worth more
	const minY = Math.min(...placedCells.map(c => c.y));
	impact += Math.max(0, Math.floor(((zoneData.rows || 20) - minY) / 2));

	// Strongly prefer vertical placements (span multiple rows = reach bold rows faster)
	const ys = new Set(placedCells.map(c => c.y));
	const xs = new Set(placedCells.map(c => c.x));
	const verticalSpan = ys.size;
	if (verticalSpan >= 2) impact += verticalSpan * 5;

	// PENALIZE horizontal-only placements (single row, multiple cols) that don't hit valuable flags
	// These waste cells: only 1 cell per bold row = no tier progress
	if (verticalSpan === 1 && xs.size >= 3) {
		let hasValuable = false;
		for (const c of placedCells) {
			const cell = GameRules.getDataCell(zoneData, c.x, c.y);
			if (cell?.flags?.some(f => ['gold', 'bonus', 'pearl', 'bold'].includes(f))) {
				hasValuable = true;
				break;
			}
		}
		if (!hasValuable) impact -= 15; // Strong penalty for horizontal waste
	}

	// Favor placements adjacent to existing cells (build connected paths upward)
	let adjacent = 0;
	for (const c of placedCells) {
		if (GameRules.hasAdjacentActive(zoneData, c.x, c.y)) adjacent++;
	}
	impact += adjacent * 3;

	return impact;
}

/** Red: simulate subgrid completion toward 80% threshold. */
function _scoreRedImpact(board, placement, placedCells) {
	const redZone = board?.zones?.red;
	if (!redZone?.subgrids || !placement.subgridId) return 0;
	const sg = redZone.subgrids.find(s => s.id === placement.subgridId);
	if (!sg) return 0;

	let impact = 0;
	const info = _getSubgridFillInfo(sg);
	const cellsPlaced = placedCells.length;
	const newFilled = info.filled + cellsPlaced;
	const newRatio = info.total > 0 ? newFilled / info.total : 0;

	if (newRatio >= 0.8 && info.ratio < 0.8) {
		// Crossing the 80% threshold earns base points!
		const rawBase = sg.targetPoints || (info.total * 2);
		const basePoints = Math.max(4, Math.round(rawBase * 0.5));
		impact += basePoints * 2;
	}
	if (newRatio >= 1.0 && info.ratio < 1.0) {
		// Full completion earns bonus points!
		impact += 20;
	}

	// Prefer subgrids with higher fill ratio (focus on completing one at a time)
	if (info.ratio >= 0.5) impact += 10;
	else if (info.ratio >= 0.3) impact += 5;

	// Penalize spreading across empty subgrids
	if (info.filled === 0 && info.ratio === 0) impact -= 3;

	return impact;
}

/** Purple: full connection simulation using union-find (6n multiplicative scoring). */
function _scorePurpleImpact(zoneData, placedCells) {
	let impact = 0;
	if (!zoneData?.cells) return 0;

	// ── Step 1: Count current connections BEFORE placement via lightweight union-find ──
	const keyOf = (x, y) => `${x},${y}`;
	const parent = new Map();
	const rankMap = new Map();
	const boldCount = new Map(); // bold cells per root

	const find = (k) => {
		let p = parent.get(k);
		if (p === k) return k;
		p = find(p);
		parent.set(k, p);
		return p;
	};
	const union = (a, b) => {
		let ra = find(a), rb = find(b);
		if (ra === rb) return ra;
		const rA = rankMap.get(ra) || 0, rB = rankMap.get(rb) || 0;
		if (rA < rB) { const t = ra; ra = rb; rb = t; }
		parent.set(rb, ra);
		if (rA === rB) rankMap.set(ra, rA + 1);
		boldCount.set(ra, (boldCount.get(ra) || 0) + (boldCount.get(rb) || 0));
		boldCount.delete(rb);
		return ra;
	};
	const connFromBold = (count) => Math.max(0, (count || 0) - 1);

	// Build current clusters from existing active cells
	const activeCells = new Set();
	for (const k in zoneData.cells) {
		const cell = zoneData.cells[k];
		if (!cell?.active || cell.isStone) continue;
		activeCells.add(keyOf(cell.x, cell.y));
		const key = keyOf(cell.x, cell.y);
		parent.set(key, key);
		rankMap.set(key, 0);
		boldCount.set(key, cell.flags?.includes('bold') ? 1 : 0);
	}
	for (const k in zoneData.cells) {
		const cell = zoneData.cells[k];
		if (!cell?.active || cell.isStone) continue;
		const key = keyOf(cell.x, cell.y);
		for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
			const nk = keyOf(cell.x+dx, cell.y+dy);
			if (activeCells.has(nk)) union(key, nk);
		}
	}

	let connectionsBefore = 0;
	const rootsSeen = new Set();
	for (const k of activeCells) {
		const r = find(k);
		if (!rootsSeen.has(r)) {
			rootsSeen.add(r);
			connectionsBefore += connFromBold(boldCount.get(r));
		}
	}

	// ── Step 2: Simulate placement — add new cells and re-union ──
	const placedKeys = new Set();
	for (const c of placedCells) {
		const key = keyOf(c.x, c.y);
		if (activeCells.has(key)) continue; // already active
		placedKeys.add(key);
		const cell = GameRules.getDataCell(zoneData, c.x, c.y);
		parent.set(key, key);
		rankMap.set(key, 0);
		boldCount.set(key, cell?.flags?.includes('bold') ? 1 : 0);

		// Union with existing active neighbors and other placed cells
		for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
			const nk = keyOf(c.x+dx, c.y+dy);
			if (activeCells.has(nk) || placedKeys.has(nk)) {
				if (parent.has(nk)) union(key, nk);
			}
		}
	}

	let connectionsAfter = 0;
	const rootsSeen2 = new Set();
	const allKeys = new Set([...activeCells, ...placedKeys]);
	for (const k of allKeys) {
		const r = find(k);
		if (!rootsSeen2.has(r)) {
			rootsSeen2.add(r);
			connectionsAfter += connFromBold(boldCount.get(r));
		}
	}

	const newConnections = Math.max(0, connectionsAfter - connectionsBefore);

	// ── Step 3: Score new connections using actual 6n formula ──
	// Connection i (1-based global) = 6*i points. New connections start at (connectionsBefore+1).
	for (let i = 0; i < newConnections; i++) {
		const connNumber = connectionsBefore + 1 + i;
		impact += GameRules.getPurpleConnectionPoints(connNumber);
	}
	// Double-weight because creating connections is THE strategy in purple
	if (newConnections > 0) {
		impact *= 2;
	}

	// ── Step 4: Value building TOWARDS bold cells (2-step lookahead) ──
	// If we're not creating a connection now, check if we're 1-2 steps from a bold cell
	if (newConnections === 0) {
		for (const c of placedCells) {
			const cell = GameRules.getDataCell(zoneData, c.x, c.y);
			if (cell?.flags?.includes('bold')) {
				impact += 15; // Placing ON a bold cell (will be part of connection later)
			}
			// Check 1-step and 2-step distance to unconnected bold cells
			for (const k in zoneData.cells) {
				const bc = zoneData.cells[k];
				if (!bc?.flags?.includes('bold')) continue;
				const dist = Math.abs(c.x - bc.x) + Math.abs(c.y - bc.y);
				if (dist === 1 && !bc.active) {
					impact += 12; // One step from an inactive bold cell — bonus will reach it
				} else if (dist === 2 && !bc.active) {
					impact += 6; // Two steps — reachable with bonus placement
				} else if (dist === 1 && bc.active) {
					// Adjacent to active bold cell — extending a cluster
					impact += 8;
				}
			}
		}
	}

	// ── Step 5: Bonus for late-game connections (escalating value) ──
	// After several connections are already made, each new one is worth much more
	if (connectionsBefore >= 3 && newConnections > 0) {
		impact += 20; // Late-game connection bonus
	}
	if (connectionsBefore >= 5 && newConnections > 0) {
		impact += 30; // Very late connections are extremely valuable (30+ pts each)
	}

	return impact;
}

/** Evaluate how a placement helps achieve the player's objective. */
function _scoreObjectiveImpact(objective, zoneName, cells, board, placement) {
	let impact = 0;
	const objId = objective.id || '';

	// Zone-specific objective matching
	if (objId === 'fill_yellow_cols' && zoneName === 'yellow') impact += 15;
	else if (objId === 'reach_green_ends' && zoneName === 'green') impact += 15;
	else if (objId === 'complete_blue_rows' && zoneName === 'blue') impact += 15;
	else if (objId === 'fill_red_grids' && zoneName === 'red') impact += 15;
	else if (objId === 'purple_cluster' && zoneName === 'purple') impact += 15;

	// General zone matching from objective
	if (objective.zone && objective.zone === zoneName) impact += 10;
	if (objective.type === 'coverage' && objective.zones?.includes(zoneName)) impact += 8;
	if (objective.type === 'density') impact += (cells.length || 1) * 3;

	// Specific objective progress boosting
	if (objId.includes('sabotage') && objective.targetPlayerId) {
		// Sabotage: don't boost
	} else if (objId.includes('collect_gold')) {
		// Gold collection: boost cells with gold flags
		for (const c of cells) {
			const zd = _getZoneData(board, zoneName, placement.subgridId);
			if (zd) {
				const cell = GameRules.getDataCell(zd, c.x, c.y);
				if (cell?.flags?.includes('gold')) impact += 10;
			}
		}
	}

	return impact;
}

function _getPlacementCells(card, placement, zoneData) {
	let matrix = GameRules.cloneMatrix(card.matrix);
	matrix = GameRules.rotateMatrixN(matrix, placement.rotation || 0);
	if (placement.mirrored) matrix = GameRules.mirrorMatrix(matrix);
	return GameRules.collectPlacementCellsData(zoneData, placement.baseX, placement.baseY, matrix) || [];
}

function _getZoneData(board, zoneName, subgridId) {
	if (zoneName === 'red') {
		const sg = board?.zones?.red?.subgrids?.find(s => s.id === subgridId);
		return sg || null;
	}
	return board?.zones?.[zoneName] || null;
}

function _countColumnCells(zoneData, colX) {
	let filled = 0;
	let total = 0;
	for (let y = 0; y < (zoneData.rows || 0); y++) {
		const cell = GameRules.getDataCell(zoneData, colX, y);
		if (cell) {
			total++;
			if (cell.active) filled++;
		}
	}
	return { filled, total, ratio: total > 0 ? filled / total : 0 };
}

/** Returns a Set of bold row Y-values that already have at least one active bold cell */
function _getReachedBoldRows(zoneData) {
	const reached = new Set();
	for (const boldY of (zoneData.boldRows || [])) {
		for (let x = 0; x < (zoneData.cols || 0); x++) {
			const cell = GameRules.getDataCell(zoneData, x, boldY);
			if (cell?.active && cell?.flags?.includes('bold')) {
				reached.add(boldY);
				break;
			}
		}
	}
	return reached;
}

function _getSubgridFillInfo(sg) {
	let filled = 0;
	let total = 0;
	const cells = sg.cells || {};
	for (const key in cells) {
		total++;
		if (cells[key]?.active) filled++;
	}
	return { filled, total, ratio: total > 0 ? filled / total : 0 };
}

/**
 * Hard AI turn planning — uses impact scoring and strategic evaluation.
 */
function planTurnHard(gameState, playerId) {
	const player = gameState.players[playerId];
	if (!player) return [];

	const actions = [];
	const hand = player.hand || [];
	const regularCards = hand.filter(c => !c.isGolden);
	const goldenCards = hand.filter(c => c.isGolden);

	// 1. Evaluate ALL placements across ALL cards and pick the globally best move
	let allPlacements = [];
	for (const card of regularCards) {
		const placements = findValidPlacements(gameState, playerId, card);
		for (const p of placements) {
			p.impactScore = _evaluatePlacementImpact(gameState, playerId, card, p);
			p._card = card;
		}
		allPlacements.push(...placements);
	}

	let cardPlayed = false;
	if (allPlacements.length > 0) {
		// Sort by impact score (ML-style composite evaluation)
		allPlacements.sort((a, b) => b.impactScore - a.impactScore);

		// Top-3 selection with slight randomization to avoid being perfectly predictable
		const topN = Math.min(3, allPlacements.length);
		const weights = [0.60, 0.25, 0.15]; // Probability of choosing 1st, 2nd, 3rd best
		let r = Math.random();
		let chosenIdx = 0;
		for (let i = 0; i < topN; i++) {
			r -= weights[i] || 0;
			if (r <= 0) { chosenIdx = i; break; }
		}

		const best = allPlacements[chosenIdx];
		actions.push({
			type: 'playCard',
			cardId: best.cardId,
			zoneName: best.zoneName,
			baseX: best.baseX,
			baseY: best.baseY,
			rotation: best.rotation,
			mirrored: best.mirrored,
			subgridId: best.subgridId
		});
		cardPlayed = true;
	}

	// 2. Golden cards — also use impact scoring
	for (const card of goldenCards) {
		const placements = findValidPlacements(gameState, playerId, card);
		if (placements.length === 0) continue;
		for (const p of placements) {
			p.impactScore = _evaluatePlacementImpact(gameState, playerId, card, p);
		}
		placements.sort((a, b) => b.impactScore - a.impactScore);
		const best = placements[0];
		actions.push({
			type: 'playCard',
			cardId: card.id,
			zoneName: best.zoneName,
			baseX: best.baseX,
			baseY: best.baseY,
			rotation: best.rotation,
			mirrored: best.mirrored,
			subgridId: best.subgridId
		});
	}

	// 3. Aggressive perk usage — hard AI prefers aggressive perks
	const perkId = chooseHardPerk(gameState, playerId);
	if (perkId) {
		actions.push({ type: 'choosePerk', perkId });
	}

	// 4. Bonuses — prioritize objective-relevant zones
	//    Hard AI: only play bonuses that yield immediate value (bonus chains, gold, objectives)
	//    Save others for later when they might be more useful
	const bonusOrder = _getBonusPlayOrder(player);
	for (const color of bonusOrder) {
		const charges = player.bonusInventory?.[color] || 0;
		for (let i = 0; i < charges; i++) {
			// Evaluate the best bonus placement to decide if it's worth playing now
			const bestBonus = _evaluateBestBonus(gameState, playerId, color);
			if (bestBonus && bestBonus.score >= 10) {
				// Good placement available — play it
				actions.push({ type: 'playBonus', bonusColor: color });
			} else if (bestBonus && bestBonus.score >= 5) {
				// Mediocre placement — play it but lower priority (still in queue)
				actions.push({ type: 'playBonus', bonusColor: color });
			}
			// If score < 5: skip (save bonus for later)
		}
	}

	// 5. Mijn plaatsen als perk beschikbaar (hard AI places strategically)
	if (GameRules.playerHasPerk(player, 'agg_mine') && (player.perks.minesUsedThisLevel || 0) < 1) {
		const mineAction = _chooseMineTarget(gameState, playerId);
		if (mineAction) actions.push(mineAction);
	}

	// 6. Kaart stelen als perk beschikbaar
	if (GameRules.playerHasPerk(player, 'agg_steal') && (player.perks.stealsUsedThisLevel || 0) < (player.perks.stealsPerRound || 0)) {
		const stealAction = _chooseStealTarget(gameState, playerId);
		if (stealAction) actions.push(stealAction);
	}

	// 7. End turn — smart discard (discard lowest-scoring card)
	if (!cardPlayed && regularCards.length > 0) {
		// Discard the card with fewest valid placements (worst card)
		let worstCard = regularCards[0];
		let worstPlacements = Infinity;
		for (const card of regularCards) {
			const count = findValidPlacements(gameState, playerId, card).length;
			if (count < worstPlacements) {
				worstPlacements = count;
				worstCard = card;
			}
		}
		actions.push({ type: 'endTurn', discardCardId: worstCard.id });
	} else {
		actions.push({ type: 'endTurn' });
	}

	return actions;
}

/**
 * Hard AI perk selection — more aggressive priority.
 */
function chooseHardPerk(gameState, playerId) {
	const player = gameState.players[playerId];
	if (!player?.perks || (player.perks.perkPoints || 0) < 1) return null;

	const available = GameRules.getAvailablePerks(player);
	if (!available || available.length === 0) return null;

	// Filter out agg_stone — bots cannot use stone blocks effectively
	const filteredAvailable = available.filter(p => p.id !== 'agg_stone');
	if (filteredAvailable.length === 0) return null;

	// 25% kans op random keuze voor onvoorspelbaarheid
	if (Math.random() < 0.25) {
		return filteredAvailable[Math.floor(Math.random() * filteredAvailable.length)].id;
	}

	const candidates = [];
	if (available.find(p => p.id === 'agg_steal')) candidates.push({ id: 'agg_steal', weight: 14 });
	// agg_stone skipped — bots cannot strategically place stone blocks
	if (available.find(p => p.id === 'agg_mine') && Math.random() < 0.35) candidates.push({ id: 'agg_mine', weight: 1 });
	if (available.find(p => p.id === 'flex_wildcard')) candidates.push({ id: 'flex_wildcard', weight: 10 });
	if (available.find(p => p.id === 'flex_double_coins')) candidates.push({ id: 'flex_double_coins', weight: 10 });
	if (available.find(p => p.id === 'flex_gap')) candidates.push({ id: 'flex_gap', weight: 8 });
	if (available.find(p => p.id === 'flex_gap_red')) candidates.push({ id: 'flex_gap_red', weight: 8 });
	if (available.find(p => p.id === 'flex_rotate')) candidates.push({ id: 'flex_rotate', weight: 8 });
	if (available.find(p => p.id === 'bonus_multi_double')) candidates.push({ id: 'bonus_multi_double', weight: 8 });
	if (available.find(p => p.id === 'bonus_yellow')) candidates.push({ id: 'bonus_yellow', weight: 5 });
	if (available.find(p => p.id === 'bonus_red')) candidates.push({ id: 'bonus_red', weight: 5 });
	if (available.find(p => p.id === 'bonus_green')) candidates.push({ id: 'bonus_green', weight: 5 });
	if (available.find(p => p.id === 'bonus_purple')) candidates.push({ id: 'bonus_purple', weight: 5 });
	if (available.find(p => p.id === 'bonus_blue')) candidates.push({ id: 'bonus_blue', weight: 5 });

	if (candidates.length > 0) {
		const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);
		let roll = Math.random() * totalWeight;
		for (const c of candidates) {
			roll -= c.weight;
			if (roll <= 0) return c.id;
		}
		return candidates[candidates.length - 1].id;
	}

	return filteredAvailable[Math.floor(Math.random() * filteredAvailable.length)].id;
}

/**
 * Hard AI shop strategy — smarter purchases, permanent cards first.
 */
function planShopHard(gameState, playerId) {
	const player = gameState.players[playerId];
	if (!player) return [];

	const actions = [];
	const coins = player.goldCoins || 0;
	if (coins <= 0) return [{ type: 'shopReady' }];

	let remainingCoins = coins;

	// 1. Shop card offerings FIRST — permanent cards with most cells
	const offerings = player.shopOfferings || [];
	const cardScores = offerings.map((card, i) => {
		if (!card) return { idx: i, score: -1, price: Infinity };
		const price = card.shopPrice || GameRules.getCardPrice(card);
		const cellCount = card.matrix ? card.matrix.flat().filter(v => v > 0).length : 0;
		return { idx: i, score: cellCount, price };
	});
	cardScores.sort((a, b) => b.score - a.score);

	for (const cs of cardScores) {
		if (cs.score <= 0 || cs.price > remainingCoins) continue;
		actions.push({ type: 'buyShopItem', itemId: `shop-card-${cs.idx}` });
		remainingCoins -= cs.price;
	}

	// 2. Then shop items (most expensive = most value, skip unlock-steen)
	const shopItems = GameRules.getShopItems(gameState.level || 1, player);
	const affordableItems = shopItems.filter(item => item.cost <= remainingCoins && !item.unlockOnly && item.id !== 'unlock-steen');
	affordableItems.sort((a, b) => b.cost - a.cost);

	for (const item of affordableItems) {
		if (item.cost > remainingCoins) continue;
		const extra = {};
		if (item.id === 'extra-bonus') {
			const scores = player.scoreBreakdown || {};
			const colors = ['yellow', 'red', 'green', 'purple', 'blue'];
			colors.sort((a, b) => (scores[a] || 0) - (scores[b] || 0));
			extra.bonusColor = colors[0];
		}
		actions.push({ type: 'buyShopItem', itemId: item.id, extra });
		remainingCoins -= item.cost;
	}

	// 3. Always buy something if possible (skip unlock-steen)
	if (actions.length === 0 && coins > 0) {
		const allBuyable = [
			...shopItems.filter(item => item.cost <= coins && !item.unlockOnly && item.id !== 'unlock-steen').map(item => ({ id: item.id, cost: item.cost, extra: {} })),
			...offerings.map((card, i) => {
				if (!card) return null;
				const price = card.shopPrice || GameRules.getCardPrice(card);
				return price <= coins ? { id: `shop-card-${i}`, cost: price, extra: {} } : null;
			}).filter(Boolean)
		];
		if (allBuyable.length > 0) {
			allBuyable.sort((a, b) => b.cost - a.cost);
			actions.push({ type: 'buyShopItem', itemId: allBuyable[0].id, extra: allBuyable[0].extra });
		}
	}

	const perkId = chooseHardPerk(gameState, playerId);
	if (perkId) {
		actions.push({ type: 'choosePerk', perkId });
	}

	actions.push({ type: 'shopReady' });
	return actions;
}

module.exports = {
	AI_NAMES,
	AI_THINK_DELAY_MIN_MS,
	AI_THINK_DELAY_MAX_MS,
	AI_ACTION_DELAY_MS,
	HARD_ACTION_DELAY_MS,
	HARD_THINK_DELAY_MIN_MS,
	HARD_THINK_DELAY_MAX_MS,
	getAIThinkDelay,
	getHardAIThinkDelay,
	pickAITaunt,
	pickAIReplyToTaunt,
	pickAIPersonality,
	AI_TAUNTS,
	findValidPlacements,
	findValidBonusPlacements,
	chooseStartingDeck,
	chooseObjective,
	choosePerk,
	chooseHardPerk,
	planTurn,
	planTurnHard,
	planShop,
	planShopHard
};
