"""Phase 1.2/1.3 source-surface Model S conversion and five-view silhouette proof."""
import json
import math
import os
import shutil
import subprocess
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

ROOT = Path(__file__).resolve().parents[1]
REF = Path(os.environ.get("TESLA_REF_DIR", ROOT.parent / "ref"))
SOURCE = Path(os.environ.get("TESLA_MESHY_SOURCE", REF / "Meshy_AI_White_Tesla_Model_S_Collage_20261123_texture.glb"))
OUT = ROOT / "public/models"
WORK = ROOT / "tmp/meshy-hero"
VIEWS = ROOT / "renders/hero"
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "scripts"))
from build_hero import read_glb
from model3.mesh import finish

AXLE_SOURCE = (.5419, -.5952)
TRACK = 1.652
POSITION_SHIFT = 10.0
MAIN_TARGET = 143000
GLASS_NORMAL_RADIUS, GLASS_CONE = .12, 40
BODY_WEIGHT, BUMPER_WEIGHT, WEIGHT_FACTOR = .5, .8, .2
VIEWS_AND_CAMERAS = (
    ("front", (11.5, 0, 1.2), (2.2, 0, .65), 3.2),
    ("rear", (-9, 0, 1.25), (.2, 0, .70), 3.2),
    ("side", (1.35, -10, .85), (1.35, 0, .74), 5.5),
    ("top", (1.35, 0, 10), (1.35, 0, .5), 5.5),
    ("quarter", (-4, -6.6, 5), (1.25, 0, .7), 5.25),
)


def select(obj, *others):
    bpy.ops.object.select_all(action="DESELECT")
    for item in (obj, *others):
        item.select_set(True)
    bpy.context.view_layer.objects.active = obj


def xyz(mesh):
    points = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", points)
    return points.reshape(-1, 3)


