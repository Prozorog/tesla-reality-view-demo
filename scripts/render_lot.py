"""Re-import the shipping assets, reconstruct instancing and render the three baked views."""
import json
import math
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Vector

sys.dont_write_bytecode=True
HELPERS=Path(__file__).resolve().parent/"lot"
sys.path.insert(0,str(HELPERS))
from baking import dup, map_chart
from environment import place
from glb import import_checked_lot
from layout import MODELS, RENDERS, WORK, read
from mesh import rgb
from scene import cycles, fixtures, parked


def feed(tree,source,dest):
    if source.is_linked:
        tree.links.new(source.links[0].from_socket,dest)
    else:
        dest.default_value=source.default_value


def baked_shader(obj,settings):
    mat=obj.data.materials[0].copy()
    obj.data.materials[0]=mat
    tree=mat.node_tree
    nodes,links=tree.nodes,tree.links
    bs=next(n for n in nodes if n.type=="BSDF_PRINCIPLED")
    uv=nodes.new("ShaderNodeUVMap")
    uv.uv_map=obj.data.uv_layers[1].name
    lm=nodes.new("ShaderNodeTexImage")
    lm.image=bpy.data.images.load(str(MODELS/settings["file"]),check_existing=True)
    lm.image.colorspace_settings.name="sRGB"
    lm.extension="EXTEND"
    links.new(uv.outputs[0],lm.inputs["Vector"])
    mul=nodes.new("ShaderNodeMixRGB")
    mul.blend_type="MULTIPLY"
    mul.inputs[0].default_value=1
    feed(tree,bs.inputs["Base Color"],mul.inputs[1])
    links.new(lm.outputs["Color"],mul.inputs[2])
    emit=nodes.new("ShaderNodeEmission")
    links.new(mul.outputs[0],emit.inputs["Color"])
    emit.inputs["Strength"].default_value=settings["intensity"]
    add_haze(tree,emit.outputs[0])


def add_haze(tree,surface):
    nodes,links=tree.nodes,tree.links
    distance=nodes.new("ShaderNodeCameraData")
    ramp=nodes.new("ShaderNodeMapRange")
    ramp.inputs["From Min"].default_value=32
    ramp.inputs["From Max"].default_value=140
    ramp.inputs["To Max"].default_value=.72
    links.new(distance.outputs["View Distance"],ramp.inputs["Value"])
    haze=nodes.new("ShaderNodeEmission")
    haze.inputs[0].default_value=(*rgb("0d1220"),1)
    fog=nodes.new("ShaderNodeMixShader")
    links.new(ramp.outputs[0],fog.inputs[0])
    links.new(surface,fog.inputs[1])
    links.new(haze.outputs[0],fog.inputs[2])
    output=next(n for n in nodes if n.type=="OUTPUT_MATERIAL")
    links.new(fog.outputs[0],output.inputs["Surface"])


