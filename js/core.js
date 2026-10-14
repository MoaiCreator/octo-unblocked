// core.js - shared constants, weapon table, map, physics and ray casting. No DOM, no three.js.
export const MAXP = 10;                       // 5v5
export const PR = 0.35, PH = 1.8, EYE = 1.62, STEP = 0.6, GRAV = 20, JUMP = 7, RUN = 6;
export const PI = Math.PI;
export const VERSION = 1;                       // bump when the network protocol or map changes

export const TEAM = { T: 0, CT: 1 };
export const PHASE = { WARMUP: 0, FREEZE: 1, LIVE: 2, ROUNDEND: 3, MATCHEND: 4 };
export const BOMB = { NONE: 0, CARRIED: 1, DROPPED: 2, PLANTED: 3, DEFUSED: 4, EXPLODED: 5 };
export const REASON = { ELIM: 0, BOMB: 1, DEFUSE: 2, TIME: 3 };
export const W = { NONE: 0, KNIFE: 1, GLOCK: 2, USP: 3, DEAGLE: 4, MP9: 5, NOVA: 6, AK47: 7, M4: 8, AWP: 9, C4: 10 };
export const ITEM = { KEVLAR: 40, HELMET: 41, KIT: 42 };

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const rnd = (a, b) => a + Math.random() * (b - a);
export function angleDiff(a, b) { let d = (a - b) % (2 * PI); if (d > PI) d -= 2 * PI; if (d < -PI) d += 2 * PI; return d; }
export function fwdVec(yaw, pitch) { const cp = Math.cos(pitch); return { x: cp * Math.sin(yaw), y: Math.sin(pitch), z: -cp * Math.cos(yaw) }; }

// slot: 1 primary, 2 secondary, 3 knife, 4 bomb. team: -1 both, 0 T, 1 CT.
function wd(id, name, slot, price, team, dmg, interval, mag, reserve, reload, spread, speed, kick, pen, range, head, pellets, auto, reward) {
  return { id, name, slot, price, team, dmg, interval, mag, reserve, reload, spread, speed, kick, pen, range, head, pellets, auto, reward };
}
export const WEAPONS = [
  wd(0, 'None', 0, 0, -1, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, false, 0),
  wd(1, 'Knife', 3, 0, -1, 40, 0.5, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, false, 1500),
  wd(2, 'Glock-18', 2, 0, 0, 30, 0.15, 20, 120, 2.2, 0.006, 1.0, 0.010, 0.47, 0.85, 4, 1, false, 300),
  wd(3, 'USP-S', 2, 0, 1, 35, 0.15, 12, 24, 2.2, 0.005, 1.0, 0.010, 0.50, 0.85, 4, 1, false, 300),
  wd(4, 'Desert Eagle', 2, 700, -1, 53, 0.225, 7, 35, 2.2, 0.004, 0.97, 0.045, 0.93, 0.81, 4, 1, false, 300),
  wd(5, 'MP9', 1, 1250, -1, 26, 0.07, 30, 120, 2.1, 0.012, 0.97, 0.008, 0.60, 0.87, 4, 1, true, 600),
  wd(6, 'Nova', 1, 1050, -1, 26, 0.88, 8, 32, 3.0, 0.045, 0.95, 0.060, 0.50, 0.70, 3, 9, false, 900),
  wd(7, 'AK-47', 1, 2700, 0, 36, 0.10, 30, 90, 2.5, 0.008, 0.92, 0.014, 0.775, 0.98, 4, 1, true, 300),
  wd(8, 'M4A4', 1, 3100, 1, 33, 0.09, 30, 90, 3.1, 0.007, 0.93, 0.012, 0.70, 0.97, 4, 1, true, 300),
  wd(9, 'AWP', 1, 4750, -1, 115, 1.45, 5, 30, 3.6, 0.030, 0.78, 0.050, 0.975, 0.99, 4, 1, false, 100),
  wd(10, 'C4', 4, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, false, 0),
];
export const wdef = (id) => WEAPONS[id] || WEAPONS[0];
export function itemName(id) { return id === ITEM.KEVLAR ? 'Kevlar' : id === ITEM.HELMET ? 'Kevlar + Helmet' : id === ITEM.KIT ? 'Defuse Kit' : wdef(id).name; }
export function itemPrice(id) { return id === ITEM.KEVLAR ? 650 : id === ITEM.HELMET ? 1000 : id === ITEM.KIT ? 400 : wdef(id).price; }
export function itemTeam(id) { return id === ITEM.KIT ? 1 : (id < WEAPONS.length ? wdef(id).team : -1); }

