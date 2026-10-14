// main.js - menu, input, local player controller, HUD and the main loop
import { builtinMap, wdef, W, ITEM, PHASE, BOMB, REASON, itemPrice, itemName, itemTeam, fwdVec, moveBody, rayWorld, RUN, EYE, PI, angleDiff, clamp, rnd } from './core.js';
import { Renderer } from './render.js';
import { Sfx } from './audio.js';
import { LocalSession, RemoteSession } from './session.js';
import { HostNet, ClientNet, netAvailable } from './net.js';

const $ = (id) => document.getElementById(id);
const sfx = new Sfx();
const params = new URLSearchParams(location.search);

// ------------------------------------------------------------------ settings
const defaults = { name: 'Player', team: -1, skill: 'normal', sens: 1, vol: 0.7, fov: 80, res: 1 };
let settings = { ...defaults };
try { Object.assign(settings, JSON.parse(localStorage.getItem('octo.settings') || '{}')); } catch (_) {}
const saveSettings = () => { try { localStorage.setItem('octo.settings', JSON.stringify(settings)); } catch (_) {} };
for (const k of ['name', 'team', 'skill', 'sens', 'vol', 'fov', 'res']) {
  const el = $(k); el.value = settings[k];
  el.addEventListener('input', () => { settings[k] = (k === 'name' || k === 'skill') ? el.value : parseFloat(el.value); saveSettings(); if (k === 'vol') sfx.setVolume(settings.vol); });
}
sfx.setVolume(settings.vol);
if (matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches) setStatus('This game needs a keyboard and mouse - open it on a computer.', true);
if (params.get('join')) $('joinCode').value = params.get('join').toUpperCase();

// ------------------------------------------------------------------ game state
const G = { active: false, session: null, renderer: null, map: null, canvas: null, locked: false, buyOpen: false, test: false, showScore: false,
  body: { x: 0, y: 0, z: 0, vy: 0, grounded: true }, yaw: 0, pitch: 0, sq: -1, fireT: 0, kick: 0, speed: 0, scoped: false, specId: -1,
  sendT: 0, stepT: 0, prevReload: false, reloadStart: 0, reloadDur: 1, hitT: 0, dmgT: 0, boomT: 0, nextBeep: 0, last: 0, fps: 60, remoteStep: [], phaseSeen: -1, lastEnd: -1 };
const keys = new Set(); let mouseL = false, mouseR = false, lmbEdge = false, mdx = 0, mdy = 0, wheel = 0;

function setStatus(t, bad = false) { const s = $('status'); s.textContent = t; s.style.color = bad ? '#ff8a8a' : '#ffd27a'; }
function makeCanvas() {
  const old = $('gl'); const c = document.createElement('canvas'); c.id = 'gl'; old.replaceWith(c); G.canvas = c;
  c.addEventListener('contextmenu', (e) => e.preventDefault());
}
G.canvas = $('gl');

// ------------------------------------------------------------------ menu actions
async function startSolo() {
  sfx.init();
  try { enterGame(new LocalSession({ name: settings.name || 'Player', team: settings.team, skill: settings.skill }), builtinMap()); if (!G.test) lock(); }
  catch (e) { console.error(e); setStatus('Could not start the game: ' + e.message, true); }
}
async function startHost() {
  sfx.init();
  if (!netAvailable()) return setStatus('Multiplayer library failed to load (blocked by a filter?).', true);
  setStatus('Creating room...'); $('hostBtn').disabled = true;
  const hn = new HostNet();
  try {
    const code = await hn.open();
    const s = new LocalSession({ name: settings.name || 'Player', team: settings.team, skill: settings.skill, hostNet: hn }); s.roomCode = code;
    enterGame(s, builtinMap()); showPause('Hosting', 'Click to play. Share the room code so friends can join.');
  } catch (e) { hn.close(); setStatus('Could not create a room: ' + e.message + '. (This needs internet access to the PeerJS broker.)', true); }
  $('hostBtn').disabled = false;
}
async function startJoin() {
  sfx.init();
  const code = $('joinCode').value.trim();
  if (code.length < 4) return setStatus('Enter the 5-letter room code first.', true);
  if (!netAvailable()) return setStatus('Multiplayer library failed to load (blocked by a filter?).', true);
  setStatus('Connecting...'); $('joinBtn').disabled = true;
  const cn = new ClientNet();
  try {
    await cn.connect(code);
    const s = new RemoteSession(cn, settings.name || 'Player', (m) => leaveGame(m));
    const t0 = performance.now();
    await new Promise((res, rej) => { const iv = setInterval(() => { if (s.closed) { clearInterval(iv); rej(new Error(s.err || 'Closed')); } else if (s.snap && s.myId >= 0) { clearInterval(iv); res(); } else if (performance.now() - t0 > 8000) { clearInterval(iv); rej(new Error('Host did not answer')); } }, 50); });
    enterGame(s, builtinMap()); showPause('Connected', 'Click to play');
  } catch (e) { cn.close(); setStatus('Could not join: ' + e.message, true); }
  $('joinBtn').disabled = false;
}
$('playSolo').onclick = startSolo; $('hostBtn').onclick = startHost; $('joinBtn').onclick = startJoin;
$('joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') startJoin(); });

