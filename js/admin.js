// admin.js - OpenStrike admin: edit the built-in grid maps, add custom maps, edit guns and skins,
// test them in the game and publish them to the repo as data/mods.json.
import { checkMap, emptyMap, isGrid, ROWS, COLS } from './mapcheck.js';
import { GitHub, guessRepo } from './github.js';
import { bake } from './bake.js';

const DRAFT_KEY = 'openstrike.adminDraft', GH_KEY = 'openstrike.adminGh', TOKEN_KEY = 'openstrike.adminToken';
const $ = (id) => document.getElementById(id);
const clone = (o) => JSON.parse(JSON.stringify(o));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let toastT = 0;
const toast = (t) => { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2400); };

const S = { defs: null, published: null, work: null, sel: { kind: 'builtin', i: 0, gun: 17, skin: 0 }, tool: 'brush', tile: '#', undo: {}, redo: {} };

// ------------------------------------------------------------------ mods <-> working state
function fromMods(mods) {
  const d = S.defs, w = { maps: { builtin: clone(d.maps), custom: [null, null, null] }, weapons: clone(d.weapons), skins: clone(d.skins) };
  if (!mods) return w;
  for (const m of (mods.maps && mods.maps.builtin) || []) {
    const t = w.maps.builtin[m.index]; if (!t) continue;
    if (m.name) t.name = m.name; if (isGrid(m.rows)) t.rows = m.rows.slice();
  }
  for (const m of (mods.maps && mods.maps.custom) || []) if (m.slot >= 0 && m.slot <= 2 && isGrid(m.rows)) w.maps.custom[m.slot] = { slot: m.slot, name: m.name || 'Custom ' + (m.slot + 1), rows: m.rows.slice() };
  for (const g of mods.weapons || []) { const t = w.weapons[g.index]; if (t) for (const k in g) if (k !== 'index' && k in t) t[k] = g[k]; }
  for (const s of mods.skins || []) { const t = w.skins[s.index]; if (t) { for (const k of ['name', 'rarity', 'pattern']) if (k in s) t[k] = s[k]; if (Array.isArray(s.colors)) t.colors = s.colors.slice(0, 3); } }
  return w;
}
function toMods(w = S.work) {
  const d = S.defs, out = { version: (S.published && S.published.version) || 0, build: d.build, maps: { builtin: [], custom: [] }, weapons: [], skins: [] };
  w.maps.builtin.forEach((m, i) => {
    const o = d.maps[i], e = { index: i }; let ch = false;
    if (m.name !== o.name) { e.name = m.name; ch = true; }
    if (m.rows.join('') !== o.rows.join('')) { e.rows = m.rows.slice(); ch = true; }
    if (ch) out.maps.builtin.push(e);
  });
  w.maps.custom.forEach((m) => { if (m) out.maps.custom.push({ slot: m.slot, name: m.name, rows: m.rows.slice() }); });
  w.weapons.forEach((g, i) => {
    const o = d.weapons[i], e = { index: i }; let ch = false;
    for (const f of d.weaponFields) if (f.key !== 'category' && f.key !== 'slot' && g[f.key] !== o[f.key]) { e[f.key] = g[f.key]; ch = true; }
    if (ch) out.weapons.push(e);
  });
  w.skins.forEach((s, i) => {
    const o = d.skins[i];
    if (s.name !== o.name || s.rarity !== o.rarity || s.pattern !== o.pattern || s.colors.join() !== o.colors.join()) out.skins.push({ index: i, name: s.name, rarity: s.rarity, pattern: s.pattern, colors: s.colors.slice() });
  });
  return out;
}
const sig = (mods) => { if (!mods) return ''; const m = clone(mods); delete m.version; delete m.updated; delete m.build; return JSON.stringify(m); };
let saveT = 0;
function changed() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(toMods())); } catch (_) { } }, 250);
  refreshDirty();
}
function refreshDirty() {
  const dirty = sig(toMods()) !== sig(toMods(fromMods(S.published)));
  const p = $('dirty'); p.textContent = dirty ? 'Unpublished changes' : (S.published ? 'Up to date (v' + (S.published.version || 0) + ')' : 'No mods published'); p.classList.toggle('dirty', dirty);
}

// ------------------------------------------------------------------ tabs
document.querySelectorAll('nav button').forEach((b) => b.onclick = () => showTab(b.dataset.tab));
function showTab(t) {
  document.querySelectorAll('nav button').forEach((x) => x.classList.toggle('on', x.dataset.tab === t));
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x.id === 'tab-' + t));
  if (t === 'maps') { sizeGrid(); drawGrid(); } if (t === 'publish') renderChanges();
  try { location.hash = t; } catch (_) { }
}
$('pubBtn').onclick = () => showTab('publish');
$('testBtn').onclick = () => {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(toMods())); } catch (_) { toast('Could not save the draft (storage blocked?)'); return; }
  window.open('index.html?draft=1', '_blank');
};

