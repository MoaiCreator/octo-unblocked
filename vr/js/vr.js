// vr.js - the VR client: WebXR session, hands, belt, guns, physical reloads, scope, locomotion, HUD, bots.
// The same code runs a desktop preview (mouse + keyboard drive two virtual hands) so it can be tested without a headset.
import * as THREE from './vendor/three.module.min.js';
import { EYE, PHASE, BOMB, W, moveBody, clamp } from './core.js';
import { Sim } from './sim.js';
import { gridToWorld } from './world.js';
import { mergeMods, belt as beltGuns, applyToSim, BELT } from './osdata.js';
import { buildWorld } from './scene.js';
import { buildGun, buildMag, buildHand, buildBeltRing, buildPouch, buildPlayer } from './models.js';
import * as H from './handling.js';
import { Sfx } from './audio.js';

export async function loadData(base = '..') {
  const get = async (f) => { const r = await fetch(`${base}/data/${f}`, { cache: 'no-cache' }); if (!r.ok) throw new Error(f + ': ' + r.status); return r.json(); };
  const defs = await get('defaults.json'); let mods = null; try { mods = await get('mods.json'); } catch { /* no mods published */ }
  return { defs, mods, ...mergeMods(defs, mods) };
}

const REACH = { holster: 0.15, fore: 0.15, pull: 0.11, pouch: 0.16, insert: 0.1 };
const MOVE_SPEED = 3.2, BELT_R = 0.3;
const V = () => new THREE.Vector3();
const tmp = V(), tmp2 = V(), tmpQ = new THREE.Quaternion(), tmpM = new THREE.Matrix4(), UP = new THREE.Vector3(0, 1, 0);
const KIND_OF = Object.fromEntries(BELT.map((b) => [b.sim, b.kind]));

function canvasPlane(w, h, pw, ph) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false }));
  m.renderOrder = 5; return { mesh: m, ctx: c.getContext('2d'), tex: t, w, h };
}

