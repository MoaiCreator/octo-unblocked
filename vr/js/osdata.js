// osdata.js - OpenStrike's own data for the VR mode: the published maps and gun stats (data/defaults.json with
// data/mods.json applied, exactly like the admin page), so admin edits show up in VR too. No DOM.
import { W, WEAPONS } from './core.js';

export function mergeMods(defs, mods) {
  const maps = defs.maps.map((m) => ({ ...m, rows: m.rows.slice() }));
  const weapons = defs.weapons.map((w) => ({ ...w }));
  if (mods) {
    for (const m of (mods.maps && mods.maps.builtin) || []) {
      const t = maps[m.index]; if (!t) continue;
      if (m.name) t.name = m.name;
      if (Array.isArray(m.rows) && m.rows.length === 40) t.rows = m.rows.slice();
    }
    for (const g of mods.weapons || []) { const t = weapons[g.index]; if (t) for (const k in g) if (k !== 'index' && k in t) t[k] = g[k]; }
  }
  maps.sort((a, b) => (a.gameId ?? a.index + 1) - (b.gameId ?? b.index + 1));      // Desert first, like the game
  return { maps, weapons };
}

// The VR belt: these OpenStrike guns, matched by their ORIGINAL name (so renamed guns still land in the right slot).
export const BELT = [
  { orig: 'Knife', sim: W.KNIFE, kind: 'knife' },
  { orig: 'Glock-18', sim: W.GLOCK, kind: 'pistol' },
  { orig: 'USP-S', sim: W.USP, kind: 'pistol' },
  { orig: 'Desert Eagle', sim: W.DEAGLE, kind: 'pistol' },
  { orig: 'MP9', sim: W.MP9, kind: 'smg' },
  { orig: 'Nova', sim: W.NOVA, kind: 'shotgun' },
  { orig: 'AK-47', sim: W.AK47, kind: 'rifle' },
  { orig: 'M4A4', sim: W.M4, kind: 'rifle' },
  { orig: 'AWP', sim: W.AWP, kind: 'sniper' },
];

// OpenStrike gun -> stats used by the VR sim. OpenStrike's "spread" is in degrees-ish units (0.2-5), the sim
// uses radians-ish (0.004-0.05), and its range falloff is per 10 m like the sim's.
export function vrGun(os, belt) {
  const head = belt.kind === 'sniper' ? 2.5 : 4;
  return {
    id: belt.sim, name: os.name, kind: belt.kind,
    dmg: os.damage, range: os.rangeMod || 0.9, pen: os.armorPen ?? 0.5, head,
    interval: Math.max(0.04, os.fireInterval || 0.1), mag: os.mag || 0, reserve: os.reserve || 0,
    auto: !!os.auto, pellets: Math.max(1, os.pellets || 1), spread: Math.min(0.08, (os.spread || 0.3) * 0.009),
    recoil: (os.recoil || 2) * 0.004, scope: !!os.scope || belt.kind === 'sniper', melee: belt.kind === 'knife',
    twoHanded: belt.kind === 'rifle' || belt.kind === 'smg' || belt.kind === 'shotgun' || belt.kind === 'sniper',
  };
}
// Give the bots the same stats the admin set, so both sides fight with the same guns.
export function applyToSim(defsWeapons, merged) {
  for (const b of BELT) {
    const i = defsWeapons.findIndex((w) => w.name === b.orig); if (i < 0) continue;
    const os = merged[i], t = WEAPONS[b.sim]; if (!os || !t) continue;
    const g = vrGun(os, b);
    if (b.kind !== 'knife') Object.assign(t, { dmg: g.dmg, interval: g.interval, mag: g.mag, reserve: g.reserve, auto: g.auto, pellets: g.pellets, range: g.range, pen: g.pen });
    t.name = os.name;
  }
}
export function belt(defsWeapons, merged) {
  return BELT.map((b) => { const i = defsWeapons.findIndex((w) => w.name === b.orig); return i < 0 ? null : vrGun(merged[i], b); }).filter(Boolean);
}
