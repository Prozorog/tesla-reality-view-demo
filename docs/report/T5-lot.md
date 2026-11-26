# T5 · Northgate at night

The shipping lot follows the regenerated 110-bay layout. Cycles baked the 68 assigned cars in place, with their resolved paint variants and parked poses. Their shadows stay on the pavement when the game loads the separate car instances. The final OptiX bake took **14.96 s**. [Final contact sheet]

## Assets and reproduction

| Path | Contents |
| --- | --- |
| `scripts/build_lot.py`, `scripts/lot/` | Layout reader, seeded pavement and window textures, geometry, fixture and car setup, UV packing, bake, export and contact-sheet helpers |
| `public/models/lot.glb` | Four asphalt tiles, Northgate arcade, street and backdrop, furniture prototypes, emissive meshes and one bay datum |
| `public/models/lot.lightmaps.json` | Per-mesh lightmaps, decoding factors, emitter colours, world transforms, per-instance UV rectangles, lamp heads, car probes, density, timing and triangle counts |
| `public/models/lightmaps/lot_ground.png`, `lot_architecture.png` | Denoised, fixed-exposure diffuse lighting |
| `public/models/textures/lot/` | Four asphalt colour maps at 2048 × 1387, four packed roughness/metallic maps at 512 × 346, one shop-interior atlas at 2048 × 512 |
| `scripts/render_lot.py`, `renders/lot/` | Shipping GLB re-import, verification, three JPEG stills and three comparison sheets |
| `assets-src/lot/` | Local build/render logs and the lossless camera frames used to make the final JPEGs |

Run from the repository root. The build reads the current layout and car catalogue on every run. The review uses the system Python with NumPy and Pillow, the installed Windows fonts and the clip A reference in the adjoining `ref` directory.

```powershell
heavy --timeout 60 "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P scripts\build_lot.py
heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup --python-exit-code 1 -P scripts\render_lot.py -- 3
```

Both commands passed in background Blender 5.2.2. The final build took 23.2 s including texture generation and export. Cycles used the RTX 4070 Laptop GPU through OptiX with a 256-sample setting, three diffuse bounces and direct plus indirect diffuse passes with colour disabled. Two edge-aware passes denoised the linear HDR images before encoding. The three development bakes together took 37.2 s. Blender's device enumeration also reported an unavailable HIP library while the selected OptiX device completed the work.

## Delivery checks

| Check | Final result |
| --- | --- |
| Coordinate conversion | Blender `(x, −z, y)` to glTF `(x, y, z)`. Re-import recovered B001 at `(−34.099998, 0, −24.650000)` against `(−34.1, 0, −24.65)`. The heading matched and a downward ray hit `Asphalt_00` at ground level. |
| UVs and contents | All 18 lightmapped meshes had both UV sets after re-import. Every exported mesh matched the receiver or emitter list. The GLB contains 28 meshes and zero car meshes. |
| Ground density | 20.15 px/m along X and 20.19 along Z, on one continuous 1896 × 1288 atlas spanning all four tiles. The street has 12 px/m. |
| Storefront density | 8 px/m on the shell, 7 on window framing and canopy trim, 6 on display furniture. The architecture and furniture atlas is 1984 × 1856. |
| Lightmap range | Ground linear peak 2.096 within range 4. Architecture peak 14.069 within range 16. A ground shadow floor preserves a faint blue toe beneath tyres. |
| Triangles | 8,403 stored, 20,481 with all lot transforms applied. The 68 supplied car placements add 477,117, giving **497,598** before startup traffic. |
| Draw calls | 28 for the instanced lot. Grouping car bodies by type and paint gives 28 current body batches plus 54 other car-part batches, or **110 total**. Using every catalogue paint raises this to 112. These counts cover one world colour pass. |
| File budget | GLB 825,664 bytes, two lightmaps 2,171,683 bytes and external lot textures 3,416,889 bytes. **6,414,236 bytes** combined, or 6.65 MB including the JSON manifest. |

The manifest records the per-group triangle table and SHA-256 of the input layout. The bake used layout `b8dbc5fbdd735a5f1e17219f926f9686601724f7f08fcfb002ed89b9b33dd7c3`. An upstream regeneration during this task resolved the earlier colour mismatches before the first bake. The builder still takes the first catalogue variant whenever a requested colour is missing.

## Runtime lighting

