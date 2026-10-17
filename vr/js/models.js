// models.js - meshes for the VR mode: guns (with grab/magwell/muzzle/scope points), magazines, hands, the belt,
// and the bots. Every gun points down -Z with the palm at the origin, so it can sit straight in a controller grip.
import * as THREE from './vendor/three.module.min.js';
import { W } from './core.js';

const mats = {};
function mat(color, metal = 0.35, rough = 0.6) {
  const k = color + ':' + metal + ':' + rough;
  return mats[k] || (mats[k] = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough }));
}
const C = { black: 0x1d1f22, dark: 0x2c2f34, mid: 0x464a52, steel: 0xa4aab2, wood: 0x7a4a26, woodD: 0x5a3519, olive: 0x4a5a36, tan: 0xb59a6a, grip: 0x26221f };
function bx(g, w, h, d, x, y, z, color, metal, rough) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, metal, rough)); m.position.set(x, y, z); g.add(m); return m; }
function cyl(g, r, len, x, y, z, color, axis = 'z', metal = 0.6, rough = 0.4, r2) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2 ?? r, r, len, 14), mat(color, metal, rough));
  if (axis === 'z') m.rotation.x = Math.PI / 2; else if (axis === 'x') m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z); g.add(m); return m;
}
function point(g, name, x, y, z) { const o = new THREE.Object3D(); o.name = name; o.position.set(x, y, z); g.add(o); return o; }

// The magazine on its own (also what you carry in your hand). Its origin is the top that slides into the magwell.
export function buildMag(kind) {
  const g = new THREE.Group();
  if (kind === 'pistol') { bx(g, 0.024, 0.11, 0.038, 0, -0.055, 0, C.black); bx(g, 0.028, 0.012, 0.042, 0, -0.112, 0, C.dark); }
  else if (kind === 'smg') bx(g, 0.026, 0.16, 0.04, 0, -0.08, 0, C.black);
  else if (kind === 'shotgun') { cyl(g, 0.012, 0.05, 0, -0.025, 0, 0xb02a20, 'y', 0.2, 0.6); cyl(g, 0.0125, 0.012, 0, -0.051, 0, 0xc9a24a, 'y', 0.8, 0.3); }   // a shell
  else if (kind === 'sniper') bx(g, 0.03, 0.085, 0.07, 0, -0.042, 0, C.black);
  else {                                                                       // rifle: curved AK style mag in two pieces
    const a = bx(g, 0.03, 0.12, 0.06, 0, -0.06, 0, C.dark); const b = bx(g, 0.03, 0.11, 0.055, 0, -0.16, -0.025, C.dark); b.rotation.x = -0.35; a.rotation.x = -0.12;
  }
  return g;
}

