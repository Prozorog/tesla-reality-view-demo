# T9 · Night polish and production verification

High averaged **143.9 fps cruising and 144.0 fps reversing** in the Seat on the RTX 4070 at 2560 × 1440. Low averaged **91.9 and 89.7 fps** in the Seat on Iris Xe at 1920 × 1080. The largest observed Reality View pass was **233 draws**, and its largest triangle count was **273,168**. All five S5 priorities shipped.

## Rendering changes

- The cruise camera targets a car centre at 58% of the picture height. It widens the lens as needed to reserve space above the cards. In the west-aisle still the visible body is centred at about 59% and has about 30 px of clearance above the music card. Parking framing fits the car, chosen bay and reverse ribbon around the cards and rear inset. The warm headlight decal fades to zero 9 m ahead of the bumper and the player decal switches off in `P`.
- Two warm point sources follow the nearest lot lamps and sweep through the cabin materials as the car moves. Their falloff is local to the cabin, and the tablet surface stays unlit. The east-aisle still was taken with the dash about 2.6 m from the lamp post in plan view.
- The roof and hood sample a 32 × 32 cube face resolution. High captures the lot lamp heads and lit storefront every sixth submitted frame when the car has moved at least 5 cm since the previous capture. Low captures once at the lot centre. Both tiers keep the painted body and smoked glazing on their authored metallic and roughness response.
- Visible emitters feed bloom before the sharp overlays are drawn. High uses nine samples at quarter resolution and Low uses five at eighth resolution, in logical picture coordinates. Tablet and direct views share the same bloom and softness shader. The softness uses 0.92 px sampling offsets on the 1280-wide logical frame, with fine grain and a light vignette. The Seat composite adds bloom to the cabin and windshield view and keeps the tablet surface sharp.
- At steady stops High refreshes the 1280 × 800 tablet and 480 × 300 rear target every frame. Low refreshes the 960 × 600 tablet and 320 × 200 rear target on alternate frames. The tablet refreshes through the dive crossfade to keep both paths current. The rear target runs only while the inset is visible. The physical mirror uses its environment reflection while the inset is closed. Screen skips the Seat and tablet passes.

## Production profiles and §11.2

Headless Chrome used ANGLE D3D11, DPR 1 and the production preview. The T8 cruise and B058 reverse cases warmed for 0.8 s and then sampled browser animation timestamps for 10 s. Each reverse sample began and ended in reverse with the inset visible. The default tier was checked on each adapter, and the other cases exercised `?q=high|low`. The GPU timer reported zero disjoints.

- RTX 4070 Laptop renderer reported `ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Laptop GPU (0x00002860) Direct3D11 vs_5_0 ps_5_0, D3D11)`.
- Iris Xe renderer reported `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)`.

| Adapter and tier | Buffer | Stop | Cruise fps | Reverse fps | Cruise / reverse p95 frame ms |
| --- | --- | --- | ---: | ---: | ---: |
| RTX 4070 High | 2560 × 1440 | Seat | 143.9 | 144.0 | 7.1 / 7.1 |
| RTX 4070 High | 2560 × 1440 | Screen | 143.6 | 140.5 | 7.1 / 7.1 |
| Iris Xe Low | 1920 × 1080 | Seat | 91.9 | 89.7 | 21.0 / 27.7 |
| Iris Xe Low | 1920 × 1080 | Screen | 123.4 | 105.3 | 13.9 / 20.7 |
| RTX 4070 Low override | 1920 × 1080 | Seat | 144.0 | 143.9 | 7.1 / 7.1 |
| RTX 4070 Low override | 1920 × 1080 | Screen | 144.0 | 143.0 | 7.1 / 7.1 |

Draw counts are mean draws / triangles per submission, rounded to whole numbers. Reality View includes bloom, softness, overlays and HUD. Seat includes the cabin and its world composite. Rear and the reflection probe are separate submissions.

| Adapter and case | Reality View | Seat | Rear |
| --- | ---: | ---: | ---: |
| RTX High Seat cruise | 205 / 192,516 | 199 / 239,138 | — |
| RTX High Seat reverse | 173 / 226,242 | 171 / 264,803 | 120 / 242,550 |
| RTX High Screen cruise | 204 / 192,137 | — | — |
| RTX High Screen reverse | 169 / 220,845 | — | 120 / 242,819 |
| Iris Low Seat cruise | 204 / 191,384 | 198 / 237,929 | — |
| Iris Low Seat reverse | 173 / 223,727 | 170 / 265,422 | 120 / 242,695 |
| Iris Low Screen cruise | 203 / 190,809 | — | — |
| Iris Low Screen reverse | 169 / 220,653 | — | 120 / 242,246 |
| RTX Low Seat cruise | 204 / 192,488 | 199 / 239,108 | — |
| RTX Low Seat reverse | 173 / 226,269 | 171 / 264,784 | 120 / 242,542 |
| RTX Low Screen cruise | 204 / 192,145 | — | — |
| RTX Low Screen reverse | 169 / 221,073 | — | 120 / 242,650 |

