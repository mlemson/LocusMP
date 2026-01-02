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
    // Allow an override tool (buttons added dynamically) to take precedence.
    if (window.__locusEditorOverrideTool) return window.__locusEditorOverrideTool;
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
    cell.classList.remove('bold-cell', 'gold-cell', 'portal-cell', 'trap-cell', 'start-cell', 'end-cell');
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
    // Toggleable tool behaviors: clicking again removes what was placed.
    switch (tool) {
      case 'erase':
        ensureNonVoid(cell);
        clearCell(cell);
        return;
      case 'delete':
        if (cell.classList.contains('void-cell')) {
          ensureNonVoid(cell);
        } else {
          makeVoid(cell);
        }
        return;
      case 'bold':
        ensureNonVoid(cell);
        // In green zone, the start-cell is represented by a bold-cell (same as the game).
        const zone = cell.closest && cell.closest('.zone') ? cell.closest('.zone') : null;
        const zcol = zone && zone.dataset ? String(zone.dataset.color || '').toLowerCase() : '';
        if (zcol === 'groen') {
          cell.classList.toggle('bold-cell');
        } else {
          cell.classList.toggle('bold-cell');
        }
        return;
      case 'bold-blue':
        ensureNonVoid(cell);
        // Only allow toggling blue-starts inside blue zones
        const bzone = cell.closest && cell.closest('.zone') ? cell.closest('.zone') : null;
        const bcol = bzone && bzone.dataset ? String(bzone.dataset.color || '').toLowerCase() : '';
        if (bcol === 'blauw' || bzone && bzone.id === 'blue-zone') {
          cell.classList.toggle('bold-cell');
        }
        return;
      case 'coin':
        ensureNonVoid(cell);
        cell.classList.toggle('gold-cell');
        return;
      case 'portal':
        ensureNonVoid(cell);
        if (cell.classList.contains('portal-cell')) {
          cell.classList.remove('portal-cell');
          cell.querySelectorAll('.portal-symbol').forEach(n => n.remove());
        } else setPortal(cell);
        return;
      case 'trap-pit':
        ensureNonVoid(cell);
        if (cell.classList.contains('trap-cell')) {
          // remove trap
          cell.classList.remove('trap-cell');
          cell.querySelectorAll('.trap-symbol').forEach(n => n.remove());
          delete cell.dataset.trap;
        } else setTrap(cell, 'pit');
        return;
      case 'trap-blackhole':
        ensureNonVoid(cell);
        if (cell.classList.contains('trap-cell')) {
          cell.classList.remove('trap-cell');
          cell.querySelectorAll('.trap-symbol').forEach(n => n.remove());
          delete cell.dataset.trap;
        } else setTrap(cell, 'blackhole');
        return;
      case 'sym-yellow':
      case 'sym-green':
      case 'sym-purple':
      case 'sym-blue':
      case 'sym-red':
        ensureNonVoid(cell);
        // extract color
        const color = tool.split('-')[1];
        // If the same symbol already exists, remove it; otherwise set it (and replace others)
        const existingSym = Array.from(cell.querySelectorAll('.symbol:not(.trap-symbol)')).find(s => s.classList.contains(color));
        if (existingSym) {
          existingSym.remove();
        } else {
          // remove other non-trap symbols first
          cell.querySelectorAll('.symbol:not(.trap-symbol)').forEach(n => n.remove());
          setSymbol(cell, color);
        }
        return;
      case 'sym-shop':
        // Bonus-upgrade shop / diamond symbol
        ensureNonVoid(cell);
        const shopSym = cell.querySelector('.symbol.upgrade-shop-symbol');
        if (shopSym) {
          shopSym.remove();
        } else {
          const s = document.createElement('span');
          s.className = 'symbol upgrade-shop-symbol';
          s.textContent = '♦';
          cell.appendChild(s);
        }
        return;
      case 'end':
        ensureNonVoid(cell);
        if (cell.classList.contains('end-cell')) {
          cell.classList.remove('end-cell');
        } else {
          cell.classList.add('end-cell');
          // Ensure end-cell is not also a start/bold/void marker
          cell.classList.remove('start-cell');
          cell.classList.remove('bold-cell');
        }
        return;
      case 'select':
      default:
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
    // Accept optional anchor object as 4th arg (e.g. {anchorX:'left'|'right', anchorY:'top'|'bottom'})
    const args = Array.from(arguments);
    const anchor = args[3] || {};
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
    // Determine offsets so existing cells can be anchored left/top or right/bottom
    const colOffset = (anchor.anchorX === 'right') ? (oldCols - cols) : 0;
    const rowOffset = (anchor.anchorY === 'bottom') ? (oldRows - rows) : 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const oldR = r + rowOffset;
        const oldC = c + colOffset;
        const key = oldR + ',' + oldC;
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
      // Ensure four corner resizers (nw, ne, sw, se)
      const dirs = ['nw','ne','sw','se'];
      dirs.forEach((d) => {
        if (!zone.querySelector(`:scope > .grid-resizer[data-dir="${d}"]`)) {
          const r = document.createElement('div');
          r.className = 'grid-resizer';
          r.dataset.dir = d;
          r.title = 'Sleep om grid groter/kleiner te maken';
          // small visual handle style fallback
          r.style.width = '12px'; r.style.height = '12px'; r.style.position = 'absolute';
          if (d === 'nw') { r.style.left = '4px'; r.style.top = '4px'; r.style.cursor = 'nwse-resize'; }
          if (d === 'ne') { r.style.right = '4px'; r.style.top = '4px'; r.style.cursor = 'nesw-resize'; }
          if (d === 'sw') { r.style.left = '4px'; r.style.bottom = '4px'; r.style.cursor = 'nesw-resize'; }
          if (d === 'se') { r.style.right = '4px'; r.style.bottom = '4px'; r.style.cursor = 'nwse-resize'; }
          zone.appendChild(r);
        }
      });
      // delete button for removing a zone
      if (!zone.querySelector(':scope > .zone-delete')) {
        const del = document.createElement('button');
        del.className = 'zone-delete';
        del.setAttribute('aria-label', 'Verwijder zone');
        del.title = 'Verwijder zone';
        del.innerHTML = '🗑️';
        del.addEventListener('click', (e) => {
          e.preventDefault(); e.stopPropagation();
          if (!confirm('Weet je zeker dat je deze zone wilt verwijderen?')) return;
          try { zone.remove(); } catch (err) {}
        });
        zone.appendChild(del);
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
      const { grid, startX, startY, startRows, startCols, dir } = active;
      const dx = (e.clientX - startX);
      const dy = (e.clientY - startY);
      const cellSize = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cell-size')) || 26;
      const dCols = Math.round(dx / cellSize);
      const dRows = Math.round(dy / cellSize);
      // Determine new rows/cols based on handle direction
      const newCols = (dir && dir.includes('w')) ? (startCols - dCols) : (startCols + dCols);
      const newRows = (dir && dir.includes('n')) ? (startRows - dRows) : (startRows + dRows);
      const anchorX = (dir && dir.includes('w')) ? 'right' : 'left';
      const anchorY = (dir && dir.includes('n')) ? 'bottom' : 'top';
      resizeGrid(grid, newRows, newCols, { anchorX, anchorY });
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
        const dir = resizer.dataset && resizer.dataset.dir ? String(resizer.dataset.dir) : 'se';
        active = { grid, startX: e.clientX, startY: e.clientY, startRows: rows, startCols: cols, dir };
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

    // detect green zone: skip placing initial bonuses/coins for green
    const isGreenZone = (grid.dataset && grid.dataset.color === 'groen') || (grid.closest && grid.closest('.zone') && grid.closest('.zone').dataset && grid.closest('.zone').dataset.color === 'groen') || (grid.id && String(grid.id).toLowerCase().includes('green'));

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

    // Only assign symbols/coins when NOT a green zone in the editor
    let symbolIndices = new Set();
    const coinSet = new Set();
    if (!isGreenZone) {
      const isSmall = clusterSize < 20;
      const minSymBase = isSmall ? 4 : 8;
      const maxSymBase = isSmall ? 6 : 12;
      const finalMinSymbols = Math.max(minSymBase, Math.floor(clusterSize * 0.15));
      const finalMaxSymbols = Math.max(maxSymBase, Math.floor(clusterSize * 0.25));
      const finalMaxCoins = Math.max(2, Math.floor(clusterSize * 0.08));
      const finalCoinChance = 0.12;

      const symCount = Math.min(clusterIndices.length, Math.floor(Math.random() * (finalMaxSymbols - finalMinSymbols + 1)) + finalMinSymbols);
      symbolIndices = new Set(clusterIndices.slice(0, symCount));

      const remaining = clusterIndices.filter(i => !symbolIndices.has(i));
      shuffle(remaining);
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
    // ensure center cell is bold in green editor grids
    const centerCell = clusterMap.get(centerIdx);
    if (centerCell) {
      centerCell.classList.add('bold-cell');
    }
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
    // Mark grid as green so carveGreenContent skips bonuses/coins
    greenGrid.dataset.color = 'groen';
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
    // NOTE: Use 'red-grid1', 'red-grid2' etc IDs to match the game's structure.
    // The game expects these IDs for correct positioning detection.
    const redGroup = document.createElement('div');
    redGroup.className = 'zone red-group';
    redGroup.dataset.color = 'rood';
    redGroup.id = 'red-zone';
    for (let i = 1; i <= 4; i++) {
      const sub = document.createElement('div');
      sub.className = 'zone';
      sub.dataset.color = 'rood';
      sub.id = 'red-grid' + i;
      sub.dataset.subgrid = String(i);
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
    // Remove editor chrome if present (handles, resizers, delete and info UI).
    clone.querySelectorAll('.zone-handle,.grid-resizer,.zone-delete,.zone-info-btn,.zone-info-popover').forEach((n) => n.remove());

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

  // Normalize board HTML for export/save: make grid sizing stable across browsers.
  function normalizeBoardForExport(boardEl) {
    if (!boardEl) return '';
    const clone = boardEl.cloneNode(true);
    try {
      // The GAME expects the green start cell to be a .bold-cell.
      // The editor may additionally use .start-cell for highlighting, but we must never remove .bold-cell.
      const greenZones = clone.querySelectorAll('.zone[data-color="groen"]');
      greenZones.forEach(zone => {
        const grid = zone.querySelector(':scope > .grid') || zone.querySelector('.grid');
        if (!grid) return;
        // If there are any explicit .start-cell markers, ensure they are also bold-cells for the game.
        grid.querySelectorAll('.cell.start-cell').forEach(c => c.classList.add('bold-cell'));
      });

      const parseRepeatCount = (tpl) => {
        const m = /repeat\(\s*(\d+)\s*,/i.exec(String(tpl || ''));
        return m ? (parseInt(m[1], 10) || 0) : 0;
      };
      const countTopLevelTracks = (tpl) => {
        const s = String(tpl || '').trim();
        if (!s || s === 'none') return 0;
        let depth = 0;
        let token = '';
        const tokens = [];
        for (let i = 0; i < s.length; i++) {
          const ch = s[i];
          if (ch === '(') depth++;
          if (ch === ')') depth = Math.max(0, depth - 1);
          if (depth === 0 && /\s/.test(ch)) {
            if (token.trim()) tokens.push(token.trim());
            token = '';
          } else {
            token += ch;
          }
        }
        if (token.trim()) tokens.push(token.trim());
        return tokens.length;
      };

      // Ensure each grid has an explicit inline column template for stable layout when loaded in the game
      // SKIP grids that use absolute positioning (green/red) — they don't use CSS Grid layout
      try {
        const liveGrids = boardEl.querySelectorAll('.grid');
        const clonedGrids = clone.querySelectorAll('.grid');
        for (let i = 0; i < clonedGrids.length; i++) {
          const live = liveGrids[i];
          const cg = clonedGrids[i];
          if (!cg) continue;
          // Check if this grid uses absolute positioning (green/red zones)
          // Red subgrids have IDs like red-grid1, red-grid2, etc.
          const zone = cg.closest('.zone');
          const isGreenGrid = cg.id === 'green-grid' || (zone && zone.dataset && zone.dataset.color === 'groen');
          const isRedGrid = (zone && zone.id && zone.id.startsWith('red-grid')) ||
            (zone && zone.dataset && zone.dataset.color === 'rood') ||
            (zone && zone.classList && zone.classList.contains('red-group'));
          const usesAbsolutePositioning = isGreenGrid || isRedGrid;
          if (usesAbsolutePositioning) {
            // For absolute-positioned grids, copy dataset and ensure cells have coordinate attributes
            if (live && live.dataset) {
              if (live.dataset.cols) cg.dataset.cols = live.dataset.cols;
              if (live.dataset.rows) cg.dataset.rows = live.dataset.rows;
            }
            // Ensure all cells in green/red grids have data-x and data-y attributes for the game
            const liveCells = live ? Array.from(live.querySelectorAll(':scope > .cell')) : [];
            const cloneCells = Array.from(cg.querySelectorAll(':scope > .cell'));
            const cols = parseInt(cg.dataset.cols || '0', 10) || Math.ceil(Math.sqrt(cloneCells.length)) || 1;
            const rows = parseInt(cg.dataset.rows || '0', 10) || Math.ceil(cloneCells.length / cols) || 1;
            if (!cg.dataset.cols) cg.dataset.cols = String(cols);
            if (!cg.dataset.rows) cg.dataset.rows = String(rows);
            cloneCells.forEach((cell, idx) => {
              // Derive coordinates from DOM order if not already set
              if (cell.dataset.x == null || cell.dataset.x === '') {
                cell.dataset.x = String(idx % cols);
              }
              if (cell.dataset.y == null || cell.dataset.y === '') {
                cell.dataset.y = String(Math.floor(idx / cols));
              }
            });
            continue;
          }
          // Determine columns: prefer dataset.cols on the live grid, else try computed style, else fallback to sqrt heuristic
          let cols = 0;
          try {
            cols = Number(live && live.dataset && live.dataset.cols ? live.dataset.cols : 0) || 0;
          } catch (_) { cols = 0; }
          if (!cols) {
            try {
              const tpl = (live && live.style && live.style.gridTemplateColumns) ? live.style.gridTemplateColumns : '';
              cols = parseRepeatCount(tpl) || countTopLevelTracks(tpl) || 0;
            } catch (_) { cols = 0; }
          }
          if (!cols) {
            try {
              const tpl = (live ? window.getComputedStyle(live).gridTemplateColumns : '') || '';
              cols = parseRepeatCount(tpl) || countTopLevelTracks(tpl) || 0;
            } catch (_) { cols = 0; }
          }
          if (!cols) {
            const count = cg.querySelectorAll(':scope > .cell').length;
            cols = Math.max(1, Math.min(80, Math.round(Math.sqrt(Math.max(1, count)))));
          }
          // Apply inline style and dataset so the exported HTML keeps the same layout across browsers
          try {
            cg.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size))`;
            cg.style.gridAutoRows = 'var(--cell-size)';
            cg.dataset.cols = String(cols);
            // Best-effort rows for downstream logic
            const cellCount = cg.querySelectorAll(':scope > .cell').length;
            const rows = Math.max(1, Math.ceil(cellCount / cols));
            cg.dataset.rows = String(rows);
          } catch (e) {}
        }
      } catch (e) {}
    } catch (e) {}
    return clone.outerHTML;
  }

  function openPrintWindow(boardHtml, printFriendly = false) {
    const w = window.open('', '_blank');
    if (!w) {
      setStatus('Popup geblokkeerd.');
      return;
    }
  let css = `
@page { size: A4 landscape; margin: 8mm; }
  /* Use mm for cell size so printer renders physical dimensions reliably */
  /* cell/ gap in mm so print renders physical sizes reliably */
  :root { --cell-size: 6.88mm; --board-grid-gap: 0.53mm; }
html, body { height: 100%; width: 100%; }
body { margin: 0; padding: 0; background: white; color: #111; font-family: Arial, sans-serif; }
/* iPad/Safari: ensure background colors are actually printed */
@media print {
  html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
/* Center the board on the printable page area. */
.printCenter { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; overflow: visible; }
/* Wrapper we can scale without affecting the inner layout. */
.boardScale { display: inline-block; transform-origin: top left; }
.boardHost { display: inline-block; }
.board { display: flex; gap: 12px; align-items: flex-start; transform: none !important; }
.column { display: flex; flex-direction: column; gap: 12px; }
.zone { position: relative; border-radius: 10px; border: 1px solid rgba(0,0,0,0.12); box-shadow: 0 2px 6px rgba(0,0,0,0.12); padding: 10px; }
.zone[data-color="geel"] { background: #f0dc7d; }
.zone[data-color="paars"] { background: #a48dcc; }
.zone[data-color="groen"] { background: #a8d5a2; }
.zone[data-color="rood"] { background: #de838c; }
.zone[data-color="blauw"] { background: #6ba8d8; }
.zone.red-group { display: grid; grid-template-columns: repeat(2, max-content); justify-content: center; gap: 18px; }
.grid { display: grid; gap: var(--board-grid-gap, 0.53mm); justify-content: center; }
.cell { box-sizing: border-box; width: var(--cell-size, 6.88mm); height: var(--cell-size, 6.88mm); background: rgba(255,255,255,0.92); border: 0.26mm solid rgba(0,0,0,0.16); border-radius: calc(var(--cell-size, 6.88mm) / 4); box-shadow: 0 0.15mm 0.3mm rgba(0,0,0,0.05); position: relative; display: flex; align-items: center; justify-content: center; }
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
/* Hide editor chrome in print */
.zone-delete, .zone-handle, .grid-resizer, .zone-info-btn, .zone-info-popover, .shop-bonus-info { display: none !important; }
/* Avoid any runtime scaling on print */
.boardHost, .board, .grid, .cell { transform: none !important; zoom: 1 !important; }
`;

    // If the user requested the print-friendly variant, inject lighter outline-based rules
    if (printFriendly) {
      css += `
/* Print-friendly / ink-friendly: no backgrounds, strong black outlines */
.zone { background: transparent !important; box-shadow: none !important; }
.zone[data-color="geel"],
.zone[data-color="paars"],
.zone[data-color="groen"],
.zone[data-color="rood"],
.zone[data-color="blauw"] { background: transparent !important; }

.cell { background: transparent !important; box-shadow: none !important; }
.cell { border-width: 0.26mm !important; border-style: solid !important; border-color: #000 !important; }
.cell.bold-cell { border-width: 0.6mm !important; border-color: #000 !important; }
.cell.portal-cell::after { content: "\\26f0"; opacity: 0.9; }

/* Symbols: use a small dotted background to indicate color while saving ink */
.cell .symbol { background-color: transparent !important; border: none !important; width: 14px; height: 14px; display: inline-block; border-radius: 4px; }
.cell .symbol.yellow { background-image: radial-gradient(circle, rgba(255,244,143,0.9) 30%, transparent 31%); background-size: 3px 3px; background-repeat: repeat; }
.cell .symbol.green { background-image: radial-gradient(circle, rgba(105,207,87,0.9) 30%, transparent 31%); background-size: 3px 3px; background-repeat: repeat; }
.cell .symbol.purple { background-image: radial-gradient(circle, rgba(174,126,237,0.9) 30%, transparent 31%); background-size: 3px 3px; background-repeat: repeat; }
.cell .symbol.blue { background-image: radial-gradient(circle, rgba(118,160,227,0.9) 30%, transparent 31%); background-size: 3px 3px; background-repeat: repeat; }
.cell .symbol.red { background-image: radial-gradient(circle, rgba(237,126,137,0.9) 30%, transparent 31%); background-size: 3px 3px; background-repeat: repeat; }
.cell .symbol.trap-symbol { background-image: radial-gradient(circle, rgba(101,101,101,0.95) 30%, transparent 31%); background-size: 3px 3px; background-repeat: repeat; }
.cell .symbol.trap-symbol.trap-symbol--black-hole { background-image: radial-gradient(circle, rgba(26,26,46,0.95) 30%, transparent 31%); background-size: 3px 3px; background-repeat: repeat; }
.cell.portal-cell::after { font-size: 12px; }
      `;
    }
    const doc = `<!doctype html><html lang="nl"><head><meta charset="utf-8"><title>Print</title><style>${css}</style></head><body>
<div class="printCenter"><div class="boardScale"><div class="boardHost">${boardHtml}</div></div></div>
<script>
  window.addEventListener('load', () => {
    try {
      const scaleEl = document.querySelector('.boardScale');
      const host = document.querySelector('.boardHost');
      const target = scaleEl || host;
      if (target) {
        // Try to fit both width and height of the current page viewport.
        // This prevents clipping when a custom board is wider than A4-landscape.
        const pageW = document.documentElement.clientWidth || window.innerWidth;
        const pageH = document.documentElement.clientHeight || window.innerHeight;
        const rect = target.getBoundingClientRect();
        const pad = 12; // px safety padding inside margins
        const sx = rect.width > 0 ? (pageW - pad) / rect.width : 1;
        const sy = rect.height > 0 ? (pageH - pad) / rect.height : 1;
        const s = Math.min(1, sx, sy);
        if (s > 0 && s < 1) {
          // Prefer zoom (affects layout in Chromium print); fallback to transform.
          try { target.style.zoom = String(s); } catch (e) {}
          try { target.style.transform = 'scale(' + s + ')'; } catch (e) {}
        }
      }
    } catch (e) {}
    setTimeout(() => window.print(), 150);
  });
</script>
</body></html>`;
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
    // Ensure editor shows end-cell colors per zone so designer sees where they are
    try { ensureEditorEndCellStyles(); } catch (e) {}
    // Sanitize loaded board for editor: remove runtime-filled state (active/edge)
    // IMPORTANT: Do NOT remove inline styles for grids using absolute positioning (green/red).
    // Those grids rely on inline left/top for cell placement.
    try {
      const cells = boardHost.querySelectorAll('.cell');
      cells.forEach((cell) => {
        // Keep visual symbols/bonuses (they should remain visible in the editor).
        // Only remove runtime-filled state (active/edge).
        try { cell.classList.remove('active', 'edge-cell'); } catch (e) {}
        // Check if this cell uses absolute positioning (green/red zones)
        // Red subgrids have IDs like red-grid1, red-grid2, etc.
        const grid = cell.closest('.grid');
        const zone = cell.closest('.zone');
        const isGreenGrid = (grid && grid.id === 'green-grid') || (zone && zone.dataset && zone.dataset.color === 'groen');
        const isRedGrid = (zone && zone.id && zone.id.startsWith('red-grid')) ||
          (zone && zone.dataset && zone.dataset.color === 'rood') ||
          (zone && zone.classList && zone.classList.contains('red-group'));
        const usesAbsolutePositioning = isGreenGrid || isRedGrid || (cell.style && cell.style.position === 'absolute');
        // Only remove inline styles for CSS Grid-based zones, not absolute-positioned ones
        if (!usesAbsolutePositioning) {
          try { cell.removeAttribute('style'); } catch (e) {}
        }
      });
    } catch (e) {}
    // NOTE: do not invent/assign start-cell markers in the editor on load.
    // In the game, the green start is represented by `.bold-cell`, and auto-assigning `.start-cell`
    // caused incorrect start highlighting (often top-left) when cols/rows mismatched.
    // Ensure each grid has proper column sizing so cells don't stack vertically
    // Skip this for absolute-positioned grids (green/red) as they don't use CSS Grid layout
    try {
      const grids = boardHost.querySelectorAll('.grid');
      grids.forEach(g => {
        const zone = g.closest('.zone');
        const isGreenGrid = g.id === 'green-grid' || (zone && zone.dataset && zone.dataset.color === 'groen');
        const isRedGrid = (zone && zone.id && zone.id.startsWith('red-grid')) ||
          (zone && zone.dataset && zone.dataset.color === 'rood') ||
          (zone && zone.classList && zone.classList.contains('red-group'));
        const usesAbsolutePositioning = isGreenGrid || isRedGrid;
        if (usesAbsolutePositioning) return; // skip CSS Grid template for absolute-positioned grids
        const cols = Number(g.dataset.cols) || (g.querySelectorAll(':scope > .cell').length ? Math.max(1, Math.round(Math.sqrt(g.querySelectorAll(':scope > .cell').length))) : 0);
        if (cols) g.style.gridTemplateColumns = `repeat(${cols}, var(--cell-size))`;
        g.style.gridAutoRows = 'var(--cell-size)';
        // also ensure the grid width/height are reset so browser lays out as expected
        try { g.style.width = ''; g.style.height = ''; } catch(e) {}
      });
    } catch (e) {}
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
      const printFriendlyToggle = document.getElementById('print-friendly-toggle');
      const printFriendly = !!(printFriendlyToggle && printFriendlyToggle.checked);
      const html = getCleanBoardHtmlForPrint(printFriendly);
      if (!html) {
        setStatus('Geen speelveld om te printen.');
        return;
      }
      openPrintWindow(html, printFriendly);
    });
  }

  // Ensure a print-friendly toggle is available in the editor UI
  function ensurePrintFriendlyToggle() {
    try {
      if (document.getElementById('print-friendly-toggle')) return;
      if (!printBtn) return;
      const wrapper = document.createElement('label');
      wrapper.style.display = 'inline-flex';
      wrapper.style.alignItems = 'center';
      wrapper.style.gap = '6px';
      wrapper.style.marginLeft = '8px';
      wrapper.title = 'Wanneer aangevinkt printen we met lichte, niet-volle kleuren';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = 'print-friendly-toggle';
      input.name = 'print-friendly';
      const span = document.createElement('span');
      span.textContent = 'Printvriendelijk';
      wrapper.appendChild(input);
      wrapper.appendChild(span);
      // Insert after the print button
      try { printBtn.parentNode.insertBefore(wrapper, printBtn.nextSibling); } catch (e) { document.body.appendChild(wrapper); }
    } catch (e) {}
  }

  ensurePrintFriendlyToggle();

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

  function saveCurrentBoardWithName(name, objective) {
    if (!boardHost) return false;
    const board = boardHost.querySelector('.board');
    if (!board) return false;
    const html = normalizeBoardForExport(board);
    const saved = getSavedBoards();
    saved[name] = { html, name, ts: Date.now(), objective: objective || null };
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
    // Ask for an optional objective (user can leave blank)
    let objective = window.prompt('Optioneel: geef een doelstelling voor dit speelveld (bv. "Haal 100 punten"):');
    if (objective == null) objective = null; else { objective = String(objective).trim(); if (!objective) objective = 'Haal 100 punten'; }

    if (saveCurrentBoardWithName(name, objective)) {
      // Also notify opener/game if present
      if (window.opener && typeof window.opener.postMessage === 'function') {
        try { window.opener.postMessage({ type: 'LOCUS_EDITOR_SAVED_BOARD', name, boardHtml: normalizeBoardForExport(boardHost.querySelector('.board')), objective }, '*'); } catch (e) {}
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
      const label = document.createElement('div'); label.style.flex = '1';
      const titleText = document.createElement('div'); titleText.textContent = n; titleText.style.fontWeight = '600';
      const objText = document.createElement('div'); objText.style.fontSize = '12px'; objText.style.opacity = '0.8';
      objText.textContent = saved[n].objective ? saved[n].objective : 'Geen doel (standaard: Haal 100 punten)';
      label.appendChild(titleText); label.appendChild(objText);
      const loadBtn = document.createElement('button'); loadBtn.textContent = 'Laad';
      loadBtn.addEventListener('click', () => { setBoardHtml(saved[n].html); overlay.remove(); });
      const exportBtn = document.createElement('button'); exportBtn.textContent = 'Naar spel';
      exportBtn.addEventListener('click', () => {
        if (window.opener && typeof window.opener.postMessage === 'function') {
          try { window.opener.postMessage({ type: 'LOCUS_EDITOR_BOARD', boardHtml: saved[n].html, name: n, objective: saved[n].objective || null }, '*'); setStatus(`Speelveld "${n}" naar spel verzonden.`); } catch (e) { setStatus('Versturen mislukt.'); }
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
        const b = document.createElement('button'); b.id = 'save-board'; b.textContent = 'Opslaan';
        // copy classes from an existing control so styling matches
        const styleSource = printBtn || refreshBtn || null;
        if (styleSource && styleSource.className) b.className = styleSource.className;
        else b.style.marginLeft = '8px';
        b.addEventListener('click', promptSaveBoard);
        container.insertBefore(b, printBtn ? printBtn.nextSibling : null);
      }
      if (!document.getElementById('manage-saved-boards')) {
        const m = document.createElement('button'); m.id = 'manage-saved-boards'; m.textContent = 'Opgeslagen';
        const styleSource2 = document.getElementById('save-board') || printBtn || refreshBtn || null;
        if (styleSource2 && styleSource2.className) m.className = styleSource2.className;
        else m.style.marginLeft = '8px';
        m.addEventListener('click', createSavedBoardsModal);
        container.insertBefore(m, document.getElementById('save-board') ? document.getElementById('save-board').nextSibling : null);
      }
    } catch (e) {}
  }

  ensureSaveButtons();
  
  // --- Extra tool buttons (shop/diamond) ---
  function ensureExtraToolButtons() {
    // Previously created a bottom toolbar button for the diamond. That UI is removed
    // because the diamond now lives under the Specials tool group.
  }

  ensureExtraToolButtons();
  
  // Place the diamond shop radio under the Specials tool group (portal/coin/trap/etc.)
  function ensureShopInSpecials() {
    try {
      // Remove any leftover bottom button if present
      const oldBtn = document.getElementById('tool-shop-btn');
      if (oldBtn && oldBtn.parentNode) oldBtn.parentNode.removeChild(oldBtn);
      // Find the Specials panel section reliably
      const sections = Array.from(document.querySelectorAll('.panel__section'));
      const specials = sections.find(s => (s.querySelector('.panel__sectionTitle') || {}).textContent?.trim().toLowerCase() === 'specials');
      const parent = specials || document.querySelector('.panel') || document.body;
      if (!parent) return;
      // avoid duplicate across the whole parent area
      if (parent.querySelector('input[value="sym-shop"]') || document.querySelector('input[value="sym-shop"]')) return;
      const id = 'tool-sym-shop';
      const wrapper = document.createElement('label'); wrapper.className = 'tool'; wrapper.style.display = 'flex'; wrapper.style.alignItems = 'center'; wrapper.style.gap = '6px'; wrapper.style.marginTop = '4px';
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'tool'; input.value = 'sym-shop'; input.id = id;
      const span = document.createElement('span'); span.className = 'symbol'; span.textContent = '💎';
      const txt = document.createElement('span'); txt.textContent = ' Diamant';
      input.addEventListener('change', () => { window.__locusEditorOverrideTool = null; });
      wrapper.appendChild(input); wrapper.appendChild(span); wrapper.appendChild(txt);
      parent.appendChild(wrapper);
    } catch (e) {}
  }
  ensureShopInSpecials();
  setTimeout(ensureShopInSpecials, 500);

  // Inject editor-specific styles so end-cells are visible by zone color
  function ensureEditorEndCellStyles() {
    if (document.getElementById('editor-endcell-styles')) return;
    const css = `
      /* Editor: hide runtime info UI so designers don't see the "i" popovers */
      .zone-info-btn, .zone-info-popover { display: none !important; }
      /* Editor: show end-cells per zone color so designers can see them */
      .zone[data-color="groen"] .cell.end-cell { background-color: #7bba7b !important; border-color: #7bb57f !important; }
      .zone[data-color="groen"] .cell.end-cell.active { background-color: #5da35d !important; border-color: #518755 !important; }
      /* Start cells in green should look like bold-cells (thick dark border) */
      .zone[data-color="groen"] .cell.bold-cell { border: 2px solid #2c3333 !important; }
      .zone[data-color="geel"] .cell.end-cell { background-color: #f0e3a8 !important; border-color: #e8d38a !important; }
      .zone[data-color="geel"] .cell.end-cell.active { background-color: #cfae4a !important; border-color: #b8963c !important; }
      .zone[data-color="paars"] .cell.end-cell { background-color: #e9e0f6 !important; border-color: #d7c8f0 !important; }
      .zone[data-color="paars"] .cell.end-cell.active { background-color: #7a5aa8 !important; border-color: #62478a !important; }
      .zone[data-color="blauw"] .cell.end-cell { background-color: #d6eaf6 !important; border-color: #c0def0 !important; }
      .zone[data-color="blauw"] .cell.end-cell.active { background-color: #3b7aa4 !important; border-color: #2f6386 !important; }
      .zone[data-color="rood"] .cell.end-cell { background-color: #ffd8d8 !important; border-color: #ffc0c0 !important; }
      .zone[data-color="rood"] .cell.end-cell.active { background-color: #b56069 !important; border-color: #9a4b56 !important; }
      /* Make end-cells slightly stand out in editor with a subtle shadow */
      .cell.end-cell { box-shadow: inset 0 0 0 2px rgba(255,255,255,0.03); }
    `;
    const s = document.createElement('style');
    s.id = 'editor-endcell-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }

  function ensureEndToolInSpecials() {
    try {
      const sections = Array.from(document.querySelectorAll('.panel__section'));
      const specials = sections.find(s => (s.querySelector('.panel__sectionTitle') || {}).textContent?.trim().toLowerCase() === 'specials');
      const parent = specials || document.querySelector('.panel') || document.body;
      if (!parent) return;
      if (parent.querySelector('input[value="end"]') || document.querySelector('input[value="end"]')) return;
      const id = 'tool-end';
      const wrapper = document.createElement('label'); wrapper.className = 'tool'; wrapper.style.display = 'flex'; wrapper.style.alignItems = 'center'; wrapper.style.gap = '6px'; wrapper.style.marginTop = '4px';
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'tool'; input.value = 'end'; input.id = id;
      const span = document.createElement('span'); span.className = 'symbol'; span.textContent = '🏁';
      const txt = document.createElement('span'); txt.textContent = ' Eindcel';
      input.addEventListener('change', () => { window.__locusEditorOverrideTool = null; });
      wrapper.appendChild(input); wrapper.appendChild(span); wrapper.appendChild(txt); parent.appendChild(wrapper);
    } catch (e) {}
  }
  ensureEndToolInSpecials();
  setTimeout(ensureEndToolInSpecials, 600);

  function ensurePortalToolInSpecials() {
    try {
      const sections = Array.from(document.querySelectorAll('.panel__section'));
      const specials = sections.find(s => (s.querySelector('.panel__sectionTitle') || {}).textContent?.trim().toLowerCase() === 'specials');
      const parent = specials || document.querySelector('.panel') || document.body;
      if (!parent) return;
      if (parent.querySelector('input[value="portal"]') || document.querySelector('input[value="portal"]')) return;
      const id = 'tool-portal';
      const wrapper = document.createElement('label'); wrapper.className = 'tool'; wrapper.style.display = 'flex'; wrapper.style.alignItems = 'center'; wrapper.style.gap = '6px'; wrapper.style.marginTop = '4px';
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'tool'; input.value = 'portal'; input.id = id;
      const span = document.createElement('span'); span.className = 'symbol'; span.textContent = '🌀';
      const txt = document.createElement('span'); txt.textContent = ' Portal';
      input.addEventListener('change', () => { window.__locusEditorOverrideTool = null; });
      wrapper.appendChild(input); wrapper.appendChild(span); wrapper.appendChild(txt);
      parent.appendChild(wrapper);
    } catch (e) {}
  }
  ensurePortalToolInSpecials();
  setTimeout(ensurePortalToolInSpecials, 600);
  
  function ensureBlueStartToolInSpecials() {
    try {
      const toolRadios = Array.from(document.querySelectorAll('input[name="tool"]'));
      const parent = toolRadios.length ? (toolRadios[0].closest('fieldset') || toolRadios[0].parentNode) : document.body;
      if (!parent) return;
      if (parent.querySelector('input[value="bold-blue"]')) return;
      const id = 'tool-bold-blue';
      const wrapper = document.createElement('div'); wrapper.style.display = 'flex'; wrapper.style.alignItems = 'center'; wrapper.style.gap = '6px'; wrapper.style.marginTop = '4px';
      const input = document.createElement('input'); input.type = 'radio'; input.name = 'tool'; input.value = 'bold-blue'; input.id = id;
      const label = document.createElement('label'); label.htmlFor = id; label.textContent = 'Blue start'; label.style.cursor = 'pointer';
      input.addEventListener('change', () => { window.__locusEditorOverrideTool = null; });
      wrapper.appendChild(input); wrapper.appendChild(label); parent.appendChild(wrapper);
    } catch (e) {}
  }
  ensureBlueStartToolInSpecials();
  setTimeout(ensureBlueStartToolInSpecials, 600);


  // Auto-load on open: if opened from the game, load snapshot once; otherwise fallback to storage.
  if (!requestBoardFromOpener()) {
    // If nothing in storage, generate a fresh editor board so the UI isn't empty.
    if (!loadFromStorage()) generateNewBoard();
  }
})();
