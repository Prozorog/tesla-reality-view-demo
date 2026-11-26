"""Build drop-in parked cars from read-only Meshy exports, using Blender 5.2.

Run from the repository through heavy. Optional scripts/cars.meshy.json maps
filenames (or stems) to a length in metres, for example {"my-suv.glb": 4.8}.
The generated manifest is discovered by the demo without a code change.
"""
import json
import math
import os
from pathlib import Path
import re
import struct
import sys
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.dont_write_bytecode = True
PROJECT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get("TESLA_REF_DIR", PROJECT.parent / "ref")) / "meshy" / "out"
OUTPUT = PROJECT / "public" / "models" / "meshy"
MANIFEST = OUTPUT.parent / "cars_meshy.json"
CONFIG = Path(__file__).with_name("cars.meshy.json")
REPLACEMENTS = ("sedan", "wagon", "coupe", "compact", "hatchback",
                "minivan", "pickup", "suv", "offroad")
ROLES = ("body", "glass", "wheels", "trim_black", "alloy")
LIGHTS = {"lights_head": (1, .86, .66), "lights_tail": (1, .012, .008),
          "lights_brake": (1, .018, .012)}


def api_check():
    exporter = bpy.ops.export_scene.gltf.get_rna_type().properties
    for option in ("filepath", "export_yup", "export_animations", "use_selection"):
        if option not in exporter:
            raise RuntimeError(f"Blender {bpy.app.version_string} lacks glTF option {option}")
    probe = bpy.data.materials.new("API socket check")
    shader = probe.node_tree.nodes.get("Principled BSDF")
    for socket in ("Base Color", "Roughness", "Metallic", "Coat Weight",
                   "Coat Roughness", "Emission Color", "Emission Strength"):
        if socket not in shader.inputs:
            raise RuntimeError(f"Missing Principled socket {socket}")
    bpy.data.materials.remove(probe)


def finish(name, color, roughness, metallic=0, coat=0, emission=None):
    material = bpy.data.materials.new(name)
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    shader.inputs["Coat Weight"].default_value = coat
    shader.inputs["Coat Roughness"].default_value = .07
    if emission:
        shader.inputs["Emission Color"].default_value = (*emission, 1)
        shader.inputs["Emission Strength"].default_value = 1
    return material


