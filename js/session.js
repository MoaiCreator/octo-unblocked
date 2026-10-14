// session.js - one interface for solo, hosting and joined games.
//  LocalSession : runs the Sim in this tab (solo, or hosting for peers)
//  RemoteSession: receives snapshots from a host over PeerJS
import { Sim } from './sim.js';
import { fwdVec, VERSION } from './core.js';

class Base {
  constructor() { this.snap = null; this.myId = -1; this.lastSeq = 0; this.ping = 0; this.viewTime = undefined; }
  takeEvents() {
    const s = this.snap; if (!s) return [];
    const out = s.ev.filter(e => e.seq > this.lastSeq); if (out.length) this.lastSeq = out[out.length - 1].seq; return out;
  }
}

export class LocalSession extends Base {
  constructor({ name, team, skill, hostNet }) {
    super();
    this.sim = new Sim({ skill }); this.net = hostNet || null; this.isHost = !!hostNet;
    this.myId = this.sim.addPlayer({ name, human: true, team }); this.sim.start();
    this.acc = 0; this.sendAcc = 0; this.conn2id = new Map(); this.snap = this.sim.snapshot();
    if (this.net) {
      this.net.onMsg = (cid, m) => this.onMsg(cid, m);
      this.net.onLeave = (cid) => { const id = this.conn2id.get(cid); this.conn2id.delete(cid); if (id !== undefined) this.sim.removePlayer(id); };
    }
  }
  onMsg(cid, m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
      if (this.conn2id.has(cid)) return;
      if (m.v !== VERSION) { this.net.send(cid, { t: 'full', why: 'Version mismatch - refresh the page and try again' }); return; }
      const id = this.sim.addPlayer({ name: String(m.name || 'Player'), human: true, remote: true });
      if (id < 0) { this.net.send(cid, { t: 'full' }); return; }
      this.conn2id.set(cid, id); this.net.send(cid, { t: 'welcome', id });
      return;
    }
    const id = this.conn2id.get(cid); if (id === undefined) return;
    this.sim.players[id].lastSeen = this.sim.t;                   // any message proves the peer is alive (dead players only ping)
    if (m.t === 'st') this.sim.setPlayerState(id, { x: m.x, y: m.y, z: m.z, yaw: m.yw, pitch: m.pt, use: m.u });
    else if (m.t === 'shoot') this.sim.shoot(id, { x: m.dx, y: m.dy, z: m.dz }, Number.isFinite(m.vt) ? m.vt : undefined);
    else if (m.t === 'cmd') this.sim.command(id, m.c, m.a);
    else if (m.t === 'ping') this.net.send(cid, { t: 'pong', ts: m.ts });
  }
  update(dt) {
    this.acc += Math.min(dt, 0.1);
    let n = 0; while (this.acc >= 1 / 60 && n++ < 6) { this.sim.tick(1 / 60); this.acc -= 1 / 60; }
    this.snap = this.sim.snapshot();
    if (this.net) {
      this.sendAcc += dt;
      if (this.sendAcc >= 0.05) { this.sendAcc = 0; for (const [cid, id] of this.conn2id) this.net.send(cid, { t: 'snap', you: id, s: this.snap }); }
    }
  }
  getPositions() { return this.snap.pl.map(p => p && { x: p.x, y: p.y, z: p.z, yaw: p.yw, pitch: p.pt, tele: false }); }
  sendState(s) { this.sim.setPlayerState(this.myId, s); }
  sendShoot(dir) { return this.sim.shoot(this.myId, dir); }
  sendCmd(c, a) { this.sim.command(this.myId, c, a); }
  peers() { return this.conn2id.size; }
  close() { if (this.net) this.net.close(); }
}

export class RemoteSession extends Base {
  constructor(net, name, onClosed) {
    super();
    this.net = net; this.name = name; this.onClosed = onClosed; this.buf = []; this.off = 0; this.offInit = false; this.lastRecv = performance.now();
    this.pingT = 0; this.rt = 0; this.closed = false; this.err = '';
    net.onMsg = (m) => this.onMsg(m);
    net.onClose = () => this.drop('Disconnected from host');
    net.send({ t: 'hello', name, v: VERSION });
  }
  drop(msg) { if (this.closed) return; this.closed = true; this.err = msg; this.onClosed && this.onClosed(msg); }
  onMsg(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'welcome') this.myId = m.id;
    else if (m.t === 'full') this.drop(m.why || 'Server is full');
    else if (m.t === 'pong') this.ping = this.ping * 0.7 + (performance.now() - m.ts) * 0.3;
    else if (m.t === 'snap') {
      const now = performance.now() / 1000; this.lastRecv = performance.now();
      const o = m.s.t - now; if (!this.offInit) { this.off = o; this.offInit = true; this.lastSeq = m.s.ev.length ? m.s.ev[m.s.ev.length - 1].seq : 0; } else this.off += (o - this.off) * 0.05;
      this.myId = m.you; this.snap = m.s; this.buf.push(m.s); while (this.buf.length > 20) this.buf.shift();
    }
  }
  update(dt) {
    const now = performance.now(); this.pingT += dt;
    if (this.pingT > 1) { this.pingT = 0; this.net.send({ t: 'ping', ts: now }); }
    if (this.snap && now - this.lastRecv > 6000) this.drop('Connection to host lost');
    this.rt = now / 1000 + this.off - 0.1; this.viewTime = this.rt;
  }
  getPositions() {
    const s = this.snap; if (!s) return [];
    const b = this.buf; let k = 0; while (k < b.length && b[k].t < this.rt) k++;
    const B = k < b.length ? b[k] : b[b.length - 1], A = k > 0 && k < b.length ? b[k - 1] : B;
    const span = B.t - A.t, al = span > 1e-6 ? Math.max(0, Math.min(1, (this.rt - A.t) / span)) : 0;
    return s.pl.map((cur, i) => {
      if (!cur) return null;
      const a = A.pl[i], bb = B.pl[i]; if (!a || !bb) return { x: cur.x, y: cur.y, z: cur.z, yaw: cur.yw, pitch: cur.pt };
      let f = al; if (a.sq !== bb.sq || (a.x - bb.x) ** 2 + (a.z - bb.z) ** 2 > 36) f = 1;
      let dy = bb.yw - a.yw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
      return { x: a.x + (bb.x - a.x) * f, y: a.y + (bb.y - a.y) * f, z: a.z + (bb.z - a.z) * f, yaw: a.yw + dy * f, pitch: a.pt + (bb.pt - a.pt) * f };
    });
  }
  sendState(s) { this.net.send({ t: 'st', x: +s.x.toFixed(2), y: +s.y.toFixed(2), z: +s.z.toFixed(2), yw: +s.yaw.toFixed(3), pt: +s.pitch.toFixed(3), u: s.use ? 1 : 0 }); }
  sendShoot(dir) { this.net.send({ t: 'shoot', dx: +dir.x.toFixed(4), dy: +dir.y.toFixed(4), dz: +dir.z.toFixed(4), vt: +this.rt.toFixed(3) }); return true; }
  sendCmd(c, a) { this.net.send({ t: 'cmd', c, a }); }
  peers() { return 0; }
  close() { this.closed = true; this.net.close(); }
}
export { fwdVec };
