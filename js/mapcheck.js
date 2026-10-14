// mapcheck.js - validates an OpenStrike grid map (40 rows x 48 columns) the same way the game does.
// Walkability was measured against the game's own "playable" check:
//   walkable: . T S A B u (tunnel) L (ladder) P (platform, only reachable from a ladder or another platform)
//   blocking: # p c C k o h
export const ROWS = 40, COLS = 48;
const WALK = new Set(['.', 'T', 'S', 'A', 'B', 'u', 'L', 'P']);

export function emptyMap() {
  const rows = [];
  for (let r = 0; r < ROWS; r++) rows.push(r === 0 || r === ROWS - 1 ? '#'.repeat(COLS) : '#' + '.'.repeat(COLS - 2) + '#');
  return rows;
}
export function isGrid(rows) { return Array.isArray(rows) && rows.length === ROWS && rows.every(r => typeof r === 'string' && r.length === COLS); }

function canStep(a, b) {
  if (!WALK.has(a) || !WALK.has(b)) return false;
  if (a === 'P' && b !== 'P' && b !== 'L') return false;
  if (b === 'P' && a !== 'P' && a !== 'L') return false;
  return true;
}
function flood(rows, starts) {
  const seen = new Uint8Array(ROWS * COLS), q = [];
  for (const [r, c] of starts) { seen[r * COLS + c] = 1; q.push([r, c]); }
  while (q.length) {
    const [r, c] = q.pop(), a = rows[r][c];
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nr = r + dr, nc = c + dc; if (nr < 0 || nc < 0 || nr >= ROWS || nc >= COLS) continue;
      const k = nr * COLS + nc; if (seen[k] || !canStep(a, rows[nr][nc])) continue;
      seen[k] = 1; q.push([nr, nc]);
    }
  }
  return seen;
}

export function checkMap(rows, palette = null) {
  const errors = [], warnings = [], count = {};
  if (!isGrid(rows)) return { errors: ['The map must be 40 rows of 48 cells'], warnings, count };
  const valid = palette ? new Set(palette.map(p => p.ch)) : null;
  const cells = { T: [], S: [], A: [], B: [] };
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const ch = rows[r][c]; count[ch] = (count[ch] || 0) + 1;
    if (valid && !valid.has(ch)) { errors.push(`Unknown tile "${ch}" at row ${r + 1}, column ${c + 1}`); continue; }
    if (cells[ch]) cells[ch].push([r, c]);
    if ((r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1) && ch !== '#') warnings.push(`Edge cell at row ${r + 1}, column ${c + 1} is not a wall - players could leave the map`);
  }
  if (!cells.T.length) errors.push('Add at least one T spawn');
  if (!cells.S.length) errors.push('Add at least one CT spawn');
  if (!cells.A.length) errors.push('Add site A');
  if (!cells.B.length) errors.push('Add site B');
  if (cells.T.length) {
    const seen = flood(rows, cells.T), hit = (list) => list.some(([r, c]) => seen[r * COLS + c]);
    if (cells.A.length && !hit(cells.A)) errors.push("Site A can't be reached from the T spawn");
    if (cells.B.length && !hit(cells.B)) errors.push("Site B can't be reached from the T spawn");
    if (cells.S.length && !hit(cells.S)) errors.push("A CT spawn can't be reached from the T spawn");
  }
  if (cells.T.length && cells.T.length < 5) warnings.push(`Only ${cells.T.length} T spawn tile(s) - 5 players share them`);
  if (cells.S.length && cells.S.length < 5) warnings.push(`Only ${cells.S.length} CT spawn tile(s) - 5 players share them`);
  if (warnings.length > 6) warnings.splice(6, warnings.length - 6, `...and more edge warnings`);
  return { errors, warnings, count };
}
