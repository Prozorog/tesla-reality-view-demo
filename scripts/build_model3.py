"""Rebuild the Highland exterior with Blender 5.2 in background mode."""
import json
import struct
import sys
from math import atan, cos, degrees, radians, sin
from pathlib import Path
from time import perf_counter

import bpy

PAINT_COLOR = "#34373d"
ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "models"
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / "scripts"))

from model3.details import MIRROR_CENTRE, add_details
from model3.mesh import Mesh, finish
from model3.shell import (AXLES, CLEARANCE, COWL, HEADER, HOOD_EDGE, RADIUS,
                          REAR, REAR_GLASS, SIDE_FRONT, build_shell, top)
from model3.wheels import wheel


def materials():
    specs = {
        "paint": ("Deep grey metallic clearcoat", PAINT_COLOR,.68,.31,.80),
        "glazing": ("Smoked panoramic glazing", "#050608",0,.078),
        "gasket": ("Window encapsulation", "#17191c",.08,.31),
        "pillar": ("Polished pillar applique", "#0c0e12",.30,.185),
        "valance": ("Lower bumper satin", "#181a1e",.18,.39),
        "liner": ("Wheelhouse felt", "#121315",0,.92),
        "seam": ("Closure shadow", "#08090b",0,.58),
        "lens_smoke": ("Smoked lens carrier", "#0b1018",.18,.19,.24),
        "tail_housing": ("Smoked ruby tail housing", "#240e16",.15,.23,.23),
        "projector": ("Projector facets", "#424e5b",.78,.15,.70),
        "head": ("Headlight DRL", "#d5e4f1",.1,.20,0,"#d4eaff",2.8),
        "tail": ("Tail signature red", "#a0181a",.18,.18,.35,"#ff1820",3.5),
        "brake": ("Brake and centre stop", "#260b11",.17,.27,.24,"#ff1220",.008),
        "reverse": ("Reverse white", "#667079",.22,.22,.35,"#f3f7ff",.025),
        "turn_l": ("Left direction amber", "#6c3511",.16,.22,.35,"#ff930e",.04),
        "turn_r": ("Right direction amber", "#6c3511",.16,.22,.35,"#ff930e",.04),
        "reflector": ("Bumper reflector", "#5e1720",.22,.28,.50),
        "plate": ("Rear registration blank", "#44484c",.35,.38),
        "hardware": ("Gunmetal hardware", "#62646a",.70,.29),
        "letter": ("Satin silver badges", "#d9dde0",.38,.34),
        "handle": ("Flush anthracite handle", "#191b1f",.48,.24),
        "intake": ("Lower air inlet", "#080a0d",.08,.60),
        "grille_rib": ("Inlet vanes", "#24272c",.1,.43),
        "mirror_glass": ("Blue silver mirror", "#9ca7af",.98,.055),
        "rubber": ("Tyre sidewall", "#17181a",.0,.78),
        "tread": ("Road tread", "#18191b",.0,.80),
        "aero": ("Aero cover graphite", "#25282e",.48,.35),
        "aero_edge": ("Aero bevel", "#34383e",.58,.33),
        "barrel": ("Inner wheel barrel", "#191b20",.50,.46),
        "rim": ("Machined graphite", "#51545a",.76,.29),
        "disc": ("Steel disc", "#55585c",.74,.38),
    }
    result={key:finish(*args) for key,args in specs.items()}
    glass=result["glazing"].node_tree.nodes.get("Principled BSDF")
    glass.inputs["Specular IOR Level"].default_value=.16
    for key in ("rubber","tread","intake","liner","gasket","valance"):
        result[key].node_tree.nodes.get("Principled BSDF").inputs["Specular IOR Level"].default_value=.23
    return result


def read_glb(file):
    with file.open("rb") as src:
        magic,version,total=struct.unpack("<4sII",src.read(12))
        length,kind=struct.unpack("<I4s",src.read(8))
        assert magic==b"glTF" and version==2 and total==file.stat().st_size and kind==b"JSON"
        return json.loads(src.read(length))


