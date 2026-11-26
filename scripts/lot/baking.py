"""Lightmap atlas placement, Cycles receivers, HDR storage and denoising."""
import math
import struct
import time
import zlib

import bpy
import numpy as np
from mathutils import Vector

from environment import place
from layout import MAPS, MODELS, TEXTURES, ground_bounds, tile_info
from mesh import Batch, material, shelf


def image_target(name,w,h):
    im=bpy.data.images.new(name,width=w,height=h,alpha=False,float_buffer=True,is_data=True)
    im.colorspace_settings.name="Non-Color"
    return im


def bake_node(mat,img):
    nodes=mat.node_tree.nodes
    node=nodes.new("ShaderNodeTexImage")
    node.name="Bake receiver"
    node.image=img
    nodes.active=node


def assign_uvs(obj,name,coords):
    uv=obj.data.uv_layers.get(name) or obj.data.uv_layers.new(name=name)
    for loop,st in zip(uv.data,coords):
        loop.uv=st


def ground(lot):
    objs=[]
    x0,z0,x1,z1=ground_bounds(lot)
    spans=(x1-x0,z1-z0)
    density=(4096-8)/max(spans)
    width,height=[round(span*density)+8 for span in spans]
    target=image_target("lot_ground",width,height)
    for name,i,j,tw,th,(a,b,c,d) in tile_info(lot):
        mat=material(name+" pavement",.64,colored=False)
        nodes=mat.node_tree.nodes
        links=mat.node_tree.links
        bs=nodes.get("Principled BSDF")
        uv0=nodes.new("ShaderNodeUVMap")
        uv0.uv_map="Surface"
        for suffix,socket in ((".jpg","Base Color"),("_mr.png","Roughness")):
            tex=nodes.new("ShaderNodeTexImage")
            tex.image=bpy.data.images.load(str(TEXTURES/(name.lower()+suffix)),check_existing=True)
            links.new(uv0.outputs["UV"],tex.inputs["Vector"])
            if socket=="Base Color":
                links.new(tex.outputs[0],bs.inputs[socket])
            else:
                tex.image.colorspace_settings.name="Non-Color"
                channels=nodes.new("ShaderNodeSeparateColor")
                links.new(tex.outputs[0],channels.inputs[0])
                links.new(channels.outputs["Green"],bs.inputs["Roughness"])
                links.new(channels.outputs["Blue"],bs.inputs["Metallic"])
        batch=Batch(name)
        batch.face([(a,b,0),(c,b,0),(c,d,0),(a,d,0)],"ffffff")
        obj=batch.make(mat)
        obj.data.color_attributes.remove(obj.data.color_attributes[0])
        coords=[obj.data.vertices[l.vertex_index].co for l in obj.data.loops]
        assign_uvs(obj,"Surface",[((2+(p.x-a)/(c-a)*tw)/(tw+4),(2+(d+p.y)/(d-b)*th)/(th+4)) for p in coords])
        assign_uvs(obj,"Lightmap",[((4+(p.x-x0)/(x1-x0)*(width-8))/width,
                                     (4+(z1+p.y)/(z1-z0)*(height-8))/height) for p in coords])
        obj.data.uv_layers.active_index=0
        bake_node(mat,target)
        objs.append(obj)
    return objs,target,[(width-8)/(x1-x0),(height-8)/(z1-z0)]


def dup(obj):
    copy=obj.copy()
    copy.data=obj.data.copy()
    bpy.context.collection.objects.link(copy)
    return copy


def map_chart(obj,rect):
    sx,sy,ox,oy=rect
    uv=obj.data.uv_layers["Lightmap"]
    raw=np.empty(len(uv.data)*2,dtype=np.float32)
    uv.data.foreach_get("uv",raw)
    st=raw.reshape((-1,2))
    st *= (sx,sy)
    st += (ox,oy)
    uv.data.foreach_set("uv",raw)


