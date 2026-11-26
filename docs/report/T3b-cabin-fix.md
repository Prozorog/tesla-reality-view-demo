# T3b · Windshield opening and night bake

The rebuilt cabin has **90,520 triangles**, 72 fewer than the starting asset. The diagonal above the mirror is gone in both driver-eye views. The 20° right view shows the complete mirror, its short glass-mounted stalk and the open windshield out to the passenger pillar. [Round 4 contact sheet]

## Geometry and lighting

1. **Mirror and header.** The old camera pod extended 370 mm along the sloping glass. Its replacement is a 38 × 32 mm mounting foot with a short neck into the back of the mirror. The header cross-section went from 175 × 56 mm to 44 × 20 mm. Its gasket follows the roof edge.
2. **A-pillars.** The inner cover sits 20 mm farther outboard in the authored section. Its charcoal fabric uses the same finish as the headliner edge. Cross-sections projected from the exported eye measure 9.0–9.6 cm across the lower third and 5.8 cm at the roof. With the exterior body present and the glazing hidden for ray testing, rays offset 12 cm to either side of the upper-middle driver trim cleared the car. The centre ray hit the trim. At the lower station the exterior mirror occupies part of the side-window view.
3. **Night bake.** World strength dropped from 0.19 to 0.027. Narrow red sources follow the cowl and both door tops. A cool source follows the display face, with a smaller bounce at its driver-side edge. The door insert is neutral grey, and a weak dusk reflection keeps the shelf legible away from the screen. On front-facing surfaces sampled from the eye side, median decoded irradiance/π fell from 0.445 to 0.105 on the dash weave, 0.104 to 0.026 on the driver door insert and 0.202 to 0.061 on the headlining. These are area-weighted atlas measurements in linear light.

## Build and compatibility

```powershell
heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P scripts\build_cabin.py
heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup --python-exit-code 1 -P scripts\render_cabin.py -- 4
git diff 6c99d9f -- public/models/cabin.json
```

- **Build and export audit passed.** The final factory-startup build took 14.02 s, including a 5.45 s OptiX bake at 128 samples. All five required nodes passed. All 15 mapped meshes have two UV sets. The screen has four vertices and two triangles, and the wheel axis passes the exported-transform check.
- **Manifest comparison passed.** Against `6c99d9f`, every key, station, eye coordinate, wheel pivot and axis, screen corner and UV, mesh assignment and validation result matches. Only the mirror and total triangle counts, measured lightmap range, coverage and timings differ. The atlas remains 2048² RGB8 sRGB on channel 1 with `flipY=false`. The new decode scale is 9.278018 and `three_lightMapIntensity` is 29.147753, still π times the scale.
- **Protected geometry passed.** A queued binary comparison against the committed GLB found all 19 node records and all 28 material names identical. Expanded triangle positions, normals, tangents and first-channel UVs match exactly on the wheel, screen, bezel, console and both seats.
- **Fit decision.** The first rebuild exposed a pre-existing discrepancy within `6c99d9f`. Its `model3.json` already contained newer body measurements than the ones used to build its `cabin.glb`. The builder now reads a small snapshot of the published cabin's body-fit inputs. This preserves the fit even when rebuilding without an existing cabin GLB or manifest.
- **Sightlines passed.** A queued headless check imported the final cabin and exterior body together. Of 2,477 sampled rays through the old pod at 20° right, 2,011 now reach the exterior and 466 hit the compact mirror assembly. Straight ahead the corresponding counts were 238 and 634. Across both samples, every remaining hit was on the mirror assembly.
- **Render passed in two rounds.** The second round restored the original fit and lifted the passenger-side shadow detail. Both night frames use the exported eye, zero pitch, yaw 0° or 20°, and a numerically checked 60° vertical field of view. They sample the delivered PNG on UV1. The lower panel uses the neutral studio rig. The final frame finished at 26.98 s. The 1512 × 1482 JPEG is saved locally under the repository's existing `renders/` ignore rule.

## Remaining differences from the dusk reference

1. The locked left-seat eye crops part of the mirror in the straight view. The centred reference includes the whole mirror, wheel and more of the console.
2. The contact sheet uses a sky backdrop and a blank lit display. The running game's lot, mirror feed, tablet content and tone mapping were not captured in this pass. The moving wheel retains its required null lightmap assignment. Its cool rim highlight in the proof comes from the display light in the render rig, so its brightness in the game depends on runtime lighting.
3. The red cove wash is stronger near the door-to-dash turns. The lower fascia and recesses retain less shadow detail than the photograph.

## Changed files

- `scripts/build_cabin.py` and `scripts/cabin/body_fit.json` preserve the published fit.
- `scripts/cabin/shell.py`, `finish.py`, `lighting.py` and `baking.py` define the surround geometry, trim finishes and night bake.
- `scripts/render_cabin.py` produces the exported-atlas eye views and studio sheet.
- `public/models/cabin.glb`, `public/models/cabin.json`, `public/models/lightmaps/cabin_night.png`, `renders/cabin/round4.jpg` and this report are the output files.