// gun.userData: { kind, muzzle, magwell, fore (foregrip, two-handed guns), scopeRear/scopeFront/lens (scoped guns), mag (mesh) }
export function buildGun(def) {
  const g = new THREE.Group(), id = def.id, kind = def.kind;
  const ud = { kind, id };
  let L = 0.2;
  switch (id) {
    case W.KNIFE: {
      bx(g, 0.03, 0.035, 0.11, 0, 0, 0.0, C.grip, 0.1, 0.9);                         // handle
      bx(g, 0.05, 0.012, 0.016, 0, 0, -0.062, C.mid);                                // guard
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.032, 0.17), mat(C.steel, 0.95, 0.2)); blade.position.set(0, 0.003, -0.15); g.add(blade);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.05, 4), mat(C.steel, 0.95, 0.2)); tip.rotation.x = -Math.PI / 2; tip.scale.set(0.38, 1, 1); tip.position.set(0, 0.003, -0.26); g.add(tip);
      L = 0.28; break;
    }
    case W.GLOCK: case W.USP: case W.DEAGLE: {
      const s = id === W.DEAGLE ? 1.18 : 1, slide = id === W.DEAGLE ? C.steel : C.dark, len = (id === W.USP ? 0.2 : 0.18) * s;
      bx(g, 0.028 * s, 0.032 * s, len, 0, 0.062 * s, -len / 2 + 0.035, slide, 0.7, 0.35);       // slide
      bx(g, 0.026 * s, 0.02 * s, len * 0.9, 0, 0.038 * s, -len / 2 + 0.04, C.black, 0.2, 0.7);  // frame
      const gr = bx(g, 0.027 * s, 0.11 * s, 0.045 * s, 0, -0.01, 0.012, C.grip, 0.1, 0.9); gr.rotation.x = 0.22;
      bx(g, 0.006, 0.02, 0.03, 0, 0.018, -0.03, C.black);                                       // trigger guard
      if (id === W.USP) cyl(g, 0.016, 0.12, 0, 0.062, -len - 0.02, C.black, 'z', 0.3, 0.7);     // silencer
      L = id === W.USP ? len + 0.08 : len - 0.03;
      ud.muzzleY = 0.062 * s; ud.magwell = new THREE.Vector3(0, -0.06, 0.022); ud.magRot = 0.22; break;
    }
    case W.MP9: {
      bx(g, 0.04, 0.06, 0.26, 0, 0.055, -0.08, C.black, 0.3, 0.6);
      cyl(g, 0.011, 0.06, 0, 0.06, -0.24, C.mid);
      bx(g, 0.032, 0.09, 0.04, 0, -0.005, 0.0, C.grip, 0.1, 0.9);                              // pistol grip (mag goes in here)
      const fg = bx(g, 0.026, 0.07, 0.03, 0, 0.0, -0.15, C.dark); fg.rotation.x = -0.15;      // vertical foregrip
      bx(g, 0.02, 0.025, 0.16, 0, 0.065, 0.12, C.dark);                                       // folding stock
      L = 0.27; ud.magwell = new THREE.Vector3(0, -0.05, 0.0); ud.fore = new THREE.Vector3(0, -0.01, -0.15); break;
    }
    case W.NOVA: {
      bx(g, 0.045, 0.06, 0.24, 0, 0.055, -0.07, C.black, 0.4, 0.5);                            // receiver
      cyl(g, 0.012, 0.5, 0, 0.07, -0.43, C.dark);                                               // barrel
      cyl(g, 0.014, 0.42, 0, 0.042, -0.39, C.mid);                                              // tube
      bx(g, 0.05, 0.045, 0.16, 0, 0.04, -0.3, C.woodD, 0.05, 0.8);                             // pump
      const gr = bx(g, 0.032, 0.09, 0.045, 0, 0.0, 0.0, C.grip, 0.1, 0.9); gr.rotation.x = 0.3;
      const st = bx(g, 0.04, 0.07, 0.25, 0, 0.035, 0.17, C.black, 0.1, 0.8); st.rotation.x = 0.1;
      L = 0.68; ud.magwell = new THREE.Vector3(0, 0.025, -0.1); ud.fore = new THREE.Vector3(0, 0.03, -0.3); ud.loadPort = true; break;
    }
    case W.AK47: {
      bx(g, 0.045, 0.06, 0.3, 0, 0.055, -0.1, C.mid, 0.6, 0.45);                               // receiver
      bx(g, 0.042, 0.02, 0.28, 0, 0.088, -0.11, C.dark, 0.6, 0.45);                            // dust cover
      bx(g, 0.05, 0.05, 0.18, 0, 0.05, -0.33, C.wood, 0.05, 0.75);                             // handguard
      cyl(g, 0.011, 0.36, 0, 0.065, -0.45, C.dark);                                              // barrel
      cyl(g, 0.007, 0.16, 0, 0.1, -0.36, C.dark);                                                // gas tube
      bx(g, 0.006, 0.04, 0.012, 0, 0.1, -0.6, C.dark);                                           // front sight
      const gr = bx(g, 0.032, 0.095, 0.042, 0, -0.005, 0.0, C.woodD, 0.05, 0.8); gr.rotation.x = 0.3;
      const st = bx(g, 0.038, 0.075, 0.27, 0, 0.035, 0.17, C.wood, 0.05, 0.75); st.rotation.x = 0.12;
      L = 0.64; ud.magwell = new THREE.Vector3(0, 0.025, -0.13); ud.fore = new THREE.Vector3(0, 0.03, -0.33); break;
    }
    case W.M4: {
      bx(g, 0.045, 0.065, 0.28, 0, 0.055, -0.09, C.black, 0.4, 0.55);
      bx(g, 0.022, 0.02, 0.22, 0, 0.098, -0.1, C.dark);                                          // rail
      cyl(g, 0.026, 0.22, 0, 0.06, -0.33, C.dark, 'z', 0.3, 0.6);                                // handguard
      cyl(g, 0.01, 0.2, 0, 0.06, -0.53, C.dark);
      cyl(g, 0.015, 0.05, 0, 0.06, -0.65, C.black);                                              // flash hider
      const gr = bx(g, 0.032, 0.095, 0.042, 0, -0.005, 0.0, C.black, 0.1, 0.85); gr.rotation.x = 0.3;
      bx(g, 0.04, 0.075, 0.2, 0, 0.04, 0.17, C.black, 0.1, 0.85); cyl(g, 0.014, 0.12, 0, 0.065, 0.08, C.dark);
      L = 0.68; ud.magwell = new THREE.Vector3(0, 0.025, -0.12); ud.fore = new THREE.Vector3(0, 0.03, -0.33); break;
    }
    case W.AWP: {
      bx(g, 0.05, 0.07, 0.42, 0, 0.05, -0.09, C.olive, 0.15, 0.7);                              // stock body
      bx(g, 0.05, 0.11, 0.22, 0, 0.035, 0.26, C.olive, 0.15, 0.7);                              // butt
      cyl(g, 0.013, 0.62, 0, 0.075, -0.6, C.dark);                                               // barrel
      cyl(g, 0.02, 0.07, 0, 0.075, -0.93, C.black);                                              // muzzle brake
      const gr = bx(g, 0.032, 0.09, 0.045, 0, -0.005, 0.0, C.olive, 0.15, 0.7); gr.rotation.x = 0.35;
      // scope: tube with a lens at each end. The rear lens shows the zoomed picture (vr.js).
      cyl(g, 0.022, 0.3, 0, 0.135, -0.1, C.black, 'z', 0.5, 0.4);
      cyl(g, 0.028, 0.06, 0, 0.135, -0.27, C.black, 'z', 0.5, 0.4, 0.022);
      cyl(g, 0.026, 0.05, 0, 0.135, 0.07, C.black, 'z', 0.5, 0.4);
      bx(g, 0.012, 0.03, 0.02, 0, 0.105, -0.17, C.black); bx(g, 0.012, 0.03, 0.02, 0, 0.105, -0.03, C.black);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.024, 24), new THREE.MeshBasicMaterial({ color: 0x0d1418 }));
      lens.position.set(0, 0.135, 0.096); lens.name = 'lens'; g.add(lens);                     // faces +Z (towards the eye)
      ud.lens = lens; ud.scopeRear = new THREE.Vector3(0, 0.135, 0.1); ud.scopeFront = new THREE.Vector3(0, 0.135, -0.3);
      L = 0.97; ud.muzzleY = 0.075; ud.magwell = new THREE.Vector3(0, 0.02, -0.1); ud.fore = new THREE.Vector3(0, 0.03, -0.36); break;
    }
    default: bx(g, 0.04, 0.06, 0.3, 0, 0.05, -0.1, C.mid); L = 0.3;
  }
  ud.muzzle = new THREE.Vector3(0, ud.muzzleY ?? 0.062, -L);
  if (ud.magwell && !def.melee) {
    const m = buildMag(kind); m.position.copy(ud.magwell); if (ud.magRot) m.rotation.x = ud.magRot; if (ud.loadPort) m.visible = false;
    g.add(m); ud.mag = m;
  }
  // foregrip marker (glows when the other hand is close enough to grab it)
  if (ud.fore) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.004, 6, 20), new THREE.MeshBasicMaterial({ color: 0x5fd0ff, transparent: true, opacity: 0 }));
    ring.position.copy(ud.fore); g.add(ring); ud.foreRing = ring;
  }
  // magwell marker (glows when a mag is close enough to insert)
  if (ud.magwell && !def.melee) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.004, 6, 20), new THREE.MeshBasicMaterial({ color: 0x7dff8a, transparent: true, opacity: 0 }));
    ring.rotation.x = Math.PI / 2; ring.position.copy(ud.magwell).add(new THREE.Vector3(0, -0.02, 0)); g.add(ring); ud.wellRing = ring;
  }
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
  flash.position.copy(ud.muzzle).add(new THREE.Vector3(0, 0, -0.05)); flash.visible = false; g.add(flash); ud.flash = flash;
  g.userData = ud;
  return g;
}

