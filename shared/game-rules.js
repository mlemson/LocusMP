/**
 * ============================================================
 * LOCUS MULTIPLAYER — Shared Game Rules (v2)
 * ============================================================
 * Pure game logic dat zowel op server als client draait.
 * GEEN DOM, GEEN externe imports.
 *
 * Gebaseerd op de scoring, zones, en regels uit index.html.
 *
 * Exporteert:
 *   - Board generatie (data-only)
 *   - Shape / card definities
 *   - Placement validatie
 *   - Score berekening (correct per zone)
 *   - Bonus systeem (symbolen, balance bonus)
 *   - Objective generatie
 *   - Turn flow helpers
 * ============================================================
 */

// ──────────────────────────────────────────────
//  SHAPES (exact overgenomen uit index.html)
// ──────────────────────────────────────────────

const BASE_SHAPES = {
	mini: [
		{ name: 'Domino', matrix: [[1],[1]], weight: 1 },
		{ name: 'Tri-bar', matrix: [[1],[1],[1]], weight: 1 },
		{ name: 'Mini L', matrix: [[1,0],[1,1]], weight: 1 }
	],
	standard: [
		{ name: 'I', matrix: [[1],[1],[1],[1]], weight: 1 },
		{ name: 'O', matrix: [[1,1],[1,1]], weight: 1 },
		{ name: 'T', matrix: [[1,0],[1,1],[1,0]], weight: 1 },
		{ name: 'L', matrix: [[1,0],[1,0],[1,1]], weight: 1 },
		{ name: 'S', matrix: [[0,1],[1,1],[1,0]], weight: 1 }
	],
	large: [
		{ name: 'Plus', matrix: [[0,1,0],[1,1,1],[0,1,0]], weight: 0.5 },
		{ name: 'U vorm', matrix: [[1,0,1],[1,1,1]], weight: 1 },
		{ name: 'L groot', matrix: [[1,0],[1,0],[1,0],[1,1]], weight: 0.5 },
		{ name: 'Kolom-L', matrix: [[1,0,0],[1,0,0],[1,1,1]], weight: 1 },
		{ name: 'T groot', matrix: [[1,1,1],[0,1,0],[0,1,1]], weight: 1 },
		{ name: 'Trap', matrix: [[1,0,0],[1,1,0],[0,1,1]], weight: 1 },
		{ name: 'Hoefijzer', matrix: [[1,1,0],[1,0,0],[1,1,0]], weight: 1 },
		{ name: 'Pijl', matrix: [[0,0,1],[1,1,1],[0,1,0]], weight: 1 },
		{ name: 'Lang 5', matrix: [[1],[1],[1],[1],[1]], weight: 1 },
		{ name: 'Z dubbel', matrix: [[0,1],[1,0],[1,1]], weight: 0.5 },
		{ name: 'Hoekspiegel', matrix: [[1,0,0],[1,1,1],[0,0,1]], weight: 1 }
	],
	xl6: [
		{ name: 'XL (6) - 2x3', matrix: [[1,1,1],[1,1,1]], weight: 1 },
		{ name: 'XL (6) - Lang 6', matrix: [[1],[1],[1],[1],[1],[1]], weight: 0.5 }
	]
};

const SHAPE_CATEGORY_WEIGHTS = {
	mini: 0.35,
	standard: 1,
	large: 0.35
};

const COLORS = [
	{ name: 'rood',   code: '#b56069', zone: 'red'    },
	{ name: 'groen',  code: '#92c28c', zone: 'green'  },
	{ name: 'blauw',  code: '#5689b0', zone: 'blue'   },
	{ name: 'geel',   code: '#cfba51', zone: 'yellow' },
	{ name: 'paars',  code: '#8f76b8', zone: 'purple' },
	{ name: 'multikleur', code: 'rainbow', zone: 'any' }
];

const GOLDEN_COLOR = { name: 'gouden', code: '#f5d76e', isGolden: true, zone: 'any' };
const STARTING_DECK_TYPES = ['adventurer', 'spread', 'random'];

// Zone achtergrond kleuren
const ZONE_THEMES = {
	yellow: { bg: '#2a2820', border: '#cfba51', label: 'Geel' },
	green:  { bg: '#1f2820', border: '#92c28c', label: 'Groen' },
	blue:   { bg: '#1f2530', border: '#5689b0', label: 'Blauw' },
	red:    { bg: '#2a1f20', border: '#b56069', label: 'Rood' },
	purple: { bg: '#251f30', border: '#8f76b8', label: 'Paars' }
};

// ──────────────────────────────────────────────
//  BONUS SHAPES (kleine extra plaatsingen)
// ──────────────────────────────────────────────

const BONUS_SHAPES = {
	default: [[1],[1]],   // Domino (2 cells)
	red: [[1],[1]],       // Domino (2 cells) voor rood
	any: [[1]]            // Multikleur bonus is 1x1 en overal plaatsbaar
};

// ──────────────────────────────────────────────
//  PERK SYSTEEM
// ──────────────────────────────────────────────

const PERK_BRANCHES = {
	bonus: {
		id: 'bonus',
		name: 'Meesterschappen',
		icon: '⚡',
		description: 'Verbeter je bonussen per kleur',
		sequential: false,
		perks: [
			{ id: 'bonus_yellow', name: 'Gele Meesterschap', icon: '🟡', description: 'Upgrade gele bonus naar 3 cellen (1 optioneel)', cost: 1, color: 'yellow', tier: 1 },
			{ id: 'bonus_red', name: 'Rode Meesterschap', icon: '🔴', description: 'Upgrade rode bonus naar 3 cellen (1 optioneel)', cost: 1, color: 'red', tier: 1 },
			{ id: 'bonus_green', name: 'Groene Meesterschap', icon: '🟢', description: 'Upgrade groene bonus naar 3 cellen (1 optioneel)', cost: 1, color: 'green', tier: 1 },
			{ id: 'bonus_purple', name: 'Paarse Meesterschap', icon: '🟣', description: 'Upgrade paarse bonus naar 3 cellen (1 optioneel)', cost: 1, color: 'purple', tier: 1 },
			{ id: 'bonus_blue', name: 'Blauwe Meesterschap', icon: '🔵', description: 'Upgrade blauwe bonus naar 3 cellen (1 optioneel)', cost: 1, color: 'blue', tier: 1 },
			{ id: 'bonus_multi_double', name: 'Dubbele Multikleur', icon: '🌈', description: 'Multikleur bonus geeft 2 charges i.p.v. 1', cost: 1, tier: 2,
				requiresAnyCount: { from: ['bonus_yellow','bonus_red','bonus_green','bonus_purple','bonus_blue'], min: 2 } }
		]
	},
	aggressive: {
		id: 'aggressive',
		name: 'Saboteur',
		icon: '💣',
		description: 'Hindernissen en sabotage',
		sequential: false,
		perks: [
			{ id: 'agg_stone', name: 'Steenblok', icon: '🧱', description: 'Krijg direct een 2×1 steenblok', cost: 1, tier: 1 },
			{ id: 'agg_mine', name: 'Onzichtbare Mijn', icon: '💥', description: 'Plaats 1× per ronde een onzichtbare mijn op het bord', cost: 1, tier: 1 },
			{ id: 'agg_steal', name: 'Kaartendief', icon: '🃏', description: 'Steel 1× per ronde tijdelijk een kaart van een tegenstander', cost: 1, tier: 2,
				requiresAnyOf: ['agg_stone', 'agg_mine'] }
		]
	},
	flexible: {
		id: 'flexible',
		name: 'Strateeg',
		icon: '🧩',
		description: 'Flexibeler plaatsen en meer waarde',
		sequential: false,
		perks: [
			{ id: 'flex_gap', name: 'Brugbouwer', icon: '🌉', description: 'Groen: 1 cel van je kaart wordt optioneel (transparant) — mag overgeslagen worden', cost: 1, tier: 1 },
			{ id: 'flex_rotate', name: 'Verbinder', icon: '🔄', description: 'Paars: voeg 1 extra optionele cel toe aan je kaart (transparant)', cost: 1, tier: 1 },
			{ id: 'flex_gap_red', name: 'Rode Flex', icon: '🔴🌉', description: 'Rood: 1 cel van je kaart wordt optioneel (transparant) — mag overgeslagen worden', cost: 1, tier: 2,
				requiresAnyOf: ['flex_gap', 'flex_rotate'] },
			{ id: 'flex_wildcard', name: 'Wildcardkleur', icon: '🎨', description: 'Eén kaart per ronde op elke zone plaatsen, ongeacht kleur', cost: 1, tier: 2,
				requiresAnyOf: ['flex_gap', 'flex_rotate'] },
			{ id: 'flex_double_coins', name: 'Bankier', icon: '🏦', description: 'Goudmunten zijn dubbel zoveel waard', cost: 1, tier: 2,
				requiresAnyOf: ['flex_gap', 'flex_rotate'] },
			{ id: 'flex_extra_card', name: 'Brede Hand', icon: '🃑', description: 'Je hand bevat 4 kaarten in plaats van 3', cost: 1, tier: 2,
				requiresAnyOf: ['flex_gap', 'flex_rotate'] }
		]
	}
};

/**
 * Geeft de bonus-shape terug met optionele upgrade (3e cel) als perk actief is.
 */
function getBonusShapeForPlayer(bonusColor, player) {
	const isAny = bonusColor === 'any';
	let base;
	if (bonusColor === 'red') {
		base = cloneMatrix(BONUS_SHAPES.red);
	} else if (isAny) {
		base = cloneMatrix(BONUS_SHAPES.any);
	} else {
		base = cloneMatrix(BONUS_SHAPES.default);
	}

	// Check perk upgrade
	if (!isAny && player?.perks?.bonusUpgrades?.[bonusColor]) {
		base.push([2]); // Optionele 3e cel
	}
	// Dubbele Multikleur perk: upgrade any bonus van 1x1 naar 2x1 met optionele cel
	if (isAny && playerHasPerk(player, 'bonus_multi_double')) {
		base.push([2]); // Optionele 2e cel erbij
	}
	return base;
}

/**
 * Check of een speler een bepaalde perk heeft ontgrendeld.
 */
function playerHasPerk(player, perkId) {
	if (!player?.perks?.unlockedPerks) return false;
	return player.perks.unlockedPerks.includes(perkId);
}

/**
 * Verkrijg beschikbare perks voor een speler (die nog niet ontgrendeld zijn en waaraan ze voldoen).
 */
function getAvailablePerks(player) {
	if (!player?.perks) return [];
	const unlocked = player.perks.unlockedPerks || [];
	const available = [];

	for (const [branchId, branch] of Object.entries(PERK_BRANCHES)) {
		for (let i = 0; i < branch.perks.length; i++) {
			const perk = branch.perks[i];
			if (unlocked.includes(perk.id)) continue; // Al ontgrendeld

			// Sequentiële branch: moet vorige perk hebben
			if (branch.sequential && i > 0) {
				const prevPerk = branch.perks[i - 1];
				if (!unlocked.includes(prevPerk.id)) continue;
			}

			// requiresAll: alle genoemde perks moeten ontgrendeld zijn
			if (perk.requiresAll && !perk.requiresAll.every(reqId => unlocked.includes(reqId))) {
				continue;
			}

			// requiresAnyOf: minstens één van de genoemde perks moet ontgrendeld zijn
			if (perk.requiresAnyOf && !perk.requiresAnyOf.some(reqId => unlocked.includes(reqId))) {
				continue;
			}

			// requiresAnyCount: minstens N van de genoemde perks moeten ontgrendeld zijn
			if (perk.requiresAnyCount) {
				const unlockedCount = perk.requiresAnyCount.from.filter(reqId => unlocked.includes(reqId)).length;
				if (unlockedCount < perk.requiresAnyCount.min) continue;
			}

			available.push({ ...perk, branch: branchId, branchName: branch.name, branchIcon: branch.icon });
		}
	}

	return available;
}

/** Apply perk side effects (stone blocks, mines, etc.) after unlocking */
function _applyPerkSideEffects(player, perkId, gameState, playerId) {
	if (perkId === 'agg_stone') {
		player.perks.stoneBlocks = (player.perks.stoneBlocks || 0) + 1;
		const stoneShape = STONE_SHAPES_2[0];
		player.hand.push({
			id: `stone_${playerId}_${Date.now()}`,
			shapeName: stoneShape.name,
			matrix: cloneMatrix(stoneShape.matrix),
			color: { ...STONE_COLOR },
			isStone: true
		});
	}
	if (perkId === 'agg_mine') player.perks.minesPerRound = 1;
	if (perkId === 'agg_steal') player.perks.stealsPerRound = 1;
	if (perkId === 'flex_gap') player.perks.greenGapAllowed = true;
	if (perkId === 'flex_gap_red') player.perks.redGapAllowed = true;
	if (perkId === 'flex_rotate') player.perks.diagonalRotation = true;
	if (perkId === 'flex_wildcard') player.perks.wildcardPerRound = 1;
	if (perkId === 'flex_double_coins') player.perks.doubleCoins = true;
	if (perkId === 'flex_extra_card') {
		player.perks.extraCard = true;
		drawHandForPlayer(gameState, player, 4);
	}
}

/**
 * Ontgrendel een perk voor een speler.
 */
function choosePerk(gameState, playerId, perkId) {
	const isGoalPhase = gameState.phase === 'choosingGoals';
	const isLevelComplete = gameState.phase === 'levelComplete';
	const rewardingMode = !!gameState.settings?.rewardingMode;
	if (!isGoalPhase && !(isLevelComplete && rewardingMode)) {
		return { error: 'Perks kunnen alleen tijdens de doelstellingsfase gekozen worden' };
	}
	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };
	if (!player.perks) return { error: 'Perk data niet geïnitialiseerd' };
	
	if (perkId === '__skip__') {
		if (isGoalPhase) {
			player.goalPerksDone = true;
			gameState.updatedAt = Date.now();
			const startedPlaying = maybeStartPlayingAfterGoalPhase(gameState);
			return { success: true, skipped: true, startedPlaying };
		}
		return { success: true, skipped: true };
	}

	const perkPoints = player.perks.perkPoints || 0;
	const available = getAvailablePerks(player);
	const perk = available.find(p => p.id === perkId);
	if (!perk) return { error: 'Perk niet beschikbaar of al ontgrendeld' };
	if (perkPoints < perk.cost) return { error: `Niet genoeg perkpunten (nodig: ${perk.cost}, beschikbaar: ${perkPoints})` };

	// Aftrekken en ontgrendelen
	player.perks.perkPoints -= perk.cost;
	player.perks.unlockedPerks.push(perkId);

	// Bonus upgrade: markeer kleur als geüpgrade
	if (perk.color) {
		player.perks.bonusUpgrades[perk.color] = true;
	}

	// Apply side effects
	_applyPerkSideEffects(player, perkId, gameState, playerId);

	gameState.updatedAt = Date.now();
	if (isGoalPhase) {
		player.goalPerksDone = isGoalPerkDone(gameState, playerId);
		const startedPlaying = maybeStartPlayingAfterGoalPhase(gameState);
		return { success: true, perk: { id: perkId, name: perk.name, icon: perk.icon, cost: perk.cost }, startedPlaying };
	}
	return { success: true, perk: { id: perkId, name: perk.name, icon: perk.icon, cost: perk.cost } };
}

function allObjectivesChosen(gameState) {
	return (gameState.playerOrder || []).every(pid => {
		if (gameState.players[pid]?.connected === false) return true;
		return gameState.players[pid]?.chosenObjective != null;
	});
}

function isGoalPerkDone(gameState, playerId) {
	const player = gameState.players?.[playerId];
	if (!player || player.connected === false) return true;
	if (!player.chosenObjective) return false;
	if (player.goalPerksDone) return true;
	if (!player.perks || (player.perks.perkPoints || 0) < 1) return true;
	const available = getAvailablePerks(player);
	return !Array.isArray(available) || available.length === 0;
}

function hasPendingGoalPerks(gameState) {
	for (const pid of (gameState.playerOrder || [])) {
		if (!isGoalPerkDone(gameState, pid)) return true;
	}
	return false;
}

function maybeStartPlayingAfterGoalPhase(gameState) {
	if (gameState.phase !== 'choosingGoals') return false;
	if (!allObjectivesChosen(gameState)) return false;
	if (hasPendingGoalPerks(gameState)) return false;
	for (const pid of gameState.playerOrder) {
		drawHand(gameState, pid);
	}
	gameState.phase = 'playing';
	gameState.currentTurnIndex = 0;
	gameState.turnCount = 1;
	for (const pid of gameState.playerOrder) {
		if (gameState.players?.[pid]) gameState.players[pid].goalPerksDone = false;
	}
	delete gameState._roundFiveBonusBurstDone;
	gameState._turnTimerStart = Date.now();
	return true;
}

// ──────────────────────────────────────────────
//  STONE SHAPES (blokkerende vormen — 2, 3 of 4 cellen)
// ──────────────────────────────────────────────

const STONE_SHAPES_2 = [
	{ name: 'Steen H', matrix: [[1, 1]] },        // Horizontaal
	{ name: 'Steen V', matrix: [[1], [1]] },       // Verticaal
	{ name: 'Steen D', matrix: [[1, 0], [0, 1]] }, // Diagonaal ↘
	{ name: 'Steen D2', matrix: [[0, 1], [1, 0]] } // Diagonaal ↙
];

const STONE_SHAPES_3 = [
	{ name: 'Steen I3', matrix: [[1], [1], [1]] },                // Verticaal 3
	{ name: 'Steen H3', matrix: [[1, 1, 1]] },                    // Horizontaal 3
	{ name: 'Steen S3',  matrix: [[0, 1], [1, 1]] },              // S-stap (3 cellen)
	{ name: 'Steen Z3',  matrix: [[1, 0], [1, 1]] },              // Z-stap (3 cellen)
	{ name: 'Steen V3',  matrix: [[1, 1], [1, 0]] },              // Hoek linksboven (3 cellen)
	{ name: 'Steen V3b', matrix: [[1, 1], [0, 1]] },              // Hoek rechtsboven (3 cellen)
];

const STONE_SHAPES_4 = [
	{ name: 'Steen T',  matrix: [[1, 1, 1], [0, 1, 0]] },        // T-vorm (4 cellen)
	{ name: 'Steen O',  matrix: [[1, 1], [1, 1]] },               // Vierkant blok (4 cellen)
	{ name: 'Steen S4', matrix: [[0, 1, 1], [1, 1, 0]] },        // S groot (4 cellen)
	{ name: 'Steen Z4', matrix: [[1, 1, 0], [0, 1, 1]] },        // Z groot (4 cellen)
	{ name: 'Steen I4', matrix: [[1], [1], [1], [1]] },           // Verticale lijn (4 cellen)
	{ name: 'Steen L4', matrix: [[1, 0], [1, 0], [1, 1]] },      // L-vorm (4 cellen)
	{ name: 'Steen J4', matrix: [[0, 1], [0, 1], [1, 1]] },      // J-vorm (4 cellen)
];

// Weighted stone shape picker: mostly 2-cell, sometimes 3-cell, rarely 4-cell
function getRandomStoneShape(rng) {
	const roll = rng();
	if (roll < 0.05) {
		// 5% kans op 4-cel steen (zeer zeldzaam)
		return STONE_SHAPES_4[Math.floor(rng() * STONE_SHAPES_4.length)];
	} else if (roll < 0.30) {
		// 25% kans op 3-cel steen
		return STONE_SHAPES_3[Math.floor(rng() * STONE_SHAPES_3.length)];
	} else {
		// 70% kans op 2-cel steen (standaard)
		return STONE_SHAPES_2[Math.floor(rng() * STONE_SHAPES_2.length)];
	}
}

// All shapes combined for shop offering
const STONE_SHAPES = [...STONE_SHAPES_2, ...STONE_SHAPES_3, ...STONE_SHAPES_4];

const STONE_COLOR = { name: 'steen', code: '#8a8a8a', isStone: true };

// ──────────────────────────────────────────────
//  RANDOM HELPERS (seeded PRNG)
// ──────────────────────────────────────────────

function createRNG(seed) {
	let s = seed | 0;
	return function() {
		s = (s + 0x6D2B79F5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function hashStringToInt(value) {
	const str = String(value || '');
	let hash = 2166136261;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash | 0;
}

function shuffleWithRNG(arr, rng) {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

// ──────────────────────────────────────────────
//  SHAPE TRANSFORMS
// ──────────────────────────────────────────────

function cloneMatrix(matrix) {
	return matrix.map(row => [...row]);
}

function rotateMatrix90(matrix) {
	const rows = matrix.length;
	const cols = matrix[0].length;
	const rotated = [];
	for (let c = 0; c < cols; c++) {
		const newRow = [];
		for (let r = rows - 1; r >= 0; r--) {
			newRow.push(matrix[r][c]);
		}
		rotated.push(newRow);
	}
	return rotated;
}

function mirrorMatrix(matrix) {
	return matrix.map(row => [...row].reverse());
}

function rotateMatrixN(matrix, times) {
	let result = cloneMatrix(matrix);
	for (let i = 0; i < (times % 4); i++) {
		result = rotateMatrix90(result);
	}
	return result;
}

// ──────────────────────────────────────────────
//  BOARD DATA STRUCTURE (pure data, no DOM)
// ──────────────────────────────────────────────

/**
 * Cel structuur:
 * {
 *   x, y,
 *   active: false,
 *   color: null | { name, code },
 *   playerId: null | string,
 *   flags: ['bold', 'end', 'portal', 'gold', 'bonus-yellow', ...]
 *   bonusSymbol: null | 'yellow' | 'red' | 'green' | 'purple' | 'blue' | 'any'
 * }
 */

function createZoneGrid(rows, cols, options = {}) {
	const cells = {};
	const voidSet = new Set((options.voidCells || []).map(c => `${c.x},${c.y}`));
	const boldSet = new Set((options.boldCells || []).map(c => `${c.x},${c.y}`));
	const endSet = new Set((options.endCells || []).map(c => `${c.x},${c.y}`));
	const portalSet = new Set((options.portalCells || []).map(c => `${c.x},${c.y}`));
	const goldSet = new Set((options.goldCells || []).map(c => `${c.x},${c.y}`));

	for (let y = 0; y < rows; y++) {
		for (let x = 0; x < cols; x++) {
			const key = `${x},${y}`;
			if (voidSet.has(key)) continue;
			const flags = [];
			if (boldSet.has(key)) flags.push('bold');
			if (endSet.has(key)) flags.push('end');
			if (portalSet.has(key)) flags.push('portal');
			if (goldSet.has(key)) flags.push('gold');

			cells[key] = {
				x, y,
				active: false,
				color: null,
				playerId: null,
				flags,
				bonusSymbol: null,
				treasureCoins: 0
			};
		}
	}
	return { rows, cols, cells, startX: options.startX, startY: options.startY };
}

// ──────────────────────────────────────────────
//  BOARD GENERATION
// ──────────────────────────────────────────────

/**
 * Genereer een branch/root grid (zoals groen/rood in index.html).
 * Groeit willekeurige takken vanuit een startpunt.
 * Niet-tak cellen worden void. Eind-cellen = tak-uiteinden (≤1 actieve buur).
 */
function generateBranchGrid(rows, cols, steps, splitChance, rng, options = {}) {
	const cx = options.startX ?? Math.floor(cols / 2);
	const cy = options.startY ?? Math.floor(rows / 2);
	const endMinDistance = Math.max(0, Math.floor(Number(options.endMinDistance) || 0));
	const active = new Set();
	active.add(`${cx},${cy}`);

	const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

	let nextBranchId = 0;
	let tips = dirs.map(d => ({ x: cx, y: cy, dx: d[0], dy: d[1], branchId: nextBranchId++, age: 0 }));

	const cellBranch = new Map();
	cellBranch.set(`${cx},${cy}`, -1);

	let stepCount = 0;
	while (stepCount < steps && tips.length > 0) {
		const tipIdx = stepCount % tips.length;
		const tip = tips[tipIdx];
		stepCount++;

		let dx = tip.dx;
		let dy = tip.dy;
		if (rng() < 0.25) {
			if (dx !== 0) { dx = 0; dy = rng() < 0.5 ? -1 : 1; }
			else { dy = 0; dx = rng() < 0.5 ? -1 : 1; }
		}

		const nx = tip.x + dx;
		const ny = tip.y + dy;

		if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && !active.has(`${nx},${ny}`)) {
			active.add(`${nx},${ny}`);
			cellBranch.set(`${nx},${ny}`, tip.branchId);

			tip.x = nx;
			tip.y = ny;
			tip.dx = dx;
			tip.dy = dy;
			tip.age++;

			if (tip.age >= 3 && rng() < splitChance) {
				let sdx;
				let sdy;
				if (dx !== 0) { sdx = 0; sdy = rng() < 0.5 ? -1 : 1; }
				else { sdy = 0; sdx = rng() < 0.5 ? -1 : 1; }
				tips.push({ x: nx, y: ny, dx: sdx, dy: sdy, branchId: nextBranchId++, age: 0 });
			}
		} else {
			tips.splice(tipIdx, 1);
			if (tips.length > 0) stepCount--;
		}
	}

	const minActiveCells = Math.max(0, Number(options.minActiveCells || 0));
	while (active.size < minActiveCells) {
		const frontier = [];
		for (const key of active) {
			const [x, y] = key.split(',').map(Number);
			for (const [dx, dy] of dirs) {
				const nx = x + dx;
				const ny = y + dy;
				if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
				const nkey = `${nx},${ny}`;
				if (!active.has(nkey)) frontier.push(nkey);
			}
		}
		if (frontier.length === 0) break;
		active.add(frontier[Math.floor(rng() * frontier.length)]);
	}

	// Enforce minimum spread (bounding box) by extending branches outward
	const minSpreadX = Math.max(0, Number(options.minSpreadX || 0));
	const minSpreadY = Math.max(0, Number(options.minSpreadY || 0));
	if (minSpreadX > 0 || minSpreadY > 0) {
		for (let attempt = 0; attempt < 300; attempt++) {
			let minX = cols, maxX = 0, minY = rows, maxY = 0;
			for (const key of active) {
				const [ax, ay] = key.split(',').map(Number);
				if (ax < minX) minX = ax;
				if (ax > maxX) maxX = ax;
				if (ay < minY) minY = ay;
				if (ay > maxY) maxY = ay;
			}
			const spreadX = maxX - minX;
			const spreadY = maxY - minY;
			if (spreadX >= minSpreadX && spreadY >= minSpreadY) break;
			// Add cells at frontier in the direction needing expansion
			const frontier = [];
			for (const key of active) {
				const [ax, ay] = key.split(',').map(Number);
				for (const [dx, dy] of dirs) {
					const nx = ax + dx, ny = ay + dy;
					if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) continue;
					const nkey = `${nx},${ny}`;
					if (active.has(nkey)) continue;
					// Prefer expanding in the direction that's too narrow
					if (spreadX < minSpreadX && (dx !== 0)) frontier.push(nkey);
					else if (spreadY < minSpreadY && (dy !== 0)) frontier.push(nkey);
					else frontier.push(nkey);
				}
			}
			if (frontier.length === 0) break;
			active.add(frontier[Math.floor(rng() * frontier.length)]);
		}
	}

	const cells = {};
	for (const key of active) {
		const [x, y] = key.split(',').map(Number);
		const flags = [];
		if (x === cx && y === cy) flags.push('bold');
		cells[key] = {
			x, y,
			active: false,
			color: null,
			playerId: null,
			flags,
			bonusSymbol: null
		};
	}

	const rawEndKeys = [];
	for (const key of active) {
		const [x, y] = key.split(',').map(Number);
		if (x === cx && y === cy) continue;
		let neighborCount = 0;
		for (const [dx, dy] of dirs) {
			if (active.has(`${x + dx},${y + dy}`)) neighborCount++;
		}
		if (neighborCount <= 1) rawEndKeys.push(key);
	}

	const endKeySet = new Set(rawEndKeys);
	const visited = new Set();
	const endCells = [];
	const usedEndBranches = new Set();
	const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
	const canUseEndPos = (candidate) => {
		if (endMinDistance <= 0) return true;
		for (const ex of endCells) {
			if (manhattan(candidate, ex) < endMinDistance) return false;
		}
		return true;
	};

	for (const startKey of rawEndKeys) {
		if (visited.has(startKey)) continue;
		const cluster = [];
		const queue = [startKey];
		visited.add(startKey);
		while (queue.length > 0) {
			const k = queue.shift();
			cluster.push(k);
			const [kx, ky] = k.split(',').map(Number);
			for (const [dx, dy] of dirs) {
				const nk = `${kx + dx},${ky + dy}`;
				if (endKeySet.has(nk) && !visited.has(nk)) {
					visited.add(nk);
					queue.push(nk);
				}
			}
		}

		const ranked = cluster
			.map(k => {
				const [kx, ky] = k.split(',').map(Number);
				return {
					key: k,
					x: kx,
					y: ky,
					dist: Math.abs(kx - cx) + Math.abs(ky - cy),
					branchId: cellBranch.get(k)
				};
			})
			.sort((a, b) => b.dist - a.dist);

		const picked = ranked.find(c => !usedEndBranches.has(c.branchId) && canUseEndPos(c))
			|| ranked.find(c => canUseEndPos(c))
			|| ranked.find(c => !usedEndBranches.has(c.branchId))
			|| ranked[0];

		if (picked) {
			if (!cells[picked.key].flags.includes('end')) cells[picked.key].flags.push('end');
			endCells.push({ x: picked.x, y: picked.y });
			usedEndBranches.add(picked.branchId);
		}
	}

	const minEndCells = Math.max(0, Number(options.minEndCells || 0));
	if (endCells.length < minEndCells) {
		const existingEnd = new Set(endCells.map(c => `${c.x},${c.y}`));
		const candidates = Object.values(cells)
			.filter(c => !(c.x === cx && c.y === cy) && !existingEnd.has(`${c.x},${c.y}`))
			.sort((a, b) => {
				const da = Math.abs(a.x - cx) + Math.abs(a.y - cy);
				const db = Math.abs(b.x - cx) + Math.abs(b.y - cy);
				return db - da;
			});

		const pickFill = (requireUnusedBranch, requireDistance) => {
			for (const c of candidates) {
				if (endCells.length >= minEndCells) break;
				const key = `${c.x},${c.y}`;
				if (existingEnd.has(key)) continue;
				const branchId = cellBranch.get(key);
				if (requireUnusedBranch && usedEndBranches.has(branchId)) continue;
				if (requireDistance && !canUseEndPos(c)) continue;
				if (!c.flags.includes('end')) c.flags.push('end');
				endCells.push({ x: c.x, y: c.y });
				existingEnd.add(key);
				usedEndBranches.add(branchId);
			}
		};

		pickFill(true, true);
		pickFill(false, true);
		pickFill(true, false);
		pickFill(false, false);
	}

	return { rows, cols, cells, startX: cx, startY: cy, endCells };
}

/**
 * Genereer een subgrid met gaten (voor rood).
 * Groeit vanuit het midden tot targetCount cellen actief zijn.
 */
function generateHoleySubgrid(rows, cols, targetCount, rng) {
	const cx = Math.floor(cols / 2);
	const cy = Math.floor(rows / 2);
	const active = new Set();
	active.add(`${cx},${cy}`);
	const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];

	// Grow from center until we reach targetCount
	while (active.size < targetCount) {
		// Find frontier: cells not active but adjacent to active
		const frontier = [];
		for (const key of active) {
			const [x, y] = key.split(',').map(Number);
			for (const [dx, dy] of dirs) {
				const nx = x + dx, ny = y + dy;
				const nk = `${nx},${ny}`;
				if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && !active.has(nk)) {
					frontier.push(nk);
				}
			}
		}
		if (frontier.length === 0) break;
		// Pick random frontier cell
		const pick = frontier[Math.floor(rng() * frontier.length)];
		active.add(pick);
	}

	// Build cells dict – non-active are void (holes)
	const cells = {};
	for (const key of active) {
		const [x, y] = key.split(',').map(Number);
		cells[key] = {
			x, y,
			active: false,
			color: null,
			playerId: null,
			flags: [],
			bonusSymbol: null
		};
	}

	return { rows, cols, cells };
}

