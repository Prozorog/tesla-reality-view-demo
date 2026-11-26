# T6 — S4 Reality View: full interface, markers, ribbon, moving traffic, sound

Read `docs/briefs/_common.md` first, then `docs/DESIGN.md` (§4 look is binding for this task), then `docs/report/T1-greybox.md` (module map, how to run, existing hooks), then product spec §7, §8.4, §9 and the interface layout of §1.2.

**Goal:** on top of the working greybox toy, build everything that makes it Reality View: the full Tesla-style interface, the proper bay markers and path ribbon, other cars on the move, and sound.

**Start:** commit `6e4fdfe` (tag `tesla-rv-p1-s1`). The greybox (S1) is complete and passing its checks: seat, tablet, dive, cruise, parking, orbit, rear inset, manual driving.

**You own:** `src/**`, `tools/**`, `index.html`, `package.json`, `public/fonts/**`, `public/music/**`, `public/sfx/**` (if any), `docs/report/T6-reality-view.md`.
**Not yours (art agents are writing them right now):** `scripts/**`, `public/models/**` except `lot.json` as described in step 0, `renders/**`, `assets-src/**`.
The Blender-built car, cabin, other cars and lot are integrated by a later task: keep working on the box stand-ins and keep the asset seam of S1 intact (box traffic cars must go through the same car-asset interface the parked box cars use, exposing `lights_head`, `lights_tail`, `lights_brake`).

## Do

0. **First, within your first 15 minutes, because an art agent is waiting on it: make `lot.json` agree with the real cars.** `public/models/cars.json` now exists (see `docs/report/T4-cars-pack.md`): nine types with their built length / width / height and the colour variants each type actually has. `tools/gen-lot.mjs` must read it: assign only colours a type has, and use each type's real footprint (length × width including mirrors) for the parked-car rectangles and for the runtime-car envelope in `tools/check-parking`. Regenerate `public/models/lot.json` once, keep the layout (bay positions, aisles, kerbs, lamps, route) unchanged unless a bay cannot pass, and get `check-parking` green for every free bay again — if a bay fails, change which car types stand next to free bays or their jitter, not the tolerance. Do not change the schema. **After this step `lot.json` is frozen: never regenerate or edit it again in this task**, and say in your report at what time you finished the step.
1. **Interface (spec §7 "Interface", §1.2; DESIGN §4 sizes, colours and positions; look at `../ref\rv-01-night-street.jpg`, `park-a-04.jpg`, `park-b-04.jpg`, `park-b-20.jpg`).** Detail is a requirement: match the references element by element, do not simplify to save effort. Extend the single S1 interface layer (one interface, drawn once, used on the tablet and full-window, razor sharp in both):
   - top left: `P R N D` with the active letter highlighted, battery glyph + percent, very large speed number with `MPH`, state label (`Self-Driving` blue / `Manual` white) with small stats lines under it (`Parking Lot`, `4.3 mi Streak`), speed-limit sign `15`, the two small green headlight glyphs;
   - `Start Self-Driving` dark card button under the speed block when the car is not self-driving;
   - top centre: lock + camera glyphs, status label (`Autopark Ready`, `Parking`, `Reversing`, `Parked`), `Cancel Selection` under it while a bay is chosen and not yet reached;
   - top right: real clock, moon glyph, temperature; the rear-camera inset under it with rounded corners, guide lines and the red ground zone;
   - bottom left `Map` and moon buttons; bottom centre the music card (cover art generated in code, real title and artist of the playing track, progress bar, previous / play-pause / next, two small icons); bottom right the trip card (clock, `Northgate Plaza`, battery percent, `End Trip`); the dock strip with small icons along the bottom.
   - **Working buttons:** `Start Self-Driving`, `Cancel Selection`, `End Trip` (stop where you are, back to `P`), music previous / play-pause / next. Everything else highlights on hover and does nothing.
   - Inter (bundle the woff2 under `public/fonts/`, OFL) or the fallback stack of DESIGN §4; thin line icons drawn in code.
