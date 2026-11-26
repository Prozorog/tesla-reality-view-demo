"""Shared metre-space conventions. All layout points are (world x, world z)."""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "public/models"
WORK = ROOT / "assets-src/lot"
TEXTURES = MODELS / "textures/lot"
MAPS = MODELS / "lightmaps"
RENDERS = ROOT / "renders/lot"


def read(name):
    return json.loads((MODELS / name).read_text(encoding="utf8"))


def local(pos, h, along, across):
    return (pos[0] + along * math.cos(h) - across * math.sin(h),
            pos[1] - along * math.sin(h) - across * math.cos(h))


def street_lights(lot):
    street=lot["street"]
    a,b,z=street["from"],street["to"],street["z"]
    count=round((b-a)/17)
    for i in range(count):
        yield (a+(i+.5)*(b-a)/count,z+3.15,math.pi)
    # A service frontage outside the west fence meets the surveyed road.
    west=-lot["size"][0]/2-10
    for offset in (10,26,42,58,74):
        yield (west-3.15,z-offset,math.pi/2)


def ground_bounds(lot):
    w, d = lot["size"]
    points = [p for k in lot["kerbs"] for p in k["outline"]] + [[-w/2, -d/2], [w/2, d/2]]
    return (min(p[0] for p in points)-.4, min(p[1] for p in points),
            max(p[0] for p in points)+.4, max(max(p[1] for p in points), lot["street"]["z"]-2.6))


def tile_info(lot):
    x0, z0, x1, z1 = ground_bounds(lot)
    # Two pixels of real neighbouring surface on all sides for linear filtering.
    w = 2044
    h = min(2044, round(w*(z1-z0)/(x1-x0)))
    for j in range(2):
        for i in range(2):
            yield (f"Asphalt_{j}{i}", i, j, w, h,
                   (x0+i*(x1-x0)/2, z0+j*(z1-z0)/2,
                    x0+(i+1)*(x1-x0)/2, z0+(j+1)*(z1-z0)/2))