export class Game {
  // opts: { data, mapIndex, name, team (-1 auto, 0 T, 1 CT), skill, bots, hand ('right'|'left'), turn ('snap45'|'snap30'|'smooth'), desktop }
  constructor(canvas, opts) {
    this.opts = opts; this.desktop = !!opts.desktop; this.canvas = canvas;
    const data = opts.data, m = data.maps[opts.mapIndex] || data.maps[0];
    applyToSim(data.defs.weapons, data.weapons);
    this.world = gridToWorld(m.rows, { name: m.name });
    this.sim = new Sim({ map: this.world, skill: opts.skill || 'normal', botsPerTeam: opts.bots ?? 4 });
    this.me = this.sim.addPlayer({ name: opts.name || 'VR Player', human: true, team: opts.team ?? -1 });
    this.sim.start();
    this.sfx = new Sfx(); this.sfx.init();

    const low = !!opts.lowGfx;                                                  // software GL in tests
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !low, powerPreference: 'high-performance' });
    r.setPixelRatio(low ? 0.5 : Math.min(window.devicePixelRatio || 1, 1.5)); r.outputColorSpace = THREE.SRGBColorSpace;
    r.xr.enabled = !this.desktop; r.xr.setReferenceSpaceType('local-floor'); r.xr.setFoveation?.(1);
    this.scene = new THREE.Scene();
    buildWorld(this.scene, this.world, r);
    this.rig = new THREE.Group(); this.scene.add(this.rig);
    this.camera = new THREE.PerspectiveCamera(72, 1, 0.03, 250); this.rig.add(this.camera);
    if (this.desktop) this.camera.position.y = EYE;
    this.body = { x: 0, y: 0, z: 0, vy: 0, grounded: true };
    this.yaw = 0; this.pitch = 0; this.spawnSeq = -1; this.lastSeq = 0; this.t = 0; this.events = [];
    this.headPos = V(); this.headQuat = new THREE.Quaternion(); this.headYaw = 0; this.headPitch = 0;

    this.buildHands(); this.buildBelt(); this.buildGuns(); this.buildHud(); this.buildFx();
    this.bots = [];
    this.resize(); this._resize = () => this.resize(); window.addEventListener('resize', this._resize);
    if (this.desktop) this.setupDesktop();
    this.clock = new THREE.Clock();
    r.setAnimationLoop((t, frame) => this.frame(frame));
    window.__vr = this;                                                        // for tests / debugging
  }
  async enterVR(session) { await this.renderer.xr.setSession(session); }
  dispose() {
    this.renderer.setAnimationLoop(null); window.removeEventListener('resize', this._resize);
    if (this._desk) for (const [ev, fn, tgt] of this._desk) (tgt || window).removeEventListener(ev, fn);
    this.renderer.dispose(); if (window.__vr === this) window.__vr = null;
  }
  resize() { const w = window.innerWidth, h = window.innerHeight; this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }

  // ---------------------------------------------------------------- hands
  newHand(side) {
    const h = { side, obj: new THREE.Group(), glove: buildHand(side), gamepad: null, source: null, held: null, needRelease: false,
      squeeze: false, trigger: 0, a: false, b: false, stick: { x: 0, y: 0 }, prev: { squeeze: false, trigger: 0, a: false, b: false },
      pos: V(), quat: new THREE.Quaternion(), dsq: false, dtr: 0, da: false, db: false, connected: this.desktop };
    h.obj.add(h.glove); return h;
  }
  buildHands() {
    this.hands = [this.newHand('right'), this.newHand('left')];                 // sides are re-set when controllers connect
    if (this.desktop) { for (const h of this.hands) this.scene.add(h.obj); return; }
    for (let i = 0; i < 2; i++) {
      const grip = this.renderer.xr.getControllerGrip(i), h = this.hands[i]; this.rig.add(grip); grip.add(h.obj); h.grip = grip;
      grip.addEventListener('connected', (e) => { h.source = e.data; h.gamepad = e.data.gamepad; h.side = e.data.handedness === 'left' ? 'left' : 'right'; h.connected = true; this.placeHud(); });
      grip.addEventListener('disconnected', () => { h.connected = false; h.gamepad = null; this.release(h); });
    }
  }
  other(h) { return h === this.hands[0] ? this.hands[1] : this.hands[0]; }
  handBySide(side) { return this.hands.find((h) => h.side === side) || this.hands[side === 'left' ? 1 : 0]; }
  get domSide() { return this.opts.hand === 'left' ? 'left' : 'right'; }
  pulse(h, v = 0.5, ms = 30) { try { const a = h.gamepad && h.gamepad.hapticActuators && h.gamepad.hapticActuators[0]; if (a) a.pulse(v, ms); } catch { /* no haptics */ } }

  readInputs() {
    for (const h of this.hands) {
      h.prev.squeeze = h.squeeze; h.prev.trigger = h.trigger; h.prev.a = h.a; h.prev.b = h.b;
      if (this.desktop) { h.squeeze = h.dsq; h.trigger = h.dtr; h.a = h.da; h.b = (h.dbFrames || 0) > 0; h.dbFrames = Math.max(0, (h.dbFrames || 0) - 1); continue; }
      const gp = h.gamepad; if (!gp) { h.squeeze = false; h.trigger = 0; continue; }
      const btn = (i) => gp.buttons[i] || { pressed: false, value: 0 };
      h.trigger = btn(0).value; h.squeeze = btn(1).pressed || btn(1).value > 0.5; h.a = btn(4).pressed; h.b = btn(5).pressed;
      h.stick.x = gp.axes[2] || 0; h.stick.y = gp.axes[3] || 0;
    }
  }

  // ---------------------------------------------------------------- belt with every gun + a mag pouch
  buildBelt() {
    this.belt = new THREE.Group(); this.scene.add(this.belt); this.belt.add(buildBeltRing(BELT_R));
    this.pouch = buildPouch(); this.pouch.position.set(0, -0.02, -BELT_R - 0.02); this.belt.add(this.pouch);
    this.holsters = []; this.beltYaw = null;
    const n = BELT.length;
    for (let i = 0; i < n; i++) {
      const a = (45 + i * (270 / (n - 1))) * Math.PI / 180;               // all around the waist except the front (pouch)
      const hs = new THREE.Group(); hs.position.set(Math.sin(a) * (BELT_R + 0.03), 0.02, -Math.cos(a) * (BELT_R + 0.03));
      hs.rotation.order = 'YXZ'; hs.rotation.y = -a; hs.rotation.x = -Math.PI / 2;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 6, 18), new THREE.MeshBasicMaterial({ color: 0xffc040, transparent: true, opacity: 0.25 }));
      ring.rotation.x = Math.PI / 2; ring.position.y = 0; hs.add(ring); hs.userData.ring = ring;
      this.belt.add(hs); this.holsters.push(hs);
    }
  }
  updateBelt(dt) {
    const fwd = tmp.set(0, 0, -1).applyQuaternion(this.headQuat); fwd.y = 0;
    const yaw = fwd.lengthSq() > 1e-4 ? Math.atan2(-fwd.x, -fwd.z) : this.beltYaw || 0;
    if (this.beltYaw === null) this.beltYaw = yaw;
    let d = yaw - this.beltYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.beltYaw += d * Math.min(1, dt * 5);
    const floorY = this.rig.position.y, headH = this.headPos.y - floorY;
    this.belt.position.set(this.headPos.x, floorY + clamp(headH - 0.68, 0.45, 1.3), this.headPos.z);
    // keep the belt slightly behind the eyes (around the spine)
    this.belt.position.x += Math.sin(this.beltYaw) * 0.08; this.belt.position.z += Math.cos(this.beltYaw) * 0.08;
    this.belt.rotation.y = this.beltYaw; this.belt.updateMatrixWorld(true);
  }

  // ---------------------------------------------------------------- guns
  buildGuns() {
    this.defs = beltGuns(this.opts.data.defs.weapons, this.opts.data.weapons);
    this.guns = this.defs.map((def, i) => {
      const g = H.newGun(def); g.slot = i; g.mesh = buildGun(def); g.supportBy = null; g.recoil = 0; g.flashT = 0; g.prevTip = null;
      this.scene.add(g.mesh);
      if (!def.melee) {                                                       // ammo counter on the side of the gun
        const lab = canvasPlane(128, 64, 0.05, 0.025); lab.mesh.rotation.y = -Math.PI / 2; lab.mesh.position.set(-0.034, 0.06, 0.0);
        g.mesh.add(lab.mesh); g.label = lab; g.labelText = '';
      }
      const ud = g.mesh.userData;
      if (ud.lens) {                                                          // scope: zoomed render target + reticle
        g.rt = new THREE.WebGLRenderTarget(512, 512); g.scopeCam = new THREE.PerspectiveCamera(9, 1, 0.7, 250);
        const ret = canvasPlane(256, 256, 0.048, 0.048), c = ret.ctx; c.fillStyle = '#000';
        c.beginPath(); c.arc(128, 128, 128, 0, Math.PI * 2); c.arc(128, 128, 116, 0, Math.PI * 2, true); c.fill();   // dark rim, round like the lens
        c.strokeStyle = '#000'; c.lineWidth = 2; c.beginPath(); c.moveTo(8, 128); c.lineTo(248, 128); c.moveTo(128, 8); c.lineTo(128, 248); c.stroke();
        c.lineWidth = 6; c.beginPath(); c.moveTo(8, 128); c.lineTo(88, 128); c.moveTo(168, 128); c.lineTo(248, 128); c.moveTo(128, 168); c.lineTo(128, 248); c.stroke();
        ret.tex.needsUpdate = true; ret.mesh.position.z = 0.001; ud.lens.add(ret.mesh); g.reticle = ret.mesh;
        g.lensDark = ud.lens.material; g.lensLive = new THREE.MeshBasicMaterial({ map: g.rt.texture });
      }
      return g;
    });
  }
  worldPoint(g, local, out = V()) { return out.copy(local).applyMatrix4(g.mesh.matrixWorld); }
  placeGuns(dt) {
    for (const g of this.guns) {
      const mesh = g.mesh, h = g.heldBy;
      g.recoil *= Math.exp(-dt * 12);
      if (h) {
        mesh.position.copy(h.pos);
        if (g.supportBy && g.def.twoHanded) {
          const up = tmp2.set(0, 1, 0).applyQuaternion(h.quat);
          const target = this.desktop ? this.desktopFore(h, tmp) : tmp.copy(g.supportBy.pos);
          tmpM.lookAt(h.pos, target, up); mesh.quaternion.setFromRotationMatrix(tmpM);
        } else mesh.quaternion.copy(h.quat);
        if (g.recoil > 1e-4) { mesh.quaternion.multiply(tmpQ.setFromAxisAngle(tmp.set(1, 0, 0), g.recoil)); mesh.translateZ(g.recoil * 0.25); }
      } else {
        const hs = this.holsters[g.slot]; hs.getWorldPosition(mesh.position); hs.getWorldQuaternion(mesh.quaternion);
      }
      mesh.updateMatrixWorld(true);
      const ud = mesh.userData;
      if (ud.mag) ud.mag.visible = !H.isTube(g) && g.mag !== null;
      if (ud.flash) { g.flashT -= dt; ud.flash.visible = g.flashT > 0; if (ud.flash.visible) ud.flash.rotation.z = Math.random() * 6; }
      if (g.label) {
        const txt = g.mag === null ? `-- | ${g.reserve}` : `${g.mag} | ${g.reserve}`;
        if (txt !== g.labelText) {
          g.labelText = txt; const { ctx, w, h: hh } = g.label; ctx.clearRect(0, 0, w, hh); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, 0, w, hh);
          ctx.font = 'bold 34px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = g.mag === null || g.mag === 0 ? '#ff6050' : '#ffffff'; ctx.fillText(txt, w / 2, hh / 2 + 2); g.label.tex.needsUpdate = true;
        }
      }
      // grab hints
      const other = h ? this.other(h) : null;
      if (ud.foreRing) ud.foreRing.material.opacity = h && g.def.twoHanded && !g.supportBy && other && !other.held && other.pos.distanceTo(this.worldPoint(g, ud.fore, tmp)) < REACH.fore ? 0.9 : 0;
      if (ud.wellRing) {
        const mh = this.hands.find((x) => x.held && x.held.type === 'mag' && x.held.gun === g);
        ud.wellRing.material.opacity = h && mh ? 0.9 : (h && !g.def.melee && g.mag === 0 ? 0.4 : 0);
      }
    }
    for (let i = 0; i < this.holsters.length; i++) {
      const hs = this.holsters[i], g = this.guns[i], ring = hs.userData.ring; hs.getWorldPosition(tmp);
      const near = this.hands.some((h) => !h.held && h.pos.distanceTo(tmp) < REACH.holster);
      ring.material.opacity = g && g.heldBy ? 0.08 : near ? 0.95 : 0.25; ring.material.color.setHex(near ? 0xffffff : 0xffc040);
    }
  }
  heldGun(h) { return h.held && h.held.type === 'gun' ? h.held.gun : null; }

  // ---------------------------------------------------------------- grabbing
  grab(h) {
    const o = this.other(h), og = this.heldGun(o);
    const ud = og ? og.mesh.userData : {};
    const dFore = og && og.def.twoHanded && !og.supportBy && ud.fore ? h.pos.distanceTo(this.worldPoint(og, ud.fore, tmp)) : 9;
    const dWell = og && ud.magwell && og.mag !== null && !H.isTube(og) ? h.pos.distanceTo(this.worldPoint(og, ud.magwell, tmp)) : 9;
    // 1. second hand onto the foregrip of a two-handed gun (unless the hand is closer to the mag)
    if (dFore < REACH.fore && !(dWell < REACH.pull && dWell < dFore)) {
      h.held = { type: 'fore', gun: og }; og.supportBy = h; og.support = true; this.pulse(h, 0.3, 20); return;
    }
    // 2. pull the mag out of the gun in the other hand
    if (dWell < REACH.pull) {
      H.pullMag(og); h.held = { type: 'oldmag', gun: og, mesh: this.handMag(h, og) }; this.sfx.click(); this.pulse(h, 0.4, 25); this.pulse(o, 0.3, 25); return;
    }
    // 3. take a fresh mag from the pouch (for the gun in the other hand)
    this.pouch.getWorldPosition(tmp);
    if (h.pos.distanceTo(tmp) < REACH.pouch) {
      if (!og || og.def.melee) { this.toast('Hold a gun in your other hand to take a mag for it'); this.sfx.deny(); return; }
      const n = H.takeMag(og);
      if (n <= 0) { this.toast('No ammo left for the ' + og.def.name); this.sfx.deny(); return; }
      h.held = { type: 'mag', gun: og, rounds: n, mesh: this.handMag(h, og) }; this.pulse(h, 0.3, 20); return;
    }
    // 4. draw a gun from its holster
    let best = null, bd = REACH.holster;
    for (const g of this.guns) { if (g.heldBy) continue; const d = h.pos.distanceTo(this.holsters[g.slot].getWorldPosition(tmp)); if (d < bd) { bd = d; best = g; } }
    if (best) { h.held = { type: 'gun', gun: best }; best.heldBy = h; h.glove.visible = false; this.pulse(h, 0.35, 25); this.sfx.click(); }
  }
  handMag(h, g) { const m = buildMag(g.def.kind); m.position.set(0, 0.04, -0.03); h.obj.add(m); h.glove.visible = true; return m; }
  dropVisual(h) {
    const m = h.held && h.held.mesh; if (!m) return;
    m.getWorldPosition(tmp); m.getWorldQuaternion(tmpQ); h.obj.remove(m); m.position.copy(tmp); m.quaternion.copy(tmpQ); this.scene.add(m);
    this.drops.push({ mesh: m, vy: 0, life: 4 });
  }
  release(h) {
    const held = h.held; if (!held) return;
    if (held.type === 'gun') {
      const g = held.gun; g.heldBy = null;
      if (g.supportBy) { const s = g.supportBy; if (s.held && s.held.type === 'fore') s.held = null; g.supportBy = null; g.support = false; }
      h.glove.visible = true;
    } else if (held.type === 'fore') { held.gun.supportBy = null; held.gun.support = false; }
    else if (held.type === 'mag') { H.dropMag(held.gun, held.rounds); this.dropVisual(h); }
    else if (held.type === 'oldmag') this.dropVisual(h);
    h.held = null;
  }
  // per frame: mags slide in when they reach the magwell, the eject button drops the mag
  handleHands() {
    for (const h of this.hands) {
      if (h.needRelease) { if (!h.squeeze) h.needRelease = false; }
      else if (h.squeeze && !h.prev.squeeze) this.grab(h);
      else if (!h.squeeze && h.prev.squeeze) this.release(h);
      const held = h.held;
      if (held && held.type === 'mag' && held.gun.heldBy && held.gun.mesh.userData.magwell) {
        const g = held.gun;
        if (h.pos.distanceTo(this.worldPoint(g, g.mesh.userData.magwell, tmp)) < REACH.insert && H.insertMag(g, held.rounds, g)) {
          h.obj.remove(held.mesh); h.held = null; h.needRelease = true; this.sfx.reload(); this.pulse(h, 0.6, 40); this.pulse(g.heldBy, 0.6, 40);
          if (H.isTube(g) && H.needsAmmo(g)) this.toast(`${g.mag}/${g.def.mag} shells`, 0.8);
        }
      }
      const g = this.heldGun(h);
      if (g && h.b && !h.prev.b && !H.isTube(g) && g.mag !== null && !g.def.melee) {           // mag release button
        H.pullMag(g); const m = buildMag(g.def.kind); this.worldPoint(g, g.mesh.userData.magwell, m.position); m.quaternion.copy(g.mesh.quaternion); this.scene.add(m);
        this.drops.push({ mesh: m, vy: -0.5, life: 4 }); this.sfx.click(); this.pulse(h, 0.3, 20);
      }
    }
  }

  // ---------------------------------------------------------------- shooting
  handleTriggers(now) {
    const p = this.sim.players[this.me], live = p.alive && this.sim.phase !== PHASE.FREEZE && this.sim.phase !== PHASE.MATCHEND;
    for (const h of this.hands) {
      const g = this.heldGun(h); if (!g) continue;
      const pressed = h.trigger > 0.6, edge = pressed && h.prev.trigger <= 0.6;
      let swing = false;
      if (g.def.melee) {                                                       // knife: trigger or a fast slash
        const tip = this.worldPoint(g, g.mesh.userData.muzzle, tmp2);
        if (g.prevTip) swing = tip.distanceTo(g.prevTip) / Math.max(1e-3, this.dt) > 3.2; g.prevTip = (g.prevTip || V()).copy(tip);
      }
      if (!(edge || (pressed && g.def.auto) || swing)) continue;
      if (!live) { if (edge) this.sfx.deny(); continue; }
      const why = H.blockReason(g, now);
      if (why) {
        if (!edge) continue;
        if (why === 'two-hands') { this.toast('Two hands! Grab the front of the ' + g.def.name); this.pulse(h, 0.2, 60); this.sfx.deny(); }
        else if (why === 'no-mag' || why === 'empty') { this.sfx.click(); if (why === 'no-mag') this.toast('No mag: take one from the pouch on the front of your belt', 1.5); }
        continue;
      }
      H.fire(g, now); this.shoot(g, h);
    }
  }
  shoot(g, h) {
    const d = g.def, ud = g.mesh.userData, o = this.worldPoint(g, ud.muzzle, V()), dir = V().set(0, 0, -1).applyQuaternion(g.mesh.quaternion);
    if (d.melee) { const hp = V(); g.mesh.getWorldPosition(hp); o.copy(hp); }
    else if (d.pellets <= 1) { const s = d.spread * (g.support ? 0.25 : 0.4); dir.x += (Math.random() - 0.5) * s; dir.y += (Math.random() - 0.5) * s; dir.z += (Math.random() - 0.5) * s; dir.normalize(); }
    this.sim.shootFrom(this.me, d, { x: o.x, y: o.y, z: o.z }, { x: dir.x, y: dir.y, z: dir.z });
    this.sfx.shot(d.id);
    if (!d.melee) { g.flashT = 0.05; g.recoil = Math.min(0.5, g.recoil + clamp(d.recoil * 10, 0.03, 0.3) * (g.support ? 0.45 : 1)); this.muzzleLight(o); }
    this.pulse(h, d.melee ? 0.5 : 0.8, d.kind === 'sniper' || d.kind === 'shotgun' ? 70 : 35);
    if (g.supportBy) this.pulse(g.supportBy, 0.5, 30);
  }

  // ---------------------------------------------------------------- scope (raise it to your eye)
  updateScopes() {
    for (const g of this.guns) {
      const ud = g.mesh.userData; if (!ud.lens) continue;
      let live = false;
      if (g.heldBy) {
        const rear = this.worldPoint(g, ud.scopeRear, tmp), dir = tmp2.set(0, 0, -1).applyQuaternion(g.mesh.quaternion);
        live = H.lookingThroughScope(this.eyePos(), rear, dir, 0.12, 18);
      }
      g.scoped = live; ud.lens.material = live ? g.lensLive : g.lensDark; g.reticle.visible = live;
      if (!live) continue;
      this.worldPoint(g, ud.scopeFront, g.scopeCam.position); g.scopeCam.quaternion.copy(g.mesh.quaternion); g.scopeCam.updateMatrixWorld(true);
      const r = this.renderer, xr = r.xr.enabled, old = r.getRenderTarget();
      r.xr.enabled = false; r.setRenderTarget(g.rt); r.render(this.scene, g.scopeCam); r.setRenderTarget(old); r.xr.enabled = xr;
    }
  }
  // which eye looks through the scope: in VR, the eye nearest the scope; the head centre otherwise
  eyePos() {
    if (this.renderer.xr.isPresenting) {
      const cams = this.renderer.xr.getCamera().cameras; if (cams && cams.length) {
        const g = this.guns.find((x) => x.heldBy && x.mesh.userData.lens); if (g) {
          const rear = this.worldPoint(g, g.mesh.userData.scopeRear, V()); let best = null, bd = 1e9;
          for (const c of cams) { const p = V().setFromMatrixPosition(c.matrixWorld); const d = p.distanceTo(rear); if (d < bd) { bd = d; best = p; } }
          if (best) return best;
        }
      }
    }
    return this.headPos;
  }

  // ---------------------------------------------------------------- movement (room-scale walking + stick)
  updateHead() {
    if (this.renderer.xr.isPresenting) { this.rig.updateMatrixWorld(true); this.renderer.xr.updateCamera(this.camera); }
    this.camera.updateMatrixWorld(true);
    this.camera.getWorldPosition(this.headPos); this.camera.getWorldQuaternion(this.headQuat);
    const f = tmp.set(0, 0, -1).applyQuaternion(this.headQuat);
    this.headYaw = Math.atan2(f.x, -f.z); this.headPitch = Math.asin(clamp(f.y, -1, 1));
  }
  locomotion(dt) {
    const sim = this.sim, p = sim.players[this.me], frozen = sim.phase === PHASE.FREEZE || !p.alive;
    let vx = 0, vz = 0;
    const moveHand = this.handBySide(this.domSide === 'right' ? 'left' : 'right'), turnHand = this.other(moveHand);
    const st = this.desktop ? this.deskMove : moveHand.stick;
    if (!frozen && Math.hypot(st.x, st.y) > 0.15) {
      const fx = Math.sin(this.headYaw), fz = -Math.cos(this.headYaw);         // forward on the floor
      vx = (fx * -st.y + -fz * st.x) * MOVE_SPEED; vz = (fz * -st.y + fx * st.x) * MOVE_SPEED;
    }
    // walking in the room moves the body; walls push the room back
    let wx = this.headPos.x - this.body.x, wz = this.headPos.z - this.body.z;
    if (Math.hypot(wx, wz) > 0.6) wx = wz = 0;                                  // too far (first frame, teleport): just recentre
    moveBody(this.body, vx + wx / dt, vz + wz / dt, false, dt, this.world);
    this.rig.position.x += this.body.x - this.headPos.x; this.rig.position.z += this.body.z - this.headPos.z; this.rig.position.y = this.body.y;
    this.headPos.x = this.body.x; this.headPos.z = this.body.z;
    // turning
    if (!this.desktop) {
      const tx = turnHand.stick.x, mode = this.opts.turn || 'snap45';
      if (mode === 'smooth') { if (Math.abs(tx) > 0.2) this.turn(-tx * 2.2 * dt); }
      else {
        if (Math.abs(tx) > 0.7 && !this.turnLatch) { this.turn(-Math.sign(tx) * (mode === 'snap30' ? 30 : 45) * Math.PI / 180); this.turnLatch = true; }
        if (Math.abs(tx) < 0.3) this.turnLatch = false;
      }
    }
    this.rig.updateMatrixWorld(true);
  }
  turn(a) {
    const hp = this.headPos; tmp.copy(this.rig.position).sub(hp).applyAxisAngle(UP, a);
    this.rig.position.copy(hp).add(tmp); this.rig.rotation.y += a; this.rig.updateMatrixWorld(true);
  }
  teleport(x, y, z, yaw) {
    this.body.x = x; this.body.y = y; this.body.z = z; this.body.vy = 0;
    if (this.desktop) { this.yaw = yaw; this.pitch = 0; }
    else this.turn(-(yaw - this.headYaw));
    this.updateHead(); this.rig.position.x += x - this.headPos.x; this.rig.position.z += z - this.headPos.z; this.rig.position.y = y; this.rig.updateMatrixWorld(true);
    this.updateHead(); this.beltYaw = null;
  }

  // ---------------------------------------------------------------- HUD
  buildHud() {
    this.wrist = canvasPlane(512, 256, 0.14, 0.07);
    this.toastP = canvasPlane(1024, 160, 0.9, 0.14); this.toastP.mesh.position.set(0, -0.18, -1.2); this.camera.add(this.toastP.mesh); this.toastP.mesh.visible = false;
    this.toastT = 0; this.hudT = 0;
    const sph = (c) => new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 12), new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false }));
    this.hurtS = sph(0xa00000); this.deadS = sph(0x101010); this.hurtS.renderOrder = this.deadS.renderOrder = 20; this.camera.add(this.hurtS, this.deadS);
    this.placeHud();
  }
  placeHud() {
    const h = this.handBySide(this.domSide === 'right' ? 'left' : 'right'), m = this.wrist.mesh;
    if (m.parent) m.parent.remove(m);
    h.obj.add(m); m.position.set(0, 0.045, 0.1); m.rotation.set(-1.0, 0, 0);
  }
  toast(text, sec = 2.5) {
    const { ctx, w, h, tex } = this.toastP; ctx.clearRect(0, 0, w, h); ctx.fillStyle = 'rgba(10,12,16,.7)'; ctx.fillRect(0, 20, w, h - 40);
    ctx.font = 'bold 54px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffd27a'; ctx.fillText(text, w / 2, h / 2, w - 40);
    tex.needsUpdate = true; this.toastP.mesh.visible = true; this.toastT = sec; this.lastToast = text;
  }
  drawHud() {
    const sim = this.sim, p = sim.players[this.me], { ctx, w, h, tex } = this.wrist;
    ctx.clearRect(0, 0, w, h); ctx.fillStyle = 'rgba(12,14,18,.82)'; ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.font = 'bold 44px system-ui, sans-serif'; ctx.fillStyle = p.hp > 30 ? '#7dff8a' : '#ff6050'; ctx.fillText(`+${Math.max(0, p.hp)}`, 18, 14);
    ctx.fillStyle = '#9cc8ff'; ctx.fillText(`◈${p.armor}`, 170, 14);
    const left = Math.max(0, sim.phaseEnd - sim.t), mm = Math.floor(left / 60), ss = String(Math.floor(left % 60)).padStart(2, '0');
    ctx.fillStyle = sim.bomb.state === BOMB.PLANTED ? '#ff6050' : '#fff'; ctx.textAlign = 'right'; ctx.fillText(sim.bomb.state === BOMB.PLANTED ? 'BOMB' : `${mm}:${ss}`, w - 18, 14);
    ctx.textAlign = 'left'; ctx.font = 'bold 36px system-ui, sans-serif';
    ctx.fillStyle = '#eba028'; ctx.fillText(`T ${sim.score[0]}`, 18, 80); ctx.fillStyle = '#6ea0ff'; ctx.fillText(`CT ${sim.score[1]}`, 120, 80);
    ctx.fillStyle = '#ccc'; ctx.fillText(p.team ? 'you: CT' : 'you: T', 260, 80);
    ctx.font = '30px system-ui, sans-serif'; ctx.fillStyle = '#fff';
    const held = this.hands.map((x) => this.heldGun(x)).filter(Boolean);
    ctx.fillText(held.length ? held.map((g) => `${g.def.name} ${g.def.melee ? '' : (g.mag ?? '--') + '/' + g.reserve}`).join('   ') : 'Squeeze grip at your belt to draw', 18, 140, w - 36);
    ctx.fillStyle = '#aaa'; ctx.font = '26px system-ui, sans-serif';
    ctx.fillText(p.hasBomb ? 'You have the bomb: hold A/X on a site' : sim.phase === PHASE.FREEZE ? 'Buy time: get ready' : `${this.world.name}`, 18, 196, w - 36);
    tex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- effects, bots, events
  buildFx() {
    this.tracers = []; this.drops = []; this.flashLight = new THREE.PointLight(0xffc060, 0, 10); this.scene.add(this.flashLight); this.flashLightT = 0;
    const N = 128; this.pN = N; this.pNext = 0;
    this.pPos = new Float32Array(N * 3).fill(9999); this.pCol = new Float32Array(N * 3); this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.06, vertexColors: true, transparent: true, depthWrite: false })); this.points.frustumCulled = false; this.scene.add(this.points);
    this.bombM = new THREE.Group(); const bb = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.24), new THREE.MeshStandardMaterial({ color: 0x4d4d45 })); bb.position.y = 0.07; this.bombM.add(bb);
    this.bombLed = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2020 })); this.bombLed.position.set(0.1, 0.16, 0); this.bombM.add(this.bombLed);
    this.bombM.visible = false; this.scene.add(this.bombM);
  }
  muzzleLight(o) { this.flashLight.position.copy(o); this.flashLight.intensity = 2.5; this.flashLightT = 0.05; }
  burst(x, y, z, col, n, speed) {
    for (let k = 0; k < n; k++) {
      const i = this.pNext; this.pNext = (i + 1) % this.pN;
      this.pPos.set([x, y, z], i * 3); this.pVel.set([(Math.random() - 0.5) * speed, Math.random() * speed, (Math.random() - 0.5) * speed], i * 3);
      this.pCol.set(col, i * 3); this.pLife[i] = 0.3 + Math.random() * 0.25;
    }
  }
  tracer(a, b, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(b[0], b[1], b[2])]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true })); this.scene.add(line); this.tracers.push({ line, life: 0.08 });
  }
  rel(x, z) { const dx = x - this.headPos.x, dz = z - this.headPos.z; return { dist: Math.hypot(dx, dz), rel: Math.atan2(dx, -dz) - this.headYaw }; }
  processEvents() {
    const sim = this.sim, me = this.me, p = sim.players[me];
    for (const e of sim.events) {
      if (e.seq <= this.lastSeq) continue; this.lastSeq = e.seq; this.events.push(e.type); if (this.events.length > 200) this.events.shift();
      switch (e.type) {
        case 'shot': {
          for (const end of e.e) { if (e.w !== W.KNIFE) this.tracer(e.o, end, e.id === me ? 0xfff0b0 : 0xffd27a); this.burst(end[0], end[1], end[2], end[3] ? [0.8, 0.1, 0.1] : [0.9, 0.8, 0.55], end[3] ? 7 : 4, 2.5); }
          if (e.id !== me) { const r = this.rel(e.o[0], e.o[2]); this.sfx.shot(e.w, r.dist, r.rel); const b = this.bots[e.id]; if (b) b.flashT = 0.06; }
          break;
        }
        case 'hit':
          if (e.a === me) this.sfx.hit(e.head);
          if (e.v === me) { this.sfx.hurt(); this.hurtS.material.opacity = 0.45; for (const h of this.hands) this.pulse(h, 0.7, 60); }
          break;
        case 'kill':
          if (e.k === me && e.v !== me) this.toast(`Killed ${sim.players[e.v].name}${e.head ? ' (headshot)' : ''}`, 1.6);
          if (e.v === me) this.toast(`Killed by ${e.k >= 0 ? sim.players[e.k].name : 'the bomb'}: wait for the next round`, 4);
          break;
        case 'round_start': this.sfx.roundStart(); this.toast(`Round ${e.round}: get ready`); break;
        case 'live': this.toast(p.hasBomb ? 'GO! You have the bomb' : 'GO!', 1.5); break;
        case 'round_end': { const won = e.winner === p.team; won ? this.sfx.win() : this.sfx.lose(); this.toast(`${e.winner ? 'Counter-Terrorists' : 'Terrorists'} win the round`, 3); break; }
        case 'plant': { const r = this.rel(sim.bomb.x, sim.bomb.z); this.sfx.plant(r.dist, r.rel); this.toast('The bomb has been planted', 2); break; }
        case 'defuse': this.toast('The bomb has been defused', 2); break;
        case 'explode': this.sfx.boom(); this.burst(e.x, e.y + 0.5, e.z, [1, 0.6, 0.15], 60, 14); break;
        case 'halftime': this.toast('Half time: switching sides', 3); break;
        default: break;
      }
    }
  }
  drawBots(dt) {
    const sim = this.sim;
    for (const p of sim.players) {
      let b = this.bots[p.id];
      if (!p.used || p.id === this.me) { if (b) b.g.visible = false; continue; }
      if (!b || b.team !== p.team) { if (b) this.scene.remove(b.g); b = this.bots[p.id] = buildPlayer(p.team); this.scene.add(b.g); }
      b.g.visible = true; b.g.position.set(p.x, p.y, p.z);
      if (b.prev) { const sp = Math.hypot(p.x - b.prev.x, p.z - b.prev.z) / Math.max(dt, 1e-3); b.speed += (Math.min(sp, 9) - b.speed) * Math.min(1, dt * 10); }
      b.prev = { x: p.x, z: p.z };
      if (p.alive) {
        b.fall = 0; b.g.rotation.set(0, 0, 0); b.body.rotation.y = -p.yaw; b.legL.rotation.y = b.legR.rotation.y = -p.yaw;
        b.step += b.speed * dt * 1.6; const sw = Math.sin(b.step) * Math.min(1, b.speed / 4) * 0.7; b.legL.rotation.x = sw; b.legR.rotation.x = -sw;
        b.armR.rotation.x = -1.35 - p.pitch * 0.6; b.armL.rotation.x = -1.2 - p.pitch * 0.6; b.gun.rotation.x = p.pitch * 0.9;
      } else {
        b.fall = Math.min(1, b.fall + dt * 3.2); b.g.rotation.order = 'YXZ'; b.g.rotation.y = -p.yaw; b.g.rotation.x = -b.fall * 1.45; b.body.rotation.y = 0; b.legL.rotation.y = b.legR.rotation.y = 0;
      }
      if (b.gunId !== p.cur) {
        b.gunId = p.cur; b.gun.clear();
        if (KIND_OF[p.cur]) { const m = buildGun({ id: p.cur, kind: KIND_OF[p.cur], melee: p.cur === W.KNIFE }); m.userData.flash.scale.setScalar(2); b.gun.add(m); b.gunMesh = m; } else b.gunMesh = null;
      }
      b.gun.visible = p.alive;
      if (b.gunMesh) { b.flashT -= dt; b.gunMesh.userData.flash.visible = b.flashT > 0; }
    }
  }
  updateFx(dt) {
    for (let i = this.tracers.length - 1; i >= 0; i--) { const t = this.tracers[i]; t.life -= dt; t.line.material.opacity = Math.max(0, t.life / 0.08); if (t.life <= 0) { this.scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); this.tracers.splice(i, 1); } }
    for (let i = 0; i < this.pN; i++) if (this.pLife[i] > 0) {
      this.pLife[i] -= dt; this.pVel[i * 3 + 1] -= 9 * dt; for (let k = 0; k < 3; k++) this.pPos[i * 3 + k] += this.pVel[i * 3 + k] * dt; if (this.pLife[i] <= 0) this.pPos[i * 3 + 1] = 9999;
    }
    this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.color.needsUpdate = true;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]; d.life -= dt; d.vy -= 9.8 * dt; d.mesh.position.y = Math.max(0.03 + this.floorAt(d.mesh.position), d.mesh.position.y + d.vy * dt);
      if (d.life <= 0) { this.scene.remove(d.mesh); this.drops.splice(i, 1); }
    }
    this.flashLightT -= dt; if (this.flashLightT <= 0) this.flashLight.intensity = 0;
    this.hurtS.material.opacity = Math.max(0, this.hurtS.material.opacity - dt * 1.2);
    const p = this.sim.players[this.me]; this.deadS.material.opacity += ((p.alive ? 0 : 0.65) - this.deadS.material.opacity) * Math.min(1, dt * 3);
    this.hurtS.visible = this.hurtS.material.opacity > 0.01; this.deadS.visible = this.deadS.material.opacity > 0.01;
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) this.toastP.mesh.visible = false; }
    const b = this.sim.bomb; this.bombM.visible = b.state === BOMB.PLANTED || b.state === BOMB.DROPPED;
    if (this.bombM.visible) { this.bombM.position.set(b.x, b.y, b.z); this.bombLed.visible = b.state !== BOMB.PLANTED || (this.t * (2 + (40 - Math.max(0, b.explodeAt - this.sim.t)) / 8)) % 1 < 0.2; }
  }
  floorAt(pos) { let y = 0; for (const b of this.world.boxes) if (pos.x > b.x0 && pos.x < b.x1 && pos.z > b.z0 && pos.z < b.z1 && b.y1 <= pos.y + 0.05 && b.y1 > y) y = b.y1; return y; }

  // ---------------------------------------------------------------- frame
  frame() {
    const dt = clamp(this.clock.getDelta(), 1e-3, 0.05); this.dt = dt; this.t += dt;
    const sim = this.sim, p = sim.players[this.me];
    this.readInputs();
    if (this.desktop) this.desktopUpdate(dt);
    this.updateHead();
    if (p.spawnSeq !== this.spawnSeq) {                                       // new round: back to spawn with full ammo
      this.spawnSeq = p.spawnSeq; this.teleport(p.x, p.y, p.z, p.yaw); p.armor = 100; p.helmet = true;
      for (const h of this.hands) if (h.held && h.held.type !== 'gun' && h.held.type !== 'fore') { if (h.held.mesh) h.obj.remove(h.held.mesh); h.held = null; }
      for (const g of this.guns) H.refill(g);
    }
    this.locomotion(dt);
    for (const h of this.hands) { h.obj.updateMatrixWorld(true); h.obj.getWorldPosition(h.pos); h.obj.getWorldQuaternion(h.quat); }
    this.updateBelt(dt);
    this.placeGuns(0);
    this.handleHands();
    this.placeGuns(dt);
    this.handleTriggers(sim.t);
    const use = this.hands.some((h) => h.a) || !!this.deskUse;
    sim.setPlayerState(this.me, { x: this.body.x, y: this.body.y, z: this.body.z, yaw: this.headYaw, pitch: this.headPitch, use });
    sim.tick(dt);
    this.processEvents();
    this.drawBots(dt); this.updateFx(dt);
    this.hudT -= dt; if (this.hudT <= 0) { this.hudT = 0.2; this.drawHud(); }
    this.updateScopes();
    this.renderer.render(this.scene, this.camera);
  }

  // ---------------------------------------------------------------- desktop preview: keyboard/mouse drive the two hands
  setupDesktop() {
    this.deskMove = { x: 0, y: 0 }; this.keys = {}; this.script = []; this.scoping = false; this.deskUse = false;
    const c = this.canvas, on = (ev, fn, tgt) => { (tgt || window).addEventListener(ev, fn); this._desk.push([ev, fn, tgt]); }; this._desk = [];
    on('mousedown', (e) => { if (document.pointerLockElement !== c) try { c.requestPointerLock?.(); } catch { /* not allowed */ } if (e.button === 0) this.gunHand().dtr = 1; if (e.button === 2) this.scoping = true; }, c);
    on('mouseup', (e) => { if (e.button === 0) this.gunHand().dtr = 0; if (e.button === 2) this.scoping = false; });
    on('contextmenu', (e) => e.preventDefault(), c);
    on('mousemove', (e) => { if (document.pointerLockElement !== c) return; this.yaw += e.movementX * 0.0025; this.pitch = clamp(this.pitch - e.movementY * 0.0025, -1.45, 1.45); });
    on('keydown', (e) => {
      this.keys[e.code] = true;
      const n = +e.key; if (n >= 1 && n <= 9) this.deskDraw(n - 1);
      if (e.code === 'KeyR') this.deskReload(); if (e.code === 'KeyF') this.deskSupport(); if (e.code === 'KeyQ') this.deskHolster();
      if (e.code === 'KeyG') this.gunHand().dbFrames = 2;
      if (e.code === 'KeyE') this.deskUse = true;
    });
    on('keyup', (e) => { this.keys[e.code] = false; if (e.code === 'KeyE') this.deskUse = false; });
  }
  gunHand() { return this.handBySide(this.domSide); }
  offHand() { return this.handBySide(this.domSide === 'right' ? 'left' : 'right'); }
  desktopFore(h, out) { const g = this.heldGun(h); if (!g || !g.mesh.userData.fore) return this.restPos(this.other(h), out); return out.copy(g.mesh.userData.fore).applyQuaternion(h.quat).add(h.pos); }
  restPos(h, out) {
    const side = h.side === 'right' ? 1 : -1;
    return out.set(side * (h === this.gunHand() ? 0.16 : 0.2), h === this.gunHand() ? -0.2 : -0.34, h === this.gunHand() ? -0.38 : -0.25).applyQuaternion(this.headQuat).add(this.headPos);
  }
  desktopTarget(h, out) {
    const g = this.heldGun(h);
    if (h === this.gunHand() && g && this.scoping && g.mesh.userData.scopeRear) {        // bring the scope up to the eye
      return out.copy(g.mesh.userData.scopeRear).negate().add(tmp2.set(0, 0, -0.05)).applyQuaternion(this.headQuat).add(this.headPos);
    }
    const o = this.other(h), og = this.heldGun(o);
    if (h.held && h.held.type === 'fore' && og) return this.desktopFore(o, out);
    return this.restPos(h, out);
  }
  desktopUpdate(dt) {
    const k = this.keys; this.deskMove.x = (k.KeyD ? 1 : 0) - (k.KeyA ? 1 : 0); this.deskMove.y = (k.KeyS ? 1 : 0) - (k.KeyW ? 1 : 0);
    this.camera.rotation.order = 'YXZ'; this.camera.rotation.y = -this.yaw; this.camera.rotation.x = this.pitch; this.camera.rotation.z = 0;
    this.camera.updateMatrixWorld(true); this.camera.getWorldPosition(this.headPos); this.camera.getWorldQuaternion(this.headQuat);
    // scripted hand moves (draw, reload, ...) run one step at a time
    const step = this.script[0];
    if (step) {
      const h = step.hand();
      if (step.squeeze !== undefined) { h.dsq = step.squeeze; step.done = (step.done || 0) + 1; if (step.done > 2) this.script.shift(); }
      else if (step.wait !== undefined) { step.wait -= dt; if (step.wait <= 0) this.script.shift(); }
      else {
        if (!step.from) { step.from = h.obj.position.clone(); step.el = 0; }
        step.el += dt; const f = Math.min(1, step.el / step.dur), e = f * f * (3 - 2 * f);
        h.obj.position.lerpVectors(step.from, step.to(tmp), e); h.pinned = step.to;
        if (f >= 1) this.script.shift();
      }
    }
    for (const h of this.hands) {
      const moving = step && step.dur !== undefined && step.hand() === h;
      if (!this.script.length) h.pinned = null;
      if (moving) { /* placed above */ } else if (h.pinned) h.obj.position.copy(h.pinned(tmp));     // stays where the script put it
      else h.obj.position.lerp(this.desktopTarget(h, tmp), Math.min(1, dt * 18));
      h.obj.quaternion.copy(this.headQuat);
    }
  }
  run(...steps) { this.script.push(...steps); }
  mv(hand, to, dur = 0.22) { return { hand, to, dur }; }
  sq(hand, v) { return { hand, squeeze: v }; }
  deskHolsterSteps() {
    const gh = () => this.gunHand(), oh = () => this.offHand(), g = this.heldGun(this.gunHand()), out = [];
    if (!g) return out;
    if (this.offHand().held) out.push(this.sq(oh, false));
    out.push(this.mv(gh, (o) => this.holsters[g.slot].getWorldPosition(o)), this.sq(gh, false));
    return out;
  }
  deskHolster() { if (!this.script.length) this.run(...this.deskHolsterSteps()); }
  deskDraw(i) {
    if (this.script.length || !this.guns[i]) return;
    const gh = () => this.gunHand(), oh = () => this.offHand(), g = this.guns[i];
    const steps = this.deskHolsterSteps();
    if (this.heldGun(this.gunHand()) === g) { this.run(...steps); return; }
    steps.push(this.mv(gh, (o) => this.holsters[i].getWorldPosition(o)), this.sq(gh, true));
    if (g.def.twoHanded) steps.push(this.mv(gh, (o) => this.restPos(gh(), o)), this.mv(oh, (o) => this.desktopFore(gh(), o)), this.sq(oh, true));
    this.run(...steps);
  }
  deskSupport() {
    if (this.script.length) return; const gh = () => this.gunHand(), oh = () => this.offHand();
    if (this.offHand().held) this.run(this.sq(oh, false));
    else if (this.heldGun(gh())) this.run(this.mv(oh, (o) => this.desktopFore(gh(), o)), this.sq(oh, true));
  }
  deskReload() {
    const gh = () => this.gunHand(), oh = () => this.offHand(), g = this.heldGun(this.gunHand());
    if (this.script.length || !g || g.def.melee) return;
    const well = (o) => this.worldPoint(g, g.mesh.userData.magwell, o), pouch = (o) => this.pouch.getWorldPosition(o);
    const steps = [];
    if (this.offHand().held) steps.push(this.sq(oh, false));
    if (H.isTube(g)) {
      const n = Math.min(g.def.mag - g.mag, g.reserve);
      for (let i = 0; i < n; i++) steps.push(this.mv(oh, pouch, 0.18), this.sq(oh, true), this.mv(oh, well, 0.18), this.sq(oh, false));
    } else {
      if (g.mag !== null) steps.push(this.mv(oh, well), this.sq(oh, true), this.mv(oh, (o) => well(o).add(tmp2.set(0, -0.3, 0)), 0.2), this.sq(oh, false));
      steps.push(this.mv(oh, pouch), this.sq(oh, true), this.mv(oh, well), { hand: oh, wait: 0.1 }, this.sq(oh, false));
    }
    if (g.def.twoHanded) steps.push(this.mv(oh, (o) => this.desktopFore(gh(), o)), this.sq(oh, true));
    this.run(...steps);
  }
}