def verify_glb(file,origins):
    data=read_glb(file)
    nodes={n["name"]:n for n in data["nodes"]}
    assert set(nodes)==set(origins),nodes.keys()
    counts={}
    bounds=[]
    for name,n in nodes.items():
        x,y,z=origins[name]
        translation=n.get("translation",[0,0,0])
        assert max(abs(a-b) for a,b in zip(translation,(x,z,-y)))<.00001,(name,translation)
        assert not any(k in n for k in ["rotation","matrix","scale","children"]),n
        count=0
        for p in data["meshes"][n["mesh"]]["primitives"]:
            assert p.get("mode",4)==4
            count+=data["accessors"][p["indices"]]["count"]//3
            pos=data["accessors"][p["attributes"]["POSITION"]]
            for bound in ["min","max"]:
                a,b,c=[v+t for v,t in zip(pos[bound],translation)]
                bounds.append((a,-c,b))
        counts[name]=count
    light_materials=[]
    for name in [k for k in nodes if k.startswith(("lights_","indicators_"))]:
        slots={p["material"] for p in data["meshes"][nodes[name]["mesh"]]["primitives"]}
        assert len(slots)==1
        mat=slots.pop()
        assert max(data["materials"][mat].get("emissiveFactor",[0]))>0,name
        light_materials.append(mat)
    assert len(set(light_materials))==6
    glazing=data["meshes"][nodes["glass"]["mesh"]]["primitives"]
    assert len({p["material"] for p in glazing})==1,"Glazing must share one finish"
    mins,maxs=[list(map(f,zip(*bounds))) for f in [min,max]]
    size=[b-a for a,b in zip(mins,maxs)]
    for name,count in counts.items():
        print(f"  {name:18} {count:6,} triangles")
    total=sum(counts.values())
    print(f"TOTAL {total:,} triangles. Exported size {size}, bounds {mins} to {maxs}.",flush=True)
    assert total<=80000,total
    assert max(abs(a-b) for a,b in zip(size,[4.720,2.089,1.442]))<.01,size
    assert max(abs(a-b) for a,b in zip(mins,[-.985,-1.0445,0]))<.01,mins
    body_node=nodes["body"]
    body_mesh=data["meshes"][body_node["mesh"]]
    body_half=max(data["accessors"][p["attributes"]["POSITION"]]["max"][2] for p in body_mesh["primitives"])
    assert abs(2*body_half-1.848)<.01,body_half
    return counts,{"min":mins,"max":maxs,"size":size,"body_width":2*body_half}


def verify_profile(skin,parts,lip,peak):
    # Orthographic silhouette of the subdivided shell. At each X take the
    # highest downward hit across the crowned half-section, including its centre.
    heights=[]
    for i in range(185):
        x=lip[0]+(peak[0]-lip[0])*i/184
        hits=[skin.ray_cast((x,j*.035,2),(0,0,-1))[0] for j in range(27)]
        heights.append(max(p.z for p in hits if p is not None))
    reversal=max(max(heights[:i+1])-h for i,h in enumerate(heights))
    assert reversal<.0005,f"Roof/deck profile reverses by {reversal:.5f} m"
    # At tail-lamp height the central rear skin is the side-view outline.
    tail_gap=min(p[0]-skin.ray_cast((-2,0,p[2]),(1,0,0))[0].x
                 for p in parts["lights_tail"].vertices)
    assert tail_gap>=0,f"Tail LED overhangs the rear face by {-tail_gap:.5f} m"
    upper,lower=[skin.ray_cast((-2,0,z),(1,0,0))[0] for z in (.96,.79)]
    lean=degrees(atan((upper.x-lower.x)/(upper.z-lower.z)))
    assert 10<=lean<=15,lean
    gaps=[]
    for axle in AXLES:
        for angle in range(-25,206,5):
            a=radians(angle)
            hit=skin.ray_cast((axle,.84,RADIUS),(cos(a),0,sin(a)))[0]
            assert hit is not None,(axle,angle)
            gaps.append(((hit.x-axle)**2+(hit.z-RADIUS)**2)**.5-RADIUS)
    assert .040<=min(gaps)<=max(gaps)<=.050,(min(gaps),max(gaps))
    print(f"Roof/deck reversal {1000*reversal:.2f} mm, tail LED inside side profile by {1000*tail_gap:.1f} mm, "
          f"rear face {lean:.1f} degrees, tyre-to-liner clearance {1000*min(gaps):.1f}-{1000*max(gaps):.1f} mm.")


