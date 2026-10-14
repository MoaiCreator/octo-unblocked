# CS-LAN

C++17 LAN tactical FPS (bomb defusal, 5v5). raylib for rendering/audio, raw UDP for networking.
One executable is both client and server: the host runs the server on a background thread (listen-server).

## Build and run

    cmake -B build && cmake --build build --config Release
    ./build/cs2lan --name Me                     # windowed client (menu: H host, F find, ENTER join)
    ./build/cs2lan --dedicated --map warehouse   # headless server

raylib 5.5 is fetched by CMake (needs network on first configure). Linux needs the X11/OpenGL dev packages
listed in README.md. CMake copies `maps/` and `models/` next to the binary.

## Layout

- `shared.hpp`  Everything both sides must agree on: weapon table (`wdef`), buy items, map data and
  loaders (`.map` text format, OBJ voxelizer), physics (`moveBody`, `rayWorld`), packet structs and enums.
  No graphics or socket includes here.
- `net.hpp/.cpp`  Small cross-platform non-blocking UDP wrapper, address helpers, `listFiles`.
- `server.hpp/.cpp`  Authoritative server: rounds, economy, bomb, damage, lag-compensated hit detection.
- `main.cpp`  Client: menu, input, client-side movement, snapshot interpolation, HUD, buy menu, assets.
- `maps/*.map`  Map files (+ OBJ meshes). `models/`  Optional GLB/OBJ player and weapon models.

## Conventions and gotchas

- Packet structs in `shared.hpp` are `#pragma pack(1)` and sent as raw bytes. Changing any of them changes
  the wire format, so client and server must be rebuilt together. Keep the same-size checks in `pollNet`.
- Map identity is a hash of collision boxes, spawns, sites and bounds (`hashMap`). Joiners load the map by
  name from their own `maps/` folder and are rejected if the hash differs.
- Server is authoritative for hits, damage, money, bomb and rounds. Player position is client-trusted
  (fine for LAN, not cheat-proof).
- Lag compensation: client sends `viewTime` (its interpolated render time in server clock); server keeps
  ~40 position snapshots (30 Hz) and rewinds enemies to that time, clamped to 300 ms.
- Collision is axis-aligned boxes only. OBJ meshes are voxelized (`collide_obj`) into merged boxes.
- Missing models/sounds must never crash: the client falls back to primitive shapes and synthesized sounds.
- Keep `shared.hpp` free of platform and raylib includes so the server stays headless-buildable.

## Verification

There is no test suite yet. Quick checks used so far:
- `g++ -std=c++17 -Wall -Wextra -c server.cpp net.cpp` (server and net compile without raylib)
- `g++ -std=c++17 -fsyntax-only -I<raylib>/src main.cpp`
- Smoke-test the server with a small Python UDP client (send HELLO, expect WELCOME then STATE).
- Map loader/physics test: include `shared.hpp`, `loadMapNamed(...)`, `setMap(...)`, walk a `Body`.
The full game window has not been run end to end yet; test with two clients on one machine first.

## Ideas / TODO

- Skeletal animation for GLB player models; viewmodel animations.
- Grenades, movement prediction reconciliation, server-side movement validation.
- Map triangle collision instead of voxel boxes; navmesh bots.
