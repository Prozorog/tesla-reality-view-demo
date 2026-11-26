"""Build the Highland front cabin in metres, +X nose, +Y driver side, +Z up."""
import sys
import time
import json
from pathlib import Path
from math import pi
import bpy
from mathutils import Vector

# DESIGN §2 baseline. The published cabin fit pins the body stations below.
COWL_XZ=(2.30,.98)
HEADER_XZ=(1.35,1.38)
ROOF_PEAK_XZ=(1.,1.442)
BODY_HALF_WIDTH=.924
DRIVER_EYE=(1.38,.37,1.14)
WHEEL_CENTER=(1.80,.37,.90)
SCREEN_CENTER=(1.93,0.,.93)
WHEEL_DIAMETER=.370
COLUMN_TILT=22.
SCREEN_ACTIVE=(.3317,.2073)
SCREEN_TILT=8.
STRIP_COLOR='#ff2a1f'
# Fit inside the nominal stations: column reach and seat track adjustments.
FITTED_WHEEL=(WHEEL_CENTER[0]+.030,WHEEL_CENTER[1]+.021,WHEEL_CENTER[2])
FITTED_EYE=(DRIVER_EYE[0]-.025,DRIVER_EYE[1]-.005,DRIVER_EYE[2]+.023)
FITTED_SCREEN=(SCREEN_CENTER[0],SCREEN_CENTER[1]-.009,SCREEN_CENTER[2])
EYE_FROM_HIP=(.130,0.,.635)

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
sys.dont_write_bytecode=True
from cabin import controls, shell, interior
from cabin.geometry import Part,v
from cabin.finish import materials
from cabin.lighting import gpu,environment
from cabin.baking import make_atlas, MAP_NAME
from cabin.audit import verify

MODELS=ROOT/'public'/'models'


def read_stations():
    reference={'cowl':COWL_XZ,'header':HEADER_XZ,'roof_peak':ROOF_PEAK_XZ,
               'body_half_width':BODY_HALF_WIDTH,'eye_driver':FITTED_EYE,
               'steering_wheel_center':FITTED_WHEEL,'screen_center':FITTED_SCREEN,
               'wheel_diameter':WHEEL_DIAMETER,'column_tilt_deg':COLUMN_TILT}
    # model3.json was revised after the cabin's fit was published. Retain
    # its source stations as built in 6c99d9f, including on a clean checkout.
    path=ROOT/'scripts'/'cabin'/'body_fit.json'
    applied={}
    if path.exists():
        doc=json.loads(path.read_text(encoding='utf-8-sig'))
        values=doc.get('stations',doc)
        def flat(obj,stem=''):
            for k,val in obj.items():
                key=''.join(c.lower() for c in k if c.isalnum())
                yield stem+key,val
                if isinstance(val,dict):
                    yield from flat(val,stem+key)
        lookup=dict(flat(values))
        aliases={
            'cowl':['windshieldBase','windshieldBaseXZ','windshieldCowl','cowl','cowlXZ'],
            'header':['windshieldHeader','windshieldHeaderXZ','header','headerXZ'],
            'roof_peak':['roofPeak','roofPeakXZ'],
            'body_half_width':['halfWidthBody','bodyHalfWidth','halfWidth','bodyHalfWidthM'],
            'eye_driver':['eyeDriver','driverEye','driverEyeBlender'],
            'steering_wheel_center':['steeringWheelCenter','steeringWheelCentre','wheelPivot'],
            'screen_center':['screenCenter','screenCentre','displayCenter'],
            'wheel_diameter':['steeringWheelDiameter'],
            'column_tilt_deg':['columnTiltDeg','steeringColumnTiltDeg']}
        def convert(key,val):
            original=reference[key]
            if isinstance(original,float):
                return float(val)
            if isinstance(val,dict):
                if 'x' in val and 'z' in val:
                    return tuple(float(val[c]) for c in ('xz' if len(original)==2 else 'xyz'))
                for k in ('xz','xyz','center','centre','position','blender'):
                    if k in val:
                        return convert(key,val[k])
            if isinstance(val,(tuple,list)) and len(val)>=len(original):
                if len(original)==2:
                    return (float(val[0]),float(val[-1]))
                return tuple(map(float,val[:3]))
            raise ValueError('unrecognised station')
        for key,names in aliases.items():
            for alias in names:
                raw=lookup.get(alias.lower())
                if raw is not None:
                    try:
                        reference[key]=convert(key,raw)
                        applied[key]=alias
                        break
                    except (ValueError,TypeError):
                        pass
        body_width=doc.get('bounding_box',{}).get('body_width')
        if body_width and 'body_half_width' not in applied:
            reference['body_half_width']=float(body_width)*.5
            applied['body_half_width']='bounding_box.body_width / 2'
        for key in ('inner_cabin_half_width_dash','inner_cabin_half_width_b_pillar',
                    'a_pillar_base','a_pillar_top','hood_front_edge'):
            if key in values:
                reference[key]=values[key]
                applied[key]=key
        print('Body station overrides:',applied,flush=True)
    else:
        raise FileNotFoundError(path)
    reference['source']='public/models/model3.json'
    reference['body_fields_used']=applied
    return reference


