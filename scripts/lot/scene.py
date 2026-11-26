"""Shared physical light rig and linked, colour-resolved cars for baking and review."""
import math

import bpy
from mathutils import Vector

from layout import MODELS, local, read, street_lights
from mesh import Batch, material, rgb


def cycles(lot,samples):
    s=bpy.context.scene
    s.render.engine="CYCLES"
    s.render.threads_mode="FIXED"
    s.render.threads=4
    pref=bpy.context.preferences.addons["cycles"].preferences
    pref.compute_device_type="OPTIX"
    pref.refresh_devices()
    devices=[d for d in pref.devices if d.type=="OPTIX"]
    if not devices:
        raise RuntimeError("The requested OptiX device is unavailable")
    for d in pref.devices:
        d.use=d in devices
    s.cycles.device="GPU"
    s.cycles.samples=samples
    s.cycles.seed=lot["seed"]
    s.cycles.max_bounces=4
    s.cycles.diffuse_bounces=3
    s.cycles.use_denoising=True
    s.world=bpy.data.worlds.new("Blue night")
    bg=s.world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value=(.30,.29,.65,1)
    bg.inputs["Strength"].default_value=.006
    print("Cycles OptiX:",devices[0].name,flush=True)
    return s,devices[0].name


def light(name,location,direction,kind,energy,color,size,cone=106,blend=.56):
    bulb=bpy.data.lights.new(name,kind)
    bulb.energy=energy
    bulb.normalize=True
    bulb.color=rgb(color)
    obj=bpy.data.objects.new(name,bulb)
    bpy.context.collection.objects.link(obj)
    obj.location=location
    obj.rotation_euler=Vector(direction).to_track_quat("-Z","Y").to_euler()
    if kind=="SPOT":
        bulb.spot_size=math.radians(cone)
        bulb.spot_blend=blend
        bulb.shadow_soft_size=size
    else:
        bulb.shape="RECTANGLE"
        bulb.size,bulb.size_y=size
    return obj


# Neutral white LED, about 5000 K. Clip B's pools are grey-white, not sodium orange.
LED="fff0e6"
STREET_LED="ffece0"
# Type V batwing distribution per head, as co-located spots: a broad nadir
# optic for the bright core and steeply tilted throw optics that carry light
# out to the neighbouring pole, so adjacent pools overlap with no dark gaps.
# (watts, cone degrees, blend, tilt from nadir, azimuth from the arm)
OPTICS=[(2500,160,1.0,0,0),(5000,70,.9,66,0),(5000,70,.9,66,90),(5000,70,.9,66,-90),
        (3000,70,.9,66,180),(3000,70,.9,66,45),(3000,70,.9,66,-45)]