function enterGame(session, map) {
  if (G.active) leaveGame('');
  makeCanvas();
  G.renderer = new Renderer(G.canvas, map, { pixelRatio: settings.res });
  G.session = session; G.map = map; G.active = true; G.sq = -1; G.specId = -1; G.kick = 0; G.fireT = 0; G.prevReload = false; G.scoped = false; G.buyOpen = false; G.phaseSeen = -1; G.lastEnd = -1;
  $('menu').classList.add('hidden'); $('hud').classList.remove('hidden'); $('buy').classList.add('hidden'); $('score').classList.add('hidden'); $('banner').style.display = 'none';
  $('roomBox').classList.toggle('hidden', !session.roomCode); $('roomCode').textContent = session.roomCode || '';
  setStatus(''); G.last = performance.now();
}
function leaveGame(msg) {
  if (!G.active) return;
  G.active = false; try { G.session.close(); } catch (_) {} try { G.renderer.dispose(); } catch (_) {}
  G.session = null; G.renderer = null; G.buyOpen = false; keys.clear(); mouseL = mouseR = false;
  if (document.pointerLockElement) document.exitPointerLock();
  $('hud').classList.add('hidden'); $('pause').classList.add('hidden'); $('menu').classList.remove('hidden'); setStatus(msg || '', !!msg);
  makeCanvas();
}
$('leave').onclick = () => leaveGame('');
$('resume').onclick = () => lock();
$('pause').addEventListener('click', (e) => { if (e.target === $('pause')) lock(); });
$('fullscreen').onclick = () => { const d = document.documentElement; if (document.fullscreenElement) document.exitFullscreen(); else if (d.requestFullscreen) d.requestFullscreen().catch(() => {}); };
$('copyInvite').onclick = () => { const url = location.origin + location.pathname + '?join=' + $('roomCode').textContent; (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(() => { $('copyInvite').textContent = 'Copied!'; setTimeout(() => $('copyInvite').textContent = 'Copy invite link', 1500); }).catch(() => prompt('Copy this link:', url)); };

// ------------------------------------------------------------------ pointer lock / pause overlay
function lock() {
  sfx.init(); if (!G.canvas) return;
  try { const p = G.canvas.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { G.canvas.requestPointerLock(); } catch (_) {} }); }
  catch (_) { try { G.canvas.requestPointerLock(); } catch (_2) {} }
}
function showPause(title, sub) { $('pauseTitle').textContent = title; $('pauseSub').textContent = sub; $('pause').classList.remove('hidden'); }
document.addEventListener('pointerlockchange', () => {
  G.locked = document.pointerLockElement === G.canvas;
  if (!G.active) return;
  if (G.locked) $('pause').classList.add('hidden');
  else if (!G.buyOpen && !G.test) {
    const solo = G.session instanceof LocalSession && !G.session.isHost;
    showPause(solo ? 'Paused' : 'Menu', solo ? 'Click to resume' : 'Click to resume (the match keeps running)');
  }
});
document.addEventListener('pointerlockerror', () => { if (G.active) showPause('Click to play', 'The browser needs another click to capture the mouse'); });