def architecture(env):
    records=[]
    sizes=[]
    for obj in env.exports:
        if obj.name not in env.static:
            continue
        for tr in env.instances.get(obj.name,[None]):
            records.append((obj,tr))
            sizes.append(tuple(obj["chartPixels"]))
    width=max(max(w for w,h in sizes),math.ceil(math.sqrt(sum(w*h for w,h in sizes))))
    width=math.ceil(width/64)*64
    offsets,h=shelf(sizes,width)
    height=math.ceil(h/64)*64
    im=image_target("lot_architecture",width,height)
    copies=[]
    for (obj,tr),(w,h),(x,y) in zip(records,sizes,offsets):
        receiver=dup(obj)
        rect=(w/width,h/height,x/width,y/height)
        map_chart(receiver,rect)
        if tr:
            place(receiver,tr)
            tr["lightmapScale"]=[w/width,h/height]
            tr["lightmapOffset"]=[x/width,1-(y+h)/height]
        else:
            map_chart(obj,rect)
        copies.append(receiver)
        obj.hide_render=True
    for mat in set(o.data.materials[0] for o in copies):
        bake_node(mat,im)
    # The other physical lamp heads also contribute emission and visibility to the bake.
    for name,trs in env.instances.items():
        if name in env.emissive:
            for tr in trs[1:]:
                obj=bpy.data.objects[name].copy()
                bpy.context.collection.objects.link(obj)
                place(obj,tr)
    return copies,im


def probes(records):
    samples=[(bay,key,p) for bay,car in records.items() for key,p in car["probes"].items()]
    n=max(1,math.ceil(math.sqrt(len(samples))))
    im=image_target("Roof probes",n*12,n*12)
    batch=Batch("Roof_probes")
    coords=[]
    pixels={}
    for i,(bay,key,probe) in enumerate(samples):
        x,h,z=probe["position"]
        nx,ny,nz=probe["normal"]
        normal=Vector((nx,nz,ny))
        u=normal.cross(Vector((1,0,0)) if abs(nx)<.8 else Vector((0,1,0))).normalized()*.041
        v=normal.cross(u)
        center=Vector((x,z,h))
        batch.face([center-u-v,center+u-v,center+u+v,center-u+v],"ffffff")
        a,b=i%n*12,i//n*12
        coords.extend([((a+u)/im.size[0],(b+v)/im.size[1]) for u,v in [(3,3),(9,3),(9,9),(3,9)]])
        pixels[bay,key]=(a+6,b+6)
    m=material("Neutral roof probe",colored=False)
    obj=batch.make(m)
    assign_uvs(obj,"Surface",coords)
    assign_uvs(obj,"Lightmap",coords)
    bake_node(m,im)
    return obj,im,pixels


def select(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]


def bake_receivers(objects):
    select(objects)
    bpy.ops.object.join()
    scene=bpy.context.scene
    scene.render.bake.use_clear=True
    start=time.perf_counter()
    result=bpy.ops.object.bake(type="DIFFUSE",pass_filter={"DIRECT","INDIRECT"},uv_layer="Lightmap",
                               margin=3,margin_type="EXTEND",use_clear=True)
    seconds=time.perf_counter()-start
    if "FINISHED" not in result:
        raise RuntimeError(f"Cycles bake failed: {result}")
    print(f"Cycles combined diffuse bake: {seconds:.2f} seconds",flush=True)
    return seconds


def contact_visibility(ground_objs,size):
    """Trace the short-range sky visibility of wheels, sills and plinths at ground resolution."""
    target=image_target("Ground contact visibility",*size)
    mat=material("Contact visibility receiver",colored=False)
    nodes,links=mat.node_tree.nodes,mat.node_tree.links
    ao=nodes.new("ShaderNodeAmbientOcclusion")
    ao.samples=16
    ao.inputs["Distance"].default_value=.85
    emit=nodes.new("ShaderNodeEmission")
    links.new(ao.outputs["AO"],emit.inputs["Color"])
    links.new(emit.outputs[0],nodes.get("Material Output").inputs["Surface"])
    bake_node(mat,target)
    copies=[]
    for obj in ground_objs:
        receiver=dup(obj)
        receiver.data.materials[0]=mat
        receiver.hide_render=False
        # Clear the diffuse receiver underneath without lifting the contact field.
        receiver.location.z+=.001
        copies.append(receiver)
    select(copies)
    bpy.ops.object.join()
    scene=bpy.context.scene
    samples=scene.cycles.samples
    scene.cycles.samples=16
    start=time.perf_counter()
    result=bpy.ops.object.bake(type="EMIT",uv_layer="Lightmap",margin=3,margin_type="EXTEND",use_clear=True)
    seconds=time.perf_counter()-start
    scene.cycles.samples=samples
    assert "FINISHED" in result,result
    bpy.data.objects.remove(bpy.context.object,do_unlink=True)
    print(f"Cycles short-range contact bake: {seconds:.2f} seconds",flush=True)
    return target,seconds


