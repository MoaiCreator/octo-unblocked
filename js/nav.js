// nav.js - 2.5D navigation grid (0.5 m cells) with A*, used by bots and by map validation.
// Each cell stores the height a player would stand at (highest supporting box under its footprint).
// A move between cells is allowed when it climbs at most STEP (stairs) - any drop is allowed.
import { STEP, PH, PR } from './core.js';

const UP = STEP + 0.05;

export class NavGrid {
  constructor(map, { cell = 0.5, radius = PR + 0.05 } = {}) {
    const bd = map.bounds, cs = cell;
    this.cs = cs; this.x0 = Math.floor(bd.x0); this.z0 = Math.floor(bd.z0);
    this.w = Math.max(1, Math.ceil((bd.x1 - this.x0) / cs)); this.h = Math.max(1, Math.ceil((bd.z1 - this.z0) / cs));
    const N = this.w * this.h;
    this.hgt = new Float32Array(N); this.stand = new Uint8Array(N); this.ok = new Uint8Array(N);
    // bucket boxes into the cells their (inflated) footprint touches
    const lists = new Array(N);
    map.boxes.forEach((b, bi) => {
      const i0 = Math.max(0, Math.floor((b.x0 - radius - this.x0) / cs)), i1 = Math.min(this.w - 1, Math.floor((b.x1 + radius - this.x0) / cs));
      const j0 = Math.max(0, Math.floor((b.z0 - radius - this.z0) / cs)), j1 = Math.min(this.h - 1, Math.floor((b.z1 + radius - this.z0) / cs));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = this.x0 + (i + 0.5) * cs, z = this.z0 + (j + 0.5) * cs;
        if (x + radius <= b.x0 || x - radius >= b.x1 || z + radius <= b.z0 || z - radius >= b.z1) continue;
        const k = j * this.w + i; (lists[k] || (lists[k] = [])).push(bi);
      }
    });
    for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
      const k = j * this.w + i, x = this.x0 + (i + 0.5) * cs, z = this.z0 + (j + 0.5) * cs;
      if (x - PR < bd.x0 || x + PR > bd.x1 || z - PR < bd.z0 || z + PR > bd.z1) continue;
      let H = 0, blocked = false; const L = lists[k];
      if (L) {
        const bs = L.map(n => map.boxes[n]).sort((a, b) => a.y0 - b.y0);
        for (const b of bs) if (b.y0 <= H + 0.05) H = Math.max(H, b.y1);       // stacked/supporting boxes
        for (const b of bs) if (b.y0 > H + 0.05 && b.y0 < H + PH) { blocked = true; break; }   // no headroom
      }
      this.hgt[k] = H; this.stand[k] = blocked || H > 40 ? 0 : 1;
    }
    // walkable = standable and reachable from any spawn
    const starts = [...(map.spawns[0] || []), ...(map.spawns[1] || [])];
    this.ok = this.flood(starts);
    this.open = new Float32Array(N); this.came = new Int32Array(N); this.stamp = new Uint32Array(N); this.cur = 0;
  }
  idx(x, z) { const i = Math.floor((x - this.x0) / this.cs), j = Math.floor((z - this.z0) / this.cs); return i < 0 || j < 0 || i >= this.w || j >= this.h ? -1 : j * this.w + i; }
  center(k) { return { x: this.x0 + ((k % this.w) + 0.5) * this.cs, z: this.z0 + (((k / this.w) | 0) + 0.5) * this.cs }; }
  heightAt(x, z) { const k = this.idx(x, z); return k < 0 ? 0 : this.hgt[k]; }
  canStep(a, b) { return this.hgt[b] - this.hgt[a] <= UP; }
  // directed neighbour test incl. no corner cutting
  passable(mask, a, di, dj) {
    const W = this.w, ai = a % W, aj = (a / W) | 0, ni = ai + di, nj = aj + dj;
    if (ni < 0 || nj < 0 || ni >= W || nj >= this.h) return -1;
    const n = nj * W + ni; if (!mask[n] || !this.canStep(a, n)) return -1;
    if (di && dj) { const s1 = aj * W + ni, s2 = nj * W + ai; if (!mask[s1] || !mask[s2] || !this.canStep(a, s1) || !this.canStep(a, s2)) return -1; }
    return n;
  }
  standNear(x, z, maxM = 1.5) {                                   // nearest standable cell to a point (for spawns)
    const k = this.idx(x, z); if (k >= 0 && this.stand[k]) return k;
    const r = Math.ceil(maxM / this.cs), [ci, cj] = [Math.floor((x - this.x0) / this.cs), Math.floor((z - this.z0) / this.cs)];
    let best = -1, bd = 1e9;
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      const n = j * this.w + i; if (!this.stand[n]) continue; const d = di * di + dj * dj; if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  flood(starts) {
    const N = this.w * this.h, seen = new Uint8Array(N), q = new Int32Array(N); let qh = 0, qt = 0;
    for (const s of starts) { const k = this.standNear(s.x, s.z); if (k >= 0 && !seen[k]) { seen[k] = 1; q[qt++] = k; } }
    while (qh < qt) {
      const a = q[qh++];
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue; const n = this.passable(this.stand, a, di, dj);
        if (n >= 0 && !seen[n]) { seen[n] = 1; q[qt++] = n; }
      }
    }
    return seen;
  }
  walkable(x, z) { const k = this.idx(x, z); return k >= 0 && this.ok[k] === 1; }
  nearest(x, z, maxM = 4) {
    const k0 = this.idx(x, z); if (k0 >= 0 && this.ok[k0]) return k0;
    const ci = Math.floor((x - this.x0) / this.cs), cj = Math.floor((z - this.z0) / this.cs), R = Math.ceil(maxM / this.cs);
    for (let r = 1; r <= R; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = ci + di, j = cj + dj; if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
      const n = j * this.w + i; if (this.ok[n]) return n;
    }
    return -1;
  }
  randomIn(r) {
    for (let t = 0; t < 40; t++) {
      const x = r.x0 + Math.random() * (r.x1 - r.x0), z = r.z0 + Math.random() * (r.z1 - r.z0);
      if (this.walkable(x, z)) return { x, z };
    }
    const n = this.nearest((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, 12);
    return n >= 0 ? this.center(n) : { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
  }
  los(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz), n = Math.max(1, Math.ceil(d / (this.cs * 0.5)));
    let prev = this.idx(ax, az); if (prev < 0 || !this.ok[prev]) return false;
    for (let s = 1; s <= n; s++) {
      const k = this.idx(ax + dx * s / n, az + dz * s / n);
      if (k < 0 || !this.ok[k]) return false;
      if (k !== prev) { if (!this.canStep(prev, k)) return false; prev = k; }
    }
    return true;
  }
  findPath(sx, sz, gx, gz) {
    const start = this.nearest(sx, sz, 3), goal = this.nearest(gx, gz, 6);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: gx, z: gz }];
    const W = this.w, id = ++this.cur, gs = this.open, came = this.came, st = this.stamp, cs = this.cs;
    const gi = goal % W, gj = (goal / W) | 0;
    const heap = [];
    const push = (f, i) => { heap.push([f, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
    const hfn = (i) => { const dx = Math.abs((i % W) - gi), dz = Math.abs(((i / W) | 0) - gj); return (Math.max(dx, dz) + 0.414 * Math.min(dx, dz)) * cs; };
    st[start] = id; gs[start] = 0; came[start] = -1; push(hfn(start), start);
    const closed = new Set(); let found = false, iters = 0;
    while (heap.length && iters++ < 60000) {
      const [, cur] = pop();
      if (closed.has(cur)) continue; closed.add(cur);
      if (cur === goal) { found = true; break; }
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const n = this.passable(this.ok, cur, di, dj); if (n < 0) continue;
        const cost = gs[cur] + (di && dj ? 1.414 : 1) * cs;
        if (st[n] !== id || cost < gs[n]) { st[n] = id; gs[n] = cost; came[n] = cur; push(cost + hfn(n), n); }
      }
    }
    if (!found) return null;
    const pts = []; for (let c = goal; c !== -1; c = came[c]) pts.push(this.center(c));
    pts.reverse();
    const out = []; let i = 0, from = { x: sx, z: sz };            // string pulling
    if (!this.los(from.x, from.z, pts[0].x, pts[0].z)) from = pts[0];
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.los(from.x, from.z, pts[j].x, pts[j].z)) j--;
      out.push(pts[j]); from = pts[j]; i = j + 1;
    }
    return out;
  }
}
