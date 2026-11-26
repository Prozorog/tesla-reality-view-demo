"""Build the mapped Palace, Golden Gate Bridge and distant Marina landscape.

Run with Blender 5.2 headless through heavy. Coordinates in the plan are
metres, x east and z south. Blender vertices use (x, -z, height).
"""
import json
import math
import random
import subprocess
import sys
import time
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
sys.dont_write_bytecode = True
from lot.mesh import Batch, material

OUT = ROOT / 'public/models/sf'
MAP = json.loads((ROOT / 'public/data/sf/world.json').read_text(encoding='utf8'))
ORIGIN = MAP['origin']
SOURCES = {
    'bridge_dimensions': 'https://www.goldengate.org/bridge/history-research/statistics-data/design-construction-stats/',
    'palace_dimensions': 'https://npgallery.nps.gov/GetAsset/51817f34-fdb5-4b0f-b8cd-f7561356cc1e',
    'map_data': 'https://www.openstreetmap.org/copyright',
    'bridge_tower_legs': [1329545860, 1329761876, 1330832677, 1330832682],
}


def project(latitude, longitude):
    scale = 111319.49079327358
    return ((longitude - ORIGIN[1]) * scale * math.cos(math.radians(ORIGIN[0])),
            (ORIGIN[0] - latitude) * scale)


def offset(point, along, across, angle):
    ca, sa = math.cos(angle), math.sin(angle)
    return point[0] + along * ca - across * sa, point[1] + along * sa + across * ca


def mean(points):
    return tuple(sum(point[k] for point in points) / len(points) for k in (0, 1))


def tint(code, gain):
    return ''.join(f'{max(0, min(255, round(int(code[i:i + 2], 16) * gain))):02x}' for i in (0, 2, 4))


def lathe(batch, center, profile, color, sides=32, flutes=0):
    """A revolved profile, including optional shallow Corinthian shaft flutes."""
    x, z = center
    for (r0, y0), (r1, y1) in zip(profile, profile[1:]):
        for i in range(sides):
            a0, a1 = i * math.tau / sides, (i + 1) * math.tau / sides
            ripple0 = 1 - .038 * (1 + math.cos(flutes * a0)) if flutes else 1
            ripple1 = 1 - .038 * (1 + math.cos(flutes * a1)) if flutes else 1
            points = [(x + r0 * ripple0 * math.cos(a0), z + r0 * ripple0 * math.sin(a0), y0),
                      (x + r1 * ripple0 * math.cos(a0), z + r1 * ripple0 * math.sin(a0), y1),
                      (x + r1 * ripple1 * math.cos(a1), z + r1 * ripple1 * math.sin(a1), y1),
                      (x + r0 * ripple1 * math.cos(a1), z + r0 * ripple1 * math.sin(a1), y0)]
            slope = (r0 - r1) / max(.001, y1 - y0)
            normals = [(math.cos(a0), math.sin(a0), slope), (math.cos(a0), math.sin(a0), slope),
                       (math.cos(a1), math.sin(a1), slope), (math.cos(a1), math.sin(a1), slope)]
            normals = [tuple(Vector(n).normalized()) for n in normals]
            lighting = .82 + .18 * math.cos((a0 + a1) / 2 - .6)
            batch.face(points, tint(color, lighting), normals=normals)


def beam(batch, a, b, bottom, width, height, color):
    dx, dz = b[0] - a[0], b[1] - a[1]
    span = math.hypot(dx, dz)
    if span < .001:
        return
    nx, nz = -dz / span * width / 2, dx / span * width / 2
    footprint = [(a[0] + nx, a[1] + nz), (b[0] + nx, b[1] + nz),
                 (b[0] - nx, b[1] - nz), (a[0] - nx, a[1] - nz)]
    batch.slab(footprint, bottom, bottom + height, color)


