# T5b · Northgate night lot

The 14 m overhead now shows a dark contact band and a distinct cast shadow on the side of each foreground car away from its lamp. The chase view picks up the lit street, windows and signs beyond the west fence. The final Cycles bake took **5 min 55.40 s**. The exported lot uses **27,560 placed triangles, 35 meshes and 12.33 MB** including its manifest. [Round 4 contact sheet]

## Changes against the clips

| Item | Change and result |
| --- | --- |
| Grounding | All 68 fixed cars cast shadows from their actual meshes during the diffuse bake. A recessed, chamfered undertray closes the gap between each car’s sills. A second Cycles pass traces visibility over 0.85 m around tyres, sills and plinths. The ground retains a cool minimum beneath the tyres. At B082, using a fixed grey asphalt albedo to isolate the change, a sample 20 cm beyond the shaded side went from sRGB (29, 25, 26) to (14, 13, 22). The lamp-facing sample went from (49, 38, 33) to (57, 44, 37). The centre remained (4, 4, 7). |
| Bake detail | The continuous ground atlas grew from 1,896 × 1,288 to **4,096 × 2,774**, or **43.63 px/m** on both axes. The final diffuse setting was 3,072 samples with three diffuse bounces. An edge-aware filter operates in linear HDR, with three passes on the continuous ground and two within the padded architecture charts. The original painted hatches, stripes, wear and repairs retain their coordinates and colour textures. |
| Warm pools | The 24 original heads use 7.5 cm source radii, 100° cones and an oblique throw from the surveyed lens positions. Twin heads illuminate opposite sides of a row. The smaller source leaves a defined cast-shadow core while the beam falloff overlaps along the aisle. Each pole has a tapered concrete plinth, cap and steel footplate. Decoding both shipping maps gives sRGB **#624d3d** on A2 at world (−24, −0.1) and **#1d1a22** between poles at (15, −8.85). |
| Night distance | Nine smaller lamps follow the surveyed south street. Five light a service frontage beyond the west fence, visible from the north aisle. There are 28 setback buildings with varied rooflines, warm and cool window groups facing the lot, 14 silhouette trees and four invented signs. WICKLOW and VALE face the south street. LUMA PIER and EMBER ROW face the west approach. A textured horizon fades toward #0d1220 and then the deep sky. The distance groups grew from 1,382 to 5,771 placed triangles, an increase of **4,389** against the 15,000 allowance. |
| Storefront | NORTHGATE retains its central sign. Oriel & Fig has coral lettering, terracotta awnings, gallery furniture and flowers. Fieldworks has mint lettering, deeper teal awnings, apparel and gear displays. Unequal-width shop bays meet the original four entrance positions. Each pair of doors shares a continuous vestibule interior. Concealed area lights project through the entrances onto the pavement and first row. |

## Build and compatibility

Both commands passed in headless Blender 5.2.2 from the repository root.

```powershell
heavy --timeout 60 "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P scripts\build_lot.py
heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup --python-exit-code 1 -P scripts\render_lot.py -- 4
```

The diffuse bake took 349.04 s and contact visibility took 6.37 s on the RTX 4070 Laptop GPU through OptiX. Total build time including export and re-import was 378.1 s. The first review bake took 158.84 s. Together the two rounds used **8 min 34.24 s** of Cycles bake time. Both sets of three review frames were rendered from the exported assets. [Build log](../../assets-src/lot/build4-final.log) · [Render log](../../assets-src/lot/render4-final.log)

The shared checkout started at `24b593b`. The lot inputs and outputs relevant to T5b matched `65de576` before editing. A recursive diff against the manifest from `git show 65de576:public/models/lot.lightmaps.json` compared object keys and individual array indices. **All 8,663 baseline paths are present**. The new manifest has 9,475 paths, including 812 additions, and the same 16 top-level fields. [Compatibility audit](../../assets-src/lot/compat4.log)

| Contract | Baseline → final |
| --- | --- |
| Lightmapped / emissive entries | 18 → 20 / 10 → 15. Every original entry is present. |
| Prototype groups / fixed parked cars | 9 → 11 / 68 → 68. All original placement positions and parked-car headings, colours and types matched. |
| GLB names | All 28 original mesh names, 29 node names, 17 material names and 9 image names matched. |
| Lightmap decoding | Every existing receiver kept its filename, `sRGB8-fixed-exposure`, `TEXCOORD_1`, channel 1 and `flipY: false`. The ground decode intensity is 4. The architecture intensity is now **128**. Both Three.js intensity fields equal the corresponding decode gain times π. Instance UV scale and offset use the original convention. |
| Re-import | All 20 receivers had two UV sets. B001’s heading matched and a downward ray hit `Asphalt_00` at world (−34.099998, 0, −24.650000). The importer found exactly the expected receiver and emitter meshes, including **zero car meshes**. |
| Frozen layout | The on-disk bytes of `public/models/lot.json` matched `65de576`. SHA-256 `b8dbc5fbdd735a5f1e17219f926f9686601724f7f08fcfb002ed89b9b33dd7c3`. |

| Runtime asset | Bytes |
| --- | ---: |
| `lot.glb` · 12,298 stored triangles | 1,282,120 |
| `lightmaps/lot_ground.png` | 6,806,125 |
| `lightmaps/lot_architecture.png` · 2,240 × 2,816 | 509,728 |
| `textures/lot/` · eight pavement maps, shop glass and horizon | 3,473,489 |
| `lot.lightmaps.json` | 259,313 |
| **Total** | **12,330,775** |

Including the frozen 66,399-byte layout brings the total to 12,397,174 bytes. All original shipping filenames remain in place.

The build changes are in `scripts/build_lot.py` and `scripts/lot/{baking,environment,glb,layout,pavement,scene}.py`. The review changes are in `scripts/render_lot.py` and `scripts/lot/sheet.py`. The 14 m camera is two bay pitches downbeam of the central pole so it sees the cast silhouettes. The orbit remains at 40° turn and 60° elevation. The 5 m chase camera looks down the north aisle from nearer its eastern end with a wider lens. The review applies bloom to the HDR fixture light before JPEG conversion. The individual stills and their lossless source frames are in the local review folders. [Overhead] · [Orbit] · [Chase]

## Remaining differences

- Clip B exposes the aisle more brightly and its lamp halos spread farther. The new chase still has a darker foreground and more distinct points of light. The grade favours clip A’s contrast between asphalt and cast shadows.
- The pack’s broad roof and glass panels have simpler reflections than the silver and black cars in clip A. Cars at the overlap of two pools can show a secondary shadow. The contact band remains visible beneath them.
- The skyline has fewer overlapping layers than the clip, and the upper edge of the horizon skirt is just visible at the top of the wide chase frame. The nearest Fieldworks sign falls partly outside that frame.
- Verification covered the shipping assets in Blender. The concurrent game integration controls the final camera exposure, bloom and fog.
