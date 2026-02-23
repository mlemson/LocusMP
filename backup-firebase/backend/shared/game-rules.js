/**
 * ============================================================
 * LOCUS MULTIPLAYER — Shared Game Rules
 * ============================================================
 * Pure game logic dat zowel op server (Cloud Functions) als
 * client (browser) draait. GEEN DOM, GEEN Firebase imports.
 *
 * Exporteert:
 *   - Board generatie (data-only)
 *   - Shape / card definities
 *   - Placement validatie
 *   - Score berekening
 *   - Objective generatie
 *   - Turn flow helpers
 * ============================================================
 */

// ──────────────────────────────────────────────
//  SHAPES
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
	],
	extra7: [
		{ name: 'Extra Groot (7) - Randhoek', matrix: [[1,1,1],[1,0,0],[1,1,1]], weight: 0.08 },
		{ name: 'Extra Groot (7) - Dubbele balk', matrix: [[1,1,1],[0,1,0],[1,1,1]], weight: 0.08 }
	]
};

const SHAPE_CATEGORY_WEIGHTS = {
	mini: 0.35,
	standard: 1,
	large: 0.35
};

const COLORS = [
	{ name: 'rood',   code: '#b56069' },
	{ name: 'groen',  code: '#92c28c' },
	{ name: 'blauw',  code: '#5689b0' },
	{ name: 'geel',   code: '#cfba51' },
	{ name: 'paars',  code: '#8f76b8' },
	{ name: 'multikleur', code: 'rainbow' }
];

const GOLDEN_COLOR = { name: 'gouden', code: '#f5d76e', isGolden: true };

// ──────────────────────────────────────────────
//  RANDOM HELPERS (seeded for server consistency)
// ──────────────────────────────────────────────

/** Simple mulberry32 seeded PRNG for deterministic game generation */
function createRNG(seed) {
	let s = seed | 0;
	return function() {
		s = (s + 0x6D2B79F5) | 0;
		let t = Math.imul(s ^ (s >>> 15), 1 | s);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
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
 * BoardState: het gedeelde bord voor alle spelers.
 * 
 * Een board is een object met zones. Elke zone heeft een grid
 * van cellen met x,y coördinaten en properties.
 *
 * boardState = {
 *   zones: {
 *     yellow: { rows, cols, cells: { "x,y": { x, y, active, color, playerId, flags: [] } } },
 *     green:  { ... },
 *     blue:   { ... },
 *     red:    { subgrids: [ { id, rows, cols, cells: {...} } ] },
 *     purple: { ... }
 *   }
 * }
 */

/** Create an empty zone grid */
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
			if (voidSet.has(key)) continue; // skip void cells
			cells[key] = {
				x, y,
				active: false,
				color: null,
				playerId: null,
				flags: [
					...(boldSet.has(key) ? ['bold'] : []),
					...(endSet.has(key) ? ['end'] : []),
					...(portalSet.has(key) ? ['portal'] : []),
					...(goldSet.has(key) ? ['gold'] : [])
				]
			};
		}
	}
	return { rows, cols, cells, startX: options.startX, startY: options.startY };
}

// ──────────────────────────────────────────────
//  LEVEL 1 BOARD DEFINITIONS (MP version)
// ──────────────────────────────────────────────

/**
 * Genereer een Level 1 bord voor multiplayer.
 * Dit is een vereenvoudigde versie van het originele bord,
 * geoptimaliseerd voor shared play.
 */