def column(batches, center, height=22.2, base=.7, radius=.77, tone='c9ab78'):
    stone, trim, detail = batches
    x, z = center
    stone.box(x, z, base, radius * 3.0, radius * 3.0, .48, tint(tone, .8))
    lathe(trim, center, [(0, base + .48), (radius * 1.46, base + .48),
          (radius * 1.46, base + .67), (radius * 1.18, base + .86),
          (radius * 1.1, base + 1.05), (radius, base + 1.18)], tone, 32)
    shaft_bottom, shaft_top = base + 1.18, base + height - 2.0
    lathe(stone, center, [(radius, shaft_bottom), (radius * 1.035, shaft_bottom + 2.1),
          (radius * .96, (shaft_bottom + shaft_top) * .5), (radius * .84, shaft_top)], tone, 48, 16)
    lathe(trim, center, [(radius * .84, shaft_top), (radius * 1.12, shaft_top + .20),
          (radius * 1.34, shaft_top + .55), (radius * 1.48, shaft_top + 1.10),
          (radius * 1.62, shaft_top + 1.35)], tone, 32)
    stone.box(x, z, shaft_top + 1.35, radius * 3.6, radius * 3.6, .43, tone)
    # Layered acanthus leaves and volutes give the capitals a readable silhouette.
    for ring, count in ((0, 8), (1, 12)):
        for i in range(count):
            angle = math.tau * (i + ring * .4) / count
            px, pz = x + radius * 1.06 * math.cos(angle), z + radius * 1.06 * math.sin(angle)
            point = (px + radius * .32 * math.cos(angle), pz + radius * .32 * math.sin(angle), shaft_top + .65 + ring * .36)
            detail.rod((px, pz, shaft_top + .10 + ring * .30), point, radius * .18, tint(tone, .9), 5, radius * .07)


def arch(batch, a, b, spring, width, thickness, color):
    dx, dz = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dz)
    ux, uz = dx / length, dz / length
    nx, nz = -uz, ux
    mid = mean([a, b])
    radius = length / 2 - 1.5
    def vertex(angle, r, side):
        return (mid[0] + ux * math.cos(angle) * r + nx * side * thickness / 2,
                mid[1] + uz * math.cos(angle) * r + nz * side * thickness / 2,
                spring + math.sin(angle) * r)
    for i in range(28):
        lo, hi = i * math.pi / 28, (i + 1) * math.pi / 28
        for side in (-1, 1):
            batch.face([vertex(lo, radius, side), vertex(hi, radius, side),
                        vertex(hi, radius + width, side), vertex(lo, radius + width, side)][::side], color)
        batch.face([vertex(lo, radius, -1), vertex(lo, radius, 1),
                    vertex(hi, radius, 1), vertex(hi, radius, -1)], tint(color, 1.14))
        batch.face([vertex(lo, radius + width, 1), vertex(lo, radius + width, -1),
                    vertex(hi, radius + width, -1), vertex(hi, radius + width, 1)], color)


def palace_plan():
    cx, cz = MAP['rotunda']
    angle = math.radians(-8.7)
    piers = [(cx + 22.45 * math.cos(angle + i * math.tau / 8),
              cz + 22.45 * math.sin(angle + i * math.tau / 8)) for i in range(8)]
    return {
        'center': [cx, cz], 'height': 162 * .3048, 'diameter': 160 * .3048,
        'piers': piers,
        'north_colonnade': [(-26.1, 116.7), (-20.1, 93.3), (-9.2, 74.9), (9.5, 60.5), (24.1, 58.0), (21.5, 31.1)],
        'south_colonnade': [(-17.3, 173.3), (-3.6, 191.3), (14.4, 208.0), (32.9, 214.9), (55.1, 239.0)],
        'terminal_pylons': [(4.5, 34.4), (38.0, 241.7)],
        'replaces': [288371295, 288371306, 288371310, 288371313, 288371314],
    }


