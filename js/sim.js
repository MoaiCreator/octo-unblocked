// sim.js - authoritative game simulation: rounds, economy, weapons, bomb, bots. No DOM; runs in node for tests.
import { MAXP, PR, PH, EYE, PHASE, BOMB, REASON, TEAM, W, ITEM, WEAPONS, wdef, itemPrice, itemTeam, builtinMap, siteAt,
  rayAabb, rayWorld, clamp, PI } from './core.js';
import { NavGrid } from './nav.js';
import { newBotState, updateBot, botBuy, botRoundStart } from './bots.js';

const FREEZE_T = 8, LIVE_T = 105, END_T = 5, MATCHEND_T = 8, PLANT_T = 3.2, BOMB_T = 40, WIN_ROUNDS = 7, HALF = 6;
const NAMES = ['Rex', 'Nova', 'Kilo', 'Echo', 'Blaze', 'Viper', 'Mako', 'Zed', 'Orion', 'Pixel', 'Ghost', 'Bolt', 'Tango', 'Jinx', 'Knox', 'Raven', 'Sable', 'Dash'];

export class Sim {
  constructor(opts = {}) {
    this.map = opts.map || builtinMap();
    this.nav = new NavGrid(this.map);
    this.botsPerTeam = opts.botsPerTeam ?? 5;
    this.skill = opts.skill || 'normal';
    this.players = Array.from({ length: MAXP }, (_, i) => this.blank(i));
    this.t = 0; this.evSeq = 0; this.events = [];
    this.phase = PHASE.WARMUP; this.phaseEnd = 0; this.round = 0;
    this.score = [0, 0]; this.lossStreak = [0, 0]; this.winner = 255; this.reason = 0;
    this.bomb = { state: BOMB.NONE, x: 0, y: 0, z: 0, carrier: -1, explodeAt: 0, plantSeq: 0 };
    this.defuserId = -1; this.planSite = 'A'; this.hist = []; this.histT = 0; this.usedNames = new Set();
  }
  blank(i) {
    return { id: i, used: false, human: false, remote: false, name: '', team: 0, alive: false, hp: 0, armor: 0, helmet: false, kit: false, money: 800,
      kills: 0, deaths: 0, x: 0, y: 0, z: 0, vy: 0, grounded: true, yaw: 0, pitch: 0, cur: W.KNIFE, pri: 0, sec: 0,
      mag: new Array(WEAPONS.length).fill(0), res: new Array(WEAPONS.length).fill(0), reloading: false, reloadEnd: 0, nextShot: 0, lastShot: -99,
      hasBomb: false, prog: 0, anchor: null, useHeld: false, spawnSeq: 0, lastSeen: 0, bot: null };
  }
  emit(type, data) { const e = { seq: ++this.evSeq, t: this.t, type, ...data }; this.events.push(e); if (this.events.length > 48) this.events.shift(); return e; }