// a simple glove for each controller (shown when the hand is empty)
export function buildHand(side) {
  const g = new THREE.Group(), s = side === 'left' ? -1 : 1, skin = 0x2b2b2e;
  bx(g, 0.085, 0.03, 0.1, 0, 0, 0.01, skin, 0.1, 0.9);                         // palm
  for (let i = 0; i < 4; i++) bx(g, 0.017, 0.02, 0.06, -0.03 + i * 0.02, 0.005, -0.06, skin, 0.1, 0.9);
  const th = bx(g, 0.02, 0.02, 0.05, s * 0.05, 0.0, -0.01, skin, 0.1, 0.9); th.rotation.y = s * 0.6;
  bx(g, 0.07, 0.035, 0.05, 0, -0.005, 0.07, 0x3a5a7a, 0.1, 0.9);              // cuff
  return g;
}

// the belt ring; holsters/pouch are added by vr.js
export function buildBeltRing(radius) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.022, 6, 40), mat(0x3b2a1c, 0.05, 0.85)); ring.rotation.x = Math.PI / 2; return ring;
}
export function buildPouch() {
  const g = new THREE.Group();
  bx(g, 0.16, 0.12, 0.05, 0, -0.04, 0, 0x4a4030, 0.05, 0.9);
  for (let i = -1; i <= 1; i++) bx(g, 0.04, 0.03, 0.035, i * 0.05, 0.03, 0, C.black);  // mags sticking out
  return g;
}