def fixtures(lot):
    records=[]
    for i,l in enumerate(lot["lamps"]):
        x,z=l["pos"]
        ht=l["height"]
        record={**l,"color":"#"+LED,"heads":[]}
        for k in range(l["arms"]):
            angle=k*math.tau/l["arms"]
            dx,dz=math.sin(angle),math.cos(angle)
            pos=(x+dx*.94,ht-.205,z+dz*.94)
            # Single-arm perimeter poles cover a whole edge of the lot on their own.
            scale=1 if l["arms"]>1 else 1.7
            optics=[]
            for layer,(watts,cone,blend,tilt,azimuth) in enumerate(OPTICS):
                a=angle+math.radians(azimuth)
                t=math.radians(tilt)
                direction=(math.sin(a)*math.sin(t),-math.cos(t),math.cos(a)*math.sin(t))
                # Perimeter heads carry house-side shields: little throw onto the
                # shop roof or the street, full throw back into the lot.
                if l["arms"]==1 and tilt and direction[2]*z>.25:
                    watts*=.2
                # Their nadir core lands on pale concrete paving: keep it at the twin-arm level.
                if l["arms"]==1 and not tilt:
                    watts/=scale
                optics.append({"watts":watts*scale,"coneDegrees":cone,"blend":blend,"direction":direction})
                light(f"Pool_{i}_{k}_{layer}",(pos[0],-pos[2],pos[1]),(direction[0],-direction[2],direction[1]),
                      "SPOT",watts*scale,LED,.32,cone,blend)
            record["heads"].append({"position":pos,"direction":(0,-1,0),"watts":sum(o["watts"] for o in optics),
                                    "coneDegrees":160,"blend":1.0,"radius":.32,"normalized":True,"optics":optics})
        records.append(record)
    for i,(x,z,angle) in enumerate(street_lights(lot)):
        dx,dz=math.sin(angle),math.cos(angle)
        pos=[x+dx*.86,4.94,z+dz*.86]
        direction=[dx*1.5,-1,dz*1.5]
        light(f"Street_pool_{i}",(pos[0],-pos[2],pos[1]),(direction[0],-direction[2],direction[1]),
              "SPOT",3200,STREET_LED,.07,110,.6)
        records.append({"pos":[x,z],"height":5.18,"arms":1,"color":"#"+STREET_LED,"heads":[
            {"position":pos,"direction":direction,"watts":3200,"coneDegrees":110,"blend":.6,"radius":.07}]})
    b=lot["building"]
    xs,zs=zip(*b["outline"])
    front=max(zs)
    count=max(1,round((max(xs)-min(xs))/5))
    for i in range(count):
        x=min(xs)+(max(xs)-min(xs))*(i+.5)/count
        light(f"Arcade_{i}",(x,-(front+b["canopyDepth"]*.61),b["height"]*.552-.10),
              (0,-.62,-1),"AREA",165,"ffe1bb",(2.6,.55))
    for x,z in b["doors"]:
        light("Vestibule spill",(x,-(z+.12),2.85),(0,-1,-.37),"AREA",410,"ffdbab",(2.4,1.65))
    # Concealed fascia wash makes pilasters, signage relief and limestone readable at night.
    for f in (.17,.50,.83):
        light("Fascia wash",(min(xs)+(max(xs)-min(xs))*f,-(front+.83),b["height"]*.552+.54),
              (0,.66,1),"AREA",70,"ffdeb7",(7,.25))
    return records


