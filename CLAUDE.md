# octo-unblocked: OpenStrike site + admin

Static GitHub Pages site. No build step. `README.md` has the user-facing overview and file table.

## How modding works (no game source available)

OpenStrike ships only as a compiled Emscripten build (`openstrike.js` + `openstrike.wasm`). The C++ source is
not in this repo (`cpp/` is an older, unrelated prototype). All customisation is done by `js/boot.js`:

1. Fetch `data/mods.json` (or the admin draft from `localStorage['openstrike.adminDraft']` when `?draft=1`).
2. Merge published custom maps into `localStorage['openstrike.maps']`, which the game copies into its
   `/.openstrike_maps.txt` file. The format is `slot N` + 40 rows of 48 chars, with slots 0-2. A slot the player edited themselves is kept
   (tracked by hash in `openstrike.publishedSlots`).
3. Pass the wasm bytes as `Module.wasmBinary` (it's a SINGLE_FILE build and can't fetch the wasm itself).
4. In `Module.onRuntimeInitialized` (after static init, before `main`), write edits straight into linear memory:
   - guns: 76-byte structs at 34860 (30 entries), field offsets in `tools/extract_defaults.py` `WEAPON_FIELDS`
   - skins: 20-byte structs at 41152 (34): name ptr, rarity u8, pattern u8, 3x RGBA
   - grid maps: name pointers at 39316 (5), row pointers at 39504 (5x40, each -> 48-char C string; rows are
     deduplicated by the linker, so edits malloc a new 40x49 block and repoint, never write in place)
   - strings: `_malloc` a new C string and repoint
   Before patching it checks `data/defaults.json` `signature` against memory and skips mods on mismatch.

`data/defaults.json` is generated from the wasm by `tools/extract_defaults.py` (memory image built from the
data segments). If the wasm changes, rerun it. If it fails, find the tables again: the name strings are in the
data segments, and the tables hold i32 pointers to them (search memory for the little-endian address).

Map rules (`js/mapcheck.js`) were measured against the game's own "playable" check: walkable `. T S A B u L P`,
where `P` (platform) only connects to `P`/`L`, and blocking `# p c C k o h`. Custom maps that fail it don't appear
in the game's MAP selector.

## Test

    npm test                       # tests/admin.test.mjs (defaults sanity, map rules, GitHub client with mocked fetch)
    python3 -m http.server 8000    # then open / and /admin.html

Headless Chromium works for smoke tests (`--use-angle=swiftshader`). The game runs at about 5 fps there, so hold keys
for at least 600 ms. Useful URL flags: `?draft=1` (admin draft), `?vanilla=1` (no mods).
Publishing has only been tested against a mocked GitHub API, not live.

## Conventions

- Don't edit `openstrike.js`/`openstrike.wasm` by hand. The only change from the original single-file build is that
  `findWasmBinary()` returns `openstrike.wasm` instead of a base64 data URI.
- Keep `mods.json` diffs minimal: `toMods()` in `js/admin.js` writes only fields that differ from defaults.
- New gun/skin slots or more custom-map slots are impossible without the game's C++ source.
