# T4 — The other cars: prepare the ready pack in Blender (headless)

Read `docs/briefs/_common.md` first, then `docs/DESIGN.md` (§1 axes, §3 `cars.glb` contract, §4 car colours), then product spec §3.1.

**Goal:** `public/models/cars.glb` + `public/models/cars.json` + recoloured textures: nine generic cars from the user's pack, at real size, repainted in the muted night palette of clip A, with switchable light pieces.

**Source (read-only, never edit, never ship untouched):** `../ref\cars\source\fab.fbx` (all ten cars in one FBX) and `../ref\cars\textures\` (one diffuse per car such as `SedanYellow.png`, plus `_Metallic` and `_Glossiness` maps, wheel textures, `lights.jpg`). Copy what you need into `assets-src/cars/` inside the project (git-ignored working copy), work from there.
Pack: "Generic passenger car pack" by Comrade1280, CC BY — credit it in your report.

**You own:** `scripts/build_cars.py`, helpers under `scripts/cars/`, `scripts/render_cars.py`, `assets-src/cars/**`, `public/models/cars.glb`, `public/models/cars.json`, `public/models/textures/cars/**`, `renders/cars/**`, `docs/report/T4-cars-pack.md`.
**Not yours:** everything else; other agents are writing `src/**`, `tools/**`, other `scripts/*` and other `public/models/*` right now.

## Do

- Import the FBX headless, split it into the ten cars, **leave out the sport car**. Types and names: `sedan, wagon, hatchback, compact, coupe, minivan, pickup, suv, offroad`.
- **Real size:** uniform scale so each hits the target length of DESIGN §3 (sedan 4.70, wagon 4.75, hatchback 4.25, compact 3.90, coupe 4.50, minivan 5.10, pickup 5.40, suv 4.70, offroad 4.60 m). Origin on the ground under the middle of the car (bounding-box centre in X and Y, wheels touching z = 0), +X forward, +Z up. Apply transforms.
- **Repaint for clip A** (`park-a-04.jpg`, `park-a-16.jpg`): variants `white #e8e6e1`, `silver #a9adb2`, `black #0d0e10`, `darkgrey #3a3d42`, `darkblue #16233f`, `red #6e1f1c` (muted). Three or four variants per type (every type gets white or silver, and black or dark grey; spread the rest), by recolouring **only the body-paint area** of that car's diffuse texture — find it by the source paint hue/saturation — while keeping the painted detail (glass, grille, lights, trim, shading). The pack's bright toy colours must not survive anywhere. Paint a little glossier than the source, glass darker (near-black, glossy). Save as WebP or JPEG ≤ 1024 px under `public/models/textures/cars/`; keep the total of all car textures under ~12 MB.
- **Materials (glTF-safe Principled):** base colour from the recoloured diffuse, roughness from the inverted glossiness map, metallic from the metallic map. Wheels with their own textures.
- **Switchable lights:** each car gets separate emissive pieces `lights_head`, `lights_tail`, `lights_brake` (split the faces from the mesh by their UV region on the lights texture, or add thin light quads just above the surface where the lamps are painted). White-warm for head, red for tail and brake. Emissive strength is driven by code.
- **GLB structure:** one root node per type named by the type, children `<type>_body`, `<type>_wheels` (or four wheels), `<type>_lights_head`, `<type>_lights_tail`, `<type>_lights_brake`. Geometry is exported once per type; colour variants are textures listed in the manifest (the game swaps the body map), not duplicated meshes. If embedding all variant textures in the GLB is simpler for you, still write them as separate files and list them in the manifest.
- **`public/models/cars.json`:** per type: built length / width / height, wheelbase estimate, node names, triangle count, variants `[{ "color": "silver", "map": "textures/cars/sedan_silver.webp" }]`, the shared roughness / metallic maps, light piece positions (centre of each lamp cluster in car space, for the headlight pools the game draws).
- **Check, one round, two at most:** `scripts/render_cars.py` renders one contact sheet `renders/cars/sheet.jpg` (≤ 1600 px wide): all nine types in a row from a high three-quarter angle in one variant each, a second row from straight above, plus one type shown in all its variants, plus one night shot with head and tail lights on. Look for: any surviving toy colour, recolour bleeding onto glass / lights / trim, wrong scale between types, floating or sunken wheels, lights in the wrong place. Fix and re-render once.

## Don't

- Do not model new cars (fallback of spec §3.1 applies only if the FBX truly will not import — then say so at the top of your report). No edits in `ref`. No subagents. Never open the Blender window.

## Done when

- `heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P scripts\build_cars.py` runs clean from scratch and writes the GLB, textures and manifest; prints triangle counts per type (about 7k each).
- Re-importing the GLB (or parsing its JSON chunk) shows nine roots with the light children; lengths within 2 cm of target; origins on the ground under the car centre.
- The contact sheet is saved; the report lists what is weaker than wanted.

## Report

`docs/report/T4-cars-pack.md` as described in `_common.md`, including the credit line for the pack.
