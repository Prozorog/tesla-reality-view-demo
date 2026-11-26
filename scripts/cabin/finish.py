"""PBR finishes. All swatches are sRGB; embedded repeat tiles are 512 px."""
import struct
import zlib
import tempfile
from pathlib import Path
import bpy
import numpy as np


def linear(c):
    return c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4


def color(hexcode):
    return [linear(int(hexcode.lstrip('#')[i:i+2],16)/255) for i in (0,2,4)]+[1.]


def image_tile(name, pixels, data=False):
    # Pack the generated PNG so the rerunnable build needs no sidecars.
    pixels=np.ascontiguousarray(np.clip(pixels,0,255),dtype=np.uint8)
    h,w,_=pixels.shape
    def chunk(tag,body):
        return struct.pack('>I',len(body))+tag+body+struct.pack('>I',zlib.crc32(tag+body))
    content=(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,h,8,2,0,0,0))
             +chunk(b'IDAT',zlib.compress(b''.join(b'\0'+row.tobytes() for row in pixels),7))
             +chunk(b'IEND',b''))
    scratch=Path(__file__).resolve().parents[2]/'renders'/'cabin'
    scratch.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=scratch) as directory:
        path=Path(directory)/(name+'.png')
        path.write_bytes(content)
        im=bpy.data.images.load(str(path))
        im.name=name
        if data:
            im.colorspace_settings.name='Non-Color'
        im.pack()
    return im


def normal_tile(name,height):
    dx=(np.roll(height,1,1)-np.roll(height,-1,1))*.5
    dy=(np.roll(height,-1,0)-np.roll(height,1,0))*.5
    length=np.sqrt(1+dx*dx+dy*dy)
    return image_tile(name,127.5*(1+np.stack((dx,dy,np.ones_like(dy)),-1)/length[:,:,None]),True)


def materials(strip):
    catalog={
        "Upper dash":("101113",.62,0), "Dash weave":("8f9094",.92,0),
        "Vent throat":("0c0d10",.79,0), "Shadow trim":("242528",.56,0),
        "Bright edge":("b7babd",.30,.84), "Gunmetal":("66696c",.33,.72),
        "Satin console":("292a2d",.36,.10), "Lid":("38383b",.43,.18),
        "Rubber":("17181a",.85,0), "Door insert":("97989a",.72,0),
        "Speaker cloth":("424348",.84,0), "Headlining":("53575b",.95,0),
        "Roof reveal":("0b0c10",.31,.22), "Pillar seal":("191a1c",.80,0),
        "Seat hide":("16171a",.53,0), "Seat centre":("16171a",.68,0),
        "Seam thread":("46464a",.85,0), "Carpet":("27272c",.99,0),
        "Wheel leather":("202023",.52,0), "Wheel pad":("252529",.61,0),
        "Switch":("18191c",.40,.15), "Wheel legend":("b7b8bc",.47,.22),
        "Emboss":("4d4e51",.43,.12), "Display edge":("55565a",.26,.72),
        "Black glass bezel":("090a0c",.20,.10), "screen":("0c0e13",.20,.06),
        "Mirror glass":("c7d0d4",.055,1), "Light guide":(strip,.33,0)
    }
    out={}
    for name,(swatch,rough,metal) in catalog.items():
        mat=bpy.data.materials.new(name)
        bsdf=mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs['Base Color'].default_value=color(swatch)
        bsdf.inputs['Metallic'].default_value=metal
        bsdf.inputs['Roughness'].default_value=rough
        if name in ('Upper dash','Wheel pad','Switch','Satin console'):
            bsdf.inputs['Specular IOR Level'].default_value=.29
        if name in ('Dash weave','Headlining','Carpet','Door insert'):
            bsdf.inputs['Sheen Weight'].default_value=.16
            bsdf.inputs['Sheen Tint'].default_value=color('393a3c' if name=='Dash weave' else '252529')
        if name=='Light guide':
            bsdf.inputs['Base Color'].default_value=[.09*val for val in color(strip)[:3]]+[1.]
            bsdf.inputs['Emission Color'].default_value=color(strip)
            bsdf.inputs['Emission Strength'].default_value=1.55
        out[name]=mat

    yy,xx=np.mgrid[:512,:512]
    rng=np.random.default_rng(24)
    yarn=np.cos(xx*np.pi/2 + .75*np.sin(yy*np.pi/4))
    weft=np.cos(yy*np.pi/2 + .52*np.sin(xx*np.pi/4))
    weave=.5*yarn+.5*weft
    fleck=rng.normal(0,1,(512,512))
    cloth=image_tile("Cabin woven yarn",np.array([143,144,148])+
                     (weave*11+fleck*3.2+2.5*np.sin((xx+yy)*np.pi/12.8))[:,:,None])
    weave_normal=normal_tile("Cabin yarn relief",.48*weave+.06*fleck)
    grain=normal_tile("Cabin hide grain",.25*fleck+.11*np.roll(fleck,1,1))
    # A staggered perforation with a rounded depression in each cell.
    x=(xx+((yy//16)%2)*8)%16-8
    y=yy%16-8
    holes=np.exp(-(x*x+y*y)/4.8)
    seat=normal_tile("Cabin seat perforations",.25*fleck-4.3*holes)
    grille=image_tile("Cabin speaker grille",np.array([55,56,59])+
                      (1.5*fleck-33*np.exp(-(x*x+y*y)/14))[:,:,None])
    def texture(name,im,socket,strength=1):
        tree=out[name].node_tree
        tex=tree.nodes.new("ShaderNodeTexImage")
        tex.image=im
        principled=tree.nodes.get("Principled BSDF")
        if socket=='Normal':
            node=tree.nodes.new("ShaderNodeNormalMap")
            node.inputs['Strength'].default_value=strength
            tree.links.new(tex.outputs['Color'],node.inputs['Color'])
            tree.links.new(node.outputs['Normal'],principled.inputs[socket])
        else:
            tree.links.new(tex.outputs['Color'],principled.inputs[socket])
    texture('Dash weave',cloth,'Base Color')
    texture('Dash weave',weave_normal,'Normal',.72)
    texture('Speaker cloth',grille,'Base Color')
    texture('Seat centre',seat,'Normal',.78)
    for name in ('Wheel pad','Wheel leather','Seat hide','Upper dash','Door insert'):
        texture(name,grain,'Normal',.29 if name=='Upper dash' else .74)
    return out