def build_palace(plan):
    stone = Batch('Palace_Illuminated_Stone')
    trim = Batch('Palace_Cornices_And_Arch_Light')
    detail = Batch('Palace_Capitals_And_Reliefs')
    roof = Batch('Palace_Copper_Dome')
    emitters = Batch('Palace_Uplight_Emitters')
    cx, cz = plan['center']
    piers = plan['piers']
    stone.slab([(cx + 24.4 * math.cos(i * math.tau / 64), cz + 24.4 * math.sin(i * math.tau / 64)) for i in range(64)], .08, .52, '8d795c')
    for i, point in enumerate(piers):
        tangent = math.atan2(point[1] - cz, point[0] - cx) + math.pi / 2
        # Paired exterior columns and a single interior column keep the arches open.
        for shift in (-1.35, 1.35):
            column((stone, trim, detail), offset(point, shift, 0, tangent), tone='c9ad7b')
        inward = offset(point, 0, 2.0, tangent)
        column((stone, trim, detail), inward, height=21.8, radius=.69, tone='d7bf91')
        stone.box(point[0], point[1], .52, 4.1, 4.1, 1.0, 'aa8c61')
        emitters.box(point[0], point[1] - 1.2, .64, .46, .20, .12, 'fff2ca')
        for j, point2 in enumerate((offset(point, -2.1, 0, tangent), offset(point, 2.1, 0, tangent))):
            lathe(detail, point2, [(0, 2), (.55, 2), (.66, 2.4), (.58, 3.1), (.30, 3.7), (.50, 3.85), (0, 4.0)], 'c8a778', 16)
        following = piers[(i + 1) % 8]
        arch(trim, point, following, 16.2, 1.05, 2.45, 'd3b57b')
        beam(stone, point, following, 24.2, 3.25, 2.6, 'b89765')
        beam(trim, point, following, 24.0, 3.7, .38, 'e3c591')
        beam(trim, point, following, 26.7, 4.0, .55, 'd9bd8a')
        # The attic is solid above the open arches, with inset relief frames.
        beam(stone, point, following, 27.3, 2.65, 5.4, 'b79b70')
        beam(trim, point, following, 32.4, 3.2, .60, 'e0c596')
        a = offset(point, 2.8, -1.42, tangent)
        b = offset(following, -2.8, -1.42, tangent)
        beam(detail, a, b, 28.25, .18, .22, '8b714d')
        beam(detail, a, b, 31.1, .18, .22, 'd8bc8b')
        # Low relief silhouettes remain geometric, with no borrowed sculpture images.
        middle = mean([a, b])
        for k in (-1, 0, 1):
            pos = offset(middle, k * 2.3, 0, tangent)
            detail.rod((pos[0], pos[1], 28.5), (pos[0] + .45, pos[1] + .3, 30.4), .38, 'cfb483', 8, .25)
            lathe(detail, (pos[0] + .45, pos[1] + .3), [(0, 30.45), (.30, 30.45), (.33, 30.8), (0, 31.1)], 'd9bf91', 12)
        for k in range(9):
            fraction = (k + .5) / 9
            tooth = (point[0] + (following[0] - point[0]) * fraction,
                     point[1] + (following[1] - point[1]) * fraction)
            detail.box(tooth[0], tooth[1], 26.2, .38, 3.45, .30, 'c7a874')
    dome_profile = [(0, 33.0)]
    dome_profile += [(20.35 * math.cos(i * math.pi / 2 / 24), 33.0 + 16.38 * math.sin(i * math.pi / 2 / 24)) for i in range(25)]
    lathe(roof, (cx, cz), dome_profile, '697465', 96)
    for radius, y, depth in ((21.5, 32.9, .65), (20.8, 33.55, .35), (22.1, 31.9, .55)):
        lathe(trim, (cx, cz), [(radius - .6, y), (radius, y), (radius, y + depth), (radius - .6, y + depth)], 'cbb181', 96)
    # Shallow ribs read around the dome silhouette without making a polygonal cap.
    for i in range(32):
        angle = math.tau * i / 32
        profile = [(cx + 20.38 * math.cos(t) * math.cos(angle), cz + 20.38 * math.cos(t) * math.sin(angle), 33.0 + 16.39 * math.sin(t)) for t in [k * math.pi / 2 / 12 for k in range(13)]]
        for a, b in zip(profile, profile[1:]):
            roof.rod(a, b, .055, '7c826a', 5)
    colonnade_modules = 0
    for chain in (plan['north_colonnade'], plan['south_colonnade']):
        for a, b in zip(chain, chain[1:]):
            beam(stone, a, b, 16.4, 3.2, 1.55, 'c4ab7d')
            beam(trim, a, b, 16.15, 3.7, .36, 'e0c793')
            beam(trim, a, b, 17.95, 3.9, .40, 'd3b785')
            length = math.dist(a, b)
            for j in range(max(1, round(length / 3.0))):
                p = (a[0] + (b[0] - a[0]) * (j + .5) / max(1, round(length / 3.0)),
                     a[1] + (b[1] - a[1]) * (j + .5) / max(1, round(length / 3.0)))
                detail.box(p[0], p[1], 17.5, .30, 3.6, .28, 'bda172')
        for index, point in enumerate(chain):
            tangent = math.atan2(chain[min(index + 1, len(chain) - 1)][1] - chain[max(0, index - 1)][1],
                                 chain[min(index + 1, len(chain) - 1)][0] - chain[max(0, index - 1)][0])
            for along in (-1.25, 1.25):
                for across in (-1.1, 1.1):
                    column((stone, trim, detail), offset(point, along, across, tangent), height=15.6, radius=.58, tone='bea475')
                    colonnade_modules += 1
            stone.box(point[0], point[1], 18.35, 4.4, 4.4, 1.1, 'baa076')
            emitters.box(point[0], point[1], .32, .40, .25, .10, 'fff0bd')
    for point in plan['terminal_pylons']:
        for dx in (-2.5, 2.5):
            for dz in (-3.1, 3.1):
                column((stone, trim, detail), (point[0] + dx, point[1] + dz), height=17.7, radius=.65, tone='ccb17d')
        stone.box(point[0], point[1], 18.5, 7.6, 9.0, 1.85, 'b9a173')
        trim.box(point[0], point[1], 18.25, 8.0, 9.4, .35, 'd6bd8a')
    return [stone, trim, detail, roof, emitters], {'columns': 24 + colonnade_modules + 8, 'open_arches': 8}


