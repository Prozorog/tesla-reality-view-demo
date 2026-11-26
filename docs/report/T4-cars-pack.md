# T4 — Passenger car pack

Nine traffic cars share 63,273 triangles across 30 paint variants. The GLB is 3.76 MB. All 55 external textures together occupy 2.82 MB. The FBX imported with all ten original bodies and their wheels. The sport car and the circular display plinth were excluded.

**Credit.** “Generic passenger car pack” by Comrade1280, CC BY. Adaptations include orientation, uniform scale, repainting, texture conversion, new material assignments, and splitting existing lens surfaces for independent illumination. [Original pack on Sketchfab](https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5)

## Deliverables

| File | Contents |
| --- | --- |
| `public/models/cars.glb` | Nine independently cloneable car roots, each with one body mesh and its default paint |
| `public/models/cars.json` | Dimensions in metres, wheelbase, node names, triangles, variants, PBR map paths, and lamp positions |
| `public/models/textures/cars/` | 30 body JPEGs at 1024², nine lossless body metallic-roughness atlases at 1024², seven wheel texture pairs and two lens maps at 512² |
| `scripts/build_cars.py` and `scripts/cars/{catalog,geometry,textures}.py` | Source staging, FBX split, materials, repainting, export, and GLB checks |
| `scripts/render_cars.py` and `scripts/cars/sheet.py` | GLB re-import, four Cycles views and sheet assembly |
| `assets-src/cars/` | Git-ignored FBX and texture working copies, local inspection and QA files |
| `renders/cars/sheet.jpg` | Two common-scale views, all four sedan colours and a two-car night view, 1584 × 826 px |

[Open the contact sheet]

## As built

Width includes mirrors. Wheelbase is the distance between the midpoints of the two wheel pairs. The first colour is embedded as the default.

| Type | Length × width × height (m) | Wheelbase (m) | Triangles | Colours |
| --- | --- | ---: | ---: | --- |
| Sedan | 4.70 × 2.093 × 1.447 | 2.820 | 7,178 | silver, white, black, red |
| Wagon | 4.75 × 2.113 × 1.496 | 2.854 | 7,022 | darkblue, silver, darkgrey |
| Hatchback | 4.25 × 1.871 × 1.453 | 2.582 | 6,856 | white, darkgrey, darkblue |
| Compact | 3.90 × 1.925 × 1.575 | 2.494 | 7,289 | darkgrey, white, silver |
| Coupe | 4.50 × 2.000 × 1.356 | 2.561 | 6,054 | red, silver, black, darkblue |
| Minivan | 5.10 × 2.067 × 1.951 | 3.143 | 7,457 | white, silver, darkgrey |
| Pickup | 5.40 × 2.155 × 1.770 | 3.330 | 6,941 | darkgrey, silver, white |
| SUV | 4.70 × 2.107 × 1.767 | 2.783 | 7,950 | black, white, darkblue, silver |
| Offroad | 4.60 × 2.289 × 1.833 | 2.710 | 6,526 | silver, black, darkgrey |

## Integration and decisions

- Read a car at `manifest.types[type]`. Clone its named root. All seven child meshes have identity transforms. `nodes.body` is a single mesh with a single paint material. `nodes.wheels` contains the four original tyres and rims. `nodes.glass` and `nodes.lenses` carry the fixed glass, indicators, and other passive optics.
- Resolve `variants[].map` relative to `cars.json`. For a Three.js texture loaded separately, use sRGB and `flipY = false`. Clone the paint or lamp material for instances whose appearance changes independently. Metallic and roughness use the same linear texture, with roughness in G and metallic in B. Each wheel design has its own diffuse and packed PBR atlas.
- The two clip A frames guided the palette and near-black glossy glazing. The paint mask combines source hue and saturation with the finish boundaries encoded in the gloss and metallic maps. Those boundaries identify the achromatic SUV paint. Each repaint retains the source shading and panel lines. Paint roughness is 84% of the inverted source gloss value on fully painted texels. The FBX supplies separate glass geometry.
- `nodes.lights_head`, `nodes.lights_tail`, and `nodes.lights_brake` have separate textured emissive materials with their tint preserved and initial strength zero. Drive `emissiveIntensity` on the corresponding material. Original clear front lens faces form the heads. A horizontal cut through the original red apertures gives separate lower tail and upper brake surfaces with continuous UVs.
- `lightPositions.head`, `.tail`, and `.brake` each contain the area-weighted left and right cluster centres, in that order, in local glTF / Three.js metres. +X is forward, +Y is up, and −Z is left. The night sheet stages the pools from those positions. The game supplies the runtime pools.

## Execution and checks

The scripts used Blender 5.2.2 in background mode. Image processing used the installed system Python with Pillow and NumPy. Run the commands from the project root.

| Command | Result |
| --- | --- |
| `heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P scripts\build_cars.py` | Passed in 11.2 s from an empty input working copy. Verified the emitted roots, identity transforms, named children, bounds, PBR slots, lens materials and indexed triangle counts. |
| `heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup --python-exit-code 1 -P scripts\render_cars.py` | Passed. The final round took 8.5 s including GLB re-import and JPEG assembly, using the RTX 4070 Laptop GPU through OptiX. |
| `heavy python assets-src\cars\check_delivery.py` | Passed. Read the binary POSITION buffers, checked all 36 tyres and verified map sizes, formats, and emitted lamp factors. |

Maximum length error was 0.0007 mm. Maximum horizontal origin error was 0.0005 mm. All roots are at ground level. The largest individual tyre gap is 1.44 mm, inherited from the pack's wheel alignment. All neutral-colour body maps have zero pixels with an 8-bit maximum channel above 100 and channel spread above 70.

The first visual round exposed the review camera's ineffective car rotations and bright mixed-colour texels on three atlas boundaries. The final round corrected the poses, removed the source hue from those edge texels and narrowed the studio highlights. Glass, grille and lamp details stayed distinct in the overhead and three-quarter views.

During development, Blender's exporter raised `KeyError: 'loglevel'` for an explicit log-level argument. The build now uses its default. A count check also caught one overlapping pickup triangle. Mesh validation removes it before export. Blender still emits a sampler warning for each packed PBR material because two shader inputs reference the same image and sampler.

## Weaker than the reference

1. Close views reveal the source pack's low-poly contours and baked panel shading. The effect is clearest on the sedan nose and the offroad vehicle's broad flat panels.
2. The FBX's wheel F diffuse is absent from the supplied textures. The coupe uses the supplied `wheel_1` atlas. The offroad car uses the supplied G atlas matching its wheel mesh. Exact original rim finishes for those two are uncertain.
3. Tail and brake surfaces share the original red lens outline. Their upper/lower division is an approximation. The contact sheet demonstrates them under staged parking lights. In-game lamp intensity and asphalt reflections depend on the lot integration.