function generateLevel1Board(rng) {
	const zones = {};

	// YELLOW ZONE: 7 kolommen, hoogte 5-7
	const yellowCols = 7;
	const yellowRows = 7;
	const yellowBold = [];
	// Bold cells = startkolom (kolom 3, midden)
	for (let y = 0; y < yellowRows; y++) {
		yellowBold.push({ x: 3, y });
	}
	zones.yellow = createZoneGrid(yellowRows, yellowCols, {
		boldCells: yellowBold
	});

	// GREEN ZONE: 11x11 grid met bold anchor in het midden
	const greenSize = 11;
	const greenCenter = Math.floor(greenSize / 2);
	const greenEndCells = [];
	// End cells in de hoeken en randen
	for (let i = 0; i < greenSize; i++) {
		if (i === 0 || i === greenSize - 1) {
			greenEndCells.push({ x: i, y: 0 });
			greenEndCells.push({ x: i, y: greenSize - 1 });
			greenEndCells.push({ x: 0, y: i });
			greenEndCells.push({ x: greenSize - 1, y: i });
		}
	}
	zones.green = createZoneGrid(greenSize, greenSize, {
		boldCells: [{ x: greenCenter, y: greenCenter }],
		endCells: greenEndCells,
		startX: greenCenter,
		startY: greenCenter
	});

	// BLUE ZONE: 5 breed, 10 hoog (toren)
	const blueWidth = 5;
	const blueHeight = 10;
	const blueBold = [];
	// Bold rows (scoring rijen) op y=2, y=5, y=8
	for (let x = 0; x < blueWidth; x++) {
		blueBold.push({ x, y: 2 });
		blueBold.push({ x, y: 5 });
		blueBold.push({ x, y: 8 });
	}
	zones.blue = createZoneGrid(blueHeight, blueWidth, {
		boldCells: blueBold
	});

	// RED ZONE: 4 subgrids van 3x3
	zones.red = {
		subgrids: [
			{ id: 'red-grid1', ...createZoneGrid(3, 3, {}), targetPoints: 18 },
			{ id: 'red-grid2', ...createZoneGrid(3, 3, {}), targetPoints: 18 },
			{ id: 'red-grid3', ...createZoneGrid(3, 3, {}), targetPoints: 18 },
			{ id: 'red-grid4', ...createZoneGrid(3, 3, {}), targetPoints: 18 }
		]
	};

	// PURPLE ZONE: 7x7 grid met inner/outer ring
	const purpleSize = 7;
	const purpleCenter = Math.floor(purpleSize / 2);
	const purpleBold = [];
	// Bold cell clusters (scoring anchors)
	purpleBold.push({ x: purpleCenter, y: purpleCenter });
	purpleBold.push({ x: 1, y: 1 });
	purpleBold.push({ x: purpleSize - 2, y: 1 });
	purpleBold.push({ x: 1, y: purpleSize - 2 });
	purpleBold.push({ x: purpleSize - 2, y: purpleSize - 2 });

	const purpleOuterRing0 = [];
	const purpleOuterRing1 = [];
	for (let i = 0; i < purpleSize; i++) {
		purpleOuterRing0.push({ x: i, y: 0 }, { x: i, y: purpleSize - 1 });
		purpleOuterRing0.push({ x: 0, y: i }, { x: purpleSize - 1, y: i });
	}
	for (let i = 1; i < purpleSize - 1; i++) {
		purpleOuterRing1.push({ x: i, y: 1 }, { x: i, y: purpleSize - 2 });
		purpleOuterRing1.push({ x: 1, y: i }, { x: purpleSize - 1 - 1, y: i });
	}

	zones.purple = createZoneGrid(purpleSize, purpleSize, {
		boldCells: purpleBold
	});
	// Tag outer ring cells
	purpleOuterRing0.forEach(c => {
		const key = `${c.x},${c.y}`;
		if (zones.purple.cells[key]) zones.purple.cells[key].flags.push('outer-ring-0');
	});
	purpleOuterRing1.forEach(c => {
		const key = `${c.x},${c.y}`;
		if (zones.purple.cells[key]) zones.purple.cells[key].flags.push('outer-ring-1');
	});

	return { zones };
}

// ──────────────────────────────────────────────
//  PLACEMENT VALIDATION (pure data)
// ──────────────────────────────────────────────

/** Haal een cel uit de zone data */
function getDataCell(zoneData, x, y) {
	return zoneData.cells[`${x},${y}`] || null;
}

/** Check of een zone al actieve cellen heeft */
function zoneHasActive(zoneData) {
	return Object.values(zoneData.cells).some(c => c.active);
}

/** Check of een cel aangrenzend is aan een actieve cel */
function hasAdjacentActive(zoneData, x, y) {
	const neighbors = [
		getDataCell(zoneData, x - 1, y),
		getDataCell(zoneData, x + 1, y),
		getDataCell(zoneData, x, y - 1),
		getDataCell(zoneData, x, y + 1)
	];
	return neighbors.some(n => n && n.active);
}

/**
 * Verzamel alle cellen die een shape zou bezetten.
 * Returns null als plaatsing onmogelijk is.
 * Returns array van {x, y} coordinaten als het past.
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
			if (!cell) return null;        // buiten het grid
			if (cell.active) return null;  // al bezet
			pending.push({ x: targetX, y: targetY });
		}
	}

	return pending.length > 0 ? pending : null;
}

/**
 * Valideer plaatsing per zone type.
 * Returns true als de plaatsing geldig is.
 */
function validatePlacement(zoneName, zoneData, pendingCells) {
	if (!pendingCells || !pendingCells.length) return false;

	switch (zoneName) {
		case 'yellow': return validateYellow(zoneData, pendingCells);
		case 'blue':   return validateBlue(zoneData, pendingCells);
		case 'green':  return validateGreen(zoneData, pendingCells);
		case 'red':    return true; // Rood: altijd vrij plaatsen
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
	if (!hasActive) return touchesBold;
	if (touchesBold) return true;
	return pendingCells.some(c => hasAdjacentActive(zoneData, c.x, c.y));
}

function validateBlue(zoneData, pendingCells) {
	const hasActive = zoneHasActive(zoneData);
	const maxY = zoneData.rows - 1;
	const touchesFloor = pendingCells.some(c => c.y === maxY);
	const touchesBoldOrPortal = pendingCells.some(c => {
		const cell = getDataCell(zoneData, c.x, c.y);
		return cell && (cell.flags.includes('bold') || cell.flags.includes('portal'));
	});

	if (!hasActive) return touchesFloor || touchesBoldOrPortal;
	if (touchesFloor || touchesBoldOrPortal) return true;
	return pendingCells.some(c => hasAdjacentActive(zoneData, c.x, c.y));
}

function validateGreen(zoneData, pendingCells) {
	const hasActive = zoneHasActive(zoneData);
	const touchesBoldAnchor = pendingCells.some(c => {
		const cell = getDataCell(zoneData, c.x, c.y);
		return cell && cell.flags.includes('bold');
	});

	if (!hasActive) return touchesBoldAnchor;
	if (touchesBoldAnchor) return true;
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
		// Eerste plaatsing: alleen in inner grid (geen outer ring 0 of 1)
		return pendingCells.every(c => {
			const cell = getDataCell(zoneData, c.x, c.y);
			return cell && !cell.flags.includes('outer-ring-0') && !cell.flags.includes('outer-ring-1');
		});
	}

	if (touchesPortal) return true;
	return pendingCells.some(c => hasAdjacentActive(zoneData, c.x, c.y));
}

