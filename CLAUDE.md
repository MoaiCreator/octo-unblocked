# octo-unblocked / Octo Strike

Two implementations of the same 5v5 bomb-defusal FPS:
- **Web (primary):** static site at the repo root, deployed with GitHub Pages. ES modules + three.js, no build step.
- **`cpp/` (legacy):** native C++17 + raylib + UDP version. See "C++ version" below.

## Web: run and test

    npm run serve    # python3 -m http.server 8000, open http://localhost:8000
    npm test         # tests/sim.test.mjs (bots, rules, economy, bomb) + tests/net.test.mjs (protocol over a fake transport)

`index.html?solo=1&skill=hard` boots a solo match straight away without pointer lock (test mode, `G.test`).
`window.__octo` exposes the game state for headless/Playwright smoke tests (`__octo.snap`, `__octo.G`).

No bundler: files in `js/` are loaded directly by the browser as modules, so keep imports relative with `.js` extensions.
`js/vendor/three.module.min.js` is a minified bundle of three.js (`export * from 'three'`, built with esbuild) and
`js/vendor/peerjs.min.js` is the PeerJS UMD build (global `Peer`). Update them from npm, do not hand-edit.

## Architecture

- `core.js`   Constants, `WEAPONS` table, `builtinMap()`, `moveBody` physics, `rayAabb`/`rayWorld`. Imported by everything.
- `nav.js`    `NavGrid`: 1 m grid, A*, line-of-sight string pulling. Boxes taller than `STEP` block.
- `bots.js`   `updateBot`, `botBuy`, `botRoundStart`: perception, aiming with reaction delay and turn rate, bomb duties.
- `sim.js`    `Sim`: authoritative rules (phases FREEZE/LIVE/ROUNDEND/MATCHEND, economy, bomb, damage, kills,
              lag-compensated `shoot`). `snapshot()` is the only thing the renderer and network consume.
- `session.js` `LocalSession` (solo or host: owns a `Sim`, ticks at 60 Hz, broadcasts snapshots at 20 Hz) and
              `RemoteSession` (client: sends state/shoot/cmd, interpolates snapshots ~100 ms in the past).
- `net.js`    PeerJS wrappers `HostNet`/`ClientNet` (room code = peer id `octostrike-XXXXX`, JSON over reliable data channel).
- `render.js` three.js scene, box-built player and weapon models, viewmodel, tracers, particles, bomb, explosion.
- `main.js`   Menu, pointer lock and pause overlay, input, local player movement/shooting, HUD, buy menu, main loop.
- `audio.js`  WebAudio synthesised sounds (needs a user gesture to start).

## Conventions and gotchas

- Humans are **client-trusted for movement**: each client runs `moveBody` itself and sends `{x,y,z,yaw,pitch,use}`;
  the host only clamps to bounds and ignores movement in freeze time. Bots are moved by the sim.
- The host validates fire rate, ammo, reload, damage, money, bomb. Clients send `shoot` with `vt` (their interpolated
  render time in host sim time); `Sim.rewound` rewinds enemies up to 300 ms.
- Snapshot players use short keys (`tm`, `a`, `hp`, `ar`, `fl` bit flags, `p1/p2`, `sq` = spawn sequence, `pg` progress).
  Events (`snap.ev`, last 2 s) carry a sequence number; consumers dedupe with `takeEvents()`.
  Bump `VERSION` in `core.js` when the protocol or map changes; hosts reject mismatching clients.
- Any message from a peer refreshes its `lastSeen` (dead players only send pings); peers silent for 6 s are removed.
- Solo pauses the sim when pointer lock is lost; hosting does not.
- `sim.js` and friends must stay free of DOM/three.js imports so they run in Node.
- The sandbox used to build this cannot reach the PeerJS broker, so real WebRTC pairing is untested; the protocol is
  tested over an in-memory transport only. If online play breaks, check `net.js` first.

## C++ version (`cpp/`)

    cmake -S cpp -B build && cmake --build build --config Release
    ./build/cs2lan --name Me                      # menu: H host, F find, ENTER join
    ./build/cs2lan --dedicated --map warehouse

raylib 5.5 is fetched by CMake. `shared.hpp` holds protocol, weapons, map loader and physics; `server.cpp` is the
authoritative server; `main.cpp` is the client; `maps/*.map` (+ OBJ) are custom maps. The window build has only been
syntax-checked and the server smoke-tested; it has not been run end to end.

## Ideas

- Smoke/flash grenades, more maps (a `.map` loader exists in C++ only), better character models and animation.
- Server-side movement validation, a TURN fallback for strict networks, mobile controls.
