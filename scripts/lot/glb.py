"""Keep Blender's original relative image URIs as the sole glTF image source."""
import json
import struct


def external_images(path):
    data=path.read_bytes()
    size,tag=struct.unpack_from("<I4s",data,12)
    assert tag==b"JSON"
    doc=json.loads(data[20:20+size])
    for image in doc.get("images",[]):
        if "uri" in image:
            assert (path.parent/image["uri"]).is_file()
            # Blender 5.2 keep_originals writes both a URI and a tiny fallback image.
            # glTF permits exactly one image source. The runtime must load the original.
            image.pop("bufferView",None)
    chunk=json.dumps(doc,separators=(",",":"),ensure_ascii=False).encode("utf8")
    chunk+=b" "*(-len(chunk)%4)
    binary=data[20+size:]
    path.write_bytes(struct.pack("<4sIIII",b"glTF",2,20+len(chunk)+len(binary),len(chunk),0x4e4f534a)+chunk+binary)


def import_checked_lot(path,lot,manifest):
    import math
    import bpy
    from mathutils import Vector

    bpy.ops.import_scene.gltf(filepath=str(path))
    receivers=manifest["meshes"]
    actual={o.name for o in bpy.context.scene.objects if o.type=="MESH"}
    assert actual==set(receivers)|set(manifest["emissive"]),actual.symmetric_difference(set(receivers)|set(manifest["emissive"]))
    for name in receivers:
        assert len(bpy.data.objects[name].data.uv_layers)==2,name
    datum=bpy.data.objects[manifest["axisCheck"]["node"]]
    bay=next(b for b in lot["bays"] if b["id"]==manifest["axisCheck"]["bay"])
    pt=datum.matrix_world.translation
    err=(pt-Vector((bay["center"][0],-bay["center"][1],0))).length
    forward=datum.matrix_world.to_quaternion() @ Vector((1,0,0))
    assert err<.0001 and (forward-Vector((math.cos(bay["heading"]),math.sin(bay["heading"]),0))).length<.0001
    hit,contact,_,_,road,_=bpy.context.scene.ray_cast(bpy.context.evaluated_depsgraph_get(),
                                        pt+Vector((0,0,.08)),Vector((0,0,-1)),distance=.16)
    assert hit and road.name.startswith("Asphalt_") and abs(contact.z)<.0001
    print(f"Re-import: {len(receivers)} two-UV receivers, zero car meshes; {bay['id']} on {road.name} "
          f"at ({pt.x:.6f}, {pt.z:.6f}, {-pt.y:.6f}); {err:.8f} m error",flush=True)
