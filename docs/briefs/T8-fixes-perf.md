# T8 — Integration fixes and performance

Read `docs/briefs/_common.md` first, then `docs/DESIGN.md`, then `docs/report/T7-integration.md` (module map, render counts, fps), then product spec §6.2, §6.3, §8.4 (lights), §10.

**Goal:** the integrated demo loses its five most visible flaws and runs at its frame-rate targets. No new features.

**Start:** commit `6c99d9f` (tags `tesla-rv-p1-s2`, `-s3`). Everything works on the real assets; stills of the current state are in `shots/s3/` (open `overhead-reversing-inset.jpg`, `parked-overhead.jpg`, `cruise-chevrons-toward-storefront.jpg` and `seat-cruise.jpg` once — the items below were read off them against `../ref\park-a-04.jpg`, `park-b-04.jpg`, `park-b-20.jpg`, `cabin-01-official-dusk.webp`).

**You own:** `src/**`, `tools/**`, `index.html`, `package.json`, `docs/report/T8-fixes-perf.md`.
**Not yours:** `scripts/**`, `public/models/**` (read-only), `renders/**`.
**Two art agents are working right now** and will drop in, under the same names and conventions: a corrected `cabin.glb` / `cabin.json` / `lightmaps/cabin_night.png` (the wide diagonal mirror support is being removed, bake contrast raised), and new low-detail cars `public/models/cars_lod.glb` + `cars_lod.json` (see item 3). Read assets generically, hard-code nothing about them, and re-take your screenshots at the very end.

## Fix, biggest first

