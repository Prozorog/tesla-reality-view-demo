# T2 · Model 3 Highland exterior

The exported exterior has **76,382 triangles across 16 named mesh nodes**. The largest dimensional error is 0.63 mm. The final night view shows both C-shaped running lights and the five letters between them from 8 m behind and 5 m up. [Studio comparison] · [Night check]

## Asset contract

| Measurement | Target | Exported |
|---|---:|---:|
| Length | 4.720 m | 4.72062 m |
| Width across the body | 1.848 m | 1.84758 m |
| Width across the mirrors | 2.089 m | 2.08900 m |
| Height above ground | 1.442 m | 1.44186 m |
| Wheelbase | 2.875 m | 2.87500 m |
| Tyre diameter × section width | 0.669 × 0.235 m | 0.669 × 0.235 m |

The builder reads the exported GLB JSON chunk. It checks the exact node set, triangle indices, material ownership and emissive factors for all six lamp nodes, wheel translations, identity rotations and scales, and position-accessor bounds. The review renderer then imports that GLB into an empty Blender scene. The Blender-space ground envelope runs from (−0.98505, −1.04450, 0) to (3.73558, 1.04450, 1.44186).

| Mesh | Triangles |
|---|---:|
| `body` | 38,944 |
| `glass` | 6,896 |
| `trim_black` | 12,890 |
| `lights_head` | 112 |
| `lights_tail` | 280 |
| `lights_brake` | 288 |
| `lights_reverse` | 64 |
| `indicators_left`, `indicators_right` | 88 each |
| `mirror_L`, `mirror_R` | 600 each |
| `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR` | 3,853 each |
| `wordmark` | 120 |

## Geometry and handoff decisions

- The body uses a longitudinal table of side elevations, plan widths and transverse sections. A shared quad cage joins the deck, shoulder, side and bumper patches. Its lower edge follows both wheel openings, then folds inward to the wheelhouse liners. One Catmull–Clark pass smooths the joined cage before the paint, glazing and trim are separated.
- The glazing shares its curved boundary with the painted roof rails. The windshield, panoramic roof and backlight continue into each other, with tuned glossy finishes. The rear end rounds forward at its corners to leave a painted shoulder above each wheel.
- The 2.875 m axle spacing and the DESIGN overhangs fit the side photos. The header moved forward to x ≈ 1.469 m, the roof peaks at x ≈ 0.908 m, and the rear glass ends at x ≈ −0.490 m on centre. These are visual fits to perspective photos. The sidecar records the final subdivided surface points for the cabin.
- The cabin half-widths are integration allowances. At the dash the allowance is 60 mm inboard of the exterior window base. At the B-pillar it is 66 mm. The resulting half-widths are 0.762 m and 0.751 m. The mirror coordinates locate the housings. The wheel coordinates locate the actual spin and steer pivots.
- Tail, brake, reverse, headlight and left/right indicator materials can be driven independently. The high stop lamp shares the brake material. Five separate stamped letter shapes form one alpha-free wordmark mesh. The wheel covers follow the dark five-blade aero style visible in the overhead reference.

## Three visual rounds

The sheets pair five studio views with the closest supplied photographs. The high-rear photo also serves as the overhead comparison because it is the steepest supplied photo. Dimensions and wheelbase anchor the true orthographic views.

| Five largest differences in round 1 | Changes carried into the final asset |
|---|---|
| The rear glass ended too squarely and the rear pillars pinched the reflection. | Narrowed the glass at the trunk, rounded its side corners forward and sampled the fastback crown at each corner’s physical X position. |
| Tail-light returns were thin, the dark housing disappeared, and the lamps stopped short on the fender. | Fitted the ruby carriers to the subdivided skin, broadened the outer LED bends and brake area, and carried the lit return around the fender. |
| The front DRLs sloped almost uniformly instead of turning upward near the outside. | Lowered the lens bed, extended the dark housing and flattened the inner stroke before its outer hook. |
| The door flanks were too flat between the belt and sill. | Deepened the lower door pressing, added a rising sill highlight, and fitted handles and closure lines directly to the smoothed skin. |
| The aero covers had wide bright vents and a pale tyre sidewall. | Widened the swept vanes and darkened the machined edges and sidewalls. |

Round 2 exposed two details at the intended game distance. The rear glass corner still broke the roof reflection and the wordmark nearly disappeared under the warm lamp. Round 3 corrected the corner surface, increased letter stroke and height, and used a more diffuse satin silver finish. The final night check uses a single warm area lamp behind the rear quarter. [Round 1] · [Round 2] · [Round 3] · [Night]

## Remaining differences, worst first

1. At 12 m directly overhead, the hood creases and the two tail tips are faint. The dark roof perimeter and shoulders carry most of the silhouette under the single lamp.
2. The rear bumper corners look fuller and the plate recess more sharply stamped than the grey RWD reference. The lower valance has a simpler break across its width.
3. The glossy opaque side glazing catches a broad studio reflection. The photos show more variation from the cabin and surrounding buildings.
4. The front lamps reproduce the outer blade and DRL hook. The small internal projectors have simpler facets than the close front-quarter photo.
5. The aero vanes read individually at a shallower angle than the nearly solid dark covers on the white high-rear reference car.

## Files and reproduction

| Files | Purpose |
|---|---|
| [build_model3.py](../../scripts/build_model3.py) | Material definitions, scene construction, GLB export, verification and sidecar |
| [mesh.py](../../scripts/model3/mesh.py), [shell.py](../../scripts/model3/shell.py) | Surface construction, profiles, loft and wheelhouses |
| [details.py](../../scripts/model3/details.py), [wheels.py](../../scripts/model3/wheels.py) | Lamps, closures, mirrors, badges, tyres and aero covers |
| [render_model3.py](../../scripts/render_model3.py) | Headless OptiX rendering and JPEG contact sheets |
| [model3.glb](../../public/models/model3.glb), [model3.json](../../public/models/model3.json) | Runtime exterior and integration coordinates |
| [Review images] | Three studio comparisons and the final two-view night check |

Run from the project root on the shared machine. The renderer uses the system Python with Pillow to assemble the contact sheet.

```powershell
heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P scripts\build_model3.py
heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup --python-exit-code 1 -P scripts\render_model3.py -- --round 3 --night
```

| Run | Result | Blender script time |
|---|---|---:|
| Headless Blender 5.2.2 API and device probe | Passed. Principled coat/emission inputs, glTF export flags and RTX 4070 Laptop GPU OptiX device present | 2.0 s startup |
| Round 1 build / render with `--round 1` | Passed. 76,518 triangles, five studio views | 7.0 / 16.5 s |
| Round 2 build / render with `--round 2 --night` | Passed. 77,310 triangles, five studio and two night views | 4.5 / 22.8 s |
| Final factory-startup build / render with `--round 3 --night` | Passed. 76,382 triangles, 1,584,024-byte GLB, 3,618 triangles below budget | 1.7 / 15.9 s |

All review frames used Cycles OptiX, 24 samples and denoising. The studio sheets are 1480 × 1938 px, and the night sheet is 1440 × 608 px. All four JPEGs use quality 75.
