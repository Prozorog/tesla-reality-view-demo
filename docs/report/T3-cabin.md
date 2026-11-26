# T3 · Model 3 cabin

The delivered cabin has **90,592 triangles**, 18 mesh nodes and one seat-eye marker. The final build used the body stations in `public/models/model3.json`. It took 11.99 seconds in Blender 5.2.2. The final three-view proof is [round3.jpg].

## Files

| Deliverable | Contents |
| --- | --- |
| `scripts/build_cabin.py` | Build entry point, named design stations, body-station import, seat fit, export and manifest |
| `scripts/cabin/geometry.py`, `controls.py`, `shell.py`, `interior.py` | Surface construction, wheel and display, fascia and apertures, seating and console |
| `scripts/cabin/finish.py`, `lighting.py`, `baking.py`, `audit.py` | PBR materials, generated 512 px texture tiles, review lighting, irradiance atlas and GLB checks |
| `scripts/render_cabin.py` | Headless Cycles camera views and JPEG sheet assembly |
| `public/models/cabin.glb` | 7,019,444 bytes, including five generated 512 × 512 material tiles |
| `public/models/lightmaps/cabin_night.png` | 2048 × 2048, 1,579,451 bytes |
| `public/models/cabin.json` | Mesh-to-map assignments, UV channel, decoding parameters, eye, wheel axis, screen corners, body stations and triangle counts |
| `renders/cabin/round1.jpg`, `round2.jpg`, `round3.jpg` | Three rounds, each containing the forward eye view, 30° right eye view and neutral three-quarter study |
| `docs/report/T3-cabin.md` | Build results, comparisons and integration notes |

All three JPEGs are present locally. The repository's existing `renders/` ignore rule covers the contact sheets.

## Build and verification

Run these commands from the project root.

```powershell
heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P scripts\build_cabin.py
heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup --python-exit-code 1 -P scripts\render_cabin.py -- 3
```

- **Build passed.** Cycles used the RTX 4070 Laptop GPU through OptiX. The 128-sample diffuse direct-plus-indirect bake took 5.10 seconds. Unwrap, bake, denoise and PNG encoding together took 10.07 seconds.
- **Export audit passed.** The build read the GLB JSON and binary accessors. All five required named nodes are present. All primitives of the 15 mapped meshes have both UV sets. The screen has four vertices, two triangles and the four expected 0–1 UV corners. Its active area measures 0.3317 × 0.2073 m. The exported wheel pivot and transformed local axis match the manifest.
- **Render passed.** The same command with round indices 1, 2 and 3 produced the three sheets. Rounds 2 and 3 re-imported the exported GLB into a fresh Blender process. The final render used 40 samples with denoising and saved its third frame at 18.36 seconds. The final contact sheet is 1512 × 1562, JPEG quality 75.
- **Body fit passed.** A separate queued, fresh Blender process imported both GLBs together and ray-tested from the exported eye. The body's glass was removed from the in-memory test so the rays could reach opaque geometry. All 121 rays on an 11 × 11 grid across the screen hit `screen_surface` first. Of 6,300 forward rays scanned around the hood, 302 first hit painted body beyond x = 2.4 m. The farthest visible sample reached x = 3.390 m over the dash.
- **Earlier tooling probes.** Blender's bundled Python lacked Pillow. The render script uses the installed system Python for sheet assembly. The first atlas build stopped because the bundled OIDN library rejected the RTLightmap input combination. The delivered build uses its HDR RT filter on scene-linear irradiance. An intermediate export also warned about tangent generation on n-gons. The final builder triangulates the end caps before export and passed without those warnings.

### Geometry budget

| Mesh | Triangles | Mesh | Triangles |
| --- | ---: | --- | ---: |
| steering_wheel | 18,104 | dash_shell | 17,230 |
| door_card_left | 10,142 | door_card_right | 8,438 |
| centre_console | 7,060 | driver_seat | 5,048 |
| passenger_seat | 5,048 | headliner_and_roof_reveal | 3,964 |
| pedals | 3,552 | light_strip | 3,096 |
| windshield_frame | 2,452 | mirror_housing | 2,120 |
| carpet_and_footwells | 1,700 | dash_light_channel | 1,296 |
| screen_bezel | 852 | column_shroud | 348 |
| display_pedestal | 140 | screen_surface | 2 |

## Fit and runtime use

