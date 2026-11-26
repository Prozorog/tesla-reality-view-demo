"""Grey levels down the middle of the front door in the registered side view.

The strip is a 13 px wide column at x=810 of the 1376 x 768 side registration
(the photo x-side-right.webp and ?studio=side share the fitted camera). It runs
from just below the shoulder crease under the window line (y=372) down to the
black sill (y=572); rows are sampled at 5/25/50/75 % of that run.
Usage: python scripts/modelx/door_strip.py label=image.png [label=image.png ...]
"""
import sys, json
import numpy as np
from PIL import Image

X, TOP, BOTTOM, HALF = 810, 372, 572, 6
ROWS = (.05, .25, .50, .75)


def strip(path):
    im = Image.open(path).convert('L')
    if im.size != (1376, 768):
        im = im.resize((1376, 768), Image.Resampling.LANCZOS)
    g = np.asarray(im, dtype=float)
    values = []
    for f in ROWS:
        y = int(round(TOP + (BOTTOM - TOP) * f))
        values.append(round(float(g[y - 2:y + 3, X - HALF:X + HALF + 1].mean()), 1))
    return values


if __name__ == '__main__':
    result = {}
    for arg in sys.argv[1:]:
        label, _, path = arg.partition('=')
        v = strip(path)
        result[label] = dict(rows=v, darkening_pct=round(100 * (v[0] - v[-1]) / v[0], 1),
                             clipped_rows=sum(1 for t in v if t >= 240))
    print(json.dumps(result, indent=2))
