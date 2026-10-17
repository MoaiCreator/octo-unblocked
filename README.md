# octo-unblocked: OpenStrike

**Play:** https://moaicreator.github.io/octo-unblocked/
**Admin (maps, guns, skins):** https://moaicreator.github.io/octo-unblocked/admin.html
**VR:** https://moaicreator.github.io/octo-unblocked/vr/ (or the **VR PLAY** button on the game page)

OpenStrike is a tactical 5v5 bomb-defusal game (C++ / raylib) compiled to WebAssembly. This repo hosts it on
GitHub Pages as normal files instead of one giant HTML file, and adds an admin page for editing game content.

## Files

| File | What it is |
|---|---|
| `index.html`, `css/game.css` | The game page (same markup as the original build) |
| `js/shell.js` | Page glue the game calls into: text prompts, touch input, fullscreen (from the original build) |
| `js/texhook.js`, `textures/` | HD texture pack: swaps the game's generated textures (cobblestone, brick, plaster, crates, metal, sandbags, barrels...) and turns on mipmaps/anisotropic filtering. `?hd=0` turns it off |
| `js/mobile.js`, `manifest.webmanifest`, `icons/` | Phone fixes (no zoom/scroll bounce) and home-screen app support, which is how fullscreen works on iPhone |
| `js/boot.js` | Loader: downloads `openstrike.wasm` with a progress bar, fills published new maps into the custom slots, starts the game |
| `openstrike.js`, `openstrike.wasm` | The game (Emscripten runtime + binary). **`openstrike.wasm` contains your published edits** |
| `data/openstrike.original.wasm` | The untouched original game, which every publish is built from |
| `js/bake.js`, `tools/bake.mjs` | Writes the edits into the game file (used by Publish, *Test in game* and `npm run bake`) |
| `admin.html`, `js/admin.js`, `css/admin.css` | Admin page |
| `js/mapcheck.js` | Map validation (same rules as the game's own check) |
| `js/github.js` | Publishes `data/mods.json` through the GitHub API |
| `data/defaults.json` | The game's original maps, guns, skins and tile palette, extracted from the original wasm |
| `data/mods.json` | The list of your edits, so the admin page can reopen them. The game itself reads the edits from `openstrike.wasm` |
| `tools/extract_defaults.py` | Regenerates `data/defaults.json` from `data/openstrike.original.wasm` |
| `tools/make_textures.py` | Regenerates the HD texture pack (all procedural, tileable) |
| `tools/desert_overhaul.py` | The overhauled Desert layout (writes it into `data/mods.json`; then `npm run bake`) |
| `vr/` | VR mode (WebXR + three.js), see below |
| `cpp/` | The earlier CS-LAN C++ prototype (desktop, raylib + UDP) |

## Phones

- **iPhone fullscreen:** iPhone Safari can't make web pages fullscreen. Open the game in Safari, tap **Share** then
  **Add to Home Screen**, and start OpenStrike from the home-screen icon: it runs fullscreen without the browser
  bars. The game page shows this hint on iPhone the first few times.
- The admin page has a phone layout: the map list and tile palette become scrollable strips above the map, and you
  paint with your finger.

## Admin page

- **Maps:** edit all 6 built-in maps (Desert, Sandstone, Freight, Rooftops, Backlot, Cargo Yard): layout and name.
  Add up to 3 new maps, which appear in the game's MAP selector as *Custom 1-3*. Tools: brush, rectangle, fill,
  pick, mirror painting, undo/redo, and import/export in the in-game editor's text format. A live check uses the
  game's rules (spawns and both sites must be reachable), and broken maps can't be published.
- **Guns:** edit all 30 guns: name, price, damage, fire rate, magazine, reserve, reload, move speed, spread,
  recoil, pellets, full-auto, kill reward, team and scope.
- **Skins:** edit all 34 skins: name, rarity, pattern and three colours.
- **Test in game** builds the game file from your unpublished draft in your browser (exactly what Publish would
  upload) and opens it (`index.html?draft=1`). Only you see it.
- **Publish** writes your edits into the game file and commits `openstrike.wasm` and `data/mods.json` together in
  one commit. Pages redeploys in about a minute and everyone gets the new game file.
  Publishing needs a [fine-grained GitHub token](https://github.com/settings/personal-access-tokens/new) for
  this repo with *Contents: Read and write*. Anyone can open the page, but only people with a token can publish.

### Limits (the game is a compiled binary)

- The game has a fixed number of slots: 30 guns, 34 skins, 6 built-in maps and 3 custom map slots.
  A "new" gun or skin replaces an existing slot and keeps that slot's 3D model, sound and buy-menu position.
  Adding extra slots needs the C++ source of OpenStrike and a rebuild.
- Desert is normally built by the game's code rather than read from the map table. When its layout is edited,
  three bytes of the map loader are changed in the published file so Desert loads from the table like the
  other maps. The random-map generator still uses the original Desert as its fallback.
- Mods change the game in the player's browser (bot matches). Servers you join use their own settings.
- If a player has saved their own map in a custom slot, it isn't overwritten by a published map.
- Two gun values (*Unknown A/B*) have unconfirmed meaning.
- Things that need the game's C++ source and a rebuild, because they live in the game's code rather than its data:
  stacking objects on top of each other in maps, placing wall/floor decorations yourself (the game generates them),
  new or smoother gun models, and player character customisation/agent skins.
- The main menu's 3D background is still the original Desert; matches use your Desert.

## VR mode (`vr/`)

OpenStrike itself can't run in VR: it's a compiled binary and its source isn't available. So VR is a separate
WebXR game that plays OpenStrike's own content: the 6 maps (with your admin edits, including Desert), the gun
stats from the admin page, and the HD texture pack, against bots (5v5 rounds, bomb, economy for the bots).
Open it in a headset's browser (e.g. Meta Quest Browser) and press **ENTER VR**.

- **Belt:** all 9 guns hang on a belt that follows you (knife, Glock, USP-S, Desert Eagle, MP9, Nova, AK-47, M4A4,
  AWP). Hold **grip** at a holster to draw, let go to put the gun back.
- **Two hands:** the MP9, Nova, AK-47, M4A4 and AWP only fire with your other hand gripping the front. Two hands
  also aim the gun (from your trigger hand to your support hand) and cut recoil.
- **Scope:** the AWP's scope shows a zoomed view only when you hold it up to your eye.
- **Reload:** pull the mag out with your other hand (or press **B/Y**), grab a fresh one from the pouch on the front of
  your belt and push it into the magwell. The Nova loads one shell at a time. Ammo from pulled mags isn't lost.
- Left stick moves, right stick turns (swapped for left-handed players), **A/X** plants or defuses. Options: name,
  team, map, bot difficulty, bots per team, dominant hand, snap/smooth turning.
- *Desktop preview* runs the same game with mouse and keyboard driving the hands (1-9 draw, F support hand,
  R reload by hand, RMB scope) for checking things without a headset.

Files: `vr/js/vr.js` (session, hands, belt, guns, locomotion, HUD), `handling.js` (gun rules), `world.js` (map grid
to 3D), `scene.js` (meshes + textures), `models.js` (guns, mags, bots), `osdata.js` (reads `data/`), and the bot match
code `sim.js`, `bots.js`, `nav.js`, `core.js` from the earlier Octo Strike build.

## Develop

    npm run serve     # http://localhost:8000 (needs a web server, not file://)
    npm test          # map checker + publishing tests + VR logic tests (Node 18+)
    npm run test:vr-browser   # headless VR checks (needs Playwright; the XR one also needs `npm i --no-save iwer`)

    npm run bake      # rebuild openstrike.wasm from data/openstrike.original.wasm + data/mods.json

`index.html?vanilla=1` plays the original game. To replace the game with a new build, put it in
`data/openstrike.original.wasm`, run `npm run extract`, then `npm run bake`. Baking refuses a build that doesn't
match `data/defaults.json`.
