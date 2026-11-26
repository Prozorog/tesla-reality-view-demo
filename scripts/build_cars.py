"""Build the nine traffic vehicles from the read-only Comrade1280 FBX pack."""
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import time

import bpy

sys.dont_write_bytecode = True
HELPERS = Path(__file__).resolve().parent / "cars"
sys.path.insert(0, str(HELPERS))
from catalog import CARS, MODELS, PALETTE, SOURCE, TEXTURES, WORK, texture_prefix
from geometry import extract, lamp_centres, make_mesh

CREDIT = "Generic passenger car pack by Comrade1280, CC BY. Adapted for this project."
PACK_URL = "https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5"
LIGHT_COLORS = {
    "lights_head": (1., .87, .70), "lights_tail": (1., .013, .009),
    "lights_brake": (1., .019, .011),
}


def stage_inputs():
    src = WORK / "textures"
    src.mkdir(parents=True, exist_ok=True)
    files = {"lights.jpg"}
    for kind, (_, diffuse, wheel, _) in CARS.items():
        files.update([diffuse + ".png", wheel + "_Diffuse.png"])
        for prefix in (texture_prefix(kind), wheel):
            files.update(prefix + suffix for suffix in ("_Metallic.png", "_Glossiness.png"))
    copies = [(SOURCE / "source" / "fab.fbx", WORK / "fab.fbx")]
    copies.extend((SOURCE / "textures" / f, src / f) for f in sorted(files))
    for origin, dest in copies:
        if not dest.exists():
            shutil.copyfile(origin, dest)
    subprocess.run(["python", "-B", str(HELPERS / "textures.py")], check=True)


def principled(name, roughness):
    mat = bpy.data.materials.new(name)
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Roughness"].default_value = roughness
    return mat, shader


def image_node(mat, filename, data=False):
    image = bpy.data.images.load(str(TEXTURES / filename), check_existing=True)
    if data:
        image.colorspace_settings.name = "Non-Color"
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    return node


def textured(name, color_file, mr_file):
    mat, p = principled(name, .3)
    link = mat.node_tree.links.new
    color = image_node(mat, color_file)
    link(color.outputs["Color"], p.inputs["Base Color"])
    mr = image_node(mat, mr_file, data=True)
    split = mat.node_tree.nodes.new("ShaderNodeSeparateColor")
    link(mr.outputs["Color"], split.inputs["Color"])
    link(split.outputs["Green"], p.inputs["Roughness"])
    link(split.outputs["Blue"], p.inputs["Metallic"])
    return mat


def lens_material(name, role=None):
    mat, p = principled(name, .23)
    mat.node_tree.links.new(image_node(mat, "lenses.jpg").outputs["Color"], p.inputs["Base Color"])
    if role:
        # Export colour and mask at unit gain. Set the initial glTF strength
        # to zero after export so three.js can switch it on with intensity alone.
        tex = image_node(mat, "lens_emission.jpg")
        mat.node_tree.links.new(tex.outputs["Color"], p.inputs["Emission Color"])
        p.inputs["Emission Strength"].default_value = 1
    return mat


def build_type(kind, body, wheels, wheel_mat, glass, lenses):
    length, _, wheel, colors = CARS[kind]
    groups, size, wheelbase = extract(kind, length, body, wheels)
    variants = [{"color": c, "map": f"textures/cars/{kind}_{c}.jpg"} for c in colors]
    mr = f"{kind}_mr.webp"
    materials = {
        "body": textured(kind + "_paint", Path(variants[0]["map"]).name, mr),
        "glass": glass, "lenses": lenses, "wheels": wheel_mat,
    }
    for key in LIGHT_COLORS:
        materials[key] = lens_material(f"{kind}_{key}", key)
    root = bpy.data.objects.new(kind, None)
    bpy.context.collection.objects.link(root)
    nodes = {"root": root.name}
    count = 0
    for key, triangles in groups.items():
        obj = make_mesh(root, key, triangles, materials[key])
        nodes[key] = obj.name
        count += len(obj.data.polygons)
    lights = {key.removeprefix("lights_"): lamp_centres(groups[key]) for key in LIGHT_COLORS}
    return {
        "length": round(size.x, 5), "width": round(size.y, 5), "height": round(size.z, 5),
        "wheelbase": round(wheelbase, 5), "nodes": nodes, "triangles": count,
        "variants": variants, "roughnessMap": "textures/cars/" + mr,
        "metallicMap": "textures/cars/" + mr, "lightPositions": lights,
        "wheelMap": f"textures/cars/{wheel.lower()}.jpg",
        "wheelMetallicRoughnessMap": f"textures/cars/{wheel.lower()}_mr.webp",
    }