// ------------------------------------------------------------------ input
const GAME_KEYS = new Set(['Tab', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyB', 'KeyR', 'KeyE', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'ShiftLeft']);
window.addEventListener('keydown', (e) => {
  if (!G.active) return;
  if (GAME_KEYS.has(e.code)) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  const me = meSnap(); if (!me) return;
  if (e.code === 'KeyB') toggleBuy();
  else if (e.code === 'Escape' && G.buyOpen) toggleBuy(false);
  else if (e.code === 'Tab') G.showScore = true;
  else if (/^Digit[1-9]$/.test(e.code)) { const n = +e.code.slice(5); if (G.buyOpen) buyKey(n); else if (n <= 3) G.session.sendCmd('switch', n); }
  else if (e.code === 'KeyR') G.session.sendCmd('reload', 0);
});
window.addEventListener('keyup', (e) => { keys.delete(e.code); if (e.code === 'Tab') G.showScore = false; if (GAME_KEYS.has(e.code) && G.active) e.preventDefault(); });
window.addEventListener('blur', () => { keys.clear(); mouseL = mouseR = false; G.showScore = false; });
window.addEventListener('mousedown', (e) => {
  if (!G.active || (!G.locked && !G.test)) return;
  if (e.target.closest && e.target.closest('#buy')) return;
  if (e.button === 0) { mouseL = true; lmbEdge = true; } if (e.button === 2) mouseR = true;
});
window.addEventListener('mouseup', (e) => { if (e.button === 0) mouseL = false; if (e.button === 2) mouseR = false; });
document.addEventListener('mousemove', (e) => { if (G.locked) { mdx += e.movementX; mdy += e.movementY; } });
window.addEventListener('wheel', (e) => { if (G.active && G.locked) wheel += Math.sign(e.deltaY); }, { passive: true });
window.addEventListener('beforeunload', () => { try { G.session && G.session.close(); } catch (_) {} });

// ------------------------------------------------------------------ buy menu
const buyBtns = [...document.querySelectorAll('#buy button')]; let buyCache = '';
function rifleFor(team) { return team ? W.M4 : W.AK47; }
function buyItemOf(btn, team) { return btn.dataset.item === 'rifle' ? rifleFor(team) : +btn.dataset.item; }
function toggleBuy(force) {
  const me = meSnap(); if (!me) return;
  const want = force === undefined ? !G.buyOpen : force;
  if (want && !(me.a && G.snap().ph === PHASE.FREEZE)) { sfx.deny(); return; }
  G.buyOpen = want; $('buy').classList.toggle('hidden', !want); buyCache = '';
  if (want) { if (document.pointerLockElement) document.exitPointerLock(); } else lock();
}
function owns(me, item) { return item === ITEM.KEVLAR ? me.ar >= 100 : item === ITEM.HELMET ? (me.ar >= 100 && (me.fl & 2)) : item === ITEM.KIT ? (me.fl & 1) : (me.p1 === item || me.p2 === item); }
function doBuy(item) {
  const me = meSnap(); if (!me || !me.a) return;
  const tm = itemTeam(item), ok = (tm < 0 || tm === me.tm) && me.m >= itemPrice(item) && !owns(me, item);
  if (!ok) { sfx.deny(); return; } G.session.sendCmd('buy', item); sfx.buy();
}
function buyKey(n) { const b = buyBtns.find(x => +x.dataset.k === n); if (b) doBuy(buyItemOf(b, meSnap().tm)); }
buyBtns.forEach(b => b.addEventListener('click', () => { const me = meSnap(); if (me) doBuy(buyItemOf(b, me.tm)); }));
function refreshBuy(me) {
  $('buyMoney').textContent = '$' + me.m;
  const sig = JSON.stringify([me.m, me.tm, me.p1, me.p2, me.ar, me.fl]); if (sig === buyCache) return; buyCache = sig;
  for (const b of buyBtns) {
    const it = buyItemOf(b, me.tm), tm = itemTeam(it), side = tm >= 0 && tm !== me.tm, own = owns(me, it), afford = me.m >= itemPrice(it);
    b.disabled = side; b.className = (!afford && !own ? 'no ' : '') + (own ? 'own' : '');
    b.innerHTML = `<b>${b.dataset.k}. ${itemName(it)}</b><span>${side ? (tm ? 'CT only' : 'T only') : own ? 'owned' : '$' + itemPrice(it)}</span>`;
  }
}

// ------------------------------------------------------------------ helpers
G.snap = () => G.session.snap;
function meSnap() { return G.active && G.session && G.session.snap ? G.session.snap.pl[G.session.myId] : null; }
let msgTimer = 0;
function centerMsg(text, color = '#fff', ms = 1800) { const el = $('centerMsg'); el.textContent = text; el.style.color = color; el.classList.add('on'); clearTimeout(msgTimer); msgTimer = setTimeout(() => el.classList.remove('on'), ms); }
const teamClass = (t) => t ? 'tCT' : 'tT';
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ events from the simulation
function handleEvents(snap, pos, cam) {
  const me = G.session.myId;
  for (const e of G.session.takeEvents()) {
    switch (e.type) {
      case 'shot': {
        const p = snap.pl[e.id], R = G.renderer; if (!p) break;
        for (const en of e.e) R.impact(en[0], en[1], en[2], en[3] === 1);
        if (e.id === me) break;                                      // my own shots are predicted locally
        const o = e.o, dx = o[0] - cam.x, dz = o[2] - cam.z, dist = Math.hypot(dx, dz);
        sfx.shot(e.w, dist, angleDiff(Math.atan2(dx, -dz), cam.yaw));
        const pl = R.players[e.id]; if (pl) R.muzzleFlash(pl);
        const pp = pos[e.id], yaw = pp ? pp.yaw : 0, rx = Math.cos(yaw), rz = Math.sin(yaw);
        for (const en of e.e.slice(0, e.w === W.NOVA ? 3 : 1)) {
          const d = { x: en[0] - o[0], y: en[1] - o[1], z: en[2] - o[2] }, L = Math.hypot(d.x, d.y, d.z) || 1;
          R.addTracer([o[0] + d.x / L * 0.8 + rx * 0.2, o[1] - 0.25 + d.y / L * 0.8, o[2] + d.z / L * 0.8 + rz * 0.2], [en[0], en[1], en[2]], 0.07);
        }
        break;
      }
      case 'hit':
        if (e.a === me) { G.hitT = 0.2; $('hitmark').classList.add('on'); $('hitmark').classList.toggle('head', !!e.head); sfx.hit(e.head); }
        if (e.v === me) { G.dmgT = 0.45; sfx.hurt(); }
        break;
      case 'kill': {
        const k = e.k >= 0 ? snap.pl[e.k] : null, v = snap.pl[e.v]; if (!v) break;
        const d = document.createElement('div'); if (e.k === me || e.v === me) d.className = 'me';
        d.innerHTML = `<span class="${k ? teamClass(k.tm) : ''}">${k ? esc(k.n) : 'BOMB'}</span> [${wdef(e.w).name}${e.head ? ' HS' : ''}] <span class="${teamClass(v.tm)}">${esc(v.n)}</span>`;
        const feed = $('feed'); feed.appendChild(d); setTimeout(() => d.remove(), 5000); while (feed.children.length > 6) feed.firstChild.remove();
        break;
      }
      case 'plant': { const p = snap.pl[e.id]; centerMsg('The bomb has been planted', '#ff7a5a', 2500); const pp = pos[e.id]; if (pp) sfx.plant(Math.hypot(pp.x - cam.x, pp.z - cam.z), angleDiff(Math.atan2(pp.x - cam.x, -(pp.z - cam.z)), cam.yaw)); break; }
      case 'defuse': centerMsg('The bomb has been defused', '#7ad7ff', 2500); sfx.plant(); break;
      case 'explode': G.renderer.explode(e.x, e.y, e.z); sfx.boom(); break;
      case 'bomb_drop': centerMsg('The bomb has been dropped', '#ffd75a', 1500); break;
      case 'pickup': { const p = snap.pl[e.id]; if (e.id === me) centerMsg('You picked up the bomb', '#ffd75a', 1500); break; }
      case 'round_start': G.renderer.tracers.forEach(t => G.renderer.scene.remove(t.line)); G.renderer.tracers.length = 0; sfx.roundStart(); $('feed').innerHTML = ''; break;
      case 'live': centerMsg('GO!', '#7dff9a', 1000); break;
      case 'round_end': { const mine = snap.pl[me] ? snap.pl[me].tm : 0; (e.winner === mine ? sfx.win() : sfx.lose()); break; }
      case 'halftime': centerMsg('Halftime - switching sides', '#ffd75a', 3000); break;
      case 'buy': break;
    }
  }
}

// ------------------------------------------------------------------ local player (client-side movement + shooting)
function localUpdate(dt, snap, me, pos) {
  const ses = G.session, w = wdef(me.w), ph = snap.ph;
  if (me.sq !== G.sq) { G.sq = me.sq; G.body.x = me.x; G.body.y = me.y; G.body.z = me.z; G.body.vy = 0; G.body.grounded = true; G.yaw = me.yw; G.pitch = 0; G.kick = 0; G.fireT = 0.2; if (G.buyOpen && ph !== PHASE.FREEZE) toggleBuy(false); }
  G.fireT -= dt; G.kick *= Math.exp(-dt * 6);
  const frozen = ph === PHASE.FREEZE || ph === PHASE.MATCHEND;
  const look = G.locked || G.test;
  const sens = 0.0022 * settings.sens * (G.scoped ? 0.35 : 1);
  if (me.a) {
    if (look) { G.yaw += mdx * sens; G.pitch = clamp(G.pitch - mdy * sens, -1.5, 1.5); }
    mdx = mdy = 0;
    G.scoped = me.w === W.AWP && mouseR && !G.buyOpen && look;
    let mx = 0, mz = 0;
    if (!frozen && !G.buyOpen) {
      const fx = Math.sin(G.yaw), fz = -Math.cos(G.yaw), rx = Math.cos(G.yaw), rz = Math.sin(G.yaw);
      if (keys.has('KeyW')) { mx += fx; mz += fz; } if (keys.has('KeyS')) { mx -= fx; mz -= fz; }
      if (keys.has('KeyD')) { mx += rx; mz += rz; } if (keys.has('KeyA')) { mx -= rx; mz -= rz; }
    }
    const len = Math.hypot(mx, mz); if (len > 0) { mx /= len; mz /= len; }
    const walk = keys.has('ShiftLeft'), speed = RUN * w.speed * (walk ? 0.5 : 1) * (G.scoped ? 0.6 : 1);
    G.speed = len > 0 ? speed : 0;
    moveBody(G.body, mx * speed, mz * speed, !frozen && !G.buyOpen && keys.has('Space'), dt, G.map);
    if (len > 0 && G.body.grounded && !walk) { G.stepT -= dt; if (G.stepT <= 0) { G.stepT = 0.38; sfx.step(); } } else G.stepT = Math.min(G.stepT, 0.1);
    // reload bookkeeping (animation + sound)
    const rl = !!(me.fl & 8); if (rl && !G.prevReload) { G.reloadStart = performance.now(); G.reloadDur = w.reload * 1000; sfx.reload(); G.renderer.startReload(); } G.prevReload = rl;
    // shooting
    const trigger = w.auto ? mouseL : lmbEdge;
    if (trigger && G.fireT <= 0 && !frozen && !G.buyOpen && look && (w.slot === 3 || (me.am > 0 && !rl))) {
      G.fireT = w.interval;
      let spr = w.spread * 0.5 * (1 + G.kick) + G.speed * 0.0012 + (G.body.grounded ? 0 : 0.04);
      if (w.pellets > 1) spr = G.speed * 0.0006;
      if (me.w === W.AWP) spr = G.scoped ? (G.speed > 0 ? 0.02 : 0.0005) : 0.08;
      if (w.slot === 3) spr = 0;
      const dir = fwdVec(G.yaw + rnd(-1, 1) * spr, G.pitch + rnd(-1, 1) * spr);
      const ok = ses.sendShoot(dir);
      if (ok) {
        sfx.shot(me.w, 0, 0);
        if (w.slot !== 3) {
          const o = { x: G.body.x, y: G.body.y + EYE, z: G.body.z }, R = G.renderer, rx = Math.cos(G.yaw), rz = Math.sin(G.yaw);
          const n = Math.min(w.pellets, 3);
          for (let k = 0; k < n; k++) {
            const dd = w.pellets > 1 ? fwdVec(G.yaw + rnd(-1, 1) * w.spread, G.pitch + rnd(-1, 1) * w.spread) : dir;
            const t = rayWorld(G.map, o, dd, 120);
            R.addTracer([o.x + dd.x * 0.7 + rx * 0.16, o.y - 0.14 + dd.y * 0.7, o.z + dd.z * 0.7 + rz * 0.16], [o.x + dd.x * t, o.y + dd.y * t, o.z + dd.z * t], 0.06);
          }
          R.kickView(0.5 + w.kick * 8); R.fireVm();
          G.pitch += w.kick * 0.45 * (G.scoped ? 0.4 : 1); G.yaw += rnd(-1, 1) * w.kick * 0.22; G.kick = Math.min(2, G.kick + w.kick * 20);
        } else G.renderer.kickView(0.8);
      }
    }
    // wheel switching
    if (wheel !== 0 && look && !G.buyOpen) {
      const slots = [1, 2, 3].filter(s => (s === 1 ? me.p1 : s === 2 ? me.p2 : 1)), cur = Math.max(0, slots.indexOf(w.slot));
      ses.sendCmd('switch', slots[((cur + wheel) % slots.length + slots.length) % slots.length]);
    }
    wheel = 0;
    if (performance.now() - G.sendT > 16) { G.sendT = performance.now(); ses.sendState({ x: G.body.x, y: G.body.y, z: G.body.z, yaw: G.yaw, pitch: G.pitch, use: keys.has('KeyE') && !G.buyOpen }); }
  } else {
    mdx = mdy = 0; wheel = 0; G.scoped = false; G.speed = 0; G.prevReload = false;
    // spectate a living player (teammates first); click cycles
    const ok = (i) => i >= 0 && snap.pl[i] && snap.pl[i].a && i !== ses.myId;
    const pick = (from, sameTeam) => { for (let k = 1; k <= 10; k++) { const i = (from + k + 10) % 10; if (ok(i) && (!sameTeam || snap.pl[i].tm === me.tm)) return i; } return -1; };
    if (!ok(G.specId)) { G.specId = pick(ses.myId, true); if (!ok(G.specId)) G.specId = pick(ses.myId, false); }
    if (lmbEdge && G.specId >= 0) G.specId = pick(G.specId, true) >= 0 ? pick(G.specId, true) : pick(G.specId, false);
  }
  lmbEdge = false;
}

// ------------------------------------------------------------------ HUD
const hudCache = {};
function setTxt(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function updateHud(dt, snap, me, pos, now) {
  const w = wdef(me.w), ses = G.session, ph = snap.ph;
  setTxt('sT', snap.sc[0]); setTxt('sC', snap.sc[1]);
  const tm = $('timer'); let t = '', cls = '';
  if (ph === PHASE.WARMUP) t = '--'; else if (snap.bomb[0] === BOMB.PLANTED) { t = Math.ceil(snap.bomb[4]) + 's'; cls = 'bomb'; }
  else { const s = Math.ceil(snap.left); t = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); if (ph === PHASE.FREEZE) cls = 'freeze'; }
  setTxt('timer', t); if (tm.className !== cls) tm.className = cls;
  setTxt('roundlbl', 'Round ' + snap.rd + (ph === PHASE.FREEZE ? ' - BUY TIME [B]' : ''));
  setTxt('hp', me.hp); $('hp').className = me.hp <= 30 ? 'low' : ''; setTxt('ar', me.ar + ((me.fl & 2) ? ' H' : '') + ((me.fl & 1) ? ' K' : '')); setTxt('money', '$' + me.m);
  setTxt('wname', w.name);
  const am = $('ammo'); const a = w.mag > 0 ? ((me.fl & 8) ? 'RELOADING' : `${me.am} <small>/ ${me.rs}</small>`) : ''; if (hudCache.ammo !== a) { hudCache.ammo = a; am.innerHTML = a; }
  const inv = [[1, me.p1], [2, me.p2], [3, W.KNIFE]].filter(x => x[1]).map(([s, id]) => `<span class="${id === me.w ? 'sel' : ''}">${s} ${wdef(id).name}</span>`).join('') + ((me.fl & 4) ? '<span>C4</span>' : '');
  if (hudCache.inv !== inv) { hudCache.inv = inv; $('inv').innerHTML = inv; }
  // crosshair, scope, overlays
  const cross = $('crosshair'); cross.style.display = (me.a && !G.scoped) ? '' : 'none'; cross.style.setProperty('--gap', (6 + G.speed * 1.2 + G.kick * 5 + (G.body.grounded ? 0 : 8)).toFixed(1) + 'px');
  $('scope').style.display = G.scoped ? 'block' : 'none';
  G.hitT -= dt; if (G.hitT <= 0) $('hitmark').classList.remove('on');
  G.dmgT -= dt; $('vignette').style.opacity = G.dmgT > 0 ? Math.min(1, G.dmgT * 1.8) : (me.a && me.hp <= 25 ? 0.25 : 0);
  G.boomT = Math.max(0, G.boomT - dt * 0.8);
  // prompts
  let prompt = '', prog = me.pg;
  if (me.a && ph === PHASE.LIVE) {
    const b = snap.bomb, near = Math.hypot(G.body.x - b[1], G.body.z - b[3]) < 1.8;
    const inSite = G.map.sites.some(s => G.body.x >= s.x0 && G.body.x <= s.x1 && G.body.z >= s.z0 && G.body.z <= s.z1);
    if ((me.fl & 4) && b[0] === BOMB.CARRIED) prompt = inSite ? 'Hold E to plant the bomb' : 'You have the bomb - get to site A or B';
    else if (me.tm === 1 && b[0] === BOMB.PLANTED && near) prompt = 'Hold E to defuse';
  }
  setTxt('prompt', prompt); const pr = $('progress'); pr.style.display = prog > 0 ? 'block' : 'none'; pr.firstElementChild.style.width = Math.round(prog * 100) + '%';
  setTxt('spec', !me.a && ph !== PHASE.WARMUP ? (G.specId >= 0 ? 'Spectating ' + snap.pl[G.specId].n + '  (click: next player)' : 'You died') : '');
  // banner
  const ban = $('banner');
  if (ph === PHASE.ROUNDEND || ph === PHASE.MATCHEND) {
    const why = ['all enemies eliminated', 'the bomb exploded', 'the bomb was defused', 'time ran out'][snap.why & 3], tn = snap.win ? 'COUNTER-TERRORISTS' : 'TERRORISTS';
    ban.style.display = 'block'; ban.firstElementChild.textContent = ph === PHASE.MATCHEND ? tn + ' WIN THE MATCH' : tn + ' WIN THE ROUND'; ban.firstElementChild.style.color = snap.win ? 'var(--ct)' : 'var(--t)'; ban.lastElementChild.textContent = why;
  } else ban.style.display = 'none';
  // net info
  G.fps += (1 / Math.max(dt, 0.001) - G.fps) * 0.05;
  const lines = [Math.round(G.fps) + ' FPS']; if (ses instanceof RemoteSession) lines.push(Math.round(ses.ping) + ' ms');
  if (ses.roomCode) lines.push('Room ' + ses.roomCode + ' (' + ses.peers() + ' joined)');
  setTxt('netinfo', lines.join('  |  '));
  if (G.buyOpen) refreshBuy(me);
  drawRadar(snap, me, pos);
  if (G.showScore) drawScore(snap, me); else $('score').classList.add('hidden');
}
const radar = $('radar'), rctx = radar.getContext('2d');
function drawRadar(snap, me, pos) {
  const S = 170, c = S / 2, sc = 78 / 42; rctx.clearRect(0, 0, S, S);
  const vp = me.a ? G.body : (G.specId >= 0 && pos[G.specId] ? pos[G.specId] : G.body), vyaw = me.a ? G.yaw : (G.specId >= 0 && pos[G.specId] ? pos[G.specId].yaw : G.yaw);
  const fx = Math.sin(vyaw), fz = -Math.cos(vyaw), rx = Math.cos(vyaw), rz = Math.sin(vyaw);
  const to = (x, z) => { const dx = x - vp.x, dz = z - vp.z; let sx = (dx * rx + dz * rz) * sc, sy = -(dx * fx + dz * fz) * sc; const l = Math.hypot(sx, sy); if (l > 74) { sx *= 74 / l; sy *= 74 / l; } return [c + sx, c + sy]; };
  rctx.font = 'bold 14px system-ui'; rctx.textAlign = 'center'; rctx.textBaseline = 'middle'; rctx.fillStyle = '#ffd23c';
  for (const s of G.map.sites) { const [x, y] = to((s.x0 + s.x1) / 2, (s.z0 + s.z1) / 2); rctx.fillText(s.name, x, y); }
  const b = snap.bomb; if (b[0] === BOMB.PLANTED || b[0] === BOMB.DROPPED) { const [x, y] = to(b[1], b[3]); rctx.fillStyle = b[0] === BOMB.PLANTED ? '#ff3030' : '#ffd23c'; rctx.beginPath(); rctx.arc(x, y, 4, 0, 7); rctx.fill(); }
  for (let i = 0; i < snap.pl.length; i++) {
    const p = snap.pl[i], pp = pos[i]; if (!p || !pp || !p.a || p.tm !== me.tm || i === G.session.myId) continue;
    const [x, y] = to(pp.x, pp.z); rctx.fillStyle = me.tm ? '#4a8cff' : '#e9972f'; rctx.beginPath(); rctx.arc(x, y, 4, 0, 7); rctx.fill();
  }
  rctx.fillStyle = '#fff'; rctx.beginPath(); rctx.moveTo(c, c - 8); rctx.lineTo(c - 5, c + 5); rctx.lineTo(c + 5, c + 5); rctx.closePath(); rctx.fill();
}
function drawScore(snap, me) {
  const el = $('score'); el.classList.remove('hidden'); $('scoreTitle').textContent = `T ${snap.sc[0]}  :  ${snap.sc[1]} CT   (round ${snap.rd})`;
  const rows = (tm) => snap.pl.filter(p => p && p.tm === tm).sort((a, b) => b.k - a.k).map(p => `<tr class="${p.a ? '' : 'dead'} ${p.i === G.session.myId ? 'me' : ''}"><td class="${teamClass(tm)}">${esc(p.n)}${p.fl & 16 ? '' : ' (bot)'}</td><td class="money">${p.tm === me.tm ? '$' + p.m : ''}</td><td class="num">${p.k}</td><td class="num">${p.d}</td></tr>`).join('');
  const tbl = (tm, label) => `<table><tr><th>${label}</th><th>MONEY</th><th class="num">K</th><th class="num">D</th></tr>${rows(tm)}</table>`;
  const html = tbl(0, 'TERRORISTS') + tbl(1, 'COUNTER-TERRORISTS'); if (hudCache.score !== html) { hudCache.score = html; $('scoreBody').innerHTML = html; }
}

// ------------------------------------------------------------------ main loop
function frame(nowMs) {
  requestAnimationFrame(frame);
  if (!G.active) return;
  const dt = clamp((nowMs - G.last) / 1000, 0, 0.1); G.last = nowMs; const now = nowMs / 1000;
  const ses = G.session, solo = ses instanceof LocalSession && !ses.isHost;
  const paused = solo && !G.locked && !G.buyOpen && !G.test;
  if (!paused) ses.update(dt);
  const snap = ses.snap; if (!snap || ses.myId < 0) return;
  const me = snap.pl[ses.myId]; if (!me) { leaveGame('You were removed from the match'); return; }
  const pos = ses.getPositions();
  if (!paused) localUpdate(dt, snap, me, pos);
  // camera
  let cam = { x: G.body.x, y: G.body.y, z: G.body.z, yaw: G.yaw, pitch: G.pitch }, spectating = false;
  if (!me.a && G.specId >= 0 && pos[G.specId]) { const q = pos[G.specId]; cam = { x: q.x, y: q.y, z: q.z, yaw: q.yaw, pitch: q.pitch }; spectating = true; }
  else if (!me.a) cam.y = me.y;
  if (!paused) handleEvents(snap, pos, cam);
  // positional beeps / footsteps for others
  if (!paused && snap.bomb[0] === BOMB.PLANTED && now >= G.nextBeep) { G.nextBeep = now + 0.14 + snap.bomb[4] / 40 * 0.85; const dx = snap.bomb[1] - cam.x, dz = snap.bomb[3] - cam.z; sfx.beep(Math.hypot(dx, dz), angleDiff(Math.atan2(dx, -dz), cam.yaw)); }
  if (!paused) for (let i = 0; i < snap.pl.length; i++) {
    const p = snap.pl[i], r = G.renderer.players[i]; if (!p || !p.a || i === ses.myId || !r || r.speed < 4.2) continue;
    G.remoteStep[i] = (G.remoteStep[i] || 0) - dt; if (G.remoteStep[i] <= 0) { G.remoteStep[i] = 0.4; const pp = pos[i], dx = pp.x - cam.x, dz = pp.z - cam.z; sfx.step(Math.hypot(dx, dz), angleDiff(Math.atan2(dx, -dz), cam.yaw)); }
  }
  const w = wdef(me.w);
  G.renderer.draw({ snap, pos, me: ses.myId, camPos: cam, yaw: cam.yaw, pitch: cam.pitch, fov: settings.fov, alive: !!me.a, spectating, specId: G.specId,
    speed: G.speed, grounded: G.body.grounded, dt, now, scoped: G.scoped, reloadFrac: G.prevReload ? clamp((performance.now() - G.reloadStart) / G.reloadDur, 0, 1) : 0 });
  $('boomflash').style.opacity = G.renderer.flashT > 0 ? G.renderer.flashT : 0; G.renderer.flashT = Math.max(0, G.renderer.flashT - dt * 0.9);
  updateHud(dt, snap, me, pos, now);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------------ test hooks (used by the headless smoke test)
window.__octo = { G, keys, startSolo, settings, get snap() { return G.session && G.session.snap; } };
if (params.has('solo')) { G.test = true; settings.skill = params.get('skill') || settings.skill; startSolo(); }
