# T6 · S4 Reality View

## Lot freeze

`public/models/lot.json` was regenerated once and verified at **2026-11-23 06:43:56 UTC+05:00**. Relative to `6e4fdfe`, the generated diff changes only the parked-car paint assignments. All 110 bay positions and dimensions, the 398.1 m route, aisles, kerbs, and lamps are intact. The frozen file has SHA-256 `b8dbc5fbdd735a5f1e17219f926f9686601724f7f08fcfb002ed89b9b33dd7c3`.

The generator and runtime use the dimensions and per-type paint lists in the T4 catalog. The offline check places the union of the two undominated runtime footprints in each other free bay. The pickup bounds vehicle length and the offroad bounds vehicle width, including mirrors. This covers every centered runtime shape at the original 0.30 m swept-clearance threshold.

## Implementation and decisions

- One Inter Canvas HUD supplies the tablet and full-window controls. It uses the specified layout, with original line icons, active-gear underlines, and procedural album artwork. Clock readouts show local time. Temperature, battery, and streak are Northgate demo values.
- The world post-process applies a roughly one-pixel blur, grain, and vignette in tablet coordinates for both presentations. It carries scene depth forward so sharp chevrons, parking tiles, the selected-bay outline, and the ground ribbon can pass behind scene geometry. The seat mirror uses a horizontally flipped crop of the live rear-camera feed.
- Bay availability comes from the same claims the traffic simulation uses. The player reserves the chosen bay immediately. Four box cars follow the one-way aisles with approximately six metres between bumpers in the same lane. They enter and exit through separate branches at the south opening. Their nose-in paths use the straight and accessible storefront bays. A trailing queue can back out of the player's swept path, and an already committed crossing can clear while the player pauses. Entry, following, turning, and reversing use measured rectangles.
- A passed pull-past point within about 20 m gets a straight reverse lead when it connects along a clear aisle. Farther passed bays retain their next approach, with `Parking` status and a forward route ribbon. The camera fits all four chosen-bay corners, with room at the bottom for the music and trip cards. Cancel during reverse takes the clear path forward to the aisle. End Trip sets `P` at the current pose.
- Background music and WebAudio start after the first pointer activation. The low-pass filter and cabin hum follow the camera easing during the dive. Music playback, indicator ticks, the engagement and takeover chimes, the parked chime, screen taps, and reverse proximity beeps share that audio controller.

## Module map

| Path | Responsibility |
| --- | --- |
| `src/simulation/lot.ts`, `occupancy.ts`, `geometry.ts` | T4 catalog, seeded startup occupancy, and oriented rectangle clearance and overlap |
| `src/simulation/traffic.ts`, `traffic-paths.ts`, `route.ts` | Street branches, one-way gap control, bay claims, nose-in paths, manoeuvre gates, and traffic stats |
| `src/simulation/drive.ts`, `parking.ts` | Player cruise, reverse lead, original parking planner, yielding, manual takeover and rejoin |
| `src/assets/index.ts`, `passenger-boxes.ts`, `car-boxes.ts`, `lot-boxes.ts` | Box stand-ins and asset swap points. Parked batches and moving cars both use `createPassengerCarAsset` and its `lights_head`, `lights_tail`, and `lights_brake` nodes |
| `src/render/scene.ts`, `world-picture.ts`, `traffic-view.ts` | Shared Reality View rendering, depth-preserving world softness, passenger lights, and distant street lights |
| `src/render/cameras.ts`, `dive.ts`, `markers.ts`, `ribbon.ts` | Camera and tablet hand-over, chosen-bay framing, marker geometry, and the parking path |
| `src/ui/interface.ts`, `panels.ts`, `icons.ts`, `src/style.css` | One HUD texture, rear inset and guides, controls and hit-testing, typography, and procedural cover art |
| `src/audio/cabin-audio.ts`, `src/main.ts` | Audio, input dispatch, fixed-step clock, and browser diagnostics |
| `tools/gen-lot.mjs`, `check-parking.mjs`, `shots.mjs`, `shots-s4.json`, `check-reality-view.json` | Catalog-aware lot generation and validation, S4 captures, and browser verification |
| `public/fonts/`, `public/music/` | Local Inter and the two credited tracks |

