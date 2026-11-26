# T7 · Real assets in Reality View

The Model 3, cabin, passenger pack, and Northgate lot now render from the Blender exports in the same scene. The browser runs used the final T5b lot from `d477882`. The layout SHA-256 is still `b8dbc5fbdd735a5f1e17219f926f9686601724f7f08fcfb002ed89b9b33dd7c3`.

## Integration and decisions

- The Model 3 uses its exported wheel centres and rest rotations. The front wheels steer about +Y, all four roll about their glTF axle, and the cabin wheel turns on its exported axis at 10:1. Headlamps, running lamps, brakes, reverse lamps, and indicators use their own materials. The indicators use the same 3.1-phase clock as the audio tick. The asphalt receives additive headlamp, brake and reverse pools. The player has a separate contact shadow and a longer, fainter shadow that blends between lamps from `lot.json`.
- The seat is at `eye_driver`. Only the seat omits `model3.glb`’s opaque `glass`. Ray probes from the neutral seat pose hit the hood and both mirror meshes. The rear camera uses the exported trunk-lip station, lifted 27 mm for the lens. The existing rear feed also appears in the real cabin mirror. A slightly wider seat lens and inward aim keep the mirrors and tablet in view from the left seat.
- Cabin and lot receivers use their manifest sRGB UV1 lightmaps and Three.js intensity values. The final lot exercises 20 receiver entries, 15 emissive entries, and 165 furniture transforms from 11 groups. Each lightmapped instance samples its own atlas rectangle. The cabin wheel, screen, and strip have their authored unmapped assignments. The real `screen_surface` gets the shared HUD and scene texture. Its exported V is inverted once for the render target, and the same quad defines the dive and hit tests.
- The 68 baked car placements use their type, resolved paint, pose, and five linear diffuse probes. Startup and moving cars use the same pack with lamp-position lighting. Passenger turn signals illuminate the original amber lens tiles. Parked contact shadows use one instanced draw per camera and sit slightly downbeam of the nearest pole. Parked bodies batch by type and paint. Other parts share a batch per type and material. Each camera compacts visible oriented bounds into its own instance buffers, so switching to the rear or seat pass keeps the other pass’s uploads intact.
- The comparison with `park-a-04.jpg` led to tighter chosen-bay framing, stronger contact shadows, and brighter grazing highlights on the paint and glass. The cabin comparison led to darker `Dash weave` and `Door insert` albedo and a slightly lower seat aim. A shared static environment, exposure shoulder, and blue-black haze keep the same scene grade in all three cameras. Fog starts at 23 m and becomes opaque at 43 m of view depth. Passenger geometry beyond that plane is culled, including in shallow orbits across multiple rows. Nearby cars use every triangle of the pack. The brake pool was checked against `park-b-20.jpg`.

## Verification

| Check | Result |
| --- | --- |
| `heavy npm run build` | Passed. Production JavaScript 729.85 kB, 199.27 kB gzip. Vite reports a chunk-size warning. |
| `heavy npm run typecheck` | Passed. |
| `heavy npm run check:parking` | 40/40 free bays. Tightest swept clearance 0.335 m at B053. Cruise clearance 0.318 m over the 398.1 m loop. |
| `heavy npm run check:dive` | Used the cabin GLB’s positions, indices, and UVs. Worst handover difference 0.001966% of window height over 45 projections. All 75 tablet rays hit the intended UVs with a maximum error of 1.81e−14. |
| `heavy --timeout 6 npm run shots -- http://127.0.0.1:4103/ tools/check-integration.json` | Chrome on the RTX 4070 Laptop GPU via ANGLE/D3D11. The high-tier seat tablet and low-tier full window passed start, bay selection, cancel, music controls, and End Trip. Both live `?bot=1` tiers parked at B004 in 71.0 s with four active traffic cars, 0.000 m / 0.000° error, zero overlap frames, and zero console errors. Both runs moved from Screen to Seat and back while reversing. |
| `heavy --timeout 3 npm run shots -- http://127.0.0.1:4103/ tools/shots-s3.json` | Exited 0. Eight 1280 × 800 JPEGs at quality 70 with `?shot=1`. The wheel-turn shot has 0.46 rad of road-wheel steer. The browser reported zero asset fallbacks. Lot GLB, manifest, and both lightmap hashes matched before and after capture. |

The live scenarios completed before the Windows Playwright process stalled during shutdown. The runner now bounds Chrome shutdown to eight seconds after all assertions, then lets the heavy queue release the process tree. The final stills completed with that timeout and a successful exit.

## Render counts

