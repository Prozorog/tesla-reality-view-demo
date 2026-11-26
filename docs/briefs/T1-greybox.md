# T1 — S1 Greybox: the whole toy works with boxes

Read `docs/briefs/_common.md` first, then `docs/DESIGN.md`, then the product spec sections named below.

**Goal:** a Vite + three.js + TypeScript (WebGL2) page in which the complete Reality View parking toy already plays end to end, with boxes standing in for the car, the cabin, the lot and the parked cars.

**Start:** the repo holds only `docs/`. You create the app from scratch.

**You own:** `package.json`, lockfile, `tsconfig*.json`, `vite.config.ts`, `index.html`, `src/**`, `tools/**`, `public/models/lot.json`, `public/fonts/**`, `.gitignore` additions, `docs/report/T1-greybox.md`.
**Not yours (other agents are writing them right now):** `scripts/**` (Blender), `public/models/*.glb`, `public/models/model3.json`, `cabin.json`, `cars.json`, `renders/**`.

## Do

Spec sections: §0 (pitfalls, GPU, stack), §6 all, §8.1–8.3, §10 (tier selection only), §11.3, §11.4, §11.5, the debug URL parameters of §11. From §7 only what S1 needs (below).

1. **Lot layout generator** `tools/gen-lot.mjs` → `public/models/lot.json`, schema and world axes exactly as in `docs/DESIGN.md` §1 and §3 (this file is the single source of truth; a Blender script will later dress exactly this layout, so every field must be filled: aisles, closed cruise route, entrance, ~110 bays, lamps, kerb islands, hatches, arrows, trees, bollards, corrals, building, street). Layout per spec §5.1 and §5.2: about 90 × 60 m, angled bays in double rows with one-way aisles, **angled for backing in** (a car driving along the aisle passes the bay, stops and reverses into it in one arc), one row of straight bays along the storefront sidewalk, ~70 bays taken (seeded mix of the nine car types and six colours of DESIGN §3, a little crooked / off-centre), ~40 free spread over all rows, never fewer than two free bays in view from any route point. The cruise route passes every row and closes on itself.
2. **Parking planner** (pure TS, no rendering, shared by the game and the offline check): plans the manoeuvre of §8.2 for the car's real rectangle (4.72 × 1.85 m, rear-axle reference, min turning radius 5.8 m): forward past the bay, stop, reverse along a smooth arc, straighten, stop centred; a single forward correction is allowed. Must keep ≥ 0.3 m clearance to every neighbour car rectangle (with their jitter) and every kerb, and end within 0.15 m and 3° of the bay centre. **Tune the generator and the planner together until every free bay passes** (`tools/check-parking.*`, spec §11.4). If a bay type cannot pass, change the layout (angle, aisle width, row-end gaps), not the tolerance.
3. **The game**, all of it working on boxes:
   - seat view from the driver's eye inside a box cabin (dash, wheel, screen quad on a stalk, pillars), head-look with the mouse (§6.2), steering wheel turning with the real steering angle;
   - the Reality View camera with cruise and parking framings and the 1.5 s eased move between them, drag-to-orbit with the car as pivot, tilt limits, stays where released (§6.3);
   - the live picture on the tablet through a render target, the tablet usable from the seat by ray-casting to `screen_surface` (tap a bay, drag the view, touch ring) (§6.4);
   - the dive between Seat and Screen stops on the mouse wheel with spring and snap, keys `1` `2` `Esc`, double-click, the first-time hint, the 200 ms cross-fade, cabin not rendered at the Screen stop, works mid-manoeuvre (§6.1, §6.5). The hand-over must be the same camera at the same moment with the 16:10-versus-window crop matched; write `tools/check-dive.*` that computes where the car lands on screen through the tablet path and through the direct path and fails above 1 % of window height (§11.3);
   - rear-camera inset: third small render from the trunk lid, very wide, slides in while in reverse, 2D guide lines and a red zone that grows with proximity (§6.6);
   - cruising the route at ~6 mph with smooth steering, slower in turns, never stopping on its own (§8.1);
   - choose a bay by tapping its marker or the bay → status pill `Autopark Ready` + `Cancel Selection`, then `Parking`, `Reversing`, `Parked`; blue ribbon path; wheels steer, brake / reverse lights and indicator switch (as emissive boxes named like the contract nodes); after `Parked`, `Start Self-Driving` returns and pulls the car out forward; the bay is free again (§8.2);
   - manual driving with `W A S D` / arrows taking over at once, soft stops against kerbs and cars, park by hand, auto take-over after 2 s without input (§8.3);
   - a few runtime cars (boxes) taking 6–8 random free bays at start (§5.2 last bullet). Moving traffic is **not** in this task.
