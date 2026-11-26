"""One shared irradiance atlas. Only the second UV set is modified by the unwrap."""
import ctypes as ct
import math
import time
import zlib
import struct
from pathlib import Path
import bpy
import numpy as np

MAP_NAME='cabin_night.png'
SIZE=2048


def denoise(rgb):
    """Use Blender's shipped HDR RT weights on linear irradiance before quantization."""
    path=Path(bpy.app.binary_path).parent/'blender.shared'/'OpenImageDenoise.dll'
    lib=ct.CDLL(str(path))
    ptr=ct.c_void_p
    def call(name,result,types,*args):
        f=getattr(lib,name)
        f.argtypes=types
        f.restype=result
        return f(*args)
    dev=call('oidnNewDevice',ptr,[ct.c_int],1)  # CPU only for post-bake atlas filtering
    call('oidnSetDeviceInt',None,[ptr,ct.c_char_p,ct.c_int],dev,b'numThreads',4)
    call('oidnCommitDevice',None,[ptr],dev)
    filt=call('oidnNewFilter',ptr,[ptr,ct.c_char_p],dev,b'RT')
    call('oidnSetFilterBool',None,[ptr,ct.c_char_p,ct.c_bool],filt,b'hdr',True)
    msg=ct.c_char_p()
    def error():
        code=call('oidnGetDeviceError',ct.c_int,[ptr,ct.POINTER(ct.c_char_p)],dev,ct.byref(msg))
        return msg.value.decode(errors='replace') if code and msg.value else str(code) if code else ''
    output=np.empty_like(rgb)
    for name,img in [(b'color',rgb),(b'output',output)]:
        call('oidnSetSharedFilterImage',None,[ptr,ct.c_char_p,ptr,ct.c_int]+[ct.c_size_t]*5,
             filt,name,img.ctypes.data,3,SIZE,SIZE,0,0,0)
    call('oidnCommitFilter',None,[ptr],filt)
    call('oidnExecuteFilter',None,[ptr],filt)
    why=error()
    call('oidnReleaseFilter',None,[ptr],filt)
    call('oidnReleaseDevice',None,[ptr],dev)
    if why:
        raise RuntimeError('OIDN: '+why)
    return output,'RT (HDR)'


def encoded_png(path, image):
    h,w,_=image.shape
    def chunk(tag,body):
        return struct.pack('>I',len(body))+tag+body+struct.pack('>I',zlib.crc32(tag+body))
    # Explicit sRGB encoding preserves dark irradiance when a browser decodes
    # to 8-bit ImageBitmap. The shader decodes to linear before multiplying.
    srgb=np.where(image<=.0031308,12.92*image,1.055*image**(1/2.4)-.055)
    rows=np.ascontiguousarray((srgb[::-1]*255+.5).astype(np.uint8)).reshape(h,-1)
    filt=rows.copy()
    filt[:,3:]=rows[:,3:]-rows[:,:-3]
    stream=zlib.compress(b''.join(b'\1'+row.tobytes() for row in filt),6)
    path.write_bytes(b'\x89PNG\r\n\x1a\n'
                     +chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))+chunk(b'sRGB',b'\0')
                     +chunk(b'IDAT',stream)+chunk(b'IEND',b''))


def select(objs):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active=objs[0]


def make_atlas(receivers,path):
    scene=bpy.context.scene
    start=time.perf_counter()
    # Unwrap the full scene as one mesh so charts from different parts share the packing.
    copies=[]
    for ob in receivers:
        copy=ob.copy()
        copy.data=ob.data.copy()
        bpy.context.collection.objects.link(copy)
        tag=copy.data.attributes.new('source_loop','INT','CORNER')
        # Each duplicate retains a global loop id through joining / unwrapping.
        base=sum(len(o.data.loops) for o in receivers[:len(copies)])
        tag.data.foreach_set('value',np.arange(base,base+len(copy.data.loops),dtype=np.int32))
        copies.append(copy)
    select(copies)
    bpy.ops.object.join()
    proxy=bpy.context.object
    mesh=proxy.data
    mesh.uv_layers.new(name='LightmapUV')
    mesh.uv_layers.active_index=1
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(68),island_margin=.0016,
                             margin_method='FRACTION',area_weight=.2,correct_aspect=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    ids=np.empty(len(mesh.loops),dtype=np.int32)
    mesh.attributes['source_loop'].data.foreach_get('value',ids)
    packed=np.empty(len(ids)*2,dtype=np.float32)
    mesh.uv_layers[1].data.foreach_get('uv',packed)
    uvs=np.empty((len(ids),2),dtype=np.float32)
    uvs[ids]=packed.reshape(-1,2)
    base=0
    for ob in receivers:
        count=len(ob.data.loops)
        layer=ob.data.uv_layers.new(name='LightmapUV')
        layer.data.foreach_set('uv',uvs[base:base+count].reshape(-1))
        ob.data.uv_layers.active_index=0
        ob.data.uv_layers[0].active_render=True
        base+=count
        ob.hide_render=True
    # Diffuse without albedo gives an independent lighting texture for MeshStandardMaterial.
    tex=bpy.data.images.new('Cabin irradiance (linear)',SIZE,SIZE,alpha=False,float_buffer=True,is_data=True)
    temp_nodes=[]
    for mat in set(proxy.data.materials):
        node=mat.node_tree.nodes.new('ShaderNodeTexImage')
        node.image=tex
        mat.node_tree.nodes.active=node
        temp_nodes.append((mat,node))
    select([proxy])
    scene.cycles.samples=128
    scene.render.bake.margin=6
    scene.render.bake.margin_type='EXTEND'
    scene.render.bake.use_clear=True
    print('Baking 2048², 128 samples, direct + indirect diffuse, no albedo',flush=True)
    bake_start=time.perf_counter()
    bpy.ops.object.bake(type='DIFFUSE',pass_filter={'DIRECT','INDIRECT'},uv_layer='LightmapUV')
    trace_seconds=time.perf_counter()-bake_start
    for mat,node in temp_nodes:
        mat.node_tree.nodes.remove(node)
    bpy.data.objects.remove(proxy,do_unlink=True)
    for ob in receivers:
        ob.hide_render=False
    rgba=np.empty(SIZE*SIZE*4,np.float32)
    tex.pixels.foreach_get(rgba)
    rgb=np.ascontiguousarray(rgba.reshape(SIZE,SIZE,4)[:,:,:3])
    del rgba
    if not np.isfinite(rgb).all() or rgb.max()<.001:
        raise RuntimeError('Empty or non-finite lightmap bake')
    print('Denoising irradiance atlas with OIDN HDR RT',flush=True)
    coverage=float(np.mean(np.max(rgb,axis=2)>.0001))
    print('Illuminated texel fraction:',round(coverage,4),'peak input:',rgb.max(),flush=True)
    rgb,filter_name=denoise(rgb)
    rgb=np.maximum(rgb,0)
    # Preserve highlight energy. The manifest supplies the scale after sRGB decode.
    scale=max(1.,float(rgb.max()))
    encoded_png(path,np.clip(rgb/scale,0,1))
    bpy.data.images.remove(tex)
    return {'width':SIZE,'height':SIZE,'encoding':'RGB8 sRGB of normalized irradiance / pi',
            'decode_scale':scale,'three_lightMapIntensity':scale*math.pi,
            'bake_samples':scene.cycles.samples,'denoiser':'Open Image Denoise '+filter_name,
            'illuminated_texel_fraction':round(coverage,4),
            'cycles_bake_seconds':round(trace_seconds,2),
            'atlas_total_seconds':round(time.perf_counter()-start,2)}

