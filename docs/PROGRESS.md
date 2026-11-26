# Progress — Tesla Reality View demo, phase 1

**Request:** three.js toy of Tesla FSD "Reality View" parking (seat ↔ screen dive, tap a bay, the car backs in), night shopping-centre lot.
Full spec: `../ref\PROMPT-tesla-reality-view-phase1-parking.md`. Contracts: `docs/DESIGN.md`. Briefs: `docs/briefs/`.

**Mode:** Claude (Fable 5.2) orchestrates, Codex executes. User override of the skill defaults (2026-11-23): up to **3 Codex jobs in parallel**;
modelling tasks on `gpt-6.2-astra` `xhigh`, everything else on `gpt-6.2-sol` `max`. Every task is a fresh thread; Codex never commits, the orchestrator does.
Run start to finish without asking the user.

## Tasks

| Id | What | Model / effort | Status |
|---|---|---|---|
| T1 | S1 greybox: whole toy on boxes, lot.json generator, planner, checks, shots tool | gpt-6.2-sol max | accepted, `6e4fdfe`, tag s1 (38 min) |
| T2 | Model 3 body (`model3.glb`) | gpt-6.2-astra xhigh | built `3a87949` (18 min), shape gaps -> T2b |
| T2b | Body shape fix (deck, nose, arches, glass rails, C tail lights) | gpt-6.2-astra xhigh | accepted, `d3ee966` (16 min) |
| T3 | Cabin (`cabin.glb` + lightmap) | gpt-6.2-astra xhigh | accepted, `971bbac` (23 min) |
| T4 | Other cars from the pack (`cars.glb`, 30 repaints, lights) | gpt-6.2-astra xhigh | accepted, `87db547` (16 min) |
| T5 | Lot in Blender from `lot.json` + Cycles bake | gpt-6.2-astra xhigh | accepted, `b945918` (24 min) |
| T5b | Lot re-bake: grounded shadows, skyline, storefront variety | gpt-6.2-astra xhigh | accepted, `d477882` (24 min) |
| T6 | S4 on greybox: full interface, markers, ribbon, traffic, sound | gpt-6.2-sol max | accepted, `65de576`, tag s4 (39 min) |
| T7 | S2 + S3 integration of the GLBs and lightmaps | gpt-6.2-sol max | accepted, `6c99d9f`, tags s2 + s3 (38 min) |
| T4b | Low-detail pack cars (`cars_lod.glb`) | gpt-6.2-astra xhigh | accepted, `b65cca1` (23 min) |
| T3b | Cabin: mirror beam removed, slimmer pillars, contrasty bake | gpt-6.2-astra xhigh | accepted, `7b9f4c9` (17 min) |
| T8 | Integration fixes + performance (17 -> 144 fps) | gpt-6.2-sol max | accepted, `3acefb0` (39 min) |
| T9 | S5 polish, tiers, section 11 checks, build | gpt-6.2-sol max | accepted, `8ea33eb` (22 min) |
| T9b | Player paint / roof highlights, cabin mirror feed | gpt-6.2-sol max | accepted, `98520b7`, tag s5 (10 min) |

**Finished 2026-11-23.** Final report: `REPORT.md`. Kept server: `own-start --keep npx vite preview --port {port} --strictPort` (was http://localhost:4106).

Stage tags `tesla-rv-p1-s<N>` mark the commit at which that stage's deliverable exists; the code track (S1 → S4 features) and the art track run in
parallel, so S4 feature work may land before the S2/S3 art is integrated. Decision logged for REPORT.md.

## Decisions (for REPORT.md)

- Project folder: `.`.
- `lot.json` is generated and parking-verified by code (`tools/gen-lot.mjs`); the Blender lot script dresses that exact layout. One source of truth, no drift between the planner and the art.
- Storefront on the north side (z = −30), street / entrance south. Shop name "NORTHGATE".
- Clips A/B: one download attempt with a scratch-installed yt-dlp (nothing system-wide); result logged below.

## Parked ideas

- Cabin: fabric dash strip brighter than the dusk reference, red spill uneven (tune lightmap intensity at integration).
- Body: front lamps simple, smoked tail-light extension blends into the paint.
- Rear-view mirror in the cabin showing the rear-camera picture (cheap, nice for "headlights waiting behind you").
- Clips A/B downloaded fine with a scratch-installed yt-dlp; frames in `ref/park-a-XX.jpg`, `park-b-XX.jpg`.