def bridge_plan():
    south = project(37.81401435, -122.47789105)
    north = project(37.82550255, -122.47923335)
    mid = mean([south, north])
    axis = Vector((north[0] - south[0], north[1] - south[1])).normalized()
    return {'midpoint': mid, 'axis': list(axis), 'span': 1280., 'side_span': 343., 'length': 2737.,
            'tower_height': 227., 'deck_width': 27., 'road_width': 19., 'main_cable_diameter': .92,
            'suspender_spacing': 15.24, 'source_tower_centres': [south, north]}


def build_bridge(plan):
    steel = Batch('Golden_Gate_International_Orange')
    cable = Batch('Golden_Gate_Cables_And_Suspenders')
    road = Batch('Golden_Gate_Deck_And_Lanes')
    glow = Batch('Golden_Gate_Deck_Lights')
    ux, uz = plan['axis']
    mid = plan['midpoint']
    def p(station, across, y):
        d = station - 640
        return mid[0] + ux * d - uz * across, mid[1] + uz * d + ux * across, y
    def deck(station):
        return 75.0 - 3.5 * ((station - 640) / 983) ** 2
    first, last = 640 - plan['length'] / 2, 640 + plan['length'] / 2
    for a in range(math.floor(first / 20), math.ceil(last / 20)):
        s0, s1 = max(first, a * 20), min(last, (a + 1) * 20)
        y0, y1 = deck(s0), deck(s1)
        road.face([p(s0, -13.5, y0), p(s1, -13.5, y1), p(s1, 13.5, y1), p(s0, 13.5, y0)], '444b4e')
        # Six 3.15 m lanes inside the official 19 m roadway, with raised sidewalks.
        for side in (-1, 1):
            near, far = side * 9.5, side * 12.5
            road.face([p(s0, near, y0 + .18), p(s1, near, y1 + .18),
                       p(s1, far, y1 + .18), p(s0, far, y0 + .18)][::side], '777c78')
        road.face([p(s0, -.08, y0 + .035), p(s1, -.08, y1 + .035),
                   p(s1, .08, y1 + .035), p(s0, .08, y0 + .035)], 'c8b06e')
        for side in (-1, 1):
            steel.face([p(s0, side * 13.5, y0 - 1), p(s1, side * 13.5, y1 - 1),
                        p(s1, side * 13.5, y1 - 7.5), p(s0, side * 13.5, y0 - 7.5)][::side], '68372f')
            steel.rod(p(s0, side * 13.6, y0 - 1), p(s1, side * 13.6, y1 - 7), .35, 'a64d3b', 5)
            steel.rod(p(s0, side * 13.6, y0 - 7), p(s1, side * 13.6, y1 - 1), .35, 'b85b42', 5)
            steel.rod(p(s0, side * 13.5, y0 + 1.15), p(s1, side * 13.5, y1 + 1.15), .16, 'b85843', 5)
        for lane in (-6.3, -3.15, 3.15, 6.3):
            if a % 2 == 0:
                road.face([p(s0, lane - .065, y0 + .03), p(s0 + 6, lane - .065, deck(s0 + 6) + .03),
                           p(s0 + 6, lane + .065, deck(s0 + 6) + .03), p(s0, lane + .065, y0 + .03)], 'cabf9e')
    for station in (0, 1280):
        for side in (-1, 1):
            center = p(station, side * 13.7, 0)
            for low, high, width, depth in ((0, 13, 13, 21), (13, 21, 10, 16), (21, 74, 8.1, 14),
                (74, 123, 7.0, 10), (123, 162, 6.0, 8), (162, 195, 5.1, 7), (195, 225, 3.9, 6)):
                angle = math.atan2(uz, ux)
                poly = [offset(center, along, across, angle) for along, across in ((-depth / 2, -width / 2), (depth / 2, -width / 2), (depth / 2, width / 2), (-depth / 2, width / 2))]
                steel.slab(poly, low, high, 'bc5641' if low else '77736c')
            # Long vertical ribs preserve the stepped Art Deco section.
            for offset_side in (-2.4, 2.4):
                steel.rod(p(station - 5.15, side * 13.7 + offset_side, 76), p(station - 3.8, side * 13.7 + offset_side * .65, 219), .22, 'd27050', 5)
            glow.rod(p(station, side * 13.7, 223.5), p(station, side * 13.7, 226.9), .34, 'ffb568', 6)
        for level, height in ((50, 2.6), (74, 4.5), (111, 4.0), (151, 4.1), (188, 4.1), (221, 6.0)):
            a, b = p(station, -13.7, level), p(station, 13.7, level)
            beam(steel, a[:2], b[:2], level, 7.2 if level < 80 else 5.8, height, 'b95742')
        # Portal corner haunches stay open through the middle of each frame.
        for low, high in ((79, 111), (115, 151), (155, 188), (192, 221)):
            for side in (-1, 1):
                steel.rod(p(station, side * 10.0, high), p(station, side * 7.9, high - 5.0), .55, 'c2664a', 5)
    def cable_height(station):
        if 0 <= station <= 1280:
            return 85 + (227 - 85) * ((station - 640) / 640) ** 2
        if station < 0:
            t = (station + 343) / 343
            return 76 + (227 - 76) * t ** 1.45
        t = (1623 - station) / 343
        return 76 + (227 - 76) * t ** 1.45
    samples = [(-343 + 1966 * i / 260) for i in range(261)]
    for side in (-1, 1):
        for a, b in zip(samples, samples[1:]):
            cable.rod(p(a, side * 13.7, cable_height(a)), p(b, side * 13.7, cable_height(b)), .46, 'b65b43', 7)
        station = -335.
        while station < 1615:
            for separation in (-.16, .16):
                cable.rod(p(station + separation, side * 13.7, deck(station)), p(station + separation, side * 13.7, cable_height(station)), .034, 'b06c50', 5)
            station += 15.24
        for station in range(math.ceil(first / 30) * 30, math.floor(last / 30) * 30 + 1, 30):
            stem = p(station, side * 11.7, deck(station))
            steel.rod(stem, (stem[0], stem[1], stem[2] + 7.2), .13, '94796a', 5)
            glow.box(stem[0], stem[1], stem[2] + 7.1, .9, .45, .16, 'ffd99a')
    for station in (first + 50, -500, -343, 1623, 1780, last - 25):
        for side in (-1, 1):
            center = p(station, side * 10.5, 0)
            steel.box(center[0], center[1], 0, 6, 6, deck(station) - 2, '665c53')
    return [steel, cable, road, glow]


