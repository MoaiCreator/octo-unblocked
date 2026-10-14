Optional 3D models (glTF/GLB, OBJ or IQM). If a file is missing the game falls back to built-in shapes.

  models/player_t.glb      player model for Terrorists   (auto-scaled to 1.8 m tall, feet at y=0)
  models/player_ct.glb     player model for Counter-Terrorists
  models/weapons/<name>.glb  first-person + third-person weapon models, auto-scaled:
        knife glock usp deagle mp9 nova ak47 m4 awp c4

glTF/GLB models are assumed to face +Z (the glTF convention) and are flipped to face forward;
OBJ/IQM are assumed to face -Z. Animations are not played (static pose).

Maps (maps/<name>.map) may use:  model <file> [scale ox oy oz]   - visual-only model (GLB/OBJ/...)
                                  collide_obj <file.obj> <cell> [scale ox oy oz]  - voxelised collision
