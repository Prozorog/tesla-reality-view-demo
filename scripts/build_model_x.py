"""Headless Model X authoring and Cycles comparison. Pass -- round-number (or export).
The reference images are read only by the separate comparison script."""
import sys, os, json, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
sys.dont_write_bytecode=True
import bpy
import numpy as np
from mathutils import Vector, Matrix
from model3.mesh import finish, linear
from modelx import panels as P, details as D
# -- N renders study round N; -- export writes hero.glb/hero.json and the parked
# LODs; -- mesh saves the evaluated triangles only; -- features N samples the
# visible material boundaries for round N.
argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else ['9']
arg=argv[0]
export=arg=='export'
P.R=int(argv[1]) if arg=='features' and len(argv)>1 else (10 if arg in ('export','mesh','features') else int(arg))
out=ROOT/'tmp'/'model-x'/(arg if arg in ('export','mesh') else 'round'+str(P.R));out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene
P.CAM=json.loads((ROOT/'scripts/modelx/cameras.json').read_text())
def mat(key,color,metal,rough,coat=0,em=None,power=0):
    m=finish(key,color,metal,rough,coat,em,power,1.5)
    m.node_tree.nodes['Principled BSDF'].inputs['Coat Roughness'].default_value=.04
    P.M[key]=m
mat('paint','#FAFAFA',.015,.43,.42)
P.M['paint'].node_tree.nodes['Principled BSDF'].inputs['Coat Roughness'].default_value=.23
mat('glass','#252C32',.04,.14,.24)
mat('roofglass','#27313A',.04,.23,.14)
mat('blackglass','#111316',.06,.075,.3)
mat('clad','#242527',.0,.55);mat('seal','#101114',0,.76)
# Shut-line backing: the painted jamb in its own shadow, not an ink outline.
mat('gap','#5C5F62',0,.72);mat('sill','#202123',0,.5)
mat('lamp','#A9B0B8',.3,.16)
mat('chrome','#D8DDDF',1,.08);mat('mirror','#CFD9DC',1,.035)
mat('alloy','#26282A',.78,.25);mat('rubber','#202022',0,.85)
mat('sidewall','#292A2B',0,.81);mat('rotor','#393B3A',.82,.39);mat('caliper','#342929',.4,.32)
mat('opticmetal','#84909D',.85,.16);mat('housing','#191B21',.47,.25);mat('lens','#B9C4D1',0,.045,1);mat('smoke','#7A3F44',0,.08,.8)
for label,alpha in [('lens',.14),('smoke',.31)]:
    P.M[label].node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value=alpha
for key,col,em,power in [('led','#E3E5F1','#EEF7FF',.45),('red','#6B1220','#FF1639',.032),('brake','#6B1C20','#FF111D',.015),('amber','#60584D','#FF9E2A',.025)]:
    mat(key,col,.28,.27,0,em,power)
mat('upholstery','#353A3A',0,.78);mat('frontglass','#29343A',0,.13,.16);mat('windscreen','#29343A',0,.13,.16)
# Tinted glass shows the cabin faintly, as in the overhead photo.
for key,alpha in [('glass',.80),('frontglass',.64),('roofglass',.75)]:
    P.M[key].node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value=alpha
for key in ('glass','roofglass','frontglass','windscreen'):
    P.M[key].node_tree.nodes['Principled BSDF'].inputs['Coat Roughness'].default_value=.26
tint=bpy.data.images.new('Panoramic gradient',width=64,height=2,alpha=True)
tint.alpha_mode='STRAIGHT';tint.colorspace_settings.name='Non-Color'
pixels=[]
for y in range(2):
    for x in range(64):
        pixels.extend([1,1,1,.85-.29*(x/63)**.85])
