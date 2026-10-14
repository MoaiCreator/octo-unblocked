// bots.js - bot AI: perception, aiming, shooting, navigation, bomb duties, buying
import { PHASE, BOMB, TEAM, W, ITEM, WEAPONS, PH, EYE, RUN, PI, fwdVec, rayWorld, angleDiff, moveBody, siteAt, rnd, clamp } from './core.js';

const SKILL = {
  easy:   { react: 0.65, spread: 0.050, turn: 4.5, head: 0.05 },
  normal: { react: 0.40, spread: 0.028, turn: 7.5, head: 0.15 },
  hard:   { react: 0.22, spread: 0.016, turn: 11,  head: 0.30 },
};

export function newBotState() {
  return { path: null, pi: 0, goal: null, goalT: 0, target: -1, react: 0, lastSeen: null, lastSeenT: -99, visT: 0, strafe: 1, strafeT: 0,
    stuckT: 0, lx: 0, lz: 0, chkT: 0, burst: 0, pause: 0, spot: null, spotT: 0, aimHead: false, side: 0, sideT: 0, role: 'mid', spotRound: -1 };
}

function guardRects(sim) {
  const m = sim.map, g = {};
  for (const s of m.sites) g[s.name] = { x0: s.x0 - 4, z0: s.z0 - 2, x1: s.x1 + 4, z1: s.z1 + 6 };
  g.mid = { x0: -9, z0: -13, x1: 9, z1: -5 };
  return g;
}

export function botRoundStart(sim, p) {
  const b = p.bot; b.path = null; b.goal = null; b.target = -1; b.lastSeen = null; b.lastSeenT = -99; b.spot = null; b.burst = 0; b.pause = 0;
  const names = sim.map.sites.map(s => s.name);
  if (p.team === TEAM.T) {
    b.role = Math.random() < 0.75 ? sim.planSite : names[(names.indexOf(sim.planSite) + 1) % names.length];
  } else {
    const r = Math.random(); b.role = r < 0.4 ? names[0] : r < 0.8 ? names[names.length - 1] : 'mid';
  }
}

export function botBuy(sim, p) {
  const t = p.team, rifle = t === TEAM.T ? W.AK47 : W.M4, m = () => p.money;
  const buy = (it) => sim.buy(p.id, it);
  if (m() >= 5400 && Math.random() < 0.15 && !sim.hasAwp(t)) buy(W.AWP);
  if (m() >= 3100 + 1000) { buy(rifle); buy(ITEM.HELMET); if (t === TEAM.CT) buy(ITEM.KIT); }
  else if (m() >= (t === TEAM.T ? 2700 : 3100) + 650) { buy(rifle); buy(ITEM.KEVLAR); }
  else if (m() >= (t === TEAM.T ? 2700 : 3100)) buy(rifle);
  else if (m() >= 1900) { buy(W.MP9); buy(ITEM.KEVLAR); }
  else if (m() >= 1300) { buy(W.MP9); }
  else if (m() >= 1000) { buy(W.DEAGLE); }
  else if (m() >= 650 && Math.random() < 0.5) buy(ITEM.KEVLAR);
  if (t === TEAM.CT && !p.kit && m() >= 400 && Math.random() < 0.6) buy(ITEM.KIT);
}

function perceive(sim, p, b, sk) {
  const o = { x: p.x, y: p.y + EYE, z: p.z };
  let best = -1, bd = 1e9;
  for (const e of sim.players) {
    if (!e.used || !e.alive || e.team === p.team) continue;
    const dx = e.x - p.x, dz = e.z - p.z, dist = Math.hypot(dx, dz);
    if (dist > 70) continue;
    const ang = Math.abs(angleDiff(Math.atan2(dx, -dz), p.yaw));
    if (ang > 1.8 && dist > 7) {                                     // behind: only by sound
      if (sim.t - e.lastShot < 0.6 && dist < 35) { b.lastSeen = { x: e.x, z: e.z }; b.lastSeenT = sim.t; }
      continue;
    }
    const cy = e.y + 1.2, dy = cy - o.y, d3 = Math.hypot(dist, dy);
    const dir = { x: dx / d3, y: dy / d3, z: dz / d3 };
    if (rayWorld(sim.map, o, dir, d3) >= d3 - 0.4 && dist < bd) { bd = dist; best = e.id; }
    else if (sim.t - e.lastShot < 0.7 && dist < 40) { b.lastSeen = { x: e.x, z: e.z }; b.lastSeenT = sim.t; }
  }
  if (best >= 0) {
    if (b.target !== best) { b.react = sk.react * rnd(0.7, 1.3); b.aimHead = Math.random() < sk.head; b.burst = 0; }
    b.target = best; const e = sim.players[best]; b.lastSeen = { x: e.x, z: e.z }; b.lastSeenT = sim.t;
  } else b.target = -1;
}