- The cowl, header and roof peak used for the final build are **(2.3203, 0.9960)**, **(1.4694, 1.3690)** and **(0.9075, 1.4419)** in Blender X/Z. The door and aperture fit also uses the body's interior widths and A-pillar endpoints. The builder reads these on every run and has named fallback stations at the top.
- The fitted eye is **(1.3430, 0.3650, 1.1630) m**. It is derived from the seat H-point, with the track moved back 12 mm from its initial fit to clear the bezel. The column pivot is **(1.830, 0.391, 0.900) m**. The screen centre is **(1.930, −0.009, 0.930) m**. These small offsets from the design stations provide **0.893°** of horizontal clearance to the active area. The wheel top is **91.65 mm** below the eye horizon.
- Rotate `steering_wheel` about its **local +Y axis in glTF/three.js**, equivalent to local +Z in the authored Blender object. Apply steering relative to the imported node's rest orientation. The rim, horn pad, raised letters, scroll barrels, marks and split lower spoke rotate together.
- Bind the live display to material `screen`. The manifest lists each physical corner in Blender and glTF coordinates with its authored UV. Blender V increases upward. The exported glTF accessor uses the usual V-down convention. The cool bake-only emitter was removed from the export. In the proof renders an area source reproduces its light on the cabin while the glass stays idle.
- For each named receiver, bind the atlas to its material primitives, using UV channel **1**, `flipY = false`, sRGB texture decoding and the manifest's `three_lightMapIntensity`. The PNG stores normalized irradiance divided by π. The intensity restores both the stored scale and the Lambertian conversion. Scope the material assignment to receivers because the wheel shares several finishes with the cabin. The moving wheel, active screen and emissive light guide have explicit null map entries.
- The light guide is one continuous mesh from the right door through the cowl to the left door. Its colour comes from `STRIP_COLOR`. The concealed side of the guide is represented by grazing area sources in the bake and night proofs. The exported emissive material remains available to runtime lighting controls.
- The straight-ahead proof uses 75° horizontal field of view and a 10.5° inward aim to include the screen edge from the left seat. The second view uses the same eye and optics at 30° right. The review sky is visible through the physical openings. The real parking lot and live display belong to the integration scene.

## Reference comparison

The night exposure and light guide follow `cabin-01-official-dusk.webp`. The console and openings follow `cabin-02-centre.jpg`. The wheel, stalk and fabric shelf follow `cabin-03-three-quarter.jpg`.

| Observed difference | Changes in subsequent rounds |
| --- | --- |
| The V trim sank into the lower rim. The horn pad, lettering and scrolls read as flat shapes. | Brought the bottom return above the rim, crowned the horn pad, raised the letters, crowned and ribbed the barrels, and added the satin upper spoke edges. |
| The fabric shelf was a thin grey blade under a large upper lip. The far end and vent were hard to distinguish. | Widened and raised the woven face, pulled the upper lip toward the cowl, and added end returns around the vent. Reduced the exported sheen on the textile. |
| The A-pillar seal appeared detached, and the strip had a step where it reached the door sail. | Fitted the aperture to the published pillar stations, inset the seal, moved the sail outboard and joined the three strip runs into a continuous sweep. |
| Bright sky showed beside the tunnel under the dash. The first three-quarter framing also cut off the cup wells. | Closed the centre floor, firewall and undertray, attached the pedal pivots and reframed the studio view downward to include both recessed wells and the tray. |
| The wheel face disappeared in the night view, while the exported door and carpet appeared pale in the studio. | Adjusted the window fill, reduced the studio fill and material sheen, added a concealed cove wash, and brought the door-speaker face and pull attachment clear of the card. |

## Remaining differences, largest first

1. The fabric shelf reads brighter and more uniform than the dusk reference. Its passenger-side end and the lower dash return are sharper than the moulded photographed fascia.
2. The red spill has visible changes of intensity across the cowl. The reference has a softer, more even gradient along that line.
3. The door pocket, speaker surround and pedal mounts have simpler contours than the close photographs. The wheel controls and wordmark are legible in the studio view and subtler in the night views.
4. The studio light produces broader, cleaner reflections on the rim and screen than the showroom photograph. The dark seat upholstery also gives less separation between the bolsters than the light seats in the three-quarter reference.
5. The forward eye crop trims the outer mirror edge and shows less of the console than the centred official photo. The 30° view shows the mirror face, and the studio view shows the cup wells. Live screen content and parking-lot reflections have not been visually reviewed in the running app.

