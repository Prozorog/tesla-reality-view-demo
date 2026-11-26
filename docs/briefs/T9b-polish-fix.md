# T9b — Two look regressions from the polish pass

Read `docs/briefs/_common.md` first, then the "Rendering changes" part of `docs/report/T9-polish.md` and its "Changed files" list.

**Goal:** our own car and the cabin mirror look right again; nothing else changes.

**Start:** commit `8ea33eb`. Everything works and all checks are green. Stills of the current state: `shots/s5/`. Stills of the state before the polish pass: `shots/s3b/`.

**You own:** `src/**`, `tools/**`, `docs/report/T9b-polish-fix.md`.
**Not yours:** `scripts/**`, `public/models/**`, `renders/**`, `REPORT.md`.

## Fix

1. **Our car has turned into a black silhouette from above.** Compare `shots/s5/overhead-reversing-inset.jpg` and `shots/s5/cruise-chevrons.jpg` with `shots/s3b/overhead-reversing-inset.jpg` and with the reference `../ref\park-a-04.jpg` / `park-a-16.jpg`: before the polish pass the body read as blue-grey metal with a shaded roof; now the paint and the glass roof are almost pure black with no visible highlight, so the hero of the picture has no shape. Wanted: the paint reads as deep-grey metallic that clearly picks up the warm lot lamps (bright edges on the shoulders, hood and trunk, lighter on the lamp side, like the neighbouring cars which are lit by the same lamps); the glass roof is dark glass with one or two soft warm lamp highlights sliding over it as the car moves; body lines, mirrors and the roof outline are readable against the asphalt at the 14 m parking view and in the cruise view. Keep the live reflection probe, but the car must not depend on it alone: keep the lamp-position diffuse lighting the body had before, and make the probe's lamp heads bright enough (HDR) to leave a visible highlight.
2. **Cabin mirror.** In `shots/s5/seat-under-lamp.jpg` and `shots/s5/seat-cruise.jpg` the interior mirror is a flat pale grey slab (it now shows an environment reflection while the rear inset is closed). Give it back the dim mirrored rear-camera picture at a low refresh rate (≈ 5 Hz outside reverse, as in T8), darkened like a real night mirror. The frame-rate rule stays: no rear render at the Screen stop while the inset is hidden.

Pick the simplest robust technique. No other look, layout, gameplay or performance changes.

## Don't

- No edits under `public/models/` or `scripts/`. No subagents. Do not start a kept server.

## Done when

- `heavy npm run build` and typecheck green; `check:dive` green; one `?bot=1` park still ends within 0.15 m / 3° with zero overlaps and no console errors.
- One re-run of `tools/profile-t8.json` on the RTX: High seat still ≥ 60 fps at 2560 × 1440; Reality View pass ≤ 250 draw calls. Numbers in the report.

## Screenshots

Re-take all eight into `shots/s5/` with `tools/shots-s5.json` (same names). Open at most 2 yourself (the overhead reversing one next to `park-a-04.jpg`, and one seat view).

## Report

`docs/report/T9b-polish-fix.md`: what changed, the numbers above, what still differs from clip A.
