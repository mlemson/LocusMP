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
	red: [[1]]            // Single cell voor rood
};

// ──────────────────────────────────────────────
//  STONE SHAPES (blokkerende 2-cel vormen)
// ──────────────────────────────────────────────

const STONE_SHAPES = [
	{ name: 'Steen H', matrix: [[1, 1]] },        // Horizontaal
	{ name: 'Steen V', matrix: [[1], [1]] },       // Verticaal
	{ name: 'Steen D', matrix: [[1, 0], [0, 1]] }, // Diagonaal ↘
	{ name: 'Steen D2', matrix: [[0, 1], [1, 0]] } // Diagonaal ↙
];

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
 *   bonusSymbol: null | 'yellow' | 'red' | 'green' | 'purple' | 'blue'
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
	const active = new Set();
	active.add(`${cx},${cy}`);

	const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]]; // up, down, left, right

	// Each tip has position + current direction
	// Start with branches going in all 4 directions from center
	let tips = dirs.map(d => ({ x: cx, y: cy, dx: d[0], dy: d[1] }));

	// Grow directional branches
	for (let step = 0; step < steps && tips.length > 0; step++) {
		const tipIdx = Math.floor(rng() * tips.length);
		const tip = tips[tipIdx];

		// Grow in the current direction (80% chance) or turn (20%)
		let dx = tip.dx, dy = tip.dy;
		if (rng() < 0.2) {
			// Turn perpendicular
			if (dx !== 0) { dx = 0; dy = rng() < 0.5 ? -1 : 1; }
			else { dy = 0; dx = rng() < 0.5 ? -1 : 1; }
		}

		const nx = tip.x + dx;
		const ny = tip.y + dy;

		if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && !active.has(`${nx},${ny}`)) {
			active.add(`${nx},${ny}`);

			// Move tip forward
			tip.x = nx;
			tip.y = ny;
			tip.dx = dx;
			tip.dy = dy;

			// Chance to split: create a new branch in perpendicular direction
			if (rng() < splitChance) {
				let sdx, sdy;
				if (dx !== 0) { sdx = 0; sdy = rng() < 0.5 ? -1 : 1; }
				else { sdy = 0; sdx = rng() < 0.5 ? -1 : 1; }
				tips.push({ x: nx, y: ny, dx: sdx, dy: sdy });
			}
		} else {
			// Blocked – remove this tip
			tips.splice(tipIdx, 1);
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

	// Build the cells dict – non-active cells are void
	const cells = {};
	const endCells = [];
	for (const key of active) {
		const [x, y] = key.split(',').map(Number);
		const flags = [];

		// Bold for center cell
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

	// Determine end cells: active cells with ≤1 active neighbour (but not center)
	for (const key of active) {
		const [x, y] = key.split(',').map(Number);
		if (x === cx && y === cy) continue;
		let neighborCount = 0;
		for (const [dx, dy] of dirs) {
			if (active.has(`${x + dx},${y + dy}`)) neighborCount++;
		}
		if (neighborCount <= 1) {
			cells[key].flags.push('end');
			endCells.push({ x, y });
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
		for (const c of candidates) {
			if (endCells.length >= minEndCells) break;
			if (!c.flags.includes('end')) c.flags.push('end');
			endCells.push({ x: c.x, y: c.y });
		}
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
function generateLevel1Board(rng, level) {
	const lvl = level || 1;
	// Bepaal wereld op basis van level
	let world = 1;
	if (lvl >= 4 && lvl <= 7) world = 2;
	else if (lvl >= 8) world = 3;

	const zones = {};

	// ══════════════════════════════════════════
	//  YELLOW ZONE — Wereldafhankelijk
	// ══════════════════════════════════════════
	if (world === 1) {
		// World 1: 10 kolommen, 5 rijen (staircase-achtig)
		const yellowCols = 10;
		const yellowRows = 5;
		const yellowBold = [];
		for (let y = 0; y < yellowRows; y++) {
			yellowBold.push({ x: 0, y });
		}
		const yellowGold = [];
		for (let i = 0; i < 2; i++) {
			yellowGold.push({
				x: 1 + Math.floor(rng() * (yellowCols - 2)),
				y: Math.floor(rng() * yellowRows)
			});
		}
		zones.yellow = createZoneGrid(yellowRows, yellowCols, {
			boldCells: yellowBold,
			goldCells: yellowGold
		});
		placeBonusSymbols(zones.yellow, rng, 4, { preferredColor: 'red', preferredChance: 0.5 });
	} else if (world === 2) {
		// World 2: 11 kolommen, 7 rijen (groter, meer goud)
		const yellowCols = 11;
		const yellowRows = 7;
		const yellowBold = [];
		for (let y = 0; y < yellowRows; y++) {
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
			goldCells: yellowGold
		});
		placeBonusSymbols(zones.yellow, rng, 6, { preferredColor: 'red', preferredChance: 0.5 });
	} else {
		// World 3: 12 kolommen, 8 rijen (diamond-achtig, meeste goud)
		const yellowCols = 12;
		const yellowRows = 8;
		const yellowBold = [];
		for (let y = 0; y < yellowRows; y++) {
			yellowBold.push({ x: 0, y });
		}
		// Bold cluster in midden
		yellowBold.push({ x: 5, y: 3 }, { x: 5, y: 4 }, { x: 6, y: 3 }, { x: 6, y: 4 });
		const yellowGold = [];
		for (let i = 0; i < 5; i++) {
			yellowGold.push({
				x: 1 + Math.floor(rng() * (yellowCols - 2)),
				y: Math.floor(rng() * yellowRows)
			});
		}
		// Void cells in hoeken voor diamond-vorm
		const yellowVoid = [];
		const midY = Math.floor(yellowRows / 2);
		for (let y = 0; y < yellowRows; y++) {
			const dist = Math.abs(y - midY);
			if (dist >= 3) {
				yellowVoid.push({ x: yellowCols - 1, y });
			}
		}
		zones.yellow = createZoneGrid(yellowRows, yellowCols, {
			boldCells: yellowBold,
			goldCells: yellowGold,
			voidCells: yellowVoid
		});
		placeBonusSymbols(zones.yellow, rng, 7, { preferredColor: 'red', preferredChance: 0.5 });
	}

	// ══════════════════════════════════════════
	//  GREEN ZONE — Wereldafhankelijk branch grid
	// ══════════════════════════════════════════
	if (world === 1) {
		// World 1: 15×15 branch grid
		const greenSize = 15;
		const greenCenter = Math.floor(greenSize / 2);
		zones.green = generateBranchGrid(greenSize, greenSize, 70, 0.45, rng, {
			startX: greenCenter, startY: greenCenter, minEndCells: 8, minActiveCells: 25
		});
	} else if (world === 2) {
		// World 2: 20×18 branch grid, meer groei
		const greenRows = 20;
		const greenCols = 18;
		const greenCenterX = Math.floor(greenCols / 2);
		const greenCenterY = Math.floor(greenRows / 2);
		zones.green = generateBranchGrid(greenRows, greenCols, 140, 0.35, rng, {
			startX: greenCenterX, startY: greenCenterY, minEndCells: 8, minActiveCells: 25
		});
	} else {
		// World 3: 24×22 branch grid, veel groei en splits
		const greenRows = 24;
		const greenCols = 22;
		const greenCenterX = Math.floor(greenCols / 2);
		const greenCenterY = Math.floor(greenRows / 2);
		zones.green = generateBranchGrid(greenRows, greenCols, 200, 0.55, rng, {
			startX: greenCenterX, startY: greenCenterY, minEndCells: 8, minActiveCells: 25
		});
	}

	// Gold en bonus in green zone
	const greenCellKeys = Object.keys(zones.green.cells);
	const greenGoldCount = world === 1 ? 3 : (world === 2 ? 5 : 7);
	for (let i = 0; i < greenGoldCount && greenCellKeys.length > 0; i++) {
		const idx = Math.floor(rng() * greenCellKeys.length);
		const cell = zones.green.cells[greenCellKeys[idx]];
		if (cell && !cell.flags.includes('bold') && !cell.flags.includes('end') && !cell.flags.includes('gold')) {
			cell.flags.push('gold');
		}
	}
	placeBonusSymbols(zones.green, rng, world === 1 ? 3 : (world === 2 ? 5 : 7), {
		preferredColor: 'red',
		preferredChance: 0.35
	});

	// ══════════════════════════════════════════
	//  BLUE ZONE — Wereldafhankelijk toren
	// ══════════════════════════════════════════
	if (world === 1) {
		// World 1: 5 breed, iets hoger met extra bold-laag
		const blueWidth = 5;
		const blueHeight = 24;
		const blueBold = [];
		const blueBoldRows = [0, 5, 10, 15, 20];
		for (const by of blueBoldRows) {
			for (let x = 0; x < blueWidth; x++) {
				blueBold.push({ x, y: by });
			}
		}
		const blueGold = [];
		for (let i = 0; i < 2; i++) {
			blueGold.push({ x: Math.floor(rng() * blueWidth), y: Math.floor(rng() * blueHeight) });
		}
		zones.blue = createZoneGrid(blueHeight, blueWidth, { boldCells: blueBold, goldCells: blueGold });
		zones.blue.boldRows = blueBoldRows;
		placeBonusSymbols(zones.blue, rng, 3, { preferredColor: 'red', preferredChance: 0.5 });
	} else if (world === 2) {
		// World 2: 7 breed, iets hoger met extra bold-laag
		const blueWidth = 7;
		const blueHeight = 36;
		const blueBold = [];
		const blueBoldRows = [0, 6, 12, 18, 24, 30];
		for (const by of blueBoldRows) {
			for (let x = 0; x < blueWidth; x++) {
				blueBold.push({ x, y: by });
			}
		}
		const blueGold = [];
		for (let i = 0; i < 4; i++) {
			blueGold.push({ x: Math.floor(rng() * blueWidth), y: Math.floor(rng() * blueHeight) });
		}
		zones.blue = createZoneGrid(blueHeight, blueWidth, { boldCells: blueBold, goldCells: blueGold });
		zones.blue.boldRows = blueBoldRows;
		placeBonusSymbols(zones.blue, rng, 5, { preferredColor: 'red', preferredChance: 0.5 });
	} else {
		// World 3: 9 breed, iets hoger met extra bold-laag
		const blueWidth = 9;
		const blueHeight = 48;
		const blueBold = [];
		const blueBoldRows = [0, 7, 14, 21, 28, 35, 42];
		for (const by of blueBoldRows) {
			for (let x = 0; x < blueWidth; x++) {
				blueBold.push({ x, y: by });
			}
		}
		const blueGold = [];
		for (let i = 0; i < 6; i++) {
			blueGold.push({ x: Math.floor(rng() * blueWidth), y: Math.floor(rng() * blueHeight) });
		}
		zones.blue = createZoneGrid(blueHeight, blueWidth, { boldCells: blueBold, goldCells: blueGold });
		zones.blue.boldRows = blueBoldRows;
		placeBonusSymbols(zones.blue, rng, 7, { preferredColor: 'red', preferredChance: 0.5 });
	}

	// ══════════════════════════════════════════
	//  RED ZONE — Wereldafhankelijk subgrids
	// ══════════════════════════════════════════
	if (world === 1) {
		zones.red = {
			subgrids: [
				{ id: 'red-grid1', ...generateHoleySubgrid(4, 4, 8, rng),  targetPoints: 20 },
				{ id: 'red-grid2', ...generateHoleySubgrid(4, 5, 12, rng), targetPoints: 35 },
				{ id: 'red-grid3', ...generateHoleySubgrid(5, 5, 16, rng), targetPoints: 50 },
				{ id: 'red-grid4', ...generateHoleySubgrid(5, 5, 20, rng), targetPoints: 65 }
			]
		};
	} else if (world === 2) {
		zones.red = {
			subgrids: [
				{ id: 'red-grid1', ...generateHoleySubgrid(4, 5, 12, rng), targetPoints: 25 },
				{ id: 'red-grid2', ...generateHoleySubgrid(4, 6, 16, rng), targetPoints: 40 },
				{ id: 'red-grid3', ...generateHoleySubgrid(5, 6, 20, rng), targetPoints: 55 },
				{ id: 'red-grid4', ...generateHoleySubgrid(5, 6, 24, rng), targetPoints: 70 }
			]
		};
	} else {
		zones.red = {
			subgrids: [
				{ id: 'red-grid1', ...generateHoleySubgrid(5, 6, 18, rng), targetPoints: 30 },
				{ id: 'red-grid2', ...generateHoleySubgrid(5, 7, 22, rng), targetPoints: 45 },
				{ id: 'red-grid3', ...generateHoleySubgrid(6, 7, 26, rng), targetPoints: 60 },
				{ id: 'red-grid4', ...generateHoleySubgrid(6, 7, 30, rng), targetPoints: 75 },
				{ id: 'red-grid5', ...generateHoleySubgrid(8, 10, 34, rng), targetPoints: 90 },
				{ id: 'red-grid6', ...generateHoleySubgrid(8, 10, 38, rng), targetPoints: 110 }
			]
		};
	}

	// Gold en bonus in rode subgrids
	for (const sg of zones.red.subgrids) {
		const sgKeys = Object.keys(sg.cells);
		if (sgKeys.length > 0) {
			const gIdx = Math.floor(rng() * sgKeys.length);
			const gCell = sg.cells[sgKeys[gIdx]];
			if (gCell && !gCell.flags.includes('gold')) gCell.flags.push('gold');
		}
		const redBonusBase = world === 1 ? 3 : (world === 2 ? 4 : 5);
		placeBonusSymbols(sg, rng, redBonusBase * 0.75);
	}

	// ══════════════════════════════════════════
	//  PURPLE ZONE — Wereldafhankelijk
	// ══════════════════════════════════════════
	const purpleSize = world === 1 ? 11 : (world === 2 ? 13 : 14);
	const purpleCenter = Math.floor(purpleSize / 2);
	const purpleBold = [];
	const purpleBoldCount = world === 1 ? 8 : (world === 2 ? 10 : 14);

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

	placeBonusSymbols(zones.purple, rng, world === 1 ? 3 : (world === 2 ? 5 : 7), {
		preferredColor: 'red',
		preferredChance: 0.35
	});

	// Vanaf level 5: plaats parel-schatten (wit/ronde marker) die 5 munten geven
	if (lvl >= 5 && zones.yellow) {
		const pearlCount = lvl >= 8 ? 2 : 1;
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

/**
 * Plaats bonus-symbolen willekeurig in een zone.
 * Bonus symbolen geven bij activatie een bonus-charge
 * voor de aangegeven kleur.
 */
function placeBonusSymbols(zoneData, rng, count, options = {}) {
	const bonusColors = ['yellow', 'red', 'green', 'purple', 'blue'];
	const preferredColor = bonusColors.includes(options.preferredColor) ? options.preferredColor : null;
	const preferredChance = Math.max(0, Math.min(1, Number(options.preferredChance || 0)));
	const targetCount = Math.max(0, Math.floor((Number(count) || 0) * 2));
	const availableCells = Object.values(zoneData.cells).filter(c =>
		!c.active &&
		!c.flags.includes('bold') &&
		!c.flags.includes('portal') && !c.flags.includes('gold') &&
		!c.bonusSymbol
	);

	const shuffled = shuffleWithRNG(availableCells, rng);
	for (let i = 0; i < Math.min(targetCount, shuffled.length); i++) {
		const color = (preferredColor && rng() < preferredChance)
			? preferredColor
			: bonusColors[Math.floor(rng() * bonusColors.length)];
		shuffled[i].bonusSymbol = color;
	}
}

function placeSingleBonusSymbol(zoneData, rng, options = {}) {
	if (!zoneData?.cells) return false;
	const bonusColors = ['yellow', 'red', 'green', 'purple', 'blue'];
	const preferredColor = bonusColors.includes(options.preferredColor) ? options.preferredColor : null;
	const preferredChance = Math.max(0, Math.min(1, Number(options.preferredChance || 0)));
	const availableCells = Object.values(zoneData.cells).filter(c =>
		!c.active &&
		!c.flags.includes('bold') &&
		!c.flags.includes('portal') && !c.flags.includes('gold') &&
		!c.bonusSymbol && !c.treasureCoins
	);
	if (availableCells.length === 0) return false;
	const cell = availableCells[Math.floor(rng() * availableCells.length)];
	const color = (preferredColor && rng() < preferredChance)
		? preferredColor
		: bonusColors[Math.floor(rng() * bonusColors.length)];
	cell.bonusSymbol = color;
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
		? ['yellow', 'yellow', 'blue', 'blue', 'red', 'red', 'green', 'purple']
		: (world === 2
			? ['yellow', 'blue', 'blue', 'red', 'red', 'green', 'green', 'purple']
			: ['yellow', 'blue', 'blue', 'red', 'red', 'green', 'green', 'green', 'purple']);
	let spawned = 0;

	for (let i = 0; i < spawnCount; i++) {
		let placed = false;
		for (let attempt = 0; attempt < 16 && !placed; attempt++) {
			const zonePick = weightedZones[Math.floor(rng() * weightedZones.length)];
			if (zonePick === 'red') {
				const subgrids = shuffleWithRNG([...(gameState.boardState.zones.red?.subgrids || [])], rng);
				for (const sg of subgrids) {
					if (placeSingleBonusSymbol(sg, rng, { preferredColor: 'red', preferredChance: 0.35 })) {
						placed = true;
						break;
					}
				}
			} else {
				const zoneData = gameState.boardState.zones[zonePick];
				placed = placeSingleBonusSymbol(zoneData, rng, { preferredColor: 'red', preferredChance: 0.25 });
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

/**
 * Verzamel alle cellen die een shape zou bezetten.
 * Returns null als plaatsing onmogelijk is (buiten grid of bezet).
 */
function collectPlacementCellsData(zoneData, baseX, baseY, matrix) {
	if (!zoneData || !Array.isArray(matrix) || !matrix.length) return null;
	const pending = [];

	for (let y = 0; y < matrix.length; y++) {
		for (let x = 0; x < (matrix[y]?.length || 0); x++) {
			if (!matrix[y][x]) continue;
			const targetX = baseX + x;
			const targetY = baseY + y;
			const cell = getDataCell(zoneData, targetX, targetY);
			if (!cell) return null;
			if (cell.active) return null;
			pending.push({ x: targetX, y: targetY });
		}
	}

	return pending.length > 0 ? pending : null;
}

/**
 * Valideer plaatsing per zone type.
 * Regels exact uit index.html:
 * - Yellow: eerste=moet bold raken; daarna=bold OF adjacent active
 * - Blue: eerste=moet bodem(maxY) of portal of bold raken; daarna=idem OF adjacent
 * - Green: eerste=moet bold anchor raken; daarna=anchor OF adjacent
 * - Red: altijd vrij plaatsen (geen adjacency constraint)
 * - Purple: eerste=portal OF alleen inner grid (geen outer ring); daarna=portal OF adjacent
 */
function validatePlacement(zoneName, zoneData, pendingCells) {
	if (!pendingCells || !pendingCells.length) return false;

	switch (zoneName) {
		case 'yellow': return validateYellow(zoneData, pendingCells);
		case 'blue':   return validateBlue(zoneData, pendingCells);
		case 'green':  return validateGreen(zoneData, pendingCells);
		case 'red':    return true;
		case 'purple': return validatePurple(zoneData, pendingCells);
		default: return true;
	}
}

function validateYellow(zoneData, pendingCells) {
	const hasActive = zoneHasActive(zoneData);
	const touchesBold = pendingCells.some(c => {
		const cell = getDataCell(zoneData, c.x, c.y);
		return cell && cell.flags.includes('bold');
	});
	const touchesPortal = pendingCells.some(c => {
		const cell = getDataCell(zoneData, c.x, c.y);
		return cell && cell.flags.includes('portal');
	});
	if (!hasActive) return touchesBold || touchesPortal;
	if (touchesBold || touchesPortal) return true;
	return pendingCells.some(c => hasAdjacentActive(zoneData, c.x, c.y));
}

function validateBlue(zoneData, pendingCells) {
	const hasActive = zoneHasActive(zoneData);
	const maxY = zoneData.rows - 1;
	const touchesFloor = pendingCells.some(c => c.y === maxY);

	// Eerste plaatsing: MOET de onderste rij raken
	if (!hasActive) return touchesFloor;
	// Daarna: adjacent aan bestaande actieve cel
	if (touchesFloor) return true;
	return pendingCells.some(c => hasAdjacentActive(zoneData, c.x, c.y));
}

function validateGreen(zoneData, pendingCells) {
	const hasActive = zoneHasActive(zoneData);
	const touchesBold = pendingCells.some(c => {
		const cell = getDataCell(zoneData, c.x, c.y);
		return cell && cell.flags.includes('bold');
	});
	const touchesPortal = pendingCells.some(c => {
		const cell = getDataCell(zoneData, c.x, c.y);
		return cell && cell.flags.includes('portal');
	});

	if (!hasActive) return touchesBold || touchesPortal;
	if (touchesBold || touchesPortal) return true;
	return pendingCells.some(c => hasAdjacentActive(zoneData, c.x, c.y));
}

function validatePurple(zoneData, pendingCells) {
	const hasActive = zoneHasActive(zoneData);
	const touchesPortal = pendingCells.some(c => {
		const cell = getDataCell(zoneData, c.x, c.y);
		return cell && cell.flags.includes('portal');
	});

	if (!hasActive) {
		if (touchesPortal) return true;
		// Eerste plaatsing: alleen inner grid (geen outer ring 0 of 1)
		return pendingCells.every(c => {
			const cell = getDataCell(zoneData, c.x, c.y);
			return cell && !cell.flags.includes('outer-ring-0') && !cell.flags.includes('outer-ring-1');
		});
	}

	if (touchesPortal) return true;
	return pendingCells.some(c => hasAdjacentActive(zoneData, c.x, c.y));
}

/**
 * Plaats een shape en geef de resultaten terug.
 * Retourneert ook verzamelde bonussen en gold cells.
 */
function applyPlacement(boardState, zoneName, zoneData, baseX, baseY, matrix, color, playerId) {
	const pendingCells = collectPlacementCellsData(zoneData, baseX, baseY, matrix);
	if (!pendingCells) return null;
	if (!validatePlacement(zoneName, zoneData, pendingCells)) return null;
	const isStonePlacement = !!color?.isStone;
	const placedColor = isStonePlacement ? { ...STONE_COLOR } : color;

	if (!Number.isFinite(boardState._placementSeq)) {
		boardState._placementSeq = 0;
	}

	const placedCells = [];
	const collectedBonuses = [];
	let goldCollected = 0;

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
			}

			// Bonus symbool: geeft een bonus charge
			if (cell.bonusSymbol) {
				collectedBonuses.push(cell.bonusSymbol);
			}
		}
	}

	return {
		zoneName,
		cells: placedCells,
		playerId,
		color,
		goldCollected,
		collectedBonuses
	};
}

// ──────────────────────────────────────────────
//  SCORING (gebaseerd op index.html formules)
// ──────────────────────────────────────────────

/**
 * YELLOW SCORING: Kolom-gebaseerd
 * Punten per compleet gevulde kolom, oplopend van links→rechts:
 * Kolom paar 0,1 → 12pt; 2,3 → 18pt; 4,5 → 30pt; 6,7 → 42pt; 8,9 → 60pt
 */
const YELLOW_COLUMN_PAIR_POINTS = [10, 14, 20, 28, 38];

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
	let score = 0;

	for (let x = 0; x < zoneData.cols; x++) {
		if (hasStoneInYellowColumn(zoneData, x)) continue;
		let colComplete = true;
		for (let y = 0; y < zoneData.rows; y++) {
			const cell = getDataCell(zoneData, x, y);
			if (!cell || !cell.active) { colComplete = false; break; }
		}
		if (colComplete) {
			const pairIndex = Math.min(
				Math.floor(x / 2),
				YELLOW_COLUMN_PAIR_POINTS.length - 1
			);
			score += YELLOW_COLUMN_PAIR_POINTS[pairIndex];
		}
	}

	return score;
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
// Blue scoring tiers (onder → boven): +10, +15, +20, +25, top +40
const BLUE_ROW_POINTS = [10, 15, 20, 25, 40];

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
	const fullBonusPoints = isFull ? Math.max(4, Math.round(basePoints * 0.35)) : 0;
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
 * Verbind actieve cellen aan bold-cellen.
 * Per cluster: lineair per extra verbonden bold-cell.
 * 2 bold = 6pt, 3 bold = 12pt, 4 bold = 18pt, ...
 * Zo geldt altijd: meer verbonden bold-cellen = meer punten.
 */
function getPurpleConnectionPoints(boldCount) {
	if (!Number.isFinite(boldCount) || boldCount < 2) return 0;
	const connections = boldCount - 1;
	return 6 * ((connections * (connections + 1)) / 2);
}

function scorePurpleData(zoneData) {
	if (!zoneData) return 0;
	const visited = new Set();
	let score = 0;

	// Vind alle actieve cellen
	const activeCells = Object.values(zoneData.cells).filter(c => c.active && !c.isStone);
	if (activeCells.length === 0) return 0;

	// BFS voor elk onbezocht cluster
	for (const startCell of activeCells) {
		const key = `${startCell.x},${startCell.y}`;
		if (visited.has(key)) continue;

		const cluster = [];
		let boldCount = 0;
		const queue = [startCell];
		visited.add(key);

		while (queue.length > 0) {
			const current = queue.shift();
			cluster.push(current);
			if (current.flags.includes('bold')) boldCount++;

			const neighbors = [
				getDataCell(zoneData, current.x - 1, current.y),
				getDataCell(zoneData, current.x + 1, current.y),
				getDataCell(zoneData, current.x, current.y - 1),
				getDataCell(zoneData, current.x, current.y + 1)
			];
			for (const n of neighbors) {
				if (n && n.active && !n.isStone && !visited.has(`${n.x},${n.y}`)) {
					visited.add(`${n.x},${n.y}`);
					queue.push(n);
				}
			}
		}

		// Score: progressief per verbinding (+6, +8, +10, ...)
		if (boldCount >= 2) {
			score += getPurpleConnectionPoints(boldCount);
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

	// ── YELLOW: kolom scoring ──
	const yellowZone = boardState.zones.yellow;
	if (yellowZone) {
		for (let x = 0; x < yellowZone.cols; x++) {
			if (hasStoneInYellowColumn(yellowZone, x)) continue;
			let colComplete = true;
			const colCells = [];
			for (let y = 0; y < yellowZone.rows; y++) {
				const cell = getDataCell(yellowZone, x, y);
				if (!cell || !cell.active) { colComplete = false; break; }
				colCells.push(cell);
			}
			if (colComplete && colCells.length > 0) {
				const pairIndex = Math.min(Math.floor(x / 2), YELLOW_COLUMN_PAIR_POINTS.length - 1);
				const points = YELLOW_COLUMN_PAIR_POINTS[pairIndex];
				const winner = getLatestPlacerOwner(colCells);
				if (winner && playerScores[winner]) {
					playerScores[winner].yellow += points;
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
		const visited = new Set();
		const activeCells = Object.values(purpleZone.cells).filter(c => c.active && !c.isStone);

		for (const startCell of activeCells) {
			const key = `${startCell.x},${startCell.y}`;
			if (visited.has(key)) continue;

			const cluster = [];
			let boldCount = 0;
			const queue = [startCell];
			visited.add(key);

			while (queue.length > 0) {
				const current = queue.shift();
				cluster.push(current);
				if (current.flags.includes('bold')) boldCount++;

				const neighbors = [
					getDataCell(purpleZone, current.x - 1, current.y),
					getDataCell(purpleZone, current.x + 1, current.y),
					getDataCell(purpleZone, current.x, current.y - 1),
					getDataCell(purpleZone, current.x, current.y + 1)
				];
				for (const n of neighbors) {
					if (n && n.active && !n.isStone && !visited.has(`${n.x},${n.y}`)) {
						visited.add(`${n.x},${n.y}`);
						queue.push(n);
					}
				}
			}

			if (boldCount >= 2) {
				const points = getPurpleConnectionPoints(boldCount);
				const winner = getPurpleClusterOwner(cluster);
				if (winner && playerScores[winner]) {
					playerScores[winner].purple += points;
				}
			}
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

	// Objective achievement voor actieve speler direct markeren
	checkAndAwardObjective(gameState, currentPlayerId);

	for (const pid of gameState.playerOrder) {
		const player = gameState.players[pid];
		const objectiveBonus = player?.objectiveAchieved ? (player.objectiveAchievedPoints || 0) : 0;
		const totalWithObjective = (playerScores[pid].total || 0) + objectiveBonus;
		gameState.players[pid].score = totalWithObjective;
		gameState.players[pid].scoreBreakdown = {
			...playerScores[pid],
			objectiveBonus,
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
	if (coins > 0) parts.push(`${coins} coins`);
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

function pickTargetObjectiveForSabotage(gameState, sourcePlayerId, rng, levelHint = 1) {
	const playerOrder = Array.isArray(gameState?.playerOrder) ? gameState.playerOrder : [];
	const candidates = playerOrder.filter(pid => pid && pid !== sourcePlayerId && gameState.players?.[pid]?.connected !== false);
	if (candidates.length === 0) return null;

	const targetPlayerId = candidates[Math.floor(rng() * candidates.length)];
	const targetPlayer = gameState.players[targetPlayerId] || {};
	const chosen = targetPlayer.chosenObjective && !targetPlayer.chosenObjective.endOnly
		? targetPlayer.chosenObjective
		: null;
	const offered = (gameState.objectiveChoices?.[targetPlayerId] || []).filter(o => o && !o.endOnly);
	let fallback = offered.length > 0 ? offered[Math.floor(rng() * offered.length)] : null;

	if (!fallback) {
		const lvl = Math.min(Math.max(Number(gameState?.level || levelHint || 1), 1), 3);
		const levelPool = (LEVEL_OBJECTIVES[lvl] || LEVEL_OBJECTIVES[1] || [])
			.filter(o => o && !o.endOnly && o.id !== 'deny_named_l1' && o.id !== 'deny_named_l2' && o.id !== 'deny_named_l3');
		if (levelPool.length > 0) {
			const picked = levelPool[Math.floor(rng() * levelPool.length)];
			fallback = {
				id: picked.id,
				name: picked.name,
				description: picked.description
			};
		}
	}

	const objective = chosen || fallback || { id: 'unknown-target-objective', name: 'Doelstelling', description: '' };

	return {
		targetPlayerId,
		targetPlayerName: targetPlayer.name || targetPlayerId,
		targetObjectiveId: objective.id,
		targetObjectiveName: objective.name || 'Doelstelling',
		targetObjectiveDescription: objective.description || ''
	};
}

function materializeObjectiveForPlayer(baseObjective, gameState, playerId, rng) {
	const objective = { ...baseObjective };
	if (!objective.dynamicType || objective.dynamicType !== 'deny_named_objective') {
		return objective;
	}

	const targetInfo = pickTargetObjectiveForSabotage(gameState, playerId, rng, gameState?.level || 1);
	if (!targetInfo) {
		objective.name = 'Sabotage Opdracht';
		objective.description = `Zorg dat een andere speler zijn of haar doelstelling niet haalt. Reward: ${objectiveRewardsToText(objective)}.`;
		return objective;
	}

	objective.targetPlayerId = targetInfo.targetPlayerId;
	objective.targetObjectiveId = targetInfo.targetObjectiveId;
	objective.targetObjectiveName = targetInfo.targetObjectiveName;
	objective.name = `Blokkeer ${targetInfo.targetPlayerName}`;
	objective.description = `Zorg dat ${targetInfo.targetPlayerName} zijn/haar doel niet haalt: ${targetInfo.targetObjectiveName} — ${targetInfo.targetObjectiveDescription} Reward: ${objectiveRewardsToText(objective)}.`;
	return objective;
}

function countPlayerCompletedYellowCols(boardState, playerId) {
	const zone = boardState?.zones?.yellow;
	if (!zone || !playerId) return 0;
	let count = 0;
	for (let x = 0; x < zone.cols; x++) {
		if (hasStoneInYellowColumn(zone, x)) continue;
		const colCells = [];
		let complete = true;
		for (let y = 0; y < zone.rows; y++) {
			const cell = getDataCell(zone, x, y);
			if (!cell || !cell.active) {
				complete = false;
				break;
			}
			colCells.push(cell);
		}
		if (!complete) continue;
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
		if (getLatestPlacerOwner(cluster) !== playerId) continue;
		const boldCount = cluster.filter(c => c.flags.includes('bold')).length;
		maxBold = Math.max(maxBold, boldCount);
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
		{ id: 'fill_2_yellow_cols', name: 'Gele Start', description: 'Vul minstens 2 kolommen in de gele zone. Reward: 10 punten + 2 coins.', target: 2, points: 10, coins: 2,
		  useContext: true, check: (ctx) => countPlayerCompletedYellowCols(ctx.boardState, ctx.playerId)},
		{ id: 'reach_2_green_ends', name: 'Groene Verkenner', description: 'Bereik minstens 1 eindpunt in de groene zone. Reward: 10 punten + 2 coins.', target: 1, points: 10, coins: 2,
		  useContext: true, check: (ctx) => countPlayerGreenEnds(ctx.boardState, ctx.playerId)},
		{ id: 'fill_1_blue_row', name: 'Blauwe Basis', description: 'Bereik minstens 1 rij in de blauwe zone. Reward: 10 punten.', target: 1, points: 10,
		  useContext: true, check: (ctx) => getPlayerBlueHighestTier(ctx.boardState, ctx.playerId)},
		{ id: 'connect_2_purple', name: 'Paars Verbinden', description: 'Verbind minstens 3 bold-cellen in één paars cluster. Reward: 10 punten + 1 bonus.', target: 3, points: 10, randomBonuses: 1,
		  useContext: true, check: (ctx) => getPlayerPurpleMaxBoldCluster(ctx.boardState, ctx.playerId)},
		{ id: 'collect_2_gold', name: 'Goudzoeker', description: 'Verzamel minstens 3 gouden munten. Reward: 10 punten.', target: 3, points: 10,
		  useContext: true, check: (ctx) => countPlayerGoldCells(ctx.boardState, ctx.playerId)},
		{ id: 'deny_named_l1', name: 'Lichte Sabotage', description: 'Zorg dat een gekozen speler zijn/haar doel niet haalt. Reward: 10 punten + 2 coins.', target: 1, points: 10, coins: 2, useContext: true, endOnly: true, dynamicType: 'deny_named_objective',
		  check: (ctx, objective) => {
			const targetPid = objective?.targetPlayerId;
			if (!targetPid || targetPid === ctx?.playerId) return 0;
			const targetPlayer = ctx?.gameState?.players?.[targetPid];
			if (!targetPlayer?.chosenObjective) return 0;
			if (objective?.targetObjectiveId && targetPlayer.chosenObjective.id !== objective.targetObjectiveId) return 0;
			return targetPlayer.objectiveAchieved ? 0 : 1;
		  },
		  failCheck: (ctx, objective) => {
			const targetPid = objective?.targetPlayerId;
			if (!targetPid || targetPid === ctx?.playerId) return true;
			const targetPlayer = ctx?.gameState?.players?.[targetPid];
			if (!targetPlayer?.chosenObjective) return false;
			if (objective?.targetObjectiveId && targetPlayer.chosenObjective.id !== objective.targetObjectiveId) return true;
			return !!targetPlayer.objectiveAchieved;
		  }},
	],
	// Level 2: Medium doelstellingen (12-18 punten)
	2: [
		{ id: 'fill_4_yellow_cols', name: 'Gele Muur', description: 'Vul minstens 4 kolommen in de gele zone. Reward: 15 punten + 2 coins.', target: 4, points: 15, coins: 2,
		  useContext: true, check: (ctx) => countPlayerCompletedYellowCols(ctx.boardState, ctx.playerId)},
		{ id: 'reach_5_green_ends', name: 'Groene Expeditie', description: 'Bereik minstens 2 eindpunten in de groene zone. Reward: 15 punten + 2 coins.', target: 2, points: 15, coins: 2,
		  useContext: true, check: (ctx) => countPlayerGreenEnds(ctx.boardState, ctx.playerId)},
		{ id: 'fill_2_blue_rows', name: 'Blauwe Toren', description: 'Bereik minstens 2 rijen in de blauwe zone. Reward: 15 punten + 2 bonussen.', target: 2, points: 15, randomBonuses: 2,
		  useContext: true, check: (ctx) => getPlayerBlueHighestTier(ctx.boardState, ctx.playerId)},
		{ id: 'fill_2_red_grids', name: 'Rode Grids', description: 'Vul een rood grid volledig. Reward: 4 coins.', target: 1, points: 0, coins: 4,
		  useContext: true, check: (ctx) => countPlayerCompletedRedSubgrids(ctx.boardState, ctx.playerId)},
		{ id: 'connect_3_purple', name: 'Paars Netwerk', description: 'Verbind minstens 4 bold-cellen in één paars cluster. Reward: 15 punten + 2 bonussen.', target: 4, points: 15, randomBonuses: 2,
		  useContext: true, check: (ctx) => getPlayerPurpleMaxBoldCluster(ctx.boardState, ctx.playerId)},
		{ id: 'combo_yellow2_green1end', name: 'Geel + Groen Combo', description: 'Haal minstens 3 gele kolommen én 2 groen eindpunten. Reward: 40 punten + 2 coins.', target: 2, points: 40, coins: 2, useContext: true,
		  check: (ctx) => {
			let done = 0;
			if (countPlayerCompletedYellowCols(ctx.boardState, ctx.playerId) >= 3) done++;
			if (countPlayerGreenEnds(ctx.boardState, ctx.playerId) >= 2) done++;
			return done;
		  }},
		{ id: 'combo_blue2_purple4', name: 'Blauw + Paars Combo', description: 'Bereik 2 blauwe rijen én verbind 4 paarse bold-cellen. Reward: 40 punten + 2 bonussen.', target: 2, points: 40, randomBonuses: 2, useContext: true,
		  check: (ctx) => {
			let done = 0;
			if (getPlayerBlueHighestTier(ctx.boardState, ctx.playerId) >= 2) done++;
			if (getPlayerPurpleMaxBoldCluster(ctx.boardState, ctx.playerId) >= 4) done++;
			return done;
		  }},
		{ id: 'collect_5_gold', name: 'Goudmijn', description: 'Verzamel minstens 5 gouden munten. Reward: 20 punten.', target: 5, points: 20,
		  useContext: true, check: (ctx) => countPlayerGoldCells(ctx.boardState, ctx.playerId)},
		{ id: 'balance_10', name: 'Meester Evenwicht', description: 'Behaal overal tenminste 10 punten. Reward: 5 coins.', target: 10, coins: 5,
		  useContext: true, check: (ctx) => ctx?.playerScore?.bonus || 0 },
		{ id: 'deny_named_l2', name: 'Gerichte Sabotage', description: 'Zorg dat een gekozen speler zijn/haar doel niet haalt. Reward: 16 punten + 3 coins.', target: 1, points: 16, coins: 3, useContext: true, endOnly: true, dynamicType: 'deny_named_objective',
		  check: (ctx, objective) => {
			const targetPid = objective?.targetPlayerId;
			if (!targetPid || targetPid === ctx?.playerId) return 0;
			const targetPlayer = ctx?.gameState?.players?.[targetPid];
			if (!targetPlayer?.chosenObjective) return 0;
			if (objective?.targetObjectiveId && targetPlayer.chosenObjective.id !== objective.targetObjectiveId) return 0;
			return targetPlayer.objectiveAchieved ? 0 : 1;
		  },
		  failCheck: (ctx, objective) => {
			const targetPid = objective?.targetPlayerId;
			if (!targetPid || targetPid === ctx?.playerId) return true;
			const targetPlayer = ctx?.gameState?.players?.[targetPid];
			if (!targetPlayer?.chosenObjective) return false;
			if (objective?.targetObjectiveId && targetPlayer.chosenObjective.id !== objective.targetObjectiveId) return true;
			return !!targetPlayer.objectiveAchieved;
		  }},
	],
	// Level 3: Moeilijke doelstellingen (18-25 punten)
	3: [
		{ id: 'fill_6_yellow_cols', name: 'Gele Dominantie', description: 'Vul minstens 6 kolommen in de gele zone. Reward: 25 punten + 3 coins.', target: 6, points: 25, coins: 3,
		  useContext: true, check: (ctx) => countPlayerCompletedYellowCols(ctx.boardState, ctx.playerId)},
		{ id: 'reach_8_green_ends', name: 'Groene Meester', description: 'Bereik minstens 6 eindpunten in de groene zone. Reward: 25 punten + 4 coins.', target: 6, points: 25, coins: 4,
		  useContext: true, check: (ctx) => countPlayerGreenEnds(ctx.boardState, ctx.playerId)},
		{ id: 'fill_3_blue_rows', name: 'Blauwe Hemel', description: 'Bereik minstens 3 rijen in de blauwe zone. Reward: 25 punten + 3 bonussen.', target: 3, points: 25, randomBonuses: 3,
		  useContext: true, check: (ctx) => getPlayerBlueHighestTier(ctx.boardState, ctx.playerId)},
		{ id: 'fill_3_red_grids', name: 'Rode Dominantie', description: 'Vul minstens 2 rode subgrids volledig. Reward: 8 coins + 2 bonussen.', target: 2, points: 0, coins: 8, randomBonuses: 2,
		  useContext: true, check: (ctx) => countPlayerCompletedRedSubgrids(ctx.boardState, ctx.playerId)},
		{ id: 'connect_4_purple', name: 'Paars Imperium', description: 'Verbind minstens 6 bold-cellen in één paars cluster. Reward: 20 punten + 3 bonussen.', target: 6, points: 20, randomBonuses: 3,
		  useContext: true, check: (ctx) => getPlayerPurpleMaxBoldCluster(ctx.boardState, ctx.playerId)},
		{ id: 'collect_8_gold', name: 'Gouden Schatkist', description: 'Verzamel minstens 8 munten. Reward: 20 punten.', target: 8, points: 20,
		  useContext: true, check: (ctx) => countPlayerGoldCells(ctx.boardState, ctx.playerId)},
		{ id: 'deny_adjacent_green', name: 'Groene Blokkade', description: 'Laat de speler na jou op 0 punten in groen eindigen. Reward: 20 punten + 3 coins.', target: 1, points: 20, coins: 3, useContext: true, endOnly: true,
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
		{ id: 'deny_blue_top_anyone', name: 'Blauw Afstoppen', description: 'Zorg dat niemand de top van blauw bereikt. Reward: 20 punten + 5 coins.', target: 1, points: 20, coins: 5, useContext: true, endOnly: true,
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
		{ id: 'balance_15', name: 'Perfecte Balans', description: 'Behaal overal tenminste 15 punten. Reward: 8 coins.', target: 15, coins: 8,
		  useContext: true, check: (ctx) => ctx?.playerScore?.bonus || 0 },
		{ id: 'combo_yellow4_green3', name: 'Strakke Route', description: 'Haal 4 gele kolommen én 3 groene eindpunten. Reward: 25 punten + 6 coins.', target: 2, points: 25, coins: 6, useContext: true,
		  check: (ctx) => {
			let done = 0;
			if (countPlayerCompletedYellowCols(ctx.boardState, ctx.playerId) >= 4) done++;
			if (countPlayerGreenEnds(ctx.boardState, ctx.playerId) >= 3) done++;
			return done;
		  }},
		{ id: 'combo_red1_purple6', name: 'Diepe Impact', description: 'Vul 1 rood grid én verbind 6 paarse bold-cellen. Reward: 20 punten + 6 coins + 2 bonussen.', target: 2, points: 20, coins: 6, randomBonuses: 2, useContext: true,
		  check: (ctx) => {
			let done = 0;
			if (countPlayerCompletedRedSubgrids(ctx.boardState, ctx.playerId) >= 1) done++;
			if (getPlayerPurpleMaxBoldCluster(ctx.boardState, ctx.playerId) >= 6) done++;
			return done;
		  }},
		{ id: 'deny_named_l3', name: 'Elite Sabotage', description: 'Zorg dat een gekozen speler zijn/haar doel niet haalt. Reward: 25 punten + 5 coins + 2 bonussen.', target: 1, points: 25, coins: 5, randomBonuses: 2, useContext: true, endOnly: true, dynamicType: 'deny_named_objective',
		  check: (ctx, objective) => {
			const targetPid = objective?.targetPlayerId;
			if (!targetPid || targetPid === ctx?.playerId) return 0;
			const targetPlayer = ctx?.gameState?.players?.[targetPid];
			if (!targetPlayer?.chosenObjective) return 0;
			if (objective?.targetObjectiveId && targetPlayer.chosenObjective.id !== objective.targetObjectiveId) return 0;
			return targetPlayer.objectiveAchieved ? 0 : 1;
		  },
		  failCheck: (ctx, objective) => {
			const targetPid = objective?.targetPlayerId;
			if (!targetPid || targetPid === ctx?.playerId) return true;
			const targetPlayer = ctx?.gameState?.players?.[targetPid];
			if (!targetPlayer?.chosenObjective) return false;
			if (objective?.targetObjectiveId && targetPlayer.chosenObjective.id !== objective.targetObjectiveId) return true;
			return !!targetPlayer.objectiveAchieved;
		  }},
	]
};

/** Genereer 3 objectives voor een level (level-afhankelijk) */
function generateObjectiveChoices(rng, level, gameState = null, playerId = null) {
	const lvl = Math.min(level || 1, 3);
	const pool = LEVEL_OBJECTIVES[lvl] || LEVEL_OBJECTIVES[1];
	const shuffled = shuffleWithRNG([...pool], rng);
	return shuffled.slice(0, 3).map(obj => {
		const materialized = materializeObjectiveForPlayer(obj, gameState, playerId, rng);
		return {
			id: materialized.id,
			name: materialized.name,
			description: materialized.description,
			target: materialized.target,
			points: getObjectiveRewardPoints(materialized, 15),
			coins: getObjectiveRewardCoins(materialized),
			randomBonuses: getObjectiveRandomBonuses(materialized),
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

	// Zoek in alle levels
	for (const lvl of [1, 2, 3]) {
		const tmpl = LEVEL_OBJECTIVES[lvl]?.find(t => t.id === objective.id);
		if (tmpl) {
			if (tmpl.useContext && !objectiveCtx) {
				return {
					achieved: false,
					failed: false,
					current: 0,
					target: objective.target,
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
				achieved: !failed && current >= objective.target,
				failed,
				current,
				target: objective.target,
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
			target: objective.target,
			points: getObjectiveRewardPoints(objective, 15),
			coins: getObjectiveRewardCoins(objective),
			randomBonuses: getObjectiveRandomBonuses(objective)
		};
	}
	const current = template.check(activeBoardState);
	return {
		achieved: current >= objective.target,
		failed: false,
		current,
		target: objective.target,
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
			cardsPerPlayer: settings.cardsPerPlayer || 10,
			handSize: settings.handSize || 3,
			turnTimeLimit: settings.turnTimeLimit || 0
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
		bonusInventory: { yellow: 0, red: 0, green: 0, purple: 0, blue: 0 },
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

function initializeLevelOneAfterDeckChoice(gameState) {
	const rng = createRNG(gameState.seed);

	// 1. Genereer bord voor level 1
	gameState.boardState = generateLevel1Board(rng, 1);

	// 2. Genereer startdecks per speler op basis van keuze
	for (const playerId of gameState.playerOrder) {
		const player = gameState.players[playerId];
		const deckType = normalizeStartingDeckType(player.startingDeckType) || 'random';
		const baseDeckRng = createRNG((gameState.seed | 0) ^ hashStringToInt(`${playerId}-level-1-base-${deckType}`));
		const initialDeck = buildStartingDeckByType(gameState.settings.cardsPerPlayer, baseDeckRng, deckType);
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
	if (playerCount < 2) return { error: 'Minimaal 2 spelers nodig' };
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
	}
	gameState.matchWinner = null;

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
	gameState.updatedAt = Date.now();

	const allChosen = gameState.playerOrder.every(pid => {
		if (gameState.players[pid]?.connected === false) return true;
		return gameState.players[pid]?.chosenObjective != null;
	});

	if (allChosen) {
		for (const pid of gameState.playerOrder) {
			drawHand(gameState, pid);
		}
		gameState.phase = 'playing';
		gameState.currentTurnIndex = 0;
		gameState.turnCount = 1;
		delete gameState._roundFiveBonusBurstDone;
		gameState._turnTimerStart = Date.now();
	}

	return { success: true, allChosen };
}

function drawHand(gameState, playerId) {
	const player = gameState.players[playerId];
	if (!player) return;
	// Altijd aanvullen tot 3 kaarten (of minder als drawPile leeg is)
	const targetHandSize = 3;
	const drawCount = Math.max(0, Math.min(targetHandSize - player.hand.length, player.drawPile.length));
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
	const objectiveSnapshot = {
		objectiveAchieved: !!player.objectiveAchieved,
		objectiveAchievedPoints: player.objectiveAchievedPoints || 0,
		objectiveProgress: player.objectiveProgress ? { ...player.objectiveProgress } : null,
		goldCoins: player.goldCoins || 0,
		bonusInventory: player.bonusInventory ? { ...player.bonusInventory } : { yellow: 0, red: 0, green: 0, purple: 0, blue: 0 }
	};

	// Max 1 regular kaart per beurt — gouden kaarten mogen als EXTRA gespeeld worden
	if (gameState._cardPlayedThisTurn && !card.isGolden) {
		return { error: 'Je hebt al een kaart gespeeld deze beurt. Speel bonussen of beëindig je beurt.' };
	}

	// Check: mag deze kaart op deze zone?
	const allowed = getAllowedZones(card);
	if (!allowed.includes(zoneName)) {
		return { error: `${card.color.name} kaarten mogen niet op de ${zoneName} zone` };
	}

	// Apply rotation en mirror (zelfde volgorde als client: rotate dan mirror)
	let matrix = cloneMatrix(card.matrix);
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
				placementResult = applyPlacement(gameState.boardState, zoneName, subgrid, baseX, baseY, matrix, card.color, playerId);
				if (placementResult) { usedSubgridId = subgrid.id; break; }
			}
		}
		if (!placementResult) return { error: 'Ongeldige plaatsing in rode zone' };
	} else {
		const zoneData = gameState.boardState.zones[zoneName];
		if (!zoneData) return { error: `Zone '${zoneName}' niet gevonden` };
		placementResult = applyPlacement(gameState.boardState, zoneName, zoneData, baseX, baseY, matrix, card.color, playerId);
		if (!placementResult) return { error: 'Ongeldige plaatsing' };
	}

	// Verwijder kaart uit hand
	player.hand.splice(cardIndex, 1);

	// Verwerk verzamelde bonussen
	if (placementResult.collectedBonuses) {
		for (const bonusColor of placementResult.collectedBonuses) {
			player.bonusInventory[bonusColor] = (player.bonusInventory[bonusColor] || 0) + 1;
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

	// Gold coins bijhouden als currency
	if (placementResult.goldCollected > 0) {
		player.goldCoins = (player.goldCoins || 0) + placementResult.goldCollected;
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

	// NIET naar volgende beurt — speler kan nog bonussen plaatsen
	// advanceTurn en checkGameEnd worden aangeroepen door endTurn()

	gameState.updatedAt = Date.now();

	return {
		success: true,
		scores: playerScores,
		goldCollected: placementResult.goldCollected,
		bonusesCollected: placementResult.collectedBonuses,
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

	// Bonus shape — pas rotatie toe
	let matrix = bonusColor === 'red' ? cloneMatrix(BONUS_SHAPES.red) : cloneMatrix(BONUS_SHAPES.default);
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

	if (zoneName === 'red') {
		// If subgridId is provided, only place in that specific subgrid
		const subgridsToCheck = subgridId
			? gameState.boardState.zones.red.subgrids.filter(sg => sg.id === subgridId)
			: gameState.boardState.zones.red.subgrids;
		for (const sg of subgridsToCheck) {
			placementResult = applyPlacement(gameState.boardState, zoneName, sg, baseX, baseY, matrix, bonusColorObj, playerId);
			if (placementResult) break;
		}
	} else {
		const zoneData = gameState.boardState.zones[zoneName];
		if (!zoneData) return { error: 'Zone niet gevonden' };
		placementResult = applyPlacement(gameState.boardState, zoneName, zoneData, baseX, baseY, matrix, bonusColorObj, playerId);
	}

	if (!placementResult) return { error: 'Ongeldige bonus plaatsing' };

	player.bonusInventory[bonusColor]--;

	// Verwerk verzamelde bonussen van bonus-plaatsing (als bonus shape op bonus-dots landt)
	if (placementResult.collectedBonuses) {
		for (const bc of placementResult.collectedBonuses) {
			player.bonusInventory[bc] = (player.bonusInventory[bc] || 0) + 1;
		}
	}

	// Gold coins bijhouden als currency
	if (placementResult.goldCollected > 0) {
		player.goldCoins = (player.goldCoins || 0) + placementResult.goldCollected;
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
		goldCollected: placementResult.goldCollected || 0
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
	// Als er GEEN kaart gespeeld is: discard 1 niet-gouden kaart (pass-achtig).
	// Als er WEL een kaart gespeeld is: laat resterende handkaarten actief in de hand.

	const nonGoldenCards = player.hand.filter(c => !c.isGolden);
	if (!gameState._cardPlayedThisTurn && nonGoldenCards.length > 0) {
		// Geen kaart gespeeld: discard een kaart als pass
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

	// Resterende hand blijft actief (niet automatisch sacrificen of terugstorten)

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

	// 1. Undo alle bonus moves (in omgekeerde volgorde)
	for (let i = undo.bonusMoves.length - 1; i >= 0; i--) {
		const bm = undo.bonusMoves[i];
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
	}

	// 2. Undo kaart plaatsing
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

	// 3. Kaart terug in hand
	if (undo.card && undo.cardIndex >= 0) {
		player.hand.splice(undo.cardIndex, 0, undo.card);
	}

	// 4. Verwijder verzamelde bonussen van de kaartplaatsing
	for (const bc of undo.collectedBonuses) {
		player.bonusInventory[bc] = Math.max(0, (player.bonusInventory[bc] || 0) - 1);
	}

	// 5. Verwijder verzameld goud
	if (undo.goldCollected > 0) {
		player.goldCoins = Math.max(0, (player.goldCoins || 0) - undo.goldCollected);
	}

	// 6. Trim move history
	if (typeof undo.moveHistoryLengthBefore === 'number') {
		gameState.moveHistory.length = undo.moveHistoryLengthBefore;
	}

	// 6b. Herstel objective state (belangrijk voor Ctrl+Z score-consistentie)
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

	// 7. Herbereken scores (alleen actieve speler)
	const playerScores = recalcScoresForActivePlayer(gameState);

	// 8. Clear turn state
	delete gameState._turnUndoData;
	gameState._cardPlayedThisTurn = false;
	gameState.bonusPlayedThisTurn = false;
	delete gameState._turnTimerStart;

	gameState.updatedAt = Date.now();

	return { success: true, scores: playerScores };
}

/** Ga naar de volgende beurt — sla spelers zonder kaarten EN zonder bonussen over */
function advanceTurn(gameState) {
	const playerCount = gameState.playerOrder.length;
	let attempts = 0;

	// Reset turn state
	delete gameState._turnUndoData;
	delete gameState._cardPlayedThisTurn;
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
						bonusInventory: nextPlayer.bonusInventory ? { ...nextPlayer.bonusInventory } : { yellow: 0, red: 0, green: 0, purple: 0, blue: 0 }
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

	// Level is klaar: herbereken ALLE spelers' scores definitief
	const finalPlayerScores = calculatePlayerScores(gameState.boardState, gameState.playerOrder);
	for (const pid of gameState.playerOrder) {
		gameState.players[pid].score = finalPlayerScores[pid].total;
		gameState.players[pid].scoreBreakdown = finalPlayerScores[pid];
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

	// Ga naar shopping fase (niet direct ended)
	gameState.phase = 'levelComplete';
	gameState.updatedAt = Date.now();

	// Bepaal level winnaar
	const sorted = gameState.playerOrder
		.map(pid => ({ pid, score: levelScores[pid].finalTotal }))
		.sort((a, b) => b.score - a.score);
	gameState.levelWinner = sorted[0].pid;

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

	for (const pid of gameState.playerOrder) {
		if (gameState.levelScores?.[pid]) {
			gameState.levelScores[pid].matchWins = gameState.players[pid]?.matchWins || 0;
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
	{ id: 'extra-bonus', name: 'Bonus Charge', description: 'Krijg een bonus charge naar keuze (eenmalig)', cost: 2, icon: '⚡', oneTimePerLevel: true },
	{ id: 'random-card', name: 'Random Kaart', description: 'Ontvang direct 1 willekeurige kaart voor je volgende level (eenmalig)', cost: 1, icon: '🎲', oneTimePerLevel: true },
	{ id: 'time-bomb', name: 'Tijdbom', description: 'Stop de beurt van een andere speler direct! (eenmalig)', cost: 2, icon: '💣', oneTimePerLevel: true },
	{ id: 'unlock-golden', name: 'Gouden Kaarten', description: 'Unlock gouden kaarten (wildcard, elke zone)', cost: 10, icon: '✨', unlockOnly: true, minLevel: 3 },
	{ id: 'unlock-multikleur', name: 'Multikleur Kaarten', description: 'Unlock multikleur kaarten (elke zone)', cost: 10, icon: '🌈', unlockOnly: true, minLevel: 3 },
	{ id: 'unlock-steen', name: 'Steen Vormen', description: 'Kies 1 van 3 steen vormen die aangrenzende plaatsing blokkeren', cost: 10, icon: '🪨', unlockOnly: true, minLevel: 3, reappearLevel: 8 },
];

function getShopItems(level, player) {
	return SHOP_ITEMS
		.filter(item => {
			if (item.minLevel && (level || 1) < item.minLevel) return false;
			if (item.oneTimePerLevel && player?.shopPurchasesThisLevel?.[item.id]) return false;
			// Hide unlock if already unlocked (tenzij reappear op huidig level)
			if (item.id === 'unlock-golden' && player?.unlockedGolden) return false;
			if (item.id === 'unlock-multikleur' && player?.unlockedMultikleur) return false;
			if (item.id === 'unlock-steen') {
				// Steen verschijnt op minLevel en weer exact op reappearLevel
				if (player?.unlockedSteen) {
					// Al eerder gekocht: toon alleen opnieuw bij exact reappearLevel
					if (!item.reappearLevel || (level || 1) !== item.reappearLevel) return false;
				}
			}
			return true;
		})
		.map(item => ({ ...item }));
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
			goldenChance: enableGolden ? 0.35 : 0.10,
			multikleurChance: enableMultikleur ? 0.35 : 0.10,
		});
		const card = deck[0];
		let price = getCardPrice(card);
		// Golden/multikleur cards cost +2 extra
		if (card.isGolden || card.color?.name === 'multikleur' || card.color?.code === 'rainbow') {
			price += 2;
		}
		card.shopPrice = price;
		offerings.push(card);
	}

	offerings.push({
		id: `shop-random-${Math.floor(rng() * 100000)}`,
		shapeName: 'Gesloten Random Kaart',
		matrix: [[1]],
		category: 'mystery',
		color: { name: 'mysterie', code: '#4a4f6d', zone: 'any' },
		isRandomOffer: true,
		shopPrice: 3
	});
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

	// Handle buying a specific shop card offering
	if (itemId.startsWith('shop-card-')) {
		const idx = parseInt(itemId.replace('shop-card-', ''), 10);
		const offerings = player.shopOfferings || [];
		if (idx < 0 || idx >= offerings.length) return { error: 'Kaart niet beschikbaar' };
		const card = offerings[idx];
		if (!card) return { error: 'Kaart al gekocht' };
		const price = card.shopPrice || getCardPrice(card);
		if ((player.goldCoins || 0) < price) return { error: 'Niet genoeg goud' };

		let boughtCard = card;
		if (card.isRandomOffer) {
			const seedEntropy = (gameState.updatedAt || Date.now()) + ((gameState.moveHistory?.length || 0) * 71);
			const seed = (gameState.seed | 0) ^ ((gameState.level || 1) * 1777) ^ hashStringToInt(`${playerId}-shop-random-${seedEntropy}`);
			const rngRandomOffer = createRNG(seed);
			const deck = buildDeck(1, rngRandomOffer, {
				enableGolden: player.unlockedGolden || false,
				enableMultikleur: player.unlockedMultikleur || false,
				goldenChance: player.unlockedGolden ? 0.20 : 0.05,
				multikleurChance: player.unlockedMultikleur ? 0.20 : 0.05,
			});
			boughtCard = deck[0];
		}

		player.shopCards.push(boughtCard);
		player.permanentShopCards = player.permanentShopCards || [];
		player.permanentShopCards.push(boughtCard);
		player.goldCoins -= price;
		// Remove the bought card from offerings (set to null so indices stay stable)
		player.shopOfferings[idx] = null;
		gameState.updatedAt = Date.now();
		return { success: true, card: boughtCard };
	}

	const item = SHOP_ITEMS.find(i => i.id === itemId);
	if (!item) return { error: 'Item niet gevonden' };
	if (item.oneTimePerLevel && player.shopPurchasesThisLevel?.[itemId]) return { error: 'Dit item is eenmalig per shopronde' };

	if ((player.goldCoins || 0) < item.cost) return { error: 'Niet genoeg goud' };

	switch (itemId) {
		case 'extra-bonus': {
			const bonusColor = extra?.bonusColor || 'yellow';
			const validColors = ['yellow', 'red', 'green', 'purple', 'blue'];
			if (!validColors.includes(bonusColor)) return { error: 'Ongeldige bonus kleur' };
			player.bonusInventory[bonusColor] = (player.bonusInventory[bonusColor] || 0) + 1;
			player.goldCoins -= item.cost;
			break;
		}
		case 'random-card': {
			const seedEntropy = (gameState.updatedAt || Date.now()) + ((gameState.moveHistory?.length || 0) * 37);
			const seed = (gameState.seed | 0) ^ ((gameState.level || 1) * 1291) ^ hashStringToInt(`${playerId}-${seedEntropy}`);
			const rngRandomCard = createRNG(seed);
			const deck = buildDeck(1, rngRandomCard, {
				enableGolden: player.unlockedGolden || false,
				enableMultikleur: player.unlockedMultikleur || false,
				goldenChance: player.unlockedGolden ? 0.20 : 0.05,
				multikleurChance: player.unlockedMultikleur ? 0.20 : 0.05,
			});
			const randomCard = deck[0];
			player.shopCards.push(randomCard);
			player.permanentShopCards = player.permanentShopCards || [];
			player.permanentShopCards.push(randomCard);
			player.goldCoins -= item.cost;
			if (item.oneTimePerLevel) {
				player.shopPurchasesThisLevel = player.shopPurchasesThisLevel || {};
				player.shopPurchasesThisLevel[itemId] = true;
			}
			return { success: true, card: randomCard };
		}
		case 'time-bomb': {
			player.timeBombs = (player.timeBombs || 0) + 1;
			player.goldCoins -= item.cost;
			break;
		}
		case 'unlock-golden': {
			if (player.unlockedGolden) return { error: 'Al ontgrendeld' };
			player.unlockedGolden = true;
			player.goldCoins -= item.cost;
			// Generate 3 golden card choices for popup (player picks 1 free)
			const rng = createRNG(Date.now() + playerId.length);
			const goldenChoices = [];
			for (let i = 0; i < 3; i++) {
				const deck = buildDeck(1, rng, { enableGolden: true, goldenChance: 1.0 });
				goldenChoices[i] = deck[0];
				goldenChoices[i].shopPrice = 0;
			}
			// Store pending choices — player must pick 1
			player._pendingFreeChoices = goldenChoices;
			gameState.updatedAt = Date.now();
			return { success: true, freeChoices: goldenChoices };
		}
		case 'unlock-multikleur': {
			if (player.unlockedMultikleur) return { error: 'Al ontgrendeld' };
			player.unlockedMultikleur = true;
			player.goldCoins -= item.cost;
			// Generate 3 multikleur card choices for popup (player picks 1 free)
			const rng2 = createRNG(Date.now() + playerId.length + 999);
			const mkChoices = [];
			for (let i = 0; i < 3; i++) {
				const deck = buildDeck(1, rng2, { enableMultikleur: true, multikleurChance: 1.0 });
				mkChoices[i] = deck[0];
				mkChoices[i].shopPrice = 0;
			}
			player._pendingFreeChoices = mkChoices;
			gameState.updatedAt = Date.now();
			return { success: true, freeChoices: mkChoices };
		}
		case 'unlock-steen': {
			player.unlockedSteen = true;
			player.goldCoins -= item.cost;
			// Generate 3 stone shapes to choose from (popup, player picks 1 free)
			const rngS = createRNG(Date.now() + playerId.length + 7777);
			const stoneChoices = [];
			const availableStones = [...STONE_SHAPES];
			for (let i = 0; i < 3; i++) {
				const idx = Math.floor(rngS() * availableStones.length);
				const shape = availableStones[idx];
				stoneChoices.push({
					id: `stone-${i}-${Math.floor(rngS() * 100000)}`,
					shapeName: shape.name,
					matrix: cloneMatrix(shape.matrix),
					category: 'stone',
					color: { ...STONE_COLOR },
					isStone: true,
					rotation: 0,
					mirrored: false,
					shopPrice: 0
				});
			}
			player._pendingFreeChoices = stoneChoices;
			gameState.updatedAt = Date.now();
			return { success: true, freeChoices: stoneChoices };
		}
		default:
			return { error: 'Onbekend item' };
	}

	if (item.oneTimePerLevel) {
		player.shopPurchasesThisLevel = player.shopPurchasesThisLevel || {};
		player.shopPurchasesThisLevel[itemId] = true;
	}

	gameState.updatedAt = Date.now();
	return { success: true };
}

/** Claim a free card from the unlock popup (player picks 1 of 3) */
function claimFreeCard(gameState, playerId, cardId) {
	if (gameState.phase !== 'shopping') return { error: 'Niet in shop fase' };
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

	gameState.updatedAt = Date.now();
	return { success: true, card };
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
	gameState.boardState = generateLevel1Board(rng, gameState.level);

	// Nieuwe decks per speler (+ shop cards)
	for (const pid of gameState.playerOrder) {
		const player = gameState.players[pid];
		if (!Array.isArray(player.permanentBaseCards) || player.permanentBaseCards.length === 0) {
			const fallbackDeckType = normalizeStartingDeckType(player.startingDeckType) || 'random';
			const fallbackDeckRng = createRNG((gameState.seed | 0) ^ ((gameState.level || 1) * 8191) ^ hashStringToInt(`${pid}-fallback-${fallbackDeckType}`));
			const fallbackBaseDeck = buildStartingDeckByType(gameState.settings.cardsPerPlayer, fallbackDeckRng, fallbackDeckType);
			player.permanentBaseCards = cloneDeckCards(fallbackBaseDeck);
		}
		// Voeg blijvende shop kaarten toe
		const mergedDeck = [
			...cloneDeckCards(player.permanentBaseCards),
			...cloneDeckCards(player.permanentShopCards || [])
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
		player.objectiveAchievedPoints = 0;
		player.objectiveProgress = null;
		player.score = 0;
		player.scoreBreakdown = { yellow: 0, green: 0, blue: 0, red: 0, purple: 0, bonus: 0, gold: 0, total: 0 };
		// Reset bonus inventory? Nee, behoud bonussen
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
	BONUS_SHAPES, STONE_SHAPES, STONE_COLOR,
	STARTING_DECK_TYPES,
	MATCH_WINS_TARGET, DEFAULT_MAX_LEVELS,
	YELLOW_COLUMN_PAIR_POINTS, BLUE_ROW_POINTS,

	// Board
	createZoneGrid, generateLevel1Board,

	// Placement
	getDataCell, collectPlacementCellsData, validatePlacement, applyPlacement,
	getAllowedZones,
	canPlace: function(zoneData, zoneName, baseX, baseY, matrix) {
		const cells = collectPlacementCellsData(zoneData, baseX, baseY, matrix);
		return !!(cells && cells.length > 0 && validatePlacement(zoneName, zoneData, cells));
	},

	// Transform
	cloneMatrix, rotateMatrix90, mirrorMatrix, rotateMatrixN,

	// Scoring
	calculateScores, calculatePlayerScores,
	scoreYellowData, scoreGreenData, scoreBlueData, scoreRedData, scorePurpleData,
	getRedSubgridScoreInfo,
	calculateBalanceBonus,

	// Objectives
	OBJECTIVE_TEMPLATES, LEVEL_OBJECTIVES, generateObjectiveChoices, checkObjective,

	// Deck
	buildDeck, buildShapePool,

	// Game state
	createGameState, addPlayer, removePlayer, startGame, chooseStartingDeck, chooseObjective,
	drawHand, playMove, playBonus, passMove, endTurn, undoMove,

	// Shop & Levels
	SHOP_ITEMS, getShopItems, getCardPrice, generateShopCardOfferings,
	startShopPhase, buyShopItem, claimFreeCard,
	shopReady, startNextLevel, endGameFinal, useTimeBomb,

	// Utils
	createRNG, shuffleWithRNG, getMajorityOwner
};

if (typeof module !== 'undefined' && module.exports) {
	module.exports = GameRules;
}
if (typeof window !== 'undefined') {
	window.LocusGameRules = GameRules;
}
