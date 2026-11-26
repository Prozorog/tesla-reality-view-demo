"""Bake San Francisco pavement with Cycles and pack world-space UV2 tiles.

Run tools/compile-sf-lamps.mjs first with Node's --experimental-transform-types.
Run this script in Blender 5.2 background mode from a factory-startup scene.
"""

import json
import math
from pathlib import Path
import struct
import sys
import time
import zlib

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent / "lot"))
from baking import assign_uvs, bake_node, denoise, image_target, pixels
from scene import light

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public/models/sf"
CHUNK = 128
PAD = 24
DENSITY = 1.25
TILE = round((CHUNK + 2 * PAD) * DENSITY)
COLUMNS = 8
EXPOSURE = 1.0


def read(path):
    return json.loads((ROOT / path).read_text(encoding="utf8"))


def scene_setup():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 4
    scene.cycles.device = "CPU"
    scene.cycles.seed = 7
    scene.cycles.samples = 20
    scene.cycles.max_bounces = 3
    scene.cycles.diffuse_bounces = 2
    scene.world = bpy.data.worlds.new("Marina night sky")
    background = scene.world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = (0.43, 0.52, 0.66, 1)
    background.inputs["Strength"].default_value = 0.075


def mesh(name, vertices, faces, color):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    material = bpy.data.materials.new(name)
    surface = material.node_tree.nodes.get("Principled BSDF")
    surface.inputs["Base Color"].default_value = color
    surface.inputs["Roughness"].default_value = 1
    data.materials.append(material)
    return obj, material


def blockers(buildings):
    vertices, faces = [], []
    for building in buildings:
        plan = [(x, -z) for x, z in building["outline"]]
        count = len(plan)
        area = sum(x * plan[(i + 1) % count][1] - y * plan[(i + 1) % count][0] for i, (x, y) in enumerate(plan))
        if area < 0:
            plan.reverse()
        offset = len(vertices)
        vertices.extend((x, y, height) for height in (0, building["height"]) for x, y in plan)
        for i in range(count):
            first, last = offset + i, offset + (i + 1) % count
            faces.append((first, last, last + count, first + count))
        faces.append(tuple(range(offset + count, offset + 2 * count)))
    mesh("Mapped occluders", vertices, faces, (0.34, 0.39, 0.46, 1))


def fixtures(lamps):
    for lamp in lamps:
        x, height, z = lamp["head"]
        acorn = lamp["kind"] == "acorn"
        light(lamp["id"], (x, -z, height), (0, 0, -1), "SPOT",
              40 if acorn else 87, "ffd8ae" if acorn else "fff4ea",
              0.38 if acorn else 0.58, 139 if acorn else 128, 0.84)


def nearest(point, edges):
    result, distance = None, math.inf
    x, z = point
    for (ax, az), (bx, bz) in edges:
        dx, dz = bx - ax, bz - az
        size = dx * dx + dz * dz
        if size == 0:
            continue
        progress = min(1, max(0, ((x - ax) * dx + (z - az) * dz) / size))
        q = ax + progress * dx, az + progress * dz
        test = math.hypot(q[0] - x, q[1] - z)
        if test < distance:
            result, distance = q, test
    return result, distance


def shops(world):
    chestnut = [pair for segment in world["segments"] if segment["name"] == "Chestnut Street"
                for pair in zip(segment["points"], segment["points"][1:])]
    total = 0
    for building in world["buildings"]:
        seed = int(str(building["id"]).rsplit("/", 1)[-1])
        if not building["commercial"] or seed % 7 == 0:
            continue
        outline = building["outline"]
        best = (26.0, None)
        for a, b in zip(outline, outline[1:] + outline[:1]):
            width = math.dist(a, b)
            if width < 4:
                continue
            centre = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
            end, distance = nearest(centre, chestnut)
            if end is not None and 6 < distance < best[0]:
                vector = Vector((end[0] - centre[0], centre[1] - end[1], 0)).normalized()
                edge = Vector((b[0] - a[0], a[1] - b[1], 0)).normalized()
                if abs(vector.dot(edge)) < 0.6:
                    best = (distance, (width, centre, vector))
        if best[1] is None:
            continue
        width, (x, z), vector = best[1]
        direction = (vector.x, vector.y, -0.66)
        colour = ("fac58d", "ffcfa2", "ffe3b8")[seed % 3]
        lamp = light(f"Storefront {building['id']}", (x + vector.x * 0.57, -z + vector.y * 0.57, 2.15),
                     direction, "AREA", min(width, 10) * 6.5, colour, (1.3, min(width, 10) * 0.8))
        lamp.data.spread = 2.1
        total += 1
    return total


