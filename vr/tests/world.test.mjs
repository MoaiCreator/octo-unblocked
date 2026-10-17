// node vr/tests/world.test.mjs - every OpenStrike map becomes a playable VR world, bots play rounds on it
import { readFileSync } from 'node:fs';
import { gridToWorld, TILE } from '../js/world.js';
import { mergeMods, belt, applyToSim } from '../js/osdata.js';
import { Sim } from '../js/sim.js';
import { NavGrid } from '../js/nav.js';
import { W, WEAPONS, moveBody } from '../js/core.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const defs = JSON.parse(readFileSync(new URL('../../data/defaults.json', import.meta.url)));
const mods = JSON.parse(readFileSync(new URL('../../data/mods.json', import.meta.url)));
const data = mergeMods(defs, mods);
ok(data.maps.length === 6 && data.maps[0].gameId === 0, `6 maps, Desert first (${data.maps.map((m) => m.name).join(', ')})`);

const guns = belt(defs.weapons, data.weapons);
ok(guns.length === 9 && guns.every((g) => g.name && g.dmg > 0 || g.melee), `belt has 9 guns: ${guns.map((g) => g.name).join(', ')}`);
ok(guns.filter((g) => g.twoHanded).length === 5 && guns.find((g) => g.kind === 'sniper').scope, 'primaries need two hands, the sniper has a scope');
applyToSim(defs.weapons, data.weapons);
ok(WEAPONS[W.AK47].dmg === guns.find((g) => g.id === W.AK47).dmg, 'bots use the same (admin-edited) gun stats');

for (const m of data.maps) {
  const w = gridToWorld(m.rows, { name: m.name });
  const nav = new NavGrid(w);
  ok(w.spawns[0].length >= 3 && w.spawns[1].length >= 3 && w.sites.length === 2, `${m.name}: ${w.boxes.length} boxes, spawns ${w.spawns[0].length}/${w.spawns[1].length}, 2 sites`);
  let reach = true;
  for (const t of [0, 1]) for (const s of w.sites) { const sp = w.spawns[t][0], p = nav.findPath(sp.x, sp.z, (s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2); if (!p) reach = false; }
  ok(reach, `${m.name}: bots can path from both spawns to both sites`);
  const sim = new Sim({ map: w, skill: 'normal' }); sim.start();
  let seq = 0, kills = 0, rounds = 0, nan = false;
  for (let i = 0; i < 60 * 240; i++) { sim.tick(1 / 60); for (const e of sim.events) if (e.seq > seq) { seq = e.seq; if (e.type === 'kill') kills++; if (e.type === 'round_end') rounds++; } }
  for (const p of sim.players) if (p.used && ![p.x, p.y, p.z].every(Number.isFinite)) nan = true;
  ok(!nan && rounds >= 2 && kills >= 8, `${m.name}: 4 sim-minutes -> ${rounds} rounds, ${kills} kills`);
}
// stairs: walking up a ladder tile onto a platform
{
  const rows = Array.from({ length: 40 }, (_, r) => r === 0 || r === 39 ? '#'.repeat(48) : '#' + '.'.repeat(46) + '#');
  const set = (r, c, ch) => { rows[r] = rows[r].slice(0, c) + ch + rows[r].slice(c + 1); };
  set(20, 10, 'L'); for (let c = 11; c < 16; c++) set(20, c, 'P');
  set(5, 5, 'T'); set(30, 30, 'S'); set(10, 10, 'A'); set(10, 30, 'B');
  const w = gridToWorld(rows); const body = { x: (10 - 24) * TILE - 1.4, y: 0, z: (20 - 20 + 0.5) * TILE, vy: 0, grounded: true };
  for (let i = 0; i < 180; i++) moveBody(body, 3, 0, false, 1 / 60, w);
  ok(body.y > 1.4, `walking up the stairs reaches the platform (height ${body.y.toFixed(2)} m)`);
}
// muzzle shots hit bots
{
  const w = gridToWorld(data.maps[0].rows); const sim = new Sim({ map: w, botsPerTeam: 1 });
  const me = sim.addPlayer({ name: 'VR', human: true, team: 1 }); sim.start();
  for (let i = 0; i < 60 * 9; i++) sim.tick(1 / 60);
  const p = sim.players[me], en = sim.players.find((q) => q.used && q.team === 0);
  sim.players.forEach((q) => { q.bot = null; });
  p.x = 0; p.z = 0; p.y = 0; en.x = 0; en.z = -6; en.y = 0; en.alive = true; en.hp = 100;
  w.boxes.length = 0;                                     // open field for this check
  const g = belt(defs.weapons, data.weapons).find((x) => x.id === W.AK47);
  const r = sim.shootFrom(me, g, { x: 0.25, y: 1.3, z: -0.4 }, { x: 0, y: 0.03, z: -1 });
  ok(r && r.hits === 1 && en.hp < 100, `shot from the muzzle hits (enemy hp ${en.hp})`);
  const r2 = sim.shootFrom(me, g, { x: 50, y: 1.3, z: 50 }, { x: 0, y: 0.03, z: -1 });
  ok(r2 && r2.ends.length && Math.abs(r2.ends[0][0]) < 1, 'a muzzle far from the body is ignored (anti-cheat)');
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
