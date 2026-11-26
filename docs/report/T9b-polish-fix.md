# T9b polish fixes

## Player car and cabin mirror

- Restored the pre-polish `#30333b` paint tint. The existing lamp-position diffuse samples still shade the body according to its orientation, including between reflections. The paint uses its authored metallic and clearcoat response with more reflection fill.
- Lifted the cool fill in the car’s 32 × 32 half-float cube probe and widened the warm lamp proxies from a 0.67 m radius to 1.05 m. Their linear emission multiplier rose from 11 to 64 so the lamp highlights survive cube filtering. A glazing roughness of 0.16 softens those highlights. The High probe refreshed 240 times in the cruise sample as the car moved.
- The cabin mirror continuously samples the horizontally flipped rear target, using 0.45 emissive gain and 0.035 environment gain for the night tint. Seat uses T8’s 0.2 s simulation-time interval while the inset is hidden. The visible inset uses its tier’s regular cadence, and the Screen stop skips the rear pass while the inset is hidden.

## Verification

| Command | Result |
| --- | --- |
| `heavy npm run build` | Passed. Main bundle 751.99 kB, 206.44 kB gzip. |
| `heavy npm run typecheck` | Passed. |
| `heavy npm run check:dive` | Passed all 45 projections and 75 tablet rays. Worst handover error 0.001966% of window height. Worst UV error 1.81e−14. |
| `heavy npm run shots -- http://localhost:4106/ tools/shots-s5.json` | Passed all eight shots, both orbit sweeps, and one live `?bot=1` park. B004 parked in 70.9 s with four active traffic cars, 0.000 m / 0.000° final error, zero overlap frames, and zero console errors. The live run peaked at 216 Reality View draws. The B076 and B058 orbit sweeps peaked at 230 and 232 draws. |
| `heavy npm run shots -- http://localhost:4106/ tools/profile-t8.json` | Passed one complete run on the RTX 4070 Laptop GPU with Chrome ANGLE D3D11 and DPR 1. Zero console errors and zero GPU timer disjoints. |
| `own-cleanup` | Stopped the temporary production preview on port 4106. |

### RTX profile

Each case sampled 10 seconds after warmup. Peak draw counts include the Reality View world, post-processing, overlays and HUD.

| Tier and buffer | Stop | Cruise fps | Reverse fps | Cruise / reverse peak Reality View draws | Cruise / reverse rear renders |
| --- | --- | ---: | ---: | ---: | ---: |
| High, 2560 × 1440 | Seat | 144.0 | 143.8 | 233 / 210 | 46 / 1,438 |
| High, 2560 × 1440 | Screen | 143.4 | 139.8 | 233 / 207 | 0 / 1,398 |
| Low, 1920 × 1080 | Seat | 144.0 | 143.9 | 232 / 210 | 46 / 720 |
| Low, 1920 × 1080 | Screen | 144.0 | 143.4 | 232 / 207 | 0 / 717 |

High Seat cleared the 60 fps target in both cases. Frame time p95 was 7.1 ms in all eight cases. The highest Reality View count was 233 draws against a limit of 250. Seat cruise refreshed the mirror at 4.6 Hz on both tiers.

## Stills and remaining differences from clip A

All eight 1280 × 800 JPEGs were recaptured in [shots/s5] at quality 70. The reviewed frames were [overhead reversing] and [Seat under the lamp].

1. Clip A has brighter, whiter shoulder lines and a concentrated glint on the roof. The demo’s overhead still has warm edges and a broader reflection across the windscreen edge, with a darker roof center. The probe’s lamp and storefront shapes give the reflections less detail than clip A.
2. Clip A’s rear inset has more lens distortion and richer storefront detail. The cabin mirror uses the demo’s rear-camera perspective, with the right edge of the mirror cropped in the Seat capture.

## Changed files

- `src/assets/car-models.ts` and `src/assets/index.ts` set the player paint, glazing, and dim mirror feed, including the fallback cabin.
- `src/render/car-reflections.ts` brightens the probe’s fill and lamp heads.
- `src/render/scene.ts` restores the Seat mirror refresh schedule.
- `tools/shots.mjs` checks the Seat mirror cadence and the zero rear submissions at the Screen stop in cruise.
- `docs/report/T9b-polish-fix.md` records the visual review and verification.
