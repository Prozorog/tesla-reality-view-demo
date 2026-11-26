"""Re-import the shipping GLB and render the T4 contact sheet in background Cycles."""
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import time

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
HELPERS = Path(__file__).resolve().parent / "cars"
sys.path.insert(0, str(HELPERS))
from catalog import MODELS, PROJECT, WORK


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def scene_setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(MODELS / "cars.glb"))
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.render.threads_mode = "FIXED"
    sc.render.threads = 4
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.compute_device_type = "OPTIX"
    prefs.refresh_devices()
    gpus = [d for d in prefs.devices if d.type == "OPTIX"]
    for d in prefs.devices:
        d.use = d in gpus
    sc.cycles.device = "GPU" if gpus else "CPU"
    print("Cycles:", ", ".join(d.name for d in gpus) or "CPU (4 threads)")
    sc.cycles.seed = 7
    sc.cycles.samples = 32
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
    sc.view_settings.view_transform = "AgX"
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.world = bpy.data.worlds.new("Studio environment")
    world = sc.world.node_tree.nodes.get("Background")
    world.inputs["Color"].default_value = (.70, .78, .94, 1)
    world.inputs["Strength"].default_value = .32
    bpy.ops.object.camera_add()
    sc.camera = bpy.context.object
    sc.camera.data.type = "ORTHO"
    bpy.ops.mesh.primitive_plane_add(size=200)
    floor = bpy.context.object
    mat = bpy.data.materials.new("Review ground")
    p = mat.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = (.09, .098, .11, 1)
    p.inputs["Roughness"].default_value = .68
    floor.data.materials.append(mat)
    return sc, p


def light(name, position, target, power, rgb, width, height):
    data = bpy.data.lights.new(name, "AREA")
    data.shape = "RECTANGLE"
    data.size, data.size_y = width, height
    data.energy, data.color = power, rgb
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = position
    aim(obj, target)
    return obj


def place(root, x, y, angle):
    root.location = (x, y, 0)
    root.rotation_mode = "XYZ"
    root.rotation_euler.z = math.radians(angle)


def visible(root, show):
    for obj in root.children_recursive:
        obj.hide_render = not show


def render(sc, path, width, height, scale, position, target, overhead=False):
    cam = sc.camera
    cam.location = position
    if overhead:
        cam.rotation_euler = (0, 0, 0)
    else:
        aim(cam, target)
    cam.data.ortho_scale = scale
    sc.render.resolution_x, sc.render.resolution_y = width, height
    sc.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def paint(mat, variant):
    shader = mat.node_tree.nodes.get("Principled BSDF")
    node = shader.inputs["Base Color"].links[0].from_node
    assert node.type == "TEX_IMAGE"
    node.image = bpy.data.images.load(str(MODELS / variant["map"]), check_existing=True)


def variant_copy(original, variant, body_name):
    root = bpy.data.objects.new("Review " + variant["color"], None)
    bpy.context.collection.objects.link(root)
    for source in original.children:
        child = source.copy()
        bpy.context.collection.objects.link(child)
        child.parent = root
        if source.name == body_name:
            # Object-linked slot keeps the production mesh shared between variants.
            slot = child.material_slots[0]
            mat = slot.material.copy()
            slot.link = "OBJECT"
            slot.material = mat
            paint(mat, variant)
    return root