def chunk_centres(world):
    points = [point for road in world["roads"] for point in road["points"]]
    points.extend(world["lotPolygon"])
    centers = {(math.floor(x / CHUNK), math.floor(z / CHUNK)) for x, z in points}
    return sorted(centers, key=lambda key: (key[1], key[0]))


def bake_ground(tiles):
    x0 = min(x for x, z in tiles) * CHUNK - PAD
    z0 = min(z for x, z in tiles) * CHUNK - PAD
    x1 = (max(x for x, z in tiles) + 1) * CHUNK + PAD
    z1 = (max(z for x, z in tiles) + 1) * CHUNK + PAD
    w, h = round((x1 - x0) * DENSITY), round((z1 - z0) * DENSITY)
    obj, material = mesh("Marina pavement receiver", [(x0, -z1, 0), (x1, -z1, 0), (x1, -z0, 0), (x0, -z0, 0)],
                         [(0, 1, 2, 3)], (0.65, 0.65, 0.65, 1))
    coords = [(0, 0), (1, 0), (1, 1), (0, 1)]
    assign_uvs(obj, "Surface", coords)
    assign_uvs(obj, "Lightmap", coords)
    target = image_target("San Francisco ground light", w, h)
    bake_node(material, target)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    start = time.perf_counter()
    result = bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, uv_layer="Lightmap", margin=2, use_clear=True)
    if "FINISHED" not in result:
        raise RuntimeError(f"Cycles pavement bake failed: {result}")
    radiance = pixels(target)[::-1]
    if not np.isfinite(radiance).all() or radiance.max() < 0.02:
        raise ValueError("Invalid Cycles pavement light")
    print(f"Cycles {w} × {h} bake in {time.perf_counter() - start:.1f} s. Radiance percentiles "
          f"{np.percentile(radiance, [10, 50, 90, 99]).round(4).tolist()}", flush=True)
    return radiance, x0, z0


def png_chunk(tag, contents):
    length = struct.pack(">I", len(contents))
    checksum = struct.pack(">I", zlib.crc32(tag + contents) & 0xffffffff)
    return length + tag + contents + checksum


def write_atlas(tiles, radiance, x0, z0):
    width = COLUMNS * TILE
    height = math.ceil(len(tiles) / COLUMNS) * TILE
    rows = np.zeros((height, 1 + width * 3), dtype=np.uint8)
    charts = {}
    for i, (x, z) in enumerate(tiles):
        start_x, start_z = x * CHUNK - PAD, z * CHUNK - PAD
        rx = round((start_x - x0) * DENSITY)
        rz = round((start_z - z0) * DENSITY)
        layer = denoise(np.maximum(radiance[rz:rz + TILE, rx:rx + TILE], 0), (1, 2, 4))
        layer = np.clip(layer / EXPOSURE, 0, 1)
        srgb = np.where(layer <= 0.0031308, layer * 12.92, 1.055 * np.power(layer, 1 / 2.4) - 0.055)
        px, py = i % COLUMNS * TILE, i // COLUMNS * TILE
        rows[py:py + TILE, 1 + px * 3:1 + (px + TILE) * 3] = np.rint(srgb * 255).astype(np.uint8).reshape(TILE, -1)
        charts[f"{x},{z}"] = [px, py]
    OUTPUT.mkdir(parents=True, exist_ok=True)
    name = "pavement-night.png"
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    (OUTPUT / name).write_bytes(b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", header) + png_chunk(b"sRGB", b"\0") +
                                png_chunk(b"IDAT", zlib.compress(rows.tobytes(), 7)) + png_chunk(b"IEND", b""))
    manifest = {"image": f"sf/{name}", "size": [width, height], "tileSize": TILE,
                "padding": PAD, "density": DENSITY, "intensity": EXPOSURE * math.pi, "charts": charts}
    (OUTPUT / "pavement-night.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
    print(f"Wrote {len(charts)} padded UV2 charts, {width} × {height}", flush=True)


if __name__ == "__main__":
    world = read("public/data/sf/world.json")
    lamps = read("tmp/sf-bake/lamps.json")
    scene_setup()
    blockers(world["buildings"])
    fixtures(lamps)
    print(f"Baking {len(lamps)} street lights and {shops(world)} storefronts", flush=True)
    tiles = chunk_centres(world)
    write_atlas(tiles, *bake_ground(tiles))