def inside(point, polygon):
    result = False
    j = len(polygon) - 1
    for i, (x, z) in enumerate(polygon):
        px, pz = polygon[j]
        if (z > point[1]) != (pz > point[1]) and point[0] < (px - x) * (point[1] - z) / (pz - z) + x:
            result = not result
        j = i
    return result


def build_landscape():
    terrain = Batch('Marin_Headlands_And_Pacific_Heights')
    ocean = Batch('San_Francisco_Bay')
    docks = Batch('Yacht_Harbor_Docks')
    hulls = Batch('Yacht_Harbor_Hulls_And_Masts')
    windows = Batch('Pacific_Heights_House_Lights')
    lawn = Batch('Marina_Green_Lawn')
    # The main Green is the open waterfront between the west and east harbors.
    # Its authored simplified edge stays north of Marina Boulevard and its sidewalk.
    green = [(748, -415), (1092, -415), (1096, -197), (766, -225)]
    lawn.face([(*point, .009) for point in green], '294236')
    beam(lawn, (748, -415), (1092, -415), .016, 4.2, .01, '666b65')
    beam(lawn, (766, -225), (1096, -197), .016, 3.0, .01, '666b65')
    sea_edge = [(-6000, -6500), (4500, -6500), (4500, -380), (1500, -380),
                (1200, -470), (735, -445), (100, -445), (-60, -310),
                (-800, -310), (-1500, -480), (-2500, -900), (-6000, -1800)]
    ocean.face([(*point, -.025) for point in sea_edge], '172a39')
    rng = random.Random(73021)
    # Coarse authored landforms use real geographic direction, with no terrain DEM.
    def north_height(x, z):
        ridge = sum(height * math.exp(-((x - center) / spread) ** 2) for center, height, spread in
                    ((-4400, 180, 950), (-3100, 260, 900), (-1900, 165, 700), (-300, 115, 850)))
        return 4 + ridge * math.exp(-((z + 3400) / 1000) ** 2)
    for x in range(-6500, 1500, 200):
        for z in range(-5000, -2200, 200):
            points = [(a, b, north_height(a, b)) for a, b in ((x, z), (x + 200, z), (x + 200, z + 200), (x, z + 200))]
            terrain.face(points, tint('1a2630', rng.uniform(.88, 1.10)))
    def south_height(x, z):
        return 8 + 112 * math.exp(-((z - 1410) / 390) ** 2) * (.7 + .3 * math.exp(-((x - 800) / 1100) ** 2))
    for x in range(-350, 2150, 100):
        for z in range(1050, 1900, 100):
            terrain.face([(a, b, south_height(a, b)) for a, b in ((x, z), (x + 100, z), (x + 100, z + 100), (x, z + 100))], '283039')
    for x in range(-250, 2050, 29):
        for z in range(1090, 1810, 34):
            if rng.random() < .35:
                continue
            height = south_height(x, z)
            terrain.box(x, z, height, 13 + rng.random() * 6, 17, 7 + rng.random() * 5, tint('35404b', rng.uniform(.7, 1.1)))
            for shift in (-3.6, 0, 3.6):
                if rng.random() < .38:
                    continue
                windows.face([(x + shift - .5, z - 8.56, height + 3), (x + shift + .5, z - 8.56, height + 3),
                              (x + shift + .5, z - 8.56, height + 4.3), (x + shift - .5, z - 8.56, height + 4.3)], rng.choice(['b29b73', '847c69', 'd2b27e']))
    boats = 0
    for harbor in (water for water in MAP['water'] if water.get('kind') == 'marina'):
        poly = harbor['outline']
        minx, maxx = min(p[0] for p in poly), max(p[0] for p in poly)
        minz, maxz = min(p[1] for p in poly), max(p[1] for p in poly)
        for x in range(math.ceil((minx + 15) / 35) * 35, int(maxx - 10), 35):
            moorings = []
            for z in range(math.ceil((minz + 15) / 30) * 30, int(maxz - 15), 30):
                if not inside((x, z), poly):
                    continue
                for side in (-1, 1):
                    bx = x + side * 7.5
                    if not inside((bx, z), poly):
                        continue
                    boats += 1
                    length, width = rng.uniform(7.6, 11), rng.uniform(2.2, 3.1)
                    outline = [(bx - length / 2, z - width / 2), (bx + length * .30, z - width / 2),
                               (bx + length / 2, z), (bx + length * .30, z + width / 2), (bx - length / 2, z + width / 2)]
                    hulls.slab(outline, .02, .65, rng.choice(['aab6bb', 'd4d0bd', 'bcc7cb', '596874']))
                    hulls.box(bx - .8, z, .65, length * .32, width * .55, .6, 'a5b1b7')
                    hulls.rod((bx - .4, z, .8), (bx - .4, z, 7 + length * .40), .045, '77898f', 4)
                    hulls.rod((bx - .4, z, 1.4), (bx + length * .35, z, 1.4), .04, '7e8d90', 4)
                moorings.append(z)
            if moorings:
                docks.box(x, (min(moorings) + max(moorings)) / 2, .08, 1.6, max(moorings) - min(moorings) + 12, .23, '685d4c')
    return [terrain, ocean, docks, hulls, windows, lawn], {
        'boats': boats, 'terrain': 'Authored coarse geographic backdrop, not a DEM',
        'marina_green': {'outline': green, 'surveyed_boundary': False}}