def pixels(im):
    w,h=im.size
    buf=np.empty(w*h*4,dtype="float32")
    im.pixels.foreach_get(buf)
    return buf.reshape(h,w,4)[:,:,:3].copy()


def denoise(raw,strides):
    """Filter bounce noise in linear light, rejecting neighbours across a shadow edge."""
    current=raw
    for stride in strides:
        p=np.pad(current,((stride,stride),(stride,stride),(0,0)),mode="edge")
        value=current*4
        total=np.full(current.shape[:2],4,dtype="float32")
        scale=.015+.12*current.mean(axis=2)
        for dx,dz in ((-1,0),(1,0),(0,-1),(0,1),(-1,-1),(1,-1),(-1,1),(1,1)):
            y,x=(dz+1)*stride,(dx+1)*stride
            near=p[y:y+current.shape[0],x:x+current.shape[1]]
            distance=np.abs(near-current).mean(axis=2)/scale
            weight=np.exp(-distance*distance)*(1 if dx and dz else 2)
            value+=near*weight[:,:,None]
            total+=weight
        current=value/total[:,:,None]
    return current


def save_map(im,ground_map=False,visibility=None):
    raw=pixels(im)
    if not np.isfinite(raw).all() or raw.max()<.02:
        raise ValueError(f"Empty or invalid Cycles output: {im.name}")
    # Bound peak memory on the 4k atlas. The halo is the full multi-pass filter
    # radius, so adjacent strips agree exactly at their boundary.
    strides=(1,2,4) if ground_map else (1,2)
    radius=sum(strides)
    w,h=im.size
    filtered=np.empty_like(raw)
    for y in range(0,h,96):
        end=min(h,y+96)
        a,b=max(0,y-radius),min(h,end+radius)
        block=denoise(np.maximum(raw[a:b],0),strides)
        filtered[y:end]=block[y-a:end-a]
    raw=filtered
    if visibility:
        contact=pixels(visibility)[:,:,0].copy()
        # Local visibility supplements the finite-bounce solution close to a
        # blocker. Open pavement has visibility one and retains its full radiance.
        np.clip(contact,0,1,out=contact)
        if not np.isfinite(contact).all() or np.mean(contact)<.50:
            raise ValueError("Ground contact bake lost open-pavement visibility")
        print(f"Ground visibility: mean {contact.mean():.4f}, {(contact<.75).mean()*100:.2f}% below 0.75",flush=True)
        raw*= (.27+.73*contact**1.5)[:,:,None]
    if ground_map:
        np.maximum(raw,[.00015,.00025,.00045],out=raw)
    # Surfaces a few centimetres from a lens reach radiance 50-200. Letting them set
    # the fixed exposure left the facade at sRGB codes 1-6, where each channel
    # quantised on its own into red, green and yellow blocks. Clip those hot spots.
    np.minimum(raw,8.0,out=raw)
    peak=float(raw.max())
    gain=2**math.ceil(math.log2(max(1,peak)))
    rows=np.zeros((h,1+w*3),dtype="uint8")
    for y in range(0,h,96):
        end=min(h,y+96)
        col=raw[h-end:h-y][::-1]/gain
        srgb=np.where(col<=.0031308,col*12.92,1.055*np.power(col,1/2.4)-.055)
        rows[y:end,1:]=np.rint(np.clip(srgb,0,1)*255).astype("uint8").reshape(end-y,w*3)
    def chunk(tag,data):
        return struct.pack(">I",len(data))+tag+data+struct.pack(">I",zlib.crc32(tag+data)&0xffffffff)
    path=MAPS/(im.name+".png")
    path.write_bytes(b"\x89PNG\r\n\x1a\n"+chunk(b"IHDR",struct.pack(">IIBBBBB",w,h,8,2,0,0,0))+
                     chunk(b"sRGB",b"\0")+chunk(b"IDAT",zlib.compress(rows.tobytes(),8))+chunk(b"IEND",b""))
    receiver_gain=1.055 if ground_map else 1.0
    return {"file":path.relative_to(MODELS).as_posix(),"encoding":"sRGB8-fixed-exposure",
            "intensity":gain,"threeStandardLightMapIntensity":math.pi*gain*receiver_gain,"channel":1,"flipY":False,
            "size":[w,h],"linearPeak":round(peak,6)}