tint.pixels.foreach_set(pixels);tint.pack()
nt=P.M['windscreen'].node_tree
im=nt.nodes.new('ShaderNodeTexImage');im.image=tint;im.extension='EXTEND'
nt.links.new(im.outputs['Alpha'],nt.nodes['Principled BSDF'].inputs['Alpha'])
from modelx import glazing
glass=P.shell();D.wheels();D.trim();D.match_quarter_normals();glazing.install(glass)
def evaluated():
    points=[];triangles=[];counts={}
    dg=bpy.context.evaluated_depsgraph_get()
    for ob in list(scene.objects):
        if ob.type not in ('MESH','FONT'):continue
        evaluated=ob.evaluated_get(dg);mesh=evaluated.to_mesh();mesh.calc_loop_triangles()
        n=len(mesh.vertices);t=len(mesh.loop_triangles);counts[ob.name]=t
        vs=np.empty(n*3,dtype=np.float32);mesh.vertices.foreach_get('co',vs)
        mat=np.array(evaluated.matrix_world)
        tr=np.empty(3*t,dtype=np.int32);mesh.loop_triangles.foreach_get('vertices',tr)
        triangles.append(tr.reshape(-1,3)+sum(len(v) for v in points))
        points.append(vs.reshape(-1,3)@mat[:3,:3].T+mat[:3,3]);evaluated.to_mesh_clear()
    return np.vstack(points),np.vstack(triangles),counts
vs,tris,counts=evaluated(); print('Triangle count:',len(tris),flush=True)
if arg in ('export','mesh'):
    np.savez_compressed(out/'geometry.npz',vertices=vs,triangles=tris)
if arg=='mesh':sys.exit()
if export:
    models=ROOT/'public/models';file=models/'hero.glb'
    if len(tris)>180000:raise ValueError('Exceeded export triangle budget: '+str(len(tris)))
    for ob in list(scene.objects):
        if ob.type=='FONT':
            bpy.context.view_layer.objects.active=ob;ob.select_set(True);bpy.ops.object.convert(target='MESH');ob.select_set(False)
    bpy.ops.export_scene.gltf(filepath=str(file),export_format='GLB',export_apply=True,export_yup=True,export_animations=False)
    lo=vs.min(0);hi=vs.max(0)
    data=dict(source='Blender panel model of the pre-2021 Tesla Model X P100D',units='metres',gltf_mapping='(x,z,-y)',
      bounding_box=dict(min=lo.tolist(),max=hi.tolist(),size=(hi-lo).tolist(),body_width=2.),stations=dict(front_bumper=float(hi[0]),rear_bumper=float(lo[0]),trunk_lip=[-1.035,0,1.08],rear_camera=[float(lo[0])-.012,0,.933],head_lamp=list(D.stamp('front',255,389,.016)),tail_lamp=list(D.stamp('rear',225,350,.016))),
      wheelbase=P.WB,track=P.TRACK,wheel_radius=P.RADIUS,wheel_centres={o.name:list(o.location) for o in scene.objects if o.name.startswith('wheel_')},
      total_triangles=len(tris),triangles=counts)
    # Parked copies: the same finished model, reduced, in the node layout of meshy-passengers.ts.
    from modelx import lod
    lods=lod.export_lods(scene,P.M,models,P.RADIUS,P.TRACK,P.WB)
    data['lod_triangles']={k:sum(v.values()) for k,v in lods.items()};data['lod_parts']=lods
    print('LOD',json.dumps(lods),flush=True)
    (models/'hero.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf8')
    print(file,models/'hero.json');sys.exit()
# Sample material boundaries as seen by the fitted camera. An apparent glass edge
# can be formed by the foreground bonnet even where the physical cowl seam is hidden.
if arg=='features':
    dg=bpy.context.evaluated_depsgraph_get()
    classes={}
    for ob in scene.objects:
        if ob.type not in ('MESH','FONT'):continue
        name=ob.name
        kind=1 if ('glass' in name.lower() or 'windscreen' in name.lower() or name=='Falcon roof') else 0
        if name.startswith(('Arch moulding','Lower sill','front lower','rear lower')):kind=2
        if name.startswith(('Optic housing','Polycarbonate','Fog recess')):kind=3
        if name.startswith(('Painted roof frame','Window header','Quarter light lower corner','Ceramic edge','Recess','Windscreen ceramic border')):kind=0
        classes[name]=kind
    ids={}
    for view,c in P.CAM.items():
        eye=Vector(c['location']);right=Vector(c['right']);up=Vector(c['up']);forward=-Vector(c['back'])
        vx=[right*((x+.5-c['cx'])/c['focal_px']) for x in range(0,1376,2)]
        labels=np.zeros((384,688),dtype=np.uint8)
        for j,y in enumerate(range(0,768,2)):
            base=forward+up*((c['cy']-y-.5)/(c['focal_px']*c['aspect']))
            for i,delta in enumerate(vx):
                hit,_,_,_,ob,_=scene.ray_cast(dg,eye,(base+delta).normalized())
                if hit:labels[j,i]=classes.get(ob.name,0)
        ids[view]=labels
    np.savez_compressed(out/'visible-regions.npz',**ids)
    print(out/'visible-regions.npz',flush=True);sys.exit()
