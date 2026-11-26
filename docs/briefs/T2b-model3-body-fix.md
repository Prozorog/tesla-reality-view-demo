# T2b — Model 3 body: fix the five biggest shape gaps against the photos

Read `docs/briefs/_common.md` first, then `docs/DESIGN.md` (§1–§3), then `docs/report/T2-model3-body.md` (how the body is built, what was already tried), then product spec §1.4 "Signature features".

**Goal:** the existing Blender-built Model 3 exterior keeps its contract, size and budget, but its silhouette and glass now read as a 2024 Model 3 in the side, high-rear and overhead views, not as a generic rounded sedan.

**Start:** commit `3a87949`. The body builds clean (`scripts/build_model3.py`, helpers in `scripts/model3/`), 76,382 triangles, all 16 nodes verified, dimensions within 1 mm. Last review sheet: `renders/model3/round3.jpg`, night check `renders/model3/night.jpg`. Open `round3.jpg` once before you start: the gaps below were read off it against `../ref\car-07-side-front.jpg`, `car-06-side-rear.jpg`, `car-01-high-rear.jpg`, `car-03-rear.jpg`.

**You own:** `scripts/build_model3.py`, `scripts/model3/**`, `scripts/render_model3.py`, `public/models/model3.glb`, `public/models/model3.json`, `renders/model3/**`, `docs/report/T2b-model3-body-fix.md`.
**Not yours:** everything else; other agents are working in this folder right now.

## Fix (biggest first). Detail is a requirement: match the photos element by element.

1. **Rear deck and tail (side view).** Now the fastback line dips into a pinched "neck" in front of the trunk lid, the lid then juts out like a shelf / duck-tail, the tail lights stick out behind it, and the rear face below them is a round bulb. Wanted (`car-06-side-rear.jpg`, `car-07-side-front.jpg`): one continuous, slightly convex arc from the roof peak down the rear glass onto a short, nearly flat deck, with no concave dip anywhere; the lip at the trailing edge rises only ≈ 15–25 mm; the rear face drops nearly vertically from the lip (≈ 10–15° forward lean), with the tail lights **flush in that surface** and the bumper below only slightly proud, ending in the black lower valance.
2. **Nose (side and front-quarter views).** Now the hood droops into a pointed beak with the headlight at its tip. Wanted (`car-07-side-front.jpg`, `car-05-front-quarter.jpg`): a blunt, rounded nose — the hood's leading edge sits ≈ 0.68–0.72 m high and rolls into a nearly vertical bumper face; the slim headlights lie on the upper corners of that face, swept back along the fender tops; under them a clean smooth bumper with the low black intake.
3. **Wheel arches and sill.** Now the body flows around the wheels without a defined opening. Wanted: clean round cut openings concentric with the wheels, ≈ 40–50 mm gap around the tyre, a subtle flared arch lip, dark liners visible in the gap; a straight sill between the arches with the rising light-catching crease along the lower doors; a soft shoulder line running from the headlight to the tail light just below the window line (`car-01-high-rear.jpg`).
4. **Glass must read as glass, the same everywhere.** Now the side windows and windshield render pale and mirror-like while the roof panel is matte dark, and the roof glass has no visible border against the dark paint. Wanted: one consistent glazing material (near-black `#050608`, glossy, sharp reflections) on windshield, side windows, roof and rear glass; the roof glass framed by **painted roof rails ≈ 60–70 mm wide** on each side and a thin black seam at the windshield header, so that from 12 m overhead the dark glossy panel and its rounded rear end are clearly separate from the metallic paint (`car-01-high-rear.jpg`). Raise the paint's metallic flake / clearcoat response a little so body and glass differ under a lamp even though both are dark. Check the side-window outline: a slim, pointed-teardrop greenhouse with black trim, the bottom edge rising gently toward the rear, B-pillar hidden behind glass-black.
5. **Tail lights are a "C" open toward the centre of the car** (`car-03-rear.jpg`, `car-02-rear-quarter.jpg`): a long upper arm running inward across the lid, a shorter lower arm, joined by a tight curve at the outer end that wraps onto the fender. Now they read as a closed capsule outline. Keep `lights_tail` = the thin C outline and `lights_brake` = the fuller inner area + the high centre stop light.

## Don't

- Do not change node names, origins, overall dimensions, the wheel positions or the JSON keys of `model3.json` (update its values to the new surface). Stay ≤ 80k triangles. No cabin, no other files. No subagents. Never open the Blender window.

## Done when

- `heavy "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" -b --factory-startup -P scripts\build_model3.py` runs clean from scratch; the script's own verification (16 nodes, dimensions within 1 cm, wheel origins) still passes; ≤ 80k triangles.
- A new contact sheet `renders/model3/round4.jpg` (same five views + the photo next to each) and `renders/model3/night2.jpg` are saved. At most two render rounds; open at most ~5 images in the whole task (round3 once, the two side photos, your new sheet(s)).
- In the pure side view there is no concave dip between the roof peak and the trunk lip, and nothing protrudes behind the rear face.

## Report

`docs/report/T2b-model3-body-fix.md`: what changed per item, what still differs, check outputs, render paths.