  // ---------------------------------------------------------------- players
  count(team) { let n = 0; for (const p of this.players) if (p.used && p.team === team) n++; return n; }
  humans() { return this.players.filter(p => p.used && p.human); }
  hasAwp(team) { return this.players.some(p => p.used && p.team === team && p.pri === W.AWP); }
  nearestAlive(team, x, z, botsOnly = false) {
    let best = -1, bd = 1e9;
    for (const p of this.players) { if (!p.used || !p.alive || p.team !== team || (botsOnly && p.human)) continue; const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = p.id; } }
    return best;
  }
  addPlayer({ name = 'Player', human = true, team = -1, remote = false } = {}) {
    if (team < 0) {                                               // balance humans first, then total headcount
      const hum = [0, 0]; for (const q of this.players) if (q.used && q.human) hum[q.team]++;
      team = hum[0] !== hum[1] ? (hum[0] < hum[1] ? 0 : 1) : (this.count(0) <= this.count(1) ? 0 : 1);
    }
    let id = this.players.findIndex(p => !p.used);
    if (id < 0 && human) { const bot = this.players.find(p => p.used && !p.human && p.team === team) || this.players.find(p => p.used && !p.human); if (bot) { this.removePlayer(bot.id, true); id = bot.id; } }
    if (id < 0) return -1;
    const p = this.players[id]; Object.assign(p, this.blank(id));
    p.used = true; p.human = human; p.remote = remote; p.name = human ? name.slice(0, 15) : name; p.team = team; p.lastSeen = this.t;
    p.money = 800;
    if (!human) p.bot = newBotState();
    this.resetLoadout(p); this.spawn(p, this.count(team) - 1);
    if (!(this.phase === PHASE.FREEZE || this.phase === PHASE.WARMUP)) p.alive = false;   // wait for the next round
    if (human) { // make room: drop a bot from that team if it is now over the limit
      const over = this.count(team) - this.botsPerTeam;
      if (over > 0) { const b = this.players.filter(q => q.used && !q.human && q.team === team); if (b.length) this.removePlayer(b[b.length - 1].id, true); }
    }
    return id;
  }
  removePlayer(id, silent = false) {
    const p = this.players[id]; if (!p || !p.used) return;
    if (p.hasBomb) { p.hasBomb = false; this.bomb.state = BOMB.DROPPED; this.bomb.carrier = -1; this.bomb.x = p.x; this.bomb.y = p.y; this.bomb.z = p.z; }
    this.usedNames.delete(p.name);
    Object.assign(p, this.blank(id));
    if (!silent) this.fillBots();
  }
  fillBots() {
    for (const team of [0, 1]) while (this.count(team) < this.botsPerTeam) {
      const free = this.players.findIndex(p => !p.used); if (free < 0) return;
      let n; do { n = NAMES[Math.floor(Math.random() * NAMES.length)]; } while (this.usedNames.has(n) && this.usedNames.size < NAMES.length);
      this.usedNames.add(n); this.addPlayer({ name: n, human: false, team });
    }
  }
  resetLoadout(p) {
    p.pri = 0; p.sec = 0; p.armor = 0; p.helmet = false; p.kit = false; p.reloading = false;
    p.mag.fill(0); p.res.fill(0);
    this.give(p, p.team ? W.USP : W.GLOCK); p.cur = p.sec;
  }
  give(p, id) { const d = wdef(id); p.mag[id] = d.mag; p.res[id] = d.reserve; if (d.slot === 1) p.pri = id; else if (d.slot === 2) p.sec = id; }
  spawn(p, idx) {
    const sp = this.map.spawns[p.team]; const s = sp[idx % sp.length];
    p.x = s.x + (idx >= sp.length ? 0.9 * Math.floor(idx / sp.length) : 0); p.y = 0; p.z = s.z; p.vy = 0; p.grounded = true; p.yaw = s.yaw; p.pitch = 0;
    p.hp = 100; p.alive = true; p.spawnSeq = (p.spawnSeq + 1) & 255; p.prog = 0; p.useHeld = false; p.reloading = false; p.hasBomb = false;
    p.cur = p.pri || p.sec; p.nextShot = this.t + 0.3;
  }
  setPlayerState(id, s) {                                   // client-trusted movement (position, aim, use key)
    const p = this.players[id]; if (!p || !p.used || !p.human) return;
    p.lastSeen = this.t; p.useHeld = !!s.use;
    if (!p.alive) return;
    if (Number.isFinite(s.yaw) && Number.isFinite(s.pitch)) { p.yaw = s.yaw; p.pitch = clamp(s.pitch, -1.57, 1.57); }
    if (this.phase === PHASE.FREEZE || this.phase === PHASE.MATCHEND) return;
    if ([s.x, s.y, s.z].every(Number.isFinite)) { const b = this.map.bounds; p.x = clamp(s.x, b.x0, b.x1); p.z = clamp(s.z, b.z0, b.z1); p.y = clamp(s.y, -1, 60); }
  }

  // ---------------------------------------------------------------- match flow
  start() { if (this.phase === PHASE.WARMUP) { this.fillBots(); this.resetMatch(); } }
  resetMatch() {
    this.score = [0, 0]; this.lossStreak = [0, 0]; this.round = 0;
    for (const p of this.players) if (p.used) { p.money = 800; p.kills = 0; p.deaths = 0; p.alive = false; }
    this.startRound();
  }
  startRound() {
    this.round++; this.winner = 255; this.bomb = { state: BOMB.NONE, x: 0, y: 0, z: 0, carrier: -1, explodeAt: 0, plantSeq: this.bomb.plantSeq + 1 };
    this.defuserId = -1; const idx = [0, 0]; const ts = [];
    this.planSite = this.map.sites[Math.floor(Math.random() * this.map.sites.length)].name;
    for (const p of this.players) {
      if (!p.used) continue;
      if (!p.alive) this.resetLoadout(p);
      this.spawn(p, idx[p.team]++);
      if (p.team === TEAM.T) ts.push(p);
      if (p.bot) botRoundStart(this, p);
    }
    if (ts.length) { const c = ts[Math.floor(Math.random() * ts.length)]; c.hasBomb = true; this.bomb.state = BOMB.CARRIED; this.bomb.carrier = c.id; }
    this.phase = PHASE.FREEZE; this.phaseEnd = this.t + FREEZE_T;
    for (const p of this.players) if (p.used && p.bot) botBuy(this, p);
    this.emit('round_start', { round: this.round });
  }
  halftime() {
    this.score.reverse(); this.lossStreak = [0, 0];
    for (const p of this.players) if (p.used) { p.team ^= 1; p.money = 800; p.alive = false; if (p.bot) p.bot = newBotState(); }
    this.emit('halftime', {});
  }
  addMoney(p, v) { p.money = clamp(p.money + v, 0, 16000); }
  endRound(w, why) {
    if (this.phase !== PHASE.LIVE) return;
    this.winner = w; this.reason = why; this.score[w]++;
    const l = w ^ 1;
    this.lossStreak[l] = Math.min(this.lossStreak[l] + 1, 5); this.lossStreak[w] = Math.max(0, this.lossStreak[w] - 1);
    const lossBonus = Math.min(3400, 1400 + 500 * (this.lossStreak[l] - 1));
    for (const p of this.players) if (p.used) {
      if (p.team === w) this.addMoney(p, 3250);
      else { this.addMoney(p, lossBonus); if (l === TEAM.T && this.bomb.state === BOMB.PLANTED) this.addMoney(p, 800); }
    }
    this.emit('round_end', { winner: w, reason: why });
    if (this.score[w] >= WIN_ROUNDS) { this.phase = PHASE.MATCHEND; this.phaseEnd = this.t + MATCHEND_T; }
    else { this.phase = PHASE.ROUNDEND; this.phaseEnd = this.t + END_T; }
  }
  checkEnd() {
    let aT = 0, aC = 0; for (const p of this.players) if (p.used && p.alive) (p.team ? aC++ : aT++);
    const planted = this.bomb.state === BOMB.PLANTED;
    if (aC === 0 && aT === 0) this.endRound(planted ? TEAM.T : TEAM.CT, REASON.ELIM);
    else if (aC === 0) this.endRound(TEAM.T, REASON.ELIM);
    else if (aT === 0 && !planted) this.endRound(TEAM.CT, REASON.ELIM);
    else if (this.t >= this.phaseEnd && !planted) this.endRound(TEAM.CT, REASON.TIME);
  }

  // ---------------------------------------------------------------- bomb
  bombTick(dt) {
    const bomb = this.bomb;
    if (bomb.state === BOMB.DROPPED) for (const p of this.players) {
      if (p.used && p.alive && p.team === TEAM.T && Math.abs(p.x - bomb.x) < 1.1 && Math.abs(p.z - bomb.z) < 1.1 && Math.abs(p.y - bomb.y) < 1.5) {
        p.hasBomb = true; bomb.carrier = p.id; bomb.state = BOMB.CARRIED; this.emit('pickup', { id: p.id }); break;
      }
    }
    if (bomb.state === BOMB.PLANTED) {                                  // pick the closest CT bot as the defuser
      this.defuserId = this.nearestAlive(TEAM.CT, bomb.x, bomb.z, true);
    }
    for (const p of this.players) {
      if (!p.used) continue; let did = false;
      if (p.alive && p.useHeld) {
        const plant = p.hasBomb && bomb.state === BOMB.CARRIED && !!siteAt(this.map, p.x, p.z);
        const defuse = p.team === TEAM.CT && bomb.state === BOMB.PLANTED && Math.abs(p.x - bomb.x) < 1.8 && Math.abs(p.z - bomb.z) < 1.8 && Math.abs(p.y - bomb.y) < 1.5;
        if (plant || defuse) {
          if (p.prog <= 0 || !p.anchor) p.anchor = { x: p.x, z: p.z };
          if ((p.x - p.anchor.x) ** 2 + (p.z - p.anchor.z) ** 2 > 0.16) { p.prog = 0; p.anchor = { x: p.x, z: p.z }; }
          p.prog += dt; did = true;
          if (plant && p.prog >= PLANT_T) {
            bomb.state = BOMB.PLANTED; bomb.x = p.x; bomb.y = p.y; bomb.z = p.z; bomb.explodeAt = this.t + BOMB_T;
            p.hasBomb = false; bomb.carrier = -1; p.prog = 0; this.addMoney(p, 300); this.emit('plant', { id: p.id });
          } else if (defuse && p.prog >= (p.kit ? 5 : 10)) {
            bomb.state = BOMB.DEFUSED; this.addMoney(p, 300); p.prog = 0; this.emit('defuse', { id: p.id });
            this.endRound(TEAM.CT, REASON.DEFUSE); return;
          }
        }
      }
      if (!did) p.prog = 0;
    }
    if (bomb.state === BOMB.PLANTED && this.t >= bomb.explodeAt) {
      bomb.state = BOMB.EXPLODED; this.emit('explode', { x: bomb.x, y: bomb.y, z: bomb.z });
      for (const p of this.players) {
        if (!p.used || !p.alive) continue;
        const d = Math.hypot(p.x - bomb.x, p.z - bomb.z);
        if (d < 16) { p.hp -= Math.round(400 * (1 - d / 16)); if (p.hp <= 0) this.kill(p.id, -1, W.C4, false); }
      }
      this.endRound(TEAM.T, REASON.BOMB);
    }
  }

  // ---------------------------------------------------------------- combat
  startReload(p) {
    const d = wdef(p.cur);
    if (p.reloading || d.mag === 0 || p.mag[p.cur] >= d.mag || p.res[p.cur] <= 0) return;
    p.reloading = true; p.reloadEnd = this.t + d.reload;
  }
  command(id, cmd, arg) {
    const p = this.players[id]; if (!p || !p.used) return;
    if (cmd === 'switch') this.switchSlot(id, arg);
    else if (cmd === 'reload' && p.alive) this.startReload(p);
    else if (cmd === 'buy') this.buy(id, arg);
  }
  switchSlot(id, slot) {
    const p = this.players[id]; if (!p || !p.alive) return;
    const w = slot === 1 ? p.pri : slot === 2 ? p.sec : slot === 3 ? W.KNIFE : 0;
    if (!w || w === p.cur) return;
    p.cur = w; p.reloading = false; p.nextShot = Math.max(p.nextShot, this.t + 0.3);
  }
  buy(id, item) {
    const p = this.players[id]; if (!p || !p.alive || !(this.phase === PHASE.FREEZE || this.phase === PHASE.WARMUP)) return false;
    const price = itemPrice(item);
    const valid = item === ITEM.KEVLAR || item === ITEM.HELMET || item === ITEM.KIT || (item > W.KNIFE && item < W.C4 && price > 0);
    if (!valid) return false;
    const tm = itemTeam(item); if (tm >= 0 && tm !== p.team) return false;
    if (p.money < price) return false;
    if (item === ITEM.KEVLAR) { if (p.armor >= 100) return false; p.armor = 100; }
    else if (item === ITEM.HELMET) { if (p.armor >= 100 && p.helmet) return false; p.armor = 100; p.helmet = true; }
    else if (item === ITEM.KIT) { if (p.kit) return false; p.kit = true; }
    else { this.give(p, item); p.cur = item; p.reloading = false; }
    this.addMoney(p, -price); this.emit('buy', { id }); return true;
  }
  rewound(j, vt) {
    const v = this.players[j];
    if (vt === undefined || !this.hist.length) return v.alive ? { x: v.x, y: v.y, z: v.z } : null;
    vt = clamp(vt, this.t - 0.3, this.t);
    const h = this.hist; let k = 0; while (k < h.length && h[k].t < vt) k++;
    if (k >= h.length) return v.alive ? { x: v.x, y: v.y, z: v.z } : null;
    const b = h[k], a = k > 0 ? h[k - 1] : b, span = b.t - a.t, al = span > 1e-6 ? (vt - a.t) / span : 0;
    const pa = a.p[j], pb = b.p[j]; if (!pa || !pb) return v.alive ? { x: v.x, y: v.y, z: v.z } : null;
    let f = al; if ((pa.x - pb.x) ** 2 + (pa.z - pb.z) ** 2 > 36) f = f > 0.5 ? 1 : 0;
    return v.alive && pb.a ? { x: pa.x + (pb.x - pa.x) * f, y: pa.y + (pb.y - pa.y) * f, z: pa.z + (pb.z - pa.z) * f } : null;
  }
  damage(ai, vi, weapon, dmg, head) {
    const v = this.players[vi], w = wdef(weapon); let loss;
    if (v.armor > 0 && (!head || v.helmet)) {
      let red = dmg * w.pen, aLoss = (dmg - red) * 0.5;
      if (aLoss > v.armor) { aLoss = v.armor; red = dmg - aLoss * 2; }
      v.armor -= Math.round(aLoss); loss = Math.round(red);
    } else loss = Math.round(dmg);
    loss = Math.max(1, loss);
    v.hp -= loss; this.emit('hit', { a: ai, v: vi, head, dmg: loss });
    if (v.hp <= 0) this.kill(vi, ai, weapon, head);
  }
  kill(vi, ki, weapon, head) {
    const v = this.players[vi]; v.hp = 0; v.alive = false; v.deaths++; v.reloading = false; v.prog = 0; v.useHeld = false;
    if (v.hasBomb) { v.hasBomb = false; this.bomb.state = BOMB.DROPPED; this.bomb.carrier = -1; this.bomb.x = v.x; this.bomb.y = v.y; this.bomb.z = v.z; this.emit('bomb_drop', {}); }
    if (ki >= 0 && ki !== vi) { const k = this.players[ki]; k.kills++; this.addMoney(k, wdef(weapon).reward); }
    this.emit('kill', { k: ki, v: vi, w: weapon, head: !!head });
  }
  shoot(id, d, viewT) {
    const p = this.players[id]; if (!p || !p.used || !p.alive || p.reloading) return false;
    if (this.phase === PHASE.FREEZE || this.phase === PHASE.MATCHEND) return false;
    const w = wdef(p.cur); if (w.slot === 4 || w.slot === 0) return false;
    if (this.t < p.nextShot - 0.02) return false;
    const L = Math.hypot(d.x, d.y, d.z); if (!(L > 0.5) || !Number.isFinite(L)) return false;
    d = { x: d.x / L, y: d.y / L, z: d.z / L };
    const knife = w.slot === 3;
    if (!knife) { if (p.mag[p.cur] <= 0) { this.startReload(p); return false; } p.mag[p.cur]--; }
    p.nextShot = this.t + w.interval; p.lastShot = this.t;
    const o = { x: p.x, y: p.y + EYE, z: p.z }, ends = []; let hitAny = false;
    for (let k = 0; k < w.pellets; k++) {
      let dir = d;
      if (w.pellets > 1) { dir = { x: d.x + (Math.random() - 0.5) * 2 * w.spread, y: d.y + (Math.random() - 0.5) * 2 * w.spread, z: d.z + (Math.random() - 0.5) * 2 * w.spread }; const l = Math.hypot(dir.x, dir.y, dir.z); dir.x /= l; dir.y /= l; dir.z /= l; }
      let bt = rayWorld(this.map, o, dir, knife ? 2.4 : 200), best = -1, bpos = null;
      for (const v of this.players) {
        if (v.id === id || !v.used || !v.alive || v.team === p.team) continue;
        const pos = this.rewound(v.id, viewT); if (!pos) continue;
        const tt = rayAabb(o.x, o.y, o.z, dir.x, dir.y, dir.z, pos.x - PR, pos.y, pos.z - PR, pos.x + PR, pos.y + PH, pos.z + PR);
        if (tt >= 0 && tt < bt) { bt = tt; best = v.id; bpos = pos; }
      }
      if (k < 3) ends.push([+(o.x + dir.x * bt).toFixed(2), +(o.y + dir.y * bt).toFixed(2), +(o.z + dir.z * bt).toFixed(2), best >= 0 ? 1 : 0]);
      if (best < 0 || !this.players[best].alive) continue;
      hitAny = true;
      const hy = o.y + dir.y * bt - bpos.y, head = !knife && hy > 1.45;
      let dmg = w.dmg * (knife ? 1 : Math.pow(w.range, bt / 9.5));
      if (head) dmg *= w.head; else if (hy < 0.55) dmg *= 0.75;
      this.damage(id, best, p.cur, dmg, head);
    }
    this.emit('shot', { id, w: p.cur, o: [+o.x.toFixed(2), +o.y.toFixed(2), +o.z.toFixed(2)], e: ends });
    if (!knife && p.mag[p.cur] === 0) this.startReload(p);
    return true;
  }

  // ---------------------------------------------------------------- tick
  tick(dt) {
    this.t += dt;
    for (const p of this.players) if (p.used && p.remote && this.t - p.lastSeen > 6) this.removePlayer(p.id);
    for (const p of this.players) if (p.used && p.alive && p.reloading && this.t >= p.reloadEnd) {
      const d = wdef(p.cur), take = Math.min(d.mag - p.mag[p.cur], p.res[p.cur]);
      p.mag[p.cur] += take; p.res[p.cur] -= take; p.reloading = false;
    }
    for (const p of this.players) if (p.used && p.bot) updateBot(this, p, dt);
    switch (this.phase) {
      case PHASE.WARMUP: break;
      case PHASE.FREEZE: if (this.t >= this.phaseEnd) { this.phase = PHASE.LIVE; this.phaseEnd = this.t + LIVE_T; this.emit('live', {}); } break;
      case PHASE.LIVE: this.bombTick(dt); if (this.phase === PHASE.LIVE) this.checkEnd(); break;
      case PHASE.ROUNDEND: if (this.t >= this.phaseEnd) { if (this.round === HALF) this.halftime(); this.startRound(); } break;
      case PHASE.MATCHEND: if (this.t >= this.phaseEnd) this.resetMatch(); break;
    }
    if (this.t >= this.histT) {
      this.histT = this.t + 1 / 30;
      this.hist.push({ t: this.t, p: this.players.map(p => ({ x: p.x, y: p.y, z: p.z, a: p.used && p.alive })) });
      if (this.hist.length > 20) this.hist.shift();
    }
  }

  // ---------------------------------------------------------------- snapshot (used by renderer and network)
  snapshot() {
    const b = this.bomb, fl = (p) => (p.kit ? 1 : 0) | (p.helmet ? 2 : 0) | (p.hasBomb ? 4 : 0) | (p.reloading ? 8 : 0) | (p.human ? 16 : 0);
    return {
      t: +this.t.toFixed(3), ph: this.phase, left: +Math.max(0, this.phaseEnd - this.t).toFixed(2), rd: this.round, sc: [this.score[0], this.score[1]],
      bomb: [b.state, +b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2), b.state === BOMB.PLANTED ? +Math.max(0, b.explodeAt - this.t).toFixed(2) : 0],
      win: this.winner, why: this.reason, site: this.planSite,
      ev: this.events.filter(e => e.t >= this.t - 2),
      pl: this.players.map(p => !p.used ? null : {
        i: p.id, n: p.name, tm: p.team, a: p.alive ? 1 : 0, hp: p.hp, ar: p.armor, fl: fl(p), m: p.money, k: p.kills, d: p.deaths,
        w: p.cur, p1: p.pri, p2: p.sec, am: p.mag[p.cur], rs: p.res[p.cur],
        x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), yw: +p.yaw.toFixed(3), pt: +p.pitch.toFixed(3), sq: p.spawnSeq,
        pg: p.prog > 0 ? +(p.prog / (p.team === TEAM.CT && b.state === BOMB.PLANTED ? (p.kit ? 5 : 10) : PLANT_T)).toFixed(2) : 0,
      }),
    };
  }
}
