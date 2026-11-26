# T3 — The Model 3 cabin in Blender (headless, from Python)

Read `docs/briefs/_common.md` first, then `docs/DESIGN.md` (§1 axes, §2 stations, §3 `cabin.glb` contract, §4 cabin colours), then product spec §1.3 and §4.

**Goal:** `public/models/cabin.glb` + a baked lightmap — the 2024-facelift Model 3 cabin as the driver's eye sees it at night, built by a rerunnable Blender Python script, in the same origin and units as the body so it drops into the car.

**You own:** `scripts/build_cabin.py`, helper modules under `scripts/cabin/`, `scripts/render_cabin.py`, `public/models/cabin.glb`, `public/models/cabin.json`, `public/models/lightmaps/cabin_*.{webp,png,jpg}`, `renders/cabin/**`, `docs/report/T3-cabin.md`.
**Not yours:** everything else (`src/**`, `tools/**`, `scripts/build_model3.py`, `public/models/model3.*` are being written by other agents right now). The body is not finished yet: size the cabin from the stations in DESIGN §2 (cowl, header, roof, half-width, eye point) and keep those numbers as named parameters at the top of the script, so the later integration task can re-run it with the body's final stations from `public/models/model3.json` (if that file already exists when you start a run, read it and prefer its values).

## Do

- **Build what the driver's eye sees** (left-hand drive; origin = ground under the rear-axle centre, +X forward, +Y left, +Z up):
  dash shelf — low, wide, with the grey fabric strip across its face; steering wheel; the screen on its own short stalk in front of the dash, to the right of the wheel, nothing overlapping it; centre console (open tray, two cup holders, sliding lids, armrest); both front door cards (armrest, pull, the white/grey upper panel, speaker area, window switch block); A-pillars; windshield frame and header; headliner edge and the dark glass roof inner frame; rear-view mirror with its housing at the top centre of the windshield; the top of the passenger seat and the driver's seat edges (shoulder bolsters / headrest so a glance sideways or down shows a seat, not a void); a floor / footwell shell and pedals dark enough to close the view; simple side-window and windshield openings left **open** (the real lot is seen through them — no glass mesh across the windshield; side mirrors belong to the body model).
- **There are no instruments behind the wheel and no stalks on the column.**
- **Steering wheel — detail is a requirement, match `cabin-03-three-quarter.jpg` element by element:** round rim with a slightly flattened bottom, Ø ≈ 0.37 m, rim section ≈ 32 mm; rounded-trapezoid centre pad with the embossed "T E S L A" letters; two short horizontal spokes each carrying a scroll wheel and the small button marks; one spoke going down that splits into a "V" with a satin-metal trim line. Separate node `steering_wheel` with its origin on the column axis and the local rotation axis along the column; say which local axis in `cabin.json`.
- **Screen:** 15.4 inch, 16:10 landscape (active area 0.3317 × 0.2073 m), thin black bezel (`screen_bezel`, ≈ 8 mm border, rounded corners), short stalk. `screen_surface` = one flat quad exactly covering the active area, UV 0–1 (u to the viewer's right, v up), own material named `screen`. Position from DESIGN §2, tilted back ≈ 8°, facing the cabin (not turned toward the driver).
- **Light strip:** thin (≈ 6 mm) emissive strip, node `light_strip`, running along the top edge of both front door cards and wrapping across the base of the windshield, exactly as in `cabin-01-official-dusk.webp`. Colour one variable, default `#ff2a1f`.
- **Materials (glTF-safe Principled):** soft black upper dash `#101113`, grey fabric strip `#8f9094` (rough), satin black console, dark seats `#16171a`, light-grey door upper inserts as in `cabin-01`, satin-metal wheel trim. Subtle roughness variation is welcome; no textures larger than 1024 px.
- **Lightmap bake (Cycles, RTX 4070 via OptiX, denoised):** second UV set packed for the lightmap; bake the static night mood — the strip glow plus a dim cool glow from the screen (use an emissive stand-in on `screen_surface` during the bake only), plus a very faint cool ambient from the windows so nothing is pure black. One or two maps, ≤ 2048 px, saved under `public/models/lightmaps/`. The emitters themselves stay emissive at runtime. Bake budget ≈ 5 minutes of Cycles.
- **`eye_driver`:** derive the driver's eye point from the seat and wheel geometry (start from DESIGN §2) and store it as an empty named `eye_driver`, exported in the GLB. From it the top of the wheel rim must sit below the horizon line of the windshield, the whole screen must be visible to the right of the wheel, and the hood edge of the body will be visible over the dash.
- **`public/models/cabin.json`:** mesh name → lightmap file (and which meshes have none), `eye_driver` position, steering wheel pivot + axis, the four corners of `screen_surface` in car space with their UVs, strip colour, triangle counts, the station parameters used.
- **Budget:** at most 120k triangles. Print the count per mesh and the total.
- **Check, at most three rounds (spec §4):** `scripts/render_cabin.py` renders (Cycles, ≤ 64 samples, denoised) (a) from `eye_driver` looking forward with the framing of `cabin-01` shifted to the driver's seat, ≈ 75° horizontal field of view, night mood with the lightmap-style lighting, (b) the same eye turned 30° right toward the screen, (c) the `cabin-03` three-quarter angle with neutral studio light so the shapes can be judged. Tile them into **one contact sheet** `renders/cabin/round<N>.jpg` (≤ 1600 px wide, JPEG q75). Compare with `cabin-01-official-dusk.webp`, `cabin-02-centre.jpg`, `cabin-03-three-quarter.jpg`; write the five biggest differences into your report, fix them, re-render. After three rounds move on and list what still differs. To keep your thread fast: open each reference at most once, open contact sheets rather than single renders, aim for at most ~8 opened images in the whole task.

## Don't

- No exterior body, no glass across the openings, no hand model, no instruments or stalks. No edits outside your files. No subagents. Never open the Blender window.

## Done when

- `heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P scripts\build_cabin.py` runs clean from scratch and writes the GLB, the lightmap(s) and `cabin.json`; total ≤ 120k triangles.
- The exported GLB contains `steering_wheel`, `screen_surface` (4 vertices, UV 0–1), `screen_bezel`, `light_strip`, `eye_driver`, and every lightmapped mesh has two UV sets (verify by re-importing the GLB in a fresh headless Blender or by parsing its JSON chunk).
- The contact sheet of the last round is saved and the report lists the remaining differences honestly.

## Report

`docs/report/T3-cabin.md` as described in `_common.md`.