2. **Bay markers and choosing (spec §7):** white 3D chevrons bobbing over free bays within ~25 m in the cruise view; flat rounded-square markers in the parking view; hover brightens; taken bays and bays another car is heading for have none; on choosing, the others fade, the chosen bay gets the soft blue outline; tap on the marker or on the bay itself. Markers, ribbon and interface stay sharp.
3. **Path ribbon (spec §7, DESIGN §4):** car-wide, flat on the ground, the whole manoeuvre (forward past the bay, the arc back in); while reversing, the short bright blue→violet→red glow sits at the rear bumper as in `park-a-04.jpg`; fades when the player takes over.
4. **Softness (spec §7):** the world inside Reality View gets a very light blur, a little grain and a slight vignette, applied to the world picture only — never to markers, ribbon or interface. Must hold in both paths (tablet texture and full-window) so the dive hand-over stays invisible.
5. **Other cars on the move (spec §8.4, all of it):** three or four moving at any time; drive in from the street entrance, cruise the aisles at ~6 mph, then take a free bay nose-in and stay, or drive through and leave; now and then a parked runtime car pulls out and leaves. Headlights with a soft pool of light on the asphalt ahead, red tail lights, brighter brake lights, a blinking indicator before turning into a bay. Rules: a bay another car is heading for loses its marker and cannot be chosen; no car ever takes the bay you chose; they keep ~6 m gap and **stop and wait while our car manoeuvres** (headlights waiting behind us, visible in the rear inset); if a car crosses behind us while we reverse, our car pauses, the red zone in the inset lights up, and it continues when the way is clear. Nothing ever collides — a blocked car simply waits; make deadlock impossible (e.g. a waiting car that blocks our planned path yields / is routed away, cars never stop inside our manoeuvre corridor). Far life: a few pairs of head and tail lights passing on the street beyond the hedge.
6. **Sound (spec §9), all of it soft:** two calm night-drive tracks under CC BY or CC0 (Kevin MacLeod / incompetech, CC BY 4.0, is a known good source) downloaded into `public/music/` with the real title and artist on the music card and the credit lines in your report; if no download works, a gentle synth pad loop, and say so. In the seat the music is slightly muffled with a low cabin hum; during the dive the muffling opens over the same time as the camera move; at the Screen stop it is full and clear. Small sounds synthesised with WebAudio: indicator tick, a soft chime when self-driving engages, another when the player takes over, a warmer one for `Parked`, a quiet tap on screen touches, a gentle proximity beep in reverse that speeds up near an obstacle and never gets shrill. The AudioContext starts only after the first click.
7. **Choosing a bay you have just passed must not mean a lap of the lot.** Today a bay selected after its pull-past point is approached on the next lap (up to 2.5 minutes). Backing in is exactly the manoeuvre for a bay behind the car: if the chosen bay is within about 20 m behind the pull-past point and the aisle behind is clear, the car stops, reverses straight back along the aisle to the start of its arc and backs in (same clearance rules, same planner, ribbon shows it). Only bays farther back than that wait for the next approach — and then the status label says so (`Parking` with the route ribbon leading on). Also keep the chosen bay fully inside the frame in the parking view (spec §6.3): today it can sit half outside the bottom edge.
8. Extend `?bot=1` and `window.__rv` so the live-park check also asserts that no two car rectangles (ours, parked, moving) ever overlapped during the run, and extend the shots tool with the new states.

Pick the simplest robust technique that achieves each behaviour; for the interface, the references decide the look.

## Don't

- No Blender, no GLB integration, no bloom / reflections / lamp-wash polish (later task). Do not change `lot.json` or its schema. Do not rewrite working S1 systems (dive, planner, cameras) beyond what these features need; if you find an S1 bug, fix it minimally and list it. No subagents.

## Done when

- `heavy npm run build` and the typecheck are green; `tools/check-parking` and `tools/check-dive` still pass.
- One `?bot=1` run with traffic on: our car parks within 0.15 m / 3°, zero overlaps among all cars during the run, no console errors.
- A 3-minute unattended cruise (bot not choosing a bay) ends with traffic still flowing: no deadlock, no stuck car (assert via a `window.__rv` stat; run once).
- Every working button does its job from the tablet in the seat and full-window.

## Screenshots

Save to `shots/s4/` (JPEG q70, ≤ 1280 px wide, `?shot=1`): `screen-idle-start-button`, `cruise-chevrons-traffic`, `autopark-ready-cancel`, `overhead-reversing-inset-ribbon`, `overhead-turned-40-markers`, `parked-overhead`, `seat-traffic-headlights`. Open at most 2 yourself to make sure nothing is blank or broken. Look is judged by the orchestrator.

## Report

`docs/report/T6-reality-view.md` as described in `_common.md`, plus the music credits (title, artist, licence, source URL) and an updated module map.
