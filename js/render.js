// render.js - three.js scene: map, players, viewmodel, tracers, particles, bomb and explosion
import * as THREE from './vendor/three.module.min.js';
import { EYE, PH, W, BOMB, wdef } from './core.js';

const TEAM_COL = [0xd9882a, 0x3f78d6];
const rgb = (c) => (c[0] << 16) | (c[1] << 8) | c[2];

function noiseTexture(base = 255, var_ = 22, line = 40) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = `rgb(${base},${base},${base})`; g.fillRect(0, 0, 128, 128);
  const img = g.getImageData(0, 0, 128, 128);
  for (let i = 0; i < img.data.length; i += 4) { const n = (Math.random() - 0.5) * var_; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  g.putImageData(img, 0, 0);
  g.strokeStyle = `rgba(0,0,0,${line / 255})`; g.lineWidth = 3; g.strokeRect(0, 0, 128, 128);
  g.lineWidth = 1; g.strokeStyle = `rgba(0,0,0,${line / 600})`; g.beginPath(); g.moveTo(0, 64); g.lineTo(128, 64); g.moveTo(64, 0); g.lineTo(64, 128); g.stroke();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function boxGeo(w, h, d, tile = 2) {                               // UVs scaled so the texture repeats every `tile` metres
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
  return g;
}
function labelSprite(text, color = '#fff', size = 64, bg = null) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, 256, 96); }
  g.font = `bold ${size}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,.7)'; g.strokeText(text, 128, 48); g.fillStyle = color; g.fillText(text, 128, 48);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true })); s.renderOrder = 10; return s;
}

// ------------------------------------------------------------------ weapon models (boxes only)
function m(color, rough = 1) { return new THREE.MeshLambertMaterial({ color }); }
function part(g, w, h, d, x, y, z, color) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(color)); mesh.position.set(x, y, z); g.add(mesh); return mesh; }
export function buildWeapon(id) {
  const g = new THREE.Group(), dark = 0x25272b, mid = 0x3a3d44, wood = 0x6b4426, steel = 0x9aa0a8;
  switch (id) {
    case W.KNIFE: part(g, 0.025, 0.05, 0.28, 0, 0, -0.14, steel); part(g, 0.04, 0.05, 0.1, 0, 0, 0.05, 0x222222); break;
    case W.GLOCK: case W.USP: case W.DEAGLE: { const s = id === W.DEAGLE ? 1.25 : 1; part(g, 0.05 * s, 0.07 * s, 0.26 * s, 0, 0.02, -0.12, dark); part(g, 0.045, 0.12 * s, 0.06, 0, -0.06, 0, mid); break; }
    case W.MP9: part(g, 0.06, 0.09, 0.36, 0, 0, -0.16, dark); part(g, 0.04, 0.14, 0.05, 0, -0.1, -0.05, mid); part(g, 0.04, 0.1, 0.04, 0, -0.1, 0.06, dark); break;
    case W.NOVA: part(g, 0.06, 0.08, 0.62, 0, 0, -0.28, dark); part(g, 0.04, 0.04, 0.5, 0, -0.06, -0.3, mid); part(g, 0.06, 0.1, 0.22, 0, -0.01, 0.2, wood); break;
    case W.AK47: part(g, 0.06, 0.09, 0.5, 0, 0, -0.22, mid); part(g, 0.05, 0.05, 0.28, 0, 0.0, -0.58, dark); part(g, 0.05, 0.16, 0.07, 0, -0.12, -0.12, wood); part(g, 0.06, 0.09, 0.26, 0, -0.01, 0.2, wood); break;
    case W.M4: part(g, 0.06, 0.1, 0.52, 0, 0, -0.22, dark); part(g, 0.04, 0.04, 0.32, 0, 0.01, -0.6, mid); part(g, 0.05, 0.15, 0.07, 0, -0.12, -0.1, dark); part(g, 0.06, 0.08, 0.24, 0, -0.01, 0.2, mid); break;
    case W.AWP: part(g, 0.06, 0.1, 0.7, 0, 0, -0.25, 0x3d5030); part(g, 0.04, 0.04, 0.5, 0, 0.01, -0.9, dark); part(g, 0.05, 0.07, 0.24, 0, 0.09, -0.2, dark); part(g, 0.07, 0.1, 0.3, 0, -0.01, 0.28, 0x3d5030); break;
    case W.C4: part(g, 0.2, 0.08, 0.14, 0, 0, 0, 0x4b4b44); break;
    default: break;
  }
  return g;
}

// ------------------------------------------------------------------ player models
function buildPlayer(team) {
  const g = new THREE.Group(), col = TEAM_COL[team], pants = team ? 0x2b2f3a : 0x4a4032, skin = 0xd9b08c;
  const mk = (w, h, d, x, y, z, c) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m(c)); mesh.position.set(x, y, z); return mesh; };
  const body = new THREE.Group(); g.add(body);
  const legL = new THREE.Group(), legR = new THREE.Group(); legL.position.set(-0.13, 0.85, 0); legR.position.set(0.13, 0.85, 0); legL.rotation.order = legR.rotation.order = 'YXZ';
  legL.add(mk(0.2, 0.85, 0.22, 0, -0.425, 0, pants)); legR.add(mk(0.2, 0.85, 0.22, 0, -0.425, 0, pants)); g.add(legL, legR);
  const torso = mk(0.52, 0.62, 0.3, 0, 1.16, 0, col); body.add(torso);
  body.add(mk(0.5, 0.12, 0.28, 0, 0.88, 0, 0x2a2a2a));
  const head = mk(0.24, 0.26, 0.24, 0, 1.62, 0, skin); body.add(head);
  body.add(mk(0.27, 0.12, 0.27, 0, 1.76, 0, team ? 0x2d4f8e : 0x7a6a3c));
  const armR = new THREE.Group(); armR.position.set(0.3, 1.38, 0); armR.add(mk(0.14, 0.55, 0.14, 0, -0.27, 0, col)); body.add(armR);
  const armL = new THREE.Group(); armL.position.set(-0.3, 1.38, 0); armL.add(mk(0.14, 0.55, 0.14, 0, -0.27, 0, col)); body.add(armL);
  const gun = new THREE.Group(); gun.position.set(0.22, 1.12, -0.28); body.add(gun);
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  flash.visible = false; g.add(flash);
  return { g, body, legL, legR, armR, armL, gun, flash, gunId: -1, name: null, nameSprite: null, wasAlive: true, fall: 0, step: 0, prev: null, speed: 0 };
}

// ------------------------------------------------------------------ renderer
export class Renderer {
  constructor(canvas, map, opts = {}) {
    this.canvas = canvas; this.map = map;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: opts.aa !== false, powerPreference: 'high-performance' });
    this.r.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.pixelRatio || 1.25));
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(rgb(map.sky)); this.scene.fog = new THREE.Fog(rgb(map.sky), 70, 190);
    this.cam = new THREE.PerspectiveCamera(75, 1, 0.05, 400); this.scene.add(this.cam);
    this.scene.add(new THREE.HemisphereLight(0xdfeaff, 0x7a6a55, 1.55));
    const sun = new THREE.DirectionalLight(0xfff0d8, 1.6); sun.position.set(-30, 60, 20); this.scene.add(sun);
    this.players = []; this.tracers = []; this.parts = []; this.boom = null; this.shake = 0; this.flashT = 0;
    this.buildWorld(); this.buildViewmodel(); this.buildParticles(); this.buildBomb(); this.resize();
    this._resize = () => this.resize(); window.addEventListener('resize', this._resize);
  }
  dispose() { window.removeEventListener('resize', this._resize); this.r.dispose(); if (this.r.forceContextLoss) this.r.forceContextLoss(); }
  resize() { const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight; this.r.setSize(w, h, false); this.cam.aspect = w / h; this.cam.updateProjectionMatrix(); }

  buildWorld() {
    const map = this.map, tex = noiseTexture(), floorTex = noiseTexture(235, 30, 70);
    floorTex.repeat.set(60, 60);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshLambertMaterial({ color: rgb(map.floor), map: floorTex }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.01; this.scene.add(floor);
    const edge = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22 });
    for (const b of map.boxes) {
      const w = b.x1 - b.x0, h = b.y1 - b.y0, d = b.z1 - b.z0;
      const mesh = new THREE.Mesh(boxGeo(w, h, d), new THREE.MeshLambertMaterial({ color: rgb(b.c), map: tex }));
      mesh.position.set((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2); this.scene.add(mesh);
      const ln = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edge); ln.position.copy(mesh.position); this.scene.add(ln);
    }
    for (const s of map.sites) {
      const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(s.x1 - s.x0, s.z1 - s.z0), new THREE.MeshBasicMaterial({ color: 0xffd23c, transparent: true, opacity: 0.22, depthWrite: false }));
      pad.rotation.x = -Math.PI / 2; pad.position.set(cx, 0.03, cz); this.scene.add(pad);
      const t = labelSprite(s.name, '#ffd23c', 72); t.scale.set(4, 1.5, 1); t.position.set(cx, 3.2, cz); t.material.depthTest = true; this.scene.add(t);
    }
  }
  buildViewmodel() {
    this.vm = new THREE.Group(); this.vmGun = new THREE.Group(); this.vm.add(this.vmGun); this.vm.position.set(0.2, -0.2, -0.42); this.vm.scale.setScalar(0.8); this.cam.add(this.vm);
    this.vmArm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.4), m(0xc79a78)); this.vmArm.position.set(0.04, -0.08, 0.12); this.vm.add(this.vmArm);
    this.muzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), new THREE.MeshBasicMaterial({ color: 0xffd060, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide })); this.muzzle.visible = false; this.vm.add(this.muzzle);
    this.muzzleLight = new THREE.PointLight(0xffc060, 0, 12); this.cam.add(this.muzzleLight); this.vmId = -1; this.vmMuzzleT = 0; this.vmKick = 0; this.vmReload = 0; this.vmSwitch = 0; this.vmBob = 0;
    this.vmGunCache = {};
  }
  setViewmodel(id) {
    if (id === this.vmId) return; this.vmId = id; this.vmSwitch = 1;
    this.vmGun.clear(); if (!this.vmGunCache[id]) this.vmGunCache[id] = buildWeapon(id); this.vmGun.add(this.vmGunCache[id]);
    const L = { 1: -0.28, 2: -0.26, 3: -0.26, 4: -0.28, 5: -0.35, 6: -0.45, 7: -0.62, 8: -0.62, 9: -0.95 }[id] ?? -0.3;
    this.muzzle.position.set(0, 0.02, L - 0.03);
  }
  buildParticles() {
    const N = 96; this.pN = N; const g = new THREE.BufferGeometry();
    this.pPos = new Float32Array(N * 3); this.pCol = new Float32Array(N * 3); this.pVel = new Float32Array(N * 3); this.pLife = new Float32Array(N); this.pNext = 0;
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3)); g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.12, vertexColors: true, transparent: true, depthWrite: false, sizeAttenuation: true }));
    this.points.frustumCulled = false; this.scene.add(this.points); this.pPos.fill(9999);
  }
  burst(x, y, z, col, n = 6, speed = 2.5) {
    for (let k = 0; k < n; k++) {
      const i = this.pNext; this.pNext = (this.pNext + 1) % this.pN;
      this.pPos[i * 3] = x; this.pPos[i * 3 + 1] = y; this.pPos[i * 3 + 2] = z;
      this.pVel[i * 3] = (Math.random() - 0.5) * speed; this.pVel[i * 3 + 1] = Math.random() * speed; this.pVel[i * 3 + 2] = (Math.random() - 0.5) * speed;
      this.pCol[i * 3] = col[0]; this.pCol[i * 3 + 1] = col[1]; this.pCol[i * 3 + 2] = col[2]; this.pLife[i] = 0.35 + Math.random() * 0.25;
    }
  }
  buildBomb() {
    this.bomb = new THREE.Group(); const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.3), m(0x4d4d45)); body.position.y = 0.1; this.bomb.add(body);
    this.bombLed = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2020 })); this.bombLed.position.set(0.1, 0.24, 0); this.bomb.add(this.bombLed);
    this.bombLight = new THREE.PointLight(0xff2a1a, 0, 7); this.bombLight.position.y = 0.4; this.bomb.add(this.bombLight); this.bomb.visible = false; this.scene.add(this.bomb);
  }

  addTracer(a, b, life = 0.07, color = 0xffe08a) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(a[0], a[1], a[2]), new THREE.Vector3(b[0], b[1], b[2])]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 })); this.scene.add(line); this.tracers.push({ line, life, max: life });
  }
  impact(x, y, z, hitPlayer) { this.burst(x, y, z, hitPlayer ? [0.8, 0.1, 0.1] : [0.9, 0.8, 0.55], hitPlayer ? 7 : 5, hitPlayer ? 2.5 : 3); }
  fireVm() { this.vmMuzzleT = 0.05; }
  kickView(k) { this.vmKick = Math.min(1.6, this.vmKick + k); }
  startReload() { this.vmReload = 1; }
  explode(x, y, z) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 16), new THREE.MeshBasicMaterial({ color: 0xffa030, transparent: true, opacity: 0.85, depthWrite: false }));
    mesh.position.set(x, y + 0.5, z); this.scene.add(mesh); this.boom = { mesh, t: 0 }; this.shake = 1; this.flashT = 1;
    for (let k = 0; k < 40; k++) this.burst(x, y + 0.5, z, [1, 0.5 + Math.random() * 0.4, 0.1], 1, 14);
  }
  muzzleFlash(player) { if (player) { player.flash.visible = true; player.flashT = 0.05; } }

  // ---------------------------------------------------------------- per frame
  // st: { snap, pos[], me, camPos, yaw, pitch, fov, alive, spectating, speed, dt, now, scoped, grounded }
  draw(st) {
    const { snap, pos, dt } = st, me = st.me, myTeam = snap.pl[me] ? snap.pl[me].tm : 0;
    // camera
    const eye = st.alive ? EYE : (st.spectating ? EYE : 0.4);
    const sh = this.shake > 0 ? this.shake : 0; this.shake = Math.max(0, this.shake - dt * 1.6);
    this.cam.position.set(st.camPos.x + (Math.random() - 0.5) * sh * 0.25, st.camPos.y + eye + (Math.random() - 0.5) * sh * 0.25, st.camPos.z + (Math.random() - 0.5) * sh * 0.25);
    this.cam.rotation.order = 'YXZ'; this.cam.rotation.y = -st.yaw; this.cam.rotation.x = st.pitch;
    const fov = st.scoped ? 22 : st.fov; if (Math.abs(this.cam.fov - fov) > 0.01) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }

    // players
    for (let i = 0; i < snap.pl.length; i++) {
      const p = snap.pl[i], pp = pos[i];
      if (!this.players[i]) { this.players[i] = null; }
      if (!p || !pp || (i === me && !st.spectating) || (st.spectating && i === st.specId)) { if (this.players[i]) this.players[i].g.visible = false; continue; }
      let pl = this.players[i];
      if (!pl || pl.team !== p.tm) { if (pl) this.scene.remove(pl.g); pl = buildPlayer(p.tm); pl.team = p.tm; this.players[i] = pl; this.scene.add(pl.g); }
      pl.g.visible = true; pl.g.position.set(pp.x, pp.y, pp.z); pl.body.rotation.y = -pp.yaw; pl.legL.rotation.y = pl.legR.rotation.y = -pp.yaw;
      const alive = !!p.a;
      if (pl.prev) { const sp = Math.hypot(pp.x - pl.prev.x, pp.z - pl.prev.z) / Math.max(dt, 0.001); pl.speed += (Math.min(sp, 9) - pl.speed) * Math.min(1, dt * 10); }
      pl.prev = { x: pp.x, z: pp.z };
      if (alive) {
        pl.fall = Math.max(0, pl.fall - dt * 4); pl.step += pl.speed * dt * 1.6; const sw = Math.sin(pl.step) * Math.min(1, pl.speed / 4) * 0.7;
        pl.legL.rotation.x = sw; pl.legR.rotation.x = -sw; pl.g.rotation.x = 0; pl.g.position.y = pp.y;
        pl.armR.rotation.x = -1.35 - pp.pitch * 0.6; pl.armL.rotation.x = -1.2 - pp.pitch * 0.6; pl.armL.position.z = -0.12; pl.armR.position.z = -0.06;
        pl.gun.rotation.x = pp.pitch * 0.9;
      } else {
        pl.fall = Math.min(1, pl.fall + dt * 3.2); pl.g.rotation.order = 'YXZ'; pl.g.rotation.y = -pp.yaw; pl.g.rotation.x = -pl.fall * 1.45; pl.g.position.y = pp.y + pl.fall * 0.15;
        pl.legL.rotation.x = pl.legR.rotation.x = 0; pl.body.rotation.y = 0; pl.legL.rotation.y = pl.legR.rotation.y = 0;
      }
      if (pl.gunId !== p.w) { pl.gunId = p.w; pl.gun.clear(); pl.gun.add(buildWeapon(p.w)); }
      pl.gun.visible = alive;
      if (pl.flashT > 0) { pl.flashT -= dt; if (pl.flashT <= 0) pl.flash.visible = false; else { pl.flash.position.set(0.22, 1.3, -0.9); pl.flash.quaternion.copy(this.cam.quaternion); } }
      // name tag for teammates
      if (p.tm === myTeam && alive) {
        if (pl.name !== p.n) { if (pl.nameSprite) pl.g.remove(pl.nameSprite); pl.name = p.n; pl.nameSprite = labelSprite(p.n, '#ffffff', 44); pl.nameSprite.scale.set(1.5, 0.56, 1); pl.nameSprite.position.set(0, 2.2, 0); pl.g.add(pl.nameSprite); }
        pl.nameSprite.visible = true;
      } else if (pl.nameSprite) pl.nameSprite.visible = false;
    }

    // viewmodel
    const showVm = st.alive && !st.scoped && !st.spectating;
    this.vm.visible = showVm;
    if (showVm) {
      this.setViewmodel(snap.pl[me].w);
      this.vmKick *= Math.exp(-dt * 14); this.vmReload = Math.max(0, this.vmReload - dt * 0.5); this.vmSwitch = Math.max(0, this.vmSwitch - dt * 4);
      this.vmBob += (st.speed > 0.5 && st.grounded ? st.speed : 0) * dt * 1.6;
      const rel = snap.pl[me].fl & 8 ? Math.sin(Math.min(1, (st.reloadFrac ?? 0.5)) * Math.PI) : 0;
      this.vm.position.set(0.2 + Math.sin(this.vmBob) * 0.012, -0.2 + Math.abs(Math.cos(this.vmBob)) * 0.01 - rel * 0.18 - this.vmSwitch * 0.25, -0.42 + this.vmKick * 0.07);
      this.vm.rotation.set(this.vmKick * 0.12 + rel * 0.5, 0, rel * -0.35);
      if (this.vmMuzzleT > 0) { this.vmMuzzleT -= dt; this.muzzle.visible = this.vmMuzzleT > 0; this.muzzle.rotation.z = Math.random() * 6; this.muzzleLight.intensity = this.vmMuzzleT > 0 ? 2.5 : 0; } else { this.muzzle.visible = false; this.muzzleLight.intensity = 0; }
    }
    // tracers / particles / bomb / explosion
    for (let i = this.tracers.length - 1; i >= 0; i--) { const t = this.tracers[i]; t.life -= dt; t.line.material.opacity = Math.max(0, t.life / t.max); if (t.life <= 0) { this.scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); this.tracers.splice(i, 1); } }
    for (let i = 0; i < this.pN; i++) {
      if (this.pLife[i] > 0) { this.pLife[i] -= dt; this.pVel[i * 3 + 1] -= 9 * dt; this.pPos[i * 3] += this.pVel[i * 3] * dt; this.pPos[i * 3 + 1] += this.pVel[i * 3 + 1] * dt; this.pPos[i * 3 + 2] += this.pVel[i * 3 + 2] * dt; if (this.pLife[i] <= 0) this.pPos[i * 3 + 1] = 9999; }
    }
    this.points.geometry.attributes.position.needsUpdate = true; this.points.geometry.attributes.color.needsUpdate = true;
    const b = snap.bomb; this.bomb.visible = b[0] === BOMB.PLANTED || b[0] === BOMB.DROPPED;
    if (this.bomb.visible) {
      this.bomb.position.set(b[1], b[2], b[3]); const on = b[0] === BOMB.PLANTED && ((st.now * (2 + (40 - b[4]) / 8)) % 1) < 0.18;
      this.bombLed.visible = b[0] === BOMB.PLANTED ? on : true; this.bombLight.intensity = on ? 3 : 0;
    }
    if (this.boom) { this.boom.t += dt; const k = this.boom.t / 1.2, s = 1 + k * 16; this.boom.mesh.scale.setScalar(s); this.boom.mesh.material.opacity = Math.max(0, 0.85 * (1 - k)); if (k >= 1) { this.scene.remove(this.boom.mesh); this.boom = null; } }
    this.r.render(this.scene, this.cam);
  }
}
