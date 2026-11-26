"""Headless OptiX review. Pass -- --round 2, optionally --night for both night views."""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from time import perf_counter

ROOT=Path(__file__).resolve().parents[1]
REVIEWS=ROOT/"renders"/"model3"
REF=Path(os.environ.get("TESLA_REF_DIR", ROOT.parent / "ref"))
STUDIO=[
    ("plan","Top","car-01-high-rear.jpg",(.10,.29,.94,.95)),
    ("rear","Rear","car-03-rear.jpg",(0,0,1,1)),
    ("side","Side","car-06-side-rear.jpg",(0,.12,1,.88)),
    ("front","Front","car-04-front.jpg",(0,0,1,1)),
    ("quarter","High rear three-quarter","car-01-high-rear.jpg",(.10,.29,.94,.95)),
]


def compose(temp,number,night):
    from PIL import Image,ImageDraw,ImageFont,ImageOps
    font_path=Path("C:/Windows/Fonts/segoeui.ttf")
    font=ImageFont.truetype(str(font_path),19) if font_path.exists() else ImageFont.load_default()
    small=ImageFont.truetype(str(font_path),15) if font_path.exists() else font
    bg=(31,33,36)
    sheet=Image.new("RGB",(1480,5*380+38),bg)
    draw=ImageDraw.Draw(sheet)
    draw.text((14,7),f"Model 3  /  studio round {number}",font=font,fill="white")
    draw.text((752,9),"Photo reference",font=small,fill=(200,200,200))
    refs={}
    for i,(key,label,ref,crop) in enumerate(STUDIO):
        y=38+i*380
        if ref not in refs:
            with Image.open(REF/ref) as src:
                refs[ref]=src.convert("RGB")
        ref_image=refs[ref]
        w,h=ref_image.size
        cropped=ref_image.crop(tuple(round(v*(w if k%2==0 else h)) for k,v in enumerate(crop)))
        with Image.open(temp/(key+".png")) as shot:
            tile=ImageOps.contain(shot.convert("RGB"),(736,352),Image.Resampling.LANCZOS)
            sheet.paste(tile,((740-tile.width)//2,y+(352-tile.height)//2))
        tile=ImageOps.contain(cropped,(736,352),Image.Resampling.LANCZOS)
        sheet.paste(tile,(740+(740-tile.width)//2,y+(352-tile.height)//2))
        draw.text((14,y+352),label,font=small,fill=(230,230,230))
        draw.text((752,y+352),ref,font=small,fill=(185,188,191))
    out=REVIEWS/f"round{number}.jpg"
    sheet.save(out,quality=75,optimize=True)
    print(f"Wrote {out} ({sheet.width} x {sheet.height}).")
    if night:
        sheet=Image.new("RGB",(1440,608),bg)
        draw=ImageDraw.Draw(sheet)
        for i,(key,label) in enumerate([("night_top","12 m overhead"),("night_rear","8 m behind  /  5 m up")]):
            with Image.open(temp/(key+".png")) as shot:
                sheet.paste(shot.convert("RGB"),(i*720,0))
            draw.text((i*720+15,573),label,font=font,fill="white")
        out=REVIEWS/("night2.jpg" if number==4 else "night.jpg")
        sheet.save(out,quality=75,optimize=True)
        print(f"Wrote {out} ({sheet.width} x {sheet.height}).")


def render(number,night):
    import bpy
    from mathutils import Vector
    start=perf_counter()
    sys.dont_write_bytecode=True
    sys.path.insert(0,str(ROOT/"scripts"))
    from model3.mesh import finish, linear
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/"public/models/model3.glb"))
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='OPTIX'
    prefs.refresh_devices()
    selected=[d for d in prefs.devices if d.type=="OPTIX" and "4070" in d.name]
    if not selected:
        raise RuntimeError("The RTX 4070 OptiX device is unavailable.")
    for d in prefs.devices:
        d.use=d in selected
    scene.cycles.device='GPU'
    scene.cycles.samples=24
    scene.cycles.use_denoising=True
    scene.cycles.max_bounces=5
    scene.cycles.seed=7
    scene.render.threads_mode='FIXED'
    scene.render.threads=4
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG"
    scene.render.image_settings.color_mode="RGB"
    scene.view_settings.view_transform="AgX"
    scene.render.film_transparent=False
    world=bpy.data.worlds.new("Studio ambient")
    scene.world=world
    world.color=(.25,.25,.25)
    if not world.node_tree:
        world.use_nodes=True
    ambient=world.node_tree.nodes.get("Background")
    ambient.inputs["Color"].default_value=(.64,.68,.76,1)
    ambient.inputs["Strength"].default_value=.30
    bpy.ops.mesh.primitive_plane_add(size=2000, location=(0,0,-.001))
    floor=bpy.context.object
    floor_mat=finish("Studio sweep","#77797d",0,.74)
    floor.data.materials.append(floor_mat)
    camera=bpy.data.cameras.new("Review lens")
    cam=bpy.data.objects.new("Review camera",camera)
    scene.collection.objects.link(cam)
    scene.camera=cam
    def aim(obj,target):
        obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    def panel(name,loc,target,watts,w,h,color):
        light=bpy.data.lights.new(name,"AREA")
        light.energy=watts
        light.shape="RECTANGLE"
        light.size=w
        light.size_y=h
        light.color=color
        ob=bpy.data.objects.new(name,light)
        scene.collection.objects.link(ob)
        ob.location=loc
        aim(ob,target)
        return ob
    lights=[
        panel("Left overhead silk",(1.6,1.90,5.9),(1.25,0,.7),365,6.2,.72,(.96,.97,1)),
        panel("Low side strip",(1.7,-4.6,1.09),(1.1,0,.67),150,5.7,.39,(1,.96,.91)),
        panel("Rear edge softbox",(-3.6,2.2,3.4),(0,0,.7),240,3.3,1.15,(.88,.93,1)),
        panel("Front softbox",(5.6,-2.8,4.3),(2,0,.8),235,3.2,1.1,(1,1,1)),
    ]
    target=(1.375,0,.70)
    shots=[
        ("plan",(1.375,0,12),(1.375,0,.3),5.65),
        ("rear",(-10,0,1.16),(.25,0,.70),3.43),
        ("side",(1.375,-12,target[2]),target,5.52),
        ("front",(12.1,0,1.14),(2.3,0,.70),3.43),
        ("quarter",(-3.9,-8.6,5.8),(1.20,0,.62),0),
    ]
    REVIEWS.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="frames-",dir=REVIEWS) as directory:
        temp=Path(directory)
        def shoot(key,loc,look,scale,lens=61):
            cam.location=loc
            aim(cam,look)
            camera.type="ORTHO" if scale else "PERSP"
            if scale: camera.ortho_scale=scale
            camera.lens=lens
            scene.render.filepath=str(temp/(key+".png"))
            bpy.ops.render.render(write_still=True)
        scene.render.resolution_x,scene.render.resolution_y=752,376
        for shot in shots:
            shoot(*shot)
        if night:
            for light in lights: light.hide_render=True
            panel("Single warm parking lamp",(-4.15,-2.55,6.2),(1,0,0),1600,1.35,.80,(1,.59,.31))
            ambient.inputs["Color"].default_value=(.30,.38,.61,1)
            ambient.inputs["Strength"].default_value=.115
            floor_mat.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value=linear("#493e36")
            for name,strength in [("Tail signature red",4.5),("Headlight DRL",.065),("Brake and centre stop",0),
                                  ("Reverse white",0),("Left direction amber",0),("Right direction amber",0)]:
                bpy.data.materials[name].node_tree.nodes.get("Principled BSDF").inputs["Emission Strength"].default_value=strength
            scene.render.resolution_x,scene.render.resolution_y=720,560
            cam.location=(1.375,0,12)
            cam.rotation_euler=(0,0,-1.57079632679)
            camera.type="PERSP"
            camera.lens=57
            scene.render.filepath=str(temp/"night_top.png")
            bpy.ops.render.render(write_still=True)
            shoot("night_rear",(-8.985,0,5),(.69,0,.68),0,77)
        py=shutil.which("python")
        if not py: raise RuntimeError("Python with Pillow is needed to assemble the review sheet.")
        args=[py,__file__,"--compose",str(temp),"--round",str(number)]
        subprocess.run(args+(["--night"] if night else []),check=True)
    meta=json.loads((ROOT/"public/models/model3.json").read_text(encoding="utf-8"))
    print(f"{meta['total_triangles']:,} triangles. {selected[0].name}, OptiX, 24 spp. Review took {perf_counter()-start:.1f}s.")


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--round",type=int,choices=[1,2,3,4],default=1)
    parser.add_argument("--night",action="store_true")
    parser.add_argument("--compose",type=Path)
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else sys.argv[1:] if "--compose" in sys.argv else [])
    if args.compose: compose(args.compose,args.round,args.night)
    else: render(args.round,args.night)
