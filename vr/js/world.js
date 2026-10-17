// world.js - turns an OpenStrike grid map (40 rows x 48 tiles) into a 3D world for the VR mode:
// collision boxes for the sim/bots, plus a list of visual pieces for the renderer. No DOM / three.js.
//
// Tiles: # wall  . floor  c crate  C big crate  p pillar  u tunnel (roofed floor)  T/S spawns  A/B sites
//        P platform (raised floor)  L ladder (stairs up to a platform)  o barrels  h sandbags  k box stack
import { PI } from './core.js';

export const TILE = 1.5;                    // metres per grid tile
const ROWS = 40, COLS = 48;
const H = { wall: 4.2, crate: 1.0, big: 1.5, pillar: 4.2, stack: 2.3, barrel: 1.1, sandbag: 0.95, platform: 1.5, roof0: 2.75, roof1: 3.2 };

export function gridToWorld(rows, { name = 'map' } = {}) {
  const at = (r, c) => (r < 0 || c < 0 || r >= ROWS || c >= COLS ? '#' : rows[r][c]);
  const x0 = -COLS / 2 * TILE, z0 = -ROWS / 2 * TILE;
  const cx = (c) => x0 + (c + 0.5) * TILE, cz = (r) => z0 + (r + 0.5) * TILE;
  const boxes = [], parts = [];
  const box = (bx0, by0, bz0, bx1, by1, bz1, kind, extra) => { const b = { x0: bx0, y0: by0, z0: bz0, x1: bx1, y1: by1, z1: bz1, kind, ...extra }; boxes.push(b); parts.push(b); return b; };

  // merge runs of the same full-tile kind into big rectangles (fewer boxes = faster collision and rendering)
  const merge = (pred, emit) => {
    const used = new Uint8Array(ROWS * COLS);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (used[r * COLS + c] || !pred(at(r, c))) continue;
      let c1 = c; while (c1 + 1 < COLS && !used[r * COLS + c1 + 1] && pred(at(r, c1 + 1))) c1++;
      let r1 = r; for (;;) { if (r1 + 1 >= ROWS) break; let ok = true; for (let k = c; k <= c1; k++) if (used[(r1 + 1) * COLS + k] || !pred(at(r1 + 1, k))) { ok = false; break; } if (!ok) break; r1++; }
      for (let rr = r; rr <= r1; rr++) for (let k = c; k <= c1; k++) used[rr * COLS + k] = 1;
      emit(x0 + c * TILE, z0 + r * TILE, x0 + (c1 + 1) * TILE, z0 + (r1 + 1) * TILE, r, c, r1, c1);
    }
  };
  let wallN = 0;
  merge((t) => t === '#', (a, b, c, d) => box(a, 0, b, c, H.wall, d, 'wall', { skin: (wallN++ % 3 === 0) ? 'plaster' : 'brick' }));
  merge((t) => t === 'P', (a, b, c, d) => box(a, 0, b, c, H.platform, d, 'platform'));
  merge((t) => t === 'h', (a, b, c, d) => box(a, 0, b, c, H.sandbag, d, 'sandbags'));
  merge((t) => t === 'u', (a, b, c, d) => box(a, H.roof0, b, c, H.roof1, d, 'roof'));
  merge((t) => t === 'C', (a, b, c, d) => box(a, 0, b, c, H.big, d, 'bigcrate'));

  let barrelN = 0;
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const t = at(r, c), x = cx(c), z = cz(r), h = TILE / 2;
    if (t === 'c') { const s = TILE * 0.38; box(x - s, 0, z - s, x + s, H.crate, z + s, 'crate'); }
    else if (t === 'p') { const s = TILE * 0.22; box(x - s, 0, z - s, x + s, H.pillar, z + s, 'pillar'); }
    else if (t === 'k') { const s = TILE * 0.42; box(x - s, 0, z - s, x + s, H.stack * 0.5, z + s, 'crate'); const s2 = TILE * 0.32; box(x - s2, H.stack * 0.5, z - s2, x + s2, H.stack, z + s2, 'crate'); }
    else if (t === 'o') {                                    // two drums per tile, one collision box
      const s = TILE * 0.36; boxes.push({ x0: x - s, y0: 0, z0: z - s, x1: x + s, y1: H.barrel, z1: z + s, kind: 'barrelbox' });
      parts.push({ kind: 'barrel', x: x - TILE * 0.17, z: z - TILE * 0.12, r: TILE * 0.18, h: H.barrel, color: barrelN++ % 4 });
      parts.push({ kind: 'barrel', x: x + TILE * 0.18, z: z + TILE * 0.14, r: TILE * 0.18, h: H.barrel, color: barrelN++ % 4 });
    } else if (t === 'L') {                                  // stairs rising towards the neighbouring platform
      const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]].filter(([dr, dc]) => at(r + dr, c + dc) === 'P');
      if (dirs.length) {
        const [dr, dc] = dirs[0];
        for (let k = 0; k < 3; k++) {
          const y1 = (k + 1) * (H.platform / 3), f0 = -h + k * (TILE / 3), f1 = -h + (k + 1) * (TILE / 3);
          let a, b, c2, d;
          if (dc) { a = dc > 0 ? x + f0 : x - f1; c2 = dc > 0 ? x + f1 : x - f0; b = z - h; d = z + h; }
          else { b = dr > 0 ? z + f0 : z - f1; d = dr > 0 ? z + f1 : z - f0; a = x - h; c2 = x + h; }
          box(a, 0, b, c2, y1, d, 'step');
        }
      }
    }
  }

  // spawns: up to 5 well spread tiles per team, facing the middle of the map
  const tiles = (ch) => { const out = []; for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (at(r, c) === ch) out.push([r, c]); return out; };
  const spread = (list, n) => {
    if (!list.length) return [];
    const pick = [list[Math.floor(list.length / 2)]];
    while (pick.length < Math.min(n, list.length)) {
      let best = null, bd = -1;
      for (const t of list) { const d = Math.min(...pick.map((p) => Math.hypot(p[0] - t[0], p[1] - t[1]))); if (d > bd) { bd = d; best = t; } }
      pick.push(best);
    }
    return pick.map(([r, c]) => { const x = cx(c), z = cz(r); return { x, z, yaw: Math.atan2(-x, z) }; });
  };
  const spawns = [spread(tiles('T'), 5), spread(tiles('S'), 5)];
  const rect = (ch, name) => {
    const t = tiles(ch); if (!t.length) return null;
    const r0 = Math.min(...t.map((a) => a[0])), r1 = Math.max(...t.map((a) => a[0])), c0 = Math.min(...t.map((a) => a[1])), c1 = Math.max(...t.map((a) => a[1]));
    return { name, x0: x0 + c0 * TILE, z0: z0 + r0 * TILE, x1: x0 + (c1 + 1) * TILE, z1: z0 + (r1 + 1) * TILE };
  };
  const sites = [rect('A', 'A'), rect('B', 'B')].filter(Boolean);
  for (const s of sites) parts.push({ kind: 'site', ...s });
  return {
    name, boxes, parts, spawns, sites,
    bounds: { x0: x0 + 0.4, z0: z0 + 0.4, x1: -x0 - 0.4, z1: -z0 - 0.4 },
    size: { w: COLS * TILE, d: ROWS * TILE }, sky: [150, 190, 225], floor: [150, 140, 125],
  };
}