/**
 * Probeer een shape te plaatsen. Returns resultaat of null.
 * Deze functie muteert de zone data!
 */
function applyPlacement(boardState, zoneName, zoneData, baseX, baseY, matrix, color, playerId) {
	const pendingCells = collectPlacementCellsData(zoneData, baseX, baseY, matrix);
	if (!pendingCells) return null;
	if (!validatePlacement(zoneName, zoneData, pendingCells)) return null;

	// Plaats de cellen
	const placedCells = [];
	for (const coord of pendingCells) {
		const cell = getDataCell(zoneData, coord.x, coord.y);
		if (cell) {
			cell.active = true;
			cell.color = color;
			cell.playerId = playerId;
			placedCells.push({ ...coord });
		}
	}

	return {
		zoneName,
		cells: placedCells,
		playerId,
		color
	};
}

// ──────────────────────────────────────────────
//  SCORING (pure data)
// ──────────────────────────────────────────────

/** Bereken score voor alle zones */
function calculateScores(boardState) {
	const scores = {
		yellow: scoreYellowData(boardState.zones.yellow),
		green: scoreGreenData(boardState.zones.green),
		blue: scoreBlueData(boardState.zones.blue),
		red: scoreRedData(boardState.zones.red),
		purple: scorePurpleData(boardState.zones.purple)
	};
	scores.total = scores.yellow + scores.green + scores.blue + scores.red + scores.purple;
	return scores;
}

/** Per-speler scores berekenen (wie heeft welke punten gescoord) */
function calculatePlayerScores(boardState, playerIds) {
	const playerScores = {};
	for (const pid of playerIds) {
		playerScores[pid] = { yellow: 0, green: 0, blue: 0, red: 0, purple: 0, total: 0 };
	}

	// Yellow: punten per complete rij
	const yellowZone = boardState.zones.yellow;
	if (yellowZone) {
		for (let y = 0; y < yellowZone.rows; y++) {
			let rowComplete = true;
			const rowCells = [];
			for (let x = 0; x < yellowZone.cols; x++) {
				const cell = getDataCell(yellowZone, x, y);
				if (!cell || !cell.active) { rowComplete = false; break; }
				rowCells.push(cell);
			}
			if (rowComplete && rowCells.length > 0) {
				// Punten naar de speler die de meeste cellen in deze rij heeft
				const counts = {};
				rowCells.forEach(c => { counts[c.playerId] = (counts[c.playerId] || 0) + 1; });
				const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
				if (winner && playerScores[winner[0]]) {
					playerScores[winner[0]].yellow += 10;
				}
			}
		}
	}

	// Green: end-cell scoring per speler
	const greenZone = boardState.zones.green;
	if (greenZone) {
		const startX = greenZone.startX ?? Math.floor(greenZone.cols / 2);
		const startY = greenZone.startY ?? Math.floor(greenZone.rows / 2);

		Object.values(greenZone.cells).forEach(cell => {
			if (cell.active && cell.flags.includes('end')) {
				// Distance-based scoring
				const dist = Math.abs(cell.x - startX) + Math.abs(cell.y - startY);
				const maxDist = Math.max(1, greenZone.rows + greenZone.cols - 2);
				const points = Math.round(8 + (dist / maxDist) * 22);

				// Punten naar wie er als EERSTE een pad naar de end-cell heeft
				// (= eigenaar van de end-cell zelf)
				if (cell.playerId && playerScores[cell.playerId]) {
					playerScores[cell.playerId].green += points;
				}
			}
		});
	}

	// Blue: punten per complete bold-rij
	const blueZone = boardState.zones.blue;
	if (blueZone) {
		// Vind alle bold-rij y-waarden
		const boldYs = new Set();
		Object.values(blueZone.cells).forEach(c => {
			if (c.flags.includes('bold')) boldYs.add(c.y);
		});

		for (const boldY of boldYs) {
			let rowComplete = true;
			const rowCells = [];
			for (let x = 0; x < blueZone.cols; x++) {
				const cell = getDataCell(blueZone, x, boldY);
				if (!cell || !cell.active) { rowComplete = false; break; }
				rowCells.push(cell);
			}
			if (rowComplete && rowCells.length > 0) {
				const counts = {};
				rowCells.forEach(c => { counts[c.playerId] = (counts[c.playerId] || 0) + 1; });
				const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
				if (winner && playerScores[winner[0]]) {
					playerScores[winner[0]].blue += 8;
				}
			}
		}
	}

	// Red: punten per volledig gevuld subgrid
	const redZone = boardState.zones.red;
	if (redZone && redZone.subgrids) {
		for (const subgrid of redZone.subgrids) {
			const allCells = Object.values(subgrid.cells);
			const activeCells = allCells.filter(c => c.active);
			if (allCells.length > 0 && allCells.length === activeCells.length) {
				const points = subgrid.targetPoints || (allCells.length * 2);
				const counts = {};
				activeCells.forEach(c => { counts[c.playerId] = (counts[c.playerId] || 0) + 1; });
				const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
				if (winner && playerScores[winner[0]]) {
					playerScores[winner[0]].red += points;
				}
			}
		}
	}

	// Purple: cluster scoring (BFS naar verbonden bold-cells)
	const purpleZone = boardState.zones.purple;
	if (purpleZone) {
		// Vind clusters van actieve cellen verbonden aan bold-cells
		const visited = new Set();
		const boldCells = Object.values(purpleZone.cells).filter(c => c.flags.includes('bold') && c.active);

		for (const bold of boldCells) {
			if (visited.has(`${bold.x},${bold.y}`)) continue;
			// BFS vanuit bold cel
			const cluster = [];
			const queue = [bold];
			visited.add(`${bold.x},${bold.y}`);

			while (queue.length > 0) {
				const current = queue.shift();
				cluster.push(current);
				const neighbors = [
					getDataCell(purpleZone, current.x - 1, current.y),
					getDataCell(purpleZone, current.x + 1, current.y),
					getDataCell(purpleZone, current.x, current.y - 1),
					getDataCell(purpleZone, current.x, current.y + 1)
				];
				for (const n of neighbors) {
					if (n && n.active && !visited.has(`${n.x},${n.y}`)) {
						visited.add(`${n.x},${n.y}`);
						queue.push(n);
					}
				}
			}

			// Score = cluster grootte * 2
			const points = cluster.length * 2;
			const counts = {};
			cluster.forEach(c => { counts[c.playerId] = (counts[c.playerId] || 0) + 1; });
			const winner = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
			if (winner && playerScores[winner[0]]) {
				playerScores[winner[0]].purple += points;
			}
		}
	}

	// Totals
	for (const pid of playerIds) {
		const s = playerScores[pid];
		s.total = s.yellow + s.green + s.blue + s.red + s.purple;
	}

	return playerScores;
}

