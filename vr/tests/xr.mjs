// Headless test of the real WebXR path with an emulated Meta Quest 3 (IWER): enters VR from the menu, then moves the
// emulated controllers to draw a rifle from the belt, grip it with two hands, shoot, reload by hand from the pouch,
// and look through the AWP scope.
//   npm i --no-save iwer playwright   (or have them somewhere on disk; IWER=path/to/iwer.module.js also works)
//   python3 -m http.server 8123 &   then   node vr/tests/xr.mjs [http://localhost:8123] [shots-dir]
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
const req = createRequire(import.meta.url);
const pick = (names) => { for (const n of names) { try { return req.resolve(n); } catch { if (n && existsSync(n)) return n; } } return null; };
const { chromium } = req(pick(['playwright', '/opt/node-tools/node_modules/playwright', '/opt/npm-tools/node_modules/playwright']));
const iwerPath = process.env.IWER || pick(['iwer/build/iwer.module.js']);
if (!iwerPath) { console.log('SKIP: iwer not installed (npm i --no-save iwer)'); process.exit(0); }
const base = process.argv[2] || 'http://localhost:8123', shots = process.argv[3] || null;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.route('**/__iwer.js', (r) => r.fulfill({ contentType: 'text/javascript', body: readFileSync(iwerPath) }));
await page.goto(base + '/vr/?lowgfx');
await page.waitForFunction(() => document.getElementById('note').textContent !== 'Loading maps…', null, { timeout: 30000 });
await page.evaluate(async () => {
  const { XRDevice, metaQuest3 } = await import('/__iwer.js');
  const d = new XRDevice(metaQuest3); d.installRuntime({ forceInstall: true }); window.__dev = d;
  document.getElementById('vr').disabled = false;
});
await page.click('#vr');
const until = (fn, arg, ms = 60000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 200 }).then(() => true, () => false);
ok(await until(() => window.__vr && window.__vr.renderer.xr.isPresenting), 'ENTER VR starts an immersive session (emulated Quest 3)');
ok(await until(() => window.__vr.hands.every((h) => h.connected && h.gamepad) && new Set(window.__vr.hands.map((h) => h.side)).size === 2), 'both controllers connected with gamepads');

// helpers that run in the page
await page.evaluate(() => {
  const v = window.__vr, d = window.__dev, THREE = v.camera.position.constructor;
  const frames = (n) => new Promise((res) => { const f0 = v.renderer.info.render.frame; const tick = () => (v.renderer.info.render.frame >= f0 + n ? res() : setTimeout(tick, 30)); tick(); });
  const hand = (side) => v.hands.find((h) => h.side === side);
  const ctl = (side) => d.controllers[side];
  // put a controller's GRIP at a world position/orientation (the grip is offset from the controller's own pose)
  window.__placeGrip = async (side, p, q) => {
    const Q = v.headQuat.constructor;
    for (let k = 0; k < 3; k++) {
      await frames(2);
      const h = hand(side), c = ctl(side), rigQi = v.rig.quaternion.clone().invert();
      const cp = new THREE(c.position.x, c.position.y, c.position.z), cq = new Q(c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w);
      const gl = v.rig.worldToLocal(h.pos.clone()), gq = rigQi.clone().multiply(h.quat);
      const offQ = cq.clone().invert().multiply(gq), offP = gl.clone().sub(cp).applyQuaternion(cq.clone().invert());
      const lp = v.rig.worldToLocal(new THREE(p.x, p.y, p.z)), lq = q ? rigQi.clone().multiply(new Q(q.x, q.y, q.z, q.w)) : gq;
      const nq = lq.clone().multiply(offQ.clone().invert()), np = lp.clone().sub(offP.clone().applyQuaternion(nq));
      c.position.set(np.x, np.y, np.z); c.quaternion.set(nq.x, nq.y, nq.z, nq.w);
    }
    await frames(2);
    return hand(side).pos.distanceTo(new THREE(p.x, p.y, p.z));
  };
  window.__btn = async (side, id, val) => { ctl(side).updateButtonValue(id, val); await frames(3); };
  window.__frames = frames;
  window.__front = (side, dx = 0) => { const f = new THREE(0, 0, -1).applyQuaternion(v.headQuat); f.y = 0; f.normalize(); const r = new THREE(-f.z, 0, f.x);
    return v.headPos.clone().add(f.multiplyScalar(0.38)).add(r.multiplyScalar(side === 'right' ? 0.15 + dx : -0.15 + dx)).add(new THREE(0, -0.28, 0)); };
});
const ev = (fn, arg) => page.evaluate(fn, arg);
const gunR = () => ev(() => { const v = window.__vr, g = v.heldGun(v.hands.find((h) => h.side === 'right')); return g ? { name: g.def.name, mag: g.mag, reserve: g.reserve, support: !!g.supportBy, scoped: !!g.scoped } : null; });