// ------------------------------------------------------------------ map
export function builtinMap() {
  const boxes = [];
  const add = (x0, y0, z0, x1, y1, z1, c) => boxes.push({ x0, y0, z0, x1, y1, z1, c: c || [150, 140, 125] });
  const mir = (x0, y0, z0, x1, y1, z1, c) => { add(x0, y0, z0, x1, y1, z1, c); add(-x1, y0, z0, -x0, y1, z1, c); };
  const WALL = [176, 156, 124], DARK = [130, 118, 100], CRATE = [158, 108, 58], CONC = [128, 128, 132], BLUE = [86, 110, 150];
  // outer walls
  add(-41, 0, -41, 41, 6, -40, DARK); add(-41, 0, 40, 41, 6, 41, DARK);
  add(-41, 0, -40, -40, 6, 40, DARK); add(40, 0, -40, 41, 6, 40, DARK);
  // mid divider (flank lanes stay open) + centre block
  mir(12, 0, -0.6, 30, 3.5, 0.6, WALL);
  add(-3, 0, -2, 3, 2.6, 2, CONC);
  // flank lane walls on the T half
  mir(29.5, 0, 8, 30.5, 3, 28, WALL);
  // T spawn cover and mid cover
  mir(6, 0, 25, 16, 2.6, 26, WALL);
  mir(8, 0, 12, 12, 1.6, 14, CRATE);
  mir(17, 0, 6, 18, 3.2, 14, WALL);
  mir(33, 0, 18, 36, 1.6, 21, CRATE);
  // CT spawn cover and mid cover
  mir(6, 0, -26, 16, 2.6, -25, WALL);
  mir(4, 0, -14, 8, 1.6, -12, CRATE);
  mir(17, 0, -14, 18, 3.2, -6, WALL);
  add(-2, 0, -9, 2, 1.0, -6, BLUE);
  // bomb site cover (A is left, B is right)
  mir(31, 0, -20, 34, 1.6, -17, CRATE);
  mir(36, 0, -14, 38, 2.2, -12, CRATE);
  mir(25, 0, -23, 26, 3, -14, WALL);
  mir(28, 0, -28, 30, 2.2, -26, CRATE);
  const spawns = [[], []];
  for (let i = -2; i <= 2; i++) { spawns[0].push({ x: i * 4, z: 34, yaw: 0 }); spawns[1].push({ x: i * 4, z: -34, yaw: PI }); }
  return {
    name: 'octo_lite', boxes, spawns,
    sites: [{ name: 'A', x0: -38, z0: -24, x1: -26, z1: -12 }, { name: 'B', x0: 26, z0: -24, x1: 38, z1: -12 }],
    bounds: { x0: -39.6, z0: -39.6, x1: 39.6, z1: 39.6 },
    sky: [135, 180, 220], floor: [150, 140, 120],
  };
}
export function siteAt(map, x, z) { for (const s of map.sites) if (x >= s.x0 && x <= s.x1 && z >= s.z0 && z <= s.z1) return s; return null; }

// ------------------------------------------------------------------ physics (body = {x,y,z,vy,grounded})
export function hitsBox(x, y, z, b) {
  return x + PR > b.x0 && x - PR < b.x1 && z + PR > b.z0 && z - PR < b.z1 && y + PH > b.y0 && y < b.y1 - 0.001;
}
export function hitsAny(x, y, z, boxes) { for (let i = 0; i < boxes.length; i++) if (hitsBox(x, y, z, boxes[i])) return true; return false; }
export function moveBody(b, vx, vz, jump, dt, map) {
  const boxes = map.boxes;
  const tryMove = (dx, dz) => {
    const nx = b.x + dx, nz = b.z + dz;
    if (!hitsAny(nx, b.y, nz, boxes)) { b.x = nx; b.z = nz; return; }
    if (b.grounded) for (let s = 0.1; s <= STEP + 1e-4; s += 0.1) {
      if (!hitsAny(nx, b.y + s, nz, boxes)) { b.x = nx; b.y += s; b.z = nz; return; }
    }
  };
  tryMove(vx * dt, 0); tryMove(0, vz * dt);
  const bd = map.bounds; b.x = clamp(b.x, bd.x0, bd.x1); b.z = clamp(b.z, bd.z0, bd.z1);
  if (jump && b.grounded) { b.vy = JUMP; b.grounded = false; }
  b.vy -= GRAV * dt; b.y += b.vy * dt; b.grounded = false;
  if (b.y <= 0) { b.y = 0; b.vy = 0; b.grounded = true; }
  for (const bx of boxes) if (hitsBox(b.x, b.y, b.z, bx)) {
    if (b.vy <= 0) { b.y = bx.y1; b.vy = 0; b.grounded = true; } else { b.y = bx.y0 - PH - 0.001; b.vy = 0; }
  }
}

// ------------------------------------------------------------------ rays
// returns entry distance along d (unit) or -1
export function rayAabb(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let t0 = 0, t1 = 1e9;
  const O = [ox, oy, oz], D = [dx, dy, dz], A = [x0, y0, z0], B = [x1, y1, z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(D[i]) < 1e-8) { if (O[i] < A[i] || O[i] > B[i]) return -1; }
    else {
      let a = (A[i] - O[i]) / D[i], b = (B[i] - O[i]) / D[i];
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) return -1;
    }
  }
  return t0;
}
export function rayWorld(map, o, d, maxT = 200) {
  let best = maxT;
  for (const b of map.boxes) { const t = rayAabb(o.x, o.y, o.z, d.x, d.y, d.z, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1); if (t >= 0 && t < best) best = t; }
  if (d.y < -1e-6) { const t = -o.y / d.y; if (t > 0 && t < best) best = t; }
  return best;
}
