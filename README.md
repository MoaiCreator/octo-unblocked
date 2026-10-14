# octo-unblocked

## Octo Strike: 5v5 bomb defusal that runs in your browser

**Play it:** https://moaicreator.github.io/octo-unblocked/

No install and no downloads. It is a static site (HTML + JavaScript + three.js), so it works on GitHub Pages.
three.js and PeerJS are vendored in `js/vendor/`, so the game loads nothing from a CDN.

### Features
- 5v5 rounds: Terrorists plant the bomb at A or B (hold **E**), Counter-Terrorists eliminate them or defuse it. First to 7, sides swap after round 6.
- Economy and **buy menu** (**B** in freeze time): pistols, SMG, shotgun, AK-47 / M4A4, AWP (scope with right click), armor, helmet, defuse kit.
- Bots with line-of-sight vision, A* navigation, bomb plans, buying and three skill levels.
- **Online multiplayer, peer to peer:** one player clicks *Host online game* and shares the 5-letter room code (or the invite link); friends click *Join game*. Empty slots are filled with bots. The host runs the match; hit detection is lag-compensated.
- All sounds are synthesised at runtime, so there are no audio files.

### Controls
WASD move, mouse aim, left click shoot, right click scope (AWP), Space jump, Shift walk (quiet), R reload, 1-3 or wheel weapons, B buy, hold E plant/defuse, Tab scoreboard, Esc pause.

### Multiplayer notes
Browsers cannot open server sockets, so multiplayer uses WebRTC through [PeerJS](https://peerjs.com). The free public PeerJS broker is only used to pair the two browsers; game traffic then goes directly between them. This needs internet access, and strict school or corporate networks that block WebRTC will block online play (solo vs bots still works offline). Player positions are trusted by the host, so this is meant for friends, not ranked play.

### Run locally / develop

    npm run serve        # then open http://localhost:8000   (any static file server works)
    npm test             # headless simulation tests + multiplayer protocol test (needs Node 18+)

Dev shortcut: `index.html?solo=1&skill=hard` starts a solo match immediately (no pointer lock, used by headless tests).

### Deploy to GitHub Pages
Settings -> Pages -> Deploy from a branch -> `main` / `(root)`. `.nojekyll` is included.

### Layout
- `index.html`, `css/style.css`: menu, HUD and overlays
- `js/core.js`: constants, weapon table, map, physics, ray casting (shared by every module)
- `js/sim.js`, `js/bots.js`, `js/nav.js`: game rules, bot AI, A* navigation (no DOM, runs in Node for tests)
- `js/session.js`, `js/net.js`: solo/host/client sessions and the PeerJS transport
- `js/render.js`, `js/audio.js`, `js/main.js`: three.js scene, synthesised sound, input and HUD
- `tests/`: Node tests
- `cpp/`: the earlier native C++ (raylib + UDP) version of the same game, kept for reference. Build with `cmake -S cpp -B build`.

### Credits
[three.js](https://threejs.org) (MIT) and [PeerJS](https://peerjs.com) (MIT) are bundled in `js/vendor/`. Octo Strike is an independent fan-style project and is not affiliated with Valve or Counter-Strike.
