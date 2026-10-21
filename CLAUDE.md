# octo-unblocked: OpenStrike site + admin

Static GitHub Pages site. No build step. `README.md` has the user-facing overview and file table.

## How modding works (no game source available)

OpenStrike ships only as a compiled Emscripten build. The C++ source is not in this repo (`cpp/` is an older,
unrelated prototype). `data/openstrike.original.wasm` is the untouched build. Edits are recorded in
`data/mods.json` and **baked into `openstrike.wasm`** by `js/bake.js` (admin Publish, `?draft=1`, `npm run bake`):

- Every edit is a write to static memory, so the baked file = original + extra active data segments appended to
  the data section (applied after the originals, so they win). Nothing else in the module changes except below.
- Numbers: guns are 76-byte structs at 34860 (30), field offsets in `tools/extract_defaults.py` `WEAPON_FIELDS`;
  skins are 20-byte structs at 41152 (34): name ptr, rarity u8, pattern u8, 3x RGBA.
- Maps: tables indexed by map id 0-5: names at 39312 + 4*id, rows at 39344 + 160*id (40 pointers to 48-char
  C strings). Each map in `data/defaults.json` carries `nameAddr`/`rowsAddr`.
- New strings and row blocks go in a pool segment at the old heap start (`layout.heap.base`, 2931744). The heap
  start is the sbrk variable at 784964 (read by wasm func 505), and it's moved past the pool.
- Desert (id 0) has 40 null row pointers. The loader (func 801) builds it with a generator (func 644). When Desert's
  rows change, 3 code bytes are patched (`codePatch` in defaults.json, verified against expected values) so the
  loader accepts id 0 and skips the generator. `DESERT_ROWS` in the extractor were captured from memory during a
  Desert match.
- `bake()` checks the signature and heap start of the input and refuses anything but the original build.
- `js/boot.js` only loads the wasm (`Module.wasmBinary`, since it's a SINGLE_FILE build that can't fetch it) and
  merges published new maps into `localStorage['openstrike.maps']` (`slot N` + 40 rows of 48 chars, slots 0-2),
  keeping slots the player edited (tracked by hash in `openstrike.publishedSlots`).

`data/defaults.json` is generated from `data/openstrike.original.wasm` by `tools/extract_defaults.py` (memory
image built from the data segments). If the original changes, rerun it, then `npm run bake`. If it fails, find the tables again: the name strings are in the
data segments, and the tables hold i32 pointers to them (search memory for the little-endian address).

## HD textures (`js/texhook.js`)

The game generates its textures in code and uploads them with `gl.texImage2D`. `texhook.js` wraps the WebGL
prototype before the game starts: each RGBA upload is fingerprinted (FNV over ~4k sampled bytes + size, stable
across runs) and, if `textures/manifest.json` has that fingerprint, the replacement image is uploaded instead with
mipmaps + anisotropic filtering; later filter changes and level>0 uploads for that texture are ignored.
`tools/make_textures.py` makes the pack. Fingerprints of all game textures, in upload order: 1x1 white, sand
(93010b89), plaster (ff53e8cb, also used for roofs, so it must not have distinct features), brick (18cbb206),
crate (3adc556b), tiles (e33098ab), concrete panels (bb219baa), dirt (9fcbb8d4), metal (30231164),
concrete (eee7957d), sandbags (c887e4f3), dark blue (b624eb5f, unknown use), barrels (f767d344: 4 colour
columns, one per barrel), glow/flash/smoke/shadow, A/B site letters, minimap (map-dependent, never replace).

## Graphics/feel (`js/fx.js`)

Hooks WebGL like texhook (loaded after it, before boot). The game draws everything with raylib's default shader
(texture x colDiffuse x vertex colour, `mvp` only); fx.js swaps its source for one with relief, haze and two extra
uniforms (`fxSway` for the view model, `fxCamOff` for step-up smoothing). Perspective vs 2D is `mvp[2][3] != 0`.
Per frame on the default framebuffer: the first perspective `mvp` is the pure camera (verified), a depth-only
`clear` after 3D means the view model comes next, the first ortho `mvp` after 3D is where post-processing runs
(so the HUD stays crisp). Resolution: the #canvas width/height properties return the size the game set, while
the backing store is that x scale; viewport/scissor on the default framebuffer are scaled. Post saves and restores
all GL state it touches. Movement physics was checked in the wasm (func 840): already CS-style (accelerate 5.5,
friction 5.2, stopspeed 2.03, air accelerate 12, air cap 0.76, gravity 20.3, 64 tick with smooth rendering).

Map rules (`js/mapcheck.js`) were measured against the game's own "playable" check: walkable `. T S A B u L P`,
where `P` (platform) only connects to `P`/`L`, and blocking `# p c C k o h`. Custom maps that fail it don't appear
in the game's MAP selector.

## Test

    npm test                       # admin.test.mjs (defaults, map rules, GitHub client mocked) + bake.test.mjs
    npm run bake                   # openstrike.wasm <- original + data/mods.json (commit both after editing mods.json)
    python3 -m http.server 8000    # then open / and /admin.html

Headless Chromium works for smoke tests (`--use-angle=swiftshader`). The game runs at about 5 fps there, so hold keys
for at least 600 ms. Useful URL flags: `?draft=1` (admin draft), `?vanilla=1` (no mods).
Publishing (one commit with openstrike.wasm + data/mods.json via the Git Data API) has been tested against a mocked
API. The older single-file Contents API publish was used live successfully.

## Conventions

- Don't edit `openstrike.wasm` by hand: it's generated. Change `data/mods.json` (or use the admin) and run `npm run bake`.
- The only change to `openstrike.js` from the original single-file build is that `findWasmBinary()` returns
  `openstrike.wasm` instead of a base64 data URI.
- Keep `mods.json` diffs minimal: `toMods()` in `js/admin.js` writes only fields that differ from defaults.
- New gun/skin slots or more custom-map slots are impossible without the game's C++ source. Same for stacking,
  hand-placed decorations, gun meshes and player models (all built in code).
- The main menu background builds Desert through another path, so it still shows the original layout.
