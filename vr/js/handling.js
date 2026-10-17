// handling.js - the rules of holding, firing and reloading guns in VR. Pure logic (no three.js / WebXR) so it
// can be tested in Node; vr.js decides WHEN these happen from where the player's hands are.
//
//  - Primary guns (rifles, SMGs, shotguns, snipers) only fire with a second hand on the foregrip.
//  - Reloading is physical: pull the mag out (other hand at the magwell, or the eject button), take a fresh mag
//    from the belt pouch, push it into the magwell. A mag only fits the gun it was taken for.
//  - Rounds left in a pulled mag go back into the pouch; the pouch holds the gun's reserve ammo.

export function newGun(def) {
  return { def, mag: def.melee ? null : def.mag, reserve: def.reserve, nextShot: 0, support: false, heldBy: null };
}
export function refill(gun) { gun.mag = gun.def.melee ? null : gun.def.mag; gun.reserve = gun.def.reserve; gun.nextShot = 0; }

// why a trigger pull does nothing (null = it fires)
export function blockReason(gun, now) {
  const d = gun.def;
  if (d.melee) return now < gun.nextShot ? 'cooldown' : null;
  if (d.twoHanded && !gun.support) return 'two-hands';
  if (gun.mag === null) return 'no-mag';
  if (gun.mag <= 0) return 'empty';
  if (now < gun.nextShot) return 'cooldown';
  return null;
}
export function fire(gun, now) {
  if (blockReason(gun, now)) return false;
  if (!gun.def.melee) gun.mag--;
  gun.nextShot = now + gun.def.interval;
  return true;
}
// Shotguns have a tube instead of a mag: you load shells one at a time and can't pull the tube out.
export const isTube = (gun) => gun.def.kind === 'shotgun';

// mag out (by hand or eject button): returns the rounds that were in it (they go back to the pouch)
export function pullMag(gun) {
  if (gun.def.melee || isTube(gun) || gun.mag === null) return null;
  const r = gun.mag; gun.mag = null; gun.reserve += r; return r;
}
// take a fresh mag (or one shell) for this gun from the belt pouch: returns the rounds in it, 0 if the pouch is empty
export function takeMag(gun) {
  if (gun.def.melee) return 0;
  const n = Math.min(isTube(gun) ? 1 : gun.def.mag, gun.reserve); gun.reserve -= n; return n;
}
// push a held mag (or shell) into the gun. Returns false (it stays in your hand) if there's no room for it.
export function insertMag(gun, rounds, forGun) {
  if (gun.def.melee || forGun !== gun) return false;
  if (isTube(gun)) { if (gun.mag >= gun.def.mag) return false; gun.mag += rounds; return true; }
  if (gun.mag !== null) return false;
  gun.mag = rounds; return true;
}
export const needsAmmo = (gun) => !gun.def.melee && (gun.mag === null || gun.mag < gun.def.mag) && gun.reserve > 0;
// dropping a held mag on the floor: its rounds go back to the pouch so ammo is never lost
export function dropMag(gun, rounds) { if (gun && rounds > 0) gun.reserve += rounds; }

// Aim for a two-handed gun: from the trigger hand towards the support hand (a unit vector). One-handed guns use
// the controller's own pointing direction instead (vr.js).
export function twoHandAim(gunHand, supportHand) {
  const x = supportHand.x - gunHand.x, y = supportHand.y - gunHand.y, z = supportHand.z - gunHand.z, l = Math.hypot(x, y, z);
  return l > 0.05 ? { x: x / l, y: y / l, z: z / l } : null;
}

// The scope only shows its zoomed picture when an eye is right behind it and looking through it.
export function lookingThroughScope(eye, scopeRear, scopeDir, maxDist = 0.11, maxAngleDeg = 14) {
  const dx = scopeRear.x - eye.x, dy = scopeRear.y - eye.y, dz = scopeRear.z - eye.z, d = Math.hypot(dx, dy, dz);
  if (d > maxDist) return false;
  if (d < 1e-4) return true;
  const cos = (dx * scopeDir.x + dy * scopeDir.y + dz * scopeDir.z) / d;
  return cos > Math.cos(maxAngleDeg * Math.PI / 180) || d < 0.04;
}
