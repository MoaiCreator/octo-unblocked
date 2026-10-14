#!/usr/bin/env python3
"""Read openstrike.wasm and write data/defaults.json: the game's built-in grid maps, guns, skins and
map-editor palette, plus the memory addresses js/boot.js patches at load time.

Run it again whenever openstrike.wasm is replaced:   python3 tools/extract_defaults.py
It fails loudly if the tables are not where they used to be (a rebuilt game moves them); in that case
the addresses in LAYOUT below must be found again (see CLAUDE.md, "Finding the tables").
"""
import hashlib, json, os, struct, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WASM = os.path.join(ROOT, 'openstrike.wasm')
OUT = os.path.join(ROOT, 'data', 'defaults.json')

# Addresses in the wasm linear memory (found by reverse engineering this exact build).
LAYOUT = {
    'mapNames':   {'addr': 39316, 'count': 5},                  # const char* name[5]
    'mapRows':    {'addr': 39504, 'count': 5, 'rows': 40, 'cols': 48},   # const char* rows[5][40]
    'weapons':    {'addr': 34860, 'count': 30, 'stride': 76},
    'skins':      {'addr': 41152, 'count': 34, 'stride': 20},
    'palette':    {'addr': 37952, 'count': 15, 'stride': 12},
    'rarities':   {'addr': 40304, 'count': 5},
}
# Weapon struct (76 bytes). Offsets are from the start of the entry.
WEAPON_FIELDS = [
    # key,        offset, type, label
    ('name',          0, 'str', 'Name'),
    ('category',      4, 'u8',  'Category'),
    ('slot',          5, 'u8',  'Slot'),
    ('price',         8, 'i32', 'Price ($)'),
    ('mag',          12, 'i32', 'Magazine'),
    ('reserve',      16, 'i32', 'Reserve ammo'),
    ('damage',       20, 'f32', 'Damage'),
    ('armorPen',     24, 'f32', 'Armor penetration (0-1)'),
    ('rangeMod',     28, 'f32', 'Range falloff (per 10 m)'),
    ('fireInterval', 32, 'f32', 'Time between shots (s)'),
    ('reload',       36, 'f32', 'Reload time (s)'),
    ('moveSpeed',    40, 'f32', 'Move speed (m/s)'),
    ('spread',       44, 'f32', 'Spread / inaccuracy'),
    ('recoil',       48, 'f32', 'Recoil kick'),
    ('unknownA',     52, 'f32', 'Unknown A'),
    ('unknownB',     56, 'f32', 'Unknown B'),
    ('auto',         60, 'i32', 'Full auto (0/1)'),
    ('pellets',      64, 'i32', 'Pellets per shot'),
    ('reward',       68, 'i32', 'Kill reward ($)'),
    ('team',         72, 'u8',  'Team (0 both, 1 T, 2 CT)'),
    ('scope',        73, 'u8',  'Has scope (0/1)'),
]
SKIN_FIELDS = [('name', 0, 'str'), ('rarity', 4, 'u8'), ('pattern', 5, 'u8'), ('color1', 6, 'rgba'), ('color2', 10, 'rgba'), ('color3', 14, 'rgba')]
CATEGORIES = ['Knife', 'Pistol', 'SMG', 'Shotgun', 'Rifle', 'Sniper', 'Grenade', 'Bomb']
SLOTS = ['Primary', 'Secondary', 'Knife', 'Grenade', 'Bomb']


def leb(b, i, signed=False):
    r = s = 0
    while True:
        x = b[i]; i += 1; r |= (x & 0x7f) << s; s += 7
        if x < 0x80:
            if signed and x & 0x40: r -= 1 << s
            return r, i