def run():
    started = time.time()
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 4
    palace = palace_plan()
    bridge = bridge_plan()
    groups, palace_stats = build_palace(palace)
    groups += build_bridge(bridge)
    landscape, landscape_stats = build_landscape()
    groups += landscape
    objects = []
    for batch in groups:
        m = material(batch.name + '_Finish', .82)
        density = 1.5 if batch.name.startswith('Palace_') else .12
        obj = batch.make(m, density)
        objects.append(obj)
    bpy.context.view_layer.update()
    # Record the actual first visible architecture along the parked sightline.
    eye = Vector((9.31, -4.62, 1.3))
    rays = []
    for y in (33., 40., 48.):
        target = Vector((palace['center'][0], -palace['center'][1], y))
        hit, position, _, _, obj, _ = scene.ray_cast(bpy.context.evaluated_depsgraph_get(), eye, (target - eye).normalized(), distance=(target - eye).length + 1)
        rays.append({'target_height': y, 'first_hit': obj.name if hit else None,
                     'distance': round((position - eye).length, 3) if hit else None})
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    target = OUT / 'landmarks.glb'
    bpy.ops.export_scene.gltf(filepath=str(target), export_format='GLB', use_selection=True,
                              export_yup=True, export_animations=False, export_extras=True,
                              export_copyright='Project-authored landmarks. Placement data © OpenStreetMap contributors, ODbL.')
    counts = {}
    for obj in objects:
        obj.data.calc_loop_triangles()
        counts[obj.name] = len(obj.data.loop_triangles)
    manifest = {'axes': 'x east, y up, z south, metres', 'origin': ORIGIN,
                'source_urls': SOURCES, 'palace': palace, 'bridge': bridge,
                'stats': {**palace_stats, **landscape_stats, 'triangles': sum(counts.values()), 'parts': counts,
                          'file_bytes': target.stat().st_size, 'seconds': round(time.time() - started, 2)},
                'parked_sightline_rays': rays,
                'limitations': ['Sculpted figures and capitals use simplified original geometric reliefs.',
                                'Colonnade anchor paths follow the mapped footprints, with grouped open columns instead of solid walls.',
                                'The bridge approach deck is straight along its mapped axis. Close-up rivets and tower stairs are reserved for a later crossing phase.',
                                'Headlands and Pacific Heights use coarse authored landforms, with no elevation raster.',
                                'Lighting currently uses material-separated vertex tones and named emitters. UV1 is available for subsequent lightmaps.']}
    (OUT / 'landmarks.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
    subprocess.run(['node', str(ROOT / 'scripts/pack_sf_landmarks.mjs')], check=True, cwd=str(ROOT))
    print(json.dumps({'stats': manifest['stats'], 'sightlines': rays}), flush=True)


if __name__ == '__main__':
    run()