1. **Performance — measure first, then fix.** T7 measured, at only 1280 × 800 on the RTX 4070: High 25.7 fps in the seat and 31 fps at the Screen stop while reversing; Low 55 fps seat, 30 fps Screen. Targets: **High 60 fps at 2560 × 1440 in the seat; Low 30 fps at 1920 × 1080.** The Screen stop being ~30 fps on both tiers points at CPU or a fixed cost, not fill rate. Profile properly (CPU frame time split per pass with `performance.now()` around each stage, GPU time with `EXT_disjoint_timer_query_webgl2` if available, `renderer.info` per pass) and write the breakdown into your report before changing anything. Likely suspects to check, not assumptions: per-frame per-camera instance-buffer compaction and re-upload for every car batch; three full world passes per frame (Reality View, seat, rear) each with ~300k triangles; full-resolution multi-pass softness; the HUD canvas being re-rasterised and re-uploaded every frame; uncached material / program switches; the screenshot browser itself throttling. Fix the real causes. Rules that must hold afterwards: the rear camera renders only while the inset is visible (and the mirror may reuse its last frame at a low rate otherwise); the cabin and the tablet texture are not rendered at the Screen stop; the HUD texture is redrawn only when something on it changed (or at most ~15 Hz for clocks / progress), never the whole canvas every frame; culling work is done once per camera move threshold, not rebuilt from scratch every frame for static parked cars.
2. **Things between the camera and the car.** In `parked-overhead.jpg` a lamp head and arm fill a quarter of the frame and sit on top of a bay marker; in `cruise-chevrons-toward-storefront.jpg` a tree canopy hides our own car completely. In the Reality View camera (not the seat), lamp poles / heads and tree canopies that are close to the camera or that cover the car or the chosen bay must dissolve (dithered or alpha fade over ~0.3 s) — their light stays. The cruise camera must also never sit inside or behind a tree, hedge, pole or building: push it in toward the car when blocked.
3. **Distance: the lot must not end in black 40 m away.** T7 set fog to start at 23 m and go opaque at 43 m to stay inside the triangle budget, so in the cruise view the far rows, the lamps beyond and the T5b street skyline are gone; `park-b-04.jpg` shows the whole lot with rows of lamp heads to the horizon. Restore a gentle night haze (visible fade starting no nearer than ~70 m, backdrop still readable at 150 m) in all three cameras. Hold the triangle budget with level of detail instead of fog: parked and moving cars farther than ~30 m from the camera use the low-detail meshes from `public/models/cars_lod.glb` (`cars_lod.json` says how: same type names, same paint variant textures, ≤ 900 triangles per car) — if that file is not there yet when you reach this item, build the switch against the manifest shape described in `docs/briefs/T4b-cars-lod.md` and fall back to the full mesh until it appears. Target ≤ 500k triangles and ≤ 250 draw calls in the Reality View pass at the worst shallow orbit.
4. **Headlight, brake and reverse pools.** Now they are large flat blue-white fuzzy ellipses (up to ~10 m across, see the traffic car's pool at the right of `parked-overhead.jpg` and the one ahead of our car in `overhead-reversing-inset.jpg`). Wanted (`park-b-04.jpg`, `park-b-20.jpg`): a headlight pool is a soft warm-white fan starting at the bumper, two overlapping lobes, brightest 2–5 m ahead, gone by ~12 m, subtle enough that the asphalt texture and bay lines stay visible through it; the brake pool is a soft red glow hugging the rear bumper (~2 m); reverse a small cool-white one. They must not draw on top of cars or markers.
5. **Seat view framing.** `seat-cruise.jpg` is shot with a very wide lens: the A-pillar is a huge stretched slab, the tablet is small and its interface barely readable. Use a natural lens (≈ 55–60° vertical at 16:10) at `eye_driver`, neutral gaze a little right of straight ahead and slightly down so that the wheel sits left of centre, the whole tablet is in frame at the right and readable, and the hood edge and the lot fill the upper half — the framing of `cabin-01-official-dusk.webp` shifted to the driver's seat. Head-look (±25° / ±12°) reaches the mirrors. Check that tapping bays on the tablet from the seat is comfortable (the tablet should span at least ~28 % of the window width). `tools/check-dive` must stay green.
6. **Cabin light level.** The dash fabric strip, door inserts and A-pillar trim read as flat bright lilac-white panels at night. From code: bring their night level down to a dim grey (they should be clearly darker than the lit screen and darker than the lamp-lit asphalt outside) and keep the red strip glow readable on them. Use the re-baked cabin lightmap when it lands.
7. **Small ones:** the status area shows `Cancel Selection` during the whole `Reversing` phase — per spec it shows with `Autopark Ready` and through `Parking`, then leaves once reversing has started (taking the keys still cancels); parked pack cars' wheel discs render cream-coloured — tyres dark, rims dim metal; lamp heads and signs should read as light sources (emissive bright enough for the later bloom), not grey boxes.

Pick the simplest robust technique for each.

## Don't

- No bloom, no cube-camera reflections, no cabin lamp wash, no softness retuning (next task). No gameplay, planner, traffic-rule, interface-layout or audio changes beyond item 7. No edits under `public/models/` or `scripts/`. No subagents.

## Done when

- `heavy npm run build`, typecheck, `check:parking`, `check:dive` green; one `?bot=1` park with traffic on High and on Low: within 0.15 m / 3°, zero overlaps, no console errors.
- The fps table is in the report: seat and Screen stops, cruising and reversing-with-inset, High at 2560 × 1440 and Low at 1920 × 1080 (state the renderer string and how you measured; if the capture browser cannot reach those sizes or throttles, say so and give the frame-time breakdown instead), plus the before/after profile.
- Worst-case Reality View pass ≤ 250 draw calls and ≤ 500k triangles, numbers in the report.

## Screenshots

Save to `shots/s3b/` (JPEG q70, ≤ 1280 px wide, `?shot=1`): `seat-cruise`, `seat-parking-wheel-turned`, `cruise-chevrons-toward-storefront`, `cruise-down-aisle-distance` (looking along an aisle away from the storefront, to show the far lot and skyline), `overhead-reversing-inset`, `parked-overhead`, `overhead-turned-40`. Open at most 3 yourself. Final look is judged by the orchestrator.

## Report

`docs/report/T8-fixes-perf.md` as described in `_common.md`, plus the profile breakdown, the fps table, counts per view, and an updated module map.