/**
 * Genereer een multiplayer bord.
 * Zones gebaseerd op de originele index.html grids.
 * Level 1-3 = World 1 (klein), Level 4-7 = World 2 (medium), Level 8-10 = World 3 (groot)
 */
function generateLevel1Board(rng, level, playerCount, maxWins) {
	const lvl = level || 1;
	const pc = Math.max(2, Math.min(8, playerCount || 4));
	// playerTier: 0 (2p), 1 (3-4p), 2 (5-6p), 3 (7-8p)
	const playerTier = Math.floor((pc - 1) / 2);
	// Bepaal wereld op basis van maxWins (hoeveel wins de leider heeft)
	const mw = maxWins || 0;
	let world = 1;
	if (mw >= 3) world = 3;
	else if (mw >= 2) world = 2;

	const zones = {};

	// ══════════════════════════════════════════
	//  YELLOW ZONE — Wereldafhankelijk + spelerafhankelijk
	//  +1 rij per playerTier
	//  Staircase: per kolommenpaar 1 rij langer (links kort, rechts lang)
	// ══════════════════════════════════════════
	function yellowStairVoids(cols, baseRows) {
		const numPairs = Math.ceil(cols / 2);
		const totalRows = baseRows + (numPairs - 1);
		const voids = [];
		for (let pairIdx = 0; pairIdx < numPairs; pairIdx++) {
			const pairHeight = baseRows + pairIdx;
			for (let y = pairHeight; y < totalRows; y++) {
				voids.push({ x: pairIdx * 2, y });
				if (pairIdx * 2 + 1 < cols) {
					voids.push({ x: pairIdx * 2 + 1, y });
				}
			}
		}
		return { totalRows, voids };
	}

	if (world === 1) {
		const yellowCols = 10;
		const yellowBaseRows = 5 + playerTier;
		const { totalRows: yellowRows, voids: stairVoids } = yellowStairVoids(yellowCols, yellowBaseRows);
		const yellowBold = [];
		for (let y = 0; y < yellowBaseRows; y++) {
			yellowBold.push({ x: 0, y });
		}
		const yellowGold = [];
		for (let i = 0; i < 4; i++) {
			yellowGold.push({
				x: 1 + Math.floor(rng() * (yellowCols - 2)),
				y: Math.floor(rng() * yellowRows)
			});
		}
		zones.yellow = createZoneGrid(yellowRows, yellowCols, {
			boldCells: yellowBold,
			goldCells: yellowGold,
			voidCells: stairVoids
		});
		placeGoldFlags(zones.yellow, rng, 5);
		placeBonusSymbols(zones.yellow, rng, 3, { excludeColor: 'yellow' });
	} else if (world === 2) {
		// World 2: vierkant grid met diagonale scoring
		const yellowSize = 11 + playerTier;
		const yellowBold = [];
		// Bold cellen op de 4 hoeken + midden
		yellowBold.push({ x: 0, y: 0 }, { x: yellowSize - 1, y: 0 });
		yellowBold.push({ x: 0, y: yellowSize - 1 }, { x: yellowSize - 1, y: yellowSize - 1 });
		const mid = Math.floor(yellowSize / 2);
		yellowBold.push({ x: mid, y: mid });
		const yellowGold = [];
		for (let i = 0; i < 6; i++) {
			yellowGold.push({
				x: Math.floor(rng() * yellowSize),
				y: Math.floor(rng() * yellowSize)
			});
		}
		zones.yellow = createZoneGrid(yellowSize, yellowSize, {
			boldCells: yellowBold,
			goldCells: yellowGold
		});
		zones.yellow.scoreMode = 'diagonal';
		zones.yellow.minDiagonalLength = 4;
		placeGoldFlags(zones.yellow, rng, 7);
		placeBonusSymbols(zones.yellow, rng, 5, { excludeColor: 'yellow' });
	} else {
		// World 3: ruitvorm (diamond) met ring scoring
		const diamondPattern = [4, 6, 8, 10, 12, 12, 12, 12, 10, 8, 6, 4];
		const diamondOffsets = [4, 3, 2, 1, 0, 0, 0, 0, 1, 2, 3, 4];
		const yellowRows = diamondPattern.length;
		const yellowCols = Math.max(...diamondPattern.map((len, i) => len + diamondOffsets[i]));
		// Maak voids voor niet-diamond cellen
		const diamondVoids = [];
		for (let y = 0; y < yellowRows; y++) {
			const off = diamondOffsets[y];
			const width = diamondPattern[y];
			for (let x = 0; x < yellowCols; x++) {
				if (x < off || x >= off + width) {
					diamondVoids.push({ x, y });
				}
			}
		}
		// Bold cluster in het midden van de ruit
		const yellowBold = [];
		const midY = Math.floor(yellowRows / 2);
		const midX = Math.floor(yellowCols / 2);
		yellowBold.push({ x: midX - 1, y: midY - 1 }, { x: midX, y: midY - 1 });
		yellowBold.push({ x: midX - 1, y: midY }, { x: midX, y: midY });
		const yellowGold = [];
		for (let i = 0; i < 8; i++) {
			const y = Math.floor(rng() * yellowRows);
			const off = diamondOffsets[y];
			const width = diamondPattern[y];
			yellowGold.push({ x: off + Math.floor(rng() * width), y });
		}
		zones.yellow = createZoneGrid(yellowRows, yellowCols, {
			boldCells: yellowBold,
			goldCells: yellowGold,
			voidCells: diamondVoids
		});
		zones.yellow.scoreMode = 'rings';
		zones.yellow.ringMinPoints = 12;
		zones.yellow.ringMaxPoints = 64;
		placeGoldFlags(zones.yellow, rng, 10);
		placeBonusSymbols(zones.yellow, rng, 6, { excludeColor: 'yellow' });
	}

	// ══════════════════════════════════════════
	//  GREEN ZONE — Wereldafhankelijk + spelerafhankelijk
	//  Meer end cells per playerTier
	// ══════════════════════════════════════════
	const greenEndCells = 10 + playerTier * 2;
	if (world === 1) {
		const greenSize = 15 + playerTier;
		const greenCenter = Math.floor(greenSize / 2);
		zones.green = generateBranchGrid(greenSize, greenSize, 100 + playerTier * 12, 0.45, rng, {
			endMinDistance: 3,
			startX: greenCenter, startY: greenCenter, minEndCells: greenEndCells, minActiveCells: 55,
			minSpreadX: 7, minSpreadY: 7
		});
	} else if (world === 2) {
		const greenRows = 20 + playerTier;
		const greenCols = 18 + playerTier;
		const greenCenterX = Math.floor(greenCols / 2);
		const greenCenterY = Math.floor(greenRows / 2);
		zones.green = generateBranchGrid(greenRows, greenCols, 180 + playerTier * 18, 0.35, rng, {
			endMinDistance: 3,
			startX: greenCenterX, startY: greenCenterY, minEndCells: greenEndCells, minActiveCells: 80,
			minSpreadX: 10, minSpreadY: 10
		});
	} else {
		const greenRows = 30 + playerTier;
		const greenCols = 26 + playerTier;
		const greenCenterX = Math.floor(greenCols / 2);
		const greenCenterY = Math.floor(greenRows / 2);
		zones.green = generateBranchGrid(greenRows, greenCols, 320 + playerTier * 28, 0.55, rng, {
			endMinDistance: 3,
			startX: greenCenterX, startY: greenCenterY, minEndCells: greenEndCells, minActiveCells: 160,
			minSpreadX: 15, minSpreadY: 15
		});
	}

	// Gold en bonus in green zone
	const greenGoldCount = world === 1 ? 3 : (world === 2 ? 5 : 7);
	placeGoldFlags(zones.green, rng, greenGoldCount);
	placeBonusSymbols(zones.green, rng, world === 1 ? 2 : (world === 2 ? 4 : 5), { excludeColor: 'green' });

	// ══════════════════════════════════════════
	//  BLUE ZONE — Wereldafhankelijk + spelerafhankelijk
	//  Breedte begint smal, +1 per playerTier
	//  Rivier-achtige vorm met meanderende void cellen
	// ══════════════════════════════════════════
	// Helper: genereer void cellen die een onregelmatig rivier-achtig profiel creëren
	// Voids zitten ALLEEN aan de randen (links of rechts), zodat het grid altijd
	// aaneengesloten (connected) blijft en je het einde kunt bereiken.
	function generateBlueRiverVoids(width, height, rng, boldRows) {
		const voids = [];
		const boldRowSet = new Set(boldRows || []);
		let side = rng() < 0.5 ? 0 : 1; // 0 = links, 1 = rechts
		let streakLeft = 3 + Math.floor(rng() * 5); // rijen voor we wisselen van kant
		for (let y = 0; y < height; y++) {
			// Nooit voids op bold-rijen — die moeten volledig zijn
			if (boldRowSet.has(y)) continue;
			// ~70% kans op een void op niet-bold rijen
			if (rng() < 0.7) {
				const x = side === 0 ? 0 : width - 1;
				voids.push({ x, y });
				// Soms diepere inkeping (2e cel ook void) bij brede grids
				if (width >= 5 && rng() < 0.35) {
					const x2 = side === 0 ? 1 : width - 2;
					voids.push({ x: x2, y });
				}
			}
			streakLeft--;
			if (streakLeft <= 0) {
				side = 1 - side;
				streakLeft = 3 + Math.floor(rng() * 5);
			}
		}
		return voids;
	}

	if (world === 1) {
		const blueWidth = 3 + playerTier;
		const blueHeight = 26; // +5 rijen (was 21)
		const blueBoldRows = [];
		for (let r = 0; r < blueHeight; r += 5) { blueBoldRows.push(r); }
		const blueVoid = generateBlueRiverVoids(blueWidth, blueHeight, rng, blueBoldRows);
		const blueVoidSet = new Set(blueVoid.map(v => `${v.x},${v.y}`));
		const blueBold = [];
		for (const by of blueBoldRows) {
			for (let x = 0; x < blueWidth; x++) {
				if (!blueVoidSet.has(`${x},${by}`)) blueBold.push({ x, y: by });
			}
		}
		const blueGold = [];
		for (let i = 0; i < 2; i++) {
			let gx, gy;
			do { gx = Math.floor(rng() * blueWidth); gy = Math.floor(rng() * blueHeight); }
			while (blueVoidSet.has(`${gx},${gy}`));
			blueGold.push({ x: gx, y: gy });
		}
		zones.blue = createZoneGrid(blueHeight, blueWidth, { boldCells: blueBold, goldCells: blueGold, voidCells: blueVoid });
		zones.blue.boldRows = blueBoldRows;
		placeGoldFlags(zones.blue, rng, 2);
		placeBonusSymbols(zones.blue, rng, 2, { excludeColor: 'blue' });
	} else if (world === 2) {
		const blueWidth = 4 + playerTier;
		const blueHeight = 52; // 2x W1 hoogte
		const blueBoldRows = [];
		for (let r = 0; r < blueHeight; r += 6) { blueBoldRows.push(r); }
		const blueVoid = generateBlueRiverVoids(blueWidth, blueHeight, rng, blueBoldRows);
		const blueVoidSet = new Set(blueVoid.map(v => `${v.x},${v.y}`));
		const blueBold = [];
		for (const by of blueBoldRows) {
			for (let x = 0; x < blueWidth; x++) {
				if (!blueVoidSet.has(`${x},${by}`)) blueBold.push({ x, y: by });
			}
		}
		const blueGold = [];
		for (let i = 0; i < 4; i++) {
			let gx, gy;
			do { gx = Math.floor(rng() * blueWidth); gy = Math.floor(rng() * blueHeight); }
			while (blueVoidSet.has(`${gx},${gy}`));
			blueGold.push({ x: gx, y: gy });
		}
		zones.blue = createZoneGrid(blueHeight, blueWidth, { boldCells: blueBold, goldCells: blueGold, voidCells: blueVoid });
		zones.blue.boldRows = blueBoldRows;
		placeGoldFlags(zones.blue, rng, 4);
		placeBonusSymbols(zones.blue, rng, 4, { excludeColor: 'blue' });
	} else {
		const blueWidth = 5 + playerTier;
		const blueHeight = 78; // 3x W1 hoogte
		const blueBoldRows = [];
		for (let r = 0; r < blueHeight; r += 7) { blueBoldRows.push(r); }
		const blueVoid = generateBlueRiverVoids(blueWidth, blueHeight, rng, blueBoldRows);
		const blueVoidSet = new Set(blueVoid.map(v => `${v.x},${v.y}`));
		const blueBold = [];
		for (const by of blueBoldRows) {
			for (let x = 0; x < blueWidth; x++) {
				if (!blueVoidSet.has(`${x},${by}`)) blueBold.push({ x, y: by });
			}
		}
		const blueGold = [];
		for (let i = 0; i < 6; i++) {
			let gx, gy;
			do { gx = Math.floor(rng() * blueWidth); gy = Math.floor(rng() * blueHeight); }
			while (blueVoidSet.has(`${gx},${gy}`));
			blueGold.push({ x: gx, y: gy });
		}
		zones.blue = createZoneGrid(blueHeight, blueWidth, { boldCells: blueBold, goldCells: blueGold, voidCells: blueVoid });
		zones.blue.boldRows = blueBoldRows;
		placeGoldFlags(zones.blue, rng, 6);
		placeBonusSymbols(zones.blue, rng, 5, { excludeColor: 'blue' });
	}

	// ══════════════════════════════════════════
	//  RED ZONE — Wereldafhankelijk + spelerafhankelijk
	//  Minimum 3 subgrids vanaf level 3 (world>=1, lvl>=3)
	// ══════════════════════════════════════════
	const redBaseCount = lvl >= 3 ? 3 : 2;
	const redMaxCount = world === 3 ? 6 : 5; // W3: 6 subgrids
	const redSubgridCount = Math.min(redBaseCount + playerTier, redMaxCount);
	{
		// Pool van beschikbare subgrids per wereld (van klein naar groot)
		const redPool = world === 1
			? [
				{ r: 4, c: 4, t: 8,  pts: 20 },
				{ r: 4, c: 5, t: 12, pts: 35 },
				{ r: 5, c: 5, t: 16, pts: 50 },
				{ r: 5, c: 5, t: 20, pts: 65 },
				{ r: 5, c: 6, t: 22, pts: 75 }
			]
			: world === 2
			? [
				{ r: 4, c: 5, t: 12, pts: 25 },
				{ r: 4, c: 6, t: 16, pts: 40 },
				{ r: 5, c: 6, t: 20, pts: 55 },
				{ r: 5, c: 6, t: 24, pts: 70 },
				{ r: 6, c: 6, t: 26, pts: 80 }
			]
			: [
				{ r: 5, c: 6, t: 18, pts: 30 },
				{ r: 5, c: 7, t: 22, pts: 45 },
				{ r: 6, c: 7, t: 26, pts: 60 },
				{ r: 6, c: 7, t: 30, pts: 75 },
				{ r: 7, c: 7, t: 32, pts: 85 },
				{ r: 8, c: 10, t: 34, pts: 90 }
			];
		const subgrids = [];
		for (let i = 0; i < redSubgridCount && i < redPool.length; i++) {
			const p = redPool[i];
			subgrids.push({
				id: `red-grid${i + 1}`,
				...generateHoleySubgrid(p.r, p.c, p.t, rng),
				targetPoints: p.pts
			});
		}
		zones.red = { subgrids };
	}

	// Gold en bonus in rode subgrids
	for (const sg of zones.red.subgrids) {
		placeGoldFlags(sg, rng, 1);
		const redBonusBase = world === 1 ? 3 : (world === 2 ? 4 : 5);
		placeBonusSymbols(sg, rng, redBonusBase * 0.45, { excludeColor: 'red' });
	}

	// ══════════════════════════════════════════
	//  PURPLE ZONE — Wereldafhankelijk + spelerafhankelijk
	//  Groter grid en meer bolds per playerTier
	// ══════════════════════════════════════════
	const purpleBaseSize = world === 1 ? 11 : (world === 2 ? 13 : 16);
	const purpleSize = purpleBaseSize + playerTier;
	const purpleCenter = Math.floor(purpleSize / 2);
	const purpleBold = [];
	// Meer bolds bij grotere grids: base + extra per world + level scaling
	const levelBonus = Math.max(0, lvl - 3);
	const purpleBaseBoldCount = world === 1 ? 8 : (world === 2 ? 12 : 20);
	const purpleBoldCount = purpleBaseBoldCount + playerTier * 2 + levelBonus;

	const allPurpleCoords = [];
	for (let y = 0; y < purpleSize; y++) {
		for (let x = 0; x < purpleSize; x++) {
			allPurpleCoords.push({ x, y });
		}
	}
	for (let i = allPurpleCoords.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[allPurpleCoords[i], allPurpleCoords[j]] = [allPurpleCoords[j], allPurpleCoords[i]];
	}
	const boldSet = new Set();
	const cornerBolds = world >= 2
		? [
			{ x: 0, y: 0 }, { x: purpleSize - 1, y: 0 },
			{ x: 0, y: purpleSize - 1 }, { x: purpleSize - 1, y: purpleSize - 1 }
		]
		: [];

	for (const cb of cornerBolds) {
		const k = `${cb.x},${cb.y}`;
		if (!boldSet.has(k)) {
			boldSet.add(k);
			purpleBold.push(cb);
		}
	}

	const isAdjacentToBold = (coord) => {
		return [[1,0],[-1,0],[0,1],[0,-1]].some(([dx,dy]) => boldSet.has(`${coord.x + dx},${coord.y + dy}`));
	};

	for (const c of allPurpleCoords) {
		if (purpleBold.length >= Math.min(purpleBoldCount, allPurpleCoords.length)) break;
		const k = `${c.x},${c.y}`;
		if (boldSet.has(k)) continue;
		if (isAdjacentToBold(c)) continue;
		boldSet.add(k);
		purpleBold.push(c);
	}

	const purpleGold = [];
	const purpleGoldCount = world === 1 ? 2 : (world === 2 ? 4 : 6);
	for (let i = 0; i < purpleGoldCount; i++) {
		purpleGold.push({
			x: Math.floor(rng() * purpleSize),
			y: Math.floor(rng() * purpleSize)
		});
	}

	zones.purple = createZoneGrid(purpleSize, purpleSize, {
		boldCells: purpleBold,
		goldCells: purpleGold
	});
	// Corner bold bonus punten voor W2/W3
	if (world >= 2) {
		zones.purple.cornerBoldBonus = world === 2 ? 20 : 25;
	}
	placeGoldFlags(zones.purple, rng, purpleGoldCount);

	// Tag outer ring cellen
	for (let i = 0; i < purpleSize; i++) {
		tagCellFlag(zones.purple, i, 0, 'outer-ring-0');
		tagCellFlag(zones.purple, i, purpleSize - 1, 'outer-ring-0');
		tagCellFlag(zones.purple, 0, i, 'outer-ring-0');
		tagCellFlag(zones.purple, purpleSize - 1, i, 'outer-ring-0');
	}
	for (let i = 1; i < purpleSize - 1; i++) {
		tagCellFlag(zones.purple, i, 1, 'outer-ring-1');
		tagCellFlag(zones.purple, i, purpleSize - 2, 'outer-ring-1');
		tagCellFlag(zones.purple, 1, i, 'outer-ring-1');
		tagCellFlag(zones.purple, purpleSize - 2, i, 'outer-ring-1');
	}

	placeBonusSymbols(zones.purple, rng, world === 1 ? 2 : (world === 2 ? 4 : 5), { excludeColor: 'purple' });
	ensureAnyBonusSymbolOnBoard(zones, rng);

	// Plaats parel-schatten in gele zone (meer coins)
	if (zones.yellow) {
		const pearlCount = world === 3 ? 3 : (world === 2 ? 2 : 1);
		placeTreasurePearls(zones.yellow, rng, pearlCount, 5);
	}

	return { zones };
}

/** Voeg een flag toe aan een cel (helper) */
function tagCellFlag(zoneData, x, y, flag) {
	const key = `${x},${y}`;
	const cell = zoneData.cells[key];
	if (cell && !cell.flags.includes(flag)) {
		cell.flags.push(flag);
	}
}

function placeGoldFlags(zoneData, rng, count) {
	if (!zoneData?.cells) return 0;
	const targetCount = Math.max(0, Math.floor(Number(count) || 0));

	for (const cell of Object.values(zoneData.cells)) {
		if (!cell || !Array.isArray(cell.flags)) continue;
		cell.flags = cell.flags.filter(f => f !== 'gold');
	}

	const availableCells = Object.values(zoneData.cells).filter(c =>
		c && !c.active &&
		!c.flags.includes('bold') &&
		!c.flags.includes('end') &&
		!c.flags.includes('portal')
	);

	const shuffled = shuffleWithRNG(availableCells, rng);
	let placed = 0;
	for (let i = 0; i < Math.min(targetCount, shuffled.length); i++) {
		const cell = shuffled[i];
		if (!cell.flags.includes('gold')) {
			cell.flags.push('gold');
			placed++;
		}
	}
	return placed;
}

/**
 * Plaats bonus-symbolen willekeurig in een zone.
 * Bonus symbolen geven bij activatie een bonus-charge
 * voor de aangegeven kleur.
 */
function placeBonusSymbols(zoneData, rng, count, options = {}) {
	const allBonusColors = ['yellow', 'red', 'green', 'purple', 'blue'];
	// excludeColor: vermijd dezelfde kleur als de zone zelf
	const excludeColor = options.excludeColor || null;
	const bonusColors = excludeColor ? allBonusColors.filter(c => c !== excludeColor) : allBonusColors;
	const preferredColor = bonusColors.includes(options.preferredColor) ? options.preferredColor : null;
	const preferredChance = Math.max(0, Math.min(1, Number(options.preferredChance || 0)));
	const multicolorChance = Math.max(0, Math.min(1, Number(options.multicolorChance || 0.08)));
	const targetCount = Math.max(0, Math.floor(Number(count) || 0));
	const availableCells = Object.values(zoneData.cells).filter(c =>
		!c.active &&
		!c.flags.includes('bold') &&
		!c.flags.includes('end') &&
		!c.flags.includes('portal') && !c.flags.includes('gold') &&
		!c.bonusSymbol
	);

	const shuffled = shuffleWithRNG(availableCells, rng);
	for (let i = 0; i < Math.min(targetCount, shuffled.length); i++) {
		let color;
		if (preferredColor && rng() < preferredChance) {
			color = preferredColor;
		} else if (rng() < multicolorChance) {
			color = 'any';
		} else {
			color = bonusColors[Math.floor(rng() * bonusColors.length)];
		}
		shuffled[i].bonusSymbol = color;
	}
}

function placeSingleBonusSymbol(zoneData, rng, options = {}) {
	if (!zoneData?.cells) return false;
	const bonusColors = ['yellow', 'red', 'green', 'purple', 'blue'];
	const preferredColor = bonusColors.includes(options.preferredColor) ? options.preferredColor : null;
	const preferredChance = Math.max(0, Math.min(1, Number(options.preferredChance || 0)));
	const multicolorChance = Math.max(0, Math.min(1, Number(options.multicolorChance || 0.08)));
	const availableCells = Object.values(zoneData.cells).filter(c =>
		!c.active &&
		!c.flags.includes('bold') &&
		!c.flags.includes('end') &&
		!c.flags.includes('portal') && !c.flags.includes('gold') &&
		!c.bonusSymbol && !c.treasureCoins
	);
	if (availableCells.length === 0) return false;
	const cell = availableCells[Math.floor(rng() * availableCells.length)];
	let color;
	if (preferredColor && rng() < preferredChance) {
		color = preferredColor;
	} else if (rng() < multicolorChance) {
		color = 'any';
	} else {
		color = bonusColors[Math.floor(rng() * bonusColors.length)];
	}
	cell.bonusSymbol = color;
	return true;
}

function ensureAnyBonusSymbolOnBoard(zones, rng) {
	if (!zones) return false;

	const bonusCells = [];
	const emptyCandidates = [];

	const scanZone = (zoneData) => {
		if (!zoneData?.cells) return;
		for (const cell of Object.values(zoneData.cells)) {
			if (!cell || cell.active) continue;
			if (cell.bonusSymbol === 'any') return true;
			if (cell.bonusSymbol) {
				bonusCells.push(cell);
				continue;
			}
			if (cell.flags?.includes('bold') || cell.flags?.includes('end') || cell.flags?.includes('portal') || cell.flags?.includes('gold')) continue;
			if (cell.treasureCoins) continue;
			emptyCandidates.push(cell);
		}
		return false;
	};

	for (const zoneName of ['yellow', 'green', 'blue', 'purple']) {
		if (scanZone(zones[zoneName])) return true;
	}

	for (const sg of (zones.red?.subgrids || [])) {
		if (scanZone(sg)) return true;
	}

	let target = null;
	if (bonusCells.length > 0) {
		target = bonusCells[Math.floor(rng() * bonusCells.length)];
	} else if (emptyCandidates.length > 0) {
		target = emptyCandidates[Math.floor(rng() * emptyCandidates.length)];
	}

	if (!target) return false;
	target.bonusSymbol = 'any';
	return true;
}

function getBoardWorld(boardState) {
	const yellowCols = Number(boardState?.zones?.yellow?.cols || 0);
	if (yellowCols >= 14) return 3;
	if (yellowCols >= 12) return 2;
	return 1;
}

function spawnBonusesAfterRoundFour(gameState, options = {}) {
	if (!gameState?.boardState?.zones) return 0;
	const round = Number(gameState.turnCount || 0);
	if (round < 5) return 0;
	if (gameState._roundFiveBonusBurstDone) return 0;
	const world = getBoardWorld(gameState.boardState);
	const isRoundStart = !!options.isRoundStart;
	if (!isRoundStart) return 0;

	const spawnCount = 10;
	const seed = (gameState.seed | 0)
		^ (round * 4093)
		^ ((gameState.moveHistory?.length || 0) * 131)
		^ hashStringToInt('dynamic-bonus-spawn');
	const rng = createRNG(seed);

	const weightedZones = world === 1
		? ['yellow', 'yellow', 'blue', 'blue', 'red', 'green', 'purple']
		: (world === 2
			? ['yellow', 'blue', 'blue', 'red', 'green', 'green', 'purple']
			: ['yellow', 'blue', 'blue', 'red', 'green', 'green', 'green', 'purple']);
	let spawned = 0;

	for (let i = 0; i < spawnCount; i++) {
		let placed = false;
		for (let attempt = 0; attempt < 16 && !placed; attempt++) {
			const zonePick = weightedZones[Math.floor(rng() * weightedZones.length)];
			if (zonePick === 'red') {
				const subgrids = shuffleWithRNG([...(gameState.boardState.zones.red?.subgrids || [])], rng);
				for (const sg of subgrids) {
					if (placeSingleBonusSymbol(sg, rng)) {
						placed = true;
						break;
					}
				}
			} else {
				const zoneData = gameState.boardState.zones[zonePick];
				placed = placeSingleBonusSymbol(zoneData, rng);
			}
		}
		if (placed) spawned++;
	}

	if (Array.isArray(gameState.moveHistory)) {
		gameState.moveHistory.push({
			type: 'bonus-spawn',
			spawned,
			requested: spawnCount,
			world,
			isRoundStart,
			round,
			timestamp: Date.now()
		});
	}

	gameState._roundFiveBonusBurstDone = true;

	return spawned;
}

/** Plaats schat-parels in een zone; activatie geeft extra munten. */
function placeTreasurePearls(zoneData, rng, count, coinValue = 5) {
	const availableCells = Object.values(zoneData.cells).filter(c =>
		!c.flags.includes('bold') && !c.flags.includes('end') &&
		!c.flags.includes('portal') && !c.flags.includes('gold') &&
		!c.bonusSymbol && !c.treasureCoins
	);

	const shuffled = shuffleWithRNG(availableCells, rng);
	for (let i = 0; i < Math.min(count, shuffled.length); i++) {
		shuffled[i].treasureCoins = coinValue;
	}
}

// ──────────────────────────────────────────────
//  PLACEMENT VALIDATION (pure data)
// ──────────────────────────────────────────────

function getDataCell(zoneData, x, y) {
	return zoneData.cells[`${x},${y}`] || null;
}

function zoneHasActive(zoneData) {
	return Object.values(zoneData.cells).some(c => c.active);
}

function hasAdjacentActive(zoneData, x, y) {
	const neighbors = [
		getDataCell(zoneData, x - 1, y),
		getDataCell(zoneData, x + 1, y),
		getDataCell(zoneData, x, y - 1),
		getDataCell(zoneData, x, y + 1)
	];
	// Stenen blokkeren adjacency — een steen-cel telt NIET als actieve buur
	return neighbors.some(n => n && n.active && !n.isStone);
}

/** Diagonale adjacency check (voor vrije rotatie perk op paars) */
function hasDiagonalOrAdjacentActive(zoneData, x, y) {
	const neighbors = [
		getDataCell(zoneData, x - 1, y),
		getDataCell(zoneData, x + 1, y),
		getDataCell(zoneData, x, y - 1),
		getDataCell(zoneData, x, y + 1),
		getDataCell(zoneData, x - 1, y - 1),
		getDataCell(zoneData, x + 1, y - 1),
		getDataCell(zoneData, x - 1, y + 1),
		getDataCell(zoneData, x + 1, y + 1)
	];
	return neighbors.some(n => n && n.active && !n.isStone);
}

/** Brugbouwer: check of er een actieve cel op afstand 2 is (met lege tussencel) */
function hasGapOneActive(zoneData, x, y) {
	const directions = [
		{ dx: -1, dy: 0 }, { dx: 1, dy: 0 },
		{ dx: 0, dy: -1 }, { dx: 0, dy: 1 }
	];
	for (const { dx, dy } of directions) {
		const gapCell = getDataCell(zoneData, x + dx, y + dy);
		const farCell = getDataCell(zoneData, x + dx * 2, y + dy * 2);
		// Er moet een lege tussencel zijn EN een actieve cel op afstand 2
		if (gapCell && !gapCell.active && farCell && farCell.active && !farCell.isStone) {
			return true;
		}
	}
	return false;
}

/**
 * Brugbouwer perk (groen): maak de laatste cel van de shape optioneel (value 1 → 2).
 * Hiermee wordt de kaart makkelijker plaatsbaar doordat 1 cel mag worden overgeslagen.
 */
function makeOneCellOptional(matrix) {
	const m = cloneMatrix(matrix);
	// Zoek de laatste cel (bottom-right scan) en maak deze optioneel
	for (let y = m.length - 1; y >= 0; y--) {
		for (let x = (m[y]?.length || 0) - 1; x >= 0; x--) {
			if (m[y][x] === 1) {
				// Controleer dat er minstens 2 verplichte cellen overblijven
				let requiredCount = 0;
				for (const row of m) { for (const c of (row || [])) { if (c === 1) requiredCount++; } }
				if (requiredCount >= 2) {
					m[y][x] = 2;
					return m;
				}
			}
		}
	}
	return m; // geen wijziging mogelijk
}

/**
 * Vrije Rotatie perk (paars): voeg 1 extra optionele cel (value 2) toe aan de shape.
 * De cel wordt toegevoegd op de eerste beschikbare positie naast de bestaande shape.
 */
