# octo-unblocked: OpenStrike

**Play:** https://moaicreator.github.io/octo-unblocked/
**Admin (maps, guns, skins):** https://moaicreator.github.io/octo-unblocked/admin.html

OpenStrike is a tactical 5v5 bomb-defusal game (C++ / raylib) compiled to WebAssembly. This repo hosts it on
GitHub Pages as normal files instead of one giant HTML file, and adds an admin page for editing game content.

## Files

| File | What it is |
|---|---|
| `index.html`, `css/game.css` | The game page (same markup as the original build) |
| `js/shell.js` | Page glue the game calls into: text prompts, touch input, fullscreen (from the original build) |
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
| `cpp/` | The earlier CS-LAN C++ prototype (desktop, raylib + UDP) |

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

## Develop

    npm run serve     # http://localhost:8000 (needs a web server, not file://)
    npm test          # map checker + publishing tests (Node 18+)

    npm run bake      # rebuild openstrike.wasm from data/openstrike.original.wasm + data/mods.json

`index.html?vanilla=1` plays the original game. To replace the game with a new build, put it in
`data/openstrike.original.wasm`, run `npm run extract`, then `npm run bake`. Baking refuses a build that doesn't
match `data/defaults.json`.