// Individuele zone score helpers (voor board-totaal)
function scoreYellowData(zoneData) {
	if (!zoneData) return 0;
	let score = 0;
	for (let y = 0; y < zoneData.rows; y++) {
		let rowComplete = true;
		for (let x = 0; x < zoneData.cols; x++) {
			const cell = getDataCell(zoneData, x, y);
			if (!cell || !cell.active) { rowComplete = false; break; }
		}
		if (rowComplete) score += 10;
	}
	return score;
}

function scoreGreenData(zoneData) {
	if (!zoneData) return 0;
	const startX = zoneData.startX ?? Math.floor(zoneData.cols / 2);
	const startY = zoneData.startY ?? Math.floor(zoneData.rows / 2);
	const maxDist = Math.max(1, zoneData.rows + zoneData.cols - 2);
	let score = 0;
	Object.values(zoneData.cells).forEach(cell => {
		if (cell.active && cell.flags.includes('end')) {
			const dist = Math.abs(cell.x - startX) + Math.abs(cell.y - startY);
			score += Math.round(8 + (dist / maxDist) * 22);
		}
	});
	return score;
}

function scoreBlueData(zoneData) {
	if (!zoneData) return 0;
	const boldYs = new Set();
	Object.values(zoneData.cells).forEach(c => {
		if (c.flags.includes('bold')) boldYs.add(c.y);
	});
	let score = 0;
	for (const boldY of boldYs) {
		let complete = true;
		for (let x = 0; x < zoneData.cols; x++) {
			const cell = getDataCell(zoneData, x, boldY);
			if (!cell || !cell.active) { complete = false; break; }
		}
		if (complete) score += 8;
	}
	return score;
}

function scoreRedData(redZone) {
	if (!redZone || !redZone.subgrids) return 0;
	let score = 0;
	for (const subgrid of redZone.subgrids) {
		const allCells = Object.values(subgrid.cells);
		const allActive = allCells.every(c => c.active);
		if (allCells.length > 0 && allActive) {
			score += subgrid.targetPoints || (allCells.length * 2);
		}
	}
	return score;
}

function scorePurpleData(zoneData) {
	if (!zoneData) return 0;
	const visited = new Set();
	const boldCells = Object.values(zoneData.cells).filter(c => c.flags.includes('bold') && c.active);
	let score = 0;

	for (const bold of boldCells) {
		if (visited.has(`${bold.x},${bold.y}`)) continue;
		const queue = [bold];
		let clusterSize = 0;
		visited.add(`${bold.x},${bold.y}`);

		while (queue.length > 0) {
			const current = queue.shift();
			clusterSize++;
			const neighbors = [
				getDataCell(zoneData, current.x - 1, current.y),
				getDataCell(zoneData, current.x + 1, current.y),
				getDataCell(zoneData, current.x, current.y - 1),
				getDataCell(zoneData, current.x, current.y + 1)
			];
			for (const n of neighbors) {
				if (n && n.active && !visited.has(`${n.x},${n.y}`)) {
					visited.add(`${n.x},${n.y}`);
					queue.push(n);
				}
			}
		}
		score += clusterSize * 2;
	}
	return score;
}

