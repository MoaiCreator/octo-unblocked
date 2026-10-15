#!/usr/bin/env python3
"""Builds the overhauled Desert layout (48 x 40) and writes it into data/mods.json (built-in map, game id 0).
Run, then `npm run bake` and commit openstrike.wasm + data/mods.json. Edit further in admin.html.

    CT spawn top-centre, T spawn bottom-centre
    A site top-right   : reached by Long A (right corridor), Short A catwalk (raised, ladders) and CT
    B site top-left    : reached by the covered B tunnels (left) and from CT
    Mid                : central corridor with mid doors, connector to Short A
"""
import json, os

W, H = 48, 40
g = [['#'] * W for _ in range(H)]

def fill(r0, c0, r1, c1, ch='.'):
    for r in range(r0, r1 + 1):
        for c in range(c0, c1 + 1):
            g[r][c] = ch
def put(r, c, s):
    for i, ch in enumerate(s): g[r][c + i] = ch

# ---- open areas -----------------------------------------------------------------------------
fill(2, 18, 8, 29)            # CT spawn yard
fill(3, 20, 6, 27, 'S')       # CT spawn tiles
fill(2, 2, 13, 14)            # B site area
fill(4, 4, 11, 12, 'B')
fill(2, 33, 13, 45)           # A site area
fill(4, 35, 11, 43, 'A')
fill(9, 15, 11, 32)           # CT cross: CT spawn -> B (left) and A (right), over the top of mid
fill(9, 18, 9, 20, '#'); fill(9, 27, 9, 29, '#')          # keep pillars of wall either side of mid's top

# Mid: corridor from T spawn up to CT, with mid doors at row 17
fill(9, 21, 31, 26)
fill(17, 21, 17, 26, '#'); fill(17, 23, 17, 24)          # mid doors: 2-wide gap

# Short A: mid -> catwalk (raised platform reached by ladders) -> A
fill(14, 27, 15, 31)                                      # side room off mid
put(14, 32, 'L'); put(15, 32, 'L')                        # ladders up
fill(14, 33, 15, 38, 'P')                                 # catwalk
put(13, 38, 'L'); put(13, 37, 'L')                        # ladders down onto A
fill(12, 36, 12, 39)                                      # landing in front of A

# Long A: T spawn -> right corridor -> A
fill(27, 30, 31, 44)                                      # outside long
fill(14, 41, 27, 44)                                      # long corridor
fill(22, 41, 22, 44, '#'); fill(22, 42, 22, 43)           # long doors (2 wide)

# B tunnels (covered) : T spawn -> left -> up into B
fill(27, 3, 31, 17)                                       # outside tunnels
fill(14, 3, 26, 8, 'u')                                   # upper tunnel (covered)
fill(14, 9, 18, 12, 'u')                                  # tunnel side room
fill(13, 4, 13, 7)                                        # tunnel exit into B

# T spawn
fill(32, 14, 37, 33)
fill(33, 17, 36, 30, 'T')
fill(31, 18, 31, 29)                                      # T spawn -> mid / outsides

# ---- cover ----------------------------------------------------------------------------------
# B site
put(5, 6, 'CC'); put(6, 6, 'CC'); put(9, 10, 'cc'); put(8, 4, 'o'); put(11, 12, 'k')
put(3, 13, 'hh'); put(7, 13, 'p')
# A site
put(5, 39, 'CC'); put(6, 39, 'CC'); put(9, 36, 'c'); put(10, 42, 'oo'); put(3, 35, 'k')
put(12, 44, 'h'); put(8, 44, 'p')
# CT spawn
put(2, 18, 'k'); put(2, 29, 'k'); put(8, 22, 'hh')
# Mid
put(12, 21, 'c'); put(20, 26, 'C'); put(21, 26, 'C'); put(26, 21, 'o'); put(29, 25, 'hh')
# side room / catwalk
put(15, 27, 'c'); put(14, 30, 'k')
# Long A
put(16, 44, 'C'); put(19, 41, 'o'); put(25, 44, 'k'); put(28, 36, 'cc'); put(30, 40, 'C')
# Outside tunnels
put(28, 10, 'C'); put(30, 6, 'oo'); put(27, 15, 'k'); put(31, 3, 'hh')
put(20, 3, 'p'); put(16, 10, 'c')
# T spawn
put(32, 14, 'cc'); put(37, 33, 'k'); put(32, 32, 'o'); put(37, 14, 'o')

rows = [''.join(r) for r in g]
for r in (0, 1, H - 2, H - 1): rows[r] = '#' * W                 # 2-thick outer wall like the original
rows = [('##' + r[2:-2] + '##') for r in rows]
assert len(rows) == 40 and all(len(r) == 48 for r in rows)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if __name__ == '__main__':
    defs = json.load(open(os.path.join(ROOT, 'data', 'defaults.json')))
    desert = next(m for m in defs['maps'] if m['gameId'] == 0)
    p = os.path.join(ROOT, 'data', 'mods.json'); mods = json.load(open(p))
    mods['maps']['builtin'] = [m for m in mods['maps']['builtin'] if m['index'] != desert['index']]
    mods['maps']['builtin'].append({'index': desert['index'], 'rows': rows})
    mods['maps']['builtin'].sort(key=lambda m: m['index'])
    json.dump(mods, open(p, 'w'), indent=1); open(p, 'a').write('\n')
    print('\n'.join(rows))
