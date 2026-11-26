# T2b · Model 3 exterior

The final export has **77,532 triangles across 16 mesh nodes**, leaving 2,468 triangles in the budget. In the orthographic side view the roof descends continuously into the deck, and both tail lamps sit inside the rear outline. The 12 m overhead view shows the rounded end of the glass against the metallic deck. [Five-view photo comparison] · [Night views]

## Changes against the photos

| Item | Change and observed result |
|---|---|
| Rear deck and tail | Rebuilt the rear-glass and deck sections as one descending profile. The final 245 mm of the deck incorporates a progressive 19 mm lift over the underlying stamping. The exported lip sits at 1.044 m. The upper rear face leans forward 10.8° from vertical between heights of 0.79 and 0.96 m. A shallow plate recess and a short bumper return lead into the black valance. |
| Nose | Brought the leading edge forward and rounded the transition onto the bumper. The centre hood shutline sits at 0.706 m. The lens tips start at the upper corners of the face, sweep rearward over the fender tops and leave an uninterrupted painted face above the low intake. |
| Wheel openings and sill | Built concentric arch rings down past axle height, with a painted flare, a folded edge and a dark felt return. Measured radial clearance is 40.9–46.6 mm after subdivision. The sill runs straight between the wheels. The lower door pressing rises toward the rear and the softer shoulder runs below the window line between the lamps. |
| Glass and paint | All four glazed areas share one opaque, glossy `#050608` material with roughness 0.078. Narrow black joints cross the header and side glass. The B-pillar sits behind the continuous dark surface. The rounded rear corners transition into wider painted rear pillars. Across the panoramic roof, the painted rail measures 63.6–64.9 mm at five exported cross-sections between x = 0.50 and 1.40 m. Shared surface normals carry highlights across the glass and rail boundaries. The deep-grey paint uses metallic 0.68 and clearcoat 0.80. |
| Tail lights | Each running light has a long tapered upper arm, a tight outer bend onto the fender and a shorter lower arm. Both openings face the wordmark. The smoked housing continues outboard past the bend. The inner brake area and high centre stop share `lights_brake`. Each running-light vertex clears the projected rear centre face by at least 1.6 mm in side view. |

## Checks

| Final export | Measured |
|---|---:|
| Length × width across mirrors × height | 4.72080 × 2.08900 × 1.44201 m |
| Painted body width | 1.84791 m |
| Wheelbase | 2.87500 m |
| Blender X extent, rear to front | −0.98548 to +3.73532 m |
| GLB file size | 1,612,660 bytes |

The factory-startup build passed in 2.1 s of script time. Its GLB check verified the node set, origins, wheel transforms, material ownership for the six independently driven lamp nodes, one glazing material, bounds and triangle count. A separate comparison against `3a87949` found the same JSON key paths. The roof check sampled the subdivided half-width at 185 longitudinal stations from lip to peak and found **0.00 mm of height reversal**. Radial probes sampled both axle openings in 5° steps at y = 0.84 m.

An intermediate build measured 39.0 mm at the tightest liner point. Adding 2 mm to the cage radius brought the smoothed opening into range. The first render pass took 17.3 s and showed a broad studio reflection across the side glass. A mesh measurement also put the painted rail at 55–57 mm. The final pass used wider rails, a rounder backlight corner and narrower studio light sources. The night comparison kept the single warm lamp and both original camera positions.

```powershell
heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P scripts\build_model3.py
heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup --python-exit-code 1 -P scripts\render_model3.py -- --round 4 --night
```

The final render imported the exported GLB and completed in 16.7 s on the RTX 4070 Laptop GPU using Cycles OptiX at 24 samples. The five-view sheet is 1480 × 1938 px and the night sheet is 1440 × 608 px. Both are JPEGs at quality 75. The repository ignores the review directory, so the sheets are local files.

## Remaining differences, worst first

1. In the high-rear view the smoked fender extension blends into the deep-grey paint. The photo shows a more distinct dark wedge beyond the outer LED bend.
2. The opaque glazing shows the lamp and studio strips clearly. The photographed glass also shows interior depth and reflections of surrounding buildings.
3. The straight-on front view catches a small crease below each outer lamp corner. The corresponding bumper surface in the photo rolls away more evenly.

## Changed files

- [Shell and wheelhouses](../../scripts/model3/shell.py), [optics and trim](../../scripts/model3/details.py), [mesh normals](../../scripts/model3/mesh.py) and [builder and verification](../../scripts/build_model3.py).
- [Review renderer](../../scripts/render_model3.py), [exterior GLB](../../public/models/model3.glb), [station sidecar](../../public/models/model3.json) and the two review sheets linked above.