// ──────────────────────────────────────────────
//  OBJECTIVES (doelstellingen)
// ──────────────────────────────────────────────

const OBJECTIVE_TEMPLATES = [
	{
		id: 'fill_yellow_rows',
		name: 'Gele Rijen',
		description: 'Vul minstens {target} complete rijen in de gele zone.',
		check: (boardState, target) => {
			const zone = boardState.zones.yellow;
			if (!zone) return 0;
			let count = 0;
			for (let y = 0; y < zone.rows; y++) {
				let complete = true;
				for (let x = 0; x < zone.cols; x++) {
					const cell = getDataCell(zone, x, y);
					if (!cell || !cell.active) { complete = false; break; }
				}
				if (complete) count++;
			}
			return count;
		},
		targets: [2, 3, 4]
	},
	{
		id: 'reach_green_ends',
		name: 'Groene Eindpunten',
		description: 'Bereik minstens {target} eindpunten in de groene zone.',
		check: (boardState, target) => {
			const zone = boardState.zones.green;
			if (!zone) return 0;
			return Object.values(zone.cells).filter(c => c.active && c.flags.includes('end')).length;
		},
		targets: [3, 5, 7]
	},
	{
		id: 'complete_blue_rows',
		name: 'Blauwe Rijen',
		description: 'Vul minstens {target} dikgedrukte rijen in de blauwe zone.',
		check: (boardState, target) => {
			const zone = boardState.zones.blue;
			if (!zone) return 0;
			const boldYs = new Set();
			Object.values(zone.cells).forEach(c => {
				if (c.flags.includes('bold')) boldYs.add(c.y);
			});
			let count = 0;
			for (const boldY of boldYs) {
				let complete = true;
				for (let x = 0; x < zone.cols; x++) {
					const cell = getDataCell(zone, x, boldY);
					if (!cell || !cell.active) { complete = false; break; }
				}
				if (complete) count++;
			}
			return count;
		},
		targets: [1, 2, 3]
	},
	{
		id: 'fill_red_grids',
		name: 'Rode Grids',
		description: 'Vul minstens {target} rode subgrids volledig.',
		check: (boardState, target) => {
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
		name: 'Paarse Clusters',
		description: 'Bouw een cluster van minstens {target} verbonden cellen rond een paars ankerpunt.',
		check: (boardState, target) => {
			const zone = boardState.zones.purple;
			if (!zone) return 0;
			const visited = new Set();
			const boldCells = Object.values(zone.cells).filter(c => c.flags.includes('bold') && c.active);
			let maxCluster = 0;

			for (const bold of boldCells) {
				if (visited.has(`${bold.x},${bold.y}`)) continue;
				const queue = [bold];
				let size = 0;
				visited.add(`${bold.x},${bold.y}`);
				while (queue.length > 0) {
					const current = queue.shift();
					size++;
					const neighbors = [
						getDataCell(zone, current.x - 1, current.y),
						getDataCell(zone, current.x + 1, current.y),
						getDataCell(zone, current.x, current.y - 1),
						getDataCell(zone, current.x, current.y + 1)
					];
					for (const n of neighbors) {
						if (n && n.active && !visited.has(`${n.x},${n.y}`)) {
							visited.add(`${n.x},${n.y}`);
							queue.push(n);
						}
					}
				}
				maxCluster = Math.max(maxCluster, size);
			}
			return maxCluster;
		},
		targets: [5, 8, 12]
	},
	{
		id: 'total_score',
		name: 'Totaalscore',
		description: 'Behaal een totaalscore van minstens {target} punten.',
		check: (boardState, target) => {
			const scores = calculateScores(boardState);
			return scores.total;
		},
		targets: [30, 50, 80]
	}
];

/**
 * Genereer 3 willekeurige objectives waaruit een speler 1 kiest.
 * Returns array van {id, name, description, target} objecten.
 */
function generateObjectiveChoices(rng) {
	const shuffled = shuffleWithRNG([...OBJECTIVE_TEMPLATES], rng);
	const choices = shuffled.slice(0, 3).map(template => {
		const targetIdx = Math.floor(rng() * template.targets.length);
		const target = template.targets[targetIdx];
		return {
			id: template.id,
			name: template.name,
			description: template.description.replace('{target}', target),
			target
		};
	});
	return choices;
}

/**
 * Check of een speler zijn objective behaald heeft.
 */
function checkObjective(boardState, objective) {
	const template = OBJECTIVE_TEMPLATES.find(t => t.id === objective.id);
	if (!template) return { achieved: false, current: 0, target: objective.target };
	const current = template.check(boardState, objective.target);
	return {
		achieved: current >= objective.target,
		current,
		target: objective.target
	};
}

// ──────────────────────────────────────────────
//  CARD / DECK GENERATION
// ──────────────────────────────────────────────

/**
 * Bouw een deck van N kaarten voor een speler.
 * Returns array van card objects.
 */
function buildDeck(cardCount, rng, options = {}) {
	const pool = buildShapePool(options);
	const deck = [];

	for (let i = 0; i < cardCount; i++) {
		const shapeEntry = getWeightedRandom(pool, rng);
		const color = COLORS[Math.floor(rng() * (COLORS.length - 1))]; // exclude multikleur by default
		const isGolden = rng() < 0.08; // 8% kans op gouden kaart

		deck.push({
			id: `card-${i}-${Math.floor(rng() * 100000)}`,
			shapeName: shapeEntry.name,
			matrix: cloneMatrix(shapeEntry.matrix),
			category: shapeEntry.category,
			color: isGolden ? { ...GOLDEN_COLOR } : { ...color },
			isGolden,
			rotation: 0,
			mirrored: false
		});
	}

	return deck;
}

function buildShapePool(options = {}) {
	const pool = [];
	const categories = ['mini', 'standard', 'large'];

	for (const cat of categories) {
		const shapes = BASE_SHAPES[cat];
		if (!shapes) continue;
		const catWeight = SHAPE_CATEGORY_WEIGHTS[cat] || 1;
		for (const shape of shapes) {
			pool.push({
				name: shape.name,
				category: cat,
				weight: shape.weight * catWeight,
				matrix: shape.matrix
			});
		}
	}

	return pool;
}

function getWeightedRandom(pool, rng) {
	const totalWeight = pool.reduce((sum, entry) => sum + entry.weight, 0);
	let target = rng() * totalWeight;
	for (const entry of pool) {
		if (target < entry.weight) return entry;
		target -= entry.weight;
	}
	return pool[pool.length - 1];
}

// ──────────────────────────────────────────────
//  GAME STATE MANAGEMENT
// ──────────────────────────────────────────────

/**
 * Game phases:
 * - 'waiting'        : Wachten op spelers
 * - 'choosingGoals'  : Spelers kiezen hun objective
 * - 'playing'        : Turn-based gameplay
 * - 'ended'          : Game afgelopen, scores final
 */

/**
 * Maak een nieuw game state object aan.
 */
function createGameState(gameId, hostPlayerId, settings = {}) {
	const seed = settings.seed || Date.now();
	const rng = createRNG(seed);

	return {
		id: gameId,
		seed,
		phase: 'waiting',
		hostPlayerId,
		settings: {
			maxPlayers: settings.maxPlayers || 4,
			cardsPerPlayer: settings.cardsPerPlayer || 8,
			handSize: settings.handSize || 3,
			turnTimeLimit: settings.turnTimeLimit || 0 // 0 = geen limiet
		},
		players: {},
		playerOrder: [],
		currentTurnIndex: 0,
		turnCount: 0,
		boardState: null,
		objectiveChoices: {}, // per player: array van 3 keuzes
		createdAt: Date.now(),
		updatedAt: Date.now(),
		endedAt: null,
		winner: null,
		finalScores: null,
		moveHistory: []
	};
}

/**
 * Voeg een speler toe aan het spel.
 */
function addPlayer(gameState, playerId, playerName) {
	if (gameState.phase !== 'waiting') {
		return { error: 'Game is niet meer in wachtfase' };
	}
	if (Object.keys(gameState.players).length >= gameState.settings.maxPlayers) {
		return { error: 'Maximum aantal spelers bereikt' };
	}
	if (gameState.players[playerId]) {
		return { error: 'Speler zit al in het spel' };
	}

	gameState.players[playerId] = {
		id: playerId,
		name: playerName,
		deck: [],
		hand: [],
		drawPile: [],
		chosenObjective: null,
		score: 0,
		connected: true,
		joinedAt: Date.now()
	};
	gameState.playerOrder.push(playerId);
	gameState.updatedAt = Date.now();

	return { success: true };
}

/**
 * Verwijder een speler uit het spel.
 */
function removePlayer(gameState, playerId) {
	if (gameState.phase !== 'waiting') {
		return { error: 'Kan speler niet verwijderen tijdens een lopend spel' };
	}
	if (!gameState.players[playerId]) {
		return { error: 'Speler niet gevonden' };
	}

	delete gameState.players[playerId];
	gameState.playerOrder = gameState.playerOrder.filter(id => id !== playerId);
	gameState.updatedAt = Date.now();

	return { success: true };
}

/**
 * Start het spel: genereer bord, decks, en objective keuzes.
 */
function startGame(gameState) {
	const playerCount = Object.keys(gameState.players).length;
	if (playerCount < 2) {
		return { error: 'Minimaal 2 spelers nodig' };
	}
	if (gameState.phase !== 'waiting') {
		return { error: 'Spel is al gestart' };
	}

	const rng = createRNG(gameState.seed);

	// 1. Genereer het bord
	gameState.boardState = generateLevel1Board(rng);

	// 2. Genereer decks per speler
	for (const playerId of gameState.playerOrder) {
		const player = gameState.players[playerId];
		player.deck = buildDeck(gameState.settings.cardsPerPlayer, rng);
		player.drawPile = [...player.deck];
		player.hand = [];
	}

	// 3. Genereer objective keuzes per speler
	for (const playerId of gameState.playerOrder) {
		gameState.objectiveChoices[playerId] = generateObjectiveChoices(rng);
	}

	// 4. Shuffle speler volgorde
	gameState.playerOrder = shuffleWithRNG(gameState.playerOrder, rng);

	// 5. Naar goal-keuze fase
	gameState.phase = 'choosingGoals';
	gameState.updatedAt = Date.now();

	return { success: true };
}

/**
 * Speler kiest een objective.
 */
function chooseObjective(gameState, playerId, objectiveIndex) {
	if (gameState.phase !== 'choosingGoals') {
		return { error: 'Niet in goal-keuze fase' };
	}
	const choices = gameState.objectiveChoices[playerId];
	if (!choices || objectiveIndex < 0 || objectiveIndex >= choices.length) {
		return { error: 'Ongeldige objective keuze' };
	}
	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };
	if (player.chosenObjective) return { error: 'Al een objective gekozen' };

	player.chosenObjective = { ...choices[objectiveIndex] };
	gameState.updatedAt = Date.now();

	// Check of alle spelers gekozen hebben
	const allChosen = gameState.playerOrder.every(pid =>
		gameState.players[pid]?.chosenObjective != null
	);

	if (allChosen) {
		// Trek eerste hand voor alle spelers en start het spel
		for (const pid of gameState.playerOrder) {
			drawHand(gameState, pid);
		}
		gameState.phase = 'playing';
		gameState.currentTurnIndex = 0;
		gameState.turnCount = 1;
	}

	return { success: true, allChosen };
}

