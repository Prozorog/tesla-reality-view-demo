# T7 — S2 + S3 integration: the Blender-built car, cabin, cars and night lot replace the boxes

Read `docs/briefs/_common.md` first, then `docs/DESIGN.md`, then these reports (they say exactly how each asset must be used): `docs/report/T6-reality-view.md` (current module map, asset seam), `docs/report/T2b-model3-body-fix.md` + `T2-model3-body.md`, `docs/report/T3-cabin.md`, `docs/report/T4-cars-pack.md`, `docs/report/T5-lot.md`. Product spec: §3 (parts list), §4, §5.2, §5.3, §6.2, §6.4, §10 (budgets), and the pitfalls of §0 (lightmaps).

**Goal:** the game runs on the real assets — `model3.glb`, `cabin.glb`, `cars.glb`, `lot.glb` with their baked lightmaps — and the overhead parking view at night looks like `../ref\park-a-04.jpg`. Nothing of the gameplay, interface, traffic or sound regresses.

**Start:** commit `65de576` (tag `tesla-rv-p1-s4`). The whole toy with the full Reality View interface, traffic and sound works on box stand-ins behind the asset seam (`src/assets/`).

**You own:** `src/**`, `tools/**`, `index.html`, `package.json`, `docs/report/T7-integration.md`.
**While you work, an art agent is re-baking the lot** (`lot.glb`, `lot.lightmaps.json`, `lightmaps/lot_*`, `textures/lot/*`) with the same file names, mesh names, manifest keys and conventions — only pixel content and values change, and a few entries of the same shape may be added (more emissive meshes, more instanced groups, backdrop meshes). So read everything from the manifest and the GLB generically; hard-code no counts, intensities or mesh lists; and re-take your final screenshots at the very end.

**Not yours:** `scripts/**`, everything under `public/models/**` (read-only: do not regenerate `lot.json`, do not edit GLBs, manifests or lightmaps; if an asset is wrong, describe it precisely in your report), `renders/**`.

## Do

1. **Our car (`model3.glb`, `model3.json`).** Replace the box car in every view. Code drives: wheel spin and front-wheel steer on `wheel_FL/FR/RL/RR`; `emissiveIntensity` of `lights_head`, `lights_tail`, `lights_brake`, `lights_reverse`, `indicators_left/right` (tail on at night, brake when braking or stopped in gear, reverse in `R`, indicator blinking toward the chosen bay with the tick sound in sync); paint colour stays one variable. The brake lights and reverse lights throw a soft red / white pool on the asphalt behind the car and the headlights a soft pool ahead (cheap decals or additive quads, no shadow maps), as in `park-b-20.jpg`.
2. **Cabin (`cabin.glb`, `cabin.json`, `lightmaps/cabin_night.png`).** Replace the box cabin. Seat camera at the exported `eye_driver`. Lightmap on the listed receiver meshes only: `material.lightMap`, `channel = 1`, `flipY = false`, intensity and decoding exactly as `cabin.json` / the T3 report say. `steering_wheel` rotates about the axis given in `cabin.json` with the real steering angle × the wheel ratio (it must visibly spin during the parking arc). The live Reality View picture + interface goes on material `screen` of `screen_surface` (check the UV orientation against the manifest corners so the picture is upright and unmirrored, and that ray-cast taps land where they are aimed). `light_strip` emissive, colour one variable. From the seat the body is drawn too — hood edge and both mirrors must be visible through the open windshield and side windows — but the body's opaque `glass` mesh must not block the view from inside (hide it for the seat camera only). The cabin is not drawn by the Reality View camera or the rear camera, and not at the Screen stop. The dive end-point must still be the pose where `screen_surface` exactly covers the window: `tools/check-dive` stays green with the real quad corners.
3. **Parked and moving cars (`cars.glb`, `cars.json`).** The ~70 baked parked cars of `lot.json`, the 6–8 start-up cars and the moving traffic all use the pack cars with the type, colour variant and pose given. Parked cars are shaded with the per-car light samples from `lot.lightmaps.json` (bright under a lamp, sinking into shadow away from it) plus the environment reflection; runtime cars get a soft blob shadow. Lights: parked cars off; moving cars as built in T6 but on the real `lights_head / lights_tail / lights_brake` pieces. **Budget: the whole lot including all cars ≤ 250 draw calls and ≤ 500k triangles in the Reality View pass** — show draw calls and triangles (`renderer.info`) in the debug overlay. Instance aggressively: e.g. merge each type's static parts into as few meshes as its materials allow and draw each (type, variant) batch as one `InstancedMesh`; choose the simplest scheme that meets the budget.
4. **The lot (`lot.glb`, `lot.lightmaps.json`, `lightmaps/lot_*`).** Replace the box lot. Apply every lightmap as the T5 report specifies (channel 1, `flipY = false`, encoding, intensity). Emissive lamp heads, signs, windows and canopy lights from the manifest. Instanced furniture from the manifest. Sky deep blue-black `#070a14`, distance dissolving into night haze (fog matched in all three cameras). No real-time shadow maps. The ground between lamp pools is dark but never pure black.
   In the lot's own review render (`renders/lot/round3.jpg`, open it once) the baked shadows under the parked cars are faint, so some cars seem to float compared with `park-a-04.jpg`, where every car sits on a clear dark shadow. Add a soft dark contact shadow under **every** parked car too (one instanced batch, sized to each type's footprint, slightly offset away from the nearest lamp), on top of the bake.
   The 68 baked parked cars alone are ≈ 477k triangles at full detail, so with start-up cars, traffic and our car the Reality View pass goes over 500k. Keep the full-detail meshes (they are the look) but cull what the camera cannot see (frustum culling per instance or per row batch), and report the worst-case triangle count honestly.