function addExtraOptionalCell(matrix) {
	const m = cloneMatrix(matrix);
	// Vind alle bezette posities
	const occupied = new Set();
	for (let y = 0; y < m.length; y++) {
		for (let x = 0; x < (m[y]?.length || 0); x++) {
			if (m[y][x]) occupied.add(`${x},${y}`);
		}
	}
	// Zoek alle aangrenzende lege posities
	const candidates = [];
	for (let y = 0; y < m.length; y++) {
		for (let x = 0; x < (m[y]?.length || 0); x++) {
			if (!m[y][x]) continue;
			const neighbors = [{x:x-1,y},{x:x+1,y},{x,y:y-1},{x,y:y+1}];
			for (const n of neighbors) {
				if (n.x < 0 || n.y < 0) continue;
				const key = `${n.x},${n.y}`;
				if (!occupied.has(key) && !candidates.some(c => c.x === n.x && c.y === n.y)) {
					candidates.push(n);
				}
			}
		}
	}
	if (candidates.length === 0) return m;
	// Kies de eerste kandidaat (voorspelbare positie)
	const pick = candidates[0];
	// Vergroot matrix indien nodig
	while (m.length <= pick.y) m.push([]);
	while ((m[pick.y]?.length || 0) <= pick.x) m[pick.y].push(0);
	// Zorg dat alle rijen even breed zijn
	const maxW = Math.max(...m.map(r => r?.length || 0));
	for (const row of m) { while (row.length < maxW) row.push(0); }
	m[pick.y][pick.x] = 2;
	return m;
}

/**
 * Pas shape matrix aan op basis van perks en doelzone.
 * Wordt zowel server-side (playMove) als client-side (preview) gebruikt.
 */
function getEnhancedMatrix(matrix, zoneName, perkFlags) {
	if (!matrix || !zoneName || !perkFlags) return matrix;
	if (zoneName === 'green' && perkFlags.greenGapAllowed) {
		return makeOneCellOptional(matrix);
	}
	if (zoneName === 'red' && perkFlags.redGapAllowed) {
		return makeOneCellOptional(matrix);
	}
	if (zoneName === 'purple' && perkFlags.diagonalRotation) {
		return addExtraOptionalCell(matrix);
	}
	return matrix;
}

/**
 * Verzamel alle cellen die een shape zou bezetten.
 * Returns null als plaatsing onmogelijk is (buiten grid of bezet).
 * Ondersteunt optionele cellen (matrix value 2): mogen overlappen of buiten grid vallen.
 */
function collectPlacementCellsData(zoneData, baseX, baseY, matrix) {
	if (!zoneData || !Array.isArray(matrix) || !matrix.length) return null;
	const pending = [];
	const optionalCells = [];

	for (let y = 0; y < matrix.length; y++) {
		for (let x = 0; x < (matrix[y]?.length || 0); x++) {
			const cellVal = matrix[y][x];
			if (!cellVal) continue;
			const isOptional = cellVal === 2;
			const targetX = baseX + x;
			const targetY = baseY + y;
			const cell = getDataCell(zoneData, targetX, targetY);

			if (isOptional) {
				// Optionele cellen mogen buiten grid of bezet zijn
				if (cell && !cell.active) {
					optionalCells.push({ x: targetX, y: targetY, optional: true });
				}
				continue;
			}

			if (!cell) return null;
			if (cell.active) return null;
			pending.push({ x: targetX, y: targetY });
		}
	}

	if (pending.length === 0) return null;
	// Voeg optionele cellen toe als metadata
	pending.optionalCells = optionalCells;
	return pending;
}

/**
 * Valideer plaatsing per zone type.
 * Regels exact uit index.html:
 * - Yellow: eerste=moet bold raken; daarna=bold OF adjacent active
 * - Blue: eerste=moet bodem(maxY) of portal of bold raken; daarna=idem OF adjacent
 * - Green: eerste=moet bold anchor raken; daarna=anchor OF adjacent
 * - Red: altijd vrij plaatsen (geen adjacency constraint)
 * - Purple: eerste=portal OF alleen inner grid (geen outer ring); daarna=portal OF adjacent
 *
 * Optionele cellen (perk-upgrades) tellen mee als anker voor adjacency/floor/bold checks.
 * Ze zijn optioneel in de zin dat ze niet geplaatst HOEVEN, maar als ze wél passen
 * mogen ze als anker dienen.
 */
function validatePlacement(zoneName, zoneData, pendingCells, perkFlags) {
	if (!pendingCells || !pendingCells.length) return false;

	switch (zoneName) {
		case 'yellow': return validateYellow(zoneData, pendingCells);
		case 'blue':   return validateBlue(zoneData, pendingCells);
		case 'green':  return validateGreen(zoneData, pendingCells, perkFlags);
		case 'red':    return true;
		case 'purple': return validatePurple(zoneData, pendingCells, perkFlags);
		default: return true;
	}
}

/** Combineer required + optionele cellen voor validatiechecks */
function _getAllValidationCells(pendingCells) {
	const all = [...pendingCells];
	const optCells = pendingCells.optionalCells || [];
	for (const oc of optCells) all.push(oc);
	return all;
}

function validateYellow(zoneData, pendingCells) {
	const allCells = _getAllValidationCells(pendingCells);
	const hasActive = zoneHasActive(zoneData);
	const touchesBold = allCells.some(c => {
		const cell = getDataCell(zoneData, c.x, c.y);
		return cell && cell.flags.includes('bold');
	});
	const touchesPortal = allCells.some(c => {
		const cell = getDataCell(zoneData, c.x, c.y);
		return cell && cell.flags.includes('portal');
	});
	if (!hasActive) return touchesBold || touchesPortal;
	if (touchesBold || touchesPortal) return true;
	return allCells.some(c => hasAdjacentActive(zoneData, c.x, c.y));
}

function validateBlue(zoneData, pendingCells) {
	const allCells = _getAllValidationCells(pendingCells);
	const hasActive = zoneHasActive(zoneData);
	const maxY = zoneData.rows - 1;
	const touchesFloor = allCells.some(c => c.y === maxY);

	// Eerste plaatsing: MOET de onderste rij raken
	if (!hasActive) return touchesFloor;
	// Daarna: adjacent aan bestaande actieve cel
	if (touchesFloor) return true;
	return allCells.some(c => hasAdjacentActive(zoneData, c.x, c.y));
}

function validateGreen(zoneData, pendingCells, perkFlags) {
	const allCells = _getAllValidationCells(pendingCells);
	const hasActive = zoneHasActive(zoneData);
	const touchesBold = allCells.some(c => {
		const cell = getDataCell(zoneData, c.x, c.y);
		return cell && cell.flags.includes('bold');
	});
	const touchesPortal = allCells.some(c => {
		const cell = getDataCell(zoneData, c.x, c.y);
		return cell && cell.flags.includes('portal');
	});

	if (!hasActive) return touchesBold || touchesPortal;
	if (touchesBold || touchesPortal) return true;
	// Normale orthogonale adjacency
	return allCells.some(c => hasAdjacentActive(zoneData, c.x, c.y));
}

function validatePurple(zoneData, pendingCells, perkFlags) {
	const allCells = _getAllValidationCells(pendingCells);
	const hasActive = zoneHasActive(zoneData);
	const touchesPortal = allCells.some(c => {
		const cell = getDataCell(zoneData, c.x, c.y);
		return cell && cell.flags.includes('portal');
	});

	if (!hasActive) {
		if (touchesPortal) return true;
		// Eerste plaatsing: alleen inner grid (geen outer ring 0 of 1)
		// Gebruik alleen required cellen voor inner-grid check (optionele cellen mogen buiten vallen)
		return pendingCells.every(c => {
			const cell = getDataCell(zoneData, c.x, c.y);
			return cell && !cell.flags.includes('outer-ring-0') && !cell.flags.includes('outer-ring-1');
		});
	}

	if (touchesPortal) return true;
	// Standaard orthogonale adjacency
	return allCells.some(c => hasAdjacentActive(zoneData, c.x, c.y));
}

/**
 * Plaats een shape en geef de resultaten terug.
 * Retourneert ook verzamelde bonussen en gold cells.
 */
function applyPlacement(boardState, zoneName, zoneData, baseX, baseY, matrix, color, playerId, perkFlags) {
	const pendingCells = collectPlacementCellsData(zoneData, baseX, baseY, matrix);
	if (!pendingCells) return null;
	if (!validatePlacement(zoneName, zoneData, pendingCells, perkFlags)) return null;
	const isStonePlacement = !!color?.isStone;
	const placedColor = isStonePlacement ? { ...STONE_COLOR } : color;

	if (!Number.isFinite(boardState._placementSeq)) {
		boardState._placementSeq = 0;
	}

	const placedCells = [];
	const collectedBonuses = [];
	let goldCollected = 0;
	let pearlsCollected = 0;
	let pearlGold = 0;

	for (const coord of pendingCells) {
		const cell = getDataCell(zoneData, coord.x, coord.y);
		if (cell) {
			boardState._placementSeq += 1;
			cell.active = true;
			cell.color = placedColor;
			cell.playerId = playerId;
			cell.placementOrder = boardState._placementSeq;
			placedCells.push({ ...coord });

			// Steen: markeer cel als blokkerend
			cell.isStone = isStonePlacement;

			// Gold cell: geeft 1 munt (currency)
			if (cell.flags.includes('gold')) {
				goldCollected++;
			}

			// Parel-schat: geeft extra munten (bijv. 5)
			if (cell.treasureCoins && cell.treasureCoins > 0) {
				goldCollected += cell.treasureCoins;
				pearlGold += cell.treasureCoins;
				pearlsCollected++;
			}

			// Bonus symbool: geeft een bonus charge
			if (cell.bonusSymbol) {
				collectedBonuses.push(cell.bonusSymbol);
			}
		}
	}

	// Optionele cellen (perk upgrades): plaats als ze passen
	const optCells = pendingCells.optionalCells || [];
	for (const coord of optCells) {
		const cell = getDataCell(zoneData, coord.x, coord.y);
		if (cell && !cell.active) {
			boardState._placementSeq += 1;
			cell.active = true;
			cell.color = placedColor;
			cell.playerId = playerId;
			cell.placementOrder = boardState._placementSeq;
			placedCells.push({ ...coord, optional: true });
			cell.isStone = isStonePlacement;
			if (cell.flags.includes('gold')) goldCollected++;
			if (cell.treasureCoins && cell.treasureCoins > 0) {
				goldCollected += cell.treasureCoins;
				pearlGold += cell.treasureCoins;
				pearlsCollected++;
			}
			if (cell.bonusSymbol) collectedBonuses.push(cell.bonusSymbol);
		}
	}

	return {
		zoneName,
		cells: placedCells,
		playerId,
		color,
		goldCollected,
		collectedBonuses,
		pearlsCollected,
		pearlGold
	};
}

// ──────────────────────────────────────────────
//  SCORING (gebaseerd op index.html formules)
// ──────────────────────────────────────────────

/**
 * YELLOW SCORING: Kolom-gebaseerd
 * Punten per compleet gevulde kolom, oplopend van links→rechts:
 * Kolom paar 0,1 → 6pt; 2,3 → 8pt; 4,5 → 10pt; 6,7 → 12pt; 8,9 → 15pt; 10,11 → 20pt; 12,13 → 25pt
 */
const YELLOW_COLUMN_PAIR_POINTS = [6, 8, 10, 12, 15, 20, 25];

function hasStoneInYellowColumn(zoneData, x) {
	if (!zoneData) return false;
	for (let y = 0; y < zoneData.rows; y++) {
		const cell = getDataCell(zoneData, x, y);
		if (cell?.isStone) return true;
	}
	return false;
}

function scoreYellowData(zoneData) {
	if (!zoneData) return 0;

	// Branch op scoreMode
	if (zoneData.scoreMode === 'diagonal') {
		return scoreYellowDiagonal(zoneData);
	}
	if (zoneData.scoreMode === 'rings') {
		return scoreYellowRings(zoneData);
	}

	// Default: kolom-gebaseerd
	let score = 0;
	for (let x = 0; x < zoneData.cols; x++) {
		if (hasStoneInYellowColumn(zoneData, x)) continue;
		let colComplete = true;
		let hasCells = false;
		for (let y = 0; y < zoneData.rows; y++) {
			const cell = getDataCell(zoneData, x, y);
			if (!cell) continue;
			hasCells = true;
			if (!cell.active) { colComplete = false; break; }
		}
		if (colComplete && hasCells) {
			const pairIndex = Math.min(
				Math.floor(x / 2),
				YELLOW_COLUMN_PAIR_POINTS.length - 1
			);
			score += YELLOW_COLUMN_PAIR_POINTS[pairIndex];
		}
	}
	return score;
}

/** YELLOW DIAGONAL SCORING (World 2) */
function scoreYellowDiagonal(zoneData) {
	const minLen = Math.max(1, Number(zoneData.minDiagonalLength) || 4);
	const computeSegmentPoints = (len) => {
		if (len < minLen) return 0;
		return Math.pow(2, Math.floor(len / 2) + 1);
	};
	const cellByCoord = new Map();
	for (const key in zoneData.cells) {
		const c = zoneData.cells[key];
		if (c) cellByCoord.set(key, c);
	}
	const tryGet = (x, y) => cellByCoord.get(`${x},${y}`) || null;

	const collectSegments = (dx, dy) => {
		const segments = [];
		for (const c of cellByCoord.values()) {
			const x0 = c.x, y0 = c.y;
			if (tryGet(x0 - dx, y0 - dy)) continue; // niet het begin van segment
			const segCells = [];
			let x = x0, y = y0;
			while (tryGet(x, y)) { segCells.push(tryGet(x, y)); x += dx; y += dy; }
			if (segCells.length >= minLen) {
				const allActive = segCells.every(sc => sc.active);
				if (allActive) segments.push(segCells);
			}
		}
		return segments;
	};

	let score = 0;
	const allSegments = [...collectSegments(1, 1), ...collectSegments(1, -1)];
	for (const seg of allSegments) {
		score += computeSegmentPoints(seg.length);
	}
	return score;
}

/** Aantal voltooide diagonale segmenten (voor objectives) */
function countYellowCompletedDiagonals(zoneData) {
	const minLen = Math.max(1, Number(zoneData?.minDiagonalLength) || 4);
	if (!zoneData?.cells) return 0;
	const cellByCoord = new Map();
	for (const key in zoneData.cells) {
		const c = zoneData.cells[key];
		if (c) cellByCoord.set(key, c);
	}
	const tryGet = (x, y) => cellByCoord.get(`${x},${y}`) || null;
	let count = 0;
	const check = (dx, dy) => {
		for (const c of cellByCoord.values()) {
			const x0 = c.x, y0 = c.y;
			if (tryGet(x0 - dx, y0 - dy)) continue;
			const segCells = [];
			let x = x0, y = y0;
			while (tryGet(x, y)) { segCells.push(tryGet(x, y)); x += dx; y += dy; }
			if (segCells.length >= minLen && segCells.every(sc => sc.active)) count++;
		}
	};
	check(1, 1);
	check(1, -1);
	return count;
}

/** YELLOW RING SCORING (World 3) */
function scoreYellowRings(zoneData) {
	const ringMinPts = Math.max(0, Number(zoneData.ringMinPoints) || 12);
	const ringMaxPts = Math.max(ringMinPts, Number(zoneData.ringMaxPoints) || 64);

	// BFS van boundary cellen om ring-diepte te bepalen
	const cellByCoord = new Map();
	for (const key in zoneData.cells) {
		const c = zoneData.cells[key];
		if (c) cellByCoord.set(key, c);
	}
	const tryGet = (x, y) => cellByCoord.get(`${x},${y}`) || null;

	// Boundary: cellen die minstens één ontbrekende buur hebben
	const boundary = [];
	for (const c of cellByCoord.values()) {
		if (!tryGet(c.x - 1, c.y) || !tryGet(c.x + 1, c.y) ||
			!tryGet(c.x, c.y - 1) || !tryGet(c.x, c.y + 1)) {
			boundary.push(c);
		}
	}

	// BFS
	const depthByKey = new Map();
	const queue = [];
	for (const c of boundary) {
		depthByKey.set(`${c.x},${c.y}`, 0);
		queue.push(c);
	}
	let qi = 0;
	while (qi < queue.length) {
		const cur = queue[qi++];
		const curDepth = depthByKey.get(`${cur.x},${cur.y}`);
		for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
			const n = tryGet(cur.x + dx, cur.y + dy);
			if (n && !depthByKey.has(`${n.x},${n.y}`)) {
				depthByKey.set(`${n.x},${n.y}`, curDepth + 1);
				queue.push(n);
			}
		}
	}

	// Groepeer per ring diepte
	let maxDepth = 0;
	const rings = new Map();
	for (const [key, depth] of depthByKey.entries()) {
		if (depth > maxDepth) maxDepth = depth;
		if (!rings.has(depth)) rings.set(depth, []);
		rings.get(depth).push(cellByCoord.get(key));
	}

	let score = 0;
	for (const [depth, cells] of rings.entries()) {
		const denom = Math.max(1, maxDepth);
		const t = (denom - depth) / denom;
		const points = Math.round(ringMinPts + t * (ringMaxPts - ringMinPts));
		if (cells.every(c => c.active)) {
			score += points;
		}
	}
	return score;
}

/** Aantal voltooide ringen (voor objectives) */
function countYellowCompletedRings(zoneData) {
	if (!zoneData?.cells) return 0;
	const cellByCoord = new Map();
	for (const key in zoneData.cells) {
		const c = zoneData.cells[key];
		if (c) cellByCoord.set(key, c);
	}
	const tryGet = (x, y) => cellByCoord.get(`${x},${y}`) || null;
	const boundary = [];
	for (const c of cellByCoord.values()) {
		if (!tryGet(c.x - 1, c.y) || !tryGet(c.x + 1, c.y) ||
			!tryGet(c.x, c.y - 1) || !tryGet(c.x, c.y + 1)) {
			boundary.push(c);
		}
	}
	const depthByKey = new Map();
	const queue = [];
	for (const c of boundary) { depthByKey.set(`${c.x},${c.y}`, 0); queue.push(c); }
	let qi = 0;
	while (qi < queue.length) {
		const cur = queue[qi++];
		const curDepth = depthByKey.get(`${cur.x},${cur.y}`);
		for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
			const n = tryGet(cur.x + dx, cur.y + dy);
			if (n && !depthByKey.has(`${n.x},${n.y}`)) {
				depthByKey.set(`${n.x},${n.y}`, curDepth + 1);
				queue.push(n);
			}
		}
	}
	const rings = new Map();
	for (const [key, depth] of depthByKey.entries()) {
		if (!rings.has(depth)) rings.set(depth, []);
		rings.get(depth).push(cellByCoord.get(key));
	}
	let count = 0;
	for (const cells of rings.values()) {
		if (cells.every(c => c.active)) count++;
	}
	return count;
}

/**
 * GREEN SCORING: afstands-gebaseerd per end-cell
 * Dichter bij start = ~5pt, verder weg = tot ~25pt.
 */
function getGreenEndCellPoints(zoneData, cell) {
	if (!zoneData || !cell) return 0;
	const startX = Number.isFinite(zoneData.startX) ? zoneData.startX : Math.floor((zoneData.cols || 1) / 2);
	const startY = Number.isFinite(zoneData.startY) ? zoneData.startY : Math.floor((zoneData.rows || 1) / 2);
	const manhattanDistance = Math.abs((cell.x || 0) - startX) + Math.abs((cell.y || 0) - startY);

	let maxDistance = 1;
	for (const c of Object.values(zoneData.cells || {})) {
		if (!c?.flags?.includes('end')) continue;
		const d = Math.abs((c.x || 0) - startX) + Math.abs((c.y || 0) - startY);
		if (d > maxDistance) maxDistance = d;
	}

	const ratio = Math.max(0, Math.min(1, manhattanDistance / maxDistance));
	return Math.round(5 + ratio * 20);
}

function scoreGreenData(zoneData) {
	if (!zoneData) return 0;
	let score = 0;

	Object.values(zoneData.cells).forEach(cell => {
		if (cell.active && cell.flags.includes('end')) {
			score += getGreenEndCellPoints(zoneData, cell);
		}
	});

	return score;
}

/**
 * BLUE SCORING: Escalerend per bold-rij met actieve cellen
 * Een bold-rij scoort als minstens 1 bold cel actief is.
 * Eerste scorende bold-rij = 6pt
 * Volgende rijen: 8 + (n-1) * 2 (dus 8, 10, 12, 14, ...)
 */
// Blue scoring tiers (onder → boven): +10, +15, +20, +25, +30, +35, top +40
const BLUE_ROW_POINTS = [10, 15, 20, 25, 30, 35, 40];

function getBlueTierPoints(tierIndex, totalTiers) {
	const fallback = [10, 15, 20, 25, 40];
	const tiers = Array.isArray(BLUE_ROW_POINTS) && BLUE_ROW_POINTS.length > 0 ? BLUE_ROW_POINTS : fallback;
	if (!Number.isFinite(totalTiers) || totalTiers <= 0) return tiers[0] || 10;
	const idx = Math.max(0, Math.min(Number(tierIndex) || 0, tiers.length - 1));
	return tiers[idx] || tiers[tiers.length - 1] || 10;
}

function scoreBlueData(zoneData) {
	if (!zoneData) return 0;
	const boldYs = zoneData.boldRows || [];
	let score = 0;

	// Sorteer bold rows van onder naar boven (begin onderaan = laagste punten)
	const sortedBoldYs = [...new Set(
		boldYs.length > 0 ? boldYs : findBoldRows(zoneData)
	)].sort((a, b) => b - a);

	for (let tierIndex = 0; tierIndex < sortedBoldYs.length; tierIndex++) {
		const boldY = sortedBoldYs[tierIndex];
		let hasActiveBold = false;
		for (let x = 0; x < zoneData.cols; x++) {
			const cell = getDataCell(zoneData, x, boldY);
			if (cell && cell.active && cell.flags.includes('bold')) {
				hasActiveBold = true;
				break;
			}
		}
		if (hasActiveBold) {
			const points = getBlueTierPoints(tierIndex, sortedBoldYs.length);
			score += points;
		}
	}

	return score;
}

function findBoldRows(zoneData) {
	const rows = new Set();
	Object.values(zoneData.cells).forEach(c => {
		if (c.flags.includes('bold')) rows.add(c.y);
	});
	return [...rows];
}

/**
 * RED SCORING: punten vanaf 80% vulling + bonus bij 100%.
 */
const RED_PARTIAL_THRESHOLD = 0.8;
const RED_POINT_SCALE = 0.5;
const MATCH_WINS_TARGET = 4;
const DEFAULT_MAX_LEVELS = 10;

function getRedSubgridScoreInfo(subgrid) {
	const allCells = Object.values(subgrid?.cells || {});
	const totalCount = allCells.length;
	const hasStone = allCells.some(c => !!c?.isStone);
	if (totalCount === 0) {
		return {
			totalCount: 0,
			filledCount: 0,
			fillRatio: 0,
			basePoints: 0,
			fullBonusPoints: 0,
			totalPoints: 0,
			isPartialReached: false,
			isFull: false
		};
	}

	if (hasStone) {
		return {
			totalCount,
			filledCount: allCells.filter(c => c.active).length,
			fillRatio: 0,
			basePoints: 0,
			fullBonusPoints: 0,
			totalPoints: 0,
			isPartialReached: false,
			isFull: false
		};
	}

	const filledCells = allCells.filter(c => c.active);
	const filledCount = filledCells.length;
	const fillRatio = filledCount / totalCount;
	const rawBasePoints = subgrid.targetPoints || (totalCount * 2);
	const basePoints = Math.max(4, Math.round(rawBasePoints * RED_POINT_SCALE));
	const isPartialReached = fillRatio >= RED_PARTIAL_THRESHOLD;
	const isFull = filledCount === totalCount;
	const fullBonusPoints = isFull ? Math.max(6, Math.round(basePoints * 0.85)) : 0;
	const totalPoints = isPartialReached ? (basePoints + fullBonusPoints) : 0;

	return {
		totalCount,
		filledCount,
		fillRatio,
		basePoints,
		fullBonusPoints,
		totalPoints,
		isPartialReached,
		isFull
	};
}

function scoreRedData(redZone) {
	if (!redZone || !redZone.subgrids) return 0;
	let score = 0;
	for (const subgrid of redZone.subgrids) {
		const info = getRedSubgridScoreInfo(subgrid);
		score += info.totalPoints;
	}
	return score;
}

/**
 * PURPLE SCORING: BFS cluster-score
 * Verbindingen tellen GLOBAAL door over alle spelers heen.
 * Punten per verbinding: 6, 8, 10, 12, 18, 24, 30, 30, 30, ...
 * De punten van een verbinding gaan naar de speler die die verbinding maakte.
 */
const PURPLE_CONNECTION_POINTS = [6, 8, 10, 12, 18, 24, 30];
const PURPLE_MAX_POINTS = 30;

function getPurpleConnectionPoints(connectionNumber) {
	if (!Number.isFinite(connectionNumber) || connectionNumber < 1) return 0;
	if (connectionNumber <= PURPLE_CONNECTION_POINTS.length) return PURPLE_CONNECTION_POINTS[connectionNumber - 1];
	return PURPLE_MAX_POINTS;
}

function getPurpleTotalPointsForConnectionCount(connectionCount) {
	if (!Number.isFinite(connectionCount) || connectionCount < 1) return 0;
	let total = 0;
	for (let i = 1; i <= connectionCount; i++) total += getPurpleConnectionPoints(i);
	return total;
}

function buildPurpleConnectionEvents(zoneData) {
	if (!zoneData?.cells) return [];

	const cells = Object.values(zoneData.cells)
		.filter(c => c && c.active && !c.isStone)
		.sort((a, b) => {
			const ao = Number.isFinite(a.placementOrder) ? a.placementOrder : Number.MAX_SAFE_INTEGER;
			const bo = Number.isFinite(b.placementOrder) ? b.placementOrder : Number.MAX_SAFE_INTEGER;
			if (ao !== bo) return ao - bo;
			if (a.y !== b.y) return a.y - b.y;
			return a.x - b.x;
		});

	if (cells.length === 0) return [];

	const parent = new Map();
	const rank = new Map();
	const boldCountByRoot = new Map();
	const activeKeys = new Set();
	const cellByKey = new Map();
	const events = [];
	let globalConnections = 0;

	const keyOf = (x, y) => `${x},${y}`;
	const connFromBoldCount = (count) => Math.max(0, (Number(count) || 0) - 1);

	const find = (key) => {
		let p = parent.get(key);
		if (p === key) return key;
		p = find(p);
		parent.set(key, p);
		return p;
	};

	const union = (a, b) => {
		let ra = find(a);
		let rb = find(b);
		if (ra === rb) return ra;

		const rankA = rank.get(ra) || 0;
		const rankB = rank.get(rb) || 0;
		if (rankA < rankB) {
			const tmp = ra;
			ra = rb;
			rb = tmp;
		}

		parent.set(rb, ra);
		if (rankA === rankB) rank.set(ra, rankA + 1);

		const mergedBold = (boldCountByRoot.get(ra) || 0) + (boldCountByRoot.get(rb) || 0);
		boldCountByRoot.set(ra, mergedBold);
		boldCountByRoot.delete(rb);
		return ra;
	};

	for (const cell of cells) {
		const beforeConnections = globalConnections;
		const key = keyOf(cell.x, cell.y);
		cellByKey.set(key, cell);
		activeKeys.add(key);
		parent.set(key, key);
		rank.set(key, 0);
		boldCountByRoot.set(key, cell.flags?.includes('bold') ? 1 : 0);

		const neighbors = [
			keyOf(cell.x - 1, cell.y),
			keyOf(cell.x + 1, cell.y),
			keyOf(cell.x, cell.y - 1),
			keyOf(cell.x, cell.y + 1)
		];

		for (const nKey of neighbors) {
			if (!activeKeys.has(nKey)) continue;
			const nCell = cellByKey.get(nKey);
			if (!nCell || nCell.isStone) continue;

			const rootA = find(key);
			const rootB = find(nKey);
			if (rootA === rootB) continue;

			globalConnections -= connFromBoldCount(boldCountByRoot.get(rootA));
			globalConnections -= connFromBoldCount(boldCountByRoot.get(rootB));
			const mergedRoot = union(rootA, rootB);
			globalConnections += connFromBoldCount(boldCountByRoot.get(mergedRoot));
		}

		const gainedConnections = Math.max(0, globalConnections - beforeConnections);
		if (gainedConnections > 0 && cell.playerId) {
			const order = Number.isFinite(cell.placementOrder) ? cell.placementOrder : Number.MAX_SAFE_INTEGER;
			for (let i = 0; i < gainedConnections; i++) {
				events.push({
					playerId: cell.playerId,
					order,
					x: cell.x,
					y: cell.y
				});
			}
		}
	}

	return events;
}

function scorePurpleData(zoneData) {
	if (!zoneData) return 0;
	const events = buildPurpleConnectionEvents(zoneData);
	let score = getPurpleTotalPointsForConnectionCount(events.length);
	// Corner cell bonus: 4 hoeken geven extra punten als ze actief bold zijn
	if (zoneData.cornerBoldBonus) {
		const size = zoneData.rows || 0;
		const corners = [
			getDataCell(zoneData, 0, 0),
			getDataCell(zoneData, size - 1, 0),
			getDataCell(zoneData, 0, size - 1),
			getDataCell(zoneData, size - 1, size - 1)
		];
		for (const c of corners) {
			if (c && c.active && c.flags.includes('bold')) {
				score += zoneData.cornerBoldBonus;
			}
		}
	}
	return score;
}

function getBlueHighestReachedTier(zoneData) {
	if (!zoneData) return 0;
	const boldYs = [...new Set(zoneData.boldRows || findBoldRows(zoneData))].sort((a, b) => b - a);
	let tier = 0;
	for (let i = 0; i < boldYs.length; i++) {
		const y = boldYs[i];
		for (let x = 0; x < zoneData.cols; x++) {
			const cell = getDataCell(zoneData, x, y);
			if (cell && cell.active && cell.flags.includes('bold')) {
				tier = Math.max(tier, i + 1);
				break;
			}
		}
	}
	return tier;
}

function getBlueRowPioneerOwner(rowCells) {
	const activeBoldCells = (rowCells || []).filter(c => c && c.active && c.flags?.includes('bold') && c.playerId);
	if (activeBoldCells.length === 0) return null;
	let pioneer = null;
	for (const cell of activeBoldCells) {
		const order = Number.isFinite(cell.placementOrder) ? cell.placementOrder : Number.MAX_SAFE_INTEGER;
		if (!pioneer) {
			pioneer = cell;
			continue;
		}
		const pOrder = Number.isFinite(pioneer.placementOrder) ? pioneer.placementOrder : Number.MAX_SAFE_INTEGER;
		if (order < pOrder) pioneer = cell;
	}
	return pioneer?.playerId || null;
}

/**
 * BALANCE BONUS: min(alle 5 zone scores)
 * Beloont gelijkmatig spelen over alle zones.
 */
function calculateBalanceBonus(yellowScore, greenScore, blueScore, redScore, purpleScore) {
	return Math.max(0, Math.min(yellowScore, greenScore, blueScore, redScore, purpleScore));
}

/** Bereken alle zone scores + balance bonus */
function calculateScores(boardState) {
	const yellow = scoreYellowData(boardState.zones.yellow);
	const green = scoreGreenData(boardState.zones.green);
	const blue = scoreBlueData(boardState.zones.blue);
	const red = scoreRedData(boardState.zones.red);
	const purple = scorePurpleData(boardState.zones.purple);
	const bonus = calculateBalanceBonus(yellow, green, blue, red, purple);
	const total = yellow + green + blue + red + purple + bonus;

	return { yellow, green, blue, red, purple, bonus, total };
}

