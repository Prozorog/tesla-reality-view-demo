# T4b — Distant traffic cars

The nine cars use **8,085 triangles**, down from 63,273, a reduction of **87.2%**. Each car has two meshes with one indexed primitive each. The GLB is 393,628 bytes and references the existing paint and metallic-roughness files by relative URI.

## Triangle counts

| Type | Full | LOD body | LOD rest | LOD total |
| --- | ---: | ---: | ---: | ---: |
| Sedan | 7,178 | 376 | 523 | 899 |
| Wagon | 7,022 | 356 | 544 | 900 |
| Hatchback | 6,856 | 428 | 471 | 899 |
| Compact | 7,289 | 402 | 497 | 899 |
| Coupe | 6,054 | 392 | 508 | 900 |
| Minivan | 7,457 | 439 | 458 | 897 |
| Pickup | 6,941 | 513 | 384 | 897 |
| SUV | 7,950 | 447 | 452 | 899 |
| Offroad | 6,526 | 450 | 445 | 895 |
| **Total** | **63,273** | **3,803** | **4,282** | **8,085** |

## Game integration

1. Load `cars_lod.glb` once. Look up `cars_lod.json.types[type].nodes.root` within that asset's scene. Swap the full root and LOD root under the same vehicle transform. Both assets use metres, a ground-centred origin, +X forward, +Y up and −Z left. The manifest gives local `boundingBox.min` and `.max` in that axis order.
2. Assign the full car's paint material for the active variant to `nodes.body`. The LOD uses the same UVs, so an existing material and its loaded textures can be shared. When loading separately, resolve `cars.json.types[type].variants[].map` relative to `cars.json`, use sRGB and set `flipY = false`. Use the type's shared linear metallic-roughness map for both slots, with G for roughness and B for metallic.
3. Keep the imported material on `nodes.rest`. Its white base multiplies the linear vertex colours. Glass, tyres, hubs, trim and lenses share this single draw. Lamp faces are passive. For cars that need independent brake or headlamp changes, keep the game's light effects active using the full manifest's lamp positions.

## Visual comparison and switch distance

**Use about 30 m from the camera to the vehicle centre for parked cars in the high night view.** Each pair uses the same paint, camera and warm key light. The sheet shows native-scale crops equivalent to a 720 px tall view at 50° vertical FOV. The upper pair in each cell is at 55° elevation and the lower pair is directly overhead. The sedan detail uses the same pixel scale at 7 m and 25° elevation. [View the comparison sheet]

- At 7 m the octagonal tyres, plain hub discs, flat headlamps and simplified bumper corners are obvious. The full sedan also has wipers and recessed handles. Use the full car at this distance.
- At 30 m the side-by-side views still show shifts in narrow reflections, particularly on the dark wagon's hood. The wheel centres and grille openings read less distinctly. The roof outlines, pillars, pickup bed and offroad canopy retain their shapes. I found no visible holes, torn paint seams or change in overall size in the final overhead and elevated views.
- The threshold is a judgement from static renders. Camera motion, a narrower FOV or a larger on-screen car can make the switch more noticeable.

## Build and verification

The builder reads the shipping GLB directly in glTF coordinates. It removes concealed cabin geometry and collapses the shell, windows and lenses together, respecting material and UV boundaries. The lens outlines, outer dimensions and sample points across the upper surfaces anchor the reduction. Every surviving painted corner retains an authored position/UV pair to within 0.01 mm in position, with the original UV value. The pickup bedliner and offroad canopy keep their fixed atlas finishes. The four replacement tyres use the original wheel bounds.

An early geometry check caught collapsed headlamp faces. Protecting the largest lens outline on each side kept both colours visible within the budget. The comparison also exposed interior lining and triangular roof reflections. The correction removed the concealed lining, retained roof and hood curvature, and sampled shading normals on the matching UV chart. This keeps the interior and exterior sides of a thin panel distinct.

| Command from project root | Result |
| --- | --- |
| `heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P scripts\build_cars_lod.py` | Passed in 4.9 s of script time. Reparsed the emitted binary. Verified nine identity roots, two identity children per root, indexed counts, outward winding against the shading normals, original paint UVs and texture URIs, and six vertex colours on both sides of every car. The largest difference across the 54 bounding-box coordinates was under 0.006 mm. |
| `heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup --python-exit-code 1 -P scripts\cars\lod_sheet.py` | Passed in 11.3 s of script time. Re-imported both GLBs and rendered 38 views in background Cycles. Saved a 1272 × 1282 JPEG. |

The source pack and existing textures matched commit `6c99d9f`. The build uses Blender's NumPy and the project's lockfile version of meshoptimizer through Node. Sheet assembly uses the system Python and Pillow.

## Delivered files

- [LOD model](../../public/models/cars_lod.glb) and [manifest](../../public/models/cars_lod.json)
- [Builder](../../scripts/build_cars_lod.py), [glTF reader and writer](../../scripts/cars/lod_gltf.py), and [index simplifier](../../scripts/cars/lod_simplify.mjs)
- [Comparison renderer](../../scripts/cars/lod_sheet.py) and [contact sheet]. The repository's `renders/` ignore rule covers the JPEG.
- This report.

Adapted from “Generic passenger car pack” by Comrade1280, CC BY. [Original pack](https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5)