def mapper(stations):
    # Longitudinal interpolation pins the frame at header and cowl. Height
    # correction is faded towards the floor so the body ground origin stays fixed.
    def interpolate(t,lo,hi,a,b):
        t=max(0,min(1,(t-lo)/(hi-lo)))
        return a+(b-a)*t
    xz=[(ROOF_PEAK_XZ,stations['roof_peak']),(HEADER_XZ,stations['header']),
        (COWL_XZ,stations['cowl'])]
    def base_warp(p):
        x,y,z=p
        (a,aa),(b,bb)=xz[:2] if x<HEADER_XZ[0] else xz[1:]
        dx=interpolate(x,a[0],b[0],aa[0]-a[0],bb[0]-b[0])
        dz=interpolate(x,a[0],b[0],aa[1]-a[1],bb[1]-b[1])
        if 'inner_cabin_half_width_dash' in stations and 'inner_cabin_half_width_b_pillar' in stations:
            scale=interpolate(x,.96,2.18,stations['inner_cabin_half_width_b_pillar']/.81,
                              stations['inner_cabin_half_width_dash']/.784)
        else:
            scale=stations['body_half_width']/BODY_HALF_WIDTH
        return Vector((x+dx,y*scale,
                       z+dz*max(0,min(1,(z-.30)/.66))))
    if not all(k in stations for k in ('a_pillar_base','a_pillar_top')):
        return base_warp
    lower=Vector(stations['a_pillar_base']['left'])+Vector((-.006,-.028,.010))
    upper=Vector(stations['a_pillar_top']['left'])+Vector((0,-.026,-.008))
    da=lower-base_warp((2.215,.794,.956))
    db=upper-base_warp((1.345,.617,1.380))
    def warp(p):
        x,y,z=p
        side=max(0,min(1,(abs(y)-.35)/(.26 if z>1.29 else .43)))
        mix=max(0,min(1,(z-.956)/.424))
        delta=da.lerp(db,mix)*side*max(0,min(1,(z-.86)/.096))
        if y<0:
            delta.y=-delta.y
        return base_warp(p)+delta
    return warp