def finish_glb(path, manifest):
    """Verify the serialized scene and set independent lamp gains initially off."""
    data = path.read_bytes()
    json_size = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + json_size])
    binary_chunk = data[20 + json_size:]
    nodes = doc["nodes"]
    roots = doc["scenes"][doc["scene"]]["nodes"]
    assert {nodes[i]["name"] for i in roots} == set(CARS) and len(roots) == 9
    accessors = doc["accessors"]
    used_meshes = set()
    for i in roots:
        root = nodes[i]
        kind = root["name"]
        spec = manifest["types"][kind]
        children = {nodes[c]["name"]: nodes[c] for c in root["children"]}
        assert set(children) == set(spec["nodes"].values()) - {kind}
        assert all(kind + "_" + key in children for key in ("body", "wheels", *LIGHT_COLORS))
        bounds = []
        count = 0
        for n in [root, *children.values()]:
            assert not set(n).intersection(("matrix", "translation", "scale", "rotation")), n
        for name, node in children.items():
            assert node["mesh"] not in used_meshes
            used_meshes.add(node["mesh"])
            primitives = doc["meshes"][node["mesh"]]["primitives"]
            assert len(primitives) == 1
            p = primitives[0]
            assert p.get("mode", 4) == 4
            a = accessors[p["attributes"]["POSITION"]]
            bounds.append((a["min"], a["max"]))
            count += accessors[p["indices"]]["count"] // 3
            mat = doc["materials"][p["material"]]
            if name.endswith(("_wheels", "_body")):
                pbr = mat["pbrMetallicRoughness"]
                assert "baseColorTexture" in pbr and "metallicRoughnessTexture" in pbr
            if name.endswith("_wheels"):
                assert abs(a["min"][1]) < .0001
            if name in [spec["nodes"][k] for k in LIGHT_COLORS]:
                assert mat["name"] == name and "emissiveTexture" in mat
                mat["emissiveFactor"] = LIGHT_COLORS[name.removeprefix(kind + "_")]
                mat.setdefault("extensions", {})["KHR_materials_emissive_strength"] = {"emissiveStrength": 0}
        low = [min(b[0][axis] for b in bounds) for axis in range(3)]
        high = [max(b[1][axis] for b in bounds) for axis in range(3)]
        assert abs(high[0] - low[0] - CARS[kind][0]) < .0001
        assert abs(low[1]) < .0001 and max(abs(low[j] + high[j]) for j in (0, 2)) < .0001
        for axis, key in enumerate(("length", "height", "width")):
            assert abs(high[axis] - low[axis] - spec[key]) < .0001
        assert spec["triangles"] == count, (kind, count, spec["triangles"])
        print(f"{kind:10} {count:5} triangles   {spec['length']:.3f} x "
              f"{spec['width']:.3f} x {spec['height']:.3f} m")
        for role, pair in spec["lightPositions"].items():
            assert pair[0][2] < 0 < pair[1][2]
            assert all((p[0] if role == "head" else -p[0]) > .25 * spec["length"] for p in pair)
    assert len(used_meshes) == len(doc["meshes"])
    used = doc.setdefault("extensionsUsed", [])
    if "KHR_materials_emissive_strength" not in used:
        used.append("KHR_materials_emissive_strength")
    encoded = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    encoded += b" " * (-len(encoded) % 4)
    path.write_bytes(struct.pack("<4sIII4s", b"glTF", 2, 20 + len(encoded) + len(binary_chunk),
                                 len(encoded), b"JSON") + encoded + binary_chunk)


def main():
    start = time.perf_counter()
    stage_inputs()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=str(WORK / "fab.fbx"), use_image_search=False)
    imported = list(bpy.context.scene.objects)
    bodies = {o.name.lower().split()[0]: o for o in imported if o.name.lower().endswith(" body")}
    assert set(bodies) == set(CARS) | {"sport"}
    origins = [o for o in imported if o.name.lower().startswith("wheel_")]
    glass, shader = principled("traffic_glass", .115)
    shader.inputs["Base Color"].default_value = (.006, .008, .012, 1)
    shader.inputs["IOR"].default_value = 1.50
    lenses = lens_material("traffic_unlit_lenses")
    wheel_mats = {}
    manifest = {
        "units": "metres", "axes": {"forward": "+X", "up": "+Y", "left": "-Z"},
        "origin": "ground under bounding-box centre",
        "lightPositionOrder": ["left", "right"], "materialChannels": {"roughness": "G", "metallic": "B"},
        "palette": {k: "#" + v for k, v in PALETTE.items()}, "credit": CREDIT,
        "source": PACK_URL, "types": {},
    }
    for kind, (_, _, wheel, _) in CARS.items():
        body = bodies[kind]
        wheels = [o for o in origins if o.material_slots[0].material == body.material_slots[0].material]
        assert len(wheels) == 4
        if wheel not in wheel_mats:
            wheel_mats[wheel] = textured(wheel.lower() + "_rubber_alloy", wheel.lower() + ".jpg",
                                         wheel.lower() + "_mr.webp")
        manifest["types"][kind] = build_type(kind, body, wheels, wheel_mats[wheel], glass, lenses)
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    out = WORK / "cars.glb"
    bpy.ops.export_scene.gltf(filepath=str(out), export_format="GLB", export_yup=True,
                              export_animations=False, export_copyright=CREDIT)
    finish_glb(out, manifest)
    glb = MODELS / "cars.glb"
    out.replace(glb)
    manifest_path = MODELS / "cars.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Verified nine roots, dimensions, ground contact, PBR, lamp nodes and triangle counts.\n"
          f"{glb}\n{manifest_path}\n{TEXTURES}\nBuild: {time.perf_counter() - start:.1f} s")


if __name__ == "__main__":
    main()