1. Load the GLB through `GLTFLoader` at identity. Resolve manifest file paths relative to `public/models/`. The GLB references its external artwork by URI. Its asphalt base colour uses sRGB, with roughness in G and metallic in B of the linear packed map. Preserve `COLOR_0` on architectural and planted surfaces.
2. For each entry in `meshes`, load its PNG once, use `texture.colorSpace = THREE.SRGBColorSpace`, `texture.flipY = false`, `texture.channel = 1` and clamp-to-edge. Channel 1 selects `TEXCOORD_1`, exposed by Three as `uv1`. The PNG stores the sRGB transfer of linear unit-white diffuse radiance divided by the per-file range.
3. For the exact baked diffuse result, compute `linearAlbedo * decodedLightmapRGB * entry.intensity` and output it as linear emission before the display transform. Decode sRGB once. Ground intensity is 4 and architecture intensity is 16 on this build. With a Three `MeshStandardMaterial.lightMap`, use `entry.threeStandardLightMapIntensity` instead. That field already includes π to compensate for Three's Lambert division. Additional diffuse lamp lighting would double-count the baked contribution. The PBR roughness and environment can supply specular reflections separately.
4. The lot uses **prototype meshes plus manifest transforms**. Read each named prototype's local geometry and material. Replace its displayed source node with one instance batch for *all* its listed transforms, including the first. Compose world translation, right-handed rotation about +Y by `heading` radians, and glTF XYZ scale. All 137 transform records across nine groups include their intended world placement. For each lightmapped instance, sample at `uv1 * lightmapScale + lightmapOffset`, using the rectangle from that transform as per-instance data. Static mesh UVs already point to their final atlas coordinates. This gives each tree, pole and bollard its own baked lighting while sharing geometry and material.
5. Preserve the GLB emissive factors, textures and strengths on the ten named entries in `emissive`. Include those meshes or their instance batches in the bloom pass. The fixture records in `lamps` include actual head positions, aim vectors and `#ffc98a` light colour. The sign and lens surface colours are separately recorded.
6. Resolve a parked car by bay ID in `parkedCars`. Use its type and resolved `color` with the matching car-pack variant. Its world position includes `dx,dz`. Its heading includes `dh` and the π turn for `noseIn`. Five white receivers sampled the roof and the outward-facing nose, tail, left and right sides during the ground bake. The `rgb` values are **already linear diffuse radiance per unit albedo**. Apply them directly to the linear paint, wheel or trim colour. `irradianceRGB` is the roof sample for a one-colour implementation. B103's roof reads `[0.116, 0.099, 0.119]` in shadow, while B003 reads `[1.224, 0.795, 0.460]` under warm light.

The review shades cars with the five samples. For a unit normal `n` in **car-local glTF coordinates**, weight nose or tail by `n.x²`, left or right by `n.z²`, and roof or underbody by `n.y²`. Positive X chooses nose, negative Z chooses left, positive Y chooses roof. The downward colour in the review is `[0.022, 0.025, 0.035]`. Sum the three contributions, multiply by linear albedo and add the car's roughness-dependent specular term. Use per-instance data so cars sharing a paint batch can still catch different pools. The baked car shadows belong to these fixed placements. Additional startup cars and the player's car need their runtime contact shadows.

## Visual review

Each sheet pairs the 14 m overhead render with `park-a-04.jpg`, then shows a 40° orbit at 60° elevation and a 5 m chase view toward Northgate. The last camera set also ships as three separate stills. [Round 1] · [Round 2] · [Round 3]

| Five issues from the first review, worst first | Correction visible in later rounds |
| --- | --- |
| Mid-aisle asphalt was too dark and cool against clip A. | Widened and strengthened the warm pools. The final overhead camera picks a well-lit occupied stretch from the actual irradiance atlas. |
| Roofs and sides shared one flat car tint. | Baked four additional directional samples per car, retained roughness-dependent glints and added a broad sky reflection. |
| Rear bars made the angled rows read as a zigzag grid. | Kept the longitudinal strokes on the angled bay boundaries. Straight, accessible and corral bays retain their rear bars. |
| Sampling speckles broke up the fascia and ground near practicals. | Raised the bake setting from 32 to 256 samples before denoising. The final review also uses a restrained bloom on bright luminaires. |
| Adjacent shop windows repeated the same shelves. | Added gallery and clothing displays among the shelving panels, with recessed panes, foreground merchandise, physical frames, handles and pilasters. |

The last round also softened the overly rectangular repair under a pickup. Patch edges now have chipped corners, broken seams and less contrast. The four asphalt textures are cut from one seeded pavement field with neighbouring edge pixels. Paint, cracks and oil follow the same surface across the tile boundaries.

## Remaining limitations

- The car pack's broad roof panels and opaque glazing still look flatter than clip A on some light-coloured cars. Five directional samples preserve the lighting changes across those shapes, but the available car geometry limits their silhouettes.
- The extra six to eight startup cars can take a fully visible scene above 500k submitted triangles at full car-pack detail. The lot plus the 68 fixed cars fits. The draw-call estimate assumes the runtime batches cars and consumes the manifest transforms. Frame rate and runtime culling were outside this asset build.
- Lamp posts within some rows stand directly on asphalt as specified by the layout. Only four row-end islands have kerb outlines. The opposing V-shaped row angles and the occupancy gaps are also present in the supplied layout.
- The chase view still shows repeated window modules and a simple distant skyline. The review uses distance haze, and night fog and bloom in the game will determine the final horizon appearance.
- Verification used a Blender re-import of the shipping GLB and PNGs. The existing page requires its separate asset integration to reproduce the checked views.
