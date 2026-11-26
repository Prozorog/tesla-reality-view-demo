# T3b — Cabin: remove the diagonal beam, give the night bake contrast

Read `docs/briefs/_common.md` first, then `docs/DESIGN.md` (§2, §3 `cabin.glb`, §4 cabin), then `docs/report/T3-cabin.md` (how the cabin is built and baked) and the "Remaining differences" item 2 of `docs/report/T7-integration.md`.

**Goal:** the existing Blender-built cabin keeps its contract, names and manifest, but two things seen from the driver's eye in the running game are fixed.

**Start:** commit `6c99d9f`. `scripts/build_cabin.py` + `scripts/cabin/` build and bake cleanly in ≈ 12 s (90,592 triangles). In-game stills of the current state: `shots/s3/seat-cruise.jpg` and `shots/s3/seat-parking-wheel-turned.jpg` (open one of them once). Reference: `../ref\cabin-01-official-dusk.webp`.

**You own:** `scripts/build_cabin.py`, `scripts/cabin/**`, `scripts/render_cabin.py`, `public/models/cabin.glb`, `public/models/cabin.json`, `public/models/lightmaps/cabin_night.png`, `renders/cabin/**`, `docs/report/T3b-cabin-fix.md`.
**Not yours:** everything else. **The game is using these files right now and another agent is working on the game code:** keep every file name, node name, material name, manifest key, the lightmap UV channel and the `eye_driver`, `steering_wheel` and `screen_surface` positions, axes and UVs exactly as they are.

## Fix

1. **The diagonal beam.** In the seat stills a wide dark diagonal slab runs from the rear-view mirror up to the top-right corner of the view: the `Roof reveal` primitive of `mirror_housing` (and the header / roof frame around it) reads as a huge beam across the upper right of the windshield. Wanted (`cabin-01-official-dusk.webp`): the mirror hangs from a small short stalk at the top centre of the windshield; above it only the thin windshield header and, toward the sides, the A-pillars. Nothing may cross the windshield opening between the mirror and the right A-pillar. Check from `eye_driver` with a 60° vertical lens looking straight ahead and 20° right.
2. **A-pillars from the eye.** In the same stills the left A-pillar trim is a very wide pale slab. Give the A-pillar inner trim its real proportion from the driver's eye (≈ 9–11 cm apparent width at the eye's distance, tapering upward), dark grey like the headliner edge rather than near-white, so the lot is visible left of it through the side window and right of it through the windshield.
3. **Night bake with contrast.** The dash fabric strip, door inserts and pillar trim come out as flat, evenly bright lilac-white panels. Re-bake so the static night mood has shape: almost no ambient fill; the red strip glow grazing the dash top and door tops and falling off quickly; the dim cool screen glow lighting the wheel rim, the console and the driver-side dash locally; everything else sinking toward a dark blue-grey that is never pure black. The light inserts should end up around a dim mid-grey, clearly darker than a lit screen. Keep the encoding, intensity field and file name; if the stored range must change, change the manifest value, not the convention.

## Don't

- No changes to the steering wheel, screen, console, seats or any contract value. Stay ≤ 120k triangles. No subagents. Never open the Blender window.

## Done when

- `heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P scripts\build_cabin.py` runs clean from scratch and its own export audit still passes (required nodes, two UV sets on lightmapped meshes, screen quad and wheel axis unchanged — diff the relevant `cabin.json` values against commit `6c99d9f` and say so).
- A new contact sheet `renders/cabin/round4.jpg` with the two eye views (straight, 20° right; 60° vertical lens; night mood) and the studio three-quarter view is saved. At most two render rounds; open at most ~4 images in the whole task.

## Report

`docs/report/T3b-cabin-fix.md`: what changed per item, manifest compatibility check, what still differs from the reference.
