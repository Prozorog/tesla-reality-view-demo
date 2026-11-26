"""Upper vs lower door brightness in a night-lot capture of the player car.
For each sample column the painted door run (bright pixels between the dark
window and the black sill) is split in thirds; upper third vs lower third.
Usage: python scripts/modelx/lot_door.py image.png x1,x2,... y_from y_to"""
import sys, json
import numpy as np
from PIL import Image
g = np.asarray(Image.open(sys.argv[1]).convert('L')).astype(float)
xs = [int(v) for v in sys.argv[2].split(',')]; y0, y1 = int(sys.argv[3]), int(sys.argv[4])
rows = []
for x in xs:
    col = g[y0:y1, x - 3:x + 4].mean(1)
    painted = np.where(col > 110)[0]
    if len(painted) < 9: continue
    run = col[painted[0]:painted[-1] + 1]
    n = len(run) // 3
    rows.append(dict(x=x, upper=round(float(run[:n].mean()), 1), lower=round(float(run[-n:].mean()), 1)))
up = np.mean([r['upper'] for r in rows]); lo = np.mean([r['lower'] for r in rows])
print(json.dumps(dict(columns=rows, upper=round(float(up), 1), lower=round(float(lo), 1), lower_darker_pct=round(float(100 * (up - lo) / up), 1))))
