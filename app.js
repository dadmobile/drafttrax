// DraftTrax — vanilla JS NHL playoff pool draft tracker.
// State model:
//   picks: { [playerId: number]: 0 | 1 | 2 }  — 0 available / 1 taken / 2 mine
//   absent key = 0 (available). History is a bounded stack of {id, prev, next}.

const STORAGE_KEY = 'drafttrax:v1';
const HISTORY_LIMIT = 200;

const state = {
  data: null,           // parsed players.json
  picks: {},            // id → 0|1|2 (only non-zero entries stored)
  history: [],          // stack of { id, prev, next }
};

// --- persistence ----------------------------------------------------------

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      state.picks = parsed.picks ?? {};
      state.history = Array.isArray(parsed.history) ? parsed.history : [];
    }
  } catch (e) {
    console.warn('Failed to load saved state:', e);
  }
}

function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ picks: state.picks, history: state.history }),
    );
  } catch (e) {
    console.warn('Failed to save state:', e);
  }
}

// --- state mutations ------------------------------------------------------

function getState(id) {
  return state.picks[id] ?? 0;
}

function setState(id, next) {
  const prev = getState(id);
  if (prev === next) return;
  if (next === 0) delete state.picks[id];
  else state.picks[id] = next;
  state.history.push({ id, prev, next });
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  save();
}

function cycle(id, forward = true) {
  const cur = getState(id);
  const next = forward ? (cur + 1) % 3 : (cur + 2) % 3;
  setState(id, next);
}

function undo() {
  const last = state.history.pop();
  if (!last) return;
  if (last.prev === 0) delete state.picks[last.id];
  else state.picks[last.id] = last.prev;
  save();
}

function reset() {
  state.picks = {};
  state.history = [];
  save();
}

// --- rendering ------------------------------------------------------------

const board = document.getElementById('board');
const countMine = document.getElementById('count-mine');
const countTaken = document.getElementById('count-taken');
const countRemaining = document.getElementById('count-remaining');

function renderAll() {
  if (!state.data) return;
  const frag = document.createDocumentFragment();
  for (const series of state.data.series) {
    frag.appendChild(renderSeries(series));
  }
  board.replaceChildren(frag);
  updateCounters();
}

function renderSeries(series) {
  const el = document.createElement('section');
  el.className = 'series';
  const head = document.createElement('header');
  head.className = 'series-head';
  head.textContent = `${series.label} — ${series.teams[0].abbrev} vs ${series.teams[1].abbrev}`;
  el.appendChild(head);
  const body = document.createElement('div');
  body.className = 'series-body';
  for (const team of series.teams) body.appendChild(renderTeam(team));
  el.appendChild(body);
  return el;
}

function renderTeam(team) {
  const el = document.createElement('div');
  el.className = 'team';
  const h3 = document.createElement('h3');
  h3.innerHTML = `<span>${team.abbrev} · ${escapeHtml(team.name)}</span><span class="seed">${team.seed ?? ''}</span>`;
  el.appendChild(h3);

  const table = document.createElement('table');
  table.className = 'roster';
  table.innerHTML = `
    <thead>
      <tr>
        <th class="pos">Pos</th>
        <th class="name">Player</th>
        <th>GP</th><th>G</th><th>A</th><th>P</th>
      </tr>
    </thead>
    <tbody></tbody>`;
  const tbody = table.querySelector('tbody');
  for (const p of team.players) tbody.appendChild(renderRow(p));
  el.appendChild(table);
  return el;
}

function renderRow(p) {
  const tr = document.createElement('tr');
  tr.dataset.id = String(p.id);
  applyRowState(tr, getState(p.id));
  tr.innerHTML = `
    <td class="pos">${p.pos}</td>
    <td class="name">${escapeHtml(p.name)}</td>
    <td>${p.gp}</td><td>${p.g}</td><td>${p.a}</td><td>${p.pts}</td>`;
  return tr;
}

function applyRowState(tr, s) {
  tr.classList.remove('state-1', 'state-2');
  if (s === 1) tr.classList.add('state-1');
  else if (s === 2) tr.classList.add('state-2');
}

function updateCounters() {
  let mine = 0, taken = 0, total = 0;
  for (const series of state.data.series) {
    for (const team of series.teams) total += team.players.length;
  }
  for (const v of Object.values(state.picks)) {
    if (v === 1) taken++;
    else if (v === 2) mine++;
  }
  countMine.textContent = mine;
  countTaken.textContent = taken;
  countRemaining.textContent = total - mine - taken;
}

function refreshRow(id) {
  const tr = board.querySelector(`tr[data-id="${id}"]`);
  if (tr) applyRowState(tr, getState(id));
  updateCounters();
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// --- events ---------------------------------------------------------------

function onBoardClick(e) {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const id = Number(tr.dataset.id);
  cycle(id, !e.shiftKey);
  refreshRow(id);
}

function onBoardContextMenu(e) {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  e.preventDefault();
  const id = Number(tr.dataset.id);
  cycle(id, false);
  refreshRow(id);
}

function onKeydown(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault();
    const last = state.history[state.history.length - 1];
    undo();
    if (last) refreshRow(last.id);
  }
}

function onUndo() {
  const last = state.history[state.history.length - 1];
  undo();
  if (last) refreshRow(last.id);
}

function onReset() {
  if (!confirm('Clear all picks? This cannot be undone.')) return;
  reset();
  renderAll();
}

// --- init -----------------------------------------------------------------

async function init() {
  load();
  try {
    const res = await fetch('./data/players.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    state.data = await res.json();
  } catch (e) {
    board.textContent =
      `Could not load data/players.json (${e.message}). ` +
      `If you opened index.html directly, some browsers block local fetches — ` +
      `run "python3 -m http.server" in this folder and visit http://localhost:8000.`;
    return;
  }
  renderAll();
  board.addEventListener('click', onBoardClick);
  board.addEventListener('contextmenu', onBoardContextMenu);
  document.addEventListener('keydown', onKeydown);
  document.getElementById('btn-undo').addEventListener('click', onUndo);
  document.getElementById('btn-reset').addEventListener('click', onReset);
}

init();