// ------------------------------------------------------------------ bots (from the Octo Strike renderer)
const TEAM_COL = [0xd9882a, 0x3f78d6];
export function buildPlayer(team) {
  const g = new THREE.Group(), col = TEAM_COL[team], pants = team ? 0x2b2f3a : 0x4a4032, skin = 0xd9b08c;
  const mk = (w, h, d, x, y, z, c) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c, 0, 0.9)); mesh.position.set(x, y, z); return mesh; };
  const body = new THREE.Group(); g.add(body);
  const legL = new THREE.Group(), legR = new THREE.Group(); legL.position.set(-0.13, 0.85, 0); legR.position.set(0.13, 0.85, 0);
  legL.add(mk(0.2, 0.85, 0.22, 0, -0.425, 0, pants)); legR.add(mk(0.2, 0.85, 0.22, 0, -0.425, 0, pants)); g.add(legL, legR);
  body.add(mk(0.52, 0.62, 0.3, 0, 1.16, 0, col));
  body.add(mk(0.5, 0.12, 0.28, 0, 0.88, 0, 0x2a2a2a));
  body.add(mk(0.24, 0.26, 0.24, 0, 1.62, 0, skin));
  body.add(mk(0.27, 0.12, 0.27, 0, 1.76, 0, team ? 0x2d4f8e : 0x7a6a3c));
  const armR = new THREE.Group(); armR.position.set(0.3, 1.38, 0); armR.add(mk(0.14, 0.55, 0.14, 0, -0.27, 0, col)); body.add(armR);
  const armL = new THREE.Group(); armL.position.set(-0.3, 1.38, 0); armL.add(mk(0.14, 0.55, 0.14, 0, -0.27, 0, col)); body.add(armL);
  const gun = new THREE.Group(); gun.position.set(0.22, 1.2, -0.3); body.add(gun);
  return { g, body, legL, legR, armR, armL, gun, gunId: -1, fall: 0, step: 0, prev: null, speed: 0, team, flashT: 0 };
}