def parked_shader(mat):
    tree=mat.node_tree
    nodes,links=tree.nodes,tree.links
    bs=next(n for n in nodes if n.type=="BSDF_PRINCIPLED")
    normal=nodes.new("ShaderNodeNewGeometry")
    local_normal=nodes.new("ShaderNodeVectorTransform")
    local_normal.vector_type="NORMAL"
    local_normal.convert_from="WORLD"
    local_normal.convert_to="OBJECT"
    links.new(normal.outputs["Normal"],local_normal.inputs["Vector"])
    axes=nodes.new("ShaderNodeSeparateXYZ")
    links.new(local_normal.outputs[0],axes.inputs[0])
    def swatch(key):
        attr=nodes.new("ShaderNodeAttribute")
        attr.attribute_type="OBJECT"
        attr.attribute_name="Probe_"+key
        return attr.outputs["Color"]
    contributions=[]
    for axis,positive,negative in (("X","nose","tail"),("Y","left","right"),("Z","roof",None)):
        coord=axes.outputs[axis]
        side=nodes.new("ShaderNodeMath")
        side.operation="GREATER_THAN"
        links.new(coord,side.inputs[0])
        side.inputs[1].default_value=0
        pick=nodes.new("ShaderNodeMixRGB")
        links.new(side.outputs[0],pick.inputs[0])
        if negative:
            links.new(swatch(negative),pick.inputs[1])
        else:
            pick.inputs[1].default_value=(.022,.025,.035,1)
        links.new(swatch(positive),pick.inputs[2])
        square=nodes.new("ShaderNodeMath")
        square.operation="MULTIPLY"
        links.new(coord,square.inputs[0])
        links.new(coord,square.inputs[1])
        weight=nodes.new("ShaderNodeVectorMath")
        weight.operation="SCALE"
        links.new(pick.outputs[0],weight.inputs[0])
        links.new(square.outputs[0],weight.inputs["Scale"])
        contributions.append(weight.outputs[0])
    probe=contributions[0]
    for term in contributions[1:]:
        add=nodes.new("ShaderNodeVectorMath")
        add.operation="ADD"
        links.new(probe,add.inputs[0])
        links.new(term,add.inputs[1])
        probe=add.outputs[0]
    mul=nodes.new("ShaderNodeMixRGB")
    mul.blend_type="MULTIPLY"
    mul.inputs[0].default_value=1
    feed(tree,bs.inputs["Base Color"],mul.inputs[1])
    links.new(probe,mul.inputs[2])
    emit=nodes.new("ShaderNodeEmission")
    links.new(mul.outputs[0],emit.inputs[0])
    # Retain car-pack glossy response with its authored roughness and metallic textures.
    # Only the lightmap/probe controls diffuse. Direct analytic fixtures supply glints.
    spec=nodes.new("ShaderNodeBsdfGlossy")
    feed(tree,bs.inputs["Roughness"],spec.inputs["Roughness"])
    fresnel=nodes.new("ShaderNodeFresnel")
    fresnel.inputs["IOR"].default_value=1.48
    amount=nodes.new("ShaderNodeMath")
    amount.operation="MULTIPLY_ADD"
    feed(tree,bs.inputs["Metallic"],amount.inputs[0])
    amount.inputs[1].default_value=.30
    links.new(fresnel.outputs[0],amount.inputs[2])
    links.new(amount.outputs[0],spec.inputs["Color"])
    add=nodes.new("ShaderNodeAddShader")
    links.new(emit.outputs[0],add.inputs[0])
    links.new(spec.outputs[0],add.inputs[1])
    output=next(n for n in nodes if n.type=="OUTPUT_MATERIAL")
    links.new(add.outputs[0],output.inputs["Surface"])