def face_arrays(mesh):
    ids = np.empty(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", ids)
    uv = np.empty(len(mesh.loops) * 2, dtype=np.float32)
    mesh.uv_layers.active.data.foreach_get("uv", uv)
    normals = np.empty(len(mesh.loops) * 3, dtype=np.float32)
    mesh.corner_normals.foreach_get("vector", normals)
    return ids.reshape(-1, 3), uv.reshape(-1, 3, 2), normals.reshape(-1, 3, 3)


def image_pixels(image):
    w, h = image.size
    raw = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(raw)
    return raw.reshape(h, w, 4)


def sample(image, uv):
    h, w, _ = image.shape
    x = np.clip((uv[:, 0] * w).astype(int), 0, w - 1)
    y = np.clip((uv[:, 1] * h).astype(int), 0, h - 1)
    return image[y, x, :3]


def source_mesh():
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    obj = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH")
    select(obj)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    points = xyz(obj.data)
    scale = 4.72 / np.ptp(points[:, 0])
    obj.data.transform(Matrix(((-scale, 0, 0, AXLE_SOURCE[0] * scale), (0, -scale, 0, 0),
                               (0, 0, scale, -float(points[:, 2].min()) * scale), (0, 0, 0, 1))))
    obj.name = "Untouched Meshy"
    print(f"SOURCE {len(obj.data.polygons):,} triangles, scale {scale:.8f}", flush=True)
    return obj, float(scale)


def decimation_weights(points, slots):
    """Collapse weights: wheels decimate freely, the body keeps more, the lower rear bumper most."""
    x, y, z = points.T
    wheel = np.zeros(len(points), dtype=bool)
    for _, (a, _, c) in slots:
        wheel |= (np.hypot(x - a, z - c) < .43) & (abs(y) > .55)
    bumper = (x < -.45) & (z < .62) & ~wheel
    return {BUMPER_WEIGHT: np.flatnonzero(bumper), BODY_WEIGHT: np.flatnonzero(~bumper & ~wheel)}


def reduce(source, target, label, weights=None):
    obj = source.copy()
    obj.data = source.data.copy()
    bpy.context.collection.objects.link(obj)
    obj.name = label
    select(obj)
    decimate = obj.modifiers.new("Source surface collapse", "DECIMATE")
    decimate.ratio = target / len(source.data.polygons)
    decimate.use_collapse_triangulate = True
    if weights:
        group = obj.vertex_groups.new(name="Keep detail")
        for weight, indices in weights.items():
            group.add(indices.tolist(), weight, "REPLACE")
        # Inverted: weight 1 resists collapse, unweighted (wheel) vertices collapse first.
        decimate.vertex_group = group.name
        decimate.invert_vertex_group = True
        decimate.vertex_group_factor = WEIGHT_FACTOR
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    print(f"{label}: {len(obj.data.polygons):,} source triangles", flush=True)
    return obj


def optix(scene):
    scene.render.engine = "CYCLES"
    scene.render.threads_mode = "FIXED"
    scene.render.threads = 4
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.refresh_devices()
    for device in prefs.devices:
        device.use = device.type == "OPTIX" and "4070" in device.name
    if not any(device.use for device in prefs.devices):
        raise RuntimeError("RTX 4070 OptiX device unavailable")
    scene.cycles.device = "GPU"


def bake_normals(source, low, scene):
    supported = bpy.ops.object.bake.get_rna_type().properties
    names = ("use_selected_to_active", "cage_extrusion", "max_ray_distance", "normal_space", "margin_type")
    assert all(name in supported for name in names)
    temp = source.data.materials[0].copy()
    low.data.materials[0] = temp
    target = bpy.data.images.new("Meshy full-detail tangent normals", 2048, 2048, alpha=False, is_data=True)
    target_node = temp.node_tree.nodes.new("ShaderNodeTexImage")
    target_node.image = target
    temp.node_tree.nodes.active = target_node
    target.generated_color = (.5, .5, 1., 1.)
    scene.cycles.samples = 1
    print("Baking tangent normals from 1,029,118 source triangles onto the decimated UV mesh", flush=True)
    select(low, source)
    result = bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", use_selected_to_active=True,
                                 cage_extrusion=.020, max_ray_distance=.055, margin=6, margin_type="EXTEND",
                                 use_clear=False)
    assert "FINISHED" in result
    target.filepath_raw = str(WORK / "normal.png")
    target.file_format = "PNG"
    target.save()
    target.pack()
    print(f"OUTPUT {target.filepath_raw}", flush=True)
    return target