// draw the AK-47 (belt slot 6) with the right hand
let err = await ev(() => { const v = window.__vr, p = v.holsters[6].getWorldPosition(v.headPos.clone()); return window.__placeGrip('right', p); });
ok(err < 0.05, `right grip moved to the AK-47 holster on the belt (${(err * 100).toFixed(1)} cm off)`);
await ev(() => window.__btn('right', 'squeeze', 1));
ok((await gunR())?.name === 'AK-47', 'squeezing grip at the holster draws the AK-47');
await ev(() => window.__placeGrip('right', window.__front('right'), window.__vr.headQuat));
await ev(() => { const v = window.__vr, g = v.guns[6]; return window.__placeGrip('left', v.worldPoint(g, g.mesh.userData.fore)); });
await ev(() => window.__btn('left', 'squeeze', 1));
ok((await gunR())?.support, 'left hand grips the foregrip: two-handed');
ok(await until(() => window.__vr.sim.phase === 2, null, 120000), 'round is live');
const a0 = await gunR();
await ev(() => window.__btn('right', 'trigger', 1)); await ev(() => window.__frames(6)); await ev(() => window.__btn('right', 'trigger', 0));
const a1 = await gunR(); ok(a1.mag < a0.mag, `trigger fires (${a0.mag} -> ${a1.mag})`);
// one hand: no fire
await ev(() => window.__btn('left', 'squeeze', 0));
await ev(() => window.__btn('right', 'trigger', 1)); await ev(() => window.__frames(4)); await ev(() => window.__btn('right', 'trigger', 0));
ok((await gunR()).mag === a1.mag, 'let go of the foregrip: the rifle stops firing');
// reload by hand: pull the mag, drop it, take one from the pouch, push it in
await ev(() => { const v = window.__vr, g = v.guns[6]; return window.__placeGrip('left', v.worldPoint(g, g.mesh.userData.magwell)); });
await ev(() => window.__btn('left', 'squeeze', 1));
ok((await gunR()).mag === null, 'left hand at the magwell + grip pulls the mag out');
await ev(() => window.__placeGrip('left', window.__front('left', -0.2)));
await ev(() => window.__btn('left', 'squeeze', 0));
await ev(() => { const v = window.__vr; return window.__placeGrip('left', v.pouch.getWorldPosition(v.headPos.clone())); });
await ev(() => window.__btn('left', 'squeeze', 1));
ok(await ev(() => window.__vr.hands.find((h) => h.side === 'left').held?.type === 'mag'), 'grip at the belt pouch takes a fresh mag');
await ev(() => { const v = window.__vr, g = v.guns[6]; return window.__placeGrip('left', v.worldPoint(g, g.mesh.userData.magwell)); });
const a2 = await gunR(); ok(a2.mag === 30 && a2.reserve === a1.reserve + a1.mag - 30, `pushing it into the magwell reloads (mag ${a2.mag}, reserve ${a2.reserve})`);
await ev(() => window.__btn('left', 'squeeze', 0));
// B button drops the mag
await ev(() => window.__btn('right', 'b-button', 1)); await ev(() => window.__btn('right', 'b-button', 0));
ok((await gunR()).mag === null, 'B button releases the mag');
// put the AK back, take the AWP (slot 8), raise the scope to the right eye
await ev(() => { const v = window.__vr; return window.__placeGrip('right', v.holsters[6].getWorldPosition(v.headPos.clone())); });
await ev(() => window.__btn('right', 'squeeze', 0));
ok(await ev(() => !window.__vr.guns[6].heldBy), 'letting go at the belt puts the AK back');
await ev(() => { const v = window.__vr; return window.__placeGrip('right', v.holsters[8].getWorldPosition(v.headPos.clone())); });
await ev(() => window.__btn('right', 'squeeze', 1));
ok((await gunR())?.name === 'AWP', 'AWP drawn from the back of the belt');
await ev(async () => {
  const v = window.__vr, g = v.guns[8], ud = g.mesh.userData, Q = v.headQuat.clone();
  await window.__placeGrip('right', window.__front('right'), Q);
  await window.__placeGrip('left', v.worldPoint(g, ud.fore), Q); await window.__btn('left', 'squeeze', 1);
});
ok((await gunR()).support && !(await gunR()).scoped, 'AWP held in two hands at chest height: scope is dark');
await ev(async () => {                                     // bring the scope's rear lens 5 cm in front of the right eye
  const v = window.__vr, g = v.guns[8], ud = g.mesh.userData, Q = v.headQuat.clone(), V = v.headPos.constructor;
  const eyes = v.renderer.xr.getCamera().cameras.map((c) => new V().setFromMatrixPosition(c.matrixWorld)), f = new V(0, 0, -1).applyQuaternion(Q);
  const eye = eyes.reduce((a, b) => (b.clone().sub(v.headPos).dot(new V(1, 0, 0).applyQuaternion(Q)) > a.clone().sub(v.headPos).dot(new V(1, 0, 0).applyQuaternion(Q)) ? b : a));
  const origin = eye.clone().add(f.clone().multiplyScalar(0.05)).sub(ud.scopeRear.clone().applyQuaternion(Q));
  await window.__placeGrip('right', origin, Q);
  await window.__placeGrip('left', ud.fore.clone().applyQuaternion(Q).add(origin), Q);
  await window.__frames(4);
});
ok((await gunR()).scoped, 'scope raised to the eye: zoomed view is on');
if (shots) await page.screenshot({ path: `${shots}/xr-scope.png` });
ok(await ev(() => window.__vr.belt.visible && window.__vr.wrist.mesh.parent !== null), 'belt and wrist HUD exist');
ok(errors.filter((e) => !/IWER/.test(e)).length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