def memory_image(b):
    """Place every active data segment at its address."""
    i, segs = 8, []
    while i < len(b):
        sid = b[i]; i += 1; size, i = leb(b, i); end = i + size
        if sid == 11:
            n, j = leb(b, i)
            for _ in range(n):
                flag, j = leb(b, j)
                if flag == 1: off = None
                else:
                    if flag == 2: _, j = leb(b, j)
                    j += 1; off, j = leb(b, j, True); j += 1
                ln, j = leb(b, j); segs.append((off, j, ln)); j += ln
        i = end
    top = max(o + l for o, _, l in segs if o is not None)
    mem = bytearray(top + 16)
    for off, fo, ln in segs:
        if off is not None: mem[off:off + ln] = b[fo:fo + ln]
    return mem


def main():
    b = open(WASM, 'rb').read()
    mem = memory_image(b)
    u32 = lambda a: struct.unpack_from('<I', mem, a)[0]
    def cstr(a):
        if not 0 < a < len(mem): raise SystemExit(f'bad string pointer {a} - the game build changed, update LAYOUT')
        return mem[a:mem.index(0, a)].decode('latin1')
    rgba = lambda a: '#%02x%02x%02x' % tuple(mem[a:a + 3])

    L = LAYOUT
    maps = []
    for m in range(L['mapNames']['count']):
        rows = [cstr(u32(L['mapRows']['addr'] + 4 * (m * 40 + r))) for r in range(40)]
        if any(len(r) != 48 for r in rows): raise SystemExit('map rows are not 48 wide - layout changed')
        maps.append({'index': m, 'name': cstr(u32(L['mapNames']['addr'] + 4 * m)), 'rows': rows})

    weapons = []
    for k in range(L['weapons']['count']):
        a = L['weapons']['addr'] + k * L['weapons']['stride']; w = {'index': k}
        for key, off, t, _ in WEAPON_FIELDS:
            if t == 'str': w[key] = cstr(u32(a + off))
            elif t == 'u8': w[key] = mem[a + off]
            elif t == 'i32': w[key] = struct.unpack_from('<i', mem, a + off)[0]
            else: w[key] = round(struct.unpack_from('<f', mem, a + off)[0], 4)
        weapons.append(w)

    skins = []
    for k in range(L['skins']['count']):
        a = L['skins']['addr'] + k * L['skins']['stride']
        skins.append({'index': k, 'name': cstr(u32(a)), 'rarity': mem[a + 4], 'pattern': mem[a + 5],
                      'colors': [rgba(a + 6), rgba(a + 10), rgba(a + 14)]})

    palette = []
    for k in range(L['palette']['count']):
        a = L['palette']['addr'] + k * L['palette']['stride']
        palette.append({'ch': chr(u32(a)), 'name': cstr(u32(a + 4)), 'color': rgba(a + 8)})

    rarities = [cstr(u32(L['rarities']['addr'] + 4 * k)) for k in range(L['rarities']['count'])]

    sha = hashlib.sha256(b).hexdigest()
    out = {
        '_comment': 'Generated by tools/extract_defaults.py from openstrike.wasm - do not edit by hand.',
        'build': sha[:16], 'layout': L,
        'weaponFields': [{'key': k, 'offset': o, 'type': t, 'label': lbl} for k, o, t, lbl in WEAPON_FIELDS],
        'skinFields': [{'key': k, 'offset': o, 'type': t} for k, o, t in SKIN_FIELDS],
        'categories': CATEGORIES, 'slots': SLOTS, 'rarities': rarities,
        'palette': palette, 'maps': maps, 'weapons': weapons, 'skins': skins,
        # values js/boot.js checks before patching, so a different wasm is never corrupted
        'signature': {'weapon0': weapons[0]['name'], 'weapon17': weapons[17]['name'], 'skin0': skins[0]['name'], 'map0': maps[0]['name']},
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(out, open(OUT, 'w'), indent=1)
    print(f'wrote {OUT}: {len(maps)} maps, {len(weapons)} weapons, {len(skins)} skins, build {sha[:16]}')


if __name__ == '__main__':
    main()
