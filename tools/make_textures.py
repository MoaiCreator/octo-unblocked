#!/usr/bin/env python3
"""Generate the HD texture pack in textures/ (used by js/texhook.js).

Every texture is procedural and seamlessly tileable, so nothing here is copied from anywhere.
    python3 tools/make_textures.py            # writes textures/*.jpg and textures/manifest.json
The keys in manifest.json are fingerprints of the game's own generated textures (see js/texhook.js);
they were read from the browser with OSTex.log while the original game started.
"""
import json, os
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'textures')
N = 512
rng = np.random.default_rng(7)

# fingerprint of the game's texture -> (output name, generator)
FINGERPRINTS = {
    '93010b89_256x256': 'cobblestone',     # was: sand floor
    'ff53e8cb_256x256': 'plaster',         # light walls
    '18cbb206_256x256': 'brick',           # brick walls
    '3adc556b_256x256': 'crate',           # crates
    'e33098ab_256x256': 'stone_tiles',     # tiled floors
    'bb219baa_256x256': 'concrete_panels',
    '9fcbb8d4_256x256': 'dirt',
    '30231164_256x256': 'corrugated',      # metal
    'eee7957d_256x256': 'concrete',
    'c887e4f3_256x256': 'sandbags',
    'f767d344_256x256': 'barrels',         # 4 colour columns, one per barrel
}


# ---------------------------------------------------------------- helpers
def fbm(beta=2.0, seed=None, n=N):
    """Tileable fractal noise in 0..1 (spectral synthesis: periodic by construction)."""
    r = np.random.default_rng(seed)
    white = r.standard_normal((n, n))
    fy = np.fft.fftfreq(n)[:, None]; fx = np.fft.fftfreq(n)[None, :]
    f = np.sqrt(fx * fx + fy * fy); f[0, 0] = 1
    out = np.real(np.fft.ifft2(np.fft.fft2(white) / f ** (beta / 2)))
    out -= out.min(); out /= out.max(); return out

def stretched(sx, sy, seed, beta=2.0):
    """Anisotropic tileable noise (grain, streaks)."""
    r = np.random.default_rng(seed)
    white = r.standard_normal((N, N))
    fy = np.fft.fftfreq(N)[:, None] * sy; fx = np.fft.fftfreq(N)[None, :] * sx
    f = np.sqrt(fx * fx + fy * fy); f[0, 0] = 1
    out = np.real(np.fft.ifft2(np.fft.fft2(white) / f ** (beta / 2)))
    out -= out.min(); out /= out.max(); return out

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

def rgb(base, shade):
    """base colour (3,) or (H,W,3) times a shade map."""
    b = np.asarray(base, dtype=np.float64)
    return b * shade[..., None] if b.ndim == 1 else b * shade[..., None]

def save(name, arr):
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'RGB')
    img.save(os.path.join(OUT, name + '.jpg'), quality=87, optimize=True, progressive=True)

def lighting(height, strength=2.5):
    """Simple top-left light from a height map (wraps, so stays tileable)."""
    gx = np.roll(height, -1, 1) - np.roll(height, 1, 1)
    gy = np.roll(height, -1, 0) - np.roll(height, 1, 0)
    return np.clip(1 + strength * (-gx - gy) * 0.5, 0.55, 1.45)

def voronoi(cells, seed, jitter=0.8):
    """Tileable jittered-grid Voronoi: returns F1, F2 distances (in cell units) and cell ids."""
    r = np.random.default_rng(seed)
    pts = (r.random((cells, cells, 2)) - 0.5) * jitter + 0.5
    ys, xs = np.mgrid[0:N, 0:N] * (cells / N)
    cy, cx = np.floor(ys).astype(int), np.floor(xs).astype(int)
    f1 = np.full((N, N), 9.0); f2 = np.full((N, N), 9.0); ids = np.zeros((N, N), int)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            ny, nx = cy + dy, cx + dx
            p = pts[ny % cells, nx % cells]
            d = np.hypot(ys - (ny + p[..., 0]), xs - (nx + p[..., 1]))
            cid = (ny % cells) * cells + (nx % cells)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d)); ids = np.where(closer, cid, ids); f1 = np.where(closer, d, f1)
    return f1, f2, ids