/**
 * Per-speler score berekening.
 * Elke speler krijgt punten op basis van wie de meeste cellen heeft
 * in een scorend element (complete kolom/rij/subgrid/cluster).
 */
function calculatePlayerScores(boardState, playerIds) {
	const playerScores = {};
	for (const pid of playerIds) {
		playerScores[pid] = {
			yellow: 0, green: 0, blue: 0, red: 0, purple: 0,
			bonus: 0, gold: 0, total: 0
		};
	}

	// ── YELLOW: scoring per scoreMode ──
	const yellowZone = boardState.zones.yellow;
	if (yellowZone) {
		if (yellowZone.scoreMode === 'diagonal') {
			// Diagonal scoring (World 2) — punten naar latest placer per segment
			const minLen = Math.max(1, Number(yellowZone.minDiagonalLength) || 4);
			const computeSegmentPoints = (len) => {
				if (len < minLen) return 0;
				return Math.pow(2, Math.floor(len / 2) + 1);
			};
			const cellByCoord = new Map();
			for (const key in yellowZone.cells) {
				const c = yellowZone.cells[key];
				if (c) cellByCoord.set(key, c);
			}
			const tryGet = (x, y) => cellByCoord.get(`${x},${y}`) || null;
			const collectSegments = (dx, dy) => {
				const segments = [];
				for (const c of cellByCoord.values()) {
					const x0 = c.x, y0 = c.y;
					if (tryGet(x0 - dx, y0 - dy)) continue;
					const segCells = [];
					let x = x0, y = y0;
					while (tryGet(x, y)) { segCells.push(tryGet(x, y)); x += dx; y += dy; }
					if (segCells.length >= minLen && segCells.every(sc => sc.active)) {
						segments.push(segCells);
					}
				}
				return segments;
			};
			const allSegments = [...collectSegments(1, 1), ...collectSegments(1, -1)];
			for (const seg of allSegments) {
				const points = computeSegmentPoints(seg.length);
				if (points > 0) {
					const winner = getLatestPlacerOwner(seg);
					if (winner && playerScores[winner]) {
						playerScores[winner].yellow += points;
					}
				}
			}
		} else if (yellowZone.scoreMode === 'rings') {
			// Ring scoring (World 3) — punten naar majority owner per ring
			const ringMinPts = Math.max(0, Number(yellowZone.ringMinPoints) || 12);
			const ringMaxPts = Math.max(ringMinPts, Number(yellowZone.ringMaxPoints) || 64);
			const cellByCoord = new Map();
			for (const key in yellowZone.cells) {
				const c = yellowZone.cells[key];
				if (c) cellByCoord.set(key, c);
			}
			const tryGet = (x, y) => cellByCoord.get(`${x},${y}`) || null;
			const boundary = [];
			for (const c of cellByCoord.values()) {
				if (!tryGet(c.x - 1, c.y) || !tryGet(c.x + 1, c.y) ||
					!tryGet(c.x, c.y - 1) || !tryGet(c.x, c.y + 1)) {
					boundary.push(c);
				}
			}
			const depthByKey = new Map();
			const queue = [];
			for (const c of boundary) { depthByKey.set(`${c.x},${c.y}`, 0); queue.push(c); }
			let qi = 0;
			while (qi < queue.length) {
				const cur = queue[qi++];
				const curDepth = depthByKey.get(`${cur.x},${cur.y}`);
				for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
					const n = tryGet(cur.x + dx, cur.y + dy);
					if (n && !depthByKey.has(`${n.x},${n.y}`)) {
						depthByKey.set(`${n.x},${n.y}`, curDepth + 1);
						queue.push(n);
					}
				}
			}
			let maxDepth = 0;
			const rings = new Map();
			for (const [key, depth] of depthByKey.entries()) {
				if (depth > maxDepth) maxDepth = depth;
				if (!rings.has(depth)) rings.set(depth, []);
				rings.get(depth).push(cellByCoord.get(key));
			}
			for (const [depth, cells] of rings.entries()) {
				const denom = Math.max(1, maxDepth);
				const t = (denom - depth) / denom;
				const points = Math.round(ringMinPts + t * (ringMaxPts - ringMinPts));
				if (cells.every(c => c.active)) {
					const winner = getLatestPlacerOwner(cells);
					if (winner && playerScores[winner]) {
						playerScores[winner].yellow += points;
					}
				}
			}
		} else {
			// Default: kolom-gebaseerd (World 1)
			for (let x = 0; x < yellowZone.cols; x++) {
				if (hasStoneInYellowColumn(yellowZone, x)) continue;
				let colComplete = true;
				let hasCells = false;
				const colCells = [];
				for (let y = 0; y < yellowZone.rows; y++) {
					const cell = getDataCell(yellowZone, x, y);
					if (!cell) continue; // skip void cells (staircase pattern)
					hasCells = true;
					if (!cell.active) { colComplete = false; break; }
					colCells.push(cell);
				}
				if (colComplete && hasCells && colCells.length > 0) {
					const pairIndex = Math.min(Math.floor(x / 2), YELLOW_COLUMN_PAIR_POINTS.length - 1);
					const points = YELLOW_COLUMN_PAIR_POINTS[pairIndex];
					const winner = getLatestPlacerOwner(colCells);
					if (winner && playerScores[winner]) {
						playerScores[winner].yellow += points;
					}
				}
			}
		}
	}

	// ── GREEN: end-cell scoring ──
	const greenZone = boardState.zones.green;
	if (greenZone) {
		Object.values(greenZone.cells).forEach(cell => {
			if (cell.active && cell.flags.includes('end') && cell.playerId) {
				const points = getGreenEndCellPoints(greenZone, cell);
				if (playerScores[cell.playerId]) {
					playerScores[cell.playerId].green += points;
				}
			}
		});
	}

	// ── BLUE: escalerende bold-rij scoring ──
	const blueZone = boardState.zones.blue;
	if (blueZone) {
		const sortedBoldYs = [...new Set(
			(blueZone.boldRows || findBoldRows(blueZone))
		)].sort((a, b) => b - a);

		for (let tierIndex = 0; tierIndex < sortedBoldYs.length; tierIndex++) {
			const boldY = sortedBoldYs[tierIndex];
			// Check of er minstens 1 actieve bold cel is in deze rij
			let hasActiveBold = false;
			const rowCells = [];
			for (let x = 0; x < blueZone.cols; x++) {
				const cell = getDataCell(blueZone, x, boldY);
				if (cell) {
					rowCells.push(cell);
					if (cell.active && cell.flags.includes('bold')) {
						hasActiveBold = true;
					}
				}
			}
			if (hasActiveBold && rowCells.length > 0) {
				const points = getBlueTierPoints(tierIndex, sortedBoldYs.length);
				// Punten gaan naar de pionier: eerste speler die een bold-cel in deze rij activeerde
				const winner = getBlueRowPioneerOwner(rowCells);
				if (winner && playerScores[winner]) {
					playerScores[winner].blue += points;
				}
			}
		}
	}

	// ── RED: subgrid scoring ──
	const redZone = boardState.zones.red;
	if (redZone && redZone.subgrids) {
		for (const subgrid of redZone.subgrids) {
			const info = getRedSubgridScoreInfo(subgrid);
			if (!info.isPartialReached || info.basePoints <= 0) continue;
			const activeCells = Object.values(subgrid.cells).filter(c => c.active);

			// Base score (80%) gaat naar de speler die de drempel als eerste bereikte.
			const thresholdOwner = getRedThresholdReachedOwner(subgrid, info);
			if (thresholdOwner && playerScores[thresholdOwner]) {
				playerScores[thresholdOwner].red += info.basePoints;
			}

			// Alleen bij 100% krijgt de afmaker extra full-bonus punten.
			if (info.isFull && info.fullBonusPoints > 0) {
				const fullOwner = getLatestPlacerOwner(activeCells);
				if (fullOwner && playerScores[fullOwner]) {
					playerScores[fullOwner].red += info.fullBonusPoints;
				}
			}
		}
	}

	// ── PURPLE: cluster scoring ──
	const purpleZone = boardState.zones.purple;
	if (purpleZone) {
		const events = buildPurpleConnectionEvents(purpleZone);
		for (let i = 0; i < events.length; i++) {
			const ev = events[i];
			if (!ev?.playerId || !playerScores[ev.playerId]) continue;
			playerScores[ev.playerId].purple += getPurpleConnectionPoints(i + 1);
		}
	}

	// ── BALANCE BONUS per speler ──
	for (const pid of playerIds) {
		const s = playerScores[pid];
		s.bonus = calculateBalanceBonus(s.yellow, s.green, s.blue, s.red, s.purple);
		s.total = s.yellow + s.green + s.blue + s.red + s.purple + s.bonus;
	}

	return playerScores;
}

/**
 * Herbereken scores voor alle spelers op basis van actuele bordstaat.
 * Dit voorkomt vertraagde score-sprongen tussen beurten.
 */
function recalcScoresForActivePlayer(gameState) {
	const playerScores = calculatePlayerScores(gameState.boardState, gameState.playerOrder);
	const currentPlayerId = gameState.playerOrder[gameState.currentTurnIndex];
	const isRewarding = !!gameState.settings?.rewardingMode;

	// Objective achievement voor actieve speler direct markeren
	checkAndAwardObjective(gameState, currentPlayerId);

	for (const pid of gameState.playerOrder) {
		const player = gameState.players[pid];
		const objectiveBonus = player?.objectiveAchieved ? (player.objectiveAchievedPoints || 0) : 0;
		// Beloningsmodus: coins en parels tellen mee als punten (5 per stuk)
		// Coin modus: coins geven GEEN punten
		const coinPoints = isRewarding && !gameState.settings?.coinMode ? (player?.goldCoins || 0) * 5 : 0;
		const totalWithObjective = (playerScores[pid].total || 0) + objectiveBonus + coinPoints;
		gameState.players[pid].score = totalWithObjective;
		gameState.players[pid].scoreBreakdown = {
			...playerScores[pid],
			objectiveBonus,
			coinPoints,
			total: totalWithObjective
		};
		playerScores[pid] = gameState.players[pid].scoreBreakdown;
	}

	return playerScores;
}

/** Check if active player just achieved their objective and award points immediately */
function checkAndAwardObjective(gameState, playerId) {
	const player = gameState.players[playerId];
	if (!player || !player.chosenObjective) return;
	if (player.objectiveAchieved) return; // Already awarded
	if (player.chosenObjective.endOnly) return;

	const result = checkObjective(gameState, playerId, player.chosenObjective);
	if (result.achieved) {
		awardObjectiveRewards(gameState, playerId, player.chosenObjective, result);
	} else if (result.failed && !player.objectiveFailed) {
		player.objectiveFailed = true;
	}
}

/** Geeft de speler met de meeste cellen in een groep */
function getMajorityOwner(cells) {
	const counts = {};
	for (const c of cells) {
		if (c.playerId) {
			counts[c.playerId] = (counts[c.playerId] || 0) + 1;
		}
	}
	const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
	return sorted.length > 0 ? sorted[0][0] : null;
}

/** Geeft de eigenaar van de laatst geplaatste cel in een scorende groep (fallback: majority). */
function getLatestPlacerOwner(cells) {
	let latestCell = null;
	for (const c of cells || []) {
		if (!c || !c.playerId || !c.active) continue;
		const order = Number.isFinite(c.placementOrder) ? c.placementOrder : -1;
		if (!latestCell || order > (Number.isFinite(latestCell.placementOrder) ? latestCell.placementOrder : -1)) {
			latestCell = c;
		}
	}
	if (latestCell?.playerId) return latestCell.playerId;
	return getMajorityOwner(cells);
}

function getPurpleClusterOwner(cells) {
	const activeCells = (cells || []).filter(c => c && c.active && c.playerId && !c.isStone);
	if (activeCells.length === 0) return null;

	const boldCells = activeCells.filter(c => Array.isArray(c.flags) && c.flags.includes('bold'));
	const ownerPool = boldCells.length > 0 ? boldCells : activeCells;

	const counts = {};
	for (const c of ownerPool) {
		counts[c.playerId] = (counts[c.playerId] || 0) + 1;
	}

	const topCount = Math.max(...Object.values(counts));
	const topOwners = Object.keys(counts).filter(pid => counts[pid] === topCount);
	if (topOwners.length === 1) return topOwners[0];

	const tieCells = ownerPool.filter(c => topOwners.includes(c.playerId));
	return getLatestPlacerOwner(tieCells);
}

function getRedThresholdReachedOwner(subgrid, scoreInfo) {
	if (!subgrid?.cells || !scoreInfo?.isPartialReached) return null;
	const activeCells = Object.values(subgrid.cells)
		.filter(c => c && c.active && c.playerId)
		.sort((a, b) => {
			const ao = Number.isFinite(a.placementOrder) ? a.placementOrder : Number.MAX_SAFE_INTEGER;
			const bo = Number.isFinite(b.placementOrder) ? b.placementOrder : Number.MAX_SAFE_INTEGER;
			return ao - bo;
		});

	if (activeCells.length === 0) return null;
	const thresholdCount = Math.max(1, Math.ceil(scoreInfo.totalCount * RED_PARTIAL_THRESHOLD));
	let filled = 0;
	for (const cell of activeCells) {
		filled++;
		if (filled >= thresholdCount) {
			return cell.playerId || null;
		}
	}
	return activeCells[activeCells.length - 1]?.playerId || null;
}

// ──────────────────────────────────────────────
//  COLOR → ZONE MAPPING
// ──────────────────────────────────────────────

/**
 * Bepaal op welke zones een kaart geplaatst mag worden.
 * Kleur 'rood' → alleen red subgrids
 * Kleur 'groen' → alleen green
 * Kleur 'gouden' → elk zone (wildcard)
 * Kleur 'multikleur' → elk zone (wildcard)
 */
function getAllowedZones(card) {
	// Golden cards follow their own color zone (they're played as extra, not wildcard)
	const isMultikleur = card?.color?.name === 'multikleur'
		|| card?.color?.code === 'rainbow'
		|| card?.color?.zone === 'any';
	if (isMultikleur) return ['yellow', 'green', 'blue', 'red', 'purple'];
	if (card.isStone || card.color?.isStone) return ['yellow', 'green', 'blue', 'red', 'purple'];

	const colorToZone = {
		'rood': ['red'],
		'groen': ['green'],
		'blauw': ['blue'],
		'geel': ['yellow'],
		'paars': ['purple']
	};
	return colorToZone[card.color?.name] || [];
}

// ──────────────────────────────────────────────
//  OBJECTIVES
// ──────────────────────────────────────────────

const OBJECTIVE_TEMPLATES = [
	{
		id: 'fill_yellow_cols',
		name: 'Gele Kolommen',
		description: 'Vul minstens {target} complete kolommen in de gele zone.',
		check: (boardState) => {
			const zone = boardState.zones.yellow;
			if (!zone) return 0;
			let count = 0;
			for (let x = 0; x < zone.cols; x++) {
				let complete = true;
				for (let y = 0; y < zone.rows; y++) {
					const cell = getDataCell(zone, x, y);
					if (!cell || !cell.active) { complete = false; break; }
				}
				if (complete) count++;
			}
			return count;
		},
		targets: [2, 3, 5]
	},
	{
		id: 'reach_green_ends',
		name: 'Groene Eindpunten',
		description: 'Bereik minstens {target} eindpunten in de groene zone.',
		check: (boardState) => {
			const zone = boardState.zones.green;
			if (!zone) return 0;
			return Object.values(zone.cells).filter(c => c.active && c.flags.includes('end')).length;
		},
		targets: [3, 5, 8]
	},
	{
		id: 'complete_blue_rows',
		name: 'Blauwe Hoogte',
		description: 'Bereik minstens rij-niveau {target} in de blauwe zone.',
		check: (boardState) => {
			const zone = boardState.zones.blue;
			return getBlueHighestReachedTier(zone);
		},
		targets: [1, 2, 3]
	},
	{
		id: 'fill_red_grids',
		name: 'Rode Grids',
		description: 'Vul minstens {target} rode subgrids volledig.',
		check: (boardState) => {
			const zone = boardState.zones.red;
			if (!zone || !zone.subgrids) return 0;
			return zone.subgrids.filter(sg => {
				const cells = Object.values(sg.cells);
				return cells.length > 0 && cells.every(c => c.active);
			}).length;
		},
		targets: [1, 2, 3]
	},
	{
		id: 'purple_cluster',
		name: 'Paarse Netwerk',
		description: 'Verbind minstens {target} bold-cellen in één paars cluster.',
		check: (boardState) => {
			const zone = boardState.zones.purple;
			if (!zone) return 0;
			const visited = new Set();
			let maxBoldsInCluster = 0;
			const activeCells = Object.values(zone.cells).filter(c => c.active);
			for (const startCell of activeCells) {
				if (visited.has(`${startCell.x},${startCell.y}`)) continue;
				const queue = [startCell];
				let boldCount = 0;
				visited.add(`${startCell.x},${startCell.y}`);
				while (queue.length > 0) {
					const cur = queue.shift();
					if (cur.flags.includes('bold')) boldCount++;
					for (const n of [
						getDataCell(zone, cur.x-1, cur.y), getDataCell(zone, cur.x+1, cur.y),
						getDataCell(zone, cur.x, cur.y-1), getDataCell(zone, cur.x, cur.y+1)
					]) {
						if (n && n.active && !visited.has(`${n.x},${n.y}`)) {
							visited.add(`${n.x},${n.y}`);
							queue.push(n);
						}
					}
				}
				maxBoldsInCluster = Math.max(maxBoldsInCluster, boldCount);
			}
			return maxBoldsInCluster;
		},
		targets: [2, 3, 4]
	},
	{
		id: 'balance_bonus',
		name: 'Alle Zones',
		description: 'Behaal een balance bonus van minstens {target} punten.',
		check: (boardState) => {
			const scores = calculateScores(boardState);
			return scores.bonus;
		},
		targets: [5, 10, 15]
	},
	{
		id: 'collect_gold',
		name: 'Goudzoeker',
		description: 'Activeer minstens {target} gouden cellen.',
		check: (boardState) => {
			let count = 0;
			const zones = [boardState.zones.yellow, boardState.zones.green, boardState.zones.blue, boardState.zones.purple];
			for (const z of zones) {
				if (!z) continue;
				Object.values(z.cells).forEach(c => {
					if (c.active && c.flags.includes('gold')) count++;
				});
			}
			if (boardState.zones.red?.subgrids) {
				for (const sg of boardState.zones.red.subgrids) {
					Object.values(sg.cells).forEach(c => {
						if (c.active && c.flags.includes('gold')) count++;
					});
				}
			}
			return count;
		},
		targets: [3, 5, 8]
	}
];

function buildObjectiveContext(gameState, playerId) {
	const boardState = gameState?.boardState || null;
	const playerOrder = Array.isArray(gameState?.playerOrder) ? gameState.playerOrder : [];
	const playerScores = boardState && playerOrder.length > 0
		? calculatePlayerScores(boardState, playerOrder)
		: {};
	const idx = playerOrder.indexOf(playerId);
	const hasOrder = idx >= 0 && playerOrder.length > 0;
	const previousPlayerId = hasOrder ? playerOrder[(idx - 1 + playerOrder.length) % playerOrder.length] : null;
	const nextPlayerId = hasOrder ? playerOrder[(idx + 1) % playerOrder.length] : null;
	const playerScore = playerScores[playerId] || { yellow: 0, green: 0, blue: 0, red: 0, purple: 0, bonus: 0, total: 0 };

	return {
		gameState,
		boardState,
		playerId,
		playerOrder,
		playerScores,
		playerScore,
		previousPlayerId,
		nextPlayerId
	};
}

const OBJECTIVE_BONUS_COLORS = ['yellow', 'red', 'green', 'purple', 'blue'];

function getObjectiveRewardPoints(objective, fallback = 15) {
	if (Number.isFinite(objective?.points)) return Math.max(0, Math.floor(objective.points));
	return Math.max(0, Math.floor(fallback || 0));
}

function getObjectiveRewardCoins(objective) {
	if (!Number.isFinite(objective?.coins)) return 0;
	return Math.max(0, Math.floor(objective.coins));
}

function getObjectiveRandomBonuses(objective) {
	if (!Number.isFinite(objective?.randomBonuses)) return 0;
	return Math.max(0, Math.floor(objective.randomBonuses));
}

function objectiveRewardsToText(objective) {
	const parts = [];
	const pts = getObjectiveRewardPoints(objective, 0);
	const coins = getObjectiveRewardCoins(objective);
	const randomBonuses = getObjectiveRandomBonuses(objective);
	if (pts > 0) parts.push(`${pts} punten`);
	if (coins > 0) parts.push(`${coins} munten`);
	if (randomBonuses > 0) parts.push(`${randomBonuses} random bonussen`);
	return parts.join(' + ');
}

function pickRandomBonusColors(rng, count) {
	const picked = [];
	for (let i = 0; i < count; i++) {
		picked.push(OBJECTIVE_BONUS_COLORS[Math.floor(rng() * OBJECTIVE_BONUS_COLORS.length)]);
	}
	return picked;
}

function awardObjectiveRewards(gameState, playerId, objective, result) {
	const player = gameState?.players?.[playerId];
	if (!player) return;
	if (player.objectiveAchieved) return;

	const points = Number.isFinite(result?.points)
		? getObjectiveRewardPoints({ points: result.points }, 0)
		: getObjectiveRewardPoints(objective, 15);
	const coins = Number.isFinite(result?.coins)
		? getObjectiveRewardCoins({ coins: result.coins })
		: getObjectiveRewardCoins(objective);
	const randomBonuses = Number.isFinite(result?.randomBonuses)
		? getObjectiveRandomBonuses({ randomBonuses: result.randomBonuses })
		: getObjectiveRandomBonuses(objective);

	player.objectiveAchieved = true;
	player.objectiveFailed = false; // Kan nooit gelijktijdig behaald én mislukt zijn
	player.objectiveAchievedPoints = points;

	if (coins > 0) {
		player.goldCoins = (player.goldCoins || 0) + coins;
	}

	if (randomBonuses > 0) {
		const rngSeed = (gameState.seed | 0)
			^ hashStringToInt(`objective-reward-${gameState.level || 1}-${playerId}-${gameState.turnCount || 0}-${gameState.moveHistory?.length || 0}`)
			^ hashStringToInt(objective?.id || 'objective');
		const rewardRng = createRNG(rngSeed);
		const colors = pickRandomBonusColors(rewardRng, randomBonuses);
		for (const color of colors) {
			player.bonusInventory[color] = (player.bonusInventory[color] || 0) + 1;
		}
	}
}

function pickTargetPlayerForSabotage(gameState, sourcePlayerId, rng) {
	const playerOrder = Array.isArray(gameState?.playerOrder) ? gameState.playerOrder : [];
	const candidates = playerOrder.filter(pid => pid && pid !== sourcePlayerId && gameState.players?.[pid]?.connected !== false);
	if (candidates.length === 0) return null;

	const targetPlayerId = candidates[Math.floor(rng() * candidates.length)];
	return targetPlayerId;
}

function isNamedSabotageObjective(objective) {
	if (!objective) return false;
	if (objective.dynamicType === 'deny_named_objective') return true;
	return typeof objective.id === 'string' && /^deny_named_l\d+$/i.test(objective.id);
}

function syncSabotageObjectiveTarget(gameState, sourcePlayerId, objective) {
	if (!isNamedSabotageObjective(objective)) return objective;
	const targetPid = objective.targetPlayerId;
	const targetPlayer = targetPid ? gameState?.players?.[targetPid] : null;
	if (!targetPid || !targetPlayer) return objective;

	const targetPlayerName = targetPlayer.name || targetPid;
	const chosen = targetPlayer.chosenObjective || null;
	objective.name = `Blokkeer ${targetPlayerName}`;

	if (!chosen) {
		objective.targetObjectiveId = null;
		objective.targetObjectiveName = null;
		objective.description = `Zorg dat ${targetPlayerName} zijn/haar gekozen doel niet haalt.`;
		return objective;
	}

	objective.targetObjectiveId = chosen.id || null;
	objective.targetObjectiveName = chosen.name || 'Doelstelling';
	// Prevent infinite description loop when two players block each other
	if (isNamedSabotageObjective(chosen)) {
		objective.description = `Zorg dat ${targetPlayerName} zijn/haar doel niet haalt: ${chosen.name || 'Doelstelling'}.`;
	} else {
		objective.description = `Zorg dat ${targetPlayerName} zijn/haar doel niet haalt: ${chosen.name || 'Doelstelling'} — ${chosen.description || ''}`;
	}
	return objective;
}

function refreshSabotageObjectivesForTarget(gameState, targetPlayerId) {
	if (!gameState || !targetPlayerId) return;
	for (const pid of gameState.playerOrder || []) {
		const player = gameState.players?.[pid];
		if (!player?.chosenObjective) continue;
		if (!isNamedSabotageObjective(player.chosenObjective)) continue;
		if (player.chosenObjective.targetPlayerId !== targetPlayerId) continue;
		syncSabotageObjectiveTarget(gameState, pid, player.chosenObjective);
	}
}

function materializeObjectiveForPlayer(baseObjective, gameState, playerId, rng) {
	const objective = { ...baseObjective };
	if (!objective.dynamicType || objective.dynamicType !== 'deny_named_objective') {
		return objective;
	}

	const targetPlayerId = pickTargetPlayerForSabotage(gameState, playerId, rng);
	if (!targetPlayerId) {
		objective.name = 'Sabotage Opdracht';
		objective.description = 'Zorg dat een andere speler zijn of haar doelstelling niet haalt.';
		return objective;
	}

	objective.targetPlayerId = targetPlayerId;
	syncSabotageObjectiveTarget(gameState, playerId, objective);
	return objective;
}

function countPlayerCompletedYellowCols(boardState, playerId) {
	const zone = boardState?.zones?.yellow;
	if (!zone || !playerId) return 0;
	// Voor diagonal mode: tel voltooide diagonale segmenten
	if (zone.scoreMode === 'diagonal') return countYellowCompletedDiagonals(zone);
	// Voor rings mode: tel voltooide ringen
	if (zone.scoreMode === 'rings') return countYellowCompletedRings(zone);
	// Default: kolommen
	let count = 0;
	for (let x = 0; x < zone.cols; x++) {
		if (hasStoneInYellowColumn(zone, x)) continue;
		const colCells = [];
		let complete = true;
		for (let y = 0; y < zone.rows; y++) {
			const cell = getDataCell(zone, x, y);
			if (!cell) continue;
			if (!cell.active) { complete = false; break; }
			colCells.push(cell);
		}
		if (!complete || colCells.length === 0) continue;
		if (getLatestPlacerOwner(colCells) === playerId) count++;
	}
	return count;
}

function countPlayerGreenEnds(boardState, playerId) {
	const zone = boardState?.zones?.green;
	if (!zone || !playerId) return 0;
	return Object.values(zone.cells).filter(c => c.active && c.flags.includes('end') && c.playerId === playerId).length;
}

function getPlayerBlueHighestTier(boardState, playerId) {
	const zone = boardState?.zones?.blue;
	if (!zone || !playerId) return 0;
	const boldYs = [...new Set(zone.boldRows || findBoldRows(zone))].sort((a, b) => b - a);
	let tier = 0;
	for (let i = 0; i < boldYs.length; i++) {
		const y = boldYs[i];
		const rowCells = [];
		for (let x = 0; x < zone.cols; x++) {
			const cell = getDataCell(zone, x, y);
			if (cell) rowCells.push(cell);
		}
		const pioneer = getBlueRowPioneerOwner(rowCells);
		if (pioneer === playerId) tier++;
	}
	return tier;
}

function countPlayerCompletedRedSubgrids(boardState, playerId) {
	const zone = boardState?.zones?.red;
	if (!zone?.subgrids || !playerId) return 0;
	let count = 0;
	for (const sg of zone.subgrids) {
		const allCells = Object.values(sg.cells);
		if (allCells.length === 0) continue;
		if (allCells.some(c => c?.isStone)) continue;
		if (!allCells.every(c => c.active)) continue;
		if (getLatestPlacerOwner(allCells) === playerId) count++;
	}
	return count;
}

function countPlayerZonesAtLeast(playerScore, minScore) {
	const threshold = Math.max(0, Number(minScore) || 0);
	const score = playerScore || {};
	let count = 0;
	for (const zoneKey of ['yellow', 'green', 'blue', 'red', 'purple']) {
		if ((Number(score[zoneKey]) || 0) >= threshold) count++;
	}
	return count;
}

function getPlayerPurpleMaxBoldCluster(boardState, playerId) {
	const zone = boardState?.zones?.purple;
	if (!zone || !playerId) return 0;
	const visited = new Set();
	let maxBold = 0;
	for (const startCell of Object.values(zone.cells).filter(c => c.active && !c.isStone)) {
		const key = `${startCell.x},${startCell.y}`;
		if (visited.has(key)) continue;
		const queue = [startCell];
		const cluster = [];
		visited.add(key);
		while (queue.length) {
			const cur = queue.shift();
			cluster.push(cur);
			for (const n of [
				getDataCell(zone, cur.x - 1, cur.y),
				getDataCell(zone, cur.x + 1, cur.y),
				getDataCell(zone, cur.x, cur.y - 1),
				getDataCell(zone, cur.x, cur.y + 1)
			]) {
				if (n && n.active && !n.isStone && !visited.has(`${n.x},${n.y}`)) {
					visited.add(`${n.x},${n.y}`);
					queue.push(n);
				}
			}
		}
		const ownBoldCount = cluster.filter(c => c.flags.includes('bold') && c.playerId === playerId).length;
		maxBold = Math.max(maxBold, ownBoldCount);
	}
	return maxBold;
}

function countPlayerGoldCells(boardState, playerId) {
	if (!boardState || !playerId) return 0;
	let count = 0;
	for (const zone of [boardState.zones.yellow, boardState.zones.green, boardState.zones.blue, boardState.zones.purple]) {
		if (!zone) continue;
		for (const cell of Object.values(zone.cells)) {
			if (cell.active && cell.flags.includes('gold') && cell.playerId === playerId) count++;
		}
	}
	for (const sg of boardState.zones.red?.subgrids || []) {
		for (const cell of Object.values(sg.cells)) {
			if (cell.active && cell.flags.includes('gold') && cell.playerId === playerId) count++;
		}
	}
	return count;
}

/**
 * Per-level objectives met oplopende moeilijkheid.
 * Level 1 = makkelijk, level 2 = medium, level 3 = moeilijk.
 * Elk objective heeft punten afhankelijk van moeilijkheid.
 */