# Save evaluated geometry for the native-resolution binary mask renderer.
np.savez_compressed(out/'geometry.npz',vertices=vs,triangles=tris)
def cameras():
    for key,c in P.CAM.items():
        data=bpy.data.cameras.new(key);o=bpy.data.objects.new(key,data);scene.collection.objects.link(o)
        r=Matrix([c['right'],c['up'],c['back']]).transposed()
        o.matrix_world=r.to_4x4();o.location=c['location']; data.sensor_fit='HORIZONTAL';data.lens=c['focal_px']*36/1376
        data.shift_x=(688-c['cx'])/1376;data.shift_y=(c['cy']-384)/(1376*c['aspect'])
        yield key,o
cams=list(cameras());dg=bpy.context.evaluated_depsgraph_get()
overlays={}
for view,cam in cams:
    strokes=[]
    for pts in P.LINES:
        visible=[]
        for a,b in zip(pts,pts[1:]):
            p,q=Vector(a),Vector(b)
            for j in range(max(1,math.ceil((q-p).length/.014))):
                w=p.lerp(q,j/max(1,math.ceil((q-p).length/.014)))
                sight=cam.location-w
                hit,loc,*_=scene.ray_cast(dg,cam.location,-sight.normalized(),distance=sight.length+.01)
                if not hit or (loc-w).length<.017:visible.append(P.proj(view,w))
                elif visible:
                    if len(visible)>1:strokes.append(visible)
                    visible=[]
        if len(visible)>1:strokes.append(visible)
    overlays[view]=strokes
(out/'features.json').write_text(json.dumps(overlays),encoding='utf8')
def light(name,pos,target,power,size,width):
    data=bpy.data.lights.new(name,'AREA');data.shape='ELLIPSE';data.specular_factor=.065;data.energy=power;data.size=size;data.size_y=width
    ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.location=pos;ob.visible_glossy=False
    ob.rotation_euler=(Vector(target)-ob.location).to_track_quat('-Z','Y').to_euler()
world=bpy.data.worlds.new('Studio');scene.world=world;world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.36,.36,.36,1)
world.node_tree.nodes['Background'].inputs[1].default_value=.48
mat('cyclorama','#848484',0,.82)
# Circular cyclorama lets all four fixed cameras use the same seamless studio.
m=P.Mesh()
for a,b in zip(P.seq(0,2*math.pi,96),P.seq(0,2*math.pi,96)[1:]):
    profile=[(.001,-.002),(7,-.002),(9,-.002),(10,.25),(10.7,1),(11,2),(11,9)]
    for (r,z),(s,h) in zip(profile,profile[1:]):
        def pos(rad,ang,zz):return (1.4+1.6*rad*math.cos(ang),1.6*rad*math.sin(ang),zz)
        m.face([pos(r,a,z),pos(r,b,z),pos(s,b,h),pos(s,a,h)],'cyclorama',(0,0,1) if z<0 else (-math.cos(a),-math.sin(a),0))
