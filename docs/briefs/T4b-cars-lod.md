# T4b — Low-detail versions of the nine pack cars

Read `docs/briefs/_common.md` first, then `docs/DESIGN.md` (§1, §3 `cars.glb`), then `docs/report/T4-cars-pack.md` (how the cars are built, the manifest).

**Goal:** `public/models/cars_lod.glb` + `public/models/cars_lod.json`: one low-detail mesh set per car type, so the game can draw cars farther than ~30 m from the camera at a fraction of the triangles without anyone noticing from above at night.

**Start:** commit `6c99d9f`. `scripts/build_cars.py` builds `cars.glb` (nine types, ≈ 7k triangles each, 63k total) and 30 paint-variant textures.

**You own:** `scripts/build_cars_lod.py` (may import the helpers under `scripts/cars/`; add new helper files there if needed but do not change the behaviour of the existing ones), `public/models/cars_lod.glb`, `public/models/cars_lod.json`, `renders/cars/lod_sheet.jpg`, `docs/report/T4b-cars-lod.md`.
**Not yours:** `public/models/cars.glb`, `cars.json`, `public/models/textures/cars/**` (read-only — the game is using them right now), everything else.

## Do

- For each of `sedan, wagon, hatchback, compact, coupe, minivan, pickup, suv, offroad`: a low-detail version with **≤ 900 triangles in total**, same origin (ground under the car centre), same axes and the same overall bounding box as the full car within 2 cm.
- **Exactly two meshes per type:**
  - `<type>_lod_body` — the painted body shell, decimated so that it **keeps the full model's UV layout**, because the game puts the same paint-variant texture (`textures/cars/<type>_<colour>.jpg`) on it. Preserve the silhouette seen from above and from a high three-quarter angle (roof outline, hood, trunk / bed, pillars); UV seams must not tear or smear visibly.
  - `<type>_lod_rest` — glass, wheels, lenses and trim merged into one mesh with **vertex colours only** (`COLOR_0`, no textures): near-black glass, dark tyres with dim-metal discs (simple low-sided cylinders are fine), dark-red tail-lamp faces, pale head-lamp faces, black trim.
- Root node per type named by the type (same names as in `cars.glb`), with those two children, identity transforms.
- `cars_lod.json`: per type the node names, triangle counts, bounding box, and a note that `_lod_body` takes the variant maps and the shared metallic-roughness map listed in `cars.json`.
- **Check, one round:** render one contact sheet `renders/cars/lod_sheet.jpg` (≤ 1600 px wide): for every type the full model and the low-detail one side by side from 30 m at a high three-quarter angle and from straight above (one paint variant each, night-ish key light), plus one close-up pair to show what is lost. Look for holes, flipped faces, UV smears on the paint and wrong size. Fix once if needed.

## Don't

- Do not modify `cars.glb`, `cars.json` or any existing texture. No new textures. No subagents. Never open the Blender window.

## Done when

- `heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P scripts\build_cars_lod.py` runs clean from scratch, prints triangles per type (each ≤ 900) and writes both files.
- Parsing the GLB shows nine roots, two meshes each, `TEXCOORD_0` on every `_lod_body` and `COLOR_0` on every `_lod_rest`.
- The contact sheet is saved.

## Report

`docs/report/T4b-cars-lod.md`: triangle table, how to use the meshes in the game, what is visibly lost and from what distance the switch is safe.