const LEVEL_OBJECTIVES = {
	// Level 1: Makkelijke doelstellingen (8-12 punten)
	1: [
		{ id: 'fill_2_yellow_cols', name: 'Gele Start', description: 'Vul minstens 2 kolommen in de gele zone.', target: 2, points: 10, coins: 2,
		  useContext: true, check: (ctx) => countPlayerCompletedYellowCols(ctx.boardState, ctx.playerId)},
		{ id: 'reach_1_green_end', legacyIds: ['reach_2_green_ends'], name: 'Groene Verkenner', description: 'Bereik minstens 2 eindpunten in de groene zone.', target: 2, points: 10, randomBonuses: 1, coins: 2,
		  useContext: true, check: (ctx) => countPlayerGreenEnds(ctx.boardState, ctx.playerId)},
		{ id: 'fill_1_blue_row', name: 'Blauwe Basis', description: 'Bereik minstens 2 rijen in de blauwe zone.', target: 2, points: 10, randomBonuses: 2,
		  useContext: true, check: (ctx) => getPlayerBlueHighestTier(ctx.boardState, ctx.playerId)},
		{ id: 'connect_2_purple', name: 'Paars Verbinden', description: 'Verbind minstens 3 bold-cellen in één paars cluster.', target: 3, points: 6, randomBonuses: 3,
		  useContext: true, check: (ctx) => getPlayerPurpleMaxBoldCluster(ctx.boardState, ctx.playerId)},
		{ id: 'collect_2_gold', name: 'Goudzoeker', description: 'Verzamel minstens 3 gouden munten.', target: 3, points: 10,
		  useContext: true, check: (ctx) => countPlayerGoldCells(ctx.boardState, ctx.playerId)},
		{ id: 'deny_named_l1', name: 'Lichte Sabotage', description: 'Zorg dat een gekozen speler zijn/haar doel niet haalt.', target: 1, points: 10, coins: 2, useContext: true, endOnly: true, dynamicType: 'deny_named_objective',
		  check: (ctx, objective) => {
			const player = ctx?.gameState?.players?.[ctx?.playerId];
			if (player?._mutualSabotageFailed) return 0;
			const targetPid = objective?.targetPlayerId;
			if (!targetPid || targetPid === ctx?.playerId) return 0;
			const targetPlayer = ctx?.gameState?.players?.[targetPid];
			if (!targetPlayer?.chosenObjective) return 0;
			return targetPlayer.objectiveAchieved ? 0 : 1;
		  },
		  failCheck: (ctx, objective) => {
			const player = ctx?.gameState?.players?.[ctx?.playerId];
			if (player?._mutualSabotageFailed) return true;
			const targetPid = objective?.targetPlayerId;
			if (!targetPid || targetPid === ctx?.playerId) return true;
			const targetPlayer = ctx?.gameState?.players?.[targetPid];
			if (!targetPlayer?.chosenObjective) return false;
			return !!targetPlayer.objectiveAchieved;
		  }},
	],
	// Level 2: Medium doelstellingen (12-18 punten)
	2: [
		{ id: 'fill_4_yellow_cols', name: 'Gele Muur', description: 'Vul minstens 4 kolommen in de gele zone.', target: 4, points: 30, coins: 3,
		  useContext: true, check: (ctx) => countPlayerCompletedYellowCols(ctx.boardState, ctx.playerId)},
		{ id: 'reach_2_green_ends_l2', legacyIds: ['reach_5_green_ends'], name: 'Groene Expeditie', description: 'Bereik minstens 3 eindpunten in de groene zone.', target: 3, points: 30, coins: 3,
		  useContext: true, check: (ctx) => countPlayerGreenEnds(ctx.boardState, ctx.playerId)},
		{ id: 'fill_2_blue_rows', name: 'Blauwe Toren', description: 'Bereik minstens 3 rijen in de blauwe zone.', target: 3, points: 30, randomBonuses: 3,
		  useContext: true, check: (ctx) => getPlayerBlueHighestTier(ctx.boardState, ctx.playerId)},
		{ id: 'fill_1_red_grid', legacyIds: ['fill_2_red_grids'], name: 'Rode Grids', description: 'Vul een rood grid volledig.', target: 1, points: 0, coins: 5,
		  useContext: true, check: (ctx) => countPlayerCompletedRedSubgrids(ctx.boardState, ctx.playerId)},
		{ id: 'connect_3_purple', name: 'Paars Netwerk', description: 'Verbind minstens 5 bold-cellen in één paars cluster.', target: 5, points: 30, randomBonuses: 3,
		  useContext: true, check: (ctx) => getPlayerPurpleMaxBoldCluster(ctx.boardState, ctx.playerId)},
		{ id: 'combo_yellow2_green1end', name: 'Geel + Groen Combo', description: 'Haal minstens 3 gele kolommen én 2 groene eindpunten.', target: 2, points: 40, coins: 4, useContext: true,
		  check: (ctx) => {
			let done = 0;
			if (countPlayerCompletedYellowCols(ctx.boardState, ctx.playerId) >= 3) done++;
			if (countPlayerGreenEnds(ctx.boardState, ctx.playerId) >= 2) done++;
			return done;
		  }},
		{ id: 'combo_blue2_purple4', name: 'Blauw + Paars Combo', description: 'Bereik 2 blauwe rijen én verbind 4 paarse bold-cellen.', target: 2, points: 40, randomBonuses: 3, useContext: true,
		  check: (ctx) => {
			let done = 0;
			if (getPlayerBlueHighestTier(ctx.boardState, ctx.playerId) >= 2) done++;
			if (getPlayerPurpleMaxBoldCluster(ctx.boardState, ctx.playerId) >= 4) done++;
			return done;
		  }},
		{ id: 'collect_5_gold', name: 'Goudmijn', description: 'Verzamel minstens 5 gouden munten.', target: 5, points: 30,
		  useContext: true, check: (ctx) => countPlayerGoldCells(ctx.boardState, ctx.playerId)},
		{ id: 'balance_10', name: 'Meester Evenwicht', description: 'Behaal overal tenminste 10 punten.', target: 10, coins: 7,
		  useContext: true, check: (ctx) => countPlayerZonesAtLeast(ctx?.playerScore, 10) },
		{ id: 'deny_named_l2', name: 'Gerichte Sabotage', description: 'Zorg dat een gekozen speler zijn/haar doel niet haalt.', target: 1, points: 25, coins: 3, useContext: true, endOnly: true, dynamicType: 'deny_named_objective',
		  check: (ctx, objective) => {
			const player = ctx?.gameState?.players?.[ctx?.playerId];
			if (player?._mutualSabotageFailed) return 0;
			const targetPid = objective?.targetPlayerId;
			if (!targetPid || targetPid === ctx?.playerId) return 0;
			const targetPlayer = ctx?.gameState?.players?.[targetPid];
			if (!targetPlayer?.chosenObjective) return 0;
			return targetPlayer.objectiveAchieved ? 0 : 1;
		  },
		  failCheck: (ctx, objective) => {
			const player = ctx?.gameState?.players?.[ctx?.playerId];
			if (player?._mutualSabotageFailed) return true;
			const targetPid = objective?.targetPlayerId;
			if (!targetPid || targetPid === ctx?.playerId) return true;
			const targetPlayer = ctx?.gameState?.players?.[targetPid];
			if (!targetPlayer?.chosenObjective) return false;
			return !!targetPlayer.objectiveAchieved;
		  }},
	],
	// Level 3: Moeilijke doelstellingen (18-25 punten)
	3: [
		{ id: 'fill_6_yellow_cols', name: 'Gele Dominantie', description: 'Vul minstens 6 kolommen in de gele zone.', target: 6, points: 50, coins: 3,
		  useContext: true, check: (ctx) => countPlayerCompletedYellowCols(ctx.boardState, ctx.playerId)},
		{ id: 'reach_6_green_ends', legacyIds: ['reach_8_green_ends'], name: 'Groene Meester', description: 'Bereik minstens 6 eindpunten in de groene zone.', target: 6, points: 50, coins: 4,
		  useContext: true, check: (ctx) => countPlayerGreenEnds(ctx.boardState, ctx.playerId)},
		{ id: 'fill_3_blue_rows', name: 'Blauwe Hemel', description: 'Bereik minstens 3 rijen in de blauwe zone.', target: 3, points: 50, randomBonuses: 3,
		  useContext: true, check: (ctx) => getPlayerBlueHighestTier(ctx.boardState, ctx.playerId)},
		{ id: 'fill_2_red_grids_l3', legacyIds: ['fill_3_red_grids'], name: 'Rode Dominantie', description: 'Vul minstens 2 rode subgrids volledig.', target: 2, points: 0, coins: 8, randomBonuses: 2,
		  useContext: true, check: (ctx) => countPlayerCompletedRedSubgrids(ctx.boardState, ctx.playerId)},
		{ id: 'connect_4_purple', name: 'Paars Imperium', description: 'Verbind minstens 6 bold-cellen in één paars cluster.', target: 6, points: 40, randomBonuses: 3,
		  useContext: true, check: (ctx) => getPlayerPurpleMaxBoldCluster(ctx.boardState, ctx.playerId)},
		{ id: 'collect_8_gold', name: 'Gouden Schatkist', description: 'Verzamel minstens 8 munten.', target: 8, points: 40,
		  useContext: true, check: (ctx) => countPlayerGoldCells(ctx.boardState, ctx.playerId)},
		{ id: 'deny_adjacent_green', name: 'Groene Blokkade', description: 'Laat de speler na jou op 0 punten in groen eindigen.', target: 1, points: 50, coins: 3, useContext: true, endOnly: true,
		  check: (ctx) => {
			const nextPid = ctx?.nextPlayerId;
			if (!nextPid || nextPid === ctx?.playerId) return 0;
			return (((ctx?.playerScores?.[nextPid]?.green) || 0) === 0) ? 1 : 0;
		  },
		  failCheck: (ctx) => {
			const nextPid = ctx?.nextPlayerId;
			if (!nextPid || nextPid === ctx?.playerId) return false;
			return ((ctx?.playerScores?.[nextPid]?.green) || 0) > 0;
		  }},
		{ id: 'deny_blue_top_anyone', name: 'Blauw Afstoppen', description: 'Zorg dat niemand de top van blauw bereikt.', target: 1, points: 50, coins: 5, useContext: true, endOnly: true,
		  check: (ctx) => {
			const zone = ctx?.boardState?.zones?.blue;
			if (!zone) return 0;
			const reachedTier = getBlueHighestReachedTier(zone);
			const maxTier = [...new Set(zone.boldRows || findBoldRows(zone))].length || 0;
			if (maxTier <= 0) return 0;
			return reachedTier < maxTier ? 1 : 0;
		  },
		  failCheck: (ctx) => {
			const zone = ctx?.boardState?.zones?.blue;
			if (!zone) return false;
			const reachedTier = getBlueHighestReachedTier(zone);
			const maxTier = [...new Set(zone.boldRows || findBoldRows(zone))].length || 0;
			if (maxTier <= 0) return false;
			return reachedTier >= maxTier;
		  }},
		{ id: 'balance_15', name: 'Perfecte Balans', description: 'Behaal overal tenminste 15 punten.', target: 5, points: 50, coins: 8,
		  useContext: true, check: (ctx) => countPlayerZonesAtLeast(ctx?.playerScore, 15) },
		{ id: 'combo_yellow4_green3', name: 'Strakke Route', description: 'Haal 4 gele kolommen én 3 groene eindpunten.', target: 2, points: 50, coins: 6, useContext: true,
		  check: (ctx) => {
			let done = 0;
			if (countPlayerCompletedYellowCols(ctx.boardState, ctx.playerId) >= 4) done++;
			if (countPlayerGreenEnds(ctx.boardState, ctx.playerId) >= 3) done++;
			return done;
		  }},
		{ id: 'combo_red1_purple6', name: 'Diepe Impact', description: 'Vul 1 rood grid én verbind 6 paarse bold-cellen.', target: 2, points: 60, coins: 6, randomBonuses: 2, useContext: true,
		  check: (ctx) => {
			let done = 0;
			if (countPlayerCompletedRedSubgrids(ctx.boardState, ctx.playerId) >= 1) done++;
			if (getPlayerPurpleMaxBoldCluster(ctx.boardState, ctx.playerId) >= 6) done++;
			return done;
		  }},
		{ id: 'deny_named_l3', name: 'Elite Sabotage', description: 'Zorg dat een gekozen speler zijn/haar doel niet haalt.', target: 1, points: 50, coins: 5, randomBonuses: 2, useContext: true, endOnly: true, dynamicType: 'deny_named_objective',
		  check: (ctx, objective) => {
			const player = ctx?.gameState?.players?.[ctx?.playerId];
			if (player?._mutualSabotageFailed) return 0;
			const targetPid = objective?.targetPlayerId;
			if (!targetPid || targetPid === ctx?.playerId) return 0;
			const targetPlayer = ctx?.gameState?.players?.[targetPid];
			if (!targetPlayer?.chosenObjective) return 0;
			return targetPlayer.objectiveAchieved ? 0 : 1;
		  },
		  failCheck: (ctx, objective) => {
			const player = ctx?.gameState?.players?.[ctx?.playerId];
			if (player?._mutualSabotageFailed) return true;
			const targetPid = objective?.targetPlayerId;
			if (!targetPid || targetPid === ctx?.playerId) return true;
			const targetPlayer = ctx?.gameState?.players?.[targetPid];
			if (!targetPlayer?.chosenObjective) return false;
			return !!targetPlayer.objectiveAchieved;
		  }},
	],
	// Level 4+: Ultra moeilijke doelstellingen (vanaf 3/4 wins)
	4: [
		{ id: 'fill_8_yellow_units', name: 'Gele Meester', description: 'Vul minstens 8 gele eenheden (kolommen/diagonalen/ringen).', target: 8, points: 70, coins: 5,
		  useContext: true, check: (ctx) => countPlayerCompletedYellowCols(ctx.boardState, ctx.playerId)},
		{ id: 'reach_8_green_ends_l4', name: 'Groene Legende', description: 'Bereik minstens 8 eindpunten in de groene zone.', target: 8, points: 70, coins: 6,
		  useContext: true, check: (ctx) => countPlayerGreenEnds(ctx.boardState, ctx.playerId)},
		{ id: 'fill_5_blue_rows', name: 'Blauwe Toren', description: 'Bereik minstens 5 rijen in de blauwe zone.', target: 5, points: 70, randomBonuses: 4,
		  useContext: true, check: (ctx) => getPlayerBlueHighestTier(ctx.boardState, ctx.playerId)},
		{ id: 'fill_3_red_grids_l4', name: 'Rode Storm', description: 'Vul minstens 3 rode subgrids volledig.', target: 3, points: 0, coins: 12, randomBonuses: 3,
		  useContext: true, check: (ctx) => countPlayerCompletedRedSubgrids(ctx.boardState, ctx.playerId)},
		{ id: 'connect_8_purple', name: 'Paars Koninkrijk', description: 'Verbind minstens 8 bold-cellen in één paars cluster.', target: 8, points: 60, randomBonuses: 4,
		  useContext: true, check: (ctx) => getPlayerPurpleMaxBoldCluster(ctx.boardState, ctx.playerId)},
		{ id: 'connect_purple_corners', name: 'Paarse Hoeken', description: 'Activeer alle 4 hoek-bold-cellen in de paarse zone.', target: 4, points: 80, coins: 6, useContext: true,
		  check: (ctx) => {
			const zone = ctx?.boardState?.zones?.purple;
			if (!zone) return 0;
			const size = zone.rows || 0;
			const corners = [
				zone.cells[`0,0`], zone.cells[`${size-1},0`],
				zone.cells[`0,${size-1}`], zone.cells[`${size-1},${size-1}`]
			];
			return corners.filter(c => c && c.active && c.flags.includes('bold')).length;
		  }},
		{ id: 'balance_20', name: 'Ultieme Balans', description: 'Behaal overal tenminste 20 punten.', target: 5, points: 80, coins: 10,
		  useContext: true, check: (ctx) => countPlayerZonesAtLeast(ctx?.playerScore, 20) },
		{ id: 'collect_12_gold', name: 'Gouden Imperium', description: 'Verzamel minstens 12 munten.', target: 12, points: 60,
		  useContext: true, check: (ctx) => countPlayerGoldCells(ctx.boardState, ctx.playerId)},
		{ id: 'combo_red2_blue4', name: 'Rode Blauw Combo', description: 'Vul 2 rode grids én bereik 4 blauwe rijen.', target: 2, points: 80, coins: 8, useContext: true,
		  check: (ctx) => {
			let done = 0;
			if (countPlayerCompletedRedSubgrids(ctx.boardState, ctx.playerId) >= 2) done++;
			if (getPlayerBlueHighestTier(ctx.boardState, ctx.playerId) >= 4) done++;
			return done;
		  }},
		{ id: 'deny_named_l4', name: 'Ultieme Sabotage', description: 'Zorg dat een gekozen speler zijn/haar doel niet haalt.', target: 1, points: 70, coins: 8, randomBonuses: 3, useContext: true, endOnly: true, dynamicType: 'deny_named_objective',
		  check: (ctx, objective) => {
			const player = ctx?.gameState?.players?.[ctx?.playerId];
			if (player?._mutualSabotageFailed) return 0;
			const targetPid = objective?.targetPlayerId;
			if (!targetPid || targetPid === ctx?.playerId) return 0;
			const targetPlayer = ctx?.gameState?.players?.[targetPid];
			if (!targetPlayer?.chosenObjective) return 0;
			return targetPlayer.objectiveAchieved ? 0 : 1;
		  },
		  failCheck: (ctx, objective) => {
			const player = ctx?.gameState?.players?.[ctx?.playerId];
			if (player?._mutualSabotageFailed) return true;
			const targetPid = objective?.targetPlayerId;
			if (!targetPid || targetPid === ctx?.playerId) return true;
			const targetPlayer = ctx?.gameState?.players?.[targetPid];
			if (!targetPlayer?.chosenObjective) return false;
			return !!targetPlayer.objectiveAchieved;
		  }},
	]
};

/**
 * Coin mode objectives: simpeler, score-gebaseerd, schaalbaar per ronde.
 * Elke ronde wordt het iets moeilijker en levert meer punten op.
 */
function generateCoinModeObjectives(rng, level) {
	const round = Math.max(1, level || 1);
	// Basis scaling: hogere rondes = hogere targets en meer punten
	const pointsBase = 8 + round * 4;            // 12, 16, 20, 24, 28, ...
	const totalTarget = 10 + round * 8;           // 18, 26, 34, 42, 50, ...
	const singleColorTarget = 6 + round * 4;      // 10, 14, 18, 22, 26, ...
	const dualColorTarget = 4 + round * 3;         // 7, 10, 13, 16, 19, ...
	const balanceTarget = 2 + round * 2;           // 4, 6, 8, 10, 12, ...
	const yellowColTarget = Math.min(1 + round, 8);
	const greenEndTarget = Math.min(1 + round, 8);
	const blueRowTarget = Math.min(1 + Math.floor(round / 2), 5);
	const redGridTarget = Math.min(Math.ceil(round / 2), 3);
	const purpleBoldTarget = Math.min(2 + round, 8);

	const pool = [
		// Totaalscore doelen
		{ id: `coin_total_${round}`, name: 'Totaalscore', description: `Haal ${totalTarget} punten totaal.`, target: totalTarget, points: pointsBase, coins: round,
		  useContext: true, check: (ctx) => Math.min((ctx?.playerScore?.total || 0), totalTarget) },
		// Enkele kleur doelen
		{ id: `coin_yellow_${round}`, name: 'Geel Doel', description: `Scoor ${singleColorTarget} punten in geel.`, target: singleColorTarget, points: pointsBase, coins: round,
		  useContext: true, check: (ctx) => Math.min((ctx?.playerScore?.yellow || 0), singleColorTarget) },
		{ id: `coin_green_${round}`, name: 'Groen Doel', description: `Scoor ${singleColorTarget} punten in groen.`, target: singleColorTarget, points: pointsBase, coins: round,
		  useContext: true, check: (ctx) => Math.min((ctx?.playerScore?.green || 0), singleColorTarget) },
		{ id: `coin_blue_${round}`, name: 'Blauw Doel', description: `Scoor ${singleColorTarget} punten in blauw.`, target: singleColorTarget, points: pointsBase, coins: round,
		  useContext: true, check: (ctx) => Math.min((ctx?.playerScore?.blue || 0), singleColorTarget) },
		{ id: `coin_purple_${round}`, name: 'Paars Doel', description: `Scoor ${singleColorTarget} punten in paars.`, target: singleColorTarget, points: pointsBase, coins: round,
		  useContext: true, check: (ctx) => Math.min((ctx?.playerScore?.purple || 0), singleColorTarget) },
		{ id: `coin_red_${round}`, name: 'Rood Doel', description: `Scoor ${singleColorTarget} punten in rood.`, target: singleColorTarget, points: pointsBase, coins: round,
		  useContext: true, check: (ctx) => Math.min((ctx?.playerScore?.red || 0), singleColorTarget) },
		// Twee-kleuren combo's
		{ id: `coin_yellow_green_${round}`, name: 'Geel + Groen', description: `Scoor ${dualColorTarget} punten in geel en ${dualColorTarget} in groen.`, target: 2, points: pointsBase + 5, coins: round + 1,
		  useContext: true, check: (ctx) => {
			let done = 0;
			if ((ctx?.playerScore?.yellow || 0) >= dualColorTarget) done++;
			if ((ctx?.playerScore?.green || 0) >= dualColorTarget) done++;
			return done;
		  }},
		{ id: `coin_blue_purple_${round}`, name: 'Blauw + Paars', description: `Scoor ${dualColorTarget} punten in blauw en ${dualColorTarget} in paars.`, target: 2, points: pointsBase + 5, coins: round + 1,
		  useContext: true, check: (ctx) => {
			let done = 0;
			if ((ctx?.playerScore?.blue || 0) >= dualColorTarget) done++;
			if ((ctx?.playerScore?.purple || 0) >= dualColorTarget) done++;
			return done;
		  }},
		{ id: `coin_red_yellow_${round}`, name: 'Rood + Geel', description: `Scoor ${dualColorTarget} punten in rood en ${dualColorTarget} in geel.`, target: 2, points: pointsBase + 5, coins: round + 1,
		  useContext: true, check: (ctx) => {
			let done = 0;
			if ((ctx?.playerScore?.red || 0) >= dualColorTarget) done++;
			if ((ctx?.playerScore?.yellow || 0) >= dualColorTarget) done++;
			return done;
		  }},
		// Balans doel
		{ id: `coin_balance_${round}`, name: 'Evenwicht', description: `Behaal minstens ${balanceTarget} punten in elke kleur.`, target: 5, points: pointsBase + 10, coins: round + 2,
		  useContext: true, check: (ctx) => countPlayerZonesAtLeast(ctx?.playerScore, balanceTarget) },
		// Zone-specifieke doelen
		{ id: `coin_yellowcol_${round}`, name: 'Gele Kolommen', description: `Vul ${yellowColTarget} gele kolom${yellowColTarget > 1 ? 'men' : ''}.`, target: yellowColTarget, points: pointsBase + 5, coins: round + 1,
		  useContext: true, check: (ctx) => countPlayerCompletedYellowCols(ctx.boardState, ctx.playerId) },
		{ id: `coin_greenend_${round}`, name: 'Groene Eindpunten', description: `Bereik ${greenEndTarget} groene eindpunt${greenEndTarget > 1 ? 'en' : ''}.`, target: greenEndTarget, points: pointsBase + 5, coins: round + 1,
		  useContext: true, check: (ctx) => countPlayerGreenEnds(ctx.boardState, ctx.playerId) },
		{ id: `coin_bluerow_${round}`, name: 'Blauwe Rijen', description: `Bereik ${blueRowTarget} blauwe rij${blueRowTarget > 1 ? 'en' : ''}.`, target: blueRowTarget, points: pointsBase + 5, randomBonuses: Math.min(round, 3),
		  useContext: true, check: (ctx) => getPlayerBlueHighestTier(ctx.boardState, ctx.playerId) },
		{ id: `coin_redgrid_${round}`, name: 'Rode Grids', description: `Vul ${redGridTarget} rood${redGridTarget > 1 ? 'e' : ''} grid${redGridTarget > 1 ? 's' : ''}.`, target: redGridTarget, points: pointsBase + 5, coins: round + 2,
		  useContext: true, check: (ctx) => countPlayerCompletedRedSubgrids(ctx.boardState, ctx.playerId) },
		{ id: `coin_purple_bold_${round}`, name: 'Paars Cluster', description: `Verbind ${purpleBoldTarget} paarse bold-cellen.`, target: purpleBoldTarget, points: pointsBase + 5, randomBonuses: Math.min(round, 3),
		  useContext: true, check: (ctx) => getPlayerPurpleMaxBoldCluster(ctx.boardState, ctx.playerId) },
	];

	const shuffled = shuffleWithRNG([...pool], rng);
	return shuffled.slice(0, 3);
}

/** Genereer 3 objectives voor een level (level-afhankelijk) */
function generateObjectiveChoices(rng, level, gameState = null, playerId = null) {
	// Coin mode: gebruik simpelere score-gebaseerde doelen
	const isCoinMode = !!gameState?.settings?.coinMode;
	if (isCoinMode) {
		const coinObjs = generateCoinModeObjectives(rng, level);
		return coinObjs.map(obj => {
			const basePoints = getObjectiveRewardPoints(obj, 15);
			let baseCoins = getObjectiveRewardCoins(obj);
			let baseRandomBonuses = getObjectiveRandomBonuses(obj);
			return {
				id: obj.id,
				name: obj.name,
				description: obj.description,
				target: obj.target,
				points: basePoints,
				coins: baseCoins,
				randomBonuses: baseRandomBonuses,
				dynamicType: null,
				endOnly: false,
				targetPlayerId: null,
				targetObjectiveId: null,
				targetObjectiveName: null
			};
		});
	}
	// Objective moeilijkheid schaalt mee met maxWins
	const mw = gameState ? _getMaxWins(gameState) : 0;
	const effectiveLevel = Math.max(level || 1, mw >= 3 ? 4 : (mw >= 2 ? 3 : 1));
	const lvl = Math.min(effectiveLevel, 4);
	let pool = LEVEL_OBJECTIVES[lvl] || LEVEL_OBJECTIVES[3];
	const shuffled = shuffleWithRNG([...pool], rng);
	return shuffled.slice(0, 3).map(obj => {
		const materialized = materializeObjectiveForPlayer(obj, gameState, playerId, rng);
		const basePoints = getObjectiveRewardPoints(materialized, 15);
		let baseCoins = getObjectiveRewardCoins(materialized);
		let baseRandomBonuses = getObjectiveRandomBonuses(materialized);
		// End-only objectives: convert random bonuses to extra coins (2 coins per bonus)
		if (materialized.endOnly && baseRandomBonuses > 0) {
			baseCoins += baseRandomBonuses * 2;
			baseRandomBonuses = 0;
		}
		return {
			id: materialized.id,
			name: materialized.name,
			description: materialized.description,
			target: materialized.target,
			points: basePoints,
			coins: baseCoins,
			randomBonuses: baseRandomBonuses,
			dynamicType: materialized.dynamicType || null,
			endOnly: !!materialized.endOnly,
			targetPlayerId: materialized.targetPlayerId || null,
			targetObjectiveId: materialized.targetObjectiveId || null,
			targetObjectiveName: materialized.targetObjectiveName || null
		};
	});
}

function checkObjective(gameStateOrBoardState, playerIdOrObjective, maybeObjective) {
	let gameState = null;
	let boardState = null;
	let playerId = null;
	let objective = null;

	if (maybeObjective) {
		gameState = gameStateOrBoardState || null;
		boardState = gameState?.boardState || null;
		playerId = playerIdOrObjective || null;
		objective = maybeObjective;
	} else {
		boardState = gameStateOrBoardState || null;
		objective = playerIdOrObjective;
	}

	if (!objective) return { achieved: false, failed: false, current: 0, target: 0, points: 0 };
	const objectiveCtx = gameState ? buildObjectiveContext(gameState, playerId) : null;
	const activeBoardState = objectiveCtx?.boardState || boardState;
	const normalizedTarget = (objective.id === 'balance_10' || objective.id === 'balance_15')
		? 5
		: objective.target;

	// Zoek in alle levels
	for (const lvl of [1, 2, 3, 4]) {
		const tmpl = LEVEL_OBJECTIVES[lvl]?.find(t => t.id === objective.id || (Array.isArray(t.legacyIds) && t.legacyIds.includes(objective.id)));
		if (tmpl) {
			if (gameState && isNamedSabotageObjective(objective)) {
				syncSabotageObjectiveTarget(gameState, playerId, objective);
			}
			if (tmpl.useContext && !objectiveCtx) {
				return {
					achieved: false,
					failed: false,
					current: 0,
					target: normalizedTarget,
					points: getObjectiveRewardPoints(objective, 15),
					coins: getObjectiveRewardCoins(objective),
					randomBonuses: getObjectiveRandomBonuses(objective)
				};
			}
			const current = tmpl.useContext ? tmpl.check(objectiveCtx, objective) : tmpl.check(activeBoardState, objective);
			const failed = tmpl.failCheck
				? !!(tmpl.useContext ? tmpl.failCheck(objectiveCtx, objective) : tmpl.failCheck(activeBoardState, objective))
				: false;
			return {
				achieved: !failed && current >= normalizedTarget,
				failed,
				current,
				target: normalizedTarget,
				points: getObjectiveRewardPoints(objective, 15),
				coins: getObjectiveRewardCoins(objective),
				randomBonuses: getObjectiveRandomBonuses(objective)
			};
		}
	}
	// Coin mode objectives: dynamisch gegenereerd per ronde
	if (objective.id && objective.id.startsWith('coin_')) {
		const roundMatch = objective.id.match(/_(\d+)$/);
		const round = roundMatch ? parseInt(roundMatch[1], 10) : (gameState?.level || 1);
		const coinSeedRng = createRNG(0); // seed irrelevant, we just need all pool entries
		const coinPool = generateCoinModeObjectives(coinSeedRng, round);
		const coinTmpl = coinPool.find(t => t.id === objective.id);
		if (coinTmpl && coinTmpl.useContext) {
			if (!objectiveCtx) {
				return {
					achieved: false,
					failed: false,
					current: 0,
					target: normalizedTarget,
					points: getObjectiveRewardPoints(objective, 15),
					coins: getObjectiveRewardCoins(objective),
					randomBonuses: getObjectiveRandomBonuses(objective)
				};
			}
			const current = coinTmpl.check(objectiveCtx, objective);
			return {
				achieved: current >= normalizedTarget,
				failed: false,
				current,
				target: normalizedTarget,
				points: getObjectiveRewardPoints(objective, 15),
				coins: getObjectiveRewardCoins(objective),
				randomBonuses: getObjectiveRandomBonuses(objective)
			};
		}
	}
	// Fallback naar oude OBJECTIVE_TEMPLATES
	const template = OBJECTIVE_TEMPLATES.find(t => t.id === objective.id);
	if (!template) {
		return {
			achieved: false,
			failed: false,
			current: 0,
			target: normalizedTarget,
			points: getObjectiveRewardPoints(objective, 15),
			coins: getObjectiveRewardCoins(objective),
			randomBonuses: getObjectiveRandomBonuses(objective)
		};
	}
	const current = template.check(activeBoardState);
	return {
		achieved: current >= normalizedTarget,
		failed: false,
		current,
		target: normalizedTarget,
		points: getObjectiveRewardPoints(objective, 15),
		coins: getObjectiveRewardCoins(objective),
		randomBonuses: getObjectiveRandomBonuses(objective)
	};
}

// ──────────────────────────────────────────────
//  CARD / DECK GENERATION
// ──────────────────────────────────────────────