def bake_positions(source, scene):
    """Bake the source surface position of every atlas texel (unbaked texels stay zero)."""
    original = source.data.materials[0]
    temp = bpy.data.materials.new("Atlas texel positions")
    temp.use_nodes = True
    nodes, links = temp.node_tree.nodes, temp.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    geometry = nodes.new("ShaderNodeNewGeometry")
    shift = nodes.new("ShaderNodeVectorMath")
    shift.operation = "ADD"
    shift.inputs[1].default_value = (POSITION_SHIFT,) * 3
    emission = nodes.new("ShaderNodeEmission")
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(geometry.outputs["Position"], shift.inputs[0])
    links.new(shift.outputs["Vector"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    target = bpy.data.images.new("Atlas texel positions", 2048, 2048, alpha=True, float_buffer=True, is_data=True)
    target.generated_color = (0, 0, 0, 0)
    node = nodes.new("ShaderNodeTexImage")
    node.image = target
    nodes.active = node
    source.data.materials[0] = temp
    scene.cycles.samples = 1
    select(source)
    result = bpy.ops.object.bake(type="EMIT", margin=0, use_clear=True)
    assert "FINISHED" in result
    source.data.materials[0] = original
    pixels = image_pixels(target)[:, :, :3]
    # Blender rows run bottom-up; flip to the PIL row order used by the atlas script.
    np.save(WORK / "positions.npy", np.ascontiguousarray(pixels[::-1]).astype(np.float32))
    bpy.data.images.remove(target)
    bpy.data.materials.remove(temp)
    print(f"OUTPUT {WORK / 'positions.npy'}", flush=True)


def wheel_slots(wheelbase, radius):
    return [(f"wheel_{axle}{side}", (x, sign * TRACK / 2, radius))
            for axle, x in (("F", wheelbase), ("R", 0)) for side, sign in (("L", 1), ("R", -1))]


def roles(points, uv, base, slots):
    x, y, z = points.T
    side = abs(y)
    red, green, blue = sample(base, uv).T
    hi = np.maximum(np.maximum(red, green), blue)
    lo = np.minimum(np.minimum(red, green), blue)
    radial = np.stack([np.hypot(x - a, z - c) for _, (a, b, c) in slots])
    wheel = np.stack([(side > .66) & (y * b > 0) & (rr < .415) & ((hi < .59) | (rr < .343))
                      for rr, (_, (a, b, c)) in zip(radial, slots)])
    lamp_front = (x > 2.98) & (side > .44) & (side < .865) & (z > .59 + .29 * (side - .44)) & (z < .79 + .24 * (side - .44))
    lamp_rear = (x < -.33) & (side > .39) & (z > .74) & (z < 1.06)
    fascia = ((x > 3.01) & (z < .77)) | ((x < -.74) & (z < .46))
    window_band = (x > -.82) & (x < 2.51) & (z > .94)
    glass = window_band & (hi < .40) & (side < .90) & ~lamp_front & ~lamp_rear
    label = (x < -.52) & (((side < .225) & (z > .870) & (z < .936)) |
                         ((y > .345) & (y < .565) & (z > .685) & (z < .764)))
    paint = (hi > .35) & (hi - lo < .24) & ~glass & ~lamp_front & ~lamp_rear & ~np.any(wheel, axis=0)
    source_red = is_red(red, green, blue)
    return paint, glass, wheel, label, fascia, lamp_front, lamp_rear, source_red, hi


def is_red(red, green, blue):
    return (red > .22) & (red > green * 1.38) & (red > blue * 1.28)


def caliper_faces(points, ids, uv, base, slots, wheels):
    """Red caliper faces of each wheel: at least two of centroid and corners read red."""
    centres = points[ids].mean(1)
    votes = sum(is_red(*sample(base, s).T).astype(int) for s in (uv.mean(1), uv[:, 0], uv[:, 1], uv[:, 2]))
    found = []
    for index, (_, (a, _, c)) in enumerate(slots):
        radial = np.hypot(centres[:, 0] - a, centres[:, 2] - c)
        found.append(wheels[index] & (votes >= 2) & (radial > .11) & (radial < .33))
    return np.stack(found)


def sample_mask(mask, uv):
    h, w = mask.shape
    x = np.clip((uv[:, 0] * w).astype(int), 0, w - 1)
    y = np.clip((uv[:, 1] * h).astype(int), 0, h - 1)
    return mask[y, x]


def glass_normals(mesh):
    points = xyz(mesh)
    faces = np.array([tuple(poly.vertices) for poly in mesh.polygons])
    corners = points[faces]
    cross = np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
    area = np.linalg.norm(cross, axis=1)
    unit = cross / np.maximum(area, 1e-12)[:, None]
    centres = corners.mean(1)
    own = np.zeros_like(points)
    np.add.at(own, faces.reshape(-1), np.repeat(cross, 3, axis=0))
    own /= np.maximum(np.linalg.norm(own, axis=1), 1e-12)[:, None]
    tree = KDTree(len(centres))
    for index, centre in enumerate(centres):
        tree.insert(centre.tolist(), index)
    tree.balance()
    result = own.copy()
    cone = math.cos(math.radians(GLASS_CONE))
    for vertex, (point, normal) in enumerate(zip(points, own)):
        found = np.array([index for _, index, _ in tree.find_range(point.tolist(), GLASS_NORMAL_RADIUS)], dtype=int)
        if not len(found):
            continue
        keep = found[unit[found] @ normal > cone]
        total = (unit[keep] * area[keep, None]).sum(0)
        if np.linalg.norm(total) > 0:
            result[vertex] = total / np.linalg.norm(total)
    return result


def make_part(name, mesh_data, mask, material, origin=(0, 0, 0), offset=0, own_normals=False):
    points, ids, uv, normals = mesh_data
    faces = ids[mask]
    vertex_ids, indices = np.unique(faces, return_inverse=True)
    positions = points[vertex_ids] - np.asarray(origin)
    if offset:
        found = np.zeros_like(positions)
        np.add.at(found, indices.flatten(), normals[mask].reshape(-1, 3))
        positions += offset * found / np.maximum(np.linalg.norm(found, axis=1, keepdims=True), .001)
    out = bpy.data.meshes.new(name)
    out.from_pydata(positions.tolist(), [], indices.reshape(-1, 3).tolist())
    out.materials.append(material)
    out.uv_layers.new(name="UVMap").data.foreach_set("uv", uv[mask].reshape(-1))
    out.polygons.foreach_set("use_smooth", np.ones(len(faces), dtype=bool))
    if own_normals:
        # Glass shading normals only (positions untouched): the decimated Meshy glass is
        # lumpy, and its own facet normals break every reflected light into white blobs.
        # Average this part's face normals over a hand-width patch, within a cone so the
        # B-pillar gloss and window edges keep their own direction.
        out.normals_split_custom_set_from_vertices(glass_normals(out).tolist())
    else:
        out.normals_split_custom_set(normals[mask].reshape(-1, 3).tolist())
    out.update()
    obj = bpy.data.objects.new(name, out)
    bpy.context.collection.objects.link(obj)
    obj.location = origin
    return obj


def analytic_closure(name, pieces, material):
    vertices, faces = [], []
    for centre, radial, depth, inward in pieces:
        x, y, z = centre
        count = 28
        start = len(vertices)
        for dy in (0, -inward * depth):
            vertices.extend((x + radial * math.cos(i * math.tau / count), y + dy,
                             max(.024, z + radial * math.sin(i * math.tau / count))) for i in range(count))
        faces.extend((start + i, start + (i + 1) % count, start + (i + 1) % count + count, start + i + count)
                     for i in range(count))
        faces.extend((tuple(start + i for i in reversed(range(count))), tuple(start + count + i for i in range(count))))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def shader(name, base, normal, roughness, metalness, coat, emission=None):
    mat = finish(name, "#ffffff", metalness, roughness, coat, emission, .01)
    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    mat.use_backface_culling = True
    if base:
        node = nodes.new("ShaderNodeTexImage")
        node.image = base
        mat.node_tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    if normal:
        node = nodes.new("ShaderNodeTexImage")
        node.image = normal
        tangent = nodes.new("ShaderNodeNormalMap")
        tangent.inputs["Strength"].default_value = .38 if "glass" in name.lower() else .72
        mat.node_tree.links.new(node.outputs["Color"], tangent.inputs["Color"])
        mat.node_tree.links.new(tangent.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def wordmark(source):
    surface = BVHTree.FromObject(source, bpy.context.evaluated_depsgraph_get())
    decal = bpy.data.curves.new("Clean Tesla boot lettering", "FONT")
    decal.body = "T E S L A"
    decal.align_x = "CENTER"
    decal.align_y = "CENTER"
    decal.size = .051
    decal.space_character = 1.17
    decal.extrude = .0003
    obj = bpy.data.objects.new("wordmark", decal)
    bpy.context.collection.objects.link(obj)
    obj.location = (0, 0, .902)
    obj.rotation_euler = (math.pi / 2, 0, -math.pi / 2)
    obj.data.materials.append(finish("Brushed Tesla letters", "#a4a9ad", .62, .29))
    select(obj)
    bpy.ops.object.convert(target="MESH")
    obj = bpy.context.object
    for vertex in obj.data.vertices:
        y, z = -vertex.co.x, .902 + vertex.co.y
        point, _, _, _ = surface.ray_cast(Vector((-2, y, z)), Vector((1, 0, 0)))
        if point:
            vertex.co.z += -(point.x - .005)
    return obj


def split(low, base, slots, paint_map, original_map, baked, full, glass_alpha=None, calipers=None, final=None):
    points = xyz(low.data)
    ids, uv, normals = face_arrays(low.data)
    data = (points, ids, uv, normals)
    centres = points[ids].mean(1)
    paint, glass, wheels, label, _, front, rear, red, brightness = roles(centres, uv.mean(1), base, slots)
    chosen = np.any(wheels, axis=0)
    paint |= label
    paint &= ~chosen
    if glass_alpha is not None:
        # Glass follows the smoothed atlas glass outline instead of the source texel
        # under each decimated face, so no glass face carries paint or the reverse.
        x, y, z = centres.T
        side = abs(y)
        band = (x > -.95) & (x < 2.62) & (z > .88) & (side < .875) & ~((side > .84) & (x > 1.5) & (x < 2.2))
        on_glass = band & (sample_mask(glass_alpha, uv.mean(1)) >= .5) & ~front & ~rear & ~chosen
        lifted = glass & ~on_glass
        glass = on_glass
        paint = (paint & ~on_glass) | (lifted & (sample(final, uv.mean(1)).max(1) > .35))
        # Evened white paint under a face whose source texel read grey takes the
        # paint finish too, so creases and bumper edges do not show a dull trim strip.
        tone = np.stack([sample(final, corner) for corner in (uv.mean(1), uv[:, 0], uv[:, 1], uv[:, 2])])
        white = ((tone.max(2) > .62) & (tone.max(2) - tone.min(2) < .1)).all(0)
        mirror = (side > .885) & (x > 1.57) & (x < 2.11) & (z > .95)
        promoted = white & ~paint & ~glass & ~chosen & ~front & ~rear & ~mirror
        print(f"PAINT promoted {int(promoted.sum())} white trim faces", flush=True)
        paint |= promoted
    detail_map = paint_map if full else original_map
    mats = {
        "paint": shader("Meshy pearl paint", paint_map, baked, .245, .12, 1.0),
        "glass": shader("Meshy gloss glass", detail_map, None if full else baked, .116, .18, .45),
        "detail": shader("Meshy original trim and lenses", detail_map, baked, .34, .13, 0),
        "wheel": shader("Meshy original turbine and tyre texture", paint_map if calipers is not None else original_map,
                        baked, .37, .15, 0),
        "caliper": shader("Meshy original red calipers", original_map, baked, .3, .1, 0),
        "liner": finish("Matte wheelhouse liner", "#090b0e", 0, .86),
    }
    body = make_part("body", data, paint, mats["paint"])
    objects = [body, make_part("glass", data, glass & ~chosen & ~paint, mats["glass"], own_normals=full)]
    remainder = ~paint & ~glass & ~chosen
    x, y, z = centres.T
    mirror = (abs(y) > .885) & (x > 1.57) & (x < 2.11) & (z > .95) & remainder
    objects.append(make_part("trim_black", data, remainder & ~mirror, mats["detail"]))
    objects.extend(make_part(name, data, mirror & (y * sign > 0), mats["detail"])
                   for name, sign in (("mirror_L", 1), ("mirror_R", -1)) if np.any(mirror & (y * sign > 0)))
    for index, (name, centre) in enumerate(slots):
        own = wheels[index]
        if calipers is not None:
            # Fixed to the hub: the runtime steers these with the wheel but never rolls them.
            own = own & ~calipers[index]
            objects.append(make_part(name.replace("wheel", "caliper"), data, calipers[index], mats["caliper"], centre))
        obj = make_part(name, data, own, mats["wheel"], centre)
        objects.append(obj)
        if full:
            a, b, c = centre
            sign = math.copysign(1, b)
            barrel = analytic_closure(name + "_barrel", [((0, -sign * .09, 0), .29, .02, sign)], mats["liner"])
            # The cap is local to the wheel and sits behind the retained turbine face.
            for vertex in barrel.data.vertices:
                i = vertex.index % 28
                vertex.co.z = .29 * math.sin(i * math.tau / 28)
            barrel.parent = obj
            objects.append(barrel)
    if full:
        liner = analytic_closure("Wheelhouse liners", [((a, math.copysign(.705, b), c), .401, .022, math.copysign(1, b))
                                                       for _, (a, b, c) in slots], mats["liner"])
        objects.append(liner)
        # Skin-offset emitters are cut from the same source triangles and retain
        # the original lens artwork while the existing runtime drives intensity.
        source_lamps = [
            ("lights_head", front & (brightness > .46) & (brightness < .80), "#dceeff"),
            ("lights_tail", rear & red, "#ff2839"),
            ("lights_brake", rear & red, "#ff1626"),
            ("lights_reverse", rear & ~red & (brightness > .43) & (abs(y) < .65) & (z < .93), "#e6efff"),
            ("indicators_left", front & (y > .76) & (z > .728) & (brightness > .36), "#ff9c20"),
            ("indicators_right", front & (y < -.76) & (z > .728) & (brightness > .36), "#ff9c20"),
        ]
        for i, (name, mask, color) in enumerate(source_lamps):
            assert np.any(mask), name
            objects.append(make_part(name, data, mask, shader(name, original_map, None, .23, .09, 0, color),
                                     offset=.0009 + .00025 * i))
    return objects


def export(file, objects, budget):
    select(objects[0], *objects[1:])
    scratch = WORK / file
    bpy.ops.export_scene.gltf(filepath=str(scratch), export_format="GLB", use_selection=True,
                              export_yup=True, export_animations=False, export_extras=False,
                              export_cameras=False, export_lights=False)
    doc = read_glb(scratch)
    counts = {obj["name"]: sum(doc["accessors"][p["indices"]]["count"] // 3
                              for p in doc["meshes"][obj["mesh"]]["primitives"])
              for obj in doc["nodes"] if "mesh" in obj}
    count = sum(counts.values())
    assert 0 < count <= budget, counts
    output = OUT / file
    scratch.replace(output)
    print(f"OUTPUT {output}\nTRIANGLES {count:,} {counts}", flush=True)
    return counts


def review(scene, source, parts, number):
    scene.cycles.samples = 12
    scene.cycles.use_denoising = True
    scene.cycles.seed = 17
    scene.render.film_transparent = True
    scene.render.resolution_x, scene.render.resolution_y = 1000, 670
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("Neutral studio")
    scene.world = world
    world.node_tree.nodes.get("Background").inputs["Strength"].default_value = .57
    data = bpy.data.cameras.new("Silhouette review")
    data.type = "ORTHO"
    camera = bpy.data.objects.new("Silhouette review", data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    for side in (-1, 1):
        light = bpy.data.lights.new("Studio silk", "AREA")
        light.energy, light.shape, light.size, light.size_y = 620, "RECTANGLE", 5, 2.8
        obj = bpy.data.objects.new("Studio silk", light)
        scene.collection.objects.link(obj)
        obj.location = (1.4 + 2.8 * side, -4 * side, 5)
        obj.rotation_euler = (Vector((1.4, 0, .6)) - obj.location).to_track_quat("-Z", "Y").to_euler()
    for name, location, aim, scale in VIEWS_AND_CAMERAS:
        camera.location = location
        camera.rotation_euler = (Vector(aim) - camera.location).to_track_quat("-Z", "Y").to_euler()
        data.ortho_scale = scale
        for label in ("source", "hero"):
            source.hide_render = label != "source"
            for part in parts:
                part.hide_render = label != "hero" or part.name.startswith(("lights_", "indicators_"))
            scene.render.filepath = str(VIEWS / f"p13-{number}-{label}-{name}.png")
            bpy.ops.render.render(write_still=True)
    # Caliper proof: the front-left wheel rolled by 0 and 36 degrees, caliper fixed.
    source.hide_render = True
    for part in parts:
        part.hide_render = part.name.startswith(("lights_", "indicators_"))
    wheel = next(part for part in parts if part.name == "wheel_FL")
    camera.location = wheel.location + Vector((0, 6, 0))
    camera.rotation_euler = (Vector(wheel.location) - camera.location).to_track_quat("-Z", "Y").to_euler()
    data.ortho_scale = 1.0
    scene.render.resolution_x, scene.render.resolution_y = 700, 700
    for step, angle in enumerate((0, 36)):
        wheel.rotation_euler = (0, math.radians(angle), 0)
        scene.render.filepath = str(WORK / f"caliper-roll-{step}.png")
        bpy.ops.render.render(write_still=True)
    wheel.rotation_euler = (0, 0, 0)


def main():
    number = int(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else 1
    for folder in (WORK, VIEWS):
        folder.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    source, scale = source_mesh()
    scene = bpy.context.scene
    optix(scene)
    front = (AXLE_SOURCE[0] - AXLE_SOURCE[1]) * scale
    radius = .16 * scale
    slots = wheel_slots(front, radius)
    material = source.data.materials[0]
    base_image = material.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].links[0].from_node.image
    pixels = image_pixels(base_image)
    bake_positions(source, scene)
    reduced = reduce(source, MAIN_TARGET, "Hero reduced", decimation_weights(xyz(source.data), slots))
    normal = bake_normals(source, reduced, scene)
    points = xyz(reduced.data)
    ids, uv, _ = face_arrays(reduced.data)
    paint, _, wheels, label, _, _, _, _, _ = roles(points[ids].mean(1), uv.mean(1), pixels, slots)
    calipers = caliper_faces(points, ids, uv, pixels, slots, wheels)
    print("CALIPER faces", [int(c.sum()) for c in calipers], flush=True)
    np.savez(WORK / "uv-regions.npz", paint=uv[paint & ~label], lettering=uv[label], calipers=uv[np.any(calipers, 0)])
    subprocess.run([shutil.which("python"), "-B", str(ROOT / "scripts/meshy_hero_atlas.py"), "atlas"], check=True)
    bpy.data.images.remove(normal)
    normal = bpy.data.images.load(str(WORK / "normal.png"))
    normal.colorspace_settings.name = "Non-Color"
    normal.pack()
    clean = bpy.data.images.load(str(WORK / "paint.jpg"))
    clean.pack()
    glass_alpha = np.load(WORK / "glass.npy")[::-1].astype(np.float32) / 255
    model = split(reduced, pixels, slots, clean, base_image, normal, True, glass_alpha, calipers, image_pixels(clean))
    model.append(wordmark(source))
    counts = export("hero.glb", model, 150000)
    reduced.hide_render = True
    reduced.hide_set(True)
    lod_counts = []
    for file, target, size in (("hero_lod.glb", 12830, 1024), ("hero_far.glb", 1460, 512)):
        obj = reduce(source, target, file + " reduced")
        texture = bpy.data.images.load(str(WORK / f"paint-{size}.jpg"))
        texture.pack()
        lod = split(obj, pixels, slots, texture, texture, None, False)
        lod_counts.append(sum(export(file, lod, 13000 if size == 1024 else 1500).values()))
        for item in [obj, *lod]:
            bpy.data.objects.remove(item, do_unlink=True)
    bounds = xyz(source.data)
    low, high = bounds.min(0), bounds.max(0)
    metadata = {
        "source": SOURCE.name, "uniform_scale": scale, "units": "metres", "gltf_mapping": "(x,z,-y)",
        "source_triangles": len(source.data.polygons), "triangles": counts, "total_triangles": sum(counts.values()),
        "lod_triangles": lod_counts[0], "far_triangles": lod_counts[1],
        "bounding_box": {"min": low.tolist(), "max": high.tolist(), "size": (high - low).tolist(), "body_width": 1.885},
        "stations": {"front_bumper": float(high[0]), "rear_bumper": float(low[0]), "trunk_lip": [-.89, 0, 1.034]},
        "wheel_centres": dict(slots), "wheel_radius": radius, "wheelbase": front, "track": TRACK,
    }
    (OUT / "hero.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(f"OUTPUT {OUT / 'hero.json'}", flush=True)
    review(scene, source, model, number)
    subprocess.run([shutil.which("python"), "-B", str(ROOT / "scripts/meshy_hero_atlas.py"), str(number)], check=True)


if __name__ == "__main__":
    main()
