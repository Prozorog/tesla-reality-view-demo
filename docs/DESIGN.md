# Tesla Reality View demo, phase 1 — design spec and contracts

Full product spec (read-only, authoritative for anything not restated here):
`../ref\PROMPT-tesla-reality-view-phase1-parking.md`
Reference images (look only, never copy into `public/` or the build): `../ref\*.jpg|webp`

This file fixes what several agents must agree on. If it conflicts with the product spec on a look
question, the spec wins; on names, axes and file formats, this file wins.

## 1. Axes and units

- Metres everywhere.
- **Blender:** +X forward, +Y left, +Z up. Car origin on the ground under the middle of the rear axle.
- **three.js (after glTF export, no extra rotation):** +X forward, +Y up, **left = −Z**. `three = (bx, bz, −by)`.
- **World / lot (three.js):** Y up. Lot centre at the origin. X runs along the storefront (90 m, −45…45),
  Z runs across (60 m, −30…30). **Storefront on the north side, z = −30. Street and entrance on the south side, z = +30.**
  Heading `h` in radians: 0 = +X, positive turns toward −Z (counter-clockwise seen from above, i.e. left).
  Blender lot scripts build in Blender coords `(x, −z_world, y_up)` so the exported GLB lands in these world coords with no transform.

## 2. Our car (Model 3, 2024 facelift) — starting stations

Blender coords. The body script is authoritative and prints its final stations into `public/models/model3.json`;
the cabin starts from these and S2 integration reconciles.

| Station | Value |
|---|---|
| Rear bumper / front bumper | x = −0.985 / +3.735 (length 4.720) |
| Front axle | x = 2.875. Wheel centres z = 0.3345, y = ±0.79, tyre Ø 0.669 × 0.235 |
| Half width body / with mirrors | 0.924 / 1.0445 |
| Roof peak | z = 1.442 near x ≈ 1.0 |
| Windshield base (cowl) / header | ≈ (2.30, 0.98) / ≈ (1.35, 1.38) in (x, z) |
| Rear glass bottom / trunk lip | ≈ (−0.45, 1.10) / ≈ (−0.93, 1.06) |
| Driver eye `eye_driver` | ≈ (1.38, +0.37, 1.14) |
| Steering wheel centre | ≈ (1.80, +0.37, 0.90), Ø 0.37, column tilted ≈ 22° |
| Screen centre | ≈ (1.93, 0.00, 0.93), 0.3317 × 0.2073 m (15.4″, 16:10), landscape, faces the cabin, tilted back ≈ 8° |

Collision / planning rectangle of our car: 4.72 × 1.85 m (mirrors ignored), reference point = rear axle centre,
min turning radius 5.8 m at the rear axle centre (max front steer ≈ 33°, wheel-to-steering-wheel ratio 10:1 for the cabin wheel).

## 3. Asset contracts

### `public/models/model3.glb` (+ `model3.json`)
Separate named nodes: `body`, `glass`, `trim_black`, `lights_head`, `lights_tail`, `lights_brake`, `lights_reverse`,
`indicators_left`, `indicators_right`, `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR`, `mirror_L`, `mirror_R`, `wordmark`.
Each wheel node has its origin at the wheel centre, local axle axis = Blender Y (spin about it; steer about Z).
Light meshes carry their own material with an emissive colour; code drives `emissiveIntensity`.
`model3.json`: triangle counts, bounding box, wheel centres, the stations of §2 as built.