def brick_field(rows, per_row, mortar, seed, colors, offset=0.5, jitter=0.0):
    """Running-bond bricks. Returns colour image, brick mask (1 brick, 0 mortar) and per-brick id."""
    r = np.random.default_rng(seed)
    ys, xs = np.mgrid[0:N, 0:N].astype(float)
    rh = N / rows; bw = N / per_row
    row = np.floor(ys / rh).astype(int)
    xo = xs + (row % 2) * offset * bw + jitter * np.sin(row * 1.7) * bw * 0.2
    col = np.floor(xo / bw).astype(int) % per_row
    fy = ys - row * rh; fx = xo - np.floor(xo / bw) * bw
    edge = np.minimum.reduce([fy, rh - fy, fx, bw - fx])
    mask = smooth(mortar * 0.6, mortar * 1.3, edge)
    bid = row * per_row + col
    pal = np.array(colors, float)
    choice = r.integers(0, len(pal), rows * per_row); var = r.normal(1, 0.08, rows * per_row)
    base = pal[choice[bid]] * var[bid][..., None]
    return base, mask, bid, edge


os.makedirs(OUT, exist_ok=True)
G = {}

# ---------------------------------------------------------------- cobblestone (reference: worn grey-tan setts)
def cobblestone():
    f1, f2, ids = voronoi(9, 11, 0.75)
    gap = f2 - f1
    stone = smooth(0.04, 0.16, gap)                      # 0 in the joints, 1 on stone
    dome = np.sqrt(np.clip(gap, 0, 0.5) / 0.5)
    r = np.random.default_rng(3); tint = r.normal(1, 0.1, 81)[ids]; hue = r.integers(0, 4, 81)[ids]
    pal = np.array([[156, 148, 132], [166, 154, 134], [146, 140, 128], [170, 160, 140]], float)
    base = pal[hue] * tint[..., None]
    grit = fbm(1.2, 5); stains = fbm(2.6, 6)
    height = dome * 0.6 + grit * 0.15
    shade = lighting(height, 3.0) * (0.82 + 0.3 * grit) * (0.85 + 0.25 * stains)
    joint = np.array([108, 96, 78.0]) * (0.75 + 0.5 * fbm(1.5, 8))[..., None]
    img = base * shade[..., None] * stone[..., None] + joint * (1 - stone[..., None])
    dirt = smooth(0.55, 0.85, fbm(2.2, 9))[..., None]      # sandy dirt in patches
    return img * (1 - dirt * 0.35) + np.array([150, 128, 95.0]) * dirt * 0.35
G['cobblestone'] = cobblestone

# ---------------------------------------------------------------- brick (old red brick with soot)
def brick():
    base, mask, bid, edge = brick_field(10, 4, 5.5, 21, [[150, 74, 52], [138, 66, 48], [162, 86, 60], [120, 60, 44], [146, 92, 70]])
    grit = fbm(1.0, 22); chips = smooth(0.80, 0.9, fbm(1.6, 23))
    height = mask * (0.7 + 0.3 * grit) - chips * 0.3
    shade = lighting(height, 2.2) * (0.8 + 0.35 * grit)
    mortar = np.array([168, 160, 146.0]) * (0.8 + 0.3 * fbm(1.3, 24))[..., None]
    img = base * shade[..., None] * mask[..., None] + mortar * (1 - mask[..., None])
    soot = stretched(1, 6, 25) * smooth(0.3, 1.0, np.linspace(0, 1, N))[:, None]
    img = img * (1 - 0.35 * soot[..., None])
    grime = smooth(0.45, 0.9, fbm(2.4, 26))                                 # weathering
    img = img * (1 - 0.25 * grime[..., None]) + np.array([120, 104, 86.0]) * 0.25 * grime[..., None]
    return img * (0.9 + 0.15 * fbm(1.4, 27))[..., None]
G['brick'] = brick

# ---------------------------------------------------------------- plaster (stucco with exposed brick, like the reference)
def plaster():
    # Plain weathered stucco. The game repeats this texture every tile (walls AND roofs), so it must have no
    # distinct features or they turn into a visible polka-dot pattern.
    st = fbm(2.0, 31); fine = fbm(0.9, 32); streak = stretched(1, 8, 33); pock = smooth(0.8, 0.9, fbm(0.5, 37))
    img = np.array([200, 192, 172.0]) * ((0.9 + 0.1 * st) * (0.88 + 0.16 * fine) * (1 - 0.12 * pock))[..., None]
    img *= (1 - 0.14 * smooth(0.5, 1, streak))[..., None]
    return img * lighting(fine * 0.4, 1.2)[..., None]
G['plaster'] = plaster

