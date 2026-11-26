"""Silhouette IoU only (same rasteriser as compare.py), for a tmp/model-x/<dir>/geometry.npz.
Usage: python scripts/modelx/iou.py export   (or mesh, round9, ...)"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw
from pathlib import Path
from reference import ROOT, mask, VIEWS

source = ROOT / 'tmp/model-x' / sys.argv[1]
geo = np.load(source / 'geometry.npz')
cams = json.loads(Path(__file__).with_name('cameras.json').read_text())
results = {}
for view in VIEWS:
    c = cams[view]; d = geo['vertices'] - c['location']
    scale = -c['focal_px'] / (d @ c['back'])
    points = np.column_stack([c['cx'] + scale * (d @ c['right']), c['cy'] - scale * c['aspect'] * (d @ c['up'])])
    silhouette = Image.new('1', (1376, 768)); draw = ImageDraw.Draw(silhouette)
    for tri in points[geo['triangles']].round().astype(int).reshape(-1, 6).tolist(): draw.polygon(tri, fill=1)
    target = mask(view); actual = np.asarray(silhouette)
    difference = np.zeros((768, 1376, 3), np.uint8)
    difference[actual & target] = [110, 110, 110]; difference[actual & ~target] = [255, 108, 61]; difference[target & ~actual] = [0, 200, 244]
    Image.fromarray(difference).save(source / (view + '-mask.png'))
    results[view] = round(float(100 * np.count_nonzero(actual & target) / np.count_nonzero(actual | target)), 3)
(source / 'iou.json').write_text(json.dumps(results, indent=2) + '\n', encoding='utf8')
print(results)
