# octo-unblocked

CS-LAN: C++ bomb-defusal FPS for LAN play. raylib (graphics/audio) + raw UDP.

## Build

    cmake -B build && cmake --build build --config Release
    ./build/cs2lan --name YourName        (Windows: build\Release\cs2lan.exe)

Needs CMake and a C++17 compiler; raylib downloads automatically.
Linux deps: `sudo apt install libgl1-mesa-dev libx11-dev libxrandr-dev libxi-dev libxcursor-dev libxinerama-dev`

## Play

- **H** host, **F** find LAN games, or type the host's IP and press **ENTER**. **M** cycles maps.
- Dedicated server: `./cs2lan --dedicated --map warehouse`
- Firewall: allow **UDP 27015** on the host. Everyone needs the same `maps/` files.
- Controls: WASD, Shift walk, Space jump, LMB shoot, RMB scope (AWP), R reload, 1-4 / wheel weapons,
  B buy menu (freeze time), hold E to plant/defuse, TAB scoreboard, F2 collision debug, ESC leave.

## Game rules

T plant the bomb at site A or B, CT stop them or defuse. First to 7 rounds, sides swap after round 6.
Economy: kill rewards per weapon, round win/loss bonuses, buy menu during freeze time.

## Custom content

- Maps: `maps/<name>.map` (see `maps/arena2.map` for boxes, `maps/warehouse.map` for an OBJ map).
- Models (optional): `models/player_t.glb`, `models/player_ct.glb`, `models/weapons/<name>.glb`.
  See `models/README.txt`. Missing files fall back to built-in shapes.

Working on this with Claude Code? See `CLAUDE.md`.