# ---------------------------------------------------------------- crate (yellow pine, frame + diagonal brace like the game's)
def wood(color, seed, sx=1, sy=14):
    grain = stretched(sx, sy, seed, 2.2); rings = np.sin(grain * 40) * 0.5 + 0.5
    return np.array(color, float) * (0.78 + 0.18 * rings + 0.12 * fbm(1.0, seed + 1))[..., None]
def crate():
    ys, xs = np.mgrid[0:N, 0:N].astype(float)
    planks = wood([206, 168, 92], 41)
    seam = (np.abs(((ys + 4) % (N / 5)) - 2) < 2.2) & (xs > 44) & (xs < N - 44)
    img = planks * np.where(seam, 0.45, 1)[..., None]
    frame = (xs < 44) | (xs > N - 44) | (ys < 44) | (ys > N - 44)
    fwood = wood([186, 146, 76], 43, 14, 1)
    fw2 = wood([186, 146, 76], 45, 1, 14)
    fimg = np.where(((ys < 44) | (ys > N - 44))[..., None], fwood, fw2)
    img = np.where(frame[..., None], fimg * 0.92, img)
    d = np.abs((xs - ys)) / np.sqrt(2)
    brace = (d < 30) & ~frame
    img = np.where(brace[..., None], wood([190, 150, 80], 47, 10, 10) * 0.95, img)
    edges = (np.abs(d - 30) < 2.5) & ~frame | (np.abs(xs - 44) < 2.5) | (np.abs(xs - (N - 44)) < 2.5) | (np.abs(ys - 44) < 2.5) | (np.abs(ys - (N - 44)) < 2.5)
    img = img * np.where(edges, 0.5, 1)[..., None]
    for cy in (22, N - 22):                                                  # nails
        for cx in (22, N // 3, 2 * N // 3, N - 22):
            nail = np.hypot(ys - cy, xs - cx) < 5
            img = np.where(nail[..., None], np.array([70, 70, 72.0]), img)
    grime = smooth(0.5, 1, fbm(2.2, 48))
    return img * (1 - 0.3 * grime[..., None])
G['crate'] = crate

# ---------------------------------------------------------------- stone tiles (2x2 worn slabs)
def stone_tiles():
    ys, xs = np.mgrid[0:N, 0:N].astype(float)
    e = np.minimum(np.minimum(ys % (N / 2), N / 2 - ys % (N / 2)), np.minimum(xs % (N / 2), N / 2 - xs % (N / 2)))
    mask = smooth(3, 8, e)
    q = (ys // (N / 2)).astype(int) * 2 + (xs // (N / 2)).astype(int)
    tint = np.array([1.0, 0.94, 0.97, 0.9])[q]
    st = fbm(2.0, 51); fine = fbm(1.0, 52)
    base = np.array([196, 186, 166.0]) * (tint * (0.85 + 0.2 * st) * (0.9 + 0.15 * fine))[..., None]
    worn = smooth(0.55, 0.9, fbm(2.2, 53))
    img = base * lighting(mask * 0.5 + fine * 0.1, 2)[..., None] * (1 - 0.18 * worn)[..., None]
    return img * mask[..., None] + np.array([90, 84, 72.0]) * (1 - mask[..., None])
G['stone_tiles'] = stone_tiles

# ---------------------------------------------------------------- concrete
def concrete(panels=False):
    st = fbm(2.6, 61); fine = fbm(0.8, 62); pits = smooth(0.82, 0.9, fbm(0.6, 63))
    img = np.array([156, 154, 148.0]) * ((0.82 + 0.25 * st) * (0.9 + 0.15 * fine) * (1 - 0.35 * pits))[..., None]
    streak = stretched(1, 7, 64); img *= (1 - 0.3 * smooth(0.5, 1, streak))[..., None]
    if panels:
        ys, xs = np.mgrid[0:N, 0:N].astype(float)
        seam = (np.abs(xs % (N / 3) - 1) < 2.5) | (np.abs(ys - N / 2) < 2.5)
        img *= np.where(seam, 0.55, 1)[..., None]
        bolt = (np.hypot((xs % (N / 3)) - 16, (ys % (N / 2)) - 16) < 4)
        img = np.where(bolt[..., None], img * 0.6, img)
    return img
G['concrete'] = concrete
G['concrete_panels'] = lambda: concrete(True)

# ---------------------------------------------------------------- dirt / gravel
def dirt():
    st = fbm(2.4, 71); fine = fbm(0.9, 72)
    img = np.array([140, 116, 84.0]) * ((0.8 + 0.3 * st) * (0.85 + 0.25 * fine))[..., None]
    f1, f2, ids = voronoi(40, 73, 0.9)
    pebble = smooth(0.32, 0.12, f1) * (np.random.default_rng(74).random(1600)[ids] > 0.8)
    img = img * (1 - pebble[..., None] * 0.15) + np.array([128, 118, 100.0]) * pebble[..., None] * 0.35
    return img * lighting(pebble * 0.5 + fine * 0.2, 2)[..., None]
G['dirt'] = dirt

# ---------------------------------------------------------------- corrugated metal (painted green, rusty)
def corrugated():
    xs = np.mgrid[0:N, 0:N][1].astype(float)
    ridge = np.sin(xs / N * 2 * np.pi * 18)
    paint = np.array([92, 112, 98.0]) * (0.85 + 0.2 * fbm(2.2, 81))[..., None]
    rust = smooth(0.55, 0.75, fbm(2.4, 82) * 0.7 + stretched(1, 6, 83) * 0.3)
    rustc = np.array([130, 72, 40.0]) * (0.7 + 0.5 * fbm(1, 84))[..., None]
    img = paint * (1 - rust[..., None]) + rustc * rust[..., None]
    img *= (0.78 + 0.25 * ridge)[..., None]
    return img * (1 - 0.25 * smooth(0.5, 1, stretched(1, 9, 85)))[..., None]
G['corrugated'] = corrugated

# ---------------------------------------------------------------- sandbags (same row layout as the game's texture)
def sandbags():
    ys, xs = np.mgrid[0:N, 0:N].astype(float)
    rows, per = 3, 2.5
    rh = N / rows; bw = N / per
    row = (ys // rh).astype(int)
    xo = xs + (row % 2) * bw / 2
    fy = (ys % rh) / rh - 0.5; fx = (xo % bw) / bw - 0.5
    bag = np.clip(1 - (np.abs(fx) / 0.5) ** 4 - (np.abs(fy) / 0.5) ** 2.5, 0, 1)
    weave = (np.sin(xs * 1.6) * np.sin(ys * 1.6)) * 0.06
    cloth = np.array([170, 150, 108.0]) * (0.82 + 0.25 * fbm(2, 91) + weave)[..., None]
    img = cloth * lighting(np.sqrt(bag), 4)[..., None] * (0.35 + 0.65 * smooth(0, 0.25, bag))[..., None]
    tie = (np.abs(fx) > 0.43) & (np.abs(fy) < 0.18)
    return np.where(tie[..., None], img * 0.75, img)
G['sandbags'] = sandbags

# ---------------------------------------------------------------- barrels: 4 independent columns (one per barrel colour)
def barrels():
    ys, xs = np.mgrid[0:N, 0:N].astype(float)
    cw = N // 4
    cols = [[160, 44, 34], [44, 76, 140], [62, 100, 56], [196, 156, 46]]
    img = np.zeros((N, N, 3))
    v = ys / N
    ribs = np.exp(-((v - 0.31) / 0.018) ** 2) + np.exp(-((v - 0.65) / 0.018) ** 2)
    rims = np.exp(-((v - 0.03) / 0.02) ** 2) + np.exp(-((v - 0.97) / 0.02) ** 2)
    shade = 1 + 0.35 * ribs - 0.25 * (np.roll(ribs, 6, 0)) + 0.2 * rims
    for k, c in enumerate(cols):
        sl = slice(k * cw, (k + 1) * cw)
        paint = np.array(c, float) * (0.86 + 0.2 * fbm(2.0, 100 + k))[..., None]
        rust = smooth(0.62, 0.8, fbm(2.3, 110 + k) * 0.6 + stretched(1, 7, 120 + k) * 0.4)
        # keep rust off the outer 6 px of each column so nothing bleeds into the next barrel
        inset = smooth(0, 6, np.minimum(xs - k * cw, (k + 1) * cw - 1 - xs))
        rust = rust * inset
        col = paint * (1 - rust[..., None]) + np.array([118, 70, 40.0]) * rust[..., None]
        col *= shade[..., None]
        scratches = smooth(0.985, 1, stretched(10, 1, 130 + k))
        col = col * (1 - 0.3 * scratches[..., None]) + 200 * 0.3 * scratches[..., None]
        img[:, sl] = col[:, sl]
    return img
G['barrels'] = barrels


manifest = {'_comment': 'fingerprint of the game texture -> replacement file (generated by tools/make_textures.py)', 'textures': {}}
for fp, name in FINGERPRINTS.items():
    save(name, G[name]())
    manifest['textures'][fp] = name + '.jpg'
    print('wrote', name)
json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