function buildDeck(cardCount, rng, options = {}) {
	const pool = buildShapePool(options);
	const deck = [];

	// Verdeel kleuren eerlijk (elke kleur minstens 1 kaart)
	const playableColors = COLORS.filter(c => c.name !== 'multikleur');
	const multikleurColor = COLORS.find(c => c.name === 'multikleur');

	const goldenChance = options.goldenChance || 0.10;
	const multikleurChance = options.multikleurChance || 0.10;

	for (let i = 0; i < cardCount; i++) {
		const shapeEntry = getWeightedRandom(pool, rng);
		let color;
		let isGolden = false;

		// Check for golden card — keeps regular color but gets isGolden modifier
		// Golden cards can be played as EXTRA (not instead of regular card)
		if (options.enableGolden && rng() < goldenChance) {
			isGolden = true;
			color = { ...playableColors[Math.floor(rng() * playableColors.length)] };
		}
		// Check for multikleur card
		else if (options.enableMultikleur && multikleurColor && rng() < multikleurChance) {
			color = { ...multikleurColor };
		}
		else {
			color = { ...playableColors[Math.floor(rng() * playableColors.length)] };
		}

		deck.push({
			id: `card-${i}-${Math.floor(rng() * 100000)}`,
			shapeName: shapeEntry.name,
			matrix: cloneMatrix(shapeEntry.matrix),
			category: shapeEntry.category,
			color,
			isGolden,
			rotation: 0,
			mirrored: false
		});
	}

	return deck;
}

/**
 * Bouw een beloningsmodus startdeck.
 * - 10 multikleur 2×1 kaarten (Domino shape)
 * - 5 normale kaarten van 3-4 cellen
 * - Voor menselijke spelers: +1 stenen kaart (1×2)
 */
function buildRewardingDeck(rng, isBot) {
	const deck = [];
	const playableColors = COLORS.filter(c => c.name !== 'multikleur');

	// Verzamel medium shapes (3-4 cellen)
	const mediumShapes = [];
	for (const cat of ['mini', 'standard']) {
		for (const shape of (BASE_SHAPES[cat] || [])) {
			const cellCount = shape.matrix.flat().filter(Boolean).length;
			if (cellCount >= 3 && cellCount <= 4) {
				mediumShapes.push({ name: shape.name, matrix: shape.matrix, category: cat });
			}
		}
	}
	const shapePool = mediumShapes.length > 0 ? mediumShapes : (BASE_SHAPES.standard || []);

	// 15 normale gekleurde kaarten (3-4 cellen)
	for (let i = 0; i < 15; i++) {
		const shape = shapePool[Math.floor(rng() * shapePool.length)];
		const color = playableColors[Math.floor(rng() * playableColors.length)];
		deck.push({
			id: `rw-std-${i}-${Math.floor(rng() * 100000)}`,
			shapeName: shape.name,
			matrix: cloneMatrix(shape.matrix),
			category: shape.category || 'standard',
			color: { ...color },
			isGolden: false,
			rotation: 0,
			mirrored: false
		});
	}

	return deck;
}

/** Build starting deck for coin mode: 9 multikleur 2×1 + 6 colored 3-4 cell cards */
function buildCoinModeDeck(rng) {
	const deck = [];
	const multikleurColor = COLORS.find(c => c.name === 'multikleur');
	const playableColors = COLORS.filter(c => c.name !== 'multikleur');
	const dominoMatrix = [[1, 1]]; // 2×1 blok

	// 9 multikleur 2×1 kaarten (gratis te spelen)
	for (let i = 0; i < 9; i++) {
		deck.push({
			id: `cm-mk-${i}-${Math.floor(rng() * 100000)}`,
			shapeName: 'Domino',
			matrix: cloneMatrix(dominoMatrix),
			category: 'mini',
			color: { ...multikleurColor },
			isGolden: false,
			rotation: 0,
			mirrored: false
		});
	}

	// 6 gekleurde kaarten (3-4 cellen, kosten 1 coin om te spelen)
	const mediumShapes = [];
	for (const cat of ['mini', 'standard']) {
		for (const shape of (BASE_SHAPES[cat] || [])) {
			const cellCount = shape.matrix.flat().filter(Boolean).length;
			if (cellCount >= 3 && cellCount <= 4) {
				mediumShapes.push({ name: shape.name, matrix: shape.matrix, category: cat });
			}
		}
	}
	const shapePool = mediumShapes.length > 0 ? mediumShapes : (BASE_SHAPES.standard || []);

	for (let i = 0; i < 6; i++) {
		const shape = shapePool[Math.floor(rng() * shapePool.length)];
		const color = playableColors[Math.floor(rng() * playableColors.length)];
		deck.push({
			id: `cm-std-${i}-${Math.floor(rng() * 100000)}`,
			shapeName: shape.name,
			matrix: cloneMatrix(shape.matrix),
			category: shape.category || 'standard',
			color: { ...color },
			isGolden: false,
			rotation: 0,
			mirrored: false
		});
	}

	return deck;
}

/** Calculate coin cost to play a card in coin mode */
function getCardPlayCost(card) {
	if (!card) return 0;
	// Gouden kaarten: altijd gratis
	if (card.isGolden) return 0;
	const cellCount = card.matrix ? card.matrix.flat().filter(Boolean).length : 0;
	// Steen, multikleur >2 cellen, of kaarten >4 cellen: 2 coins
	if (card.isStone) return 2;
	if ((card.color?.name === 'multikleur' || card.color?.code === 'rainbow') && cellCount > 2) return 2;
	if (cellCount > 4) return 2;
	// Alle overige kaarten (inclusief 2-cel): 1 coin
	return 1;
}

/** Check if a card is a free 2x1 domino (2 cells, not golden, not stone) */
function isFree2x1Card(card) {
	if (!card || card.isGolden || card.isStone) return false;
	const cellCount = card.matrix ? card.matrix.flat().filter(Boolean).length : 0;
	return cellCount <= 2;
}

function normalizeStartingDeckType(deckType) {
	const value = String(deckType || '').trim().toLowerCase();
	if (STARTING_DECK_TYPES.includes(value)) return value;
	return null;
}

function buildStartingColorSequence(deckType, cardCount, rng) {
	const playableColors = COLORS.filter(c => c.name !== 'multikleur').map(c => ({ ...c }));
	if (playableColors.length === 0 || cardCount <= 0) return [];

	if (deckType === 'spread') {
		const sequence = [];
		const basePerColor = Math.floor(cardCount / playableColors.length);
		for (const color of playableColors) {
			for (let i = 0; i < basePerColor; i++) sequence.push({ ...color });
		}
		const remainder = cardCount - sequence.length;
		const shuffledColors = shuffleWithRNG([...playableColors], rng);
		for (let i = 0; i < remainder; i++) {
			sequence.push({ ...shuffledColors[i % shuffledColors.length] });
		}
		return shuffleWithRNG(sequence, rng);
	}

	if (deckType === 'adventurer') {
		const shuffled = shuffleWithRNG([...playableColors], rng);
		const dominant = shuffled.slice(0, 2);
		const secondary = shuffled.slice(2);
		const sequence = [];
		const dominantCount = Math.max(2, Math.min(cardCount, Math.round(cardCount * 0.75)));

		for (let i = 0; i < dominantCount; i++) {
			sequence.push({ ...dominant[Math.floor(rng() * dominant.length)] });
		}
		for (let i = dominantCount; i < cardCount; i++) {
			const pool = secondary.length > 0 ? secondary : dominant;
			sequence.push({ ...pool[Math.floor(rng() * pool.length)] });
		}
		return shuffleWithRNG(sequence, rng);
	}

	return [];
}

function buildStartingDeckByType(cardCount, rng, deckType) {
	const normalizedType = normalizeStartingDeckType(deckType) || 'random';
	const deck = buildDeck(cardCount, rng, {
		enableGolden: false,
		enableMultikleur: false,
		goldenChance: 0,
		multikleurChance: 0,
		simpleStart: true,
		excludeLong5: true
	});

	if (normalizedType === 'random') return deck;

	const colorSequence = buildStartingColorSequence(normalizedType, cardCount, rng);
	for (let i = 0; i < deck.length; i++) {
		if (colorSequence[i]) {
			deck[i].color = { ...colorSequence[i] };
		}
	}

	return deck;
}

function cloneCardForDeck(card) {
	if (!card) return null;
	return {
		...card,
		matrix: cloneMatrix(card.matrix || [[1]]),
		color: card.color ? { ...card.color } : null
	};
}

function cloneDeckCards(cards) {
	if (!Array.isArray(cards)) return [];
	return cards.map(cloneCardForDeck).filter(Boolean);
}

function buildShapePool(options = {}) {
	const pool = [];
	const categories = ['mini', 'standard', 'large'];
	const categoryWeights = options.simpleStart
		? { mini: 1.1, standard: 1.45, large: 0.12 }
		: SHAPE_CATEGORY_WEIGHTS;
	const excludeLong5 = !!options.excludeLong5;

	for (const cat of categories) {
		const shapes = BASE_SHAPES[cat];
		if (!shapes) continue;
		const catWeight = categoryWeights[cat] || 1;
		for (const shape of shapes) {
			if (excludeLong5 && shape.name === 'Lang 5') continue;
			let shapeWeight = (shape.weight || 1);
			if (options.simpleStart) {
				let cellCount = 0;
				for (const row of shape.matrix || []) {
					for (const c of row) {
						if (c) cellCount++;
					}
				}
				if (cellCount >= 5) shapeWeight *= 0.35;
				else if (cellCount <= 3) shapeWeight *= 1.2;
			}
			pool.push({
				name: shape.name,
				category: cat,
				weight: shapeWeight * catWeight,
				matrix: shape.matrix
			});
		}
	}
	return pool;
}

function getWeightedRandom(pool, rng) {
	const totalWeight = pool.reduce((sum, e) => sum + e.weight, 0);
	let target = rng() * totalWeight;
	for (const entry of pool) {
		if (target < entry.weight) return entry;
		target -= entry.weight;
	}
	return pool[pool.length - 1];
}

// ──────────────────────────────────────────────
//  GAME STATE
// ──────────────────────────────────────────────

function createGameState(gameId, hostPlayerId, settings = {}) {
	const seed = settings.seed || Date.now();
	const winsToEnd = Math.max(1, Number(settings.winsToEnd) || MATCH_WINS_TARGET);
	return {
		id: gameId,
		seed,
		phase: 'waiting',
		hostPlayerId,
		settings: {
			maxPlayers: settings.maxPlayers || 4,
			mapSize: settings.mapSize || 4,
			cardsPerPlayer: settings.cardsPerPlayer || 10,
			handSize: settings.handSize || 3,
			turnTimeLimit: settings.turnTimeLimit || 0,
			timerEnabled: settings.timerEnabled !== false
		},
		players: {},
		playerOrder: [],
		currentTurnIndex: 0,
		turnCount: 0,
		bonusPlayedThisTurn: false,
		boardState: null,
		objectiveChoices: {},
		level: 1,
		maxLevels: settings.maxLevels || DEFAULT_MAX_LEVELS,
		winsToEnd,
		matchWinner: null,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		endedAt: null,
		winner: null,
		finalScores: null,
		levelScores: null,
		levelScoresHistory: [],
		moveHistory: [],
		paused: false,
		pausedBy: null,
		pausedAt: null,
		_turnTimerDurationMs: 40000,
		_turnTimerRemainingMs: 40000
	};
}

function addPlayer(gameState, playerId, playerName) {
	if (gameState.phase !== 'waiting') return { error: 'Game is niet meer in wachtfase' };
	if (Object.keys(gameState.players).length >= gameState.settings.maxPlayers) return { error: 'Maximum aantal spelers bereikt' };
	if (gameState.players[playerId]) return { error: 'Speler zit al in het spel' };

	gameState.players[playerId] = {
		id: playerId,
		name: playerName,
		deck: [],
		hand: [],
		drawPile: [],
		discardPile: [],
		chosenObjective: null,
		score: 0,
		scoreBreakdown: null,
		bonusInventory: { yellow: 0, red: 0, green: 0, purple: 0, blue: 0, any: 0 },
		goldCoins: 0,
		shopReady: false,
		shopCards: [],
		permanentBaseCards: [],
		permanentShopCards: [],
		startingDeckType: null,
		matchWins: 0,
		shopOfferings: [],
		shopPurchasesThisLevel: {},
		timeBombs: 0,
		unlockedGolden: false,
		unlockedMultikleur: false,
		unlockedSteen: false,
		perks: {
			perkPoints: 1,
			unlockedPerks: [],
			bonusUpgrades: {},
			stoneBlocks: 0,
			minesPerRound: 0,
			stealsPerRound: 0,
			greenGapAllowed: false,
			diagonalRotation: false,
			wildcardPerRound: 0,
			doubleCoins: false,
			minesUsedThisLevel: 0,
			stealsUsedThisLevel: 0,
			wildcardsUsedThisLevel: 0,
			activeMines: []
		},
		connected: true,
		joinedAt: Date.now()
	};
	gameState.playerOrder.push(playerId);
	gameState.updatedAt = Date.now();
	return { success: true };
}

function removePlayer(gameState, playerId) {
	if (gameState.phase !== 'waiting') return { error: 'Kan speler niet verwijderen tijdens een lopend spel' };
	if (!gameState.players[playerId]) return { error: 'Speler niet gevonden' };
	delete gameState.players[playerId];
	gameState.playerOrder = gameState.playerOrder.filter(id => id !== playerId);
	gameState.updatedAt = Date.now();
	return { success: true };
}

function _getMaxWins(gameState) {
	let mw = 0;
	for (const pid of (gameState.playerOrder || [])) {
		const w = (gameState.players?.[pid]?.matchWins) || 0;
		if (w > mw) mw = w;
	}
	return mw;
}

function initializeLevelOneAfterDeckChoice(gameState) {
	const rng = createRNG(gameState.seed);

	// 1. Genereer bord voor level 1
	const mapSize = gameState.settings?.mapSize || 4;
	gameState.boardState = generateLevel1Board(rng, 1, mapSize, _getMaxWins(gameState));

	// 2. Genereer startdecks per speler op basis van keuze
	const isRewarding = !!gameState.settings?.rewardingMode;
	const isCoinMode = !!gameState.settings?.coinMode;
	for (const playerId of gameState.playerOrder) {
		const player = gameState.players[playerId];
		const baseDeckRng = createRNG((gameState.seed | 0) ^ hashStringToInt(`${playerId}-level-1-base-${player.startingDeckType || 'random'}`));

		let initialDeck;
		if (isCoinMode) {
			// Coin mode: 9 multikleur 2×1 + 6 gekleurde kaarten (vast)
			initialDeck = buildCoinModeDeck(baseDeckRng);
		} else if (isRewarding) {
			// Beloningsmodus: 15 gekleurde kaarten (3-4 cellen)
			initialDeck = buildRewardingDeck(baseDeckRng, !!player.isAI);
		} else {
			const deckType = normalizeStartingDeckType(player.startingDeckType) || 'random';
			initialDeck = buildStartingDeckByType(gameState.settings.cardsPerPlayer, baseDeckRng, deckType);
		}
		player.permanentBaseCards = cloneDeckCards(initialDeck);

		const shuffledInitialDeck = shuffleWithRNG(
			cloneDeckCards(player.permanentBaseCards),
			createRNG((gameState.seed | 0) ^ hashStringToInt(`${playerId}-level-1`))
		);
		player.deck = shuffledInitialDeck;
		player.drawPile = [...shuffledInitialDeck];
		player.hand = [];
	}

	// 3. Objective keuzes
	gameState.objectiveChoices = {};
	for (const playerId of gameState.playerOrder) {
		gameState.objectiveChoices[playerId] = generateObjectiveChoices(rng, 1, gameState, playerId);
	}

	// 4. Shuffle beurtvolgorde
	gameState.playerOrder = shuffleWithRNG(gameState.playerOrder, rng);

	gameState.phase = 'choosingGoals';
	gameState.updatedAt = Date.now();
}

function startGame(gameState) {
	const playerCount = Object.keys(gameState.players).length;
	if (playerCount < 1) return { error: 'Minimaal 1 speler nodig' };
	if (gameState.phase !== 'waiting') return { error: 'Spel is al gestart' };

	gameState.boardState = null;
	gameState.objectiveChoices = {};
	for (const playerId of gameState.playerOrder) {
		const player = gameState.players[playerId];
		player.matchWins = 0;
		player.startingDeckType = null;
		player.permanentBaseCards = [];
		player.deck = [];
		player.drawPile = [];
		player.hand = [];
		player.discardPile = [];
		player.chosenObjective = null;
		// Reset perks bij nieuwe match
		player.perks = {
			perkPoints: 1,
			unlockedPerks: [],
			bonusUpgrades: {},
			stoneBlocks: 0,
			minesPerRound: 0,
			stealsPerRound: 0,
			greenGapAllowed: false,
			diagonalRotation: false,
			wildcardPerRound: 0,
			doubleCoins: false,
			minesUsedThisLevel: 0,
			stealsUsedThisLevel: 0,
			wildcardsUsedThisLevel: 0,
			activeMines: []
		};
	}
	gameState.matchWinner = null;

	// Coin mode en rewarding mode: vast deck, skip deck-keuze
	if (gameState.settings?.coinMode || gameState.settings?.rewardingMode) {
		for (const pid of gameState.playerOrder) {
			gameState.players[pid].startingDeckType = 'random';
		}
		initializeLevelOneAfterDeckChoice(gameState);
		return { success: true };
	}

	gameState.phase = 'choosingStartDeck';
	gameState.updatedAt = Date.now();
	return { success: true };
}

function chooseStartingDeck(gameState, playerId, deckType) {
	if (gameState.phase !== 'choosingStartDeck') return { error: 'Niet in start-deck keuze fase' };
	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };

	const normalizedType = normalizeStartingDeckType(deckType);
	if (!normalizedType) return { error: 'Ongeldig startdeck type' };

	player.startingDeckType = normalizedType;
	gameState.updatedAt = Date.now();

	const allChosen = gameState.playerOrder.every(pid => {
		if (gameState.players[pid]?.connected === false) return true;
		const type = gameState.players[pid]?.startingDeckType;
		return !!normalizeStartingDeckType(type);
	});

	if (allChosen) {
		initializeLevelOneAfterDeckChoice(gameState);
	}

	return { success: true, allChosen, deckType: normalizedType };
}

function chooseObjective(gameState, playerId, objectiveIndex) {
	if (gameState.phase !== 'choosingGoals') return { error: 'Niet in goal-keuze fase' };
	const choices = gameState.objectiveChoices[playerId];
	if (!choices || objectiveIndex < 0 || objectiveIndex >= choices.length) return { error: 'Ongeldige objective keuze' };
	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };
	if (player.chosenObjective) return { error: 'Al een objective gekozen' };

	player.chosenObjective = { ...choices[objectiveIndex] };
	player.goalPerksDone = isGoalPerkDone(gameState, playerId);
	if (isNamedSabotageObjective(player.chosenObjective)) {
		syncSabotageObjectiveTarget(gameState, playerId, player.chosenObjective);
	}
	refreshSabotageObjectivesForTarget(gameState, playerId);
	gameState.updatedAt = Date.now();

	const allChosen = allObjectivesChosen(gameState);
	const startedPlaying = maybeStartPlayingAfterGoalPhase(gameState);

	return { success: true, allChosen, startedPlaying };
}

function drawHand(gameState, playerId) {
	const player = gameState.players[playerId];
	if (!player) return;
	// Aanvullen tot 3 kaarten, of 4 als speler de Brede Hand perk heeft
	const targetHandSize = player.perks?.extraCard ? 4 : 3;
	const drawCount = Math.max(0, Math.min(targetHandSize - player.hand.length, player.drawPile.length));
	if (drawCount > 0) {
		const drawn = player.drawPile.splice(0, drawCount);
		player.hand.push(...drawn);
	}
}

// Helper voor choosePerk: trek kaarten aan tot een specifiek maximum
function drawHandForPlayer(gameState, player, targetSize) {
	if (!player) return;
	const drawCount = Math.max(0, Math.min(targetSize - player.hand.length, player.drawPile.length));
	if (drawCount > 0) {
		const drawn = player.drawPile.splice(0, drawCount);
		player.hand.push(...drawn);
	}
}

function playMove(gameState, playerId, cardId, zoneName, baseX, baseY, rotation, mirrored, subgridId) {
	if (gameState.phase !== 'playing') return { error: 'Spel is niet in play fase' };

	const currentPlayerId = gameState.playerOrder[gameState.currentTurnIndex];
	if (playerId !== currentPlayerId) return { error: 'Niet jouw beurt', expected: currentPlayerId };

	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };

	const cardIndex = player.hand.findIndex(c => c.id === cardId);
	if (cardIndex === -1) return { error: 'Kaart niet in je hand' };

	const card = player.hand[cardIndex];

	// Coin mode spelregels:
	// - 1 gratis 2x1 kaart per beurt (domino)
	// - Alle andere kaarten kosten coins (1-2) en zijn onbeperkt
	// - Gouden kaarten: altijd gratis, onbeperkt
	if (gameState.settings?.coinMode && !card.isGolden) {
		const isFree = isFree2x1Card(card);
		const freeUsed = !!gameState._coinFreeCardUsed;
		if (isFree && !freeUsed) {
			// Gratis 2x1 kaart — nog niet gebruikt
		} else {
			// Betaalde kaart: check of speler genoeg coins heeft
			const playCost = getCardPlayCost(card);
			if (playCost > 0 && (player.goldCoins || 0) < playCost) {
				return { error: `Niet genoeg goudmunten (nodig: ${playCost}, beschikbaar: ${player.goldCoins || 0})` };
			}
		}
	}

	const objectiveSnapshot = {
		objectiveAchieved: !!player.objectiveAchieved,
		objectiveAchievedPoints: player.objectiveAchievedPoints || 0,
		objectiveProgress: player.objectiveProgress ? { ...player.objectiveProgress } : null,
		goldCoins: player.goldCoins || 0,
		bonusInventory: player.bonusInventory ? { ...player.bonusInventory } : { yellow: 0, red: 0, green: 0, purple: 0, blue: 0, any: 0 }
	};

	// Max 1 regular kaart per beurt — gouden kaarten mogen als EXTRA gespeeld worden
	// Coin mode: meerdere kaarten toegestaan als je coins betaalt
	if (gameState._cardPlayedThisTurn && !card.isGolden && !gameState.settings?.coinMode) {
		return { error: 'Je hebt al een kaart gespeeld deze beurt. Speel bonussen of beëindig je beurt.' };
	}

	// Check: mag deze kaart op deze zone?
	const allowed = getAllowedZones(card);
	let wildcardUsed = false;
	if (!allowed.includes(zoneName)) {
		// Wildcard perk: eenmaal per ronde een kaart op elke zone
		if (playerHasPerk(player, 'flex_wildcard') &&
			(player.perks.wildcardsUsedThisLevel || 0) < (player.perks.wildcardPerRound || 0) &&
			!card.isGolden && !card.isStone) {
			wildcardUsed = true;
		} else {
			return { error: `${card.color.name} kaarten mogen niet op de ${zoneName} zone` };
		}
	}

	// Bouw perk flags voor plaatsingsvalidatie
	const perkFlags = {
		greenGapAllowed: !!player.perks?.greenGapAllowed,
		redGapAllowed: !!player.perks?.redGapAllowed,
		diagonalRotation: !!player.perks?.diagonalRotation
	};

	// Pas matrix aan op basis van perks VÓÓR rotatie (optionele cellen draaien mee)
	let matrix = cloneMatrix(card.matrix);
	matrix = getEnhancedMatrix(matrix, zoneName, perkFlags);

	// Apply rotation en mirror (zelfde volgorde als client: rotate dan mirror)
	matrix = rotateMatrixN(matrix, rotation || 0);
	if (mirrored) matrix = mirrorMatrix(matrix);

	// Zoek zone data en plaats
	let placementResult = null;
	let usedSubgridId = subgridId || null;

	if (zoneName === 'red') {
		const redZone = gameState.boardState.zones.red;
		if (!redZone || !redZone.subgrids) return { error: 'Red zone niet gevonden' };

		// If subgridId is provided, only place in that specific subgrid
		const subgridsToCheck = subgridId
			? redZone.subgrids.filter(sg => sg.id === subgridId)
			: redZone.subgrids;

		for (const subgrid of subgridsToCheck) {
			const pending = collectPlacementCellsData(subgrid, baseX, baseY, matrix);
			if (pending) {
				placementResult = applyPlacement(gameState.boardState, zoneName, subgrid, baseX, baseY, matrix, card.color, playerId, perkFlags);
				if (placementResult) { usedSubgridId = subgrid.id; break; }
			}
		}
		if (!placementResult) return { error: 'Ongeldige plaatsing in rode zone' };
	} else {
		const zoneData = gameState.boardState.zones[zoneName];
		if (!zoneData) return { error: `Zone '${zoneName}' niet gevonden` };
		placementResult = applyPlacement(gameState.boardState, zoneName, zoneData, baseX, baseY, matrix, card.color, playerId, perkFlags);
		if (!placementResult) return { error: 'Ongeldige plaatsing' };
	}

	// Verwijder kaart uit hand
	player.hand.splice(cardIndex, 1);

	// Coin mode: trek speelkosten af
	// - 1 gratis 2x1 per beurt, rest kost coins
	if (gameState.settings?.coinMode && !card.isGolden) {
		const isFree = isFree2x1Card(card);
		const freeUsed = !!gameState._coinFreeCardUsed;
		if (isFree && !freeUsed) {
			// Gratis 2x1 kaart gebruikt
			gameState._coinFreeCardUsed = true;
		} else {
			const playCost = getCardPlayCost(card);
			if (playCost > 0) {
				player.goldCoins = (player.goldCoins || 0) - playCost;
			}
		}
		gameState._coinCardsPlayedThisTurn = (gameState._coinCardsPlayedThisTurn || 0) + 1;
	}

	// Voeg gespeelde kaart toe aan aflegstapel
	if (!Array.isArray(player.discardPile)) player.discardPile = [];
	player.discardPile.push(card);

	// Tijdelijk gestolen kaart: geef terug aan oorspronkelijke eigenaar na spelen
	if (card.isStolenTemp && card.originalOwnerId) {
		const originalOwner = gameState.players[card.originalOwnerId];
		if (originalOwner) {
			// Verwijder de stolen markering en voeg toe aan drawPile
			const returnedCard = { ...card };
			delete returnedCard.isStolenTemp;
			delete returnedCard.originalOwnerId;
			originalOwner.drawPile.push(returnedCard);
		}
	}

	// Verwerk verzamelde bonussen
	if (placementResult.collectedBonuses) {
		for (const bonusColor of placementResult.collectedBonuses) {
			// Dubbele multikleur perk: 'any' bonus geeft 2 charges
			const amount = (bonusColor === 'any' && playerHasPerk(player, 'bonus_multi_double')) ? 2 : 1;
			player.bonusInventory[bonusColor] = (player.bonusInventory[bonusColor] || 0) + amount;
		}
	}

	// Move opslaan
	gameState.moveHistory.push({
		playerId,
		cardId,
		cardName: card.shapeName,
		colorName: card.color.name,
		zoneName,
		baseX,
		baseY,
		rotation: rotation || 0,
		mirrored: !!mirrored,
		turnCount: gameState.turnCount,
		goldCollected: placementResult.goldCollected || 0,
		bonusesCollected: placementResult.collectedBonuses || [],
		timestamp: Date.now()
	});

	// Gold coins bijhouden als currency (doubleCoins perk)
	// Coin mode: parels geven gratis random perk i.p.v. munten
	let pearlPerkPoints = 0;
	let pearlAutoPerks = [];
	if (placementResult.goldCollected > 0) {
		let effectiveGold = placementResult.goldCollected;
		if (gameState.settings?.coinMode && (placementResult.pearlGold || 0) > 0) {
			effectiveGold -= placementResult.pearlGold;
			const pearlCount = placementResult.pearlsCollected || 0;
			if (!player.perks) player.perks = { perkPoints: 0, unlockedPerks: [], bonusUpgrades: {} };
			// Auto-unlock random perks for each pearl collected
			for (let pi = 0; pi < pearlCount; pi++) {
				const available = getAvailablePerks(player);
				if (available.length === 0) break;
				const pick = available[Math.floor(Math.random() * available.length)];
				// Check cost: pearl gives 1 free perk point, use it immediately
				if (pick.cost <= 1) {
					player.perks.unlockedPerks.push(pick.id);
					if (pick.color) player.perks.bonusUpgrades[pick.color] = true;
					_applyPerkSideEffects(player, pick.id, gameState, playerId);
					pearlAutoPerks.push({ id: pick.id, name: pick.name, icon: pick.icon });
				} else {
					// Perk costs more than 1 — give perk point instead
					player.perks.perkPoints = (player.perks.perkPoints || 0) + 1;
					pearlPerkPoints++;
				}
			}
		}
		if (effectiveGold > 0) {
			const goldAmount = playerHasPerk(player, 'flex_double_coins')
				? effectiveGold * 2
				: effectiveGold;
			player.goldCoins = (player.goldCoins || 0) + goldAmount;
		}
	}

	// Mine trigger check: als IEMAND een mijn op deze cellen had, verwijder het HELE geplaatste blok
	let mineTriggered = null;
	if (placementResult.cells && placementResult.cells.length > 0) {
		for (const opId of gameState.playerOrder) {
			const opPlayer = gameState.players[opId];
			if (!opPlayer?.perks?.activeMines?.length) continue;
			for (let mi = opPlayer.perks.activeMines.length - 1; mi >= 0; mi--) {
				const mine = opPlayer.perks.activeMines[mi];
				if (mine.zone !== zoneName) continue;
				const hit = placementResult.cells.some(c => c.x === mine.x && c.y === mine.y);
				if (hit) {
					mineTriggered = { mineOwner: opId, mineOwnerName: opPlayer.name, zone: zoneName, x: mine.x, y: mine.y };
					opPlayer.perks.activeMines.splice(mi, 1);

					// Verwijder ALLE cellen van het geplaatste blok (niet alleen de gemijnde cel)
					const mineZd = zoneName === 'red'
						? (gameState.boardState.zones.red.subgrids?.find(sg => getDataCell(sg, placementResult.cells[0].x, placementResult.cells[0].y)?.active) || gameState.boardState.zones[zoneName])
						: gameState.boardState.zones[zoneName];
					for (const pc of placementResult.cells) {
						const pcCell = getDataCell(mineZd, pc.x, pc.y);
						if (pcCell) {
							pcCell.active = false;
							pcCell.playerId = null;
							pcCell.color = null;
							pcCell.isStone = false;
							pcCell.placementOrder = 0;
						}
					}

					// Undo bonussen die bij het plaatsen werden verzameld
					if (placementResult.collectedBonuses) {
						for (const bonusColor of placementResult.collectedBonuses) {
							const amount = (bonusColor === 'any' && playerHasPerk(player, 'bonus_multi_double')) ? 2 : 1;
							player.bonusInventory[bonusColor] = Math.max(0, (player.bonusInventory[bonusColor] || 0) - amount);
						}
					}

					// Undo goudmunten die bij het plaatsen werden verzameld
					if (placementResult.goldCollected > 0) {
						const goldAmount = playerHasPerk(player, 'flex_double_coins')
							? placementResult.goldCollected * 2
							: placementResult.goldCollected;
						player.goldCoins = Math.max(0, (player.goldCoins || 0) - goldAmount);
					}

					// Geef kaart terug in discard pile (kaart is 'opgeofferd')
					// We verwijderen de move uit history
					if (gameState.moveHistory.length > 0) {
						gameState.moveHistory.pop();
					}

					break;
				}
			}
			if (mineTriggered) break;
		}
	}

	// Scores herberekenen (alleen actieve speler)
	const playerScores = recalcScoresForActivePlayer(gameState);

	// Sla undo data op (voor Ctrl+Z)
	gameState._turnUndoData = {
		playerId,
		card,
		cardIndex,
		objectiveSnapshot,
		placedCells: placementResult.cells.map(c => ({ ...c })),
		zoneName,
		subgridId: usedSubgridId,
		collectedBonuses: [...(placementResult.collectedBonuses || [])],
		goldCollected: placementResult.goldCollected || 0,
		moveHistoryLengthBefore: gameState.moveHistory.length - 1,
		bonusMoves: []
	};
	// Golden cards don't count as the regular card play
	if (!card.isGolden) {
		gameState._cardPlayedThisTurn = true;
	}

	// Track wildcard usage
	if (wildcardUsed) {
		player.perks.wildcardsUsedThisLevel = (player.perks.wildcardsUsedThisLevel || 0) + 1;
	}

	// NIET naar volgende beurt — speler kan nog bonussen plaatsen
	// advanceTurn en checkGameEnd worden aangeroepen door endTurn()

	gameState.updatedAt = Date.now();

	return {
		success: true,
		scores: playerScores,
		goldCollected: placementResult.goldCollected - (gameState.settings?.coinMode ? (placementResult.pearlGold || 0) : 0),
		bonusesCollected: placementResult.collectedBonuses,
		pearlsCollected: placementResult.pearlsCollected || 0,
		pearlPerkPoints: pearlPerkPoints || 0,
		pearlAutoPerks: pearlAutoPerks.length > 0 ? pearlAutoPerks : null,
		mineTriggered: mineTriggered || null,
		gameEnded: false
	};
}