def build():
    start=perf_counter()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system='METRIC'
    names="body glass trim_black lights_head lights_tail lights_brake lights_reverse indicators_left indicators_right wheel_FL wheel_FR wheel_RL wheel_RR mirror_L mirror_R wordmark".split()
    mats=materials()
    parts={name:Mesh() for name in names}
    origins={name:(0,0,0) for name in names}
    skin=build_shell(parts,mats)
    add_details(parts,skin)
    wheels={}
    for name in names:
        if name.startswith("wheel_"):
            sign=1 if name.endswith("L") else -1
            origin=(AXLES[1] if "_F" in name else AXLES[0],sign*.79,RADIUS)
            origins[name]=wheels[name]=origin
            wheel(parts[name],origin,sign)
        parts[name].object(name,mats,origins[name])
    OUTPUT.mkdir(parents=True,exist_ok=True)
    glb=OUTPUT/"model3.glb"
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',export_yup=True,export_cameras=False,export_lights=False)
    counts,bbox=verify_glb(glb,origins)
    def measured(s,k,sign=1):
        position,_,_,_=skin.find_nearest(top(s,k,sign))
        return [round(v,6) for v in position]
    def pair(s,k):
        return {"left":measured(s,k,1),"right":measured(s,k,-1)}
    peak=max(parts["glass"].vertices,key=lambda p:p[2])
    stations={
        "rear_bumper":bbox["min"][0],"front_bumper":bbox["max"][0],"cowl":measured(COWL,0),
        "header":measured(HEADER,0),"roof_peak":peak,"rear_glass_bottom":measured(REAR_GLASS,0),
        "trunk_lip":measured(REAR,0),"hood_front_edge":measured(HOOD_EDGE,0),
        "beltline_height":measured(.96,3)[2],"beltline_at_b_pillar":pair(.96,3),
        "mirror_positions":{k:(MIRROR_CENTRE[0],sign*MIRROR_CENTRE[1],MIRROR_CENTRE[2]) for k,sign in [("left",1),("right",-1)]},
        "inner_cabin_half_width_dash":round(measured(1.93,3)[1]-.060,6),
        "inner_cabin_half_width_b_pillar":round(measured(.96,3)[1]-.066,6),
        "a_pillar_base":pair(SIDE_FRONT,3),"a_pillar_top":pair(HEADER,2),
        "front_axle":AXLES[1],"rear_axle":AXLES[0],"ground_clearance":CLEARANCE,
    }
    verify_profile(skin,parts,stations["trunk_lip"],peak)
    meta={"units":"metres","axes":"Blender XYZ: forward, left, up. Ground origin under rear axle.",
          "gltf_mapping":"(x, z, -y)","triangles":counts,"total_triangles":sum(counts.values()),
          "bounding_box":bbox,"wheel_centres":wheels,"wheel_radius":RADIUS,"wheel_width":.235,
          "wheelbase":AXLES[1]-AXLES[0],"stations":stations}
    dest=OUTPUT/"model3.json"
    dest.write_text(json.dumps(meta,indent=2)+"\n",encoding="utf-8")
    print(f"Verified {len(counts)} GLB mesh nodes. Wrote {glb} and {dest} in {perf_counter()-start:.1f}s.")


if __name__=="__main__":
    build()