function goalFor(sim, p, b) {
  const bomb = sim.bomb, map = sim.map;
  if (p.team === TEAM.T) {
    if (p.hasBomb) {
      const s = map.sites.find(s => s.name === b.role) || map.sites[0];
      if (!b.spot) b.spot = { x: (s.x0 + s.x1) / 2 + rnd(-2, 2), z: (s.z0 + s.z1) / 2 + rnd(-2, 2) };
      return { x: b.spot.x, z: b.spot.z, kind: 'plant' };
    }
    if (bomb.state === BOMB.DROPPED && sim.nearestAlive(TEAM.T, bomb.x, bomb.z, true) === p.id) return { x: bomb.x, z: bomb.z, kind: 'fetch' };
    if (bomb.state === BOMB.PLANTED) return guardSpot(sim, p, b, bomb, 6, 14);
  } else {
    if (bomb.state === BOMB.PLANTED) {
      if (sim.defuserId === p.id) return { x: bomb.x, z: bomb.z, kind: 'defuse' };
      return guardSpot(sim, p, b, bomb, 4, 11);
    }
  }
  // default: hold a spot in the role area, re-rolled now and then
  const rects = guardRects(sim);
  if (!b.spot || sim.t > b.spotT) {
    let r = rects[b.role] || rects.mid;
    if (p.team === TEAM.T && !b.reached) r = { x0: r.x0 + 2, z0: r.z0 + 2, x1: r.x1 - 2, z1: r.z1 - 2 };
    b.spot = sim.nav.randomIn(r); b.spotT = sim.t + (p.team === TEAM.T ? rnd(20, 35) : rnd(10, 22));
  }
  return { x: b.spot.x, z: b.spot.z, kind: 'hold' };
}
function guardSpot(sim, p, b, bomb, rmin, rmax) {
  if (b.spotRound !== sim.bomb.plantSeq || !b.spot) {
    b.spotRound = sim.bomb.plantSeq;
    for (let k = 0; k < 12; k++) {
      const a = rnd(0, 2 * PI), r = rnd(rmin, rmax), x = bomb.x + Math.cos(a) * r, z = bomb.z + Math.sin(a) * r;
      if (!sim.nav.walkable(x, z)) continue;
      const o = { x, y: 1.4, z }, d = { x: bomb.x - x, y: -0.2, z: bomb.z - z }, L = Math.hypot(d.x, d.y, d.z);
      d.x /= L; d.y /= L; d.z /= L;
      if (rayWorld(sim.map, o, d, L) >= L - 0.4) { b.spot = { x, z }; break; }
      b.spot = { x, z };
    }
  }
  return { x: b.spot.x, z: b.spot.z, kind: 'guard' };
}

function steerTo(sim, p, b, gx, gz, dt) {
  const goalMoved = !b.goal || Math.hypot(b.goal.x - gx, b.goal.z - gz) > 2.0;
  b.goalT -= dt;
  if (goalMoved || (!b.path && b.goalT <= 0) || b.stuckT > 0.55) {
    b.path = sim.nav.findPath(p.x, p.z, gx, gz); b.pi = 0; b.goal = { x: gx, z: gz }; b.goalT = 0.6; b.stuckT = 0;
  }
  if (!b.path || b.pi >= b.path.length) return null;
  let wp = b.path[b.pi];
  while (Math.hypot(wp.x - p.x, wp.z - p.z) < 0.7 && b.pi < b.path.length - 1) wp = b.path[++b.pi];
  const dx = wp.x - p.x, dz = wp.z - p.z, d = Math.hypot(dx, dz);
  if (b.pi >= b.path.length - 1 && d < 0.6) return null;
  return { x: dx / d, z: dz / d, dist: d };
}