/**
 * Speel een bonus charge.
 * Plaatst een klein bonus-shape op de aangegeven zone.
 */
function playBonus(gameState, playerId, bonusColor, zoneName, baseX, baseY, subgridId, rotation) {
	if (gameState.phase !== 'playing') return { error: 'Spel is niet in play fase' };

	const currentPlayerId = gameState.playerOrder[gameState.currentTurnIndex];
	if (playerId !== currentPlayerId) return { error: 'Niet jouw beurt' };

	// Onbeperkt bonussen per beurt toegestaan

	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };

	if (!player.bonusInventory[bonusColor] || player.bonusInventory[bonusColor] <= 0) {
		return { error: `Geen ${bonusColor} bonussen beschikbaar` };
	}

	// Bonus shape — pas rotatie toe (met perk upgrade)
	let matrix = getBonusShapeForPlayer(bonusColor, player);
	const rot = (Number(rotation) || 0) % 4;
	for (let r = 0; r < rot; r++) { matrix = rotateMatrix90(matrix); }

	// Zone check
	if (zoneName !== bonusColor && bonusColor !== 'any') {
		// Bonus moet op de bijbehorende kleur-zone
		const colorToZone = { yellow: 'yellow', red: 'red', green: 'green', purple: 'purple', blue: 'blue' };
		if (colorToZone[bonusColor] !== zoneName) {
			return { error: `${bonusColor} bonus moet op de ${bonusColor} zone` };
		}
	}

	let placementResult = null;
	const bonusColorObj = COLORS.find(c => c.zone === bonusColor) || COLORS[0];
	const perkFlags = {
		greenGapAllowed: !!player.perks?.greenGapAllowed,
		redGapAllowed: !!player.perks?.redGapAllowed,
		diagonalRotation: !!player.perks?.diagonalRotation
	};

	if (zoneName === 'red') {
		// If subgridId is provided, only place in that specific subgrid
		const subgridsToCheck = subgridId
			? gameState.boardState.zones.red.subgrids.filter(sg => sg.id === subgridId)
			: gameState.boardState.zones.red.subgrids;
		for (const sg of subgridsToCheck) {
			placementResult = applyPlacement(gameState.boardState, zoneName, sg, baseX, baseY, matrix, bonusColorObj, playerId, perkFlags);
			if (placementResult) break;
		}
	} else {
		const zoneData = gameState.boardState.zones[zoneName];
		if (!zoneData) return { error: 'Zone niet gevonden' };
		placementResult = applyPlacement(gameState.boardState, zoneName, zoneData, baseX, baseY, matrix, bonusColorObj, playerId, perkFlags);
	}

	if (!placementResult) return { error: 'Ongeldige bonus plaatsing' };

	player.bonusInventory[bonusColor]--;

	// Verwerk verzamelde bonussen van bonus-plaatsing (als bonus shape op bonus-dots landt)
	if (placementResult.collectedBonuses) {
		for (const bc of placementResult.collectedBonuses) {
			const amount = (bc === 'any' && playerHasPerk(player, 'bonus_multi_double')) ? 2 : 1;
			player.bonusInventory[bc] = (player.bonusInventory[bc] || 0) + amount;
		}
	}

	// Gold coins bijhouden als currency (doubleCoins perk)
	// Coin mode: parels geven gratis random perk i.p.v. munten
	let bonusPearlAutoPerks = [];
	if (placementResult.goldCollected > 0) {
		let effectiveGold = placementResult.goldCollected;
		if (gameState.settings?.coinMode && (placementResult.pearlGold || 0) > 0) {
			effectiveGold -= placementResult.pearlGold;
			const pearlCount = placementResult.pearlsCollected || 0;
			if (!player.perks) player.perks = { perkPoints: 0, unlockedPerks: [], bonusUpgrades: {} };
			for (let pi = 0; pi < pearlCount; pi++) {
				const available = getAvailablePerks(player);
				if (available.length === 0) break;
				const pick = available[Math.floor(Math.random() * available.length)];
				if (pick.cost <= 1) {
					player.perks.unlockedPerks.push(pick.id);
					if (pick.color) player.perks.bonusUpgrades[pick.color] = true;
					_applyPerkSideEffects(player, pick.id, gameState, playerId);
					bonusPearlAutoPerks.push({ id: pick.id, name: pick.name, icon: pick.icon });
				} else {
					player.perks.perkPoints = (player.perks.perkPoints || 0) + 1;
				}
			}
		}
		if (effectiveGold > 0) {
			const goldAmount = playerHasPerk(player, 'flex_double_coins')
				? effectiveGold * 2
				: effectiveGold;
			player.goldCoins = (player.goldCoins || 0) + goldAmount;
		}
	}

	// Mine trigger check: als IEMAND een mijn op deze cellen had, verwijder de bonus plaatsing
	let mineTriggered = null;
	if (placementResult.cells && placementResult.cells.length > 0) {
		for (const opId of gameState.playerOrder) {
			const opPlayer = gameState.players[opId];
			if (!opPlayer?.perks?.activeMines?.length) continue;
			for (let mi = opPlayer.perks.activeMines.length - 1; mi >= 0; mi--) {
				const mine = opPlayer.perks.activeMines[mi];
				if (mine.zone !== zoneName) continue;
				const hit = placementResult.cells.some(c => c.x === mine.x && c.y === mine.y);
				if (hit) {
					mineTriggered = { mineOwner: opId, mineOwnerName: opPlayer.name, zone: zoneName, x: mine.x, y: mine.y };
					opPlayer.perks.activeMines.splice(mi, 1);

					// Verwijder ALLE cellen van de bonus plaatsing
					const mineZd = zoneName === 'red'
						? (gameState.boardState.zones.red.subgrids?.find(sg => getDataCell(sg, placementResult.cells[0].x, placementResult.cells[0].y)?.active) || gameState.boardState.zones[zoneName])
						: gameState.boardState.zones[zoneName];
					for (const pc of placementResult.cells) {
						const pcCell = getDataCell(mineZd, pc.x, pc.y);
						if (pcCell) {
							pcCell.active = false;
							pcCell.playerId = null;
							pcCell.color = null;
							pcCell.isStone = false;
							pcCell.placementOrder = 0;
						}
					}

					// Undo bonussen die bij het plaatsen werden verzameld
					if (placementResult.collectedBonuses) {
						for (const bc of placementResult.collectedBonuses) {
							const amount = (bc === 'any' && playerHasPerk(player, 'bonus_multi_double')) ? 2 : 1;
							player.bonusInventory[bc] = Math.max(0, (player.bonusInventory[bc] || 0) - amount);
						}
					}

					// Undo goudmunten die bij het plaatsen werden verzameld
					if (placementResult.goldCollected > 0) {
						const undoGold = playerHasPerk(player, 'flex_double_coins')
							? placementResult.goldCollected * 2
							: placementResult.goldCollected;
						player.goldCoins = Math.max(0, (player.goldCoins || 0) - undoGold);
					}

					break;
				}
			}
			if (mineTriggered) break;
		}
	}

	// Track bonus move voor undo
	if (gameState._turnUndoData && gameState._turnUndoData.playerId === playerId) {
		gameState._turnUndoData.bonusMoves.push({
			bonusColor,
			cells: placementResult.cells.map(c => ({ ...c })),
			zoneName,
			subgridId: subgridId || null,
			collectedBonuses: [...(placementResult.collectedBonuses || [])],
			goldCollected: placementResult.goldCollected || 0
		});
	}

	// Herbereken scores (alleen actieve speler)
	const playerScores = recalcScoresForActivePlayer(gameState);

	// NIET naar volgende beurt — speler kan nog meer bonussen plaatsen
	// endTurn() handelt advanceTurn + checkGameEnd af

	gameState.updatedAt = Date.now();

	return {
		success: true, scores: playerScores, gameEnded: false,
		bonusesCollected: placementResult.collectedBonuses || [],
		goldCollected: placementResult.goldCollected || 0,
		mineTriggered: mineTriggered || null
	};
}

function passMove(gameState, playerId, cardId) {
	if (gameState.phase !== 'playing') return { error: 'Spel is niet in play fase' };

	const currentPlayerId = gameState.playerOrder[gameState.currentTurnIndex];
	if (playerId !== currentPlayerId) return { error: 'Niet jouw beurt' };

	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };

	// Als speler geen kaarten heeft (bonus-only beurt), pass zonder discard
	// Forfeit alle resterende bonussen zodat het spel kan eindigen
	if (player.hand.length === 0) {
		// Verwijder alle resterende bonussen
		if (player.bonusInventory) {
			for (const color of Object.keys(player.bonusInventory)) {
				player.bonusInventory[color] = 0;
			}
		}
		gameState.moveHistory.push({
			playerId,
			pass: true,
			bonusPass: true,
			bonusesForfeited: true,
			turnCount: gameState.turnCount,
			timestamp: Date.now()
		});
	} else {
		// Initialiseer discardPile als die nog niet bestaat
		if (!Array.isArray(player.discardPile)) player.discardPile = [];

		let discardIndex = 0;
		if (cardId) {
			discardIndex = player.hand.findIndex(c => c.id === cardId);
			if (discardIndex === -1) return { error: 'Ongeldige kaart om weg te gooien' };
		}
		const discardedCard = player.hand.splice(discardIndex, 1)[0];
		player.discardPile.push(discardedCard);

		gameState.moveHistory.push({
			playerId,
			pass: true,
			cardDiscarded: discardedCard?.id || cardId || null,
			turnCount: gameState.turnCount,
			timestamp: Date.now()
		});
	}

	// Vul direct weer aan naar 3 kaarten zodat spelers altijd hand-cards hebben
	drawHand(gameState, playerId);

	advanceTurn(gameState);
	const ended = checkGameEnd(gameState);

	gameState.updatedAt = Date.now();

	return {
		success: true,
		gameEnded: ended,
		winner: gameState.winner,
		finalScores: gameState.finalScores
	};
}

/** Check of een speler nog ongebruikte bonussen heeft */
function playerHasBonuses(player) {
	if (!player.bonusInventory) return false;
	return Object.values(player.bonusInventory).some(v => v > 0);
}

/**
 * Beëindig je beurt — advance turn + check game end.
 * Wordt aangeroepen door de "Beurt Beëindigen" knop of door de timer.
 */
function endTurn(gameState, playerId, discardCardId = null) {
	if (gameState.phase !== 'playing') return { error: 'Spel is niet in play fase' };

	const currentPlayerId = gameState.playerOrder[gameState.currentTurnIndex];
	if (playerId !== currentPlayerId) return { error: 'Niet jouw beurt' };

	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };

	// Initialiseer discardPile als die nog niet bestaat
	if (!Array.isArray(player.discardPile)) player.discardPile = [];

	// ── TURN-END DISCARD MECHANIC ──
	// Alle niet-gouden kaarten in de hand gaan naar de aflegstapel.
	// Gouden kaarten blijven in de hand (bonus cards).

	const nonGoldenCards = player.hand.filter(c => !c.isGolden);
	if (!gameState._cardPlayedThisTurn && nonGoldenCards.length > 0) {
		// Geen kaart gespeeld: discard een specifieke kaart als pass
		let discardIndex = -1;
		if (discardCardId) {
			discardIndex = player.hand.findIndex(c => c.id === discardCardId && !c.isGolden);
			if (discardIndex === -1) {
				return { error: 'Ongeldige kaart om weg te gooien' };
			}
		} else {
			discardIndex = player.hand.findIndex(c => !c.isGolden);
		}
		if (discardIndex >= 0) {
			const discardedCard = player.hand.splice(discardIndex, 1)[0];
			player.discardPile.push(discardedCard);
			gameState.moveHistory.push({
				playerId,
				pass: true,
				autoDiscard: true,
				cardDiscarded: discardedCard?.id || discardCardId || null,
				turnCount: gameState.turnCount,
				timestamp: Date.now()
			});
		}
	}

	// Resterende niet-gouden kaarten naar de aflegstapel
	{
		const remaining = [];
		const kept = [];
		for (const card of player.hand) {
			if (card.isGolden) {
				kept.push(card);
			} else {
				remaining.push(card);
			}
		}
		if (remaining.length > 0) {
			player.discardPile.push(...remaining);
			player.hand = kept;
		}
	}

	// Als bonus-only beurt en geen bonusmoves gedaan: forfeit alle bonussen
	if (player.hand.length === 0 && player.drawPile.length === 0) {
		const bonusMovesDone = gameState._turnUndoData?.bonusMoves?.length || 0;
		if (!gameState._cardPlayedThisTurn && bonusMovesDone === 0 && playerHasBonuses(player)) {
			if (player.bonusInventory) {
				for (const color of Object.keys(player.bonusInventory)) {
					player.bonusInventory[color] = 0;
				}
			}
		}
	}

	// Vul direct weer aan naar 3 kaarten zodat spelers altijd hand-cards hebben
	drawHand(gameState, playerId);

	advanceTurn(gameState);
	const ended = checkGameEnd(gameState);

	gameState.updatedAt = Date.now();

	return {
		success: true,
		gameEnded: ended,
		winner: gameState.winner,
		finalScores: gameState.finalScores,
		levelScores: gameState.levelScores
	};
}

/**
 * Maak de laatste kaartplaatsing + bonussen ongedaan (Ctrl+Z).
 * Herstelt het bord, hand, bonusInventory en scores.
 */
function undoMove(gameState, playerId) {
	if (gameState.phase !== 'playing') return { error: 'Spel is niet in play fase' };

	const currentPlayerId = gameState.playerOrder[gameState.currentTurnIndex];
	if (playerId !== currentPlayerId) return { error: 'Niet jouw beurt' };

	const undo = gameState._turnUndoData;
	if (!undo || undo.playerId !== playerId) return { error: 'Niets om ongedaan te maken' };

	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };

	// ── STAP-VOOR-STAP UNDO: alleen de LAATSTE actie ongedaan maken ──

	// Als er bonus moves zijn, undo alleen de laatste bonus move
	if (Array.isArray(undo.bonusMoves) && undo.bonusMoves.length > 0) {
		const bm = undo.bonusMoves[undo.bonusMoves.length - 1];
		const zoneData = bm.zoneName === 'red' && bm.subgridId
			? gameState.boardState.zones.red.subgrids.find(sg => sg.id === bm.subgridId)
			: gameState.boardState.zones[bm.zoneName];
		if (zoneData) {
			for (const coord of bm.cells) {
				const cell = getDataCell(zoneData, coord.x, coord.y);
				if (cell) {
					cell.active = false;
					cell.color = null;
					cell.playerId = null;
					cell.placementOrder = null;
					cell.isStone = false;
				}
			}
		}
		// Herstel bonus charge
		player.bonusInventory[bm.bonusColor] = (player.bonusInventory[bm.bonusColor] || 0) + 1;
		// Verwijder verzamelde bonussen van deze bonus move
		for (const bc of bm.collectedBonuses || []) {
			player.bonusInventory[bc] = Math.max(0, (player.bonusInventory[bc] || 0) - 1);
		}
		// Verwijder verzameld goud
		if (bm.goldCollected > 0) {
			player.goldCoins = Math.max(0, (player.goldCoins || 0) - bm.goldCollected);
		}
		// Verwijder deze bonus move uit de lijst
		undo.bonusMoves.pop();
		// Trim move history (verwijder de laatste entry als die een bonusMove was)
		if (gameState.moveHistory.length > 0) {
			const lastHist = gameState.moveHistory[gameState.moveHistory.length - 1];
			if (lastHist && lastHist.bonusMove && lastHist.playerId === playerId) {
				gameState.moveHistory.pop();
			}
		}
		// Herbereken scores
		const playerScores = recalcScoresForActivePlayer(gameState);
		gameState.updatedAt = Date.now();
		return { success: true, scores: playerScores, undoneType: 'bonus' };
	}

	// Geen bonus moves meer → undo de kaartplaatsing
	if (Array.isArray(undo.placedCells) && undo.placedCells.length > 0) {
		const cardZoneData = undo.zoneName === 'red' && undo.subgridId
			? gameState.boardState.zones.red.subgrids.find(sg => sg.id === undo.subgridId)
			: gameState.boardState.zones[undo.zoneName];
		if (cardZoneData) {
			for (const coord of undo.placedCells) {
				const cell = getDataCell(cardZoneData, coord.x, coord.y);
				if (cell) {
					cell.active = false;
					cell.color = null;
					cell.playerId = null;
					cell.placementOrder = null;
					cell.isStone = false;
				}
			}
		}

		// Kaart terug in hand
		if (undo.card && undo.cardIndex >= 0) {
			player.hand.splice(undo.cardIndex, 0, undo.card);
		}

		// Verwijder verzamelde bonussen van de kaartplaatsing
		for (const bc of undo.collectedBonuses) {
			player.bonusInventory[bc] = Math.max(0, (player.bonusInventory[bc] || 0) - 1);
		}

		// Verwijder verzameld goud
		if (undo.goldCollected > 0) {
			player.goldCoins = Math.max(0, (player.goldCoins || 0) - undo.goldCollected);
		}

		// Trim move history
		if (typeof undo.moveHistoryLengthBefore === 'number') {
			gameState.moveHistory.length = undo.moveHistoryLengthBefore;
		}

		// Herstel objective state
		if (undo.objectiveSnapshot) {
			player.objectiveAchieved = !!undo.objectiveSnapshot.objectiveAchieved;
			player.objectiveAchievedPoints = undo.objectiveSnapshot.objectiveAchievedPoints || 0;
			player.objectiveProgress = undo.objectiveSnapshot.objectiveProgress
				? { ...undo.objectiveSnapshot.objectiveProgress }
				: null;
			if (typeof undo.objectiveSnapshot.goldCoins === 'number') {
				player.goldCoins = Math.max(0, undo.objectiveSnapshot.goldCoins);
			}
			if (undo.objectiveSnapshot.bonusInventory) {
				player.bonusInventory = { ...undo.objectiveSnapshot.bonusInventory };
			}
		}

		// Herbereken scores
		const playerScores = recalcScoresForActivePlayer(gameState);

		// Clear turn state (kaart is teruggedraaid)
		delete gameState._turnUndoData;
		gameState._cardPlayedThisTurn = false;
		delete gameState._coinCardsPlayedThisTurn;
		delete gameState._coinFreeCardUsed;
		gameState.bonusPlayedThisTurn = false;

		gameState.updatedAt = Date.now();
		return { success: true, scores: playerScores, undoneType: 'card' };
	}

	// Niets om ongedaan te maken
	return { error: 'Niets om ongedaan te maken' };
}

/** Ga naar de volgende beurt — sla spelers zonder kaarten EN zonder bonussen over */
/**
 * Beloningsmodus: na elke ronde krijgt elke speler een willekeurige bonuskaart.
 * Kaart wordt bovenop de drawPile gelegd zodat hij als volgende getrokken wordt.
 */
function _rewardingRoundBonusCards(gameState) {
	const playableColors = COLORS.filter(c => c.name !== 'multikleur');
	const mediumShapes = [];
	for (const cat of ['mini', 'standard']) {
		for (const shape of (BASE_SHAPES[cat] || [])) {
			const cellCount = shape.matrix.flat().filter(Boolean).length;
			if (cellCount >= 3 && cellCount <= 4) {
				mediumShapes.push(shape);
			}
		}
	}
	const shapePool = mediumShapes.length > 0 ? mediumShapes : (BASE_SHAPES.standard || []);

	for (const pid of gameState.playerOrder) {
		const player = gameState.players[pid];
		if (!player || player.connected === false) continue;
		const rng = createRNG(Date.now() ^ hashStringToInt(`${pid}-round-${gameState.turnCount}`));
		const shape = shapePool[Math.floor(rng() * shapePool.length)];
		const color = playableColors[Math.floor(rng() * playableColors.length)];
		const biggerCards = !!player.perks?.biggerCards;
		let pickedShape = shape;
		if (biggerCards) {
			const largePool = (BASE_SHAPES.large || []).filter(s => s.matrix.flat().filter(Boolean).length <= 5);
			if (largePool.length > 0 && rng() < 0.5) {
				pickedShape = largePool[Math.floor(rng() * largePool.length)];
			}
		}
		const bonusCard = {
			id: `rw-bonus-${pid}-r${gameState.turnCount}-${Math.floor(rng() * 100000)}`,
			shapeName: pickedShape.name,
			matrix: cloneMatrix(pickedShape.matrix),
			category: pickedShape.category || 'standard',
			color: { ...color },
			isGolden: false,
			rotation: 0,
			mirrored: false,
			_roundBonus: true
		};
		player.drawPile.unshift(bonusCard);
		// Markeer voor animatie op de client
		if (!gameState._roundBonusCards) gameState._roundBonusCards = {};
		gameState._roundBonusCards[pid] = bonusCard;
	}
}

function advanceTurn(gameState) {
	const playerCount = gameState.playerOrder.length;
	let attempts = 0;

	// Reset turn state
	delete gameState._turnUndoData;
	delete gameState._cardPlayedThisTurn;
	delete gameState._coinCardsPlayedThisTurn;
	delete gameState._coinFreeCardUsed;
	delete gameState._turnTimerStart;
	gameState.bonusPlayedThisTurn = false;

	do {
		gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % playerCount;
		spawnBonusesAfterRoundFour(gameState, { isRoundStart: false });

		if (gameState.currentTurnIndex === 0) {
			gameState.turnCount++;
			spawnBonusesAfterRoundFour(gameState, { isRoundStart: true });
		}

		const nextPid = gameState.playerOrder[gameState.currentTurnIndex];
		const nextPlayer = gameState.players[nextPid];
		if (!nextPlayer || nextPlayer.connected === false) {
			attempts++;
			continue;
		}

		// Vul hand aan tot 3 kaarten als drawPile beschikbaar is
		if (nextPlayer.hand.length < 3 && nextPlayer.drawPile.length > 0) {
			drawHand(gameState, nextPid);
		}

		// Als deze speler kaarten heeft OF bonussen heeft, is het hun beurt
		if (nextPlayer.hand.length > 0 || playerHasBonuses(nextPlayer)) {
			gameState._turnTimerStart = Date.now();
			// Initialiseer _turnUndoData voor bonus-only beurten
			if (nextPlayer.hand.length === 0 && playerHasBonuses(nextPlayer)) {
				gameState._turnUndoData = {
					playerId: nextPid,
					card: null,
					cardIndex: -1,
					objectiveSnapshot: {
						objectiveAchieved: !!nextPlayer.objectiveAchieved,
						objectiveAchievedPoints: nextPlayer.objectiveAchievedPoints || 0,
						objectiveProgress: nextPlayer.objectiveProgress ? { ...nextPlayer.objectiveProgress } : null,
						goldCoins: nextPlayer.goldCoins || 0,
						bonusInventory: nextPlayer.bonusInventory ? { ...nextPlayer.bonusInventory } : { yellow: 0, red: 0, green: 0, purple: 0, blue: 0, any: 0 }
					},
					placedCells: [],
					zoneName: null,
					subgridId: null,
					collectedBonuses: [],
					goldCollected: 0,
					moveHistoryLengthBefore: gameState.moveHistory.length,
					bonusMoves: []
				};
			}
			break;
		}

		attempts++;
	} while (attempts < playerCount);
	// Als niemand kaarten of bonussen heeft eindigt de loop — checkGameEnd handelt dat af
}

/** Check of alle kaarten EN bonussen op zijn → level compleet of spel afgelopen */
function checkGameEnd(gameState) {
	const allEmpty = gameState.playerOrder.every(pid => {
		const p = gameState.players[pid];
		if (!p || p.connected === false) return true;
		return p.hand.length === 0 && p.drawPile.length === 0 && !playerHasBonuses(p);
	});

	if (!allEmpty) return false;

	// Detect mutual sabotage pairs: if A blocks B and B blocks A, both fail
	for (const pidA of gameState.playerOrder) {
		const pA = gameState.players[pidA];
		if (!pA?.chosenObjective || pA.objectiveAchieved) continue;
		if (!isNamedSabotageObjective(pA.chosenObjective)) continue;
		const targetA = pA.chosenObjective.targetPlayerId;
		if (!targetA) continue;
		const pB = gameState.players[targetA];
		if (!pB?.chosenObjective || pB.objectiveAchieved) continue;
		if (!isNamedSabotageObjective(pB.chosenObjective)) continue;
		if (pB.chosenObjective.targetPlayerId === pidA) {
			// Mutual block → both fail
			pA.objectiveFailed = true;
			pA._mutualSabotageFailed = true;
			pB.objectiveFailed = true;
			pB._mutualSabotageFailed = true;
		}
	}

	// Level is klaar: herbereken ALLE spelers' scores definitief
	const isRewarding = !!gameState.settings?.rewardingMode;
	const finalPlayerScores = calculatePlayerScores(gameState.boardState, gameState.playerOrder);
	for (const pid of gameState.playerOrder) {
		const coinPts = isRewarding && !gameState.settings?.coinMode ? (gameState.players[pid]?.goldCoins || 0) * 5 : 0;
		gameState.players[pid].score = finalPlayerScores[pid].total + coinPts;
		gameState.players[pid].scoreBreakdown = { ...finalPlayerScores[pid], coinPoints: coinPts, total: finalPlayerScores[pid].total + coinPts };
	}

	// Bereken level scores
	const levelScores = {};
	for (const pid of gameState.playerOrder) {
		const p = gameState.players[pid];
		const objResult = p.chosenObjective
			? checkObjective(gameState, pid, p.chosenObjective)
			: { achieved: false, current: 0, target: 0, points: 0, coins: 0, randomBonuses: 0 };
		// If objective was already awarded during play, don't add again
		const alreadyAwarded = !!p.objectiveAchieved;
		const objectiveBonus = alreadyAwarded ? (p.objectiveAchievedPoints || 0) : (objResult.achieved ? getObjectiveRewardPoints(objResult, 15) : 0);
		// For players who didn't get real-time award, add now
		if (!alreadyAwarded && objResult.achieved) {
			awardObjectiveRewards(gameState, pid, p.chosenObjective, objResult);
			p.score = (p.score || 0) + (p.objectiveAchievedPoints || 0);
		}
		levelScores[pid] = {
			...(p.scoreBreakdown || { yellow: 0, green: 0, blue: 0, red: 0, purple: 0, bonus: 0, gold: 0, total: 0 }),
			objectiveBonus: alreadyAwarded ? (p.objectiveAchievedPoints || 0) : objectiveBonus,
			objectiveAchieved: p.objectiveAchieved || objResult.achieved,
			objectiveCurrent: objResult.current,
			objectiveCoins: getObjectiveRewardCoins(objResult),
			objectiveRandomBonuses: getObjectiveRandomBonuses(objResult),
			finalTotal: p.score || 0,
			goldCoins: p.goldCoins || 0
		};
	}
	gameState.levelScores = levelScores;

	// Sla level score history op voor het eindscherm
	if (!gameState.levelScoresHistory) gameState.levelScoresHistory = [];
	gameState.levelScoresHistory.push({
		level: gameState.level || 1,
		scores: JSON.parse(JSON.stringify(levelScores)),
		winner: null // wordt hierna gezet
	});

	// Ga naar shopping fase (niet direct ended)
	gameState.phase = 'levelComplete';
	gameState.updatedAt = Date.now();

	// Bepaal level winnaar
	const sorted = gameState.playerOrder
		.map(pid => ({ pid, score: levelScores[pid].finalTotal }))
		.sort((a, b) => b.score - a.score);
	gameState.levelWinner = sorted[0].pid;

	// Zet winner in history
	const lastHistory = gameState.levelScoresHistory?.[gameState.levelScoresHistory.length - 1];
	if (lastHistory) lastHistory.winner = sorted[0].pid;

	const roundWinner = gameState.players[gameState.levelWinner];
	if (roundWinner) {
		roundWinner.matchWins = (roundWinner.matchWins || 0) + 1;
	}

	// Rondebeloning: winnaar krijgt 3 coins
	const winnerPlayer = gameState.players[gameState.levelWinner];
	if (winnerPlayer) {
		winnerPlayer.goldCoins = (winnerPlayer.goldCoins || 0) + 3;
		if (gameState.levelScores?.[gameState.levelWinner]) {
			gameState.levelScores[gameState.levelWinner].goldCoins = winnerPlayer.goldCoins;
			gameState.levelScores[gameState.levelWinner].roundWinnerCoinsBonus = 3;
		}
	}

	// Nummer 2 krijgt 1 coin
	const secondPlace = sorted[1];
	if (secondPlace?.pid) {
		const secondPlayer = gameState.players[secondPlace.pid];
		if (secondPlayer) {
			secondPlayer.goldCoins = (secondPlayer.goldCoins || 0) + 1;
			if (gameState.levelScores?.[secondPlace.pid]) {
				gameState.levelScores[secondPlace.pid].goldCoins = secondPlayer.goldCoins;
				gameState.levelScores[secondPlace.pid].secondPlaceCoinsBonus = 1;
			}
		}
	}

	// ── Perk point: elke speler krijgt 1 perkpunt na elke ronde ──
	for (const pid of gameState.playerOrder) {
		const p = gameState.players[pid];
		if (p?.perks) {
			p.perks.perkPoints = (p.perks.perkPoints || 0) + 1;
		}
	}

	// ── Catch-up perk: als een speler op 3+ wins staat en anderen op 0-1,
	//    krijgen die achterlopers een extra perkpunt ──
	{
		const winsTarget = Math.max(1, Number(gameState.winsToEnd) || MATCH_WINS_TARGET);
		const threshold = Math.max(2, winsTarget - 1); // 3 bij 4 wins target
		const maxWins = Math.max(...gameState.playerOrder.map(pid =>
			gameState.players[pid]?.matchWins || 0
		));
		if (maxWins >= threshold) {
			for (const pid of gameState.playerOrder) {
				const p = gameState.players[pid];
				if (!p?.perks) continue;
				const myWins = p.matchWins || 0;
				if (myWins <= Math.floor(threshold / 2)) {
					// Achterloper: extra perkpunt
					p.perks.perkPoints = (p.perks.perkPoints || 0) + 1;
				}
			}
		}
	}

	for (const pid of gameState.playerOrder) {
		if (gameState.levelScores?.[pid]) {
			gameState.levelScores[pid].matchWins = gameState.players[pid]?.matchWins || 0;
		}
	}

	// ── Rewarding mode: auto-grant shop unlocks at milestones ──
	if (gameState.settings?.rewardingMode) {
		const lvl = gameState.level || 1;
		for (const pid of gameState.playerOrder) {
			const p = gameState.players[pid];
			if (!p) continue;
			const granted = [];
			// Level 3+ → golden cards
			if (lvl >= 3 && !p.unlockedGolden) {
				p.unlockedGolden = true;
				const rng = createRNG(Date.now() + hashStringToInt(pid) + 111);
				const choices = [];
				for (let i = 0; i < 3; i++) {
					const deck = buildDeck(1, rng, { enableGolden: true, goldenChance: 1.0 });
					choices[i] = deck[0];
					choices[i].shopPrice = 0;
				}
				granted.push({ type: 'unlock-golden', choices });
			}
			// Level 5+ → multikleur cards
			if (lvl >= 5 && !p.unlockedMultikleur) {
				p.unlockedMultikleur = true;
				const rng = createRNG(Date.now() + hashStringToInt(pid) + 222);
				const choices = [];
				for (let i = 0; i < 3; i++) {
					const deck = buildDeck(1, rng, { enableMultikleur: true, multikleurChance: 1.0 });
					choices[i] = deck[0];
					choices[i].shopPrice = 0;
				}
				granted.push({ type: 'unlock-multikleur', choices });
			}
			// Level 7+ → stone shapes
			if (lvl >= 7 && !p.unlockedSteen) {
				p.unlockedSteen = true;
				const rng = createRNG(Date.now() + hashStringToInt(pid) + 333);
				const pick2 = STONE_SHAPES_2[Math.floor(rng() * STONE_SHAPES_2.length)];
				const pick3 = STONE_SHAPES_3[Math.floor(rng() * STONE_SHAPES_3.length)];
				const pick4 = STONE_SHAPES_4[Math.floor(rng() * STONE_SHAPES_4.length)];
				const choices = [pick2, pick3, pick4].map((shape, i) => ({
					id: `stone-reward-${i}-${Math.floor(rng() * 100000)}`,
					shapeName: shape.name,
					matrix: cloneMatrix(shape.matrix),
					category: 'stone',
					color: { ...STONE_COLOR },
					isStone: true,
					rotation: 0,
					mirrored: false,
					shopPrice: 0
				}));
				granted.push({ type: 'unlock-steen', choices });
			}
			if (granted.length > 0) {
				p._rewardUnlockQueue = granted;
				// Set the first unlock's choices as pending
				p._pendingFreeChoices = granted[0].choices;
			}
		}
	}

	const winsToEnd = Math.max(1, Number(gameState.winsToEnd) || MATCH_WINS_TARGET);
	const maxLevels = Math.max(1, Number(gameState.maxLevels) || DEFAULT_MAX_LEVELS);
	const matchWinnerEntry = gameState.playerOrder
		.map(pid => ({ pid, wins: gameState.players[pid]?.matchWins || 0 }))
		.sort((a, b) => b.wins - a.wins)[0];
	// Spel is gewonnen als iemand genoeg wins heeft OF alle levels gespeeld zijn
	const currentLevel = gameState.level || 1;
	if (matchWinnerEntry && matchWinnerEntry.wins >= winsToEnd) {
		gameState.matchWinner = matchWinnerEntry.pid;
	} else if (currentLevel >= maxLevels) {
		// Alle levels gespeeld — winnaar is degene met de meeste wins (bij gelijk: meeste punten)
		gameState.matchWinner = matchWinnerEntry ? matchWinnerEntry.pid : null;
	} else {
		gameState.matchWinner = null;
	}

	return true;
}

