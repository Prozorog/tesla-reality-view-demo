# T8 · Integration fixes and performance

High met 60 fps at 2560 × 1440 on the RTX 4070 Laptop GPU. Low met 30 fps at 1920 × 1080 on Iris Xe. The shallow-orbit sweeps peaked at **225 draws** and **275,082 triangles**. The largest Reality View submission across the checks and stills was 280,010 triangles. Both live parking runs ended with zero pose error and zero overlaps.

## Baseline before render changes

The same application sources and assets as `6c99d9f` were built with measurement hooks only. `heavy npm run build` and `heavy --timeout 5 npm run shots -- http://localhost:4106/ tools/profile-t8.json` passed. Chrome used `ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Laptop GPU (0x00002860) Direct3D11 vs_5_0 ps_5_0, D3D11)`. The production preview ran in headless Chrome at DPR 1. The runner asserted the actual WebGL drawing-buffer dimensions in each case.

Each check positions the seeded demo on its cruise route or at 8% of the B058 reverse, resumes live simulation, warms for 0.8 s, and samples browser animation timestamps and CPU stages for 2.5 s. Both ends of each sample are checked for drive mode and inset visibility. The GPU column uses non-blocking `EXT_disjoint_timer_query_webgl2` queries sampled every fifth frame, with zero disjoint events in the baseline. CPU and GPU times are measured independently. Counts are the mean `renderer.info` calls and triangles per invocation.

| Tier and buffer | Stop | Cruise FPS | Reverse FPS |
| --- | --- | ---: | ---: |
| High 2560 × 1440 | Seat | 17.1 | 16.6 |
| High 2560 × 1440 | Screen | 16.6 | 13.2 |
| Low 1920 × 1080 | Seat | 44.1 | 37.2 |
| Low 1920 × 1080 | Screen | 23.9 | 23.5 |

The HUD draw and texture transfer took 36–64 ms on the GPU across the eight cases. Canvas2D submission took 0.35–0.43 ms of CPU time per redraw. The culling and instance-buffer stage took 0.027–0.066 ms of CPU per world submission, and softness cost 0.056–0.488 ms on the GPU. At the Screen stop there was already no seat or tablet submission, so the slowdown there remained even with a single world in cruise. The Low seat redraws its HUD on alternate frames, explaining why it paced faster than the Low Screen stop. The unnecessary rear world in Seat cruise still added about 1.2 ms of CPU on frames that drew it.

### Baseline pass breakdown during reverse

Cells show **mean CPU ms / mean GPU ms** per invocation. A dash indicates a stage with no GPU commands or a pass absent at that stop. Low refreshes the tablet and rear on alternate frames.

| Stage | High Seat | High Screen | Low Seat | Low Screen |
| --- | ---: | ---: | ---: | ---: |
| Fixed step | 0.22 / — | 0.30 / — | 0.14 / — | 0.22 / — |
| World sync | 0.25 / — | 0.26 / — | 0.25 / — | 0.28 / — |
| Rear visibility | 0.05 / — | 0.05 / — | 0.04 / — | 0.07 / — |
| Rear world | 1.63 / 0.49 | 1.51 / 0.69 | 1.74 / 0.96 | 1.37 / 1.19 |
| HUD canvas | 0.40 / — | 0.42 / — | 0.39 / — | 0.38 / — |
| Marker update | 0.02 / — | 0.02 / — | 0.02 / — | 0.02 / — |
| Reality View visibility | 0.03 / — | 0.05 / — | 0.03 / — | 0.04 / — |
| Reality View world | 1.41 / 0.58 | 1.31 / 2.12 | 1.34 / 1.76 | 1.14 / 1.61 |
| Softness | 0.05 / 0.19 | 0.06 / 0.45 | 0.04 / 0.20 | 0.03 / 0.39 |
| Sharp overlays | 0.11 / 0.13 | 0.12 / 0.04 | 0.10 / 0.01 | 0.09 / 0.02 |
| HUD composite and transfer | 0.29 / 53.15 | 0.30 / 64.46 | 0.27 / 40.72 | 0.22 / 39.72 |
| Seat visibility | 0.04 / — | — | 0.03 / — | — |
| Seat world | 1.56 / 1.67 | — | 1.85 / 2.35 | — |
| Whole CPU frame | 6.25 | 4.51 | 4.38 | 3.23 |
| Frame interval, mean / p95 | 60.13 / 69.50 | 75.73 / 97.20 | 26.87 / 55.50 | 42.62 / 55.60 |