F2 or Backquote shows `renderer.info` counts for Reality View, seat, and rear, along with the overhead peak. The Reality View column includes the world, softness composite, ribbon and markers, and HUD. Seat and rear are separate submissions.

| Capture or stress case | Reality View draws / triangles | Seat draws / triangles | Rear draws / triangles |
| --- | ---: | ---: | ---: |
| Seat cruise | 195 / 299,919 | 203 / 325,988 | 170 / 330,286 |
| Seat parking, wheel turned | 188 / 229,333 | 193 / 273,708 | 143 / 296,357 |
| Mid-dive | 197 / 294,007 | 181 / 291,453 | 153 / 335,693 |
| Screen cruise toward storefront | 169 / 232,230 | 0 / 0 | 0 / 0 |
| Overhead reversing with inset | 197 / 294,007 | 0 / 0 | 153 / 335,693 |
| Overhead turned 40° | 198 / 305,868 | 0 / 0 | 153 / 335,693 |
| Parked overhead | 152 / 167,457 | 0 / 0 | 0 / 0 |
| Seat looking right | 194 / 299,957 | 190 / 287,187 | 173 / 337,875 |
| B076 shallow parking orbit | **220 / 443,040** | 0 / 0 | 0 / 0 |

**Observed Reality View maximum was 220 draws and 443,040 submitted triangles**, at the 35° B076 orbit across the rows. Both B004 live runs peaked at 210 draws and 351,700 triangles over the entire run. Once the parking framing settled, their Reality View peak was 148 draws and 189,333 triangles.

During the live reverse, 1.2 s frame-rate samples at 1280 × 800 gave **25.7 fps Seat / 31.3 fps Screen** on high and **55.1 fps Seat / 29.8 fps Screen** on low. Both used the RTX 4070. The high Seat sample fell below the performance target. There was no Iris Xe measurement.

## Stills

| Seat and transition | Reality View |
| --- | --- |
| [Seat cruise] | [Cruise toward the storefront] |
| [Seat parking, wheel turned] | [Overhead reversing with inset] |
| [Mid-dive] | [Overhead orbit at 40°] |
| [Seat looking right] | [Parked overhead] |

## Remaining differences

1. The parked-car roof and glazing silhouettes are simpler than in the clip, especially `offroad_body`, `sedan_body`, and the pack’s `*_glass` meshes. The overhead glints come from a static environment. The reference has brighter, localised specular highlights on the Model 3 and on the neighbouring cars.
2. In `cabin.glb`, the `Roof reveal` primitive of `mirror_housing` has a wide diagonal support when seen off-axis from the exported eye. The two exterior mirror housings sit near the sides of the neutral seat frame. The official cabin photo is more centred and shows more of the wheel and lower console.
3. The stronger distance haze required for the shallow-orbit budget mutes the far street and the `Horizon_buildings` and `Distant_offices` backdrop. The lot uses `Night_horizon` as delivered. Nearby storefronts and lamp heads retain their baked colour.

Passenger car source by Comrade1280, CC BY. [Generic passenger car pack](https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5)

## Module map and changed files

| Path | Responsibility |
| --- | --- |
| `src/assets/index.ts`, `gltf.ts` | Asset seam, GLB and texture cache, receiver materials, camera layers, and load-failure fallbacks |
| `src/assets/car-models.ts`, `tablet.ts`, `car-boxes.ts` | Model 3 and cabin node bindings, rear-camera mount, tablet basis and UVs, and player fallbacks |
| `src/assets/lot-model.ts`, `passengers.ts`, `passenger-boxes.ts` | Lot manifest and instance atlas rectangles, baked parked-car probes, paint variants and pack lamp materials, and passenger fallback |
| `src/render/night-light.ts`, `vehicle-lighting.ts`, `vehicle-decals.ts` | Shared night grade and environment, directional car diffuse light, contact and cast shadows and light pools |
| `src/render/scene.ts`, `traffic-view.ts`, `cameras.ts`, `dive.ts` | Shared rendering passes and counters, full-detail car batching and culling, seat and parking framing, and real-quad dive |
| `src/main.ts` | Asset startup, F2 diagnostics, and existing fixed-step input, UI and audio dispatch |
| `src/render/markers.ts`, `ribbon.ts`, `world-picture.ts`, `src/ui/`, `src/audio/`, `src/simulation/` | Existing Reality View layers and controls, audio, traffic, and parking simulation |
| `tools/check-dive.mjs`, `shots.mjs`, `check-integration.json`, `shots-s3.json` | GLB projection and ray tests, Chrome controls, live bots, budget readings, and stills |
