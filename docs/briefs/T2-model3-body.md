# T2 — The Model 3 body in Blender (headless, from Python)

Read `docs/briefs/_common.md` first, then `docs/DESIGN.md` (§1 axes, §2 stations, §3 `model3.glb` contract, §4 colours), then product spec §1.4 and §3.

**Goal:** `public/models/model3.glb` — a 2024-facelift ("Highland") Tesla Model 3 exterior that is recognisably that car from above and from the rear at night, built by a rerunnable Blender Python script.

**You own:** `scripts/build_model3.py`, helper modules under `scripts/model3/`, `scripts/render_model3.py`, `public/models/model3.glb`, `public/models/model3.json`, `renders/model3/**`, `docs/report/T2-model3-body.md`.
**Not yours:** everything else (`src/**`, `tools/**`, `scripts/build_cabin.py`, `public/models/cabin.*` are being written by other agents right now).

## Do

- **Method (required by the spec):** describe the body as a side profile, a plan (top) outline and a set of cross-sections along its length; loft them into a clean quad grid; subdivide. Cut the wheel arches. Build the glass (windshield, side windows, the one-piece roof, rear window) as its own surfaces. Do not sculpt from a cube and do not stack primitives.
- **Size and origin:** metres, real size (length 4.720, width 1.848 without mirrors and 2.089 with, height 1.442, wheelbase 2.875, clearance 0.138, tyre Ø 0.669). Origin on the ground under the middle of the rear axle, +X forward, +Z up, +Y left. Start from the stations of DESIGN §2 (overhangs ≈ 0.86 front / 0.985 rear) and correct them against the side photos `car-06-side-rear.jpg`, `car-07-side-front.jpg`, `car-05-front-quarter.jpg`.
- **Separate named meshes exactly as in DESIGN §3:** `body`, `glass`, `trim_black`, `lights_head`, `lights_tail`, `lights_brake`, `lights_reverse`, `indicators_left`, `indicators_right`, `wheel_FL`, `wheel_FR`, `wheel_RL`, `wheel_RR`, `mirror_L`, `mirror_R`, `wordmark`. Wheel origins at the wheel centres. Each light mesh has its own emissive material so code can switch it.
- **Signature features — detail is a requirement here; match the references element by element, do not simplify to save effort:**
  - low fastback: one arc from the windshield base over the roof down to a short trunk lid with a small upturned lip;
  - **the roof is one dark glass panel from the windshield to the trunk** — from above this is the car's face: its outline (the narrowing toward the rear, the rounded rear-glass end), the hood shape with its two soft creases, the shoulders over the rear wheels and the mirror positions must be right (`car-01-high-rear.jpg`);
  - no grille, smooth nose, slim headlights with a thin daytime light line (`car-04-front.jpg`);
  - tail lights: a "C" lying on its side, set into the trunk lid and wrapping onto the fender, with the thin lit outline (`car-02-rear-quarter.jpg`, `car-03-rear.jpg`); `lights_tail` = the thin C outline, `lights_brake` = the fuller inner area + a high centre stop light at the top of the rear glass, `lights_reverse` = small white segments, indicators = amber segments at the outer ends front and rear;
  - "T E S L A" in spaced letters across the trunk lid (`wordmark`, real geometry or a clean alpha-free mesh, readable from 8 m behind);
  - flush door handles, frameless side windows with black trim, door cut lines as thin dark grooves, simple aero wheels (dark covers, ~5 broad spokes), black lower rear valance. Ignore the Performance trim's spoiler and diffuser. No underbody; close the arches with dark liners so nothing is see-through from above or behind.
- **Materials (glTF-safe Principled):** paint deep grey metallic `#1b1d21` (one variable at the top of the script, clearcoat on), glass near-black `#050608` glossy and opaque enough that the missing interior does not show from outside (the cabin model is separate and only drawn from the seat), black trim satin, tyres matte.
- **Budget:** at most 80k triangles including wheels. Print the count per mesh and the total.
- **`public/models/model3.json`:** triangle counts, bounding box, wheel centres and radius, and the stations of DESIGN §2 as actually built (cowl, header, roof peak, rear glass bottom, trunk lip, hood front edge, beltline height, mirror positions, inner cabin half-width at the dash and at the B-pillar, A-pillar base and top points left and right). The cabin model and the game read these.
- **Check, at most three rounds (spec §3):** `scripts/render_model3.py` renders top, rear, side, front and the `car-01-high-rear` angle (Cycles on the RTX 4070 via OptiX, ≤ 64 samples, denoised, plain studio light, neutral ground) and tiles them into **one contact sheet** `renders/model3/round<N>.jpg` (≤ 1600 px wide, JPEG q75). Compare against the references, write the five biggest differences into your report, fix them, re-render. After three rounds move on and list what still differs. To keep your thread fast: open each reference at most once, open contact sheets rather than single renders, and aim for at most ~10 opened images in the whole task. Also render one **night-look check**: the car from 12 m straight above and from 8 m behind / 5 m up with a single warm lamp, tail lights lit — this is how it will actually be seen.

## Don't

- No cabin interior, no other cars, no lot. No edits outside your files. No subagents. Never open the Blender window.

## Done when

- `heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P scripts\build_model3.py` runs clean from scratch and writes the GLB and JSON; total ≤ 80k triangles.
- All sixteen named nodes exist in the exported GLB (verify by re-importing the GLB in a fresh headless Blender or by parsing its JSON chunk) with correct wheel origins and overall bounding box within 1 cm of the real dimensions.
- The contact sheet of the last round is saved and the report lists the remaining differences honestly.

## Report

`docs/report/T2-model3-body.md` as described in `_common.md`.