// ================================================================== MAPS
const curMap = () => S.sel.kind === 'builtin' ? S.work.maps.builtin[S.sel.i] : S.work.maps.custom[S.sel.i];
const mapKey = () => S.sel.kind + S.sel.i;
const tileColor = {}, KEYS = '1234567890qwert';
// built-in maps in the game's own order (Desert first), whatever their index in mods.json
const builtinOrder = () => S.defs.maps.map((m, i) => i).sort((a, b) => (S.defs.maps[a].gameId ?? a + 1) - (S.defs.maps[b].gameId ?? b + 1));
function renderMapList() {
  const d = S.defs;
  $('mapListBuiltin').innerHTML = builtinOrder().map((i) => {
    const m = S.work.maps.builtin[i];
    const mod = m.name !== d.maps[i].name || m.rows.join('') !== d.maps[i].rows.join('');
    const bad = checkMap(m.rows).errors.length;
    return `<button class="item ${S.sel.kind === 'builtin' && S.sel.i === i ? 'on' : ''}" data-k="builtin" data-i="${i}">${esc(m.name)}${m.name !== d.maps[i].name ? ` <small>(${esc(d.maps[i].name)})</small>` : ''}${bad ? ' <small class="r3">!</small>' : ''}${mod ? '<span class="dot" title="Edited"></span>' : ''}</button>`;
  }).join('');
  $('mapListCustom').innerHTML = S.work.maps.custom.map((m, i) => m
    ? `<button class="item ${S.sel.kind === 'custom' && S.sel.i === i ? 'on' : ''}" data-k="custom" data-i="${i}">${esc(m.name)} <small>Custom ${i + 1}</small>${checkMap(m.rows).errors.length ? ' <small class="r3">!</small>' : ''}</button>`
    : `<button class="item" data-new="${i}"><small>+ New map in slot ${i + 1}</small></button>`).join('');
  document.querySelectorAll('.list .item[data-k]').forEach((b) => b.onclick = () => selectMap(b.dataset.k, +b.dataset.i));
  document.querySelectorAll('.list .item[data-new]').forEach((b) => b.onclick = () => newCustom(+b.dataset.new));
}
function newCustom(slot, rows) {
  const base = rows || (() => { const r = emptyMap(); r[2] = '#' + '.'.repeat(4) + 'TTTTT' + '.'.repeat(37) + '#'; return r; })();
  if (!rows) {      // a playable starter: T spawn top, CT spawn bottom, a site on each side
    const put = (r, c0, s) => { base[r] = base[r].slice(0, c0) + s + base[r].slice(c0 + s.length); };
    base[2] = emptyMap()[2]; put(2, 20, 'TTTTTTTT'); put(3, 20, 'TTTTTTTT'); put(36, 20, 'SSSSSSSS'); put(37, 20, 'SSSSSSSS');
    for (let r = 26; r < 32; r++) { put(r, 4, 'AAAAAAA'); put(r, 37, 'BBBBBBB'); }
  }
  S.work.maps.custom[slot] = { slot, name: 'New map ' + (slot + 1), rows: base };
  selectMap('custom', slot); changed();
}
function selectMap(kind, i) { S.sel.kind = kind; S.sel.i = i; renderMapList(); renderMapSide(); drawGrid(); }
function renderPalette() {
  $('palette').innerHTML = S.defs.palette.map((p, k) => `<button data-ch="${esc(p.ch)}" class="${p.ch === S.tile ? 'on' : ''}"><i style="background:${p.color}"></i>${esc(p.name)}<kbd>${KEYS[k] || ''}</kbd></button>`).join('');
  document.querySelectorAll('#palette button').forEach((b) => b.onclick = () => setTile(b.dataset.ch));
}
function setTile(ch) { S.tile = ch; renderPalette(); }
function renderMapSide() {
  const m = curMap(); if (!m) return;
  const builtin = S.sel.kind === 'builtin';
  $('mapName').value = m.name;
  $('mapNameNote').textContent = builtin ? 'Shown in the game\'s MAP selector.' : `Shows as "Custom ${S.sel.i + 1}" in the game (the game can't name custom slots). The name is for the admin list.`;
  const c = checkMap(m.rows, S.defs.palette);
  const n = (ch) => c.count[ch] || 0;
  $('checks').innerHTML = (c.errors.length ? c.errors.map((e) => `<div class="err">${esc(e)}</div>`).join('') : '<div class="ok">Playable: spawns and both sites are connected</div>')
    + c.warnings.map((e) => `<div class="wrn">${esc(e)}</div>`).join('')
    + `<div class="counts">T spawn ${n('T')} · CT spawn ${n('S')} · Site A ${n('A')} · Site B ${n('B')}</div>`;
  $('customActions').innerHTML = builtin
    ? `<h3>Actions</h3><button id="copyToCustom">Copy into a new map slot</button>`
    : `<h3>Actions</h3><button id="removeCustom" class="danger">Remove this map</button>`;
  if (builtin) $('copyToCustom').onclick = () => { const free = S.work.maps.custom.indexOf(null); if (free < 0) return toast('All 3 custom slots are used'); newCustom(free, m.rows.slice()); S.work.maps.custom[free].name = m.name + ' copy'; renderMapList(); renderMapSide(); };
  else $('removeCustom').onclick = () => { if (!confirm('Remove this map? Players lose it after you publish.')) return; S.work.maps.custom[S.sel.i] = null; selectMap('builtin', builtinOrder()[0]); changed(); };
  $('mapReset').textContent = builtin ? 'Reset to original' : 'Clear';
}
$('mapName').oninput = () => { const m = curMap(); if (!m) return; m.name = $('mapName').value.replace(/[^\x20-\x7e]/g, '').slice(0, 24) || 'Untitled'; renderMapList(); changed(); };

