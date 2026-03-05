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
const AI_THINK_DELAY_MS = 800; // Simuleer "denktijd"

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

					// Beoordeel de plaatsing
					let score = cells.length; // Basis: meer cellen = beter
					// Bonus voor goud/bonus symbolen
					for (const c of cells) {
						const cell = GameRules.getDataCell(zoneData, c.x, c.y);
						if (cell?.flags?.includes('gold')) score += 3;
						if (cell?.flags?.includes('bonus')) score += 2;
						if (cell?.flags?.includes('pearl')) score += 2;
						if (cell?.flags?.includes('bold')) score += 1;
						if (cell?.flags?.includes('end')) score += 2;
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

	// 3. Bonussen spelen
	const bonusColors = ['yellow', 'red', 'green', 'purple', 'blue', 'any'];
	for (const color of bonusColors) {
		const charges = player.bonusInventory?.[color] || 0;
		for (let i = 0; i < charges; i++) {
			actions.push({ type: 'playBonus', bonusColor: color });
		}
	}

	// 4. Einde beurt
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

module.exports = {
	AI_NAMES,
	AI_THINK_DELAY_MS,
	findValidPlacements,
	findValidBonusPlacements,
	chooseStartingDeck,
	chooseObjective,
	choosePerk,
	planTurn,
	planShop
};