### `public/models/cabin.glb` (+ `cabin_lightmap.*`, `cabin.json`)
Same origin as the body. Nodes: `steering_wheel` (origin on the column axis, local rotation axis = the column axis, stated in `cabin.json`),
`screen_surface` (one flat quad, UV 0–1, u to the viewer's right, v up, own material), `screen_bezel`, `light_strip`
(emissive, colour in one variable, default `#ff2a1f`), empty `eye_driver`. Everything else may be any number of meshes
named by part. Second UV set = lightmap UVs. `cabin.json`: mesh name → lightmap file, eye position, wheel axis, screen quad corners.

### `public/models/cars.glb` (+ `cars.json`, textures)
Nine types: `sedan, wagon, hatchback, compact, coupe, minivan, pickup, suv, offroad`. Origin on the ground under the
**middle of the car**, +X forward. Target lengths (uniform scale to hit them): sedan 4.70, wagon 4.75, hatchback 4.25,
compact 3.90, coupe 4.50, minivan 5.10, pickup 5.40, suv 4.70, offroad 4.60. Per type: a root node named by type with
children for body, wheels and separate emissive `lights_head`, `lights_tail`, `lights_brake`.
`cars.json`: per type the built length/width/height, node names, and 3–4 colour variants (`white, silver, black, darkgrey, darkblue, red`)
with the texture file of each.

### `public/models/lot.json` — single source of truth for the layout
Written by `tools/gen-lot.mjs` (seeded, rerunnable), verified by the offline parking planner. **The Blender lot script
reads this file and dresses exactly this layout; it never invents its own.** World coords of §1.

```jsonc
{
  "seed": 7, "size": [90, 60],
  "aisles":  [{ "id": "A1", "points": [[x, z], ...], "oneWay": true }],
  "route":   [[x, z], ...],            // closed cruise loop passing every row, driving direction = point order
  "entrance": { "pos": [x, z], "heading": h },
  "bays": [{ "id": "B017", "center": [x, z], "heading": h,   // heading = nose direction of a car parked in it (backed in for angled rows)
             "width": 2.6, "depth": 5.5, "kind": "angled|straight|accessible|corral",
             "row": "R2", "taken": true,
             "car": { "type": "sedan", "color": "silver", "dx": 0.08, "dz": -0.05, "dh": 0.02, "noseIn": false } }],
  "lamps":   [{ "pos": [x, z], "height": 9, "arms": 2 }],
  "kerbs":   [{ "id": "K3", "outline": [[x, z], ...], "kind": "island|sidewalk|hedge" }],
  "hatches": [{ "outline": [[x, z], ...] }],
  "arrows":  [{ "pos": [x, z], "heading": h }],
  "trees":   [[x, z]], "bollards": [[x, z]], "corrals": ["B040", "B077"],
  "building": { "outline": [[x, z], ...], "height": 6.5, "canopyDepth": 3, "sign": "NORTHGATE", "doors": [[x, z]] },
  "street":  { "z": 36, "from": -80, "to": 80 }
}
```
Later additions by the lot bake: `public/models/lot.glb`, `public/models/lightmaps/*.{webp,png,jpg}` and
`public/models/lot.lightmaps.json` (mesh name → lightmap file, intensity).

## 4. Look

**Night lot (target: `park-a-still.jpg`, clip A):**
- Asphalt under a lamp: warm brown-grey `#5a4a3c…#6b5a48`; between pools: `#1c1a1c`, never pure black. Lamp colour ≈ 3000 K, `#ffc98a`.
- Bay lines off-white `#d9d2c4`, worn. Sky `#070a14`, haze toward `#0d1220`.
- Parked cars: white `#e8e6e1`, silver `#a9adb2`, black `#0d0e10`, dark grey `#3a3d42`, dark blue `#16233f`, muted red `#6e1f1c`.
- Our car: deep grey metallic `#1b1d21`, glass roof near-black `#050608` with strong reflections.
- World picture inside Reality View is slightly soft (≈1 px blur at 1280 wide, light grain, slight vignette); UI, markers and ribbon are sharp.

**Reality View overlays:**
- Ribbon / "Self-Driving" blue `#3e8bff`; ribbon alpha 0.55, car-wide (1.85 m), soft feathered edges, lying on the ground.
  **Reversing (`park-a-04.jpg`):** a short glow of about one car length behind the rear bumper, saturated blue at the bumper fading through
  violet to a soft red `#ff4a5a` at its far end; the full planned path beyond it is a much fainter blue. A thin white arc outlines the car's swept side.
  **Driving forward into / out of a bay (`park-b-20.jpg`):** the ribbon ahead of the nose is a soft white-blue strip, and the brake lights throw a red pool on the asphalt behind.
- Free-bay markers, hover → brighter + slight scale:
  cruise view (`park-b-04.jpg`): a white, slightly 3D "V" chevron pointing down, ≈ 1.2 m wide, floating ≈ 1.6 m above the bay centre, bobbing a little;
  parking view (`park-a-16.jpg`): a pale blue-grey rounded square `#9fb4c8` at 70 % alpha, ≈ 1.6 m, radius 0.3 m, lying flat in the bay, with a small white steering-wheel glyph.
  Chosen bay outline: blue `#3e8bff`, soft.

**Interface (target: `rv-01-night-street.jpg`), designed on a 1280 × 800 canvas, scaled uniformly:**
- Font: Inter (bundled woff2 or system fallback `"Inter", "Segoe UI", system-ui`). White text `#ffffff`, secondary `#a8adb5`.
- Cards: `rgba(22,23,26,0.86)`, radius 10 px, no border, no shadow. Icons thin line, 1.75 px stroke.
- Top left: `P R N D` 15 px letter-spaced (active letter white or blue, others `#6b7078`) + battery `78 %`; speed number 84 px weight 300; `MPH` 15 px weight 600;
  state label 17 px weight 600 (`Self-Driving` blue / `Manual` white); speed-limit sign (white rounded rect, "SPEED LIMIT 15").
- Top centre: small lock and camera glyphs, and under them the status label (`Autopark Ready`, `Parking`, `Reversing`, `Parked`) 19 px weight 600 white
  on a very light dark pill (`rgba(22,23,26,0.45)`, radius 18 px — in the clips it is almost bare text); `Cancel Selection` card button under it.
- Top right: clock, moon glyph, temperature (`7:17 pm  47°F`), 15 px. Rear-camera inset under it (`park-a-04.jpg`): ≈ 25 % of the screen width
  (320 × 200 on the 1280 canvas), radius 14 px, slides in from the right; red translucent zone on the ground near the bumper.
- Left, directly under the speed block (`park-b-04.jpg`): `Start Self-Driving` — a dark card button (card style, white text 17 px weight 600, ≈ 180 × 44), not a coloured fill.
  When parked, a small top-view car pictogram with an arrow sits left of the speed number.
- Bottom left: `Map` button, moon button. Bottom centre: music card 500 × 150 (cover 72 px, title, artist, progress, prev / play-pause / next + 3 small icons).
  Bottom right: trip card 300 × 150 (time, destination "Northgate Plaza", battery %, `End Trip`).
- Bottom dock strip 56 px high with 8–9 small icons (car, temperature `70`, seat heat, wheel heat, camera, music, apps, volume).

**Cabin (target: `cabin-01-official-dusk.webp`, `cabin-03-three-quarter.jpg`):** soft black upper dash `#101113`, grey fabric strip `#8f9094`
(reads dark at night), satin black console, dark seats `#16171a`, red light strip `#ff2a1f` thin (≈6 mm) wrapping doors → dash base.

## 5. Do not

- No reference image, pack source file or its untouched bright texture inside `public/` or `dist/`.
- No real-time shadow maps for lamps, no physics library, no game engine, no second copy of the interface.
- No pure-black ground, no flat unlit building, no default three.js grey materials left in the final stages.
- No watch modes; every Blender / build / browser / check command runs through `heavy`; servers only through `own-start`.
- No real brands except Tesla's own (shop name is invented: "NORTHGATE").
