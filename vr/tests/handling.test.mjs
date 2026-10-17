// node vr/tests/handling.test.mjs - two-handed guns, physical reloads, scope-to-eye
import { newGun, fire, blockReason, pullMag, takeMag, insertMag, dropMag, refill, twoHandAim, lookingThroughScope } from '../js/handling.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const rifle = { name: 'AK-47', twoHanded: true, mag: 30, reserve: 90, interval: 0.1 };
const pistol = { name: 'Glock-18', twoHanded: false, mag: 20, reserve: 120, interval: 0.15 };
const knife = { name: 'Knife', melee: true, interval: 0.5 };

const ak = newGun(rifle);
ok(blockReason(ak, 0) === 'two-hands' && !fire(ak, 0), 'a rifle will not fire one-handed');
ak.support = true;
ok(fire(ak, 0) && ak.mag === 29, 'with a hand on the foregrip it fires');
ok(!fire(ak, 0.05) && blockReason(ak, 0.05) === 'cooldown', 'fire rate is respected');
const g = newGun(pistol); ok(fire(g, 0), 'a pistol fires one-handed');
const k = newGun(knife); ok(fire(k, 0) && k.mag === null, 'the knife needs no ammo');

// physical reload
ak.mag = 3;
ok(pullMag(ak) === 3 && ak.mag === null && ak.reserve === 93, 'pulling the mag out puts its rounds back in the pouch');
ok(blockReason(ak, 9) === 'no-mag' && !fire(ak, 9), 'no mag, no shooting');
const r = takeMag(ak); ok(r === 30 && ak.reserve === 63, 'a fresh mag from the belt is full and comes out of the reserve');
const other = newGun(rifle);
ok(!insertMag(other, r, ak), 'a mag only fits the gun it was taken for');
ok(insertMag(ak, r, ak) && ak.mag === 30 && fire(ak, 10), 'pushing it into the magwell reloads');
ok(!insertMag(ak, 30, ak), 'cannot insert a second mag');
dropMag(ak, 12); ok(ak.reserve === 75, 'dropping a mag keeps its rounds');
ak.reserve = 0; ok(takeMag(ak) === 0, 'empty pouch gives nothing');
ak.mag = 0; ok(blockReason(ak, 99) === 'empty', 'empty mag clicks');
refill(ak); ok(ak.mag === 30 && ak.reserve === 90, 'respawn refills everything');

// shotgun: shells one at a time, no mag to pull
const nova = newGun({ name: 'Nova', kind: 'shotgun', twoHanded: true, mag: 8, reserve: 32, interval: 0.9 });
nova.support = true; fire(nova, 0); fire(nova, 1);
ok(pullMag(nova) === null && nova.mag === 6, 'the shotgun tube cannot be pulled out');
const sh = takeMag(nova); ok(sh === 1 && nova.reserve === 31, 'the pouch hands you one shell');
ok(insertMag(nova, sh, nova) && nova.mag === 7, 'loading a shell adds one round');
insertMag(nova, takeMag(nova), nova); ok(nova.mag === 8 && !insertMag(nova, 1, nova), 'a full tube takes no more shells');

// aiming and the scope
const a = twoHandAim({ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: -0.4 }); ok(a && Math.abs(a.z + 1) < 1e-9, 'two-handed aim points from the trigger hand to the support hand');
ok(twoHandAim({ x: 0, y: 0, z: 0 }, { x: 0.01, y: 0, z: 0 }) === null, 'hands on top of each other give no aim');
const rear = { x: 0, y: 1.6, z: -0.1 }, dir = { x: 0, y: 0, z: -1 };
ok(lookingThroughScope({ x: 0, y: 1.6, z: -0.02 }, rear, dir), 'eye right behind the scope sees through it');
ok(!lookingThroughScope({ x: 0, y: 1.6, z: 0.3 }, rear, dir), 'eye 30 cm back does not');
ok(!lookingThroughScope({ x: 0.09, y: 1.6, z: -0.06 }, rear, dir), 'eye off to the side does not');
console.log(fails ? `\n${fails} FAILED` : '\nall passed'); process.exit(fails ? 1 : 0);
