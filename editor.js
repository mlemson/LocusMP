(function () {
  const STORAGE_KEY = 'locusEditorBoardHtml';

  const boardHost = document.getElementById('board-host');
  const refreshBtn = document.getElementById('refresh-board');
  const printBtn = document.getElementById('print-board');
  const statusEl = document.getElementById('status');

  function setStatus(msg) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
  }

  function getSelectedTool() {
    const el = document.querySelector('input[name="tool"]:checked');
    return el ? String(el.value) : 'select';
  }

  function hasSpecial(cell) {
    if (!cell) return false;
    if (cell.classList.contains('bold-cell')) return true;
    if (cell.classList.contains('gold-cell')) return true;
    if (cell.classList.contains('portal-cell')) return true;
    if (cell.classList.contains('trap-cell')) return true;
    if (cell.querySelector('.symbol, .portal-symbol')) return true;
    return false;
  }

  function clearCell(cell) {
    if (!cell) return;
    cell.classList.remove('bold-cell', 'gold-cell', 'portal-cell', 'trap-cell');
    cell.querySelectorAll('.portal-symbol, .symbol').forEach((n) => n.remove());
  }

	function ensureNonVoid(cell) {
		if (!cell) return;
		cell.classList.remove('void-cell');
	}

  function makeVoid(cell) {
    if (!cell) return;
    clearCell(cell);
    cell.classList.add('void-cell');
  }

  function setSymbol(cell, color) {
    if (!cell) return;
    // Remove existing non-trap symbols.
    cell.querySelectorAll('.symbol:not(.trap-symbol)').forEach((n) => n.remove());
    const s = document.createElement('span');
    s.className = `symbol ${color}`;
    cell.appendChild(s);
  }

  function setTrap(cell, kind) {
    if (!cell) return;
    cell.classList.add('trap-cell');
    cell.querySelectorAll('.symbol.trap-symbol').forEach((n) => n.remove());
    const s = document.createElement('span');
    if (kind === 'blackhole') s.className = 'symbol trap-symbol trap-symbol--black-hole';
    else s.className = 'symbol trap-symbol trap-symbol--pit';
    cell.appendChild(s);
  }

  function setPortal(cell) {
    if (!cell) return;
    cell.classList.add('portal-cell');
    if (!cell.querySelector('.portal-symbol')) {
      const p = document.createElement('span');
      p.className = 'portal-symbol';
      p.textContent = '🌀';
      cell.appendChild(p);
    }
  }

  function setCoin(cell) {
    if (!cell) return;
    cell.classList.add('gold-cell');
  }

  function applyTool(cell, tool) {
    if (!cell) return;

    switch (tool) {
      case 'erase':
        // "Lege cell": ensure a real cell exists, then clear any special markers.
        ensureNonVoid(cell);
        clearCell(cell);
        return;
		case 'delete':
			// "Cell verwijderen": turn this cell into a void placeholder.
			makeVoid(cell);
			return;
      case 'bold':
        ensureNonVoid(cell);
        cell.classList.toggle('bold-cell', true);
        return;
      case 'coin':
        ensureNonVoid(cell);
        setCoin(cell);
        return;
      case 'portal':
        ensureNonVoid(cell);
        setPortal(cell);
        return;
      case 'trap-pit':
        ensureNonVoid(cell);
        setTrap(cell, 'pit');
        return;
      case 'trap-blackhole':
        ensureNonVoid(cell);
        setTrap(cell, 'blackhole');
        return;
      case 'sym-yellow':
        ensureNonVoid(cell);
        setSymbol(cell, 'yellow');
        return;
      case 'sym-green':
        ensureNonVoid(cell);
        setSymbol(cell, 'green');
        return;
      case 'sym-purple':
        ensureNonVoid(cell);
        setSymbol(cell, 'purple');
        return;
      case 'sym-blue':
        ensureNonVoid(cell);
        setSymbol(cell, 'blue');
        return;
      case 'sym-red':
        ensureNonVoid(cell);
        setSymbol(cell, 'red');
        return;
      case 'select':
      default:
        // Requirement: clicking a special block makes it normal again.
        if (hasSpecial(cell)) clearCell(cell);
        return;
    }
  }

  function ensureZoneStructure() {
    // Normalize imported HTML: ensure each zone contains a .grid wrapper.
    const board = boardHost ? boardHost.querySelector('.board') : null;
    if (!board) return;
    const zones = Array.from(board.querySelectorAll('.zone'));
    zones.forEach((zone) => {
      if (zone.classList.contains('red-group')) return;
      const hasGrid = zone.querySelector(':scope > .grid');
      if (hasGrid) return;
      // If zone already has .cell children, wrap them.
      const cells = Array.from(zone.querySelectorAll(':scope > .cell'));
      const g = document.createElement('div');
      g.className = 'grid';
      if (cells.length) {
        cells.forEach((c) => g.appendChild(c));
      }
      zone.appendChild(g);
    });

    // Red subgrids: ensure each sub-zone has a .grid child.
    const redSubs = Array.from(board.querySelectorAll('.zone.red-group > .zone'));
    redSubs.forEach((sub) => {
      const hasGrid = sub.querySelector(':scope > .grid');
      if (hasGrid) return;
      const cells = Array.from(sub.querySelectorAll(':scope > .cell'));
      const g = document.createElement('div');
      g.className = 'grid';
      cells.forEach((c) => g.appendChild(c));
      sub.appendChild(g);
    });
  }

  function assignEditorIds() {
    const board = boardHost ? boardHost.querySelector('.board') : null;
    if (!board) return;
    let i = 0;
    Array.from(board.querySelectorAll('.zone')).forEach((z) => {
      if (!z.dataset.editorId) z.dataset.editorId = 'z' + (++i) + '-' + Math.random().toString(16).slice(2);
    });
    Array.from(board.querySelectorAll('.grid')).forEach((g) => {
      if (!g.dataset.editorId) g.dataset.editorId = 'g' + (++i) + '-' + Math.random().toString(16).slice(2);
    });
  }

  function inferGridSize(grid) {
    // Try to infer rows/cols by reading existing inline grid styles, else default.
    const style = window.getComputedStyle(grid);
    const cols = (style.gridTemplateColumns || '').split(' ').filter(Boolean).length || 10;
    const rows = (style.gridTemplateRows || '').split(' ').filter(Boolean).length || 10;
    return { rows, cols };
  }

  function applyGridTemplate(grid, rows, cols) {
    grid.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size))`;
    grid.style.gridAutoRows = 'var(--cell-size)';
    grid.dataset.rows = String(rows);
    grid.dataset.cols = String(cols);
  }

  function createCell(isVoid) {
    const cell = document.createElement('div');
    cell.className = 'cell' + (isVoid ? ' void-cell' : '');
    return cell;
  }

  function resizeGrid(grid, newRows, newCols) {
    const rows = Math.max(1, Math.min(80, newRows | 0));
    const cols = Math.max(1, Math.min(80, newCols | 0));
    const oldCells = Array.from(grid.querySelectorAll(':scope > .cell'));
    const oldRows = parseInt(grid.dataset.rows || '0', 10) || 0;
    const oldCols = parseInt(grid.dataset.cols || '0', 10) || 0;
    // Map existing by index -> (r,c)
    const map = new Map();
    if (oldRows && oldCols) {
      oldCells.forEach((cell, idx) => {
        const r = Math.floor(idx / oldCols);
        const c = idx % oldCols;
        map.set(r + ',' + c, cell);
      });
    }
    const frag = document.createDocumentFragment();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const key = r + ',' + c;
        const existing = map.get(key);
        if (existing) {
          frag.appendChild(existing);
        } else {
          // New space starts as void placeholder; user can "Lege cell" to create.
          frag.appendChild(createCell(true));
        }
      }
    }
    grid.innerHTML = '';
    grid.appendChild(frag);
    applyGridTemplate(grid, rows, cols);
  }

  function addZoneChrome() {
    const board = boardHost ? boardHost.querySelector('.board') : null;
    if (!board) return;
    Array.from(board.querySelectorAll('.zone')).forEach((zone) => {
      if (!zone.querySelector(':scope > .zone-handle')) {
        const h = document.createElement('div');
        h.className = 'zone-handle';
        h.title = 'Sleep om te verplaatsen';
        h.setAttribute('draggable', 'true');
        zone.insertBefore(h, zone.firstChild);
      }
      if (!zone.querySelector(':scope > .grid-resizer')) {
        const r = document.createElement('div');
        r.className = 'grid-resizer';
        r.title = 'Sleep om grid groter/kleiner te maken';
        zone.appendChild(r);
      }
    });
  }

  function wireZoneDragDrop() {
    const board = boardHost ? boardHost.querySelector('.board') : null;
    if (!board) return;
    const columns = Array.from(board.querySelectorAll(':scope > .column'));
    let draggingZone = null;

    board.querySelectorAll('.zone-handle[draggable="true"]').forEach((handle) => {
      handle.addEventListener('dragstart', (e) => {
        const zone = handle.closest('.zone');
        if (!zone) return;
        draggingZone = zone;
        try { e.dataTransfer.setData('text/plain', zone.dataset.editorId || ''); } catch (_) {}
        e.dataTransfer.effectAllowed = 'move';
      });
      handle.addEventListener('dragend', () => {
        draggingZone = null;
        board.querySelectorAll('.zone.drag-over').forEach((z) => z.classList.remove('drag-over'));
      });
    });

    function allowDrop(e) {
      e.preventDefault();
      try { e.dataTransfer.dropEffect = 'move'; } catch (_) {}
    }

    columns.forEach((col) => {
      col.addEventListener('dragover', allowDrop);
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        if (!draggingZone) return;
        col.appendChild(draggingZone);
      });
    });

    board.querySelectorAll('.zone').forEach((zone) => {
      zone.addEventListener('dragover', (e) => {
        allowDrop(e);
        zone.classList.add('drag-over');
      });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('drag-over');
        if (!draggingZone) return;
        if (draggingZone === zone) return;
        zone.parentNode.insertBefore(draggingZone, zone);
      });
    });
  }

  function wireGridResize() {
    const board = boardHost ? boardHost.querySelector('.board') : null;
    if (!board) return;
    let active = null;

    function onMove(e) {
      if (!active) return;
      e.preventDefault();
      const { grid, startX, startY, startRows, startCols } = active;
      const dx = (e.clientX - startX);
      const dy = (e.clientY - startY);
      const cellSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell-size')) || 26;
      const dCols = Math.round(dx / cellSize);
      const dRows = Math.round(dy / cellSize);
      resizeGrid(grid, startRows + dRows, startCols + dCols);
    }

    function stop() {
      if (!active) return;
      active = null;
      window.removeEventListener('pointermove', onMove, { capture: true });
      window.removeEventListener('pointerup', stop, { capture: true });
    }

    board.querySelectorAll('.grid-resizer').forEach((resizer) => {
      resizer.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const zone = resizer.closest('.zone');
        if (!zone) return;
        const grid = zone.querySelector(':scope > .grid') || zone.querySelector('.grid');
        if (!grid) return;
        const rows = parseInt(grid.dataset.rows || '0', 10) || inferGridSize(grid).rows;
        const cols = parseInt(grid.dataset.cols || '0', 10) || inferGridSize(grid).cols;
        if (!grid.dataset.rows || !grid.dataset.cols) applyGridTemplate(grid, rows, cols);
        active = { grid, startX: e.clientX, startY: e.clientY, startRows: rows, startCols: cols };
        window.addEventListener('pointermove', onMove, { capture: true });
        window.addEventListener('pointerup', stop, { capture: true });
      });
    });
  }

  function createZone(id, color, grid) {
    const z = document.createElement('div');
    z.className = 'zone';
    z.dataset.color = color;
    if (id) z.id = id;
    if (grid) z.appendChild(grid);
    return z;
  }

  function createGrid(rows, cols) {
    const g = document.createElement('div');
    g.className = 'grid';
    applyGridTemplate(g, rows, cols);
    const frag = document.createDocumentFragment();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        frag.appendChild(createCell(false));
      }
    }
    g.appendChild(frag);
    return g;
  }

  function applyRowPatternVoid(grid, rowLengths, rowOffsets) {
    const rows = rowLengths.length;
    const cols = parseInt(grid.dataset.cols || '0', 10) || 1;
    for (let r = 0; r < rows; r++) {
      const len = rowLengths[r] || 0;
      const off = rowOffsets[r] || 0;
      for (let c = 0; c < cols; c++) {
        const idx = (r * cols) + c;
        const cell = grid.children[idx];
        if (!cell) continue;
        const inside = c >= off && c < (off + len);
        cell.classList.toggle('void-cell', !inside);
        if (inside) clearCell(cell);
      }
    }
  }

  function carveGreenContent(grid) {
    if (!grid) return;
    const rows = parseInt(grid.dataset.rows || '0', 10) || 15;
    const cols = parseInt(grid.dataset.cols || '0', 10) || 15;
    const cells = Array.from(grid.querySelectorAll(':scope > .cell'));
    if (!cells.length) return;
    // Improved generator inspired by `generateRoots` in index.html.
    // Build a cluster set of active cells, then mark remaining cells as void.
    const toIndex = (r, c) => (r * cols) + c;
    const isInside = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols;
    const dirs = [{ r: -1, c: 0 }, { r: 1, c: 0 }, { r: 0, c: -1 }, { r: 0, c: 1 }];

    const clusterSet = new Set();
    const centerR = Math.floor(rows / 2);
    const centerC = Math.floor(cols / 2);
    const centerIdx = toIndex(centerR, centerC);
    clusterSet.add(centerIdx);

    // helper: add a perpendicular width cell
    const addWidthCell = (r, c, dir) => {
      const perp = [{ r: dir.c, c: -dir.r }, { r: -dir.c, c: dir.r }];
      const chosen = perp[Math.floor(Math.random() * perp.length)];
      const nr = r + chosen.r;
      const nc = c + chosen.c;
      if (isInside(nr, nc)) clusterSet.add(toIndex(nr, nc));
    };

    // Growth budget scaled to grid area so editor grids fill more fully
    let growthBudget = Math.max(40, Math.floor((rows * cols) / 4));
    const minBranchLen = 1;
    const maxBranchLen = Math.max(3, Math.floor(Math.max(rows, cols) / 3));
    const endpoints = [{ r: centerR, c: centerC }];

    // Iteratively grow branches until budget exhausted or cluster large enough
    while (growthBudget > 0) {
      const start = endpoints[Math.floor(Math.random() * endpoints.length)];
      let r = start.r;
      let c = start.c;
      const len = minBranchLen + Math.floor(Math.random() * (maxBranchLen - minBranchLen + 1));
      const dir = dirs[Math.floor(Math.random() * dirs.length)];
      const makeWide = Math.random() < 0.35;
      for (let i = 0; i < len; i++) {
        r += dir.r; c += dir.c;
        if (!isInside(r, c)) break;
        const idx = toIndex(r, c);
        if (clusterSet.has(idx)) continue;
        clusterSet.add(idx);
        growthBudget -= 1;
        if (makeWide || Math.random() < 0.15) addWidthCell(r, c, dir);
        if (i > 0 && Math.random() < 0.2 && endpoints.length < 24) endpoints.push({ r, c });
        if (growthBudget <= 0) break;
      }
      // safety: stop if we've filled a large fraction of the grid
      if (clusterSet.size > Math.floor(rows * cols * 0.6)) break;
    }

    // Apply cells: active vs void
    const clusterMap = new Map();
    for (let rr = 0; rr < rows; rr++) {
      for (let cc = 0; cc < cols; cc++) {
        const i = toIndex(rr, cc);
        const cell = cells[i];
        if (!cell) continue;
        clusterMap.set(i, cell);
        if (clusterSet.has(i)) {
          cell.classList.remove('void-cell');
          clearCell(cell);
        } else {
          clearCell(cell);
          cell.classList.add('void-cell');
        }
      }
    }

    // shuffle helper
    const shuffle = (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
    };

    // assign symbols & coins
    const clusterIndices = Array.from(clusterSet).filter(i => i !== centerIdx);
    shuffle(clusterIndices);
    const clusterSize = clusterIndices.length;
    const isSmall = clusterSize < 20;
    const minSymBase = isSmall ? 4 : 8;
    const maxSymBase = isSmall ? 6 : 12;
    const finalMinSymbols = Math.max(minSymBase, Math.floor(clusterSize * 0.15));
    const finalMaxSymbols = Math.max(maxSymBase, Math.floor(clusterSize * 0.25));
    const finalMaxCoins = Math.max(2, Math.floor(clusterSize * 0.08));
    const finalCoinChance = 0.12;

    const symCount = Math.min(clusterIndices.length, Math.floor(Math.random() * (finalMaxSymbols - finalMinSymbols + 1)) + finalMinSymbols);
    const symbolIndices = new Set(clusterIndices.slice(0, symCount));

    const remaining = clusterIndices.filter(i => !symbolIndices.has(i));
    shuffle(remaining);
    const coinSet = new Set();
    for (const cand of remaining) {
      if (coinSet.size >= finalMaxCoins) break;
      if (Math.random() < finalCoinChance) coinSet.add(cand);
    }

    for (const idx of clusterSet) {
      const cell = clusterMap.get(idx);
      if (!cell) continue;
      if (symbolIndices.has(idx)) {
        // random color selection
        const colors = ['green','blue','yellow','purple','red'];
        const color = colors[Math.floor(Math.random() * colors.length)];
        setSymbol(cell, color);
      } else if (coinSet.has(idx)) {
        setCoin(cell);
      }
    }

    // mark endpoints (cells with <=1 neighbor)
    const potentialEndpoints = [];
    for (const i of clusterSet) {
      if (i === centerIdx) continue;
      const rr = Math.floor(i / cols), cc = i % cols;
      let neighbors = 0;
      for (const d of dirs) {
        const ni = toIndex(rr + d.r, cc + d.c);
        if (clusterSet.has(ni)) neighbors++;
      }
      if (neighbors <= 1) potentialEndpoints.push(i);
    }
    if (potentialEndpoints.length < 8) {
      // include cells with 2 neighbors if not enough
      for (const i of clusterSet) {
        if (potentialEndpoints.includes(i) || i === centerIdx) continue;
        const rr = Math.floor(i / cols), cc = i % cols;
        let neighbors = 0;
        for (const d of dirs) {
          const ni = toIndex(rr + d.r, cc + d.c);
          if (clusterSet.has(ni)) neighbors++;
        }
        if (neighbors === 2) potentialEndpoints.push(i);
      }
    }
    shuffle(potentialEndpoints);
    const selected = potentialEndpoints.slice(0, Math.min(8, potentialEndpoints.length));
    for (const i of selected) {
      const cell = clusterMap.get(i);
      if (!cell) continue;
      cell.classList.remove('gold-cell');
      cell.querySelectorAll('.symbol').forEach(n => n.remove());
      cell.classList.add('end-cell');
    }
    // ensure center cell is bold
    const centerCell = clusterMap.get(centerIdx);
    if (centerCell) centerCell.classList.add('bold-cell');
  }

  function generateNewBoard() {
    // World2-like defaults. This generation is local to the editor (does not touch the game).
    const board = document.createElement('div');
    board.className = 'board';
    const col1 = document.createElement('div'); col1.className = 'column';
    const col2 = document.createElement('div'); col2.className = 'column';
    const col3 = document.createElement('div'); col3.className = 'column';

    const purple = createZone('editor-purple-zone', 'paars', createGrid(13, 13));
    const yellow = createZone('editor-yellow-zone', 'geel', createGrid(11, 11));
    const greenGrid = createGrid(15, 15);
    carveGreenContent(greenGrid);
    const green = createZone('editor-green-zone', 'groen', greenGrid);

    // Blue: tall, irregular strip.
    const blueGrid = createGrid(28, 6);
    const blue = createZone('editor-blue-zone', 'blauw', blueGrid);
    // simple random walk-ish pattern
    const rowLengths = [];
    const rowOffsets = [];
    let off = 2;
    for (let r = 0; r < 28; r++) {
      off += (Math.random() < 0.5 ? -1 : 1);
      off = Math.max(0, Math.min(4, off));
      const len = Math.max(2, Math.min(6 - off, 3 + (Math.random() < 0.35 ? 1 : 0)));
      rowLengths.push(len);
      rowOffsets.push(off);
    }
    applyRowPatternVoid(blueGrid, rowLengths, rowOffsets);

    // Red group: 4 small subgrids.
    const redGroup = document.createElement('div');
    redGroup.className = 'zone red-group';
    redGroup.dataset.color = 'rood';
    redGroup.id = 'editor-red-zone';
    for (let i = 1; i <= 4; i++) {
      const sub = document.createElement('div');
      sub.className = 'zone';
      sub.dataset.color = 'rood';
      sub.id = 'editor-red-sub-' + i;
      sub.appendChild(createGrid(6, 6));
      redGroup.appendChild(sub);
    }

    col1.appendChild(purple);
    col1.appendChild(yellow);
    col2.appendChild(green);
    col2.appendChild(redGroup);
    col3.appendChild(blue);
    board.append(col1, col2, col3);

    setBoardHtml(board.outerHTML);
    setStatus('Nieuw speelveld gegenereerd.');
  }

  function getCleanBoardHtmlForPrint() {
    const board = boardHost ? boardHost.querySelector('.board') : null;
    if (!board) return '';
    const clone = board.cloneNode(true);
    // Remove editor chrome if present.
    clone.querySelectorAll('.zone-handle,.grid-resizer').forEach((n) => n.remove());

    // Critical for print: ensure every grid has an explicit column template.
    // If --cell-size is missing or template is absent, the browser may stack cells vertically.
    const liveGrids = Array.from(board.querySelectorAll('.grid'));
    const clonedGrids = Array.from(clone.querySelectorAll('.grid'));
    for (let i = 0; i < clonedGrids.length; i++) {
      const cg = clonedGrids[i];
      const live = liveGrids[i];

      let cols = parseInt((cg.dataset && cg.dataset.cols) ? cg.dataset.cols : '', 10) || 0;
      if (!cols) cols = parseInt((live && live.dataset && live.dataset.cols) ? live.dataset.cols : '', 10) || 0;
      if (!cols && live) {
        try {
          const tpl = String(window.getComputedStyle(live).gridTemplateColumns || '');
          const parts = tpl.split(' ').filter(Boolean);
          if (parts.length) cols = parts.length;
        } catch (_) {}
      }
      if (!cols) {
        const count = cg.querySelectorAll(':scope > .cell').length;
        cols = Math.max(1, Math.min(20, Math.round(Math.sqrt(Math.max(1, count)))));
      }

      // Use a physical unit for print to avoid browser px-to-mm differences
      cg.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size, 6.88mm))`;
      cg.style.gridAutoRows = 'var(--cell-size, 6.88mm)';
    }

    return clone.outerHTML;
  }

  function openPrintWindow(boardHtml) {
    const w = window.open('', '_blank');
    if (!w) {
      setStatus('Popup geblokkeerd.');
      return;
    }
.    const css = `
@page { size: A4 landscape; margin: 8mm; }
  /* Use mm for cell size so printer renders physical dimensions reliably */
  :root { --cell-size: 6.88mm; --board-grid-gap: 2px; }
html, body { height: 100%; }
body { margin: 0; padding: 0; background: white; color: #111; font-family: Arial, sans-serif; }
.boardHost { width: fit-content; margin: 0 auto; max-width: calc(297mm - 16mm); }
.board { display: flex; gap: 12px; align-items: flex-start; transform: none !important; }
.column { display: flex; flex-direction: column; gap: 12px; }
.zone { position: relative; border-radius: 10px; border: 1px solid rgba(0,0,0,0.12); box-shadow: 0 2px 6px rgba(0,0,0,0.12); padding: 10px; }
.zone[data-color="geel"] { background: #f0dc7d; }
.zone[data-color="paars"] { background: #a48dcc; }
.zone[data-color="groen"] { background: #a8d5a2; }
.zone[data-color="rood"] { background: #de838c; }
.zone[data-color="blauw"] { background: #6ba8d8; }
.zone.red-group { display: grid; grid-template-columns: repeat(2, max-content); justify-content: center; gap: 18px; }
.grid { display: grid; gap: var(--board-grid-gap, 2px); justify-content: center; }
.cell { width: var(--cell-size, 26px); height: var(--cell-size, 26px); background: rgba(255,255,255,0.92); border: 1px solid rgba(0,0,0,0.16); border-radius: calc(var(--cell-size, 26px) / 4); box-shadow: 0 1px 2px rgba(0,0,0,0.05); position: relative; display: flex; align-items: center; justify-content: center; }
.cell.bold-cell { border: 2px solid #2c3333 !important; }
.symbol { display: inline-block; width: 14px; height: 14px; border-radius: 4px; border: 2px solid #444; background-color: #999; }
.symbol.yellow { background-color: #fff48f; }
.symbol.green { background-color: #69cf57; }
.symbol.purple { background-color: #ae7eed; }
.symbol.blue { background-color: #76a0e3; }
.symbol.red { background-color: #ed7e89; }
.gold-cell::after { content: ""; position: absolute; top: 4px; left: 4px; width: 12px; height: 12px; border-radius: 50%; background: #ffea63; border: 2px solid #171615; z-index: 1; }
.portal-symbol { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 18px; pointer-events: none; }
.symbol.trap-symbol { width: 18px; height: 18px; border-radius: 2px; background: #656565; border: none; transform: rotate(45deg) scale(0.75); }
.symbol.trap-symbol.trap-symbol--black-hole { transform: none; border-radius: 50%; background: radial-gradient(circle, #1a1a2e 0%, #0a0a15 60%, #000000 100%); border: 2px solid rgba(138, 43, 226, 0.4); box-shadow: 0 0 10px rgba(138, 43, 226, 0.4); }

/* Print requirement: hide void/placeholder cells */
.cell.void-cell { visibility: hidden !important; border: none !important; background: transparent !important; box-shadow: none !important; }
/* Avoid any runtime scaling on print */
.boardHost, .board, .grid, .cell { transform: none !important; zoom: 1 !important; }
`;
    const doc = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Print</title><style>${css}</style></head><body><div class="boardHost">${boardHtml}</div><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),150));</script></body></html>`;
    w.document.open();
    w.document.write(doc);
    w.document.close();
  }

  function wireBoardInteractions() {
    const board = boardHost ? boardHost.querySelector('.board') : null;
    if (!board) return;

    board.addEventListener('click', (e) => {
      const cell = e.target && e.target.closest ? e.target.closest('.cell') : null;
      if (!cell || !board.contains(cell)) return;
      const tool = getSelectedTool();
      applyTool(cell, tool);
    });
  }

  function setBoardHtml(html) {
    if (!boardHost) return;
    if (!html) {
      setStatus('Geen speelveld ontvangen.');
      return;
    }
    boardHost.innerHTML = html;
    try {
      localStorage.setItem(STORAGE_KEY, html);
    } catch (_) {}
		ensureZoneStructure();
		assignEditorIds();
		addZoneChrome();
		wireZoneDragDrop();
		wireGridResize();
    wireBoardInteractions();
    setStatus('Speelveld geladen.');
  }

  function loadFromStorage() {
    try {
      const html = localStorage.getItem(STORAGE_KEY);
      if (html) {
        setBoardHtml(html);
        return true;
      }
    } catch (_) {}
    return false;
  }

  function requestBoardFromOpener() {
    // Used only for initial load when opened from the game.
    if (!window.opener) return false;
    try {
      window.opener.postMessage({ type: 'LOCUS_EDITOR_REQUEST_BOARD' }, '*');
      setStatus('Speelveld ophalen uit spel…');
      return true;
    } catch (e) {
      return false;
    }
  }

  window.addEventListener('message', (event) => {
    if (window.opener && event.source !== window.opener) return;
    const data = event.data || {};
    if (data.type === 'LOCUS_EDITOR_BOARD' && typeof data.boardHtml === 'string') {
      setBoardHtml(data.boardHtml);
    }
  });

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      // Requirement: refresh should REALLY regenerate, independent of the running game.
      generateNewBoard();
    });
  }

  if (printBtn) {
    printBtn.addEventListener('click', () => {
      const html = getCleanBoardHtmlForPrint();
      if (!html) {
        setStatus('Geen speelveld om te printen.');
        return;
      }
      openPrintWindow(html);
    });
  }

  // --- Saved boards (nameable) ---
  const SAVED_BOARDS_KEY = 'locusSavedBoards';

  function getSavedBoards() {
    try {
      const raw = localStorage.getItem(SAVED_BOARDS_KEY) || '{}';
      return JSON.parse(raw || '{}');
    } catch (_) { return {}; }
  }

  function writeSavedBoards(obj) {
    try { localStorage.setItem(SAVED_BOARDS_KEY, JSON.stringify(obj)); } catch (_) {}
  }

  function saveCurrentBoardWithName(name) {
    if (!boardHost) return false;
    const board = boardHost.querySelector('.board');
    if (!board) return false;
    const html = board.outerHTML;
    const saved = getSavedBoards();
    saved[name] = { html, name, ts: Date.now() };
    writeSavedBoards(saved);
    setStatus(`Speelveld opgeslagen als "${name}".`);
    return true;
  }

  function promptSaveBoard() {
    if (!boardHost) { setStatus('Geen editor-board geladen.'); return; }
    let name = window.prompt('Geef een naam voor dit speelveld:');
    if (!name) { setStatus('Opslaan geannuleerd.'); return; }
    name = String(name).trim();
    if (!name) { setStatus('Ongeldige naam.'); return; }
    const saved = getSavedBoards();
    if (saved[name]) {
      if (!window.confirm(`Er bestaat al een speelveld met naam "${name}". Overschrijven?`)) { setStatus('Opslaan geannuleerd.'); return; }
    }
    if (saveCurrentBoardWithName(name)) {
      // Also notify opener/game if present
      if (window.opener && typeof window.opener.postMessage === 'function') {
        try { window.opener.postMessage({ type: 'LOCUS_EDITOR_SAVED_BOARD', name, boardHtml: boardHost.querySelector('.board').outerHTML }, '*'); } catch (e) {}
      }
    }
  }

  function createSavedBoardsModal() {
    // simple modal
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed'; overlay.style.inset = '0'; overlay.style.background = 'rgba(0,0,0,0.4)'; overlay.style.zIndex = '99999'; overlay.style.display = 'flex'; overlay.style.alignItems = 'center'; overlay.style.justifyContent = 'center';
    const box = document.createElement('div');
    box.style.width = '680px'; box.style.maxHeight = '80vh'; box.style.overflow = 'auto'; box.style.background = 'white'; box.style.padding = '12px'; box.style.borderRadius = '8px'; box.style.boxShadow = '0 12px 40px rgba(0,0,0,0.5)';
    const title = document.createElement('h3'); title.textContent = 'Opgeslagen speelvelden'; title.style.marginTop = '0';
    const list = document.createElement('div');
    const closeBtn = document.createElement('button'); closeBtn.textContent = 'Sluit'; closeBtn.style.marginLeft = '8px';
    closeBtn.addEventListener('click', () => overlay.remove());
    box.appendChild(title);
    box.appendChild(list);
    box.appendChild(closeBtn);
    overlay.appendChild(box);

    const saved = getSavedBoards();
    const names = Object.keys(saved).sort((a,b)=> (saved[b].ts||0)-(saved[a].ts||0));
    if (!names.length) {
      const p = document.createElement('p'); p.textContent = 'Geen opgeslagen speelvelden.'; box.insertBefore(p, list);
    }
    names.forEach((n) => {
      const item = document.createElement('div'); item.style.display = 'flex'; item.style.alignItems = 'center'; item.style.gap = '8px'; item.style.marginBottom = '8px';
      const label = document.createElement('div'); label.textContent = n; label.style.flex = '1';
      const loadBtn = document.createElement('button'); loadBtn.textContent = 'Laad';
      loadBtn.addEventListener('click', () => { setBoardHtml(saved[n].html); overlay.remove(); });
      const exportBtn = document.createElement('button'); exportBtn.textContent = 'Naar spel';
      exportBtn.addEventListener('click', () => {
        if (window.opener && typeof window.opener.postMessage === 'function') {
          try { window.opener.postMessage({ type: 'LOCUS_EDITOR_BOARD', boardHtml: saved[n].html, name: n }, '*'); setStatus(`Speelveld "${n}" naar spel verzonden.`); } catch (e) { setStatus('Versturen mislukt.'); }
        } else setStatus('Geen spel-opener gevonden.');
      });
      const renameBtn = document.createElement('button'); renameBtn.textContent = 'Hernoem';
      renameBtn.addEventListener('click', () => {
        const newName = window.prompt('Nieuwe naam:', n);
        if (!newName) return;
        const nn = String(newName).trim(); if (!nn) return; const s = getSavedBoards(); if (s[nn] && nn !== n) { if (!confirm('Naam bestaat al. Overschrijven?')) return; }
        s[nn] = { ...s[n], name: nn, ts: Date.now() };
        if (nn !== n) delete s[n]; writeSavedBoards(s); overlay.remove(); createSavedBoardsModal();
      });
      const delBtn = document.createElement('button'); delBtn.textContent = 'Verwijder';
      delBtn.addEventListener('click', () => { if (!confirm(`Verwijder "${n}"?`)) return; const s = getSavedBoards(); delete s[n]; writeSavedBoards(s); overlay.remove(); createSavedBoardsModal(); });
      item.appendChild(label); item.appendChild(loadBtn); item.appendChild(exportBtn); item.appendChild(renameBtn); item.appendChild(delBtn);
      list.appendChild(item);
    });

    document.body.appendChild(overlay);
  }

  function ensureSaveButtons() {
    // Try to add save/manage buttons next to existing controls
    try {
      const container = (printBtn && printBtn.parentNode) ? printBtn.parentNode : document.body;
      if (!document.getElementById('save-board')) {
        const b = document.createElement('button'); b.id = 'save-board'; b.textContent = 'Opslaan'; b.style.marginLeft = '8px';
        b.addEventListener('click', promptSaveBoard);
        container.insertBefore(b, printBtn ? printBtn.nextSibling : null);
      }
      if (!document.getElementById('manage-saved-boards')) {
        const m = document.createElement('button'); m.id = 'manage-saved-boards'; m.textContent = 'Opgeslagen'; m.style.marginLeft = '8px';
        m.addEventListener('click', createSavedBoardsModal);
        container.insertBefore(m, document.getElementById('save-board') ? document.getElementById('save-board').nextSibling : null);
      }
    } catch (e) {}
  }

  ensureSaveButtons();


  // Auto-load on open: if opened from the game, load snapshot once; otherwise fallback to storage.
  if (!requestBoardFromOpener()) {
    loadFromStorage();
  }
})();