def scene_model():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    scene.world=bpy.data.worlds.new('Cabin illumination')
    scene.unit_settings.system='METRIC'
    stations=read_stations()
    warp=mapper(stations)
    palette=materials(STRIP_COLOR)
    strip=Part('light_strip',palette,warp,mapped=False)
    transverse=shell.dash(palette,warp)
    right=shell.door(palette,warp,-1,transverse[0])
    left=shell.door(palette,warp,1,transverse[-1])
    strip.tube(right[:-1]+transverse+left[-2::-1],.003,'Light guide',10,guide=(0,0,1),aspect=.8)
    strip.finish()['srgb_color']=STRIP_COLOR
    shell.openings(palette,warp)
    interior.console(palette,warp)
    interior.footwell(palette,warp)
    wheel,axis=controls.steering(palette,stations['steering_wheel_center'],stations['column_tilt_deg'],
                                 stations['wheel_diameter'])
    surface=controls.screen(palette,stations['screen_center'],SCREEN_TILT,*SCREEN_ACTIVE)

    # Sight from the seated H-point; retain at least 330 mm of eye-to-column reach.
    hip=v(stations['eye_driver'])-v(EYE_FROM_HIP)
    hip.x=min(hip.x,wheel.location.x-.330-EYE_FROM_HIP[0])
    eye=hip+v(EYE_FROM_HIP)
    # A final body can place the rim across the screen's left edge. Slide the
    # seat back along its real track until the entire active rectangle clears.
    def rim_angle(ex):
        return max((eye.y-p.y)/(p.x-ex) for p in rim)
    bpy.context.view_layer.update()
    rim=[wheel.matrix_world @ pt.co for pt in wheel.data.vertices]
    screen_left=max(c.y for c,_ in surface)+.008
    screen_far=max(c.x for c,_ in surface)
    for _ in range(31):
        if rim_angle(eye.x)+.004 < (eye.y-screen_left)/(screen_far-eye.x):
            break
        hip.x-=.004
        eye=hip+v(EYE_FROM_HIP)
    interior.seats(palette,None,hip)
    marker=bpy.data.objects.new('eye_driver',None)
    bpy.context.collection.objects.link(marker)
    marker.empty_display_size=.018
    marker.location=eye
    scene_objects=list(scene.objects)
    return stations,wheel,axis,surface,eye,hip,scene_objects


def xyz(p):
    return [round(float(t),7) for t in p]


def three(p):
    return xyz((p[0],p[2],-p[1]))


def main():
    start=time.perf_counter()
    stations,wheel,axis,corners,eye,hip,objects=scene_model()
    scene=gpu()
    environment(False,stations['screen_center'])
    MODELS.mkdir(parents=True,exist_ok=True)
    maps=MODELS/'lightmaps'
    maps.mkdir(exist_ok=True)
    receivers=[o for o in objects if o.type=='MESH' and o.get('lightmap_receiver')]
    atlas=make_atlas(receivers,maps/MAP_NAME)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    glb=MODELS/'cabin.glb'
    bpy.ops.export_scene.gltf(filepath=str(glb),export_format='GLB',use_selection=True,
        export_animations=False,export_yup=True,export_texcoords=True,export_normals=True,
        export_tangents=True,export_extras=True,export_cameras=False,export_lights=False)
    uri='lightmaps/'+MAP_NAME
    mapping={o.name:uri if o in receivers else None for o in objects if o.type=='MESH'}
    data={
        'coordinates':'Blender car space, metres: +X forward, +Y left, +Z up. glTF = (x,z,-y).',
        'stations':stations,'eye_driver':xyz(eye),'eye_driver_gltf':three(eye),
        'driver_seat_h_point':xyz(hip),
        'steering_wheel':{'pivot':xyz(wheel.location),'pivot_gltf':three(wheel.location),
            'axis_blender_local':[0,0,1],'axis_gltf_local':[0,1,0],
            'axis_car_space':xyz(axis),'axis_gltf_world':three(axis)},
        'screen_surface':{'width_m':SCREEN_ACTIVE[0],'height_m':SCREEN_ACTIVE[1],
            'tilt_deg':SCREEN_TILT,'material':'screen',
            'corners':[{'position':xyz(c),'position_gltf':three(c),'uv':list(uv)} for c,uv in corners]},
        'strip_color':STRIP_COLOR,'mesh_lightmaps':mapping,
        'lightmap':{'file':uri,'texCoord':1,'three_channel':1,'color_space':'sRGB',
                    'flipY':False,**atlas}}
    data['triangles'],data['validation']=verify(glb,data)
    data['total_triangles']=sum(data['triangles'].values())
    data['build_seconds']=round(time.perf_counter()-start,2)
    manifest=MODELS/'cabin.json'
    manifest.write_text(json.dumps(data,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
    for name,count in data['triangles'].items():
        print(f'{name:36s} {count:7d} triangles')
    print('TOTAL:',data['total_triangles'],'triangles;',data['build_seconds'],'seconds')
    for path in (glb,maps/MAP_NAME,manifest):
        print('Wrote',path)


if __name__=='__main__':
    main()

