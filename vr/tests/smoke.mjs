// Headless smoke test of the VR mode's desktop preview (the same hand/belt/reload code that runs in a headset).
//   python3 -m http.server 8123 &   then   node vr/tests/smoke.mjs [http://localhost:8123] [shots-dir]
// Needs Playwright (NODE_PATH pointing at it is fine). The game runs slowly in software GL, so waits are generous.
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
const { chromium } = (() => { for (const p of ['playwright', '/opt/node-tools/node_modules/playwright', '/opt/npm-tools/node_modules/playwright']) { try { return req(p); } catch { /* next */ } } throw new Error('Playwright not found'); })();
const base = process.argv[2] || 'http://localhost:8123', shots = process.argv[3] || null;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1000, height: 640 } });
const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(base + '/vr/?desktop=1&lowgfx');
await page.waitForFunction(() => window.__vr && window.__vr.t > 0.5, null, { timeout: 60000 });
const ev = (fn, arg) => page.evaluate(fn, arg);
const until = (fn, arg, ms = 40000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 200 }).then(() => true, () => false);
const idle = () => until(() => window.__vr.script.length === 0);
const press = async (k) => { await idle(); await page.keyboard.press(k); };
const shot = async (n) => { if (shots) await page.screenshot({ path: `${shots}/${n}.png` }); };
const state = () => ev(() => { const v = window.__vr, h = v.gunHand(), g = v.heldGun(h); return { gun: g && g.def.name, mag: g && g.mag, reserve: g && g.reserve, support: g && !!g.supportBy, scoped: g && !!g.scoped, phase: v.sim.phase, toast: v.lastToast, off: v.offHand().held && v.offHand().held.type }; });

ok(await until(() => window.__vr.sim.players.filter((p) => p.used).length >= 5), 'game started with bots');
await press('Digit7');
ok(await until(() => { const v = window.__vr, g = v.heldGun(v.gunHand()); return g && g.def.name === 'AK-47' && g.supportBy; }), 'pressing 7: hand reaches the belt, draws the AK-47 and the other hand grabs the foregrip');
await shot('1-ak');
ok(await until(() => window.__vr.sim.phase === 2, null, 90000), 'round is live');
const s0 = await state();
await ev(() => { window.__vr.gunHand().dtr = 1; }); await until(() => window.__vr.heldGun(window.__vr.gunHand()).mag <= 25); await ev(() => { window.__vr.gunHand().dtr = 0; });
const s1 = await state(); ok(s1.mag < s0.mag, `full-auto fire with two hands uses ammo (${s0.mag} -> ${s1.mag})`);
ok(await ev(() => window.__vr.events.includes('shot')), 'shots reach the simulation');
await press('KeyF'); await until(() => !window.__vr.heldGun(window.__vr.gunHand()).supportBy);
await ev(() => { window.__vr.gunHand().dtr = 1; }); await page.waitForTimeout(1500); await ev(() => { window.__vr.gunHand().dtr = 0; });
const s2 = await state(); ok(s2.mag === s1.mag && /Two hands/.test(s2.toast), 'one hand on a rifle: it will not fire');
await press('KeyF'); await until(() => window.__vr.heldGun(window.__vr.gunHand()).supportBy);
await press('KeyR');
ok(await until(() => window.__vr.heldGun(window.__vr.gunHand()).mag === null), 'reload: the other hand pulls the mag out');
await shot('2-magout');
ok(await until(() => { const v = window.__vr, g = v.heldGun(v.gunHand()); return g.mag === g.def.mag && g.supportBy; }), 'reload: takes a fresh mag from the belt pouch, pushes it in, goes back to the foregrip');
const s3 = await state(); ok(s3.reserve === s1.reserve + s1.mag - 30, `rounds from the old mag went back to the pouch (reserve ${s1.reserve} -> ${s3.reserve})`);
await press('KeyG'); ok(await until(() => window.__vr.heldGun(window.__vr.gunHand()).mag === null), 'mag release button drops the mag');
await press('KeyR'); ok(await until(() => window.__vr.heldGun(window.__vr.gunHand()).mag === 30), 'and a hand reload puts a new one in'); await idle(); ok(true, 'reload script finished');
// pistol, one-handed
await press('Digit2');
ok(await until(() => { const v = window.__vr, g = v.heldGun(v.gunHand()); return g && g.def.name === v.guns[1].def.name && !v.offHand().held && !v.guns[6].heldBy; }), 'pressing 2: the AK goes back on the belt, the pistol comes out one-handed');
const p0 = (await state()).mag; await ev(() => { window.__vr.gunHand().dtr = 1; }); await until((m) => window.__vr.heldGun(window.__vr.gunHand()).mag < m, p0); await ev(() => { window.__vr.gunHand().dtr = 0; });
ok((await state()).mag < p0, 'the pistol fires with one hand');
// shotgun: shells one at a time
await press('Digit6');
ok(await until(() => { const v = window.__vr, g = v.heldGun(v.gunHand()); return g && g.def.kind === 'shotgun' && g.supportBy; }), 'pressing 6: the Nova, two-handed');
await ev(() => { const v = window.__vr, g = v.heldGun(v.gunHand()); v.gunHand().dtr = 1; }); await until(() => window.__vr.heldGun(window.__vr.gunHand()).mag < 8); await ev(() => { window.__vr.gunHand().dtr = 0; });
await press('KeyR'); ok(await until(() => window.__vr.heldGun(window.__vr.gunHand()).mag === 8, null, 60000), 'loading shells by hand fills the tube');
// AWP: scope to the eye
await press('Digit9');
ok(await until(() => { const v = window.__vr, g = v.heldGun(v.gunHand()); return g && g.def.kind === 'sniper' && g.supportBy; }), 'pressing 9: the AWP, two-handed');
ok(!(await state()).scoped, 'scope is dark while the gun is held at the hip');
await ev(() => { window.__vr.scoping = true; });
ok(await until(() => window.__vr.heldGun(window.__vr.gunHand()).scoped), 'raising the scope to the eye shows the zoomed view');
await page.waitForTimeout(1500); await shot('3-scope');
await ev(() => { window.__vr.scoping = false; });
await shot('4-end');
ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
