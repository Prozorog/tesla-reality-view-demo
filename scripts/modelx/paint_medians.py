"""Median bonnet/door RGB at the paint-comparison pose (polygons of tmp/model-x/compare-paint.py,
capture by tools/model-x-look.mjs ... paint). Usage: python scripts/modelx/paint_medians.py label=png ..."""
import sys, json
from PIL import Image, ImageDraw, ImageStat
SHAPES = {'bonnet': [(86,283),(120,250),(198,285),(188,331),(106,324)], 'door': [(308,268),(341,233),(339,246),(305,284)]}
out = {}
for arg in sys.argv[1:]:
    label, _, path = arg.partition('=')
    im = Image.open(path).convert('RGB'); out[label] = {}
    for panel, shape in SHAPES.items():
        mask = Image.new('L', im.size); ImageDraw.Draw(mask).polygon(shape, fill=255)
        out[label][panel] = ImageStat.Stat(im, mask=mask).median
print(json.dumps(out))