// ------------------------------------------------------------------ grid canvas
const cv = $('grid'), g = cv.getContext('2d'); let CS = 14, hover = null, drag = null;
function sizeGrid() {
  const wrap = cv.parentElement, w = wrap.clientWidth - 24, h = wrap.clientHeight - 24;
  CS = Math.max(6, Math.floor(Math.min(w / COLS, h / ROWS)));
  const dpr = window.devicePixelRatio || 1;
  cv.width = COLS * CS * dpr; cv.height = ROWS * CS * dpr; cv.style.width = COLS * CS + 'px'; cv.style.height = ROWS * CS + 'px';
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener('resize', () => { if ($('tab-maps').classList.contains('on')) { sizeGrid(); drawGrid(); } });
function drawGrid() {
  const m = curMap(); if (!m || !cv.width) return;
  g.fillStyle = '#000'; g.fillRect(0, 0, COLS * CS, ROWS * CS);
  g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold ${Math.max(7, CS * 0.62)}px system-ui`;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const ch = m.rows[r][c], x = c * CS, y = r * CS;
    g.fillStyle = tileColor[ch] || '#f0f'; g.fillRect(x, y, CS, CS);
    if (ch === 'L') { g.fillStyle = 'rgba(0,0,0,.35)'; for (let k = 2; k < CS; k += 4) g.fillRect(x, y + k, CS, 1); }
    else if (ch === 'P') { g.strokeStyle = 'rgba(0,0,0,.35)'; g.strokeRect(x + 1.5, y + 1.5, CS - 3, CS - 3); }
    else if (ch === 'u') { g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x, y, CS, CS / 3); }
    if (CS >= 9 && 'TSAB'.includes(ch)) { g.fillStyle = 'rgba(0,0,0,.55)'; g.fillText(ch === 'S' ? 'C' : ch, x + CS / 2, y + CS / 2 + 1); }
  }
  g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 1; g.beginPath();
  for (let c = 0; c <= COLS; c++) { g.moveTo(c * CS + 0.5, 0); g.lineTo(c * CS + 0.5, ROWS * CS); }
  for (let r = 0; r <= ROWS; r++) { g.moveTo(0, r * CS + 0.5); g.lineTo(COLS * CS, r * CS + 0.5); }
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,.12)'; g.beginPath(); g.moveTo(COLS * CS / 2, 0); g.lineTo(COLS * CS / 2, ROWS * CS); g.moveTo(0, ROWS * CS / 2); g.lineTo(COLS * CS, ROWS * CS / 2); g.stroke();
  // previews
  g.strokeStyle = '#fff'; g.lineWidth = 2;
  if (drag && drag.tool === 'rect' && drag.cur) {
    const [r0, c0, r1, c1] = rectOf(drag.start, drag.cur);
    for (const [a, b, cc, d] of mirrorRects(r0, c0, r1, c1)) { g.fillStyle = (tileColor[S.tile] || '#fff') + 'aa'; g.fillRect(b * CS, a * CS, (d - b + 1) * CS, (cc - a + 1) * CS); g.strokeRect(b * CS + 1, a * CS + 1, (d - b + 1) * CS - 2, (cc - a + 1) * CS - 2); }
  } else if (hover) {
    const s = S.tool === 'brush' ? +$('brushSize').value : 1;
    for (const [r, c] of mirrorPts(hover[0], hover[1])) { const o = Math.floor((s - 1) / 2); g.strokeRect((c - o) * CS + 1, (r - o) * CS + 1, s * CS - 2, s * CS - 2); }
  }
}
const cellAt = (e) => { const b = cv.getBoundingClientRect(), c = Math.floor((e.clientX - b.left) / CS), r = Math.floor((e.clientY - b.top) / CS); return r >= 0 && c >= 0 && r < ROWS && c < COLS ? [r, c] : null; };
const rectOf = (a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
function mirrorPts(r, c) {
  const out = [[r, c]]; const mx = $('mirX').checked, my = $('mirY').checked;
  if (mx) out.push([r, COLS - 1 - c]); if (my) out.push([ROWS - 1 - r, c]); if (mx && my) out.push([ROWS - 1 - r, COLS - 1 - c]);
  return out;
}
function mirrorRects(r0, c0, r1, c1) {
  const out = [[r0, c0, r1, c1]], mx = $('mirX').checked, my = $('mirY').checked;
  if (mx) out.push([r0, COLS - 1 - c1, r1, COLS - 1 - c0]); if (my) out.push([ROWS - 1 - r1, c0, ROWS - 1 - r0, c1]);
  if (mx && my) out.push([ROWS - 1 - r1, COLS - 1 - c1, ROWS - 1 - r0, COLS - 1 - c0]);
  return out;
}
function setCell(rows, r, c, ch) {
  if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return;
  if ((r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1) && ch !== '#') return;   // keep the outer wall
  if (rows[r][c] === ch) return;
  rows[r] = rows[r].slice(0, c) + ch + rows[r].slice(c + 1);
}
function pushUndo() { const k = mapKey(); (S.undo[k] = S.undo[k] || []).push(curMap().rows.slice()); if (S.undo[k].length > 150) S.undo[k].shift(); S.redo[k] = []; }
function brushAt(r, c) {
  const m = curMap(), s = +$('brushSize').value, o = Math.floor((s - 1) / 2);
  for (const [rr, cc] of mirrorPts(r, c)) for (let dr = 0; dr < s; dr++) for (let dc = 0; dc < s; dc++) setCell(m.rows, rr - o + dr, cc - o + dc, S.tile);
}
function floodAt(r, c) {
  const m = curMap(), from = m.rows[r][c], to = S.tile; if (from === to) return;
  const st = [[r, c]], seen = new Set();
  while (st.length) {
    const [y, x] = st.pop(), k = y * COLS + x; if (seen.has(k)) continue; seen.add(k);
    if (y < 0 || x < 0 || y >= ROWS || x >= COLS || m.rows[y][x] !== from) continue;
    setCell(m.rows, y, x, to); st.push([y + 1, x], [y - 1, x], [y, x + 1], [y, x - 1]);
  }
}
function edited() { renderMapSide(); renderMapList(); drawGrid(); changed(); }
cv.addEventListener('contextmenu', (e) => e.preventDefault());
cv.addEventListener('pointerdown', (e) => {
  const p = cellAt(e); if (!p) return; cv.setPointerCapture(e.pointerId);
  if (e.button === 2 || S.tool === 'pick') { setTile(curMap().rows[p[0]][p[1]]); return; }
  pushUndo();
  if (S.tool === 'fill') { floodAt(p[0], p[1]); edited(); return; }
  drag = { tool: S.tool, start: p, cur: p };
  if (S.tool === 'brush') { brushAt(p[0], p[1]); drawGrid(); }
});
cv.addEventListener('pointermove', (e) => {
  const p = cellAt(e); hover = p;
  $('cellInfo').textContent = p ? `row ${p[0] + 1}, col ${p[1] + 1}: ${(S.defs.palette.find((x) => x.ch === curMap().rows[p[0]][p[1]]) || {}).name || '?'}` : '';
  if (drag && p) {
    if (drag.tool === 'brush') { const [r0, c0] = drag.cur, n = Math.max(Math.abs(p[0] - r0), Math.abs(p[1] - c0)); for (let k = 1; k <= n; k++) brushAt(Math.round(r0 + (p[0] - r0) * k / n), Math.round(c0 + (p[1] - c0) * k / n)); }
    drag.cur = p;
  }
  drawGrid();
});
cv.addEventListener('pointerleave', () => { hover = null; drawGrid(); });
window.addEventListener('pointerup', () => {
  if (!drag) return;
  if (drag.tool === 'rect') { const m = curMap(); for (const [r0, c0, r1, c1] of mirrorRects(...rectOf(drag.start, drag.cur))) for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) setCell(m.rows, r, c, S.tile); }
  drag = null; edited();
});
document.querySelectorAll('#tools button').forEach((b) => b.onclick = () => setTool(b.dataset.tool));
function setTool(t) { S.tool = t; document.querySelectorAll('#tools button').forEach((b) => b.classList.toggle('on', b.dataset.tool === t)); }
function undo() { const k = mapKey(), u = S.undo[k]; if (!u || !u.length) return; (S.redo[k] = S.redo[k] || []).push(curMap().rows.slice()); curMap().rows = u.pop(); edited(); }
function redo() { const k = mapKey(), u = S.redo[k]; if (!u || !u.length) return; S.undo[k].push(curMap().rows.slice()); curMap().rows = u.pop(); edited(); }
$('undo').onclick = undo; $('redo').onclick = redo;
$('mapReset').onclick = () => {
  if (!confirm(S.sel.kind === 'builtin' ? 'Reset this map to the original layout and name?' : 'Clear this map?')) return;
  pushUndo();
  if (S.sel.kind === 'builtin') { const o = S.defs.maps[S.sel.i]; curMap().rows = o.rows.slice(); curMap().name = o.name; } else curMap().rows = emptyMap();
  edited();
};
$('mapExport').onclick = () => {
  const txt = curMap().rows.join('\n') + '\n';
  (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => toast('Map copied as text'), () => prompt('Copy the map:', txt));
};
$('mapImport').onclick = () => {
  const t = prompt('Paste a map: 40 lines of 48 characters (a "slot N" line from the game file is fine)'); if (!t) return;
  const rows = t.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l && !/^slot \d+$/.test(l)).slice(0, 40);
  if (!isGrid(rows)) return toast(`Expected 40 lines of 48 characters, got ${rows.length} lines`);
  pushUndo(); curMap().rows = rows; edited();
};
window.addEventListener('keydown', (e) => {
  if (!$('tab-maps').classList.contains('on') || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = KEYS.indexOf(e.key.toLowerCase()); if (k >= 0 && S.defs.palette[k]) { setTile(S.defs.palette[k].ch); return; }
  const tools = { b: 'brush', g: 'rect', f: 'fill', i: 'pick' }; if (tools[e.key.toLowerCase()]) setTool(tools[e.key.toLowerCase()]);
});

// ================================================================== GUNS
const TEAMS = ['Both teams', 'T only', 'CT only'];
function renderGunList() {
  const q = $('gunSearch').value.trim().toLowerCase(), d = S.defs; let html = '', lastCat = -1;
  S.work.weapons.forEach((w, i) => {
    if (q && !w.name.toLowerCase().includes(q) && !d.weapons[i].name.toLowerCase().includes(q)) return;
    if (w.category !== lastCat) { html += `<div class="group-h">${esc(d.categories[w.category] || 'Other')}</div>`; lastCat = w.category; }
    const mod = d.weaponFields.some((f) => w[f.key] !== d.weapons[i][f.key]);
    html += `<button class="item ${S.sel.gun === i ? 'on' : ''}" data-i="${i}">${esc(w.name)}${w.name !== d.weapons[i].name ? ` <small>(${esc(d.weapons[i].name)})</small>` : ''}${mod ? '<span class="dot"></span>' : ''}</button>`;
  });
  $('gunList').innerHTML = html;
  document.querySelectorAll('#gunList .item').forEach((b) => b.onclick = () => { S.sel.gun = +b.dataset.i; renderGunList(); renderGunForm(); });
}
$('gunSearch').oninput = renderGunList;
function fmt(v) { return typeof v === 'number' && !Number.isInteger(v) ? +v.toFixed(4) : v; }
function gunBars(w) {
  const max = (k) => Math.max(...S.work.weapons.filter((x) => x.category > 0 && x.category < 6).map((x) => +x[k] || 0), 1);
  return [
    ['Damage', w.damage, max('damage'), ''], ['Fire rate', w.fireInterval > 0 ? Math.round(60 / w.fireInterval) : 0, 900, ' rpm'],
    ['Magazine', w.mag, max('mag'), ''], ['Move speed', w.moveSpeed, 6.5, ' m/s'], ['Price', w.price, max('price'), ''],
  ].map(([l, v, m, u]) => `<div class="bar"><span>${l}</span><div><i style="width:${Math.min(100, v / m * 100)}%"></i></div><b>${fmt(v)}${u}</b></div>`).join('');
}
function renderGunForm() {
  const i = S.sel.gun, w = S.work.weapons[i], o = S.defs.weapons[i], d = S.defs;
  const field = (f) => {
    const ch = w[f.key] !== o[f.key] ? ' changed' : '';
    let input;
    if (f.key === 'name') input = `<input data-k="name" maxlength="16" value="${esc(w.name)}">`;
    else if (f.key === 'team') input = `<select data-k="team">${TEAMS.map((t, k) => `<option value="${k}" ${w.team === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    else if (f.key === 'scope' || f.key === 'auto') input = `<select data-k="${f.key}"><option value="0" ${!w[f.key] ? 'selected' : ''}>No</option><option value="1" ${w[f.key] ? 'selected' : ''}>Yes</option></select>`;
    else if (f.key === 'category' || f.key === 'slot') input = `<input disabled value="${esc(f.key === 'category' ? d.categories[w.category] : d.slots[w.slot])}">`;
    else input = `<input data-k="${f.key}" type="number" step="${f.type === 'f32' ? '0.01' : '1'}" min="0" value="${fmt(w[f.key])}">`;
    const dv = f.key === 'team' ? TEAMS[o.team] : f.key === 'scope' || f.key === 'auto' ? (o[f.key] ? 'Yes' : 'No') : f.key === 'category' ? '' : fmt(o[f.key]);
    return `<div class="field${ch}"><label>${esc(f.label)}</label>${input}${f.key === 'category' || f.key === 'slot' ? '<span class="def">fixed for this slot</span>' : `<span class="def">original: ${esc(dv)}</span>`}</div>`;
  };
  const grenadeOrBomb = w.category >= 6;
  const fields = d.weaponFields.filter((f) => !(grenadeOrBomb && !['name', 'price', 'reward', 'category', 'slot'].includes(f.key)));
  const bars = grenadeOrBomb ? '' : gunBars(w);
  $('gunForm').innerHTML = `<div class="head"><h2>${esc(w.name)}</h2><small class="hint">slot ${i + 1} of 30 · ${esc(d.categories[w.category])}</small><div class="right"><button id="gunReset" class="danger">Reset to original</button></div></div>
    <div class="fields">${fields.map(field).join('')}</div>
    <div class="stat" id="gunStats">${bars}</div>
    <div class="note"><b>Making a new gun:</b> the game has 30 built-in gun slots and can't load extra ones. To add a gun, take a slot you don't need (SCAR-20, G3SG1 and M249 are good candidates), give it a new name, price and stats. It keeps that slot's 3D model, sound and position in the buy menu.<br><br>
    <b>Unknown A / Unknown B</b> are two values whose exact effect isn't known yet (likely recoil or view-kick related). Change them carefully and test.</div>`;
  $('gunForm').querySelectorAll('[data-k]').forEach((el) => el.oninput = el.onchange = () => {
    const k = el.dataset.k, f = d.weaponFields.find((x) => x.key === k);
    if (k === 'name') w.name = el.value.replace(/[^\x20-\x7e]/g, '').slice(0, 16) || o.name;
    else { let v = parseFloat(el.value); if (!Number.isFinite(v)) return; if (f.type !== 'f32') v = Math.round(v); w[k] = Math.max(0, v); }
    el.closest('.field').classList.toggle('changed', w[k] !== o[k]);
    renderGunList(); changed();
    if (k === 'name') $('gunForm').querySelector('h2').textContent = w.name;
    else if (!grenadeOrBomb) $('gunStats').innerHTML = gunBars(w);
  });
  $('gunReset').onclick = () => { S.work.weapons[i] = clone(o); renderGunList(); renderGunForm(); changed(); };
}

// ================================================================== SKINS
function patternExamples() {
  const ex = {}; S.defs.skins.forEach((s) => (ex[s.pattern] = ex[s.pattern] || []).push(s.name)); return ex;
}
function rng(seed) { let s = seed * 9301 + 49297; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
function drawSkin(c, s) {
  const w = c.width = c.clientWidth * (window.devicePixelRatio || 1) || 300, h = c.height = c.clientHeight * (window.devicePixelRatio || 1) || 100, x = c.getContext('2d');
  const [a, b, d] = s.colors, R = rng(s.index + 7 * s.pattern);
  x.fillStyle = a; x.fillRect(0, 0, w, h);
  switch (s.pattern) {
    case 1: x.fillStyle = b; x.beginPath(); x.moveTo(w * 0.45, 0); x.lineTo(w, 0); x.lineTo(w, h); x.lineTo(w * 0.25, h); x.fill(); break;
    case 2: for (const col of [b, d]) { x.fillStyle = col; for (let k = 0; k < 14; k++) { x.beginPath(); x.ellipse(R() * w, R() * h, 10 + R() * w * 0.1, 6 + R() * h * 0.25, R() * 3, 0, 7); x.fill(); } } break;
    case 3: { const gr = x.createLinearGradient(0, 0, w, h); gr.addColorStop(0, a); gr.addColorStop(1, b); x.fillStyle = gr; x.fillRect(0, 0, w, h); break; }
    case 4: x.fillStyle = b; for (let k = -h; k < w; k += 22) { x.beginPath(); x.moveTo(k, 0); x.lineTo(k + 9, 0); x.lineTo(k + 9 + h * 0.6, h); x.lineTo(k + h * 0.6, h); x.fill(); } break;
    case 5: { const gr = x.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, a); gr.addColorStop(0.45, b); gr.addColorStop(0.55, '#ffffff'); gr.addColorStop(0.65, b); gr.addColorStop(1, a); x.fillStyle = gr; x.fillRect(0, 0, w, h); break; }
    case 6: { const gr = x.createLinearGradient(0, h, w, 0); gr.addColorStop(0, a); gr.addColorStop(0.5, b); gr.addColorStop(1, d); x.fillStyle = gr; x.fillRect(0, 0, w, h); x.strokeStyle = 'rgba(255,255,255,.18)'; for (let k = 0; k < w; k += 14) { x.beginPath(); x.arc(k, h / 2, 12, 0, 7); x.stroke(); } break; }
    case 7: { const gr = x.createLinearGradient(0, 0, w, 0); ['#ff3355', '#ffb000', '#3dff6e', '#2ec5ff', '#8a4dff', '#ff3355'].forEach((cc, k) => gr.addColorStop(k / 5, cc)); x.fillStyle = gr; x.globalAlpha = 0.85; x.fillRect(0, 0, w, h); x.globalAlpha = 1; break; }
    case 8: { const q = Math.max(6, Math.round(h / 8)); for (let yy = 0; yy < h; yy += q) for (let xx = 0; xx < w; xx += q) { const r = R(); if (r < 0.33) { x.fillStyle = b; x.fillRect(xx, yy, q, q); } else if (r < 0.5) { x.fillStyle = d; x.fillRect(xx, yy, q, q); } } break; }
    case 9: x.fillStyle = b; x.fillRect(0, h * 0.62, w, h * 0.12); x.fillRect(w * 0.7, 0, w * 0.06, h); break;
    case 10: { const q = Math.max(8, Math.round(h / 5)); for (let yy = 0; yy < h; yy += q) for (let xx = 0; xx < w; xx += q) if (((xx + yy) / q) % 2 === 0) { x.fillStyle = b; x.fillRect(xx, yy, q, q); } x.fillStyle = d; x.fillRect(0, h - 5, w, 5); break; }
    default: break;
  }
}
function renderSkinGrid() {
  const d = S.defs;
  $('skinGrid').innerHTML = S.work.skins.map((s, i) => {
    const o = d.skins[i], mod = s.name !== o.name || s.rarity !== o.rarity || s.pattern !== o.pattern || s.colors.join() !== o.colors.join();
    return `<button class="skin ${S.sel.skin === i ? 'on' : ''}" data-i="${i}"><canvas></canvas><b>${esc(s.name)}</b><small class="r${s.rarity}">${esc(d.rarities[s.rarity] || '')}</small>${mod ? '<span class="dot"></span>' : ''}</button>`;
  }).join('');
  $('skinGrid').querySelectorAll('.skin').forEach((b) => { drawSkin(b.querySelector('canvas'), S.work.skins[+b.dataset.i]); b.onclick = () => { S.sel.skin = +b.dataset.i; renderSkinGrid(); renderSkinForm(); }; });
}
function renderSkinForm() {
  const i = S.sel.skin, s = S.work.skins[i], o = S.defs.skins[i], d = S.defs, ex = patternExamples();
  const pats = Object.keys(ex).map(Number).sort((a, b) => a - b);
  $('skinForm').innerHTML = `<div class="head"><h2>${esc(s.name)}</h2><small class="hint">skin slot ${i + 1} of 34</small><div class="right"><button id="skinReset" class="danger">Reset to original</button></div></div>
    <canvas id="skinBig"></canvas>
    <div class="fields">
      <div class="field ${s.name !== o.name ? 'changed' : ''}"><label>Name</label><input id="skName" maxlength="20" value="${esc(s.name)}"><span class="def">original: ${esc(o.name)}</span></div>
      <div class="field ${s.rarity !== o.rarity ? 'changed' : ''}"><label>Rarity</label><select id="skRarity">${d.rarities.map((r, k) => `<option value="${k}" ${s.rarity === k ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select><span class="def">original: ${esc(d.rarities[o.rarity])}</span></div>
      <div class="field ${s.pattern !== o.pattern ? 'changed' : ''}"><label>Pattern</label><select id="skPattern">${pats.map((p) => `<option value="${p}" ${s.pattern === p ? 'selected' : ''}>Pattern ${p} (like ${esc(ex[p].slice(0, 2).join(', '))})</option>`).join('')}</select><span class="def">original: pattern ${o.pattern}</span></div>
      ${[0, 1, 2].map((k) => `<div class="field ${s.colors[k] !== o.colors[k] ? 'changed' : ''}"><label>Colour ${k + 1}</label><input type="color" data-c="${k}" value="${s.colors[k]}"><span class="def">original: ${o.colors[k]}</span></div>`).join('')}
    </div>
    <div class="note">Rarity decides which crates can drop the skin and how rare it is. Patterns are the game's own paint styles; the third colour is unused by some patterns.</div>`;
  drawSkin($('skinBig'), s);
  const upd = () => { renderSkinGrid(); drawSkin($('skinBig'), s); $('skinForm').querySelector('h2').textContent = s.name; changed(); };
  $('skName').oninput = () => { s.name = $('skName').value.replace(/[^\x20-\x7e]/g, '').slice(0, 20) || o.name; upd(); };
  $('skRarity').onchange = () => { s.rarity = +$('skRarity').value; upd(); renderSkinForm(); };
  $('skPattern').onchange = () => { s.pattern = +$('skPattern').value; upd(); renderSkinForm(); };
  $('skinForm').querySelectorAll('[data-c]').forEach((el) => el.oninput = () => { s.colors[+el.dataset.c] = el.value; upd(); });
  $('skinReset').onclick = () => { S.work.skins[i] = clone(o); renderSkinGrid(); renderSkinForm(); changed(); };
}

// ================================================================== PUBLISH
function describeChanges(mods) {
  const d = S.defs, out = [];
  for (const m of mods.maps.builtin) out.push(`Map <b>${esc(d.maps[m.index].name)}</b>${m.name ? ` renamed to <b>${esc(m.name)}</b>` : ''}${m.rows ? ' - layout edited' : ''}`);
  for (const m of mods.maps.custom) out.push(`New map <b>${esc(m.name)}</b> in Custom ${m.slot + 1}`);
  for (const w of mods.weapons) { const keys = Object.keys(w).filter((k) => k !== 'index'); out.push(`Gun <b>${esc(d.weapons[w.index].name)}</b>: ${keys.map((k) => `${esc((d.weaponFields.find((f) => f.key === k) || {}).label || k)} → ${esc(fmt(w[k]))}`).join(', ')}`); }
  for (const s of mods.skins) out.push(`Skin <b>${esc(d.skins[s.index].name)}</b>${s.name !== d.skins[s.index].name ? ` → <b>${esc(s.name)}</b>` : ''} edited`);
  return out;
}
function mapErrors(mods) {
  const errs = [];
  for (const m of mods.maps.builtin) if (m.rows) { const c = checkMap(m.rows, S.defs.palette); if (c.errors.length) errs.push(`${m.name || S.defs.maps[m.index].name}: ${c.errors[0]}`); }
  for (const m of mods.maps.custom) { const c = checkMap(m.rows, S.defs.palette); if (c.errors.length) errs.push(`${m.name}: ${c.errors[0]}`); }
  return errs;
}
function renderChanges() {
  const mods = toMods(), list = describeChanges(mods), errs = mapErrors(mods);
  $('changeList').innerHTML = (list.length ? list.map((t) => `<div>${t}</div>`).join('') : '<div class="none">No changes from the original game.</div>')
    + errs.map((e) => `<div class="err" style="margin-top:6px;padding:5px 8px;border-radius:6px">Can't publish: ${esc(e)}</div>`).join('')
    + `<div class="hint" style="margin-top:8px">Live version: ${S.published ? 'v' + (S.published.version || 0) + (S.published.updated ? ', ' + new Date(S.published.updated).toLocaleString() : '') : 'none (original game)'}</div>`;
  $('ghPublish').disabled = errs.length > 0;
}
const ghLog = (t, cls = '') => { $('ghLog').innerHTML = `<div class="${cls}">${t}</div>`; };
function ghSettings() {
  const s = { owner: $('ghOwner').value.trim(), repo: $('ghRepo').value.trim(), branch: $('ghBranch').value.trim() || 'main', token: $('ghToken').value.trim() };
  try {
    localStorage.setItem(GH_KEY, JSON.stringify({ owner: s.owner, repo: s.repo, branch: s.branch, remember: $('ghRemember').checked }));
    if ($('ghRemember').checked) localStorage.setItem(TOKEN_KEY, s.token); else { localStorage.removeItem(TOKEN_KEY); sessionStorage.setItem(TOKEN_KEY, s.token); }
  } catch (_) { }
  return s;
}
function loadGhSettings() {
  let s = {}; try { s = JSON.parse(localStorage.getItem(GH_KEY) || '{}'); } catch (_) { }
  const guess = guessRepo();
  $('ghOwner').value = s.owner || guess.owner || 'MoaiCreator'; $('ghRepo').value = s.repo || guess.repo || 'octo-unblocked'; $('ghBranch').value = s.branch || 'main';
  $('ghRemember').checked = !!s.remember;
  try { $('ghToken').value = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || ''; } catch (_) { }
}
$('ghCheck').onclick = async () => {
  const s = ghSettings(); if (!s.token) return ghLog('Enter a token first.', 'err');
  ghLog('Checking...');
  try { const r = await new GitHub(s).check(); ghLog(r.canPush ? `Token works - you can publish to ${esc(s.owner)}/${esc(s.repo)}.` : 'The token can read the repo but not write to it. Give it "Contents: Read and write".', r.canPush ? 'ok' : 'err'); }
  catch (e) { ghLog(esc(e.message), 'err'); }
};
$('ghLoad').onclick = async () => {
  const s = ghSettings(); ghLog('Loading data/mods.json from GitHub...');
  try {
    const f = await new GitHub(s).getFile('data/mods.json');
    const mods = f ? JSON.parse(f.text) : null;
    if (sig(toMods()) !== sig(toMods(fromMods(S.published))) && !confirm('Replace your unpublished changes with the latest published version?')) return ghLog('Kept your draft.');
    S.published = mods; S.work = fromMods(mods); renderAll(); changed();
    ghLog(mods ? `Loaded v${mods.version || 0} from GitHub.` : 'Nothing published yet - showing the original game.', 'ok');
  } catch (e) { ghLog(esc(e.message), 'err'); }
};
$('ghPublish').onclick = async () => {
  const mods = toMods(), errs = mapErrors(mods);
  if (errs.length) return ghLog('Fix the map problems first:\n' + errs.map(esc).join('\n'), 'err');
  const s = ghSettings(); if (!s.owner || !s.repo || !s.token) return ghLog('Fill in owner, repository and token.', 'err');
  const gh = new GitHub(s);
  $('ghPublish').disabled = true; ghLog('Publishing...');
  try {
    const live = await gh.getFile('data/mods.json'), liveMods = live ? JSON.parse(live.text) : null;
    if (liveMods && S.published && (liveMods.version || 0) > (S.published.version || 0) && !confirm(`Someone published v${liveMods.version} since you loaded this page. Overwrite it with your version?`)) { ghLog('Cancelled. Use "Load latest from GitHub" to see their changes.'); return; }
    mods.version = Math.max((liveMods && liveMods.version) || 0, (S.published && S.published.version) || 0) + 1;
    mods.updated = new Date().toISOString();
    const list = describeChanges(mods);
    const msg = $('ghMsg').value.trim() || `Admin: publish mods v${mods.version}` + (list.length ? ` (${list.length} change${list.length > 1 ? 's' : ''})` : '');
    ghLog('Building the game file...');
    const orig = await fetch('data/openstrike.original.wasm', { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error('Could not load data/openstrike.original.wasm'); return r.arrayBuffer(); });
    const baked = bake(orig, mods, S.defs);
    if (!WebAssembly.validate(baked.wasm)) throw new Error('The built game file is not valid - nothing was published');
    ghLog('Uploading the game file and mods.json...');
    const res = await gh.commitFiles([{ path: 'openstrike.wasm', bytes: baked.wasm }, { path: 'data/mods.json', text: JSON.stringify(mods, null, 1) + '\n' }], msg);
    S.published = mods; localStorage.setItem(DRAFT_KEY, JSON.stringify(mods)); refreshDirty(); renderChanges();
    ghLog(`Published v${mods.version}. <a href="${esc(res.commitUrl || '#')}" target="_blank" rel="noopener">View commit</a> · GitHub Pages updates in about a minute (<a href="https://github.com/${esc(s.owner)}/${esc(s.repo)}/actions" target="_blank" rel="noopener">deploy status</a>).`, 'ok');
    toast('Published v' + mods.version);
  } catch (e) { ghLog(esc(e.message), 'err'); }
  finally { $('ghPublish').disabled = mapErrors(toMods()).length > 0; }
};
$('dlMods').onclick = () => {
  const blob = new Blob([JSON.stringify(toMods(), null, 1) + '\n'], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'mods.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
$('importMods').onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  try { const mods = JSON.parse(await f.text()); S.work = fromMods(mods); renderAll(); changed(); toast('Imported ' + f.name); } catch (err) { toast('Not a valid mods.json: ' + err.message); }
  e.target.value = '';
};
$('discard').onclick = () => {
  if (!confirm('Throw away all unpublished changes?')) return;
  S.work = fromMods(S.published); try { localStorage.removeItem(DRAFT_KEY); } catch (_) { } renderAll(); refreshDirty(); toast('Draft discarded');
};

// ================================================================== boot
function renderAll() {
  if (!curMap()) S.sel = { ...S.sel, kind: 'builtin', i: builtinOrder()[0] };
  renderMapList(); renderPalette(); renderMapSide(); renderGunList(); renderGunForm(); renderSkinGrid(); renderSkinForm(); renderChanges();
  sizeGrid(); drawGrid();
}
async function init() {
  const get = (u) => fetch(u, { cache: 'no-cache' }).then((r) => r.ok ? r.json() : null).catch(() => null);
  const [defs, pub] = await Promise.all([get('data/defaults.json'), get('data/mods.json')]);
  if (!defs) { document.body.innerHTML = '<p style="padding:30px">Could not load data/defaults.json. Open this page through the website (or a local web server), not as a file.</p>'; return; }
  S.defs = defs; S.published = pub; S.sel.i = builtinOrder()[0];
  defs.palette.forEach((p) => tileColor[p.ch] = p.color);
  let draft = null; try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (_) { }
  S.work = fromMods(draft || pub);
  loadGhSettings(); renderAll(); refreshDirty();
  if (draft && sig(draft) !== sig(toMods(fromMods(pub)))) toast('Restored your unpublished draft');
  const t = (location.hash || '').slice(1); if (['maps', 'guns', 'skins', 'publish'].includes(t)) showTab(t);
  window.__admin = S;
}
init();