/**
 * Trek kaarten voor een speler.
 */
function drawHand(gameState, playerId) {
	const player = gameState.players[playerId];
	if (!player) return;

	const drawCount = Math.min(gameState.settings.handSize, player.drawPile.length);
	player.hand = player.drawPile.splice(0, drawCount);
}

/**
 * Verwerk een zet van een speler.
 */
function playMove(gameState, playerId, cardId, zoneName, baseX, baseY, rotation, mirrored) {
	// Validaties
	if (gameState.phase !== 'playing') {
		return { error: 'Spel is niet in play fase' };
	}

	const currentPlayerId = gameState.playerOrder[gameState.currentTurnIndex];
	if (playerId !== currentPlayerId) {
		return { error: 'Niet jouw beurt', expected: currentPlayerId };
	}

	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };

	// Vind kaart in hand
	const cardIndex = player.hand.findIndex(c => c.id === cardId);
	if (cardIndex === -1) {
		return { error: 'Kaart niet in je hand' };
	}

	const card = player.hand[cardIndex];

	// Apply rotation en mirror
	let matrix = cloneMatrix(card.matrix);
	if (mirrored) matrix = mirrorMatrix(matrix);
	matrix = rotateMatrixN(matrix, rotation || 0);

	// Vind de juiste zone data
	let zoneData;
	if (zoneName === 'red') {
		// Red heeft subgrids — vind de juiste
		const redZone = gameState.boardState.zones.red;
		if (!redZone || !redZone.subgrids) return { error: 'Red zone niet gevonden' };

		// Probeer elke subgrid
		let placed = false;
		for (const subgrid of redZone.subgrids) {
			const pendingCells = collectPlacementCellsData(subgrid, baseX, baseY, matrix);
			if (pendingCells) {
				const result = applyPlacement(gameState.boardState, zoneName, subgrid, baseX, baseY, matrix, card.color, playerId);
				if (result) {
					placed = true;
					break;
				}
			}
		}
		if (!placed) return { error: 'Ongeldige plaatsing in rode zone' };
	} else {
		zoneData = gameState.boardState.zones[zoneName];
		if (!zoneData) return { error: `Zone '${zoneName}' niet gevonden` };

		const result = applyPlacement(gameState.boardState, zoneName, zoneData, baseX, baseY, matrix, card.color, playerId);
		if (!result) return { error: 'Ongeldige plaatsing' };
	}

	// Kaart verwijderen uit hand
	player.hand.splice(cardIndex, 1);

	// Move opslaan in history
	gameState.moveHistory.push({
		playerId,
		cardId,
		zoneName,
		baseX,
		baseY,
		rotation: rotation || 0,
		mirrored: !!mirrored,
		turnCount: gameState.turnCount,
		timestamp: Date.now()
	});

	// Scores herberekenen
	const playerScores = calculatePlayerScores(
		gameState.boardState,
		gameState.playerOrder
	);
	for (const pid of gameState.playerOrder) {
		gameState.players[pid].score = playerScores[pid].total;
		gameState.players[pid].scoreBreakdown = playerScores[pid];
	}

	// Volgende beurt
	gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.playerOrder.length;

	// Check of de nieuwe speler kaarten moet trekken
	const nextPlayer = gameState.players[gameState.playerOrder[gameState.currentTurnIndex]];
	if (nextPlayer.hand.length === 0 && nextPlayer.drawPile.length > 0) {
		drawHand(gameState, gameState.playerOrder[gameState.currentTurnIndex]);
	}

	// Als we een volle ronde hebben gemaakt
	if (gameState.currentTurnIndex === 0) {
		gameState.turnCount++;
	}

	// Check of het spel afgelopen is
	const allEmpty = gameState.playerOrder.every(pid => {
		const p = gameState.players[pid];
		return p.hand.length === 0 && p.drawPile.length === 0;
	});

	if (allEmpty) {
		gameState.phase = 'ended';
		gameState.endedAt = Date.now();

		// Bereken finale scores incl. objectives
		const finalScores = {};
		for (const pid of gameState.playerOrder) {
			const p = gameState.players[pid];
			const objResult = checkObjective(gameState.boardState, p.chosenObjective);
			const objectiveBonus = objResult.achieved ? 15 : 0;
			finalScores[pid] = {
				...p.scoreBreakdown,
				objectiveBonus,
				objectiveAchieved: objResult.achieved,
				objectiveCurrent: objResult.current,
				finalTotal: p.score + objectiveBonus
			};
		}

		gameState.finalScores = finalScores;

		// Bepaal winnaar
		const sorted = gameState.playerOrder
			.map(pid => ({ pid, score: finalScores[pid].finalTotal }))
			.sort((a, b) => b.score - a.score);
		gameState.winner = sorted[0].pid;
	}

	gameState.updatedAt = Date.now();

	return {
		success: true,
		scores: playerScores,
		gameEnded: gameState.phase === 'ended',
		winner: gameState.winner,
		finalScores: gameState.finalScores
	};
}

