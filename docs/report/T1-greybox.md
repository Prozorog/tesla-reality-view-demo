# T1 · S1 Greybox

The Vite app opens at the Northgate entrance in the driver’s seat. The tablet and Screen view use the same Reality View camera, Canvas UI, and hit-testing. The lot, body, and cabin use local stand-ins with the named asset contract.

## Run

Use Node.js 24. From the project directory:

```powershell
npm ci --cache './tmp/npm-cache'
heavy npm run build
own-start --keep npm run preview -- --port '{port}'
```

Open the URL printed by `own-start`. To regenerate the lot, run `npm run gen:lot`. Run `heavy npm run typecheck`, `heavy npm run check:parking`, and `heavy npm run check:dive` for the offline checks. Run `heavy npm run shots -- http://127.0.0.1:4103/` against the preview URL, substituting the actual port. The optional second positional argument is a capture manifest. The default manifest is `tools/shots-s1.json`.

## Controls

| Control | Effect |
| --- | --- |
| Start Self-Driving | Cruise from the entrance, or pull forward out of an automatically parked bay and return to the route. |
| Click a free bay or chevron | Select it. Cancel Selection is available during Autopark Ready. These controls work through the cabin tablet and at Screen. |
| Scroll down or up | Move toward Screen or Seat with a spring and snap. |
| `1`, `Esc`, `2` | Go to Seat, Seat, or Screen respectively. |
| Double-click the cabin tablet | Dive to Screen. |
| Move the mouse in Seat | Head-look. The gaze holds over the tablet so its controls stay under the cursor. |
| Drag the Reality View picture | Orbit around the car and tilt. The angle holds on release. Double-click empty road at Screen to recenter the view. |
| `W A S D` or arrows | Take control immediately. `S` or Down from rest reverses. Release the keys to settle in a bay or to let autopilot take over after two seconds. |
| Backtick or `F2` | Toggle the renderer and quality overlay. |

Debug URLs accept `view=seat|screen`, `bot=1`, `bay=<id>`, `q=high|low`, `shot=1`, and `pause=1`. `bay` spawns nearby and reserves that bay from the additional cars when it is free. `shot=1` hides the hint and fixes the occupancy seed for repeatable captures. `window.__rv` exposes the current state, first free bay, end pose, no-overlap flag, and capture controls.

## Lot and decisions

- 90 × 60 m, with 110 bays across five rows. 68 have static cars, two are reserved for cart corrals, and 40 are free. Free bays by row are 9, 8, 7, 8, and 8. The seeded static mix uses all nine car types and six colours. Six to eight additional cars park at startup.
- Four 52° angled rows use 2.60 × 5.50 m bays. The storefront row uses 2.68 × 5.50 m straight bays, including three 2.98 m accessible bays. The first two parking aisles clear 7.08 m and 5.52 m between painted bay edges. The outer parking lane has 2.68 m from centreline to the nearest bay edge, for a 5.37 m nominal aisle, and shares its open side with the south apron.
- The 398.1 m loop serves all five rows. The south apron acts as the return leg. Runtime placement preserves at least two bays within the 25 m marker range. The default 50° cruise camera adjusts heading and briefly widens at the connectors to keep markers visible.
- The planner uses a 4.72 × 1.85 m rear-axle rectangle, 5.8 m minimum radius, and curvature ramps at both ends of the arc. Every verified bay uses one reverse arc and a straight finish. Startup cars sit centred so the largest car rectangle bounds every runtime occupancy tested offline.
- Manual takeover records the driven path and follows it back to the interrupted manoeuvre or cruise route when needed. A nose-in manual park can require backing out. Selecting a bay after its pull-past point schedules it for the next approach on the one-way loop.
- Dive alignment uses the 16:10 tablet crop and a matching sub-frustum on the same Reality View camera, with a 200 ms cross-fade. UI text uses Inter when present and falls back to Segoe UI or the system sans.

## Verification

| Command or check | Result |
| --- | --- |
| `npm install --cache './tmp/npm-cache' --no-audit --no-fund` | Passed, with a package lock. |
| `npm run gen:lot` and `heavy npm run check:parking` | Passed 40/40 free bays with a 5.40 × 2.02 m envelope in every other free bay, in addition to the jittered static cars and kerbs. Worst swept clearance was 0.338 m at B079. Worst end error was 0.000 m / 0.000°. The loop’s closest sampled clearance was 0.318 m, with at least two free bays within 25 m. |
| `heavy npm run check:dive` | Passed 45 car-point projections across three framings and five window shapes. Maximum difference rounded to 0.000000% of window height. |
| `heavy npm run build` and `heavy npm run typecheck` | Passed. The production JS was 566.45 kB, or 150.11 kB gzip. |
| `heavy npm run shots -- http://127.0.0.1:4103/` | Captured all seven stills in installed Chrome. The checks were replayed with the checks-only subset of the same manifest. High and Low loaded without console errors. Low-tier browser input passed tablet Start and Select/Cancel, Screen Select/Cancel, manual reverse, and automatic rejoin. |
| Live `?bot=1` in Chrome | Passed from the entrance. The bot chose its first free bay, B004, and parked at 71.0 s with 0.000 m / 0.000° error and `noOverlap: true`. Escape and `2` switched views in reverse. Start Self-Driving pulled out and returned to cruise, freeing B004. |

The cruise camera also kept at least two markers in the 16:9 frame in a geometry sweep of six runtime occupancy seeds using the default view. The initial parking check exposed three row-end paths and a narrow kerb gap. The generator was adjusted before the final lot check. A browser interaction check exposed a stale low-tier tablet frame when paused. Paused input now forces a redraw. The replay clicks B058 before it leaves the cruise frame.

Installed Chrome reported `ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Laptop GPU (0x00002860) Direct3D11 vs_5_0 ps_5_0, D3D11)`. Auto quality selected High. The High targets are 1280 × 800 for the tablet and 480 × 300 for rear, refreshed every frame. Low uses 960 × 600 and 320 × 200, refreshed every second frame during normal play.

## Files

- App entry and configuration are `index.html`, `package.json`, `package-lock.json`, `vite.config.ts`, and `tsconfig.json`. `src/main.ts` wires input, the fixed-step clock, and debug hooks. `src/style.css` styles the page and debug text.
- `src/simulation/` contains lot types, seeded runtime occupancy, rectangle geometry, route, parking planner, and drive state.
- `src/assets/` contains the box factories, instance batches, and named node handles. `src/assets/index.ts` is the asset swap point.
- `src/render/` contains seat, Reality View, and rear cameras, dive projection, ribbon, and WebGL render passes.
- `src/ui/` contains the shared interface texture, marker projection, inset overlay, and hit-testing.
- `tools/` contains the lot generator, offline checks, and Chrome capture runner with its data manifest. `public/models/lot.json` is the generated layout contract.

## Stills

All files are JPEG quality 70 at 1280 × 800 in `shots/s1/`.

- `seat-cruise.jpg`
- `seat-parking-wheel-turned.jpg`
- `mid-dive.jpg`
- `cruise-chevrons.jpg`
- `overhead-reversing-inset.jpg`
- `overhead-turned-40.jpg`
- `parked.jpg`

## Gaps

- Box silhouettes, flat trim, and simple lamp pools are the largest visual gap from the clips. The named asset nodes allow the body, cabin, baked lot, and parked models to take their place.
- The interface has the S1 controls and readouts. The full cards, music, sound, moving traffic, reflections, and world softness belong to later stages.
- Marker coverage was checked with default cruise framing. Player orbit can deliberately point away from bays.