The 35° orbit sweeps peaked at 230 draws / 261,603 triangles at B076 and 232 / 269,237 at B058. The live bot run peaked at 216 draws / 273,168 triangles. Cruise samples recorded zero rear submissions, and Screen samples recorded zero Seat and tablet submissions. High Seat reverse submitted 1,440 tablet and 1,440 rear views in 1,440 Seat frames. Iris Low Seat reverse submitted 448 of each in 897 Seat frames. High Seat cruise captured reflections 240 times in 1,439 frames. Low had zero reflection refreshes after warmup.

## Checks and build

| Check | Result |
| --- | --- |
| §11.1 and §11.2, `heavy --timeout 5 npm run shots -- http://localhost:4106/ tools/profile-t8.json` | Passed on RTX. Chrome loaded all required GLBs with zero GLB warnings, asset fallbacks or console errors. |
| §11.1 and §11.2, `heavy --timeout 5 npm run shots -- http://localhost:4106/ tmp/t9-profile-iris.json` | Passed on Iris Xe. Used the four Low T8 cases with the low-power adapter argument. Zero GLB warnings, asset fallbacks or console errors. |
| §11.3, `heavy npm run check:dive` | Passed. Worst handover error was 0.001966% of window height over 45 projections, below 1%. All 75 tablet rays hit their intended UV with at most 1.81e−14 error. |
| §11.4, `heavy npm run check:parking` | Passed 40/40 free bays. Minimum swept clearance was 0.335 m at B053. Worst end error was 0.000 m / 0.000°. The 398.1 m cruise loop had 0.318 m minimum clearance. |
| §11.5 and §11.6, `heavy --timeout 5 npm run shots -- http://localhost:4106/ tools/shots-s5.json` | Passed. One live `?bot=1` run parked in the first free bay B004 in 71.0 s with four active traffic cars, 0.000 m / 0.000° end error and zero overlap frames. Eight stills and both orbit checks passed. |
| `heavy npm run typecheck` | Passed after fixing a reflection mesh material type mismatch. |
| `heavy npm run build` | Passed once. The app bundle is 751.98 kB, 206.43 kB gzip. |
| Production asset audit | Passed. `dist/` has 86 files totalling 44,505,581 bytes (42.44 MiB). No pack source formats were present. Hash checks against 117 distinct reference and source files found no copies in the output or its 39 embedded GLB images. All 30 processed car variant maps were present. |
| `own-cleanup` | Stopped the temporary production preview on port 4106. |

## Stills

All eight captures are 1280 × 800 JPEGs at quality 70 with `?shot=1`. The cruise, overhead reverse and under-lamp stills were opened for review.

| Capture | Reality View draws / triangles | Seat draws / triangles | Rear draws / triangles |
| --- | ---: | ---: | ---: |
| [Seat cruise] | 207 / 248,706 | 186 / 289,972 | — |
| [Seat parking, wheel turned] | 182 / 272,497 | 167 / 244,365 | 122 / 269,963 |
| [Mid-dive] | 207 / 248,706 | 168 / 293,935 | — |
| [West aisle with chevrons] | 172 / 172,641 | — | — |
| [Overhead reversing with inset] | 181 / 215,356 | — | 155 / 269,510 |
| [Overhead turned 40°] | 184 / 264,160 | — | 156 / 262,441 |
| [Parked] | 147 / 196,823 | — | — |
| [Seat under the lamp] | 150 / 152,443 | 143 / 181,524 | — |

## Review differences, worst first

1. The player paint and roof highlights are darker and subtler than clip A in the reviewed reverse angle. The cube probe represents the lamp heads and storefront, so it omits reflections of the surrounding cars.
2. Overhead framing reserves space for the car, bay and reverse ribbon. The extended forward approach ribbon can reach the edges of the picture.
3. Distant storefronts and trees still have simpler shapes than the reference. The neutral Seat framing still crops the lower wheel rim and the right edge of the mirror.

## Changed files

- `src/render/cameras.ts`, `src/render/vehicle-decals.ts` for framing and ground light spill.
- `src/render/cabin-wash.ts`, `src/render/car-reflections.ts`, `src/assets/car-models.ts`, `src/assets/index.ts` for cabin light, reflections, paint and mirror material binding.
- `src/render/night-light.ts`, `src/render/world-picture.ts`, `src/render/scene.ts` for the bloom signal, composition and pass scheduling.
- `tools/shots.mjs`, `tools/profile-t8.json`, `tools/shots-s5.json` for profiling, checks and captures.
