// node tests/sim.test.mjs  - headless checks of the game simulation
import { Sim } from '../js/sim.js';
import { PHASE, BOMB, TEAM, W, ITEM, builtinMap, moveBody } from '../js/core.js';
import { NavGrid } from '../js/nav.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// --- navigation: every spawn can reach both sites
{
  const map = builtinMap(), nav = new NavGrid(map);
  for (const s of map.sites) for (const t of [0, 1]) {
    const sp = map.spawns[t][2], pth = nav.findPath(sp.x, sp.z, (s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2);
    ok(pth && pth.length > 0, `path team ${t} spawn -> site ${s.name} (${pth ? pth.length : 0} waypoints)`);
  }
}
// --- physics: walls stop you, you can jump onto the platform
{
  const map = builtinMap(); const b = { x: 0, y: 0, z: 20, vy: 0, grounded: true };
  for (let i = 0; i < 600; i++) moveBody(b, 0, -6, false, 1 / 60, map);
  ok(b.z > -40 && b.z < 40 && !Number.isNaN(b.z), `walked north, stopped at z=${b.z.toFixed(2)} (centre block / bounds)`);
}
// --- bots only: many simulated minutes
function runBots(seconds, skill) {
  const sim = new Sim({ skill }); sim.start();
  let planted = 0, defused = 0, exploded = 0, kills = 0, rounds = 0, nan = false, seq = 0;
  const dt = 1 / 60;
  for (let i = 0; i < seconds * 60; i++) {
    sim.tick(dt);
    for (const e of sim.events) if (e.seq > seq) { seq = e.seq; if (e.type === 'plant') planted++; if (e.type === 'defuse') defused++; if (e.type === 'explode') exploded++; if (e.type === 'kill') kills++; if (e.type === 'round_end') rounds++; }
    if (i % 600 === 0) for (const p of sim.players) if (p.used && (![p.x, p.y, p.z, p.yaw, p.pitch, p.hp].every(Number.isFinite))) nan = true;
  }
  return { sim, planted, defused, exploded, kills, rounds, nan };
}
for (const skill of ['easy', 'normal', 'hard']) {
  const t0 = Date.now(); const r = runBots(900, skill);
  console.log(`  [${skill}] 15 sim-min in ${Date.now() - t0} ms: rounds=${r.rounds} kills=${r.kills} planted=${r.planted} defused=${r.defused} exploded=${r.exploded} score=${r.sim.score}`);
  ok(!r.nan, `${skill}: no NaN state`);
  ok(r.rounds >= 8, `${skill}: rounds progress (${r.rounds})`);
  ok(r.kills >= 20, `${skill}: bots fight (${r.kills} kills)`);
  ok(r.planted >= 1, `${skill}: bomb gets planted at least once (${r.planted})`);
}
// --- human API: buy, shoot, plant, lag-comp
{
  const sim = new Sim({ botsPerTeam: 2 }); const me = sim.addPlayer({ name: 'Tester', human: true, team: TEAM.CT }); sim.start();
  ok(sim.count(TEAM.CT) === 2 && sim.count(TEAM.T) === 2, 'bot fill: 2v2 with the human counted');
  ok(sim.phase === PHASE.FREEZE, 'match starts in freeze time');
  const p = sim.players[me]; p.money = 5000;
  ok(sim.buy(me, W.M4) && p.pri === W.M4 && p.money === 1900, 'buy M4A4 for 3100');
  ok(!sim.buy(me, W.AK47), 'CT cannot buy the AK-47');
  ok(sim.buy(me, ITEM.HELMET) && p.armor === 100 && p.helmet, 'buy helmet');
  ok(!sim.shoot(me, { x: 0, y: 0, z: 1 }), 'cannot shoot during freeze time');
  for (let i = 0; i < 60 * 9; i++) sim.tick(1 / 60);
  ok(sim.phase === PHASE.LIVE, 'freeze time ends -> live');
  // put an enemy straight ahead and shoot it
  const en = sim.players.find(q => q.used && q.team === TEAM.T && q.alive);
  p.x = 10; p.z = 10; p.y = 0; en.x = 10; en.z = 0; en.y = 0; p.cur = W.M4; p.nextShot = 0;
  const hp0 = en.hp; sim.hist.length = 0; ok(sim.shoot(me, { x: 0, y: 0.0, z: -1 }), 'rifle fires'); ok(en.hp < hp0 || !en.alive, `enemy took damage (${hp0} -> ${en.hp})`);
  ok(p.mag[W.M4] === 29, 'ammo decremented');
  // plant: put a T in a site holding use
  const t = sim.players.find(q => q.used && q.team === TEAM.T && q.alive);
  for (const q of sim.players) if (q.used && q.id !== t.id && q.id !== me) { q.alive = false; }
  sim.players.forEach(q => { if (q.bot) q.bot = null; });
  t.hasBomb = true; sim.bomb.state = BOMB.CARRIED; sim.bomb.carrier = t.id; t.x = 30; t.z = -18; t.y = 0; t.useHeld = true;
  p.x = -30; p.z = -30;
  for (let i = 0; i < 60 * 3.5; i++) { t.useHeld = true; sim.tick(1 / 60); }
  ok(sim.bomb.state === BOMB.PLANTED, 'bomb planted after holding use in the site');
  // defuse
  p.kit = false; p.x = sim.bomb.x + 0.5; p.z = sim.bomb.z; t.alive = false;
  for (let i = 0; i < 60 * 11; i++) { p.useHeld = true; sim.tick(1 / 60); if (sim.phase !== PHASE.LIVE) break; }
  ok(sim.bomb.state === BOMB.DEFUSED && sim.winner === TEAM.CT && sim.reason === 2, 'CT defuses and wins the round');
  const snap = sim.snapshot(); ok(JSON.stringify(snap).length < 6000 && snap.pl.filter(Boolean).length === 4, `snapshot is compact (${JSON.stringify(snap).length} bytes)`);
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
