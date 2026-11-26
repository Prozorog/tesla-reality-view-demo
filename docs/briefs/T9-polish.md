# T9 — S5 polish, quality tiers, the §11 checks, production build

Read `docs/briefs/_common.md` first, then `docs/DESIGN.md`, then `docs/report/T8-fixes-perf.md` (module map, profile, what is known to be off), then product spec §10, §11, §12 and §7 "Softness".

**Goal:** the integrated demo gets its night-time polish in the spec's priority order, runs inside its performance tiers, and passes the cheap checks of §11, with honest numbers written down.

**Start:** commit `3acefb0`. The game runs on the real car, cabin, cars and baked lot with the full Reality View interface, traffic and sound.

**You own:** `src/**`, `tools/**`, `index.html`, `package.json`, `vite.config.ts`, `docs/report/T9-polish.md`.
**Not yours:** `scripts/**`, `public/models/**` (read-only), `renders/**`, `REPORT.md` (the orchestrator writes it from your report).

## Do, in this order (spec: "if time runs short, cut from the bottom upward")

0. **Two leftovers from the last review (do these first, they are quick):**
   - **Cruise framing.** In `shots/s3b/cruise-down-aisle-distance.jpg` our own car sits at the very bottom of the picture, hidden under the music and trip cards. In the cruise view the car must always be in the clear part of the picture: horizontally centred, its centre at about 55–62 % of the picture height, wholly above the bottom cards and clear of the left speed block, with the road ahead and the chevrons above it (see `park-b-04.jpg`). In the overhead parking view the car, the ribbon and the chosen bay stay clear of the cards and of the rear-camera inset.
   - **Headlight pool from above.** In `shots/s3b/overhead-reversing-inset.jpg` the pool ahead of our car is a long pale column running to the top of the frame, and in `parked-overhead.jpg` a wide pale haze covers the upper right. From above it should be a short, soft warm fan (gone by ~9 m, peak brightness low enough that bay lines and asphalt texture show through), and it switches off when our car is parked in `P`.
1. **Lamp light in the cabin (spec §10, first S5 item).** As the car passes under each lamp of `lot.json`, a soft warm wash slides across the dash, the wheel and the screen bezel, driven by the lamp positions with one or two cheap lights (no shadow maps). It must be visible while cruising from the seat and must not wash out the baked night mood or the screen.
2. **Lamp reflections sliding over the glass roof and hood (spec §10, second S5 item)** in the overhead view, from the car's environment map: High tier = a small live cube camera near the car refreshed every few frames; Low tier = one static environment built once from the lot. The glass roof must read as dark glass with moving warm highlights, the paint as deep-grey metallic.
3. **Bloom** on lamp heads, signs, shop windows, car lights and the cabin light strip: on at High, cheaper at Low. It applies to the world picture only — interface, markers and ribbon stay razor sharp — and must look the same through the tablet path and the direct path so the dive hand-over stays invisible.
4. **Screen softness (spec §7):** tune the world blur / grain / vignette of the Reality View picture against `../ref\park-a-04.jpg` — slightly soft, as if reconstructed, never muddy.
5. **Quality tiers (spec §10 table) — check what T8 already does and complete the rest:** tier from the renderer string, `?q=high|low` override; screen texture 1280 × 800 every frame vs 960 × 600 every second frame; rear inset 480 × 300 every frame vs 320 × 200 every second frame; reflections and bloom as above. Skip the rear-camera render entirely while the inset is hidden; do not render the cabin at the Screen stop; do not render the tablet texture at the Screen stop.
6. **Keep the frame rate.** T8 already reached the targets (High 144 fps at 2560 × 1440 on the RTX 4070, Low 73–134 fps at 1920 × 1080 on Iris Xe; lot ≤ 225 draw calls). After adding items 1–4 re-run `tools/profile-t8.json` once on both adapters as T8 did and keep: High ≥ 60 fps at 2560 × 1440 in the seat, Low ≥ 30 fps at 1920 × 1080 on Iris Xe, Reality View pass ≤ 250 draw calls. If bloom or the cube camera break that, make them cheaper rather than dropping the target.
7. **The §11 checks, about 15 minutes in total, results into your report:**
   - 11.1 is the art agents' part: only confirm the GLBs load with no warnings.
   - 11.2: no console errors on both tiers; average fps over 10 s at each stop, once while cruising and once while reversing with the inset on (state the resolution and the renderer string the browser reported; if the browser picked the Intel Iris Xe, say so).
   - 11.3 `tools/check-dive` < 1 % of window height. 11.4 `tools/check-parking` for every free bay. 11.5 one live `?bot=1` park with traffic: end pose once, zero overlaps.
   - 11.6 the seven screenshots (below).
8. **Production build** once through `heavy npm run build`; confirm `dist/` contains no reference image, no pack source file and no untouched bright pack texture, and report the `dist` size.

Pick the simplest robust technique for each item. Where a reference decides the look (`park-a-04.jpg`, `park-a-16.jpg`, `park-b-04.jpg`, `park-b-20.jpg`, `cabin-01-official-dusk.webp`), match it rather than inventing.

## Don't

- No new features, no gameplay or layout changes, no edits under `public/models/` or `scripts/`, no long-run / soak / pixel-exact tests, no watch modes. Do not start a kept server (the orchestrator does). No subagents.

## Done when

- Items 1–5 visibly work (or are listed as cut, bottom-up, with the reason).
- All §11 checks run once with their numbers in the report; build and typecheck green.
- `own-cleanup` run.

## Screenshots

Save to `shots/s5/` (JPEG q70, ≤ 1280 px wide, `?shot=1`): `seat-cruise`, `seat-parking-wheel-turned`, `mid-dive`, `cruise-chevrons`, `overhead-reversing-inset`, `overhead-turned-40`, `parked`, plus `seat-under-lamp` (the warm wash on the dash). Open at most 3 yourself. Final look is judged by the orchestrator.

## Report

`docs/report/T9-polish.md` as described in `_common.md`, plus: renderer string, the fps table, draw calls / triangles per view, `dist` size, every item cut or weaker than the reference, worst first.
