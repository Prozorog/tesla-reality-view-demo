"""Rebuild the night lot from the current layout in headless Blender 5.2."""
import hashlib
import json
import math
import os
import struct
import subprocess
import sys
import time
from pathlib import Path

import bpy

sys.dont_write_bytecode=True
HELPERS=Path(__file__).resolve().parent/"lot"
sys.path.insert(0,str(HELPERS))
from baking import architecture, bake_receivers, contact_visibility, dup, ground, pixels, probes, save_map, select
from environment import Environment
from glb import external_images, import_checked_lot
from layout import MAPS, MODELS, TEXTURES, WORK, read
from scene import cycles, fixtures, parked


def glb_stats(path,env,manifest):
    with path.open("rb") as f:
        f.seek(12)
        length,_=struct.unpack("<II",f.read(8))
        gltf=json.loads(f.read(length))
    total=placed=calls=0
    groups={}
    for node in gltf["nodes"]:
        if "mesh" not in node:
            continue
        name=node["name"]
        prims=gltf["meshes"][node["mesh"]]["primitives"]
        if name not in manifest["meshes"] and name not in env.emissive:
            raise ValueError("Unexpected exported mesh "+name)
        triangles=sum(gltf["accessors"][p["indices"]]["count"]//3 for p in prims)
        if name in manifest["meshes"]:
            assert all({"TEXCOORD_0","TEXCOORD_1"}<=set(p["attributes"]) for p in prims),name
        copies=len(env.instances.get(name,[None]))
        calls+=len(prims)
        total+=triangles
        placed+=triangles*copies
        groups[name]={"prototype":triangles,"placed":triangles*copies,"copies":copies}
        print(f"  {name:26} {triangles:6} x {copies:3} = {triangles*copies:7} triangles")
    assert placed<=90_000 and len(groups)<=40 and set(groups)==set(manifest["meshes"])|set(env.emissive)
    print(f"Lot: {total} stored triangles, {placed} placed, {len(groups)} meshes, {calls} instanced draws")
    return {"storedTriangles":total,"placedTriangles":placed,"meshCount":len(groups),
            "instancedDrawCalls":calls,"groups":groups}


def main():
    start=time.perf_counter()
    for folder in (WORK,TEXTURES,MAPS):
        folder.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    lot=read("lot.json")
    layout_hash=hashlib.sha256((MODELS/"lot.json").read_bytes()).hexdigest()
    subprocess.run(["python","-B",str(HELPERS/"pavement.py")],check=True)
    # LOT_SAMPLES lets a quick iteration bake at low samples; the release bake uses 512.
    s,device=cycles(lot,int(os.environ.get("LOT_SAMPLES","512")))
    s.cycles.adaptive_min_samples=32
    s.cycles.adaptive_threshold=.025
    # Small, bright emitters (signs, lenses, display lamps) produced coloured indirect
    # fireflies that the lightmap denoiser left as blotches on the facade and roofs.
    s.cycles.sample_clamp_indirect=2.0
    env=Environment(lot)
    ground_objs,ground_im,densities=ground(lot)
    records,_=parked(lot,bake_contacts=True)
    lamps=fixtures(lot)
    receivers,arch_im=architecture(env)
    probe_obj,probe_im,centres=probes(records)
    temp_ground=[dup(o) for o in ground_objs]
    for obj in ground_objs:
        obj.hide_render=True
    print("Diffuse receiver maps:",list(ground_im.size),list(arch_im.size),"and",len(records),"roof probes",flush=True)
    seconds=bake_receivers(temp_ground+receivers+[probe_obj])
    diffuse_receiver=bpy.context.object
    visibility,contact_seconds=contact_visibility(ground_objs,ground_im.size)
    seconds+=contact_seconds
    bpy.data.objects.remove(diffuse_receiver,do_unlink=True)
    ground_settings=save_map(ground_im,True,visibility)
    bpy.data.images.remove(visibility)
    arch_settings=save_map(arch_im)
    probe_rgb=pixels(probe_im)
    for (bay,key),(x,y) in centres.items():
        color=probe_rgb[y-2:y+2,x-2:x+2].mean(axis=(0,1))
        assert min(color)>0 and all(math.isfinite(v) for v in color), (bay,color)
        records[bay]["probes"][key]["rgb"]=[round(float(v),6) for v in color]
        if key=="roof":
            records[bay]["irradianceRGB"]=records[bay]["probes"][key]["rgb"]
    meshes={obj.name:ground_settings for obj in ground_objs}
    meshes.update({name:arch_settings for name in env.static})
    exports=ground_objs+env.exports
    for obj in exports:
        obj.hide_render=False
        for mat in obj.data.materials:
            # The foliage masks only shape the bake. The runtime binds them as alpha maps.
            for name in ("Bake receiver","Leaf alpha","Leaf alpha UV"):
                node=mat.node_tree.nodes.get(name)
                if node:
                    mat.node_tree.nodes.remove(node)
        if len(obj.data.uv_layers):
            obj.data.uv_layers.active_index=0
            obj.data.uv_layers[0].active_render=True
    bay=lot["bays"][0]
    datum=bpy.data.objects.new("BayDatum_"+bay["id"],None)
    bpy.context.collection.objects.link(datum)
    x,z=bay["center"]
    datum.location=(x,-z,0)
    datum.rotation_euler.z=bay["heading"]
    select(exports+[datum])
    path=MODELS/"lot.glb"
    bpy.ops.export_scene.gltf(filepath=str(path),export_format="GLB",use_selection=True,
                              export_animations=False,export_yup=True,export_texcoords=True,
                              export_image_format="AUTO",export_keep_originals=True)
    external_images(path)
    manifest={"version":1,"layoutSHA256":layout_hash,"axes":"glTF Y-up, +X forward, left -Z, metres",
              "meshes":meshes,"emissive":env.emissive,"instancing":"prototype mesh + world TRS per placement",
              "instances":env.instances,"parkedCars":records,"lamps":lamps,
              "glints":env.glints,
              "alphaMasks":{m.name:m["alphaMask"] for m in bpy.data.materials if "alphaMask" in m},
              "probeUnits":"linear diffuse outgoing radiance for unit white albedo (irradiance / pi)",
              "lightmapUV":"TEXCOORD_1; sample, sRGB-decode, multiply by intensity and linear albedo",
              "instanceUV":"uv1 * lightmapScale + lightmapOffset in glTF UV coordinates; all placements including first",
              "texelsPerMetre":{"groundXZ":densities,"buildingMinimum":6,
                                "meshLocal":{n:r["density"] for n,r in env.static.items()}},
              "bake":{"engine":"Cycles","device":"OPTIX / "+device,"samples":s.cycles.samples,
                      "pass":"DIFFUSE DIRECT + INDIRECT, COLOR disabled; ground short-range contact visibility","denoise":"edge-aware HDR a trous: three ground passes, two architecture passes",
                      "seconds":round(seconds,3)},
              "axisCheck":{"bay":bay["id"],"node":datum.name,"world":[x,0,z]}}
    manifest["stats"]=glb_stats(path,env,manifest)
    manifest["stats"]["runtimeBytes"]=path.stat().st_size+sum((MODELS/p["file"]).stat().st_size
        for p in (ground_settings,arch_settings))+sum(p.stat().st_size for p in TEXTURES.iterdir() if p.is_file())
    assert layout_hash==hashlib.sha256((MODELS/"lot.json").read_bytes()).hexdigest(),"Layout changed during bake"
    output=MODELS/"lot.lightmaps.json"
    serialized=json.dumps(manifest,indent=2,ensure_ascii=False)+"\n"
    assert manifest["stats"]["runtimeBytes"]+len(serialized.encode("utf8"))<=60_000_000
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import_checked_lot(path,lot,manifest)
    output.write_text(serialized,encoding="utf8")
    print(f"Wrote {path}, {output}, {MAPS}/lot_*.png and {TEXTURES}. Total build {time.perf_counter()-start:.1f}s",flush=True)


if __name__=="__main__":
    main()
