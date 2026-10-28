// Click a column heading to sort any table in the app: first ascending, then descending, then back to the original order.
// The original order is the default. Sorting keeps working when a list is redrawn.
(() => {
  const sortStates = new Map();   // table key -> { column, direction }
  const defaultOrder = new WeakMap(); // tbody -> rows in their original order
  const EMPTY = new Set(['', '—', '-']);
  // Fixed business orders: ranks from highest to lowest, and activity from most to least active.
  const CUSTOM_ORDERS = {
    rank: ['commissioners', 'chief', 'county command', 'division commander', 'captain', 'lieutenant', 'lead paramedic', 'paramedic', 'aemt', 'advanced emt', 'emt', 'probationary', 'senior volunteer', 'volunteer', 'probationary volunteer', 'emr', 'emr/volunteer'],
    activity: ['active', 'semi active', 'inactive', 'can be terminated']
  };
  // Reads only the heading's own text, so a button inside the heading does not change the match.
  const headingLabel = th => [...(th?.childNodes || [])].filter(node => node.nodeType === 3).map(node => node.textContent).join('').trim().toLowerCase();
  // Columns where sorting has no use: action buttons, yes/no training flags, hours and results.
  const NO_SORT_LABELS = new Set(['', 'action', 'actions', 'result', 'training hours', 'basic fort', 'advanced fort', 'hert cert', 'hert certified', 'hert instructor', 'fort instructor', 'reason', 'presence', 'approval', 'role change', 'type']);
  // Lists whose last column holds buttons only.
  const NO_SORT_LAST_COLUMN_IN = new Set(['membersTable', 'eligibleTable', 'doNotPromoteTable', 'doNotTerminateTable', 'inactiveTable', 'trainingOverdueTable']);
  const isSortable = (table, th) => {
    // A table can limit sorting to some columns: data-sort-only="callsign,name".
    const only = table.dataset.sortOnly;
    if (only) return only.split(',').map(item => item.trim().toLowerCase()).includes(headingLabel(th));
    if (NO_SORT_LABELS.has(headingLabel(th))) return false;
    const headerRow = table.tHead.rows[0];
    const isLast = th === headerRow.cells[headerRow.cells.length - 1];
    if (isLast && NO_SORT_LAST_COLUMN_IN.has(table.closest('[id]')?.id)) return false;
    return true;
  };
  const customOrderFor = th => {
    const label = headingLabel(th);
    if (label === 'rank') return CUSTOM_ORDERS.rank;
    if (label === 'activity') return CUSTOM_ORDERS.activity;
    return null;
  };

  const cellText = cell => (cell?.textContent || '').replace(/\s+/g, ' ').trim();
  const numberOf = text => {
    const plain = text.replace(/[,%\s]/g, '').replace(/^\((.*)\)$/, '$1');
    return /^-?\d+(\.\d+)?$/.test(plain) ? Number(plain) : null;
  };
  const dateOf = text => {
    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return match ? Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2])) : null;
  };
  const keyFor = (table, headerRow) => {
    const container = table.closest('[id]')?.id || table.id || 'table';
    return container + '|' + [...headerRow.cells].map(cell => cellText(cell)).join('|');
  };

  const markHeaders = (table, state) => {
    table.tHead?.rows[0]?.querySelectorAll('th').forEach((th, index) => {
      th.classList.toggle('sort-asc', !!state && state.column === index && state.direction === 'asc');
      th.classList.toggle('sort-desc', !!state && state.column === index && state.direction === 'desc');
    });
  };

  const applySort = (table, state) => {
    const body = table.tBodies[0];
    if (!body) return;
    const rows = [...body.rows];
    if (rows.length < 2) return;
    // Message rows such as "No members found." span the whole table; leave those alone.
    const headerCount = table.tHead?.rows[0]?.cells.length || 0;
    if (rows.some(row => row.cells.length !== headerCount)) return;
    if (!defaultOrder.has(body)) defaultOrder.set(body, rows.slice());

    let ordered;
    if (!state) {
      const position = new Map(defaultOrder.get(body).map((row, index) => [row, index]));
      ordered = rows.slice().sort((a, b) => (position.get(a) ?? 1e9) - (position.get(b) ?? 1e9));
    } else {
      const values = new Map(rows.map(row => [row, cellText(row.cells[state.column])]));
      const order = customOrderFor(table.tHead.rows[0].cells[state.column]);
      const position = value => {
        const index = order.indexOf(value.toLowerCase());
        return index < 0 ? 1e9 : index;
      };
      ordered = rows.slice().sort((a, b) => {
        const va = values.get(a), vb = values.get(b);
        const emptyA = EMPTY.has(va), emptyB = EMPTY.has(vb);
        if (emptyA || emptyB) return emptyA === emptyB ? 0 : emptyA ? 1 : -1; // blanks always go last
        let cmp;
        if (order) {
          cmp = position(va) - position(vb);
        } else {
          const na = numberOf(va) ?? dateOf(va), nb = numberOf(vb) ?? dateOf(vb);
          cmp = na !== null && nb !== null ? na - nb : va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' });
        }
        return state.direction === 'desc' ? -cmp : cmp;
      });
    }
    ordered.forEach(row => body.appendChild(row));
  };

  const enhance = () => {
    document.querySelectorAll('table').forEach(table => {
      if (table.dataset.sortReady) return;
      const headerRow = table.tHead?.rows[0];
      if (!headerRow || !table.tBodies[0]) return;
      table.dataset.sortReady = '1';
      headerRow.querySelectorAll('th').forEach(th => {
        if (th.colSpan <= 1 && !th.querySelector('input, select, textarea') && isSortable(table, th)) th.classList.add('sortable-th');
      });
      const state = sortStates.get(keyFor(table, headerRow));
      if (state) { applySort(table, state); markHeaders(table, state); }
    });
  };

  document.addEventListener('click', event => {
    const th = event.target.closest?.('th.sortable-th');
    if (!th || event.target.closest('button, a, input, select, textarea, label')) return;
    const table = th.closest('table');
    const headerRow = th.parentElement;
    if (!table || !table.tBodies[0] || !headerRow) return;
    const column = [...headerRow.cells].indexOf(th);
    const key = keyFor(table, headerRow);
    const current = sortStates.get(key);
    let next = null;
    if (!current || current.column !== column) next = { column, direction: 'asc' };
    else if (current.direction === 'asc') next = { column, direction: 'desc' };
    if (next) sortStates.set(key, next); else sortStates.delete(key);
    applySort(table, next);
    markHeaders(table, next);
  });

  enhance();
  new MutationObserver(enhance).observe(document.body, { childList: true, subtree: true });
})();