def parked(lot,bake_contacts=False):
    types=read("cars.json")["types"]
    bpy.ops.import_scene.gltf(filepath=str(MODELS/"cars.glb"))
    hero_bays=read("parked_hero.json") if (MODELS/"parked_hero.json").exists() else {}
    hero_parts=[]
    hero_size=None
    if hero_bays and (MODELS/"hero_lod.glb").exists():
        before=set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=str(MODELS/"hero_lod.glb"))
        imported=set(bpy.context.scene.objects)-before
        bpy.context.view_layer.update()
        hero_parts=[obj for obj in imported if obj.type=="MESH"]
        points=[obj.matrix_world @ Vector(corner) for obj in hero_parts for corner in obj.bound_box]
        low=Vector(tuple(min(p[axis] for p in points) for axis in range(3)))
        high=Vector(tuple(max(p[axis] for p in points) for axis in range(3)))
        hero_size=high-low
        center=Vector(((low.x+high.x)/2,(low.y+high.y)/2,low.z))
        for obj in hero_parts:
            matrix=obj.matrix_world.copy()
            obj.parent=None
            obj.data=obj.data.copy()
            obj.data.transform(matrix)
            for vertex in obj.data.vertices:
                vertex.co-=center
            obj.matrix_world.identity()
            for mat in obj.data.materials:
                bs=mat.node_tree.nodes.get("Principled BSDF")
                if bs:
                    bs.inputs["Emission Strength"].default_value=0
        for obj in imported-set(hero_parts):
            bpy.data.objects.remove(obj,do_unlink=True)
        print(f"Bake Tesla copies: {len(hero_bays)} bays, source {list(hero_size)} metres",flush=True)
    elif hero_bays:
        print("Hero LOD is not built yet; bake uses existing pack silhouettes",flush=True)
    records={}
    pieces=[]
    materials={}
    pans=Batch("Bake_only_undertrays")
    for b in lot["bays"]:
        if not b["taken"] or "car" not in b:
            continue
        c=b["car"]
        model=types[c["type"]]
        variants=model["variants"]
        variant=next((v for v in variants if v["color"]==c["color"]),variants[0])
        use_hero=b["id"] in hero_bays and hero_size is not None
        hero_scale=min(1,model["length"]/hero_size.x,model["width"]/hero_size.y) if use_hero else 1
        length=hero_size.x*hero_scale if use_hero else model["length"]
        width=hero_size.y*hero_scale if use_hero else model["width"]
        height=hero_size.z*hero_scale if use_hero else model["height"]
        h=b["heading"]+c["dh"]+(math.pi if c["noseIn"] else 0)
        x,z=b["center"][0]+c["dx"],b["center"][1]+c["dz"]
        record={"type":c["type"],"requestedColor":c["color"],"color":variant["color"],
                "position":[x,0,z],"heading":h,"probePosition":[x,height+.045,z]}
        if use_hero:
            record.update({"color":hero_bays[b["id"]],"model":"hero_lod.glb"})
        record["probes"]={"roof":{"position":record["probePosition"],"normal":[0,1,0]}}
        for label,angle,distance in (("nose",h,length/2),("tail",h+math.pi,length/2),
                                     ("left",h+math.pi/2,width/2),("right",h-math.pi/2,width/2)):
            nx,nz=math.cos(angle),-math.sin(angle)
            record["probes"][label]={"position":[x+(distance+.065)*nx,height*.62,z+(distance+.065)*nz],
                                      "normal":[nx,0,nz]}
        records[b["id"]]=record
        if bake_contacts:
            # Recessed, chamfered undertray closes the open pack shell between
            # the wheels. It blocks sky and bounce, without changing its silhouette.
            a,bw=length*.445,width*.45
            ends=[(-a,-bw*.72),(-a+.22,-bw),(a-.30,-bw),(a,-bw*.68),
                  (a,bw*.68),(a-.30,bw),(-a+.22,bw),(-a,bw*.72)]
            pans.slab([local((x,z),h,u,v) for u,v in ends],.085,.33,"17191b")
        root=bpy.data.objects[model["nodes"]["root"]]
        for original in (hero_parts if use_hero else root.children):
            obj=original.copy()
            bpy.context.collection.objects.link(obj)
            obj.parent=None
            obj.location=(x,-z,0)
            obj.rotation_mode="XYZ"
            obj.rotation_euler=(0,0,h)
            if use_hero:
                obj.scale=(hero_scale,hero_scale,hero_scale)
            obj.name=b["id"]+"_"+original.name
            if use_hero and original.name.startswith("body"):
                color=hero_bays[b["id"]]
                key=("hero",color)
                if key not in materials:
                    mat=original.material_slots[0].material.copy()
                    bs=mat.node_tree.nodes.get("Principled BSDF")
                    for link in list(bs.inputs["Base Color"].links):
                        mat.node_tree.links.remove(link)
                    paint={"black":"101319","darkgrey":"333942","darkblue":"182b46","red":"681b25"}
                    bs.inputs["Base Color"].default_value=(*rgb(paint[color]),1)
                    materials[key]=mat
                obj.material_slots[0].link="OBJECT"
                obj.material_slots[0].material=materials[key]
            elif original.name==model["nodes"]["body"]:
                key=(c["type"],variant["color"])
                if key not in materials:
                    mat=original.material_slots[0].material.copy()
                    bs=mat.node_tree.nodes.get("Principled BSDF")
                    tex=bs.inputs["Base Color"].links[0].from_node
                    tex.image=bpy.data.images.load(str(MODELS/variant["map"]),check_existing=True)
                    materials[key]=mat
                obj.material_slots[0].link="OBJECT"
                obj.material_slots[0].material=materials[key]
            pieces.append((b["id"],obj))
    for model in types.values():
        root=bpy.data.objects[model["nodes"]["root"]]
        for obj in list(root.children)+[root]:
            bpy.data.objects.remove(obj,do_unlink=True)
    for obj in hero_parts:
        bpy.data.objects.remove(obj,do_unlink=True)
    if pans.faces:
        pans.make(material("Undertray, bake only",.94))
    return records,pieces