4. **One interface, drawn once, used in both places** (§6.4): the same UI layer must show on the tablet texture in the cabin and full-window at the Screen stop, razor sharp in both, with one hit-testing path. For S1 it needs only: gear letters, speed, state label (`Self-Driving` / `Manual`), status pill, `Start Self-Driving`, `Cancel Selection`, the rear-camera inset frame, simple free-bay markers (chevron in cruise view, flat rounded square in parking view, hover brightens), the touch ring. Use the sizes and colours of DESIGN §4 so the later full interface extends it rather than replaces it.
5. **Structure for what comes next (do not build it now):** the Blender-built `model3.glb`, `cabin.glb`, `cars.glb`, `lot.glb` + lightmaps will replace the boxes; then the full interface, moving traffic and sound. Keep the box stand-ins behind the same node-name contract as DESIGN §3 (e.g. a box car exposing `wheel_FL`, `lights_brake`, `screen_surface`, `steering_wheel`, `eye_driver`) so swapping in GLBs is a local change in one asset module. Keep simulation (car state, planner, route follower) separate from rendering.
6. Log the WebGL renderer string (`WEBGL_debug_renderer_info`) at start, show it in a debug overlay (toggle key), pick the quality tier from it with `?q=high|low` override (§10; only the render-target sizes and frame-skip need to work now).
7. Debug URL parameters: `?view=seat|screen`, `?bot=1` (cruise, pick the first free bay, park; expose the end pose and a "no overlap" flag on `window.__rv` for the check), `?bay=<id>`, `?q=`, `?shot=1`, `?pause=1`.
8. `tools/shots.*`: a script that opens the page in the installed Chrome (prefer `playwright-core` with `channel: 'chrome'` and GPU flags over downloading a browser; real GPU, not SwiftShader, if at all possible) and saves named stills via the URL parameters and `window.__rv` hooks. It will be reused by every later stage, so make shot names and states data-driven.

Pick the simplest robust technique that achieves each of these.

## Don't

- No Blender, no GLB loading work beyond leaving the seam, no sound, no moving traffic, no bloom / post-processing polish, no long-run or pixel-exact tests.
- Do not touch files you do not own (see above). No subagents.

## Done when

- `heavy npm run build` and the typecheck are green.
- `tools/check-parking` passes for **every** free bay in `lot.json` (prints bay count, worst clearance, worst end error).
- `tools/check-dive` prints a difference under 1 % of window height.
- With `?bot=1` the car cruises, picks the first free bay, backs in, ends within 0.15 m / 3°, and no rectangles overlapped (run once through the shots tool or a small headless run).
- No console errors on load with `?q=high` and `?q=low`.

## Screenshots

Save to `shots/s1/` (JPEG q70, ≤ 1280 px wide): `seat-cruise`, `seat-parking-wheel-turned`, `mid-dive`, `cruise-chevrons`, `overhead-reversing-inset`, `overhead-turned-40`, `parked`. Open at most 2 yourself to make sure nothing is blank or broken. Look and feel are judged by the orchestrator.

## Report

`docs/report/T1-greybox.md` as described in `_common.md`, plus: how to run (`npm` scripts), the controls, the layout numbers (bays total / taken / free, bay angle, aisle width), the renderer string the shots browser reported, and the module map (one line per `src` folder) so the next fresh task can find its way.
