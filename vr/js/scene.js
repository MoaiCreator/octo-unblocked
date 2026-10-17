// scene.js - builds the three.js world for the VR mode from world.js output, using OpenStrike's HD texture pack
// (../textures). All boxes of one material are merged into a single mesh so it runs on a standalone headset.
import * as THREE from './vendor/three.module.min.js';

const TEX = '../textures/';
// material per box kind: texture file, metres per texture repeat (0 = stretch once per face, for crates), tint
const LOOK = {
  brick: ['brick.jpg', 2.4, 0xffffff], plaster: ['plaster.jpg', 3, 0xf3e6cf], platform: ['concrete_panels.jpg', 2, 0xffffff],
  sandbags: ['sandbags.jpg', 1.2, 0xffffff], roof: ['concrete.jpg', 3, 0xd8d0c4], crate: ['crate.jpg', 0, 0xffffff],
  bigcrate: ['crate.jpg', 0, 0xe8dcc8], pillar: ['concrete.jpg', 2, 0xffffff], step: ['concrete_panels.jpg', 1.5, 0xe0dcd4],
};
const lookOf = (b) => (b.kind === 'wall' ? b.skin || 'brick' : b.kind);

function loadTex(loader, file, aniso) {
  const t = loader.load(TEX + file); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; return t;
}

// one merged geometry for many boxes; tile > 0 gives world-scale UVs (continuous across merged walls)
function mergedBoxes(list, tile) {
  const pos = [], nor = [], uv = [], idx = [];
  const face = (corners, n, uvs) => {
    const base = pos.length / 3;
    for (let i = 0; i < 4; i++) { pos.push(...corners[i]); nor.push(...n); uv.push(...uvs[i]); }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  for (const b of list) {
    const { x0, y0, z0, x1, y1, z1 } = b;
    const U = (a, c, sa, sc) => (tile > 0 ? [[a / tile, c / tile], [sa / tile, c / tile], [sa / tile, sc / tile], [a / tile, sc / tile]] : [[0, 0], [1, 0], [1, 1], [0, 1]]);
    face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], U(x0, y0, x1, y1));         // +z
    face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], U(-x1, y0, -x0, y1));      // -z
    face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], U(-z1, y0, -z0, y1));       // +x
    face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], U(z0, y0, z1, y1));        // -x
    face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], U(x0, -z1, x1, -z0));       // top
    if (y0 > 0.01) face([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], U(x0, z0, x1, z1));   // bottom (roofs)
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeBoundingSphere();
  return g;
}

function labelTexture(text, color) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.font = 'bold 200px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 14; g.strokeStyle = 'rgba(0,0,0,.6)'; g.strokeText(text, 128, 140); g.fillStyle = color; g.fillText(text, 128, 140);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildWorld(scene, world, renderer) {
  const loader = new THREE.TextureLoader(), aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const root = new THREE.Group(); root.name = 'world'; scene.add(root);
  const sky = new THREE.Color(0x9fc4e4);
  scene.background = sky; scene.fog = new THREE.Fog(sky, 45, 110);
  scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x8a7458, 1.6));
  const sun = new THREE.DirectionalLight(0xfff0d8, 1.7); sun.position.set(-30, 60, 20); scene.add(sun);

  // floor (the game's sand texture is replaced by cobblestone in the HD pack)
  const ft = loadTex(loader, 'cobblestone.jpg', aniso); ft.repeat.set(world.size.w / 3, world.size.d / 3);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(world.size.w, world.size.d), new THREE.MeshLambertMaterial({ map: ft, color: 0xe6dccb }));
  floor.rotation.x = -Math.PI / 2; root.add(floor);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshLambertMaterial({ color: 0xc9b48e })); outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; root.add(outer);

  // boxes, merged per look
  const groups = {};
  for (const p of world.parts) if (p.x0 !== undefined && p.kind !== 'site') (groups[lookOf(p)] || (groups[lookOf(p)] = [])).push(p);
  const texCache = {};
  for (const k in groups) {
    const [file, tile, tint] = LOOK[k] || LOOK.brick;
    const map = texCache[file] || (texCache[file] = loadTex(loader, file, aniso));
    root.add(new THREE.Mesh(mergedBoxes(groups[k], tile), new THREE.MeshLambertMaterial({ map, color: tint })));
  }

  // barrels: the texture has 4 colour columns, one per barrel colour (same as the game)
  const barrels = world.parts.filter((p) => p.kind === 'barrel');
  if (barrels.length) {
    const base = loadTex(loader, 'barrels.jpg', aniso);
    for (let c = 0; c < 4; c++) {
      const list = barrels.filter((b) => b.color === c); if (!list.length) continue;
      const t = base.clone(); t.needsUpdate = true; t.repeat.set(0.25, 1); t.offset.set(c * 0.25, 0); t.wrapS = THREE.ClampToEdgeWrapping;
      const geo = new THREE.CylinderGeometry(1, 1, 1, 18), inst = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ map: t }), list.length);
      const m = new THREE.Matrix4();
      list.forEach((b, i) => { m.makeScale(b.r, b.h, b.r).setPosition(b.x, b.h / 2, b.z); inst.setMatrixAt(i, m); });
      root.add(inst);
    }
  }

  // bomb sites: painted pad + a big letter
  for (const s of world.sites) {
    const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(s.x1 - s.x0, s.z1 - s.z0), new THREE.MeshBasicMaterial({ color: 0xffc83a, transparent: true, opacity: 0.18, depthWrite: false }));
    pad.rotation.x = -Math.PI / 2; pad.position.set(cx, 0.02, cz); root.add(pad);
    const letter = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), new THREE.MeshBasicMaterial({ map: labelTexture(s.name, '#ffc83a'), transparent: true, depthWrite: false }));
    letter.rotation.x = -Math.PI / 2; letter.position.set(cx, 0.03, cz); root.add(letter);
  }
  return root;
}
