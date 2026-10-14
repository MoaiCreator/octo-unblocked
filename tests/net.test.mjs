// node tests/net.test.mjs - multiplayer protocol test over an in-memory transport (no WebRTC needed)
import { LocalSession, RemoteSession } from '../js/session.js';
import { PHASE, W } from '../js/core.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
let clock = 1000; Object.defineProperty(globalThis.performance, 'now', { value: () => clock, configurable: true });
const wire = (o) => JSON.parse(JSON.stringify(o));

class FakeHost { constructor() { this.clients = new Map(); this.n = 1; this.onMsg = null; this.onLeave = null; }
  send(cid, o) { const c = this.clients.get(cid); if (c) c.onMsg && c.onMsg(wire(o)); }
  close() {} }
class FakeClient { constructor(host) { this.host = host; this.cid = host.n++; host.clients.set(this.cid, this); this.onMsg = null; this.onClose = null; }
  send(o) { this.host.onMsg && this.host.onMsg(this.cid, wire(o)); }
  close() { this.host.clients.delete(this.cid); this.host.onLeave && this.host.onLeave(this.cid); } }

const fh = new FakeHost();
const host = new LocalSession({ name: 'Host', team: 0, skill: 'normal', hostNet: fh });
const fc = new FakeClient(fh); let dropped = '';
const guest = new RemoteSession(fc, 'Guest', (m) => { dropped = m; });
const step = (n) => { for (let i = 0; i < n; i++) { clock += 1000 / 60; host.update(1 / 60); guest.update(1 / 60); } };
step(30);
ok(guest.myId >= 0 && guest.snap, `guest joined (id ${guest.myId}) and receives snapshots`);
ok(host.sim.players[guest.myId].human && host.sim.players[guest.myId].name === 'Guest', 'host registered the guest as a human');
ok(host.sim.count(0) === 5 && host.sim.count(1) === 5, 'still 5v5 (a bot made room)');
ok(host.sim.players[guest.myId].team === 1, 'guest was balanced onto the other team (host is on T)');
// buy during freeze
host.sim.players[guest.myId].money = 5000; step(3);
guest.sendCmd('buy', W.M4); step(5);
ok(guest.snap.pl[guest.myId].p1 === W.M4, 'buy command arrives and is applied');
// movement is client-trusted
guest.sendState({ x: 3, y: 0, z: -30, yaw: 1.2, pitch: 0.1, use: false }); step(2);
const gp = host.sim.players[guest.myId];
ok(gp.yaw > 1.19 && gp.yaw < 1.21, 'host receives guest aim');
// go live, then position updates apply
step(60 * 9); ok(host.sim.phase === PHASE.LIVE, 'host sim reached live phase');
guest.sendState({ x: 5, y: 0, z: -20, yaw: 0, pitch: 0, use: false }); step(3);
ok(Math.abs(gp.x - 5) < 0.01 && Math.abs(gp.z + 20) < 0.01, 'position update applied during live phase');
// shooting with lag-comp timestamp
host.sim.players.forEach(q => { if (q.bot) q.bot = null; });          // freeze the bots so positions stay put
const enemy = host.sim.players.find(p => p.used && p.team === 0 && p.alive); enemy.x = 5; enemy.z = -30; enemy.y = 0;
guest.sendState({ x: 5, y: 0, z: -20, yaw: 0, pitch: 0, use: false }); gp.nextShot = 0; gp.cur = W.M4;
step(40);                                                              // let lag-compensation history catch up with the teleport
const hp0 = enemy.hp; guest.sendShoot({ x: 0, y: 0, z: -1 }); step(2);
ok(enemy.hp < hp0 || !enemy.alive, `guest shot reaches the host and hits (${hp0} -> ${enemy.hp})`);
const evs = guest.takeEvents(); ok(evs.some(e => e.type === 'shot' && e.id === guest.myId), 'guest gets the shot event once');
ok(guest.takeEvents().length === 0, 'events are deduplicated');
// interpolation produces sane positions
const pos = guest.getPositions(); ok(pos.filter(Boolean).length === 10 && pos.every(p => !p || Number.isFinite(p.x + p.y + p.z + p.yaw)), 'interpolated positions are finite for all players');
// version mismatch
const fc2 = new FakeClient(fh); let why2 = ''; fc2.onMsg = (m) => { if (m.t === 'full') why2 = m.why; };
fc2.send({ t: 'hello', name: 'Old', v: 999 }); step(2);
ok(/Version/.test(why2), 'version mismatch is rejected');
// a dead guest (spectating) must not be timed out: it only sends pings
gp.alive = false; step(60 * 8); ok(host.sim.players[guest.myId].used && host.sim.players[guest.myId].name === 'Guest', 'dead/spectating guest is not timed out');
// leaving
const id = guest.myId; fc.close(); step(2);
ok(!host.sim.players[id].human || host.sim.players[id].name !== 'Guest', 'host removes the player on disconnect');
ok(host.sim.count(1) === 5, 'a bot takes the free slot again');
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
