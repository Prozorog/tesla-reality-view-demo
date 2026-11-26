# T5b — Night lot: stronger grounding, richer distance, use the bake budget

Read `docs/briefs/_common.md` first, then `docs/DESIGN.md` (§1, §3, §4 night-lot look), then `docs/report/T5-lot.md` (how the lot is built and baked, the manifest), then product spec §5.3.

**Goal:** the existing Blender-built lot keeps its layout, file names and manifest schema, but from above it now reads like clip A — cars sitting on clear dark shadows inside warm lamp pools — and the view down an aisle has a believable night distance.

**Start:** commit `65de576`. `scripts/build_lot.py` + `scripts/lot/` build and bake cleanly in ≈ 25 s; the Cycles bake itself took only 15 s of a 20-minute budget. Last review sheet: `renders/lot/round3.jpg` (open it once, next to `../ref\park-a-04.jpg` and `park-b-04.jpg`).

**You own:** `scripts/build_lot.py`, `scripts/lot/**`, `scripts/render_lot.py`, `assets-src/lot/**`, `public/models/lot.glb`, `public/models/lot.lightmaps.json`, `public/models/lightmaps/lot_*`, `public/models/textures/lot/**`, `renders/lot/**`, `docs/report/T5b-lot-fix.md`.
**Not yours:** `public/models/lot.json` (frozen — never write it), `src/**`, `tools/**`, all car / cabin files.

**Another agent is integrating these files into the game right now.** Therefore: keep every existing file name, mesh name, manifest key and encoding convention exactly as it is (values may change; new entries may be added in the same shape as existing ones, e.g. more emissive meshes or more instanced-prototype groups). Do not rename, do not restructure the manifest, do not change the lightmap UV channel or the `flipY` convention. If you need a breaking change, do not make it — describe it in your report.

## Fix (biggest first). Detail is a requirement: match the clip frames element by element.

1. **Cars must sit on the ground.** In `round3.jpg` the shadows under and beside the parked cars are faint; in `park-a-04.jpg` every car has a dense dark shadow under it and a clear cast shadow on the side away from the lamp. Tighten the lamp emitters (smaller, more directional heads at the real head positions) so cast shadows have a defined core, and make sure the bake keeps a dark contact band under each car body (occluder proxy under the sills if the pack's open underbody leaks light). Keep the "never pure black" floor.
2. **Use the budget.** Raise the bake quality toward the 20 minutes allowed, as far as it visibly helps: ground lightmap up to 4096 px on its long side (≥ 32 px/m), more samples, cleaner denoise, so shadow edges, the hatched zones and the pools' falloff are crisp rather than blurry at the 14 m parking view. Report the bake time.
3. **Pools with contrast (clip A, `park-b-04.jpg`).** Under a lamp the asphalt is clearly bright and warm; between lamps it falls to a cool dark. Check the overhead still against `park-a-04.jpg` for overall exposure and warmth, and the chase still against `park-b-04.jpg`, where rows of lamp heads glow and the pools read as overlapping discs along the aisles. Give lamp posts a small concrete plinth so the ones standing in the rows do not grow straight out of the asphalt.
4. **Distance and skyline (chase view).** Beyond the hedge and fence: the street with its own row of smaller street lamps and their pools, dark backdrop buildings of varied height with a scatter of lit windows, three or four distant lit signs in different colours (invented names, no real brands), a few trees as silhouettes, all dissolving into haze toward `#0d1220`. A low emissive horizon glow band is fine. Keep it cheap (≤ 15k triangles added).
5. **Storefront variety.** Break the repetition of identical window modules: vary bay widths, two or three different shop fronts with their own smaller glowing signs and awning colours beside the big NORTHGATE sign, entrance doors with a brighter vestibule, light spilling visibly onto the sidewalk and the first row of bays.

## Don't

- Do not change the layout, bay lines' positions, the manifest schema or any existing name. No car meshes in `lot.glb`. Stay ≤ 40k triangles for the lot with all transforms applied, ≤ 40 meshes, total lot files ≤ 60 MB. No subagents. Never open the Blender window.

## Done when

- `heavy --timeout 60 "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P scripts\build_lot.py` runs clean from scratch; the script's own re-import checks (two UV sets on lightmapped meshes, bay B001 at its `lot.json` position, zero car meshes) still pass.
- The manifest still has every key and every mesh entry it had at `65de576` (diff the key paths and say so).
- New contact sheet `renders/lot/round4.jpg` (same three views + `park-a-04.jpg` beside the overhead one) is saved. At most two render rounds; open at most ~5 images in the whole task.

## Report

`docs/report/T5b-lot-fix.md`: what changed per item, bake time and sizes, manifest compatibility check, what still differs from the clips.
