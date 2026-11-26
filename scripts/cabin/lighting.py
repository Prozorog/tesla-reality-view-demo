"""Identical sources for the bake and the night proof, plus a neutral studio rig."""
from mathutils import Vector
import bpy
from .finish import color


def gpu():
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    prefs=bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type='OPTIX'
    devices=prefs.get_devices_for_type('OPTIX')
    for device in devices:
        device.use=device.type=='OPTIX'
    device=next(d for d in devices if d.use)
    print('Cycles OptiX:',device.name,flush=True)
    scene.cycles.device='GPU'
    scene.cycles.seed=17
    scene.cycles.max_bounces=5
    scene.cycles.diffuse_bounces=3
    scene.cycles.use_denoising=True
    scene.render.threads_mode='FIXED'
    scene.render.threads=4
    return scene


def area(name,loc,target,power,swatch,size,second=None):
    lamp=bpy.data.lights.new(name,'AREA')
    lamp.energy=power
    lamp.color=color(swatch)[:3]
    lamp.shape='RECTANGLE'
    lamp.size=size
    lamp.size_y=second or size
    ob=bpy.data.objects.new(name,lamp)
    bpy.context.collection.objects.link(ob)
    ob.location=loc
    ob.rotation_euler=(Vector(target)-Vector(loc)).to_track_quat('-Z','Y').to_euler()
    return ob


def environment(studio,screen_center):
    scene=bpy.context.scene
    for lamp in list(bpy.data.lights):
        bpy.data.lights.remove(lamp,do_unlink=True)
    world=scene.world
    tree=world.node_tree
    tree.nodes.clear()
    bg=tree.nodes.new('ShaderNodeBackground')
    bg.inputs[0].default_value=color('becce1' if studio else '95a9c0')
    bg.inputs[1].default_value=.50 if studio else .027
    # Open window rays see only a sky gradient. No scenic geometry is part of the asset.
    rays=tree.nodes.new('ShaderNodeLightPath')
    tex=tree.nodes.new('ShaderNodeTexCoord')
    sep=tree.nodes.new('ShaderNodeSeparateXYZ')
    tree.links.new(tex.outputs['Generated'],sep.inputs[0])
    ramp=tree.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color=color('b1bac1' if studio else '21283c')
    ramp.color_ramp.elements[1].position=.60
    ramp.color_ramp.elements[1].color=color('d4d7dc' if studio else '080e1b')
    tree.links.new(sep.outputs['Z'],ramp.inputs[0])
    sky=tree.nodes.new('ShaderNodeBackground')
    tree.links.new(ramp.outputs[0],sky.inputs[0])
    mix=tree.nodes.new('ShaderNodeMixShader')
    tree.links.new(rays.outputs['Is Camera Ray'],mix.inputs[0])
    tree.links.new(bg.outputs[0],mix.inputs[1])
    tree.links.new(sky.outputs[0],mix.inputs[2])
    tree.links.new(mix.outputs[0],tree.nodes.new('ShaderNodeOutputWorld').inputs[0])

    if studio:
        area('Softbox through windshield',(2.9,-.5,2.28),(1.4,.16,.69),115,'fff2e4',1.65,1.1)
        area('Driver window bounce',(1.28,1.46,1.54),(1.88,.10,.89),53,'e3ecff',.95,.76)
        area('Passenger window bounce',(1.25,-1.48,1.70),(1.77,0,.67),100,'ecf0ff',1.7,.85)
        area('Upholstery fill',(.63,.18,1.36),(1.9,.15,.79),17,'fff1df',.85,.57)
    else:
        area('Dusk through driver window',(1.23,1.27,1.38),(1.84,.20,.77),
             1.60,'c0ceda',.90,.50)
        area('Windshield dusk',(2.64,-.31,1.67),(1.95,-.21,.83),
             1.90,'c4d4e1',1.36,.77)
        area('Rear glass dusk',(.82,.10,1.40),(1.93,.16,.86),
             1.35,'c4d4e1',.84,.58)
        # The concealed face of the guide washes the cove. Sample its built
        # position so the strip wash follows changes to the body stations.
        guide=bpy.data.objects['light_strip']
        points=[guide.matrix_world @ p.co for p in guide.data.vertices]
        width=max(p.y for p in points)
        swatch=guide['srgb_color']
        for i in range(8):
            y=width*((i+.5)/4-1)
            point=max((p for p in points if abs(p.y-y)<.017),key=lambda p:p.x)
            loc=point+Vector((-.007,0,.005))
            area('Dash guide '+str(i),loc,loc+Vector((-.10,0,-.045)),
                 .045,swatch,width/4,.005)
        # Sample the rails along X so the wash turns with each door.
        start=min(p.x for p in points)
        for side in (-1,1):
            rail=[p for p in points if p.y*side>width*.90]
            end=max(p.x for p in rail)-.10
            span=(end-start)/7
            for i in range(7):
                x=start+(i+.5)*span
                point=max((p for p in rail if abs(p.x-x)<.025),key=lambda p:p.y*side)
                loc=Vector((x,point.y-side*.008,point.z+.004))
                area(f'Door guide {side} {i}',loc,loc+Vector((0,-side*.065,-.055)),
                     .027,swatch,span,.005)
        c=Vector(screen_center)
        area('Display face',c+Vector((-.003,0,.001)),c+Vector((-.38,0,.054)),
             1.9,'cee3ff',.329,.205)
        # A little scattered light reaches the fascia beside the display.
        area('Display edge bounce',c+Vector((0,.188,.025)),c+Vector((.20,.32,.06)),
             .30,'cee3ff',.085,.12)

