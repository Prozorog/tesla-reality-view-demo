# Cloud core vs asphalt beside it: median of small patches at the projected points.
# python tools/measure-cloud.py <dir>
import json, sys
from pathlib import Path
import numpy as np
from PIL import Image

d = Path(sys.argv[1] if len(sys.argv) > 1 else 'shots/p1.6')
data = json.loads((d / 'cloud-points.json').read_text(encoding='utf8'))
out = {}
for name, shot in data['shots'].items():
    im = np.asarray(Image.open(d / f'cloud-{name}.png').convert('RGB')).astype(float)
    def patch(points):
        px = []
        for p in points:
            x, y = int(round(p['x'])), int(round(p['y']))
            if 2 <= x < im.shape[1] - 2 and 2 <= y < im.shape[0] - 2:
                px.append(im[y - 2:y + 3, x - 2:x + 3].reshape(-1, 3))
        return np.median(np.concatenate(px), axis=0) if px else None
    core = patch(shot['core'])
    sides = [s for s in (patch(shot['left']), patch(shot['right'])) if s is not None]
    luma = lambda c: float(0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])
    # The darker side is clean asphalt (the other may hold a line, a kerb or a car).
    beside = min(sides, key=luma)
    out[name] = {'core': [round(v) for v in core], 'asphalt': [round(v) for v in beside],
                 'coreLuma': round(luma(core)), 'asphaltLuma': round(luma(beside)),
                 'ratio': round(luma(core) / max(1, luma(beside)), 2),
                 'coreBminusR': round(core[2] - core[0]), 'asphaltBminusR': round(beside[2] - beside[0])}
    print(f"{name:10s} core {out[name]['coreLuma']:4d} asphalt {out[name]['asphaltLuma']:4d} ratio {out[name]['ratio']:.2f}  B-R core {out[name]['coreBminusR']:+d} asphalt {out[name]['asphaltBminusR']:+d}")
(d / 'cloud-numbers.json').write_text(json.dumps(out, indent=1), encoding='utf8')
