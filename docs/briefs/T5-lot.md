# T5 — The night parking lot in Blender: dress `lot.json`, bake the light

Read `docs/briefs/_common.md` first, then `docs/DESIGN.md` (§1 axes, §3 `lot.json` / `cars.glb` contracts, §4 night-lot look), then product spec §5 (all of it) and §10 (lot budgets).

**Goal:** `public/models/lot.glb`, its baked lightmaps and `public/models/lot.lightmaps.json`: the shopping-centre lot at night that looks like clip A from above, built by a rerunnable Blender Python script **from the existing layout file**.

**Inputs that already exist (read-only for you):**
- `public/models/lot.json` — the layout, generated and parking-verified by `tools/gen-lot.mjs`. **Dress exactly this layout.** Do not move, add or remove bays, aisles, kerbs or lamps; if something in it makes a good-looking lot impossible, write it in your report instead. Field meanings: DESIGN §3 and `docs/report/T1-greybox.md`.
- `public/models/cars.glb` + `public/models/cars.json` + `public/models/textures/cars/` — the parked cars (types, sizes, colour variants). `docs/report/T4-cars-pack.md` explains the structure.
- Look references: `../ref\park-a-04.jpg`, `park-a-16.jpg`, `park-b-04.jpg`, `park-b-20.jpg`, `park-a-still.jpg`.

- **`lot.json` may be regenerated later with small changes** (bay positions nudged, different car assignments) and your script will then simply be re-run by someone else: read everything from the file, hard-code nothing from it, and make the build + bake rerunnable without edits. `docs/report/T1-greybox.md` may not exist yet when you start (that task is still running and does not touch your files); if so, rely on DESIGN §3 and on the file itself. Never write to `lot.json`.

- The current `lot.json` still assigns some colours a type does not have in `cars.json` (e.g. a red hatchback). Until it is regenerated: when a type lacks the colour, use that type's first variant in `cars.json`.

**You own:** `scripts/build_lot.py`, helpers under `scripts/lot/`, `scripts/render_lot.py`, `assets-src/lot/**`, `public/models/lot.glb`, `public/models/lot.lightmaps.json`, `public/models/lightmaps/lot_*`, `public/models/textures/lot/**`, `renders/lot/**`, `docs/report/T5-lot.md`.
**Not yours:** `src/**`, `tools/**`, `lot.json`, the car / cabin / cars-pack files.

## Do

- **Axes:** build in Blender coords `(x_world, −z_world, y_up)` so the exported GLB lands in the world coords of DESIGN §1 with no transform in the game. Verify with one known bay centre.
- **Geometry from `lot.json`:** asphalt ground (split into a few tiles so each gets enough lightmap texels), bay lines, hatched no-parking zones, painted aisle arrows, the blue accessible symbols, kerbed islands with lamps and small trees, cart corrals in the two corral bays, the storefront building along the north side (low and long, lit canopy, glass doors and shop windows with a warm interior glow, the big invented shop name "NORTHGATE" in glowing letters plus two or three smaller invented signs, sidewalk with bollards — **not a flat cardboard box**: give the facade depth, pilasters, a parapet, window frames), hedge and low fence on the other sides, the street beyond with dark backdrop buildings and a few distant lit signs dissolving into haze. Flat ground.
- **Asphalt look (clip A, `park-b-20.jpg`):** dark grey with repair patches, cracks, oil stains in the bays, worn lines; slightly glossy. Procedural textures baked to image maps ≤ 2048 px (tileable base + a unique low-res variation / stain map is fine). No plastic-looking uniform grey.
- **Parked cars:** place the taken bays' cars exactly as `lot.json` says (type, colour, `dx`, `dz`, `dh`, nose direction) **for the bake only**, so the ground receives their real shadows and bounce. The game draws the parked cars itself as instances of `cars.glb`, so **do not export car meshes in `lot.glb`**. Instead export, in `lot.lightmaps.json`, a per-parked-car light sample (the baked irradiance colour on its roof / hood from above, or a small array of 4–6 probe colours around it) so the game can shade each instance to match: bright highlight under a lamp, sinking into shadow away from it.
- **Light (clip A is the target):** lamps on tall posts at the `lot.json` lamp positions throwing wide warm-white pools (`#ffc98a`, ≈ 3000 K); between pools the asphalt falls to dark, never pure black; the storefront glows and spills onto its sidewalk and the first row; a faint deep-blue sky fill.
- **Bake (Cycles, RTX 4070 via OptiX, denoised):** combined diffuse lighting (direct + indirect, no albedo) into lightmaps on the second UV set for the ground, kerbs, building, furniture. Texel density ≥ 12 px per metre on the ground, ≥ 4 on the building. Store with enough range that lamp pools do not clip (e.g. 16-bit PNG or an RGBM / fixed-exposure 8-bit encoding stated in the manifest). **Bake budget ≈ 20 minutes of Cycles in total;** if it runs over, lower samples and resolution — do not drop the bake. Print the bake time.
- **Runtime-emissive parts** (lamp heads, signs, windows, canopy lights) are separate meshes with emissive materials, listed in the manifest, so the game can feed them to bloom.
- **Instancing and budgets:** lamps, bollards, trees, hedge segments, corral rails are exported so the game can instance them — either as glTF instances (`EXT_mesh_gpu_instancing`) or as one prototype mesh per kind plus a transform list in the manifest; say which. Whole lot ≤ 500k triangles and the mesh count low enough for ≤ 250 draw calls including the ~75 parked cars the game adds (aim for ≤ 60 lot meshes). Print triangles per group and the total.
- **`public/models/lot.lightmaps.json`:** mesh name → lightmap file, encoding and intensity; emissive mesh list with colours; instancing lists; per-parked-car light samples; lamp positions and colour as used in the bake; the texel densities achieved; bake time.
- **Check, at most three rounds (spec §5.3):** `scripts/render_lot.py` renders with the baked result applied as it will look in the game (lightmap × albedo as emission, plus the parked cars) three stills: the overhead parking view mid-row (14 m up, almost straight down), the same view turned 40° and tilted to ≈ 60°, and a chase view down an aisle toward the storefront (5 m up). Tile them into one contact sheet `renders/lot/round<N>.jpg` (≤ 1600 px wide). Put the overhead still next to `park-a-04.jpg`. Hunt for: plastic-looking asphalt, cars that float or have no shadow, toy-like repetition, flat cardboard building, light that does not touch the ground, lightmap seams, pure black. List the five worst in your report, fix, re-render. To keep your thread fast: open each reference at most once and aim for at most ~8 opened images in the whole task.

## Don't

- Do not change `lot.json`. No real brands. No car meshes inside `lot.glb`. No edits outside your files. No subagents. Never open the Blender window.

## Done when

- `heavy --timeout 60 "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P scripts\build_lot.py` runs clean from scratch and writes the GLB, lightmaps and manifest; triangles ≤ 500k; total Cycles bake time printed and ≈ 20 min or less.
- Re-importing the GLB shows every lightmapped mesh with two UV sets and a known bay centre at its `lot.json` world position.
- Total size of `lot.glb` + lightmaps + lot textures ≤ ~60 MB.
- The last contact sheet is saved and the report lists the remaining weaknesses honestly.

## Report

`docs/report/T5-lot.md` as described in `_common.md`, plus exactly how the game must apply the lightmaps (channel, flipY, encoding, intensity) and the per-car light samples.