sweep=P.obj('Grey sweep',m);sweep.visible_glossy=False
stone=P.M['cyclorama'];nt=stone.node_tree;bsdf=nt.nodes['Principled BSDF']
coord=nt.nodes.new('ShaderNodeTexCoord');noise=nt.nodes.new('ShaderNodeTexNoise')
noise.inputs['Scale'].default_value=4.2;noise.inputs['Detail'].default_value=3.2
nt.links.new(coord.outputs['Object'],noise.inputs['Vector'])
ramp=nt.nodes.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.14,.14,.14,1);ramp.color_ramp.elements[1].color=(.31,.31,.31,1)
nt.links.new(noise.outputs['Fac'],ramp.inputs[0]);nt.links.new(ramp.outputs[0],bsdf.inputs['Base Color'])
bsdf.inputs['Emission Color'].default_value=(.19,.19,.19,1);normal=nt.nodes.new('ShaderNodeNewGeometry');axis=nt.nodes.new('ShaderNodeSeparateXYZ')
inv=nt.nodes.new('ShaderNodeMath');inv.operation='SUBTRACT';inv.inputs[0].default_value=.95;inv.use_clamp=True
nt.links.new(normal.outputs['Normal'],axis.inputs[0]);nt.links.new(axis.outputs['Z'],inv.inputs[1]);nt.links.new(inv.outputs[0],bsdf.inputs['Emission Strength'])
# A continuous, feathered studio environment reflects in the paint and glazing.
ww,hh=512,256;v,u=np.mgrid[0:hh,0:ww];lat=(v/hh-.5)*math.pi;lon=(u/ww-.5)*2*math.pi
field=.17+.32*np.maximum(0,np.sin(lat))+.28*np.exp(-((lat-.1)/.23)**2)
for az,el,width,height,gain in [(3.09,.96,1.08,.33,6.0),(0,.91,1.12,.35,4.8),(1.6,.53,1.2,.27,2.2),(-1.2,.59,1.1,.23,1.7),(.25,1.25,.9,.23,4.4),(-1.57,.26,1.45,.095,4.5)]:
    angle=np.arctan2(np.sin(lon-az),np.cos(lon-az))
    field+=gain*np.exp(-(angle/width)**4-((lat-el)/height)**4)
pixels=np.ones((hh,ww,4),np.float32);pixels[:,:,:3]=field[:,:,None];pixels[:,:,2]*=1.10;pixels[:,:,0]*=.98
hdr=bpy.data.images.new('Silk gradient',width=ww,height=hh,float_buffer=True);hdr.pixels.foreach_set(pixels.ravel())
env=world.node_tree.nodes.new('ShaderNodeTexEnvironment');env.image=hdr
wt=world.node_tree;bg=wt.nodes['Background'];base=wt.nodes.new('ShaderNodeBackground')
base.inputs[0].default_value=(.36,.36,.38,1);base.inputs[1].default_value=.42
lightpath=wt.nodes.new('ShaderNodeLightPath');switch=wt.nodes.new('ShaderNodeMixShader')
wt.links.new(env.outputs[0],bg.inputs[0]);wt.links.new(lightpath.outputs['Is Glossy Ray'],switch.inputs[0])
wt.links.new(base.outputs[0],switch.inputs[1]);wt.links.new(bg.outputs[0],switch.inputs[2])
wt.links.new(switch.outputs[0],wt.nodes['World Output'].inputs[0])
light('Ceiling silk',(1,0,5),(1,0,0),650,6,3.1)
light('Driver strip',(1,3.7,2.9),(1,0,.8),375,6,.8)
light('Passenger softbox',(2.3,-4,2.8),(1,0,.9),420,4,1.5)
light('Tail strip',(-3,1,3.3),(0,0,.9),290,3,1.2)
scene.render.engine='CYCLES';scene.cycles.samples=16;scene.cycles.use_denoising=True
prefs=bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type='OPTIX';prefs.get_devices()
    for dev in prefs.devices:dev.use=dev.type=='OPTIX'
    if any(d.use for d in prefs.devices):scene.cycles.device='GPU'
except RuntimeError as error:print(error)
scene.render.threads_mode='FIXED';scene.render.threads=4
scene.render.resolution_x=1376;scene.render.resolution_y=768;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='JPEG';scene.render.image_settings.quality=93
scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
for view,cam in cams:
    scene.camera=cam;aspect=P.CAM[view]['aspect']
    scene.render.pixel_aspect_x=max(1,aspect);scene.render.pixel_aspect_y=max(1,1/aspect)
    scene.render.filepath=str(out/(view+'.jpg'));bpy.ops.render.render(write_still=True)
    print(scene.render.filepath,flush=True)