// ──────────────────────────────────────────────
//  SHOP SYSTEEM
// ──────────────────────────────────────────────

const SHOP_ITEMS = [
	{ id: 'random-card', name: 'Random Kaart', description: 'Krijg een willekeurige kaart in je deck', cost: 1, icon: '🎲', oneTimePerLevel: true },
	{ id: 'extra-bonus', name: 'Bonus Charge', description: 'Krijg een bonus charge naar keuze (eenmalig)', cost: 2, icon: '⚡', oneTimePerLevel: true },
	{ id: 'time-bomb', name: 'Tijdbom', description: 'Stop de beurt van een andere speler direct! (eenmalig)', cost: 2, icon: '💣', oneTimePerLevel: true },
];

function getShopItems(level, player, seed, settings) {
	const isSpecialMode = !!(settings?.rewardingMode || settings?.coinMode);
	const all = SHOP_ITEMS
		.filter(item => {
			if (item.minLevel && (level || 1) < item.minLevel) return false;
			if (item.oneTimePerLevel && player?.shopPurchasesThisLevel?.[item.id]) return false;
			if (item.normalModeOnly && isSpecialMode) return false;
			return true;
		})
		.map(item => ({ ...item }));

	// Show max 2 random items per shop visit (seeded for consistency)
	if (all.length > 2) {
		const rng = createRNG((seed || 0) ^ ((level || 1) * 313));
		// Shuffle deterministically
		for (let i = all.length - 1; i > 0; i--) {
			const j = Math.floor(rng() * (i + 1));
			[all[i], all[j]] = [all[j], all[i]];
		}
		return all.slice(0, 2);
	}
	return all;
}

/** Calculate shop card price based on cell count */
function getCardPrice(card) {
	if (!card || !card.matrix) return 2;
	let cells = 0;
	for (const row of card.matrix) {
		for (const c of row) { if (c) cells++; }
	}
	return Math.max(2, cells);
}

/** Generate shop card offerings for a player: 2 open kaarten + 1 gesloten random */
function generateShopCardOfferings(gameState, playerId) {
	const seedBase = (gameState.seed | 0) ^ ((gameState.level || 1) * 977) ^ hashStringToInt(playerId);
	const rng = createRNG(seedBase);
	const player = gameState.players[playerId];
	const enableGolden = player?.unlockedGolden || false;
	const enableMultikleur = player?.unlockedMultikleur || false;
	const offerings = [];
	for (let i = 0; i < 2; i++) {
		const deck = buildDeck(1, rng, {
			enableGolden,
			enableMultikleur,
			goldenChance: 0.35,
			multikleurChance: 0.35,
		});
		const card = deck[0];
		let price = getCardPrice(card);
		// Golden/multikleur cards cost +2 extra
		if (card.isGolden || card.color?.name === 'multikleur' || card.color?.code === 'rainbow') {
			price += 2;
		}
		// Rewarding mode: kaarten 2x zo duur
		if (gameState.settings?.rewardingMode) {
			price *= 2;
		}
		card.shopPrice = price;
		offerings.push(card);
	}
	return offerings;
}

/** Start shop fase na level compleet */
function startShopPhase(gameState) {
	if (gameState.phase !== 'levelComplete') return { error: 'Niet in levelComplete fase' };
	if (gameState.matchWinner) {
		endGameFinal(gameState);
		gameState.updatedAt = Date.now();
		return { success: true, ended: true, winner: gameState.winner };
	}

	gameState.phase = 'shopping';
	for (const pid of gameState.playerOrder) {
		gameState.players[pid].shopReady = false;
		gameState.players[pid].shopPurchasesThisLevel = {};
		gameState.players[pid]._coinShopCardBought = false;
		gameState.players[pid]._coinShopActionBought = false;
		// Generate 2 open + 1 gesloten random offering per player
		gameState.players[pid].shopOfferings = generateShopCardOfferings(gameState, pid);
	}
	gameState.updatedAt = Date.now();
	return { success: true };
}

/** Koop een shop item */
function buyShopItem(gameState, playerId, itemId, extra) {
	if (gameState.phase !== 'shopping') return { error: 'Niet in shop fase' };

	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };
	const isCoinMode = !!gameState.settings?.coinMode;

	// Handle buying a specific shop card offering
	if (itemId.startsWith('shop-card-')) {
		const idx = parseInt(itemId.replace('shop-card-', ''), 10);
		const offerings = player.shopOfferings || [];
		if (idx < 0 || idx >= offerings.length) return { error: 'Kaart niet beschikbaar' };
		const card = offerings[idx];
		if (!card) return { error: 'Kaart al gekocht' };

		if (isCoinMode) {
			// Coin mode: 1 free card per shop phase
			if (player._coinShopCardBought) return { error: 'Je mag maar 1 gratis kaart kiezen in coin modus' };
			player._coinShopCardBought = true;
		} else {
			const price = card.shopPrice || getCardPrice(card);
			if ((player.goldCoins || 0) < price) return { error: 'Niet genoeg goud' };
			player.goldCoins -= price;
		}

		let boughtCard = card;

		player.shopCards.push(boughtCard);
		player.permanentShopCards = player.permanentShopCards || [];
		player.permanentShopCards.push(boughtCard);
		// Remove the bought card from offerings (set to null so indices stay stable)
		player.shopOfferings[idx] = null;
		gameState.updatedAt = Date.now();
		return { success: true, card: boughtCard };
	}

	const item = SHOP_ITEMS.find(i => i.id === itemId);
	if (!item) return { error: 'Item niet gevonden' };
	if (item.oneTimePerLevel && player.shopPurchasesThisLevel?.[itemId]) return { error: 'Dit item is eenmalig per shopronde' };

	if (isCoinMode) {
		// Coin mode: 1 free action per shop phase
		if (player._coinShopActionBought) return { error: 'Je mag maar 1 gratis actie kiezen in coin modus' };
	} else {
		if ((player.goldCoins || 0) < item.cost) return { error: 'Niet genoeg goud' };
	}

	switch (itemId) {
		case 'extra-bonus': {
			const bonusColor = extra?.bonusColor || 'yellow';
			const validColors = ['yellow', 'red', 'green', 'purple', 'blue'];
			if (!validColors.includes(bonusColor)) return { error: 'Ongeldige bonus kleur' };
			player.bonusInventory[bonusColor] = (player.bonusInventory[bonusColor] || 0) + 1;
			if (!isCoinMode) player.goldCoins -= item.cost;
			break;
		}
		case 'time-bomb': {
			player.timeBombs = (player.timeBombs || 0) + 1;
			if (!isCoinMode) player.goldCoins -= item.cost;
			break;
		}
		case 'random-card': {
			if (isCoinMode) {
				// In coin mode random-card counts as card, not action
				if (player._coinShopCardBought) return { error: 'Je mag maar 1 gratis kaart kiezen in coin modus' };
				player._coinShopCardBought = true;
			}
			const rcSeed = (gameState.seed | 0) ^ ((gameState.level || 1) * 991) ^ hashStringToInt(playerId) ^ Date.now();
			const rcRng = createRNG(rcSeed);
			const rcDeck = buildDeck(1, rcRng, {
				enableGolden: player.unlockedGolden || false,
				enableMultikleur: player.unlockedMultikleur || false,
			});
			const rcCard = rcDeck[0];
			player.shopCards.push(rcCard);
			player.permanentShopCards = player.permanentShopCards || [];
			player.permanentShopCards.push(rcCard);
			if (!isCoinMode) player.goldCoins -= item.cost;
			gameState.updatedAt = Date.now();
			return { success: true, card: rcCard };
		}
		default:
			return { error: 'Onbekend item' };
	}

	if (isCoinMode) player._coinShopActionBought = true;

	if (item.oneTimePerLevel) {
		player.shopPurchasesThisLevel = player.shopPurchasesThisLevel || {};
		player.shopPurchasesThisLevel[itemId] = true;
	}

	gameState.updatedAt = Date.now();
	return { success: true };
}

/** Choose a reward card type (golden/multikleur/steen) in rewarding mode during goal phase */
function chooseRewardCardType(gameState, playerId, cardType) {
	if (!gameState.settings?.rewardingMode) return { error: 'Alleen in beloningsmodus' };
	if (gameState.phase !== 'choosingGoals') return { error: 'Niet in doelstellingsfase' };
	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };
	if (player._pendingFreeChoices) return { error: 'Er is al een keuze actief' };
	if (player._rewardCardChosen) return { error: 'Je hebt deze ronde al een kaart gekozen' };

	const rng = createRNG(Date.now() + (playerId || '').length + 5555);
	let choices = [];

	if (cardType === 'golden') {
		player.unlockedGolden = true;
		for (let i = 0; i < 3; i++) {
			const deck = buildDeck(1, rng, { enableGolden: true, goldenChance: 1.0 });
			deck[0].shopPrice = 0;
			choices.push(deck[0]);
		}
	} else if (cardType === 'multikleur') {
		player.unlockedMultikleur = true;
		for (let i = 0; i < 3; i++) {
			const deck = buildDeck(1, rng, { enableMultikleur: true, multikleurChance: 1.0 });
			deck[0].shopPrice = 0;
			choices.push(deck[0]);
		}
	} else if (cardType === 'steen') {
		player.unlockedSteen = true;
		const pick2 = STONE_SHAPES_2[Math.floor(rng() * STONE_SHAPES_2.length)];
		const pick3 = STONE_SHAPES_3[Math.floor(rng() * STONE_SHAPES_3.length)];
		const pick4 = STONE_SHAPES_4[Math.floor(rng() * STONE_SHAPES_4.length)];
		[pick2, pick3, pick4].forEach((shape, i) => {
			choices.push({
				id: `reward-stone-${i}-${Math.floor(rng() * 100000)}`,
				shapeName: shape.name,
				matrix: cloneMatrix(shape.matrix),
				category: 'stone',
				color: { ...STONE_COLOR },
				isStone: true,
				rotation: 0,
				mirrored: false,
				shopPrice: 0
			});
		});
	} else {
		return { error: 'Ongeldig kaarttype' };
	}

	player._pendingFreeChoices = choices;
	gameState.updatedAt = Date.now();
	return { success: true, freeChoices: choices };
}

/** Claim a free card from the unlock popup (player picks 1 of 3) */
function claimFreeCard(gameState, playerId, cardId) {
	const rewardingMode = !!gameState.settings?.rewardingMode;
	const validPhase = gameState.phase === 'shopping' || (rewardingMode && (gameState.phase === 'levelComplete' || gameState.phase === 'choosingGoals'));
	if (!validPhase) return { error: 'Niet in shop fase' };
	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };

	const choices = player._pendingFreeChoices;
	if (!choices || choices.length === 0) return { error: 'Geen gratis kaart keuzes beschikbaar' };

	const card = choices.find(c => c.id === cardId);
	if (!card) return { error: 'Ongeldige kaart keuze' };

	// Add the chosen card to player's shop cards (deck for next level)
	player.shopCards.push(card);
	player.permanentShopCards = player.permanentShopCards || [];
	player.permanentShopCards.push(card);
	// Clear pending choices
	delete player._pendingFreeChoices;

	// Mark reward card chosen during goal phase
	if (gameState.phase === 'choosingGoals') {
		player._rewardCardChosen = true;
	}

	// Advance reward unlock queue if present
	if (player._rewardUnlockQueue && player._rewardUnlockQueue.length > 0) {
		player._rewardUnlockQueue.shift();
		if (player._rewardUnlockQueue.length > 0) {
			player._pendingFreeChoices = player._rewardUnlockQueue[0].choices;
		} else {
			delete player._rewardUnlockQueue;
		}
	}

	gameState.updatedAt = Date.now();
	return { success: true, card };
}

/** Sell a permanent card back for coins */
function sellCard(gameState, playerId, cardId) {
	if (gameState.phase !== 'shopping') return { error: 'Niet in shop fase' };
	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };
	if (player.shopReady) return { error: 'Je bent al klaar' };

	const permCards = player.permanentShopCards || [];
	const idx = permCards.findIndex(c => c.id === cardId);
	if (idx === -1) return { error: 'Kaart niet gevonden in je collectie' };

	const card = permCards[idx];
	if (card.isStone) return { error: 'Steenblokken kunnen niet verkocht worden' };
	if (card.isTemporary) return { error: 'Tijdelijke kaarten kunnen niet verkocht worden' };
	const cellCount = card.matrix ? card.matrix.flat().filter(Boolean).length : 1;
	// Sell price: base 1, +1 for cards with 4+ cells, +1 for golden/rainbow
	let sellPrice = 1;
	if (cellCount >= 4) sellPrice = 2;
	if (card.isGolden || card.color?.code === 'rainbow') sellPrice += 1;

	// Remove from permanent collection
	permCards.splice(idx, 1);
	// Also remove from shopCards if present
	const shopIdx = (player.shopCards || []).findIndex(c => c.id === cardId);
	if (shopIdx !== -1) player.shopCards.splice(shopIdx, 1);

	player.goldCoins = (player.goldCoins || 0) + sellPrice;
	gameState.updatedAt = Date.now();
	return { success: true, soldCard: card, sellPrice };
}

/** Calculate sell price for a card */
function getCardSellPrice(card) {
	if (!card) return 1;
	const cellCount = card.matrix ? card.matrix.flat().filter(Boolean).length : 1;
	let price = 1;
	if (cellCount >= 4) price = 2;
	if (card.isGolden || card.color?.code === 'rainbow') price += 1;
	return price;
}

/** Speler klaar met winkelen */
function shopReady(gameState, playerId) {
	if (gameState.phase !== 'shopping') return { error: 'Niet in shop fase' };
	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };

	player.shopReady = true;
	gameState.updatedAt = Date.now();

	const allReady = gameState.playerOrder.every(pid => {
		if (gameState.players[pid]?.connected === false) return true;
		return !!gameState.players[pid]?.shopReady;
	});
	return { success: true, allReady };
}

/** Start het volgende level */
function startNextLevel(gameState) {
	gameState.level++;
	const rng = createRNG(gameState.seed + gameState.level * 1000);

	// Nieuw bord genereren (level-afhankelijk)
	const mapSize = gameState.settings?.mapSize || 4;
	gameState.boardState = generateLevel1Board(rng, gameState.level, mapSize, _getMaxWins(gameState));

	// Nieuwe decks per speler (+ shop cards)
	for (const pid of gameState.playerOrder) {
		const player = gameState.players[pid];
		if (!Array.isArray(player.permanentBaseCards) || player.permanentBaseCards.length === 0) {
			const fallbackDeckType = normalizeStartingDeckType(player.startingDeckType) || 'random';
			const fallbackDeckRng = createRNG((gameState.seed | 0) ^ ((gameState.level || 1) * 8191) ^ hashStringToInt(`${pid}-fallback-${fallbackDeckType}`));
			const fallbackBaseDeck = buildStartingDeckByType(gameState.settings.cardsPerPlayer, fallbackDeckRng, fallbackDeckType);
			player.permanentBaseCards = cloneDeckCards(fallbackBaseDeck);
		}
		// Voeg blijvende shop kaarten toe + tijdelijke kaarten (voor alleen dit level)
		const tempCards = (player.shopCards || []).filter(c => c.isTemporary);
		const mergedDeck = [
			...cloneDeckCards(player.permanentBaseCards),
			...cloneDeckCards(player.permanentShopCards || []),
			...cloneDeckCards(tempCards)
		];
		const playerDeckRng = createRNG((gameState.seed | 0) ^ ((gameState.level || 1) * 4099) ^ hashStringToInt(pid));
		const fullDeck = shuffleWithRNG(mergedDeck, playerDeckRng);
		player.deck = fullDeck;
		player.drawPile = [...fullDeck];
		player.hand = [];
		player.discardPile = [];
		player.shopCards = [];
		player.shopReady = false;
		player.shopOfferings = [];
		player.shopPurchasesThisLevel = {};
		player.chosenObjective = null;
		player.objectiveAchieved = false;
		player.objectiveFailed = false;
		player.objectiveAchievedPoints = 0;
		player.objectiveProgress = null;
		player.score = 0;
		player.scoreBreakdown = { yellow: 0, green: 0, blue: 0, red: 0, purple: 0, bonus: 0, gold: 0, total: 0 };
		// Reset bonus inventory? Nee, behoud bonussen
		// Reset per-level perk counters (perks zelf blijven)
		if (player.perks) {
			player.perks.minesUsedThisLevel = 0;
			player.perks.stealsUsedThisLevel = 0;
			player.perks.wildcardsUsedThisLevel = 0;
			player.perks.activeMines = [];
		}
		delete player._rewardCardChosen;
	}

	// Nieuwe objective keuzes per level
	gameState.objectiveChoices = {};
	for (const pid of gameState.playerOrder) {
		gameState.objectiveChoices[pid] = generateObjectiveChoices(rng, gameState.level, gameState, pid);
	}

	gameState.phase = 'choosingGoals';
	gameState.currentTurnIndex = 0;
	gameState.turnCount = 1;
	delete gameState._roundFiveBonusBurstDone;
	gameState.bonusPlayedThisTurn = false;
	gameState.levelScores = null;
	gameState.levelWinner = null;
	gameState.moveHistory = [];
	gameState.updatedAt = Date.now();

	return { success: true, level: gameState.level };
}

/**
 * Gebruik een tijdbom om de beurt van de huidige speler direct te stoppen.
 * Kan alleen tijdens de beurt van een ANDERE speler worden gebruikt.
 */
function useTimeBomb(gameState, playerId) {
	if (gameState.phase !== 'playing') return { error: 'Spel is niet in play fase' };

	const currentPlayerId = gameState.playerOrder[gameState.currentTurnIndex];
	if (playerId === currentPlayerId) return { error: 'Je kunt geen tijdbom op jezelf gebruiken!' };

	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };
	if (!player.timeBombs || player.timeBombs <= 0) return { error: 'Je hebt geen tijdbommen' };

	const targetPlayer = gameState.players[currentPlayerId];
	if (!targetPlayer) return { error: 'Doelspeler niet gevonden' };

	// Verbruik de tijdbom
	player.timeBombs--;

	// Als de speler al een kaart heeft gespeeld, die blijft staan.
	// Maar de beurt wordt direct beëindigd — geen bonussen meer, geen extra acties.
	
	// Als er GEEN kaart gespeeld is: auto-discard eerste kaart
	const nonGoldenCards = targetPlayer.hand.filter(c => !c.isGolden);
	if (!gameState._cardPlayedThisTurn && nonGoldenCards.length > 0) {
		const discardIndex = targetPlayer.hand.findIndex(c => !c.isGolden);
		if (discardIndex >= 0) {
			targetPlayer.hand.splice(discardIndex, 1);
			gameState.moveHistory.push({
				playerId: currentPlayerId,
				pass: true,
				autoDiscard: true,
				timeBombed: true,
				bombedBy: playerId,
				turnCount: gameState.turnCount,
				timestamp: Date.now()
			});
		}
	}

	// Beëindig de beurt van de doelspeler
	advanceTurn(gameState);
	const ended = checkGameEnd(gameState);

	gameState.updatedAt = Date.now();

	return {
		success: true,
		bombedPlayerId: currentPlayerId,
		bombedPlayerName: targetPlayer.name,
		bomberPlayerId: playerId,
		bomberPlayerName: player.name,
		gameEnded: ended
	};
}

/**
 * Plaats een onzichtbare mijn op het bord.
 * Kan alleen door spelers met agg_mine perk, max 1× per level.
 * De mijn wordt geplaatst op een lege cel. Als een tegenstander daar plaatst,
 * verliest die speler die cel (wordt leeg gemaakt na plaatsing).
 */
function useMine(gameState, playerId, zoneName, cellX, cellY) {
	if (gameState.phase !== 'playing') return { error: 'Spel is niet in play fase' };

	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };
	if (!playerHasPerk(player, 'agg_mine')) return { error: 'Je hebt de mijn-perk niet' };
	if (!player.perks.minesPerRound || player.perks.minesPerRound <= 0) return { error: 'Geen mijnen beschikbaar' };
	if ((player.perks.minesUsedThisLevel || 0) >= 1) return { error: 'Je hebt je mijn al gebruikt dit level' };

	// Validate zone
	const zone = gameState.boardState?.zones?.[zoneName];
	if (!zone) return { error: 'Zone niet gevonden' };

	// For red zone with subgrids, find the subgrid containing these coords
	let targetZoneData = zone;
	if (zoneName === 'red' && zone.subgrids) {
		// Find which subgrid contains this cell
		for (const sg of zone.subgrids) {
			if (cellX >= 0 && cellX < sg.cols && cellY >= 0 && cellY < sg.rows) {
				targetZoneData = sg;
				break;
			}
		}
	}

	// Check cell is empty
	const cell = getDataCell(targetZoneData, cellX, cellY);
	if (!cell) return { error: 'Ongeldige cel' };
	if (cell.active) return { error: 'Cel is al bezet' };

	// Place the mine (invisible to others)
	if (!player.perks.activeMines) player.perks.activeMines = [];
	player.perks.activeMines.push({
		zone: zoneName,
		x: cellX,
		y: cellY,
		placedAt: Date.now()
	});
	player.perks.minesUsedThisLevel = (player.perks.minesUsedThisLevel || 0) + 1;

	gameState.updatedAt = Date.now();

	return {
		success: true,
		mine: { zone: zoneName, x: cellX, y: cellY }
	};
}

/**
 * Bekijk welke kaarten een speler kan stelen van een tegenstander.
 * Retourneert de niet-gouden/niet-steen kaarten met id en shapeName.
 */
function getStealableCards(gameState, playerId, targetPlayerId) {
	if (gameState.phase !== 'playing') return { error: 'Spel is niet in play fase' };
	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };
	if (!playerHasPerk(player, 'agg_steal')) return { error: 'Je hebt de diefstal-perk niet' };
	if ((player.perks.stealsUsedThisLevel || 0) >= (player.perks.stealsPerRound || 0)) {
		return { error: 'Je hebt je steal al gebruikt dit level' };
	}
	if (playerId === targetPlayerId) return { error: 'Je kunt niet van jezelf stelen' };
	const target = gameState.players[targetPlayerId];
	if (!target) return { error: 'Doelspeler niet gevonden' };

	const stealableCards = target.hand
		.filter(c => !c.isGolden && !c.isStone)
		.map(c => ({
			id: c.id,
			shapeName: c.shapeName,
			colorName: c.color?.name || '???',
			colorCode: c.color?.code || '#888',
			matrix: c.matrix
		}));

	if (stealableCards.length === 0) return { error: 'Tegenstander heeft geen stealbare kaarten' };
	return { success: true, cards: stealableCards, targetPlayerName: target.name };
}

/**
 * Steel een specifieke kaart van een tegenstander.
 * Kan alleen door spelers met agg_steal perk, max 1× per level.
 * De gestolen kaart wordt tijdelijk aan je hand toegevoegd.
 * Na het spelen gaat de kaart terug naar het deck van de oorspronkelijke eigenaar.
 */
function stealCard(gameState, playerId, targetPlayerId, cardId) {
	if (gameState.phase !== 'playing') return { error: 'Spel is niet in play fase' };

	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };
	if (!playerHasPerk(player, 'agg_steal')) return { error: 'Je hebt de diefstal-perk niet' };
	if ((player.perks.stealsUsedThisLevel || 0) >= (player.perks.stealsPerRound || 0)) {
		return { error: 'Je hebt je steal al gebruikt dit level' };
	}
	if (playerId === targetPlayerId) return { error: 'Je kunt niet van jezelf stelen' };

	const target = gameState.players[targetPlayerId];
	if (!target) return { error: 'Doelspeler niet gevonden' };

	// Zoek de specifieke kaart die de speler kiest
	const targetIdx = target.hand.findIndex(c => c.id === cardId && !c.isGolden && !c.isStone);
	if (targetIdx < 0) return { error: 'Kaart niet gevonden of niet stealbaar' };

	const stolenCard = target.hand[targetIdx];
	target.hand.splice(targetIdx, 1);

	// Markeer als tijdelijk gestolen — gaat terug na spelen
	stolenCard.isStolenTemp = true;
	stolenCard.originalOwnerId = targetPlayerId;

	// Add to stealing player's hand
	player.hand.push(stolenCard);
	player.perks.stealsUsedThisLevel = (player.perks.stealsUsedThisLevel || 0) + 1;

	gameState.updatedAt = Date.now();

	return {
		success: true,
		stolenCard: { shapeName: stolenCard.shapeName, colorName: stolenCard.color?.name },
		targetPlayerName: target.name
	};
}

/** Eindig het spel definitief (na alle levels of handmatig) */
function endGameFinal(gameState) {
	gameState.phase = 'ended';
	gameState.endedAt = Date.now();
	const winsToEnd = Math.max(1, Number(gameState.winsToEnd) || MATCH_WINS_TARGET);
	const maxLevels = Math.max(1, Number(gameState.maxLevels) || DEFAULT_MAX_LEVELS);

	const finalScores = {};
	for (const pid of gameState.playerOrder) {
		const p = gameState.players[pid];
		finalScores[pid] = {
			...(p.scoreBreakdown || { yellow: 0, green: 0, blue: 0, red: 0, purple: 0, bonus: 0, gold: 0, total: 0 }),
			finalTotal: p.score || 0,
			goldCoins: p.goldCoins || 0,
			matchWins: p.matchWins || 0
		};
	}

	gameState.finalScores = finalScores;
	const sorted = gameState.playerOrder
		.map(pid => ({ pid, wins: finalScores[pid].matchWins || 0, score: finalScores[pid].finalTotal }))
		.sort((a, b) => (b.wins - a.wins) || (b.score - a.score));
	gameState.winner = sorted[0].pid;
	if (!gameState.matchWinner && (finalScores[gameState.winner]?.matchWins || 0) >= winsToEnd) {
		gameState.matchWinner = gameState.winner;
	}

	return true;
}

// ──────────────────────────────────────────────
//  EXPORTS
// ──────────────────────────────────────────────

const GameRules = {
	// Shapes
	BASE_SHAPES, SHAPE_CATEGORY_WEIGHTS, COLORS, GOLDEN_COLOR, ZONE_THEMES,
	BONUS_SHAPES, STONE_SHAPES, STONE_SHAPES_2, STONE_SHAPES_3, STONE_SHAPES_4, STONE_COLOR,
	getRandomStoneShape,
	STARTING_DECK_TYPES,
	MATCH_WINS_TARGET, DEFAULT_MAX_LEVELS,
	YELLOW_COLUMN_PAIR_POINTS, BLUE_ROW_POINTS,

	// Board
	createZoneGrid, generateLevel1Board,

	// Placement
	getDataCell, collectPlacementCellsData, validatePlacement, applyPlacement,
	getAllowedZones, getEnhancedMatrix, makeOneCellOptional, addExtraOptionalCell,
	canPlace: function(zoneData, zoneName, baseX, baseY, matrix, perkFlags) {
		const cells = collectPlacementCellsData(zoneData, baseX, baseY, matrix);
		return !!(cells && cells.length > 0 && validatePlacement(zoneName, zoneData, cells, perkFlags));
	},

	// Transform
	cloneMatrix, rotateMatrix90, mirrorMatrix, rotateMatrixN,

	// Scoring
	calculateScores, calculatePlayerScores,
	scoreYellowData, scoreGreenData, scoreBlueData, scoreRedData, scorePurpleData,
	getRedSubgridScoreInfo,
	calculateBalanceBonus,
	getPurpleConnectionPoints,

	// Objectives
	OBJECTIVE_TEMPLATES, LEVEL_OBJECTIVES, generateObjectiveChoices, checkObjective,

	// Deck
	buildDeck, buildShapePool, buildCoinModeDeck, getCardPlayCost, isFree2x1Card,

	// Game state
	createGameState, addPlayer, removePlayer, startGame, chooseStartingDeck, chooseObjective,
	drawHand, playMove, playBonus, passMove, endTurn, undoMove,

	// Shop & Levels
	SHOP_ITEMS, getShopItems, getCardPrice, generateShopCardOfferings,
	startShopPhase, buyShopItem, claimFreeCard, chooseRewardCardType, sellCard, getCardSellPrice,
	shopReady, startNextLevel, endGameFinal, useTimeBomb, useMine, stealCard, getStealableCards,

	// Perks
	PERK_BRANCHES, choosePerk, getAvailablePerks, playerHasPerk, getBonusShapeForPlayer,

	// Utils
	createRNG, shuffleWithRNG, getMajorityOwner
};

if (typeof module !== 'undefined' && module.exports) {
	module.exports = GameRules;
}
if (typeof window !== 'undefined') {
	window.LocusGameRules = GameRules;
}