`?bot=1` selects the first free bay. `?bot=cruise` starts without selecting one. `window.__rv` exposes the final pose, overlap-frame count, traffic arrivals and departures, moving and stuck counts, longest wait, and reverse obstruction stops. Overlaps are audited at 60 Hz across the player, parked cars, and moving cars. The stats flag an actor that waits at least 18 seconds.

## Verification

| Command or case | Result |
| --- | --- |
| `npm run gen:lot`, then `heavy npm run check:parking` | Passed 40/40 free bays. Tightest swept clearance 0.335 m at B053. Closest sampled cruise clearance 0.318 m. All static paint variants are valid. |
| `heavy npm run check:dive` | Passed all 45 projections, with a maximum difference rounding to 0.000000% of window height. |
| `heavy npm run typecheck` and `heavy npm run build` | Passed. Production JavaScript 635.52 kB, 172.31 kB gzip. |
| `heavy npm run shots -- http://127.0.0.1:4103/ tools/check-reality-view.json` | Installed Chrome on the RTX 4070. All six controls passed through the High seat tablet and Low full-window view. Audio stayed locked before the first click. No browser console errors. |
| Live Chrome with `?bot=1&shot=1` | B004 in 71.0 s, with 0.000 m and 0.000° end error and zero overlap frames. Four traffic cars were active. Seat and Screen switched during reverse, and Start Self-Driving pulled out again. |
| Live Chrome with `?bot=cruise&shot=1` | One unattended 180.0 s run. Four active and moving at the end, four entries, three exits, three nose-in parks, and two pull-outs. Longest wait 4.07 s, zero stuck cars, zero overlap frames. |
| Passed B058, held-frame browser replay | Selected about nine metres after the pull-past point and parked in 31.7 s from spawn. The chosen bay fit in frame. End error 0.000 m and 0.000°, zero overlap frames. |
| Targeted simulation and S1 manual replay | Placing a follower in the reverse sweep held speed and path progress at zero, set rear proximity to 1, then parked with zero overlaps after the follower yielded. A farther passed bay kept its next approach. The Low-tier S1 manual reverse and rejoin replay passed on the final build. |
| `heavy npm run shots -- http://127.0.0.1:4103/ tools/shots-s4.json` | All seven captures passed. Reversing, parked, and the 40° orbit assert the chosen bay is in frame. |

S1 fixes were limited to the selected-bay framing, the after-pull-past approach, and collision checks while rejoining a recorded manual path. The final rebuild passed after the temporary preview was closed. While preview was open, Windows returned `ENOTEMPTY` and then `EPERM` on `dist/music`.

## Stills

All seven are 1280 × 800 JPEGs at quality 70, captured with `?shot=1` in `shots/s4/`.

- [screen-idle-start-button.jpg]
- [cruise-chevrons-traffic.jpg]
- [autopark-ready-cancel.jpg]
- [overhead-reversing-inset-ribbon.jpg]
- [overhead-turned-40-markers.jpg]
- [parked-overhead.jpg]
- [seat-traffic-headlights.jpg]

## Music and font credits

- **Night on the Docks - Piano**, Kevin MacLeod, incompetech.com. CC BY 4.0. [Track source](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100135) · [License](https://creativecommons.org/licenses/by/4.0/)
- **Dream Culture**, Kevin MacLeod, incompetech.com. CC BY 4.0. [Track source](https://www.incompetech.com/music/royalty-free/index.html?isrc=USUAN1300046) · [License](https://creativecommons.org/licenses/by/4.0/)
- **Inter**, The Inter Project Authors, SIL Open Font License 1.1. [Bundled license](../../public/fonts/OFL-Inter.txt)

## Gaps against the references

1. The greybox cabin, vehicles, and asphalt are the largest visual gap. The overhead stills show the path and camera framing on the box geometry.
2. The rear-view mirror is a cropped camera feed, and traffic headlight pools are flat light textures. Distant street traffic consists of paired lights.
3. Traffic parks in the storefront row. Queues can temporarily reduce the number moving while the player manoeuvres. The live parking run exercised traffic waiting, and the targeted simulation exercised the reverse pause and release.