export function updateBot(sim, p, dt) {
  const b = p.bot, sk = SKILL[sim.skill] || SKILL.normal, map = sim.map;
  p.useHeld = false;
  if (!p.alive) return;
  if (sim.phase === PHASE.FREEZE || sim.phase === PHASE.MATCHEND) return;
  const w = WEAPONS[p.cur];

  b.visT -= dt; if (b.visT <= 0) { b.visT = 0.12 + Math.random() * 0.06; perceive(sim, p, b, sk); }
  const tgt = b.target >= 0 ? sim.players[b.target] : null;
  const seeing = !!(tgt && tgt.used && tgt.alive);
  if (!seeing) b.target = -1;
  if (w.slot === 3 && (p.pri || p.sec)) sim.switchSlot(p.id, p.pri ? 1 : 2);

  // ---- duties
  const goal = goalFor(sim, p, b);
  const bomb = sim.bomb;
  let hold = false;                                                       // stand still (planting/defusing)
  const dist = seeing ? Math.hypot(tgt.x - p.x, tgt.z - p.z) : 999;
  if (goal.kind === 'plant' && siteAt(map, p.x, p.z) && !(seeing && dist < 18)) { p.useHeld = true; hold = true; }
  if (goal.kind === 'defuse' && Math.hypot(bomb.x - p.x, bomb.z - p.z) < 1.5 && !(seeing && dist < 10)) { p.useHeld = true; hold = true; }

  // ---- movement
  let mx = 0, mz = 0, speed = RUN * w.speed, jump = false;
  const nav = steerTo(sim, p, b, goal.x, goal.z, dt);
  let wantMove = !hold;
  if (seeing && !hold) {
    const dx = tgt.x - p.x, dz = tgt.z - p.z, d = Math.max(0.01, dist);
    b.strafeT -= dt; if (b.strafeT <= 0) { b.strafe = Math.random() < 0.5 ? -1 : 1; b.strafeT = rnd(0.4, 1.1); }
    if (goal.kind === 'plant' || goal.kind === 'defuse' || dist > 28) { if (nav) { mx = nav.x; mz = nav.z; speed *= dist < 28 ? 0.5 : 0.8; } }
    else { mx = (-dz / d) * b.strafe; mz = (dx / d) * b.strafe; speed *= 0.35; }
  } else if (nav && wantMove) {
    mx = nav.x; mz = nav.z;
    if (!seeing && b.lastSeen && sim.t - b.lastSeenT < 3.5 && goal.kind === 'hold') speed *= 0.7;
  } else if (!seeing && b.lastSeen && sim.t - b.lastSeenT < 3.5 && !hold && goal.kind === 'hold') {
    const n2 = steerTo(sim, p, b, b.lastSeen.x, b.lastSeen.z, dt); if (n2) { mx = n2.x; mz = n2.z; speed *= 0.6; }
  }
  // separation from teammates
  if (!hold) for (const q of sim.players) {
    if (q === p || !q.used || !q.alive || q.team !== p.team) continue;
    const dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz);
    if (d < 1.1 && d > 0.001) { mx += (dx / d) * 0.6; mz += (dz / d) * 0.6; }
  }
  const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
  // stuck detection
  b.chkT -= dt;
  if (b.chkT <= 0) {
    b.chkT = 0.5;
    if (ml > 0.3 && Math.hypot(p.x - b.lx, p.z - b.lz) < 0.18) { b.stuckT += 0.5; jump = true; b.side = Math.random() < 0.5 ? -1 : 1; b.sideT = 0.6; }
    else b.stuckT = Math.max(0, b.stuckT - 0.5);
    b.lx = p.x; b.lz = p.z;
  }
  if (b.sideT > 0) { b.sideT -= dt; mx += -mz * b.side * 0.8; mz += mx * b.side * 0.8; }
  moveBody(p, mx * speed, mz * speed, jump, dt, map);

  // ---- aim
  let wantYaw = p.yaw, wantPitch = 0, turn = 8;
  if (seeing) {
    const dx = tgt.x - p.x, dz = tgt.z - p.z, ty = tgt.y + (b.aimHead ? 1.55 : 1.15), dy = ty - (p.y + EYE);
    wantYaw = Math.atan2(dx, -dz); wantPitch = Math.atan2(dy, Math.hypot(dx, dz)); turn = sk.turn;
  } else if (ml > 0.2) wantYaw = Math.atan2(mx, -mz);
  else if (b.lastSeen && sim.t - b.lastSeenT < 3) wantYaw = Math.atan2(b.lastSeen.x - p.x, -(b.lastSeen.z - p.z));
  const dyaw = angleDiff(wantYaw, p.yaw), dpit = wantPitch - p.pitch, maxT = turn * dt;
  p.yaw += clamp(dyaw, -maxT, maxT); p.pitch += clamp(dpit, -maxT, maxT);

  // ---- shoot / reload
  if (seeing) b.react -= dt;
  const err = Math.abs(angleDiff(wantYaw, p.yaw)) + Math.abs(wantPitch - p.pitch);
  if (seeing && b.react <= 0 && err < 0.05 + 0.5 / Math.max(5, dist) && !p.reloading && sim.phase === PHASE.LIVE) {
    const auto = w.auto;
    if (auto) { b.pause -= dt; if (b.burst <= 0 && b.pause <= 0) b.burst = Math.floor(dist > 15 ? rnd(3, 7) : rnd(6, 14)); }
    if (!auto || b.burst > 0) {
      const moving = ml > 0.1 && speed > 2.5 ? 1.8 : 1, sp = sk.spread * (0.6 + dist / 30) * moving + w.spread * 0.5;
      const dir = fwdVec(p.yaw + rnd(-1, 1) * sp, p.pitch + rnd(-1, 1) * sp);
      if (sim.shoot(p.id, dir)) { if (auto) { b.burst--; if (b.burst <= 0) b.pause = rnd(0.12, 0.4); } }
    }
  }
  if (!p.reloading && w.mag > 0 && (p.mag[p.cur] === 0 || (!seeing && p.mag[p.cur] < w.mag * 0.4))) sim.startReload(p);
}