/**
 * Speler past (slaat beurt over, verliest huidige hand).
 */
function passMove(gameState, playerId) {
	if (gameState.phase !== 'playing') {
		return { error: 'Spel is niet in play fase' };
	}

	const currentPlayerId = gameState.playerOrder[gameState.currentTurnIndex];
	if (playerId !== currentPlayerId) {
		return { error: 'Niet jouw beurt' };
	}

	const player = gameState.players[playerId];
	if (!player) return { error: 'Speler niet gevonden' };

	// Huidige hand weg, nieuwe trekken
	player.hand = [];

	gameState.moveHistory.push({
		playerId,
		pass: true,
		turnCount: gameState.turnCount,
		timestamp: Date.now()
	});

	// Volgende beurt
	gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.playerOrder.length;

	const nextPlayer = gameState.players[gameState.playerOrder[gameState.currentTurnIndex]];
	if (nextPlayer.hand.length === 0 && nextPlayer.drawPile.length > 0) {
		drawHand(gameState, gameState.playerOrder[gameState.currentTurnIndex]);
	}

	if (gameState.currentTurnIndex === 0) {
		gameState.turnCount++;
	}

	// Check game end
	const allEmpty = gameState.playerOrder.every(pid => {
		const p = gameState.players[pid];
		return p.hand.length === 0 && p.drawPile.length === 0;
	});

	if (allEmpty) {
		gameState.phase = 'ended';
		gameState.endedAt = Date.now();

		const finalScores = {};
		for (const pid of gameState.playerOrder) {
			const p = gameState.players[pid];
			const objResult = checkObjective(gameState.boardState, p.chosenObjective);
			const objectiveBonus = objResult.achieved ? 15 : 0;
			finalScores[pid] = {
				...p.scoreBreakdown,
				objectiveBonus,
				objectiveAchieved: objResult.achieved,
				finalTotal: p.score + objectiveBonus
			};
		}
		gameState.finalScores = finalScores;
		const sorted = gameState.playerOrder
			.map(pid => ({ pid, score: finalScores[pid].finalTotal }))
			.sort((a, b) => b.score - a.score);
		gameState.winner = sorted[0].pid;
	}

	gameState.updatedAt = Date.now();

	return {
		success: true,
		gameEnded: gameState.phase === 'ended',
		winner: gameState.winner,
		finalScores: gameState.finalScores
	};
}

