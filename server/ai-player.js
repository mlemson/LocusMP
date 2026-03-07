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
const AI_ACTION_DELAY_MS = 800; // Delay between individual actions within a turn

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

/**
 * Decide if the AI should taunt and pick a message.
 * Returns { text } or null.
 */
function pickAITaunt(gameState, aiPlayerId, context) {
	// context: { type: 'bigScore', playerId, points } or { type: 'objectiveAchieved', playerId }
	if (!context) {
		// Small random chance to taunt unprovoked (~8%)
		if (Math.random() > 0.08) return null;
		const pool = AI_REACTIVE_TAUNTS.random;
		return { text: pool[Math.floor(Math.random() * pool.length)] };
	}

	if (context.type === 'bigScore' && context.points >= 25) {
		// ~40% chance to react to big score
		if (Math.random() > 0.40) return null;
		const pool = AI_REACTIVE_TAUNTS.bigScore;
		return { text: pool[Math.floor(Math.random() * pool.length)] };
	}

	if (context.type === 'objectiveAchieved') {
		// ~30% chance to react to objective
		if (Math.random() > 0.30) return null;
		const pool = AI_REACTIVE_TAUNTS.objectiveAchieved;
		return { text: pool[Math.floor(Math.random() * pool.length)] };
	}

	return null;
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

			const matH = matrix.length;
			const matW = Math.max(...matrix.map(r => r.length));

			for (let baseY = -1; baseY < rows + 1; baseY++) {
				for (let baseX = -1; baseX < cols + 1; baseX++) {
					const cells = GameRules.collectPlacementCellsData(zoneData, baseX, baseY, matrix);
					if (!cells || cells.length === 0) continue;
					if (!GameRules.validatePlacement(zoneName, zoneData, cells, perkFlags)) continue;

					// Score plaatsing: prioriteer cellen met flags
					let score = 0;
					let hasFlaggedCell = false;
					for (const c of cells) {
						const cell = GameRules.getDataCell(zoneData, c.x, c.y);
						if (cell?.flags?.includes('gold')) { score += 5; hasFlaggedCell = true; }
						else if (cell?.flags?.includes('bonus')) { score += 4; hasFlaggedCell = true; }
						else if (cell?.flags?.includes('pearl')) { score += 3; hasFlaggedCell = true; }
						else if (cell?.flags?.includes('end')) { score += 3; hasFlaggedCell = true; }
						else if (cell?.flags?.includes('bold')) { score += 2; hasFlaggedCell = true; }
						else { score += 1; }
					}
					// Penalize pure empty placements that give no rewards
					if (!hasFlaggedCell) score = Math.max(1, Math.floor(score * 0.4));

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
				for (const c of cells) {
					const cell = GameRules.getDataCell(zoneData, c.x, c.y);
					if (cell?.flags?.includes('gold')) score += 3;
					if (cell?.flags?.includes('bonus')) score += 2;
					if (cell?.flags?.includes('bold')) score += 1;
				}

				result.push({ zoneName, baseX, baseY, rotation, subgridId, score, bonusColor });
			}
		}
	}
}

/**
 * AI kiest een startdeck type.
 */
function chooseStartingDeck() {
	const types = GameRules.STARTING_DECK_TYPES;
	return types[Math.floor(Math.random() * types.length)];
}

/**
 * AI kiest een objective (index 0-2).
 * Kiest de objective met de meeste reward punten.
 */
function chooseObjective(choices) {
	if (!choices || choices.length === 0) return 0;

	let bestIdx = 0;
	let bestScore = -Infinity;
	for (let i = 0; i < choices.length; i++) {
		const obj = choices[i];
		const points = obj.points || 0;
		const coins = obj.coins || 0;
		const bonuses = obj.randomBonuses || 0;
		const score = points + coins * 2 + bonuses * 3;
		if (score > bestScore) {
			bestScore = score;
			bestIdx = i;
		}
	}
	return bestIdx;
}

/**
 * AI kiest een perk.
 */
function choosePerk(gameState, playerId) {
	const player = gameState.players[playerId];
	if (!player?.perks || (player.perks.perkPoints || 0) < 1) return null;

	const available = GameRules.getAvailablePerks(player);
	if (!available || available.length === 0) return null;

	// Prioriteer nuttige perks
	const perkPriority = [
		'bonus_extra_cell', 'bonus_multi_double', 'bonus_red_upgrade',
		'flex_double_coins', 'flex_wildcard',
		'agg_mine', 'agg_timebomb', 'agg_steal'
	];

	for (const pId of perkPriority) {
		const match = available.find(p => p.id === pId);
		if (match) return match.id;
	}

	// Fallback: pak eerste beschikbare
	return available[0]?.id || null;
}