def pool(root, pos, role):
    front = role == "head"
    local = Vector((pos[0], -pos[2], pos[1]))
    direction = Vector((1, 0, -.23) if front else (-1, 0, -.52))
    local.x += .09 if front else -.08
    data = bpy.data.lights.new(role + " pool", "SPOT")
    data.energy = 85 if front else 16
    data.color = (1, .87, .70) if front else (1, .011, .006)
    data.spot_size = math.radians(56 if front else 75)
    data.spot_blend = .77
    data.shadow_soft_size = .085
    obj = bpy.data.objects.new(data.name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent, obj.location = root, local
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def night_scene(sc, floor, roots, types):
    bg = sc.world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (.22, .31, .59, 1)
    bg.inputs["Strength"].default_value = .13
    floor.inputs["Base Color"].default_value = (.052, .041, .035, 1)
    floor.inputs["Roughness"].default_value = .64
    # Park two cars facing opposite directions so both ends can be read at once.
    for kind, x, y, yaw in [("sedan", -2.75, .25, -52), ("minivan", 2.35, .32, 132)]:
        root, spec = roots[kind], types[kind]
        visible(root, True)
        place(root, x, y, yaw)
        for role, strength in (("head", 7.5), ("tail", 3.8)):
            node = bpy.data.objects[spec["nodes"]["lights_" + role]]
            p = node.active_material.node_tree.nodes.get("Principled BSDF")
            p.inputs["Emission Strength"].default_value = strength
            for pos in spec["lightPositions"][role]:
                pool(root, pos, role)
    light("Parking lamp", (-1, 2, 7), (-1, 0, 0), 480, (1, .69, .41), 1.4, 1.0)
    light("Storefront reflection", (1, 6, 3.7), (0, 0, .7), 320, (1, .62, .37), 8, .85)
    light("Sky fill", (-3, -5, 5), (0, 0, .5), 200, (.52, .65, 1), 6, 3)
    stripe = bpy.data.materials.new("Parking stripe")
    stripe.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (.34, .30, .245, 1)
    for x in (-5.5, 0, 5.5):
        bpy.ops.mesh.primitive_plane_add(size=1, location=(x, .9, .003))
        obj = bpy.context.object
        obj.scale = (.065, 6.8, 1)
        obj.rotation_euler.z = math.radians(38)
        obj.data.materials.append(stripe)


def main():
    start = time.perf_counter()
    types = json.loads((MODELS / "cars.json").read_text(encoding="utf-8"))["types"]
    sc, floor = scene_setup()
    roots = {name: bpy.data.objects[spec["nodes"]["root"]] for name, spec in types.items()}
    rig = [
        light("Softbox", (0, -4, 6), (0, 0, .3), 3700, (.99, .95, .88), 55, 3.7),
        light("Rear strip", (0, 3.8, 5.5), (0, 0, .6), 3100, (.81, .88, 1), 55, 1.5),
    ]
    for i, root in enumerate(roots.values()):
        place(root, (i - 4) * 5.55, 0, -34)
    with tempfile.TemporaryDirectory(dir=WORK) as temp:
        folder = Path(temp)
        render(sc, folder / "lineup.png", 1536, 168, 9 * 5.55, (0, -8, 6.7), (0, 0, .61))
        for root in roots.values():
            root.rotation_euler.z = math.radians(90)
        render(sc, folder / "top.png", 1536, 180, 9 * 5.55, (0, 0, 14), (0, 0, 0), overhead=True)
        for root in roots.values():
            visible(root, False)
        sedans = []
        for i, variant in enumerate(types["sedan"]["variants"]):
            root = variant_copy(roots["sedan"], variant, types["sedan"]["nodes"]["body"])
            place(root, (i - 1.5) * 5.55, 0, -34)
            visible(root, True)
            sedans.append(root)
        render(sc, folder / "variants.png", 840, 188, 4 * 5.55, (0, -9, 5.7), (0, 0, .63))
        for root in sedans:
            visible(root, False)
        for obj in rig:
            obj.hide_render = True
        night_scene(sc, floor, roots, types)
        sc.cycles.samples = 48
        render(sc, folder / "night.png", 672, 246, 11.65, (0, -10, 6.4), (0, .1, .52))
        subprocess.run(["python", "-B", str(HELPERS / "sheet.py"), str(folder)], check=True)
    print(f"{PROJECT / 'renders/cars/sheet.jpg'} | {sum(s['triangles'] for s in types.values())} "
          f"triangles | render and layout {time.perf_counter() - start:.1f} s")


if __name__ == "__main__":
    main()