def load_lot(lot,m):
    import_checked_lot(MODELS/"lot.glb",lot,m)
    lightmapped=m["meshes"]
    for name,settings in lightmapped.items():
        baked_shader(bpy.data.objects[name],settings)
    for name in m["emissive"]:
        if name.startswith(("Distant_","Street_")):
            tree=bpy.data.objects[name].data.materials[0].node_tree
            output=next(n for n in tree.nodes if n.type=="OUTPUT_MATERIAL")
            add_haze(tree,output.inputs["Surface"].links[0].from_socket)
    for name,transforms in m["instances"].items():
        src=bpy.data.objects[name]
        objects=[src]+[dup(src) for _ in transforms[1:]]
        for obj,tr in zip(objects,transforms):
            place(obj,tr)
            if name in lightmapped:
                sx,sy=tr["lightmapScale"]
                ox,oy=tr["lightmapOffset"]
                # Blender import converts glTF's top-origin V to bottom-origin.
                if obj.data.uv_layers.get("Lightmap") is None:
                    obj.data.uv_layers[1].name="Lightmap"
                    uv_node=next(n for n in obj.data.materials[0].node_tree.nodes if n.type=="UVMAP"
                                 and n.uv_map not in ("",obj.data.uv_layers[0].name))
                    uv_node.uv_map="Lightmap"
                map_chart(obj,(sx,sy,ox,1-oy-sy))


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    lot=read("lot.json")
    m=read("lot.lightmaps.json")
    s,device=cycles(lot,48)
    load_lot(lot,m)
    records,pieces=parked(lot)
    materials=set()
    for bay,obj in pieces:
        for key,probe in m["parkedCars"][bay]["probes"].items():
            obj["Probe_"+key]=probe["rgb"]
        materials.update(slot.material for slot in obj.material_slots)
    for mat in materials:
        parked_shader(mat)
    fixtures(lot)
    # The sky is visible as deep night, with a broader, cool reflection on bodywork.
    world=s.world.node_tree
    bg=world.nodes.get("Background")
    # Open night sky has a cooler zenith and a lighter horizon above the arcade.
    sky=world.nodes.new("ShaderNodeTexCoord")
    angle=world.nodes.new("ShaderNodeSeparateXYZ")
    world.links.new(sky.outputs["Generated"],angle.inputs[0])
    ramp=world.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color=(.38,.46,.68,1)
    ramp.color_ramp.elements[1].color=(.055,.077,.13,1)
    world.links.new(angle.outputs["Z"],ramp.inputs["Fac"])
    world.links.new(ramp.outputs[0],bg.inputs["Color"])
    bg.inputs["Strength"].default_value=.55
    ray=world.nodes.new("ShaderNodeLightPath")
    seen=world.nodes.new("ShaderNodeBackground")
    seen.inputs["Color"].default_value=(*rgb("070a14"),1)
    mix=world.nodes.new("ShaderNodeMixShader")
    world.links.new(ray.outputs["Is Camera Ray"],mix.inputs[0])
    world.links.new(bg.outputs[0],mix.inputs[1])
    world.links.new(seen.outputs[0],mix.inputs[2])
    world.links.new(mix.outputs[0],world.nodes.get("World Output").inputs["Surface"])
    s.view_settings.view_transform="Standard"
    # Bloom from linear scene radiance before the screenshot clips its LED cores.
    comp=bpy.data.node_groups.new("Night practical bloom","CompositorNodeTree")
    comp.interface.new_socket(name="Image",in_out="OUTPUT",socket_type="NodeSocketColor")
    layers=comp.nodes.new("CompositorNodeRLayers")
    glare=comp.nodes.new("CompositorNodeGlare")
    glare.inputs["Type"].default_value="Fog Glow"
    glare.inputs["Threshold"].default_value=1.45
    glare.inputs["Strength"].default_value=.78
    glare.inputs["Size"].default_value=.63
    comp.links.new(layers.outputs["Image"],glare.inputs["Image"])
    comp.links.new(glare.outputs["Image"],comp.nodes.new("NodeGroupOutput").inputs["Image"])
    s.compositing_node_group=comp
    s.render.resolution_x,s.render.resolution_y=1000,620
    s.render.resolution_percentage=100
    s.render.image_settings.file_format="PNG"
    bpy.ops.object.camera_add()
    cam=bpy.context.object
    s.camera=cam
    cam.data.clip_end=380
    RENDERS.mkdir(parents=True,exist_ok=True)
    num=int(sys.argv[sys.argv.index("--")+1]) if "--" in sys.argv else 1
    def shot(label,eye,target,up,lens):
        cam.location=eye
        direction=(Vector(target)-cam.location).normalized()
        # Explicit screen-up keeps geographic heading stable almost directly overhead.
        right=direction.cross(Vector(up)).normalized()
        from mathutils import Matrix
        cam.rotation_euler=Matrix([right,right.cross(direction),-direction]).transposed().to_euler()
        cam.data.lens=lens
        s.render.filepath=str(WORK/(label+".png"))
        bpy.ops.render.render(write_still=True)
    aisles=lot["aisles"]
    aisle=min(aisles,key=lambda a:abs(sum(p[1] for p in a["points"])/len(a["points"])))
    a,b=aisle["points"][0],aisle["points"][-1]
    dx,dz=b[0]-a[0],b[1]-a[1]
    axis=Vector((dx,-dz,0)).normalized()
    # Stand two bay pitches downbeam of the central pole. At 14 m this includes
    # the illuminated body and the cast silhouette beside it on both banks.
    mid=(Vector((a[0],-a[1],0))+Vector((b[0],-b[1],0)))/2
    poles=[Vector((l["pos"][0],-l["pos"][1],0)) for l in lot["lamps"]]
    central=min(poles,key=lambda loc:(loc-mid).length_squared)
    cross=Vector((-axis.y,axis.x,0))
    target=mid+axis*((central-mid).dot(axis)+6.0)+cross*.55
    shot("overhead",target-axis*1.30+Vector((0,0,14)),target,axis,24)
    angle=math.radians(40)
    uphill=Vector((axis.x*math.cos(angle)-axis.y*math.sin(angle),axis.x*math.sin(angle)+axis.y*math.cos(angle),0))
    shot("turned",target-uphill*(14/math.tan(math.radians(60)))+Vector((0,0,14)),target,uphill,26)
    facade=lot["building"]
    front=max(p[1] for p in facade["outline"])
    mid=sum(p[0] for p in facade["outline"])/len(facade["outline"])
    near=min(aisles,key=lambda aisle:min(abs(p[1]-front) for p in aisle["points"]))
    p=max(near["points"],key=lambda p:p[0])
    eye=Vector((p[0]*.92,-p[1]-.8,5))
    shot("chase",eye,(mid-.055*lot["size"][0],-front,2.55),(0,0,1),21)
    subprocess.run(["python","-B",str(HELPERS/"sheet.py"),str(num)],check=True)
    print(f"Rendered {RENDERS}/round{num}.jpg on {device}; {m['stats']['placedTriangles']} lot triangles",flush=True)


if __name__=="__main__":
    main()