/**
 * AI speelt een volledige beurt: kaart + bonussen + endTurn.
 * Geeft een reeks acties terug die de server moet uitvoeren.
 */
function planTurn(gameState, playerId) {
	const player = gameState.players[playerId];
	if (!player) return [];

	const actions = [];

	// 1. Probeer een reguliere kaart te spelen
	const hand = player.hand || [];
	const regularCards = hand.filter(c => !c.isGolden);
	const goldenCards = hand.filter(c => c.isGolden);

	// Probeer eerst een reguliere kaart
	let cardPlayed = false;
	for (const card of regularCards) {
		const placements = findValidPlacements(gameState, playerId, card);
		if (placements.length === 0) continue;

		// Kies de beste plaatsing
		placements.sort((a, b) => b.score - a.score);
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
		cardPlayed = true;
		break;
	}

	// 2. Probeer gouden kaarten als extra
	for (const card of goldenCards) {
		const placements = findValidPlacements(gameState, playerId, card);
		if (placements.length === 0) continue;
		placements.sort((a, b) => b.score - a.score);
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

	// 3. Perk kiezen als perkPoints beschikbaar (during playing phase too)
	const perkId = choosePerk(gameState, playerId);
	if (perkId) {
		actions.push({ type: 'choosePerk', perkId });
	}

	// 4. Bonussen spelen
	const bonusColors = ['yellow', 'red', 'green', 'purple', 'blue', 'any'];
	for (const color of bonusColors) {
		const charges = player.bonusInventory?.[color] || 0;
		for (let i = 0; i < charges; i++) {
			actions.push({ type: 'playBonus', bonusColor: color });
		}
	}

	// 5. Einde beurt
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
 */
function planShop(gameState, playerId) {
	const player = gameState.players[playerId];
	if (!player) return [];

	const actions = [];
	const coins = player.goldCoins || 0;

	if (coins <= 0) return [{ type: 'shopReady' }];

	// Koop beschikbare shop items (goedkoopste eerst)
	const shopItems = GameRules.getShopItems(gameState.level || 1, player);
	const affordableItems = shopItems.filter(item => item.cost <= coins && !item.unlockOnly);
	affordableItems.sort((a, b) => a.cost - b.cost);

	let remainingCoins = coins;
	for (const item of affordableItems) {
		if (item.cost > remainingCoins) continue;
		const extra = {};
		if (item.id === 'extra-bonus') {
			// Kies de kleur met de minste bonussen
			const inv = player.bonusInventory || {};
			const colors = ['yellow', 'red', 'green', 'purple', 'blue'];
			colors.sort((a, b) => (inv[a] || 0) - (inv[b] || 0));
			extra.bonusColor = colors[0];
		}
		actions.push({ type: 'buyShopItem', itemId: item.id, extra });
		remainingCoins -= item.cost;
	}

	// Koop eventueel shop card offerings
	const offerings = player.shopOfferings || [];
	for (let i = 0; i < offerings.length; i++) {
		const card = offerings[i];
		if (!card) continue;
		const price = card.shopPrice || GameRules.getCardPrice(card);
		if (price <= remainingCoins) {
			actions.push({ type: 'buyShopItem', itemId: `shop-card-${i}` });
			remainingCoins -= price;
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

const HARD_THINK_DELAY_MIN_MS = 3000;
const HARD_THINK_DELAY_MAX_MS = 5000;

function getHardAIThinkDelay() {
	return HARD_THINK_DELAY_MIN_MS + Math.floor(Math.random() * (HARD_THINK_DELAY_MAX_MS - HARD_THINK_DELAY_MIN_MS));
}

/**
 * Evaluates the actual scoring impact of a placement by simulating it.
 * Returns a composite score considering zone scoring, objective progress, and board position.
 */
function _evaluatePlacementImpact(gameState, playerId, card, placement) {
	const player = gameState.players[playerId];
	if (!player) return placement.score;

	let impactScore = placement.score; // Start from base cell-flag score

	const board = gameState.boardState;
	const zoneName = placement.zoneName;

	// ── Zone-specific strategic bonuses ──
	if (zoneName === 'yellow') {
		// Yellow scores by completing column pairs — check if this placement fills column cells
		const zoneData = board?.zones?.yellow;
		if (zoneData) {
			const cells = _getPlacementCells(card, placement, zoneData);
			const columnsFilled = new Set(cells.map(c => c.x));
			for (const colX of columnsFilled) {
				const colCells = _countColumnCells(zoneData, colX);
				// Bonus for nearly-complete columns (completing them is very valuable)
				if (colCells.filled >= colCells.total - cells.filter(c => c.x === colX).length) {
					impactScore += 8; // Big bonus for completing a column
				} else if (colCells.ratio > 0.6) {
					impactScore += 3; // Bonus for progressing a half-filled column
				}
			}
		}
	} else if (zoneName === 'green') {
		// Green scores by distance to end cells — favor placements closer to end
		const zoneData = board?.zones?.green;
		if (zoneData) {
			const cells = _getPlacementCells(card, placement, zoneData);
			for (const c of cells) {
				const cell = GameRules.getDataCell(zoneData, c.x, c.y);
				if (cell?.flags?.includes('end')) {
					impactScore += 12; // Huge bonus for reaching end cells
				}
				// Bonus for advancing towards end cells
				const endCells = zoneData.endCells || [];
				for (const ec of endCells) {
					const dist = Math.abs(c.x - ec.x) + Math.abs(c.y - ec.y);
					if (dist <= 2) impactScore += 4;
					else if (dist <= 4) impactScore += 1;
				}
			}
		}
	} else if (zoneName === 'blue') {
		// Blue scores by bold row tiers — only first cell on an unreached bold row unlocks tier points
		// Higher rows (lower Y) = higher tiers = more points (10,15,20,25,40)
		const zoneData = board?.zones?.blue;
		if (zoneData) {
			const cells = _getPlacementCells(card, placement, zoneData);
			const boldRowSet = new Set(zoneData.boldRows || []);
			// Find which bold rows already have an active cell
			const reachedBoldRows = _getReachedBoldRows(zoneData);
			// Sort bold rows bottom-to-top (tier 0 = bottom = highest Y)
			const sortedBoldYs = [...new Set(zoneData.boldRows || [])].sort((a, b) => b - a);
			const newTiersUnlocked = new Set();
			for (const c of cells) {
				if (boldRowSet.has(c.y) && !reachedBoldRows.has(c.y)) {
					newTiersUnlocked.add(c.y);
				}
			}
			// Big bonus for each NEW tier unlocked
			for (const boldY of newTiersUnlocked) {
				const tierIdx = sortedBoldYs.indexOf(boldY);
				const tierPoints = [10, 15, 20, 25, 40];
				impactScore += tierPoints[Math.min(tierIdx, tierPoints.length - 1)] || 10;
			}
			// Favor placements that advance upward (lower Y = higher position)
			const minY = Math.min(...cells.map(c => c.y));
			impactScore += Math.max(0, Math.floor(((zoneData.rows || 20) - minY) / 3));
		}
	} else if (zoneName === 'red') {
		// Red scores by subgrid completion (80%+ threshold) — favor nearly-complete subgrids
		const redZone = board?.zones?.red;
		if (redZone?.subgrids && placement.subgridId) {
			const sg = redZone.subgrids.find(s => s.id === placement.subgridId);
			if (sg) {
				const info = _getSubgridFillInfo(sg);
				const cellsPlaced = placement.cellCount || 1;
				const newRatio = (info.filled + cellsPlaced) / info.total;
				if (newRatio >= 0.8 && info.ratio < 0.8) {
					impactScore += 15; // Huge bonus for crossing the 80% threshold
				} else if (newRatio >= 1.0) {
					impactScore += 10; // Full subgrid completion
				} else if (info.ratio >= 0.5) {
					impactScore += 4; // Working on a half-filled subgrid
				}
			}
		}
	} else if (zoneName === 'purple') {
		// Purple scores by connection clusters — favor extending existing clusters
		const zoneData = board?.zones?.purple;
		if (zoneData) {
			const cells = _getPlacementCells(card, placement, zoneData);
			let adjacentActive = 0;
			for (const c of cells) {
				if (GameRules.hasAdjacentActive(zoneData, c.x, c.y)) adjacentActive++;
				const cell = GameRules.getDataCell(zoneData, c.x, c.y);
				if (cell?.flags?.includes('bold')) impactScore += 3;
			}
			impactScore += adjacentActive * 2; // Bonus for connecting to existing placed cells
		}
	}

	// ── Objective awareness ──
	const objective = player.chosenObjective;
	if (objective && !player.objectiveAchieved) {
		// Boost score for placements in zones matching objective
		if (objective.zone && objective.zone === zoneName) {
			impactScore += 5;
		}
		// Density objective: more cells = better
		if (objective.type === 'density') {
			impactScore += (placement.cellCount || 1) * 2;
		}
		// Coverage objectives: value zone-matching placements higher
		if (objective.type === 'coverage' && objective.zones?.includes(zoneName)) {
			impactScore += 4;
		}
	}

	// ── Opponent blocking (check if opponents are strong in this zone) ──
	const opponents = Object.keys(gameState.players).filter(pid => pid !== playerId);
	for (const oppId of opponents) {
		const opp = gameState.players[oppId];
		// If opponent has an objective targeting this zone, slightly boost priority
		if (opp?.chosenObjective?.zone === zoneName) {
			impactScore += 2; // Blocking value
		}
	}

	// ── Adjacency quality bonus ──
	const zoneData = _getZoneData(board, zoneName, placement.subgridId);
	if (zoneData) {
		const cells = _getPlacementCells(card, placement, zoneData);
		let adjacentCount = 0;
		for (const c of cells) {
			if (GameRules.hasAdjacentActive(zoneData, c.x, c.y)) adjacentCount++;
		}
		impactScore += adjacentCount; // Favor placements that extend existing territory
	}

	return impactScore;
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

function _getBlueActiveTiers(zoneData) {
	const boldRows = zoneData.boldRows || [];
	let tiers = 0;
	for (const rowY of boldRows) {
		for (let x = 0; x < (zoneData.cols || 0); x++) {
			const cell = GameRules.getDataCell(zoneData, x, rowY);
			if (cell?.active && cell?.flags?.includes('bold')) {
				tiers++;
				break;
			}
		}
	}
	return tiers;
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

	// 4. Bonuses
	const bonusColors = ['yellow', 'red', 'green', 'purple', 'blue', 'any'];
	for (const color of bonusColors) {
		const charges = player.bonusInventory?.[color] || 0;
		for (let i = 0; i < charges; i++) {
			actions.push({ type: 'playBonus', bonusColor: color });
		}
	}

	// 5. End turn — smart discard (discard lowest-scoring card)
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

	// Hard AI: aggressive first, then flexibility, then bonus
	const perkPriority = [
		'agg_timebomb', 'agg_mine', 'agg_steal',
		'flex_wildcard', 'flex_double_coins',
		'bonus_extra_cell', 'bonus_multi_double', 'bonus_red_upgrade'
	];

	for (const pId of perkPriority) {
		const match = available.find(p => p.id === pId);
		if (match) return match.id;
	}

	return available[0]?.id || null;
}

/**
 * Hard AI shop strategy — smarter purchases.
 */
function planShopHard(gameState, playerId) {
	const player = gameState.players[playerId];
	if (!player) return [];

	const actions = [];
	const coins = player.goldCoins || 0;
	if (coins <= 0) return [{ type: 'shopReady' }];

	const shopItems = GameRules.getShopItems(gameState.level || 1, player);
	const affordableItems = shopItems.filter(item => item.cost <= coins && !item.unlockOnly);

	// Hard AI: prioritize high-value items (most expensive first — they give more advantage)
	affordableItems.sort((a, b) => b.cost - a.cost);

	let remainingCoins = coins;
	for (const item of affordableItems) {
		if (item.cost > remainingCoins) continue;
		const extra = {};
		if (item.id === 'extra-bonus') {
			// Pick the color matching our weakest zone for balance bonus
			const scores = player.scoreBreakdown || {};
			const colors = ['yellow', 'red', 'green', 'purple', 'blue'];
			colors.sort((a, b) => (scores[a] || 0) - (scores[b] || 0));
			extra.bonusColor = colors[0];
		}
		actions.push({ type: 'buyShopItem', itemId: item.id, extra });
		remainingCoins -= item.cost;
	}

	// Shop card offerings — buy cards with most cells (bigger shapes = better)
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
	HARD_THINK_DELAY_MIN_MS,
	HARD_THINK_DELAY_MAX_MS,
	getAIThinkDelay,
	getHardAIThinkDelay,
	pickAITaunt,
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
