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
| `js/boot.js` | Loader: downloads `openstrike.wasm`, applies `data/mods.json`, starts the game |
| `openstrike.js`, `openstrike.wasm` | The compiled game (Emscripten runtime + binary), unchanged apart from loading the wasm as a file |
| `admin.html`, `js/admin.js`, `css/admin.css` | Admin page |
| `js/mapcheck.js` | Map validation (same rules as the game's own check) |
| `js/github.js` | Publishes `data/mods.json` through the GitHub API |
| `data/defaults.json` | The game's original maps, guns, skins and tile palette, extracted from the wasm |
| `data/mods.json` | **Your edits.** Written by the admin page, read by every player on load |
| `tools/extract_defaults.py` | Regenerates `data/defaults.json` from `openstrike.wasm` |
| `cpp/` | The earlier CS-LAN C++ prototype (desktop, raylib + UDP) |

## Admin page

- **Maps:** edit all 6 built-in maps (Desert, Sandstone, Freight, Rooftops, Backlot, Cargo Yard): layout and name.
  Add up to 3 new maps, which appear in the game's MAP selector as *Custom 1-3*. Tools: brush, rectangle, fill,
  pick, mirror painting, undo/redo, and import/export in the in-game editor's text format. A live check uses the
  game's rules (spawns and both sites must be reachable), and broken maps can't be published.
- **Guns:** edit all 30 guns: name, price, damage, fire rate, magazine, reserve, reload, move speed, spread,
  recoil, pellets, full-auto, kill reward, team and scope.
- **Skins:** edit all 34 skins: name, rarity, pattern and three colours.
- **Test in game** opens the game with your unpublished draft (`index.html?draft=1`). Only you see it.
- **Publish** commits `data/mods.json`. Pages redeploys in about a minute and everyone gets the changes.
  Publishing needs a [fine-grained GitHub token](https://github.com/settings/personal-access-tokens/new) for
  this repo with *Contents: Read and write*. Anyone can open the page, but only people with a token can publish.

### Limits (the game is a compiled binary)

- The game has a fixed number of slots: 30 guns, 34 skins, 6 built-in maps and 3 custom map slots.
  A "new" gun or skin replaces an existing slot and keeps that slot's 3D model, sound and buy-menu position.
  Adding extra slots needs the C++ source of OpenStrike and a rebuild.
- Desert is normally built by the game's code rather than read from the map table. When its layout is edited,
  `boot.js` changes three bytes of the downloaded game in memory so Desert loads from the table like the
  other maps. The file in the repo is never changed. The random-map generator still uses the original Desert
  as its fallback.
- Mods change the game in the player's browser (bot matches). Servers you join use their own settings.
- If a player has saved their own map in a custom slot, it isn't overwritten by a published map.
- Two gun values (*Unknown A/B*) have unconfirmed meaning.

## Develop

    npm run serve     # http://localhost:8000 (needs a web server, not file://)
    npm test          # map checker + publishing tests (Node 18+)

`index.html?vanilla=1` starts the game without mods. If `openstrike.wasm` is replaced with a new build, run
`npm run extract`. `boot.js` refuses to patch a build that doesn't match `data/defaults.json`.