// ──────────────────────────────────────────────
//  EXPORTS
// ──────────────────────────────────────────────

// Werkt in zowel Node (require) als browser (window)
const GameRules = {
	// Shapes
	BASE_SHAPES,
	SHAPE_CATEGORY_WEIGHTS,
	COLORS,
	GOLDEN_COLOR,

	// Board
	createZoneGrid,
	generateLevel1Board,

	// Placement
	getDataCell,
	collectPlacementCellsData,
	validatePlacement,
	applyPlacement,
	canPlace: function(zoneData, zoneName, baseX, baseY, matrix) {
		const cells = collectPlacementCellsData(zoneData, baseX, baseY, matrix);
		return !!(cells && cells.length > 0 && validatePlacement(zoneName, zoneData, cells));
	},

	// Transform
	cloneMatrix,
	rotateMatrix90,
	mirrorMatrix,
	rotateMatrixN,

	// Scoring
	calculateScores,
	calculatePlayerScores,

	// Objectives
	OBJECTIVE_TEMPLATES,
	generateObjectiveChoices,
	checkObjective,

	// Deck
	buildDeck,
	buildShapePool,

	// Game state
	createGameState,
	addPlayer,
	removePlayer,
	startGame,
	chooseObjective,
	drawHand,
	playMove,
	passMove,

	// Utils
	createRNG,
	shuffleWithRNG
};

// Node.js / CommonJS
if (typeof module !== 'undefined' && module.exports) {
	module.exports = GameRules;
}
// Browser
if (typeof window !== 'undefined') {
	window.LocusGameRules = GameRules;
}