| Baseline reverse render counts | Reality View draws / triangles | Seat draws / triangles | Rear draws / triangles |
| --- | ---: | ---: | ---: |
| High Seat | 199 / 307,744 | 211 / 313,849 | 151 / 337,568 |
| High Screen | 195 / 292,067 | — | 152 / 337,949 |
| Low Seat | 199 / 309,304 | 211 / 314,340 | 152 / 337,922 |
| Low Screen | 195 / 290,940 | — | 152 / 337,394 |

## Final profile

The production profile used the corrected cabin and the nine-type T4b LOD pack. The RTX run reused the baseline command and camera cases. For the Iris run, the same manifest was filtered to the four Low checks, set to `integratedGPU: true`, and given one extra Seat reverse case with playback started by clicking the music control. The runner passed Chrome's low-power adapter argument and asserted the renderer string `ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)`. The Seat cases were repeated after the last cabin export. The timer extension reported zero disjoints. The RTX cases reached the machine's 144 Hz frame pacing. [Chromium adapter selection](https://chromium.googlesource.com/chromium/src/+/f35df3e3e2276c4ec658d66961789ceb4fc4e278)

| Tier and buffer | Adapter | Stop | Cruise FPS | Reverse FPS | Cruise / reverse p95 frame ms |
| --- | --- | --- | ---: | ---: | ---: |
| High 2560 × 1440 | RTX 4070 Laptop | Seat | **144.0** | **144.0** | 7.1 / 7.1 |
| High 2560 × 1440 | RTX 4070 Laptop | Screen | 144.0 | 144.0 | 7.1 / 7.1 |
| Low 1920 × 1080 | Iris Xe | Seat | **93.2** | **73.6** | 27.7 / 34.5 |
| Low 1920 × 1080 | Iris Xe | Screen | 134.4 | 98.7 | 7.3 / 20.7 |
| Low 1920 × 1080 | RTX 4070 Laptop | Seat | 144.0 | 144.0 | 7.1 / 7.1 |
| Low 1920 × 1080 | RTX 4070 Laptop | Screen | 144.0 | 144.0 | 7.1 / 7.1 |

Iris Xe Seat reverse with music playing averaged **72.8 fps** with a 34.7 ms p95 frame interval. That sample had 32 HUD redraws in 182 submitted frames, about 12.8 Hz. Matching the canvas to the tablet reduced p95 CPU time in the HUD composite and upload stage from 22.5 to 4.9 ms in the playback probe. Steady samples had zero HUD redraws, with one redraw in the RTX Low Seat cruise sample as the clock changed minute. High Seat reverse refreshed the parked cache 34 times across 1,080 world submissions. High Screen cruise made no rear submissions, and Seat cruise refreshed the rear mirror 12 times in 2.5 s.

### Final pass breakdown during reverse

Cells show **mean CPU ms / mean GPU ms** per invocation, following the baseline measurement. Each stop has a single Reality View submission. The Seat uses the tablet target, and the Screen renders to the presentation buffer.

| Stage | High Seat · RTX | High Screen · RTX | Low Seat · RTX | Low Screen · RTX | Low Seat · Iris | Low Screen · Iris |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Fixed step | 0.06 / — | 0.06 / — | 0.07 / — | 0.05 / — | 0.16 / — | 0.17 / — |
| World sync | 0.18 / — | 0.19 / — | 0.21 / — | 0.18 / — | 0.28 / — | 0.41 / — |
| Rear visibility | 0.013 / — | 0.010 / — | 0.012 / — | 0.014 / — | 0.029 / — | 0.038 / — |
| Rear world | 1.17 / 0.40 | 0.82 / 0.66 | 1.38 / 1.52 | 0.94 / 0.89 | 1.79 / 1.78 | 2.71 / 1.88 |
| HUD raster and hit-test update | 0.02 / — | 0.02 / — | 0.03 / — | 0.02 / — | 0.04 / — | 0.05 / — |
| Marker update | 0.01 / — | 0.01 / — | 0.01 / — | 0.01 / — | 0.02 / — | 0.02 / — |
| Reality View visibility | 0.011 / — | 0.007 / — | 0.014 / — | 0.009 / — | 0.022 / — | 0.025 / — |
| Reality View world | 0.88 / 0.94 | 0.66 / 3.70 | 0.97 / 1.32 | 0.76 / 4.20 | 1.34 / 1.90 | 1.75 / 4.24 |
| Softness | 0.02 / 0.37 | 0.02 / 0.51 | 0.02 / 0.05 | 0.02 / 0.52 | 0.04 / 0.19 | 0.06 / 1.44 |
| Sharp overlays | 0.09 / 0.18 | 0.07 / 0.19 | 0.09 / 0.05 | 0.07 / 0.23 | 0.12 / 0.02 | 0.16 / 0.11 |
| HUD composite and transfer | 0.02 / 0.21 | 0.01 / 0.13 | 0.01 / 0.04 | 0.01 / 0.19 | 0.03 / 0.09 | 0.02 / 0.41 |
| Seat visibility | 0.005 / — | — | 0.008 / — | — | 0.017 / — | — |
| Seat world | 1.01 / 3.21 | — | 1.13 / 4.78 | — | 1.51 / 10.16 | — |
| Whole CPU frame | 3.59 | 1.95 | 2.78 | 1.69 | 3.82 | 4.24 |
| Frame interval, mean / p95 | 6.94 / 7.10 | 6.94 / 7.10 | 6.94 / 7.10 | 6.94 / 7.10 | 13.59 / 34.50 | 10.13 / 20.70 |

### Final render counts at the target resolutions

Counts are mean draws / triangles when the view is submitted. The Seat's rear cruise entry is the 5 Hz mirror refresh.

| Profile | Reality View | Seat | Rear |
| --- | ---: | ---: | ---: |
| High Seat cruise | 173 / 150,520 | 137 / 168,719 | 89 / 146,849 |
| High Seat reverse | 181 / 225,336 | 163 / 282,750 | 142 / 257,445 |
| High Screen cruise | 173 / 150,104 | — | — |
| High Screen reverse | 173 / 215,201 | — | 142 / 257,425 |
| Low Seat cruise, Iris Xe | 173 / 150,702 | 137 / 168,818 | 89 / 146,830 |
| Low Seat reverse, Iris Xe | 181 / 225,369 | 163 / 281,723 | 142 / 257,477 |
| Low Screen cruise, Iris Xe | 173 / 150,124 | — | — |
| Low Screen reverse, Iris Xe | 173 / 215,102 | — | 142 / 258,155 |

## Integration decisions

- The HUD canvas stays CPU-backed. The HUD invalidates immediately for changes to the speed readout, gear, parking state, controls, and track or play state. It checks clock, progress, touch, and rear guides on a 15 Hz redraw cadence. The Seat canvas matches its tablet target until the last part of the dive, which reduces the transfer size while music progress is updating. The rear image remains a separate GL texture, and marker hit tests continue to use the current camera. In the isolated HUD and mirror scheduling check, High Seat cruise moved from 17.1 to 143.2 fps and High Screen reverse from 13.2 to 142.8 fps. The corresponding HUD GPU stages fell to 0.22 and 0.16 ms.
- The rear target follows the existing inset stride and updates the cabin mirror at up to 5 Hz outside reverse. The Screen stop omits the cabin and tablet pass. The world softness shader and its target sizes are the same as in T7.
- Parked instance buffers refresh per view after 0.65 m of travel, 1.5° of rotation, a projection change, or a parking occupancy revision. The cached frustum includes a margin for these thresholds. Both moving and parked cars select the manifest LOD at about 30 m with a 29–31 m hysteresis band. The distant shells reuse the full paint materials and moving cars retain their separate lamp faces. Each full-detail parked car type batches its four passive optical surfaces into one draw. The full meshes also serve as the fallback for a missing LOD.
- Haze starts at 70 m and reaches full fog at 235 m. At 150 m of view depth the fog blend leaves about 52% of the original scene colour. All three far planes reach 220 m. The restored skyline and the longer line of lamp heads can be seen down the west aisle.
- The Reality View dissolves near or overlapping lamp assemblies and tree canopies over 0.3 s using per-instance dither. The camera sweep uses bounds from the lot prototypes for the poles, trees and hedge plus the building mesh bounds. A blocked cruise camera moves toward the car and eases back after the path clears. Fixture and bay lights keep their baked contribution through the fade.
- The two lobes share a single 12 m asphalt decal with a 2–5 m warm-white peak. Brake and reverse use short rearward decals of 2.0 m and 2.2 m. World depth occludes them under car bodies and the later marker layer covers them. Wheel materials use a cooler, lower reflectance, and the lamp lens rims and signs have higher emission.
- The neutral seat uses the exported eye with a 55° vertical lens, 8° of rightward aim, and 14° down. The physical tablet and hit-test ray use the same quad. The dash weave, door insert and headlining have material-specific night reflectance caps that preserve tint in the cabin lightmap. `Cancel Selection` is hidden when reverse begins. Keyboard takeover continues to use the simulation's existing input path.

## Updated module map

| Changed path | Responsibility |
| --- | --- |
| `src/assets/car-models.ts` | Manifest cabin bake, trim reflectance caps, and existing seat mounts |
| `src/assets/index.ts`, `src/assets/lot-model.ts` | Lot obstacle bounds, per-instance shader bindings, fixture rims and sign emission |
| `src/assets/passengers.ts` | Full and low-detail pack materials, parked optics batches, moving lamp bindings and full-detail fallback |
| `src/render/cameras.ts`, `src/render/lot-occlusion.ts` | Seat lens and aim, cruise sweep against lot props, Reality View dither |
| `src/render/night-light.ts`, `src/render/vehicle-decals.ts` | Distance haze and depth-tested vehicle light pools |
| `src/render/traffic-view.ts` | Cached visibility and distance LOD, dynamic vehicle transforms and lighting |
| `src/render/scene.ts`, `src/render/profile.ts`, `src/main.ts` | Render scheduling, draw counts, opt-in CPU and GPU profiling, and diagnostics for the verification runner |
| `src/ui/interface.ts`, `src/ui/panels.ts` | HUD texture invalidation, live hit tests, and the cancel control's visibility |
| `tools/shots.mjs`, `tools/profile-t8.json`, `tools/check-integration.json`, `tools/shots-s3b.json` | Target-resolution profiling, adapter selection for the Low check, controls and parking assertions, shallow orbits, and stills |

## Verification

| Check | Result |
| --- | --- |
| `heavy npm run build` | Passed with both delivered asset sets. Production JS is 743.55 kB, 203.65 kB gzip. |
| `heavy npm run typecheck` | Passed. |
| `heavy npm run check:parking` | Passed 40/40 free bays. Tightest swept clearance was 0.335 m at B053. The 398.1 m cruise loop had 0.318 m minimum clearance. |
| `heavy npm run check:dive` | Passed on the corrected cabin GLB. The worst handover difference was 0.001966% of window height over 45 projections. All 75 seat rays hit the intended tablet UV, with maximum error 1.81e−14. |
| `heavy --timeout 6 npm run shots -- http://localhost:4106/ tools/check-integration.json` | Passed both `?bot=1` parks with traffic. High and Low each parked at B004 in 70.9 s with four active cars, 0.000 m / 0.000° error, zero overlaps, and zero browser console errors. Both moved from Screen to Seat and back during reverse. The control checks passed real tablet and Screen clicks for bay selection, cancel, music, and End Trip. |
| `heavy --timeout 3 npm run shots -- http://localhost:4106/ tmp/check-t8-focused.json` | The controls and orbit sweeps passed again with the corrected cabin, final HUD sizing and final fade geometry. At 16:10 the four tablet corners were in frame and the projected width was 28.16% of the window. The reverse checks found no cancel button. |
| `heavy --timeout 3 npm run shots -- http://localhost:4106/ tools/shots-s3b.json` | Exited 0. Seven 1280 × 800 JPEGs at quality 70 using `?shot=1`. Chrome reported zero asset fallbacks or console errors. The preview cabin GLB, manifest, lightmap, and the two LOD files matched their source hashes. |

The shallow check samples a full rotation at 35° in 5° steps around B076 and B058. The highest shallow draw count was **225** at B076, and the highest shallow triangle count was **275,082** at B058. Both were measured with the real nine-type LOD pack. Each live run peaked at 212 draws and 271,012 triangles. The counts include the world, softness, sharp overlays and HUD. The rear feed and seat are separate submissions.

The first rebuild hit Windows `ENOTEMPTY` and `EPERM` on `dist/music`. Closing the temporary preview released the handle and the default build succeeded.

## Final stills

| Capture | Reality View draws / triangles | Seat draws / triangles | Rear draws / triangles |
| --- | ---: | ---: | ---: |
| [Seat cruise] | 190 / 237,493 | 184 / 289,968 | — |
| [Seat parking, wheel turned] | 167 / 280,010 | 165 / 244,361 | 122 / 269,963 |
| [Cruise toward the storefront] | 150 / 194,794 | — | — |
| [Cruise down the west aisle] | 194 / 194,623 | — | — |
| [Overhead reversing with inset] | 185 / 268,340 | — | 155 / 269,510 |
| [Parked overhead] | 148 / 196,825 | — | — |
| [Overhead orbit at 40°] | 164 / 239,230 | — | 156 / 262,441 |

## Remaining differences

1. Iris Xe exceeds the average frame-rate target in every case. Its p95 frame interval reaches 34.7 ms in Seat reverse with music, slightly above the 33.3 ms frame budget.
2. The Seat lens crops the lower wheel rim and the right edge of the interior mirror in the neutral 16:10 view. The full tablet remains in view.
3. A faded lamp still leaves its baked circular ground footprint. The distant building silhouettes also remain simpler than the reference storefronts.