5. **Our own car's shadow from above (spec §5.3):** a soft contact shadow under the car plus a fainter stretched shadow pointing away from the nearest lamp(s) of `lot.json`, blending as the car moves between lamps.
6. **Keep everything else working on the new assets:** markers and the chosen-bay outline sit on the real bay positions; the ribbon lies on the asphalt without z-fighting; the rear camera sits on the real trunk lid and sees the real scene; the planner's collision rectangles stay those verified by `check-parking` (do not change them).
7. Update the shots tool states if needed.

Detail is a requirement where the references decide the look: compare the overhead still with `park-a-04.jpg` and the seat still with `../ref\cabin-01-official-dusk.webp` and fix the big gaps you can fix from code (exposure, tone mapping, lightmap intensity, fog, paint and glass response). Look polish beyond that (bloom, reflections, lamp wash in the cabin, softness tuning) is the next task, not this one.

## Don't

- Do not edit anything under `public/models/` or `scripts/`. Do not change gameplay rules, the planner tolerances, the interface layout, traffic rules or sound. No bloom, no cube-camera reflections, no cabin lamp wash yet. No subagents.

## Done when

- `heavy npm run build` and the typecheck are green; `tools/check-parking` and `tools/check-dive` pass.
- One `?bot=1` run with traffic: parks within 0.15 m / 3°, zero overlaps, no console errors, on `?q=high` and on `?q=low`.
- Debug overlay shows ≤ 250 draw calls and ≤ 500k triangles for the Reality View pass in the overhead parking view; report the numbers for seat and screen stops.
- No box stand-in is visible anywhere in normal play (the box factories may remain as a fallback when a GLB fails to load).

## Screenshots

Save to `shots/s3/` (JPEG q70, ≤ 1280 px wide, `?shot=1`): `seat-cruise`, `seat-parking-wheel-turned`, `mid-dive`, `cruise-chevrons-toward-storefront`, `overhead-reversing-inset`, `overhead-turned-40`, `parked-overhead`, `seat-look-right-screen`. Open at most 3 yourself (the overhead one next to `park-a-04.jpg`, one seat view, one more) to check nothing is blank, mirrored, floating or pitch black. Final look is judged by the orchestrator.

## Report

`docs/report/T7-integration.md` as described in `_common.md`, plus: draw calls / triangles per view, fps you observed if any, every asset problem you could not fix from code (exact mesh / file and what is wrong), an updated module map.
