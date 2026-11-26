"""Headless proofs. Example: blender -b --factory-startup -P scripts/render_cabin.py -- 2"""
import sys
import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from math import radians,sin,cos,atan
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'renders'/'cabin'
sys.dont_write_bytecode=True


def sheet(folder,destination):
    from PIL import Image,ImageDraw,ImageFont
    font_file=Path('C:/Windows/Fonts/segoeui.ttf')
    font=ImageFont.truetype(str(font_file),19) if font_file.exists() else ImageFont.load_default()
    night_check=Path(destination).stem=='round4'
    studio_row=512 if night_check else 592
    sheet=Image.new('RGB',(1512,studio_row+970),(21,23,26))
    draw=ImageDraw.Draw(sheet)
    forward='Driver eye  /  forward' + ('  /  60° vertical' if night_check else '')
    right='Driver eye  /  20° right  /  60° vertical' if night_check else 'Driver eye  /  30° right'
    for name,x,y,title in [('forward',0,0,forward),('right',760,0,right),
                           ('studio',0,studio_row,'Wheel and console  /  studio')]:
        im=Image.open(Path(folder)/(name+'.jpg'))
        sheet.paste(im,(x,y+34))
        draw.text((x+12,y+3),title,fill=(226,226,226),font=font)
    sheet.save(destination,quality=75,optimize=True,subsampling=0)
    print('Wrote',destination,flush=True)


def preview_atlas(data,models):
    """Show the published diffuse bake, retaining live reflections and the unmapped wheel."""
    import bpy
    atlas=bpy.data.images.load(str(models/data['lightmap']['file']))
    atlas.colorspace_settings.name='sRGB'
    copies={}
    for name,path in data['mesh_lightmaps'].items():
        if not path:
            continue
        mesh=bpy.data.objects[name].data
        for slot,material in enumerate(mesh.materials):
            key=(material,mesh.uv_layers[1].name)
            if key not in copies:
                copy=material.copy()
                copies[key]=copy
                tree=copy.node_tree
                bsdf=next(n for n in tree.nodes if n.type=='BSDF_PRINCIPLED')
                base=bsdf.inputs['Base Color']
                metallic=bsdf.inputs['Metallic'].default_value
                uv=tree.nodes.new('ShaderNodeUVMap')
                uv.uv_map=key[1]
                tex=tree.nodes.new('ShaderNodeTexImage')
                tex.image=atlas
                tree.links.new(uv.outputs['UV'],tex.inputs['Vector'])
                diffuse=tree.nodes.new('ShaderNodeMixRGB')
                diffuse.blend_type='MULTIPLY'
                diffuse.inputs[0].default_value=1
                if base.is_linked:
                    original=base.links[0]
                    tree.links.new(original.from_socket,diffuse.inputs[1])
                    tree.links.remove(original)
                else:
                    diffuse.inputs[1].default_value=base.default_value
                tree.links.new(tex.outputs['Color'],diffuse.inputs[2])
                # Keep the metallic reflection colour. Replace the direct diffuse
                # lobe with albedo * decoded irradiance/pi on visible surfaces.
                base.default_value=[c*metallic for c in base.default_value[:3]]+[1.]
                tree.links.new(diffuse.outputs[0],bsdf.inputs['Emission Color'])
                strength=tree.nodes.new('ShaderNodeMath')
                strength.operation='MULTIPLY'
                strength.inputs[1].default_value=data['lightmap']['decode_scale']*(1-metallic)
                rays=tree.nodes.new('ShaderNodeLightPath')
                tree.links.new(rays.outputs['Is Camera Ray'],strength.inputs[0])
                tree.links.new(strength.outputs[0],bsdf.inputs['Emission Strength'])
            mesh.materials[slot]=copies[key]
    # A lit, blank display provides a value reference in the two stills.
    screen=bpy.data.materials['screen'].node_tree
    bsdf=next(n for n in screen.nodes if n.type=='BSDF_PRINCIPLED')
    bsdf.inputs['Emission Color'].default_value=(.24,.31,.39,1)
    screen.links.new(screen.nodes.new('ShaderNodeLightPath').outputs['Is Camera Ray'],
                     bsdf.inputs['Emission Strength'])


def main():
    import bpy
    from mathutils import Vector
    sys.path.insert(0,str(ROOT/'scripts'))
    import build_cabin
    from cabin.lighting import environment,gpu
    index=int(sys.argv[sys.argv.index('--')+1]) if '--' in sys.argv else 1
    assert 1<=index<=4
    asset=build_cabin.MODELS/'cabin.glb'
    if asset.exists() and (build_cabin.MODELS/'cabin.json').exists():
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(asset))
        bpy.context.scene.world=bpy.data.worlds.new('Proof sky')
        data=json.loads((build_cabin.MODELS/'cabin.json').read_text(encoding='utf-8'))
        eye=Vector(data['eye_driver'])
        center=data['stations']['screen_center']
    elif index<4:
        stations,_,_,_,eye,_,_=build_cabin.scene_model()
        center=stations['screen_center']
    else:
        raise FileNotFoundError('Round 4 needs the built cabin and its lightmap manifest')
    scene=gpu()
    scene.cycles.samples=40
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='JPEG'
    scene.render.image_settings.quality=90
    scene.view_settings.view_transform='AgX'
    cam=bpy.data.cameras.new('Proof camera')
    camera=bpy.data.objects.new('Proof camera',cam)
    bpy.context.collection.objects.link(camera)
    scene.camera=camera
    cam.clip_start=.014
    def shot(name,position,yaw,down,fov,width,height,vertical=False):
        a,p=radians(yaw),radians(down)
        camera.location=position
        direction=Vector((cos(a)*cos(p),-sin(a)*cos(p),-sin(p)))
        camera.rotation_euler=direction.to_track_quat('-Z','Y').to_euler()
        cam.sensor_fit='VERTICAL' if vertical else 'HORIZONTAL'
        cam.angle=radians(fov)
        scene.render.resolution_x=width
        scene.render.resolution_y=height
        if vertical:
            top=max(v.y/-v.z for v in cam.view_frame(scene=scene))
            assert abs(2*atan(top)-radians(fov))<1e-5
        scene.render.filepath=str(Path(folder)/(name+'.jpg'))
        bpy.ops.render.render(write_still=True)
    OUT.mkdir(parents=True,exist_ok=True)
    with tempfile.TemporaryDirectory(dir=OUT,prefix='proof-') as folder:
        environment(True,center)
        shot('studio',eye+Vector((-.180,.331,.065)),39.,24.5,70,1512,936)
        environment(False,center)
        if index==4:
            preview_atlas(data,build_cabin.MODELS)
            shot('forward',eye,0,0,60,752,470,vertical=True)
            shot('right',eye,20,0,60,752,470,vertical=True)
        else:
            shot('forward',eye,10.5,15.5,75,752,550)
            shot('right',eye,30,17,75,752,550)
        subprocess.run([shutil.which('python.exe'),str(Path(__file__).resolve()),'compose',
                        folder,str(OUT/f'round{index}.jpg')],check=True)


if __name__=='__main__':
    if sys.argv[1:2]==['compose']:
        sheet(sys.argv[2],sys.argv[3])
    else:
        main()