def active(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def source_colours(material):
    node = material.node_tree.nodes.new("ShaderNodeVertexColor")
    node.layer_name = "source_details"
    material.node_tree.links.new(node.outputs["Color"],
                                 material.node_tree.nodes.get("Principled BSDF").inputs["Base Color"])


def triangles(obj):
    obj.data.calc_loop_triangles()
    return len(obj.data.loop_triangles)


def apply(obj, modifier):
    active(obj)
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def import_car(path, length):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise ValueError("The GLB contains no meshes")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = matrix
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = "Meshy_source_work"
    for other in list(bpy.context.scene.objects):
        if other != obj:
            bpy.data.objects.remove(other, do_unlink=True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    modifier = obj.modifiers.new("Source triangles", "TRIANGULATE")
    apply(obj, modifier)
    coordinates = np.array([vertex.co[:] for vertex in obj.data.vertices])
    low, high = coordinates.min(0), coordinates.max(0)
    # glTF import has already converted Y-up to Blender Z-up. The longest
    # horizontal extent determines the vehicle's longitudinal axis.
    if high[1] - low[1] > high[0] - low[0]:
        obj.data.transform(Matrix.Rotation(-math.pi / 2, 4, "Z"))
        coordinates = np.array([vertex.co[:] for vertex in obj.data.vertices])
        low, high = coordinates.min(0), coordinates.max(0)
    scale = length / (high[0] - low[0])
    centre = (low + high) / 2
    centre[2] = low[2]
    obj.data.transform(Matrix.Scale(scale, 4) @ Matrix.Translation(Vector(-centre)))
    obj.data.update()
    return obj


def face_samples(obj):
    mesh = obj.data
    count = len(mesh.polygons)
    ids = np.empty(count * 3, dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", ids)
    ids = ids.reshape(-1, 3)
    coordinates = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", coordinates)
    coordinates = coordinates.reshape(-1, 3)
    positions = coordinates[ids]
    centres = positions.mean(1)
    areas = np.linalg.norm(np.cross(positions[:, 1] - positions[:, 0],
                                    positions[:, 2] - positions[:, 0]), axis=1) * .5
    rgb = np.full((count, 3), .5, dtype=np.float32)
    if mesh.uv_layers.active:
        uv = np.empty(count * 3 * 2, dtype=np.float32)
        mesh.uv_layers.active.data.foreach_get("uv", uv)
        uv = uv.reshape(count, 3, 2).mean(1) % 1
    else:
        uv = None
    material_ids = np.empty(count, dtype=np.int32)
    mesh.polygons.foreach_get("material_index", material_ids)
    for i, material in enumerate(mesh.materials):
        use = material_ids == i
        shader = material.node_tree.nodes.get("Principled BSDF") if material.node_tree else None
        if not shader:
            continue
        socket = shader.inputs["Base Color"]
        rgb[use] = socket.default_value[:3]
        link = socket.links[0] if socket.is_linked else None
        if not link or link.from_node.type != "TEX_IMAGE" or uv is None:
            continue
        image = link.from_node.image
        if image is None:
            continue
        width, height = image.size
        pixels = np.empty(width * height * 4, dtype=np.float32)
        image.pixels.foreach_get(pixels)
        u, v = uv[use].T
        x = np.minimum((u * width).astype(int), width - 1)
        y = np.minimum((v * height).astype(int), height - 1)
        rgb[use] = pixels.reshape(height, width, 4)[y, x, :3]
    return ids, coordinates, centres, areas, rgb


def classify(obj):
    ids, coordinates, centres, areas, rgb = face_samples(obj)
    low, high = coordinates.min(0), coordinates.max(0)
    length, width, height = high - low
    red = (rgb[:, 0] > rgb[:, 1] * 1.4) & (rgb[:, 0] > rgb[:, 2] * 1.3) & (rgb[:, 0] > .12)
    ends = (np.abs(centres[:, 0]) > length * .34) & (centres[:, 2] > height * .28)
    rear_scores = [float(areas[red & ends & (centres[:, 0] * sign > 0)].sum()) for sign in (-1, 1)]
    rotated = rear_scores[1] > rear_scores[0] + .002
    if rotated:
        obj.data.transform(Matrix.Rotation(math.pi, 4, "Z"))
        coordinates[:, :2] *= -1
        centres[:, :2] *= -1
    orientation = "+X nose from red tail-lamp texture area" if max(rear_scores) > .002 else "+X nose fallback; texture has no clear tail lamps"
    maximum = rgb.max(1)
    saturation = (maximum - rgb.min(1)) / np.maximum(maximum, .0001)
    side = np.abs(centres[:, 1]) > width * .31
    wheel_zone = side & (centres[:, 2] < height * .40) & (np.abs(centres[:, 0]) > length * .18) & (np.abs(centres[:, 0]) < length * .43)
    window_zone = (centres[:, 2] > height * .57) & (np.abs(centres[:, 0]) < length * .34)
    useful = (centres[:, 2] > height * .20) & ~wheel_zone & ~window_zone & (np.abs(centres[:, 0]) < length * .36)
    coloured = useful & (saturation > .32) & (maximum > .11)
    if areas[coloured].sum() > areas[useful].sum() * .24:
        samples = rgb[coloured] / np.maximum(maximum[coloured, None], .001)
        bins, inverse = np.unique(np.rint(samples * 6).astype(np.int8), axis=0, return_inverse=True)
        weights = np.bincount(inverse, weights=areas[coloured])
        colour = bins[weights.argmax()] / 6
        difference = np.linalg.norm(rgb / np.maximum(maximum[:, None], .001) - colour, axis=1)
        paint = (difference < .36) & (maximum > .065) & (saturation > .12)
        method = "dominant saturated paint hue"
    elif np.median(maximum[useful]) < .21:
        paint = ~window_zone & (centres[:, 2] > height * .16)
        method = "dark paint surface mask with glass and wheel exclusion"
    else:
        paint = (saturation < .29) & (maximum > .28)
        method = "neutral bright paint mask"
    paint &= ~wheel_zone
    if areas[paint].sum() < areas.sum() * .06:
        paint = ~window_zone & ~wheel_zone & (centres[:, 2] > height * .24)
        method += "; broad body fallback"
    glass = ~paint & window_zone & (maximum < .32)
    roles = np.full(len(ids), 3, dtype=np.int32)
    roles[paint] = 0
    roles[glass] = 1
    roles[wheel_zone] = 2
    roles[wheel_zone & (maximum > .13)] = 4
    # Protect mask edges while relaxing the interiors of the painted surfaces.
    votes = np.bincount(ids.reshape(-1), weights=np.repeat(paint, 3), minlength=len(coordinates))
    totals = np.bincount(ids.reshape(-1), minlength=len(coordinates))
    vertex_rgb = np.column_stack([np.bincount(ids.reshape(-1), weights=np.repeat(rgb[:, channel], 3),
                                            minlength=len(coordinates)) / np.maximum(totals, 1)
                                  for channel in range(3)])
    colours = obj.data.color_attributes.new(name="source_details", type="FLOAT_COLOR", domain="POINT")
    rgba = np.column_stack((vertex_rgb, np.ones(len(vertex_rgb))))
    colours.data.foreach_set("color", rgba.astype(np.float32).reshape(-1))
    group = obj.vertex_groups.new(name="Paint interior")
    interior = np.flatnonzero(votes >= np.maximum(3, totals)).tolist()
    if interior:
        group.add(interior, 1, "REPLACE")
    obj.data.materials.clear()
    for material in (finish("Meshy paint mask", (.78, .77, .73), .20, .22, 1),
                     finish("Meshy dark glass", (.004, .006, .01), .11, .12, 1),
                     finish("Meshy rubber and wheels", (1, 1, 1), .70, .05),
                     finish("Meshy black trim", (1, 1, 1), .3, .12),
                     finish("Meshy alloy", (1, 1, 1), .22, .65, 1)):
        obj.data.materials.append(material)
    for index in (2, 3, 4):
        source_colours(obj.data.materials[index])
    obj.data.polygons.foreach_set("material_index", roles)
    if interior:
        modifier = obj.modifiers.new("Paint surface relaxation", "SMOOTH")
        modifier.vertex_group = group.name
        modifier.factor = .24
        modifier.iterations = 3
        apply(obj, modifier)
    print(f"  Orientation: {orientation}; reversed source = {rotated}", flush=True)
    print(f"  Paint: {method}; {float(areas[paint].sum() / max(areas.sum(), .001)):.1%} of surface", flush=True)
    return {"orientation": orientation, "reversed": rotated, "paintMask": method,
            "size": [float(length), float(width), float(height)]}


def reduce(obj, budget):
    for _ in range(3):
        count = triangles(obj)
        if count <= budget:
            break
        modifier = obj.modifiers.new("Budget reduction", "DECIMATE")
        modifier.ratio = min(.999, budget / count * .985)
        modifier.use_collapse_triangulate = True
        apply(obj, modifier)
    if triangles(obj) > budget:
        raise ValueError(f"Reduction failed: {triangles(obj)} > {budget}")
    for face in obj.data.polygons:
        face.use_smooth = True


def split(obj, kind):
    root = bpy.data.objects.new(kind, None)
    bpy.context.collection.objects.link(root)
    mesh = obj.data
    mesh.calc_loop_triangles()
    coordinates = np.array([vertex.co[:] for vertex in mesh.vertices])
    faces = np.array([tuple(face.vertices) for face in mesh.loop_triangles])
    slots = np.array([mesh.polygons[face.polygon_index].material_index for face in mesh.loop_triangles])
    colours = np.empty(len(mesh.vertices) * 4, dtype=np.float32)
    mesh.color_attributes["source_details"].data.foreach_get("color", colours)
    colours = colours.reshape(-1, 4)
    for index, role in enumerate(ROLES):
        chosen = faces[slots == index]
        if not len(chosen):
            continue
        used, remapped = np.unique(chosen, return_inverse=True)
        data = bpy.data.meshes.new(kind + "_" + role)
        data.from_pydata(coordinates[used].tolist(), [], remapped.reshape(-1, 3).tolist())
        data.materials.append(mesh.materials[index])
        if index >= 2:
            attr = data.color_attributes.new(name="source_details", type="FLOAT_COLOR", domain="POINT")
            attr.data.foreach_set("color", colours[used].reshape(-1))
        data.update()
        for face in data.polygons:
            face.use_smooth = True
        child = bpy.data.objects.new(kind + "_" + role, data)
        bpy.context.collection.objects.link(child)
        child.parent = root
    bpy.data.objects.remove(obj, do_unlink=True)
    return root


def box(name, position, size, material, parent):
    x, y, z = position
    a, b, c = (value / 2 for value in size)
    vertices = [(x + sx * a, y + sy * b, z + sz * c)
                for sx, sy, sz in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                                   (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5), (3, 0, 4, 7)]
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.materials.append(material)
    child = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(child)
    child.parent = parent
    return child


def lamps(root, kind, size):
    length, width, height = size
    for role, colour in LIGHTS.items():
        front = role == "lights_head"
        material = finish(kind + "_" + role, colour, .19, .10, .5, colour)
        pair = []
        for side in (-1, 1):
            pair.append(box(role + ("_L" if side < 0 else "_R"),
                ((.491 if front else -.491) * length, side * width * .31,
                 height * (.44 if front else .49 if role == "lights_tail" else .54)),
                (.035, width * .19, .045 if role == "lights_brake" else .065), material, root))
        active(pair[0])
        pair[1].select_set(True)
        bpy.ops.object.join()
        pair[0].name = kind + "_" + role


def export(root, path):
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for child in root.children_recursive:
        child.select_set(True)
    count = sum(triangles(obj) for obj in root.children_recursive if obj.type == "MESH")
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", export_yup=True,
                              export_animations=False, use_selection=True)
    raw = path.read_bytes()
    json_size = struct.unpack_from("<I", raw, 12)[0]
    doc = json.loads(raw[20:20 + json_size])
    names = {node.get("name") for node in doc["nodes"]}
    expected = {root.name + "_body", *(root.name + "_" + role for role in LIGHTS)}
    if not expected <= names:
        raise ValueError(f"Export lost expected nodes: {expected - names}")
    serialized = sum(doc["accessors"][primitive["indices"]]["count"] // 3
                     for mesh in doc["meshes"] for primitive in mesh["primitives"])
    if serialized != count:
        raise ValueError(f"Export triangle count changed: {serialized} != {count}")
    print(f"  {count:,} triangles -> {path}", flush=True)
    return count


def process(path, index, config):
    started = time.perf_counter()
    value = config.get(path.name, config.get(path.stem, 4.6))
    length = float(value.get("length", 4.6) if isinstance(value, dict) else value)
    if not math.isfinite(length) or length <= 0:
        raise ValueError(f"Invalid vehicle length {length}")
    kind = REPLACEMENTS[index % len(REPLACEMENTS)]
    slug = re.sub(r"[^a-z0-9_-]+", "-", path.stem.lower()).strip("-") or "car"
    # Prefix the ordinal so different Unicode names never overwrite one another.
    stem = f"{index + 1:02d}-{slug}"
    print(f"{path.name} -> replaces {kind}, body length {length:.3f} m", flush=True)
    source = import_car(path, length)
    original_count = triangles(source)
    print(f"  Source {original_count:,} triangles", flush=True)
    analysis = classify(source)
    reduce(source, 11800)
    far = source.copy()
    far.data = source.data.copy()
    bpy.context.collection.objects.link(far)
    reduce(far, 1380)
    near_root = split(source, kind)
    lamps(near_root, kind, analysis["size"])
    near_path = OUTPUT / (stem + ".glb")
    near_count = export(near_root, near_path)
    for obj in [*near_root.children_recursive, near_root]:
        bpy.data.objects.remove(obj, do_unlink=True)
    far_root = split(far, kind)
    lamps(far_root, kind, analysis["size"])
    far_path = OUTPUT / (stem + "_far.glb")
    far_count = export(far_root, far_path)
    if near_count > 12000 or far_count > 1500:
        raise ValueError(f"Export budgets exceeded: {near_count} / {far_count}")
    nodes = {role: kind + "_" + role for role in (*ROLES, *LIGHTS)}
    nodes["lenses"] = kind + "_lenses"
    result = {"source": path.name, "replaces": kind,
              "file": near_path.relative_to(OUTPUT.parent).as_posix(),
              "far": far_path.relative_to(OUTPUT.parent).as_posix(),
              "nodes": nodes, "length": length, "triangles": near_count,
              "farTriangles": far_count, "sourceTriangles": original_count, **analysis}
    print(f"  Finished in {time.perf_counter() - started:.1f} s", flush=True)
    return result


def main():
    api_check()
    OUTPUT.mkdir(parents=True, exist_ok=True)
    inputs = sorted(SOURCE.glob("*.glb"), key=lambda path: path.name.casefold())
    config = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}
    result = {"units": "metres", "axes": {"forward": "+X", "up": "+Y", "left": "-Z"},
              "origin": "ground under bounding-box centre", "vehicles": [], "failed": [],
              "notes": ["Paint, glass and wheel masks are inferred from colour and position.",
                        "Nose direction is inferred from red tail-lamp texture area; ambiguous inputs use +X.",
                        "Runtime uniformly fits oversized cars to the replaced pack collision rectangle."]}
    for index, path in enumerate(inputs):
        try:
            result["vehicles"].append(process(path, index, config))
        except Exception as error:
            print(f"  FAILED {path.name}: {error}", flush=True)
            result["failed"].append({"file": path.name, "error": str(error)})
    MANIFEST.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    if not inputs:
        print(f"No Meshy GLBs in {SOURCE}; 0 triangles exported. Empty manifest written cleanly.")
    print(f"Processed {len(result['vehicles'])}/{len(inputs)} cars; {len(result['failed'])} failed.")
    print(f"Manifest: {MANIFEST}\nModels: {OUTPUT}", flush=True)
    if result["failed"]:
        raise RuntimeError("Some cars failed; see cars_meshy.json for successful outputs and failure details")


if __name__ == "__main__":
    main()
