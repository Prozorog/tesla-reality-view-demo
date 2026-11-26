"""Repair the user-owned Meshy Model S, export its runtime LODs, and render reviews.

Run with Blender 5.2 in background mode. Source GLB and studio reference are read-only.
Blender coordinates use +X forward, +Y left, +Z up. glTF exports (x,z,-y).
"""
import argparse
import json
import math
import os
import shutil
import struct
import subprocess
import sys
from pathlib import Path
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
REF = Path(os.environ.get('TESLA_REF_DIR', ROOT.parent / 'ref'))
SOURCE = Path(os.environ.get('TESLA_MESHY_SOURCE', REF / 'Meshy_AI_White_Tesla_Model_S_Collage_20261123_texture.glb'))
OUTPUT = ROOT / 'public' / 'models'
REVIEWS = ROOT / 'renders' / 'hero'
REFERENCE = REF / 'meshy' / '02-parked-cars' / 'tesla-model-s-front-left.png'
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / 'scripts'))


def compose(number):
    from PIL import Image, ImageDraw, ImageFont, ImageOps
    font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 21)
    small = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 16)
    keys = [('top','Top'),('front','Front'),('rear','Rear'),('side','Side'),
            ('quarter','High rear three-quarter'),('zebra_front','Front zebra'),
            ('zebra_rear','Rear zebra'),('night','Warm parking lamp')]
    width, cell_height = 2400, 544
    sheet = Image.new('RGB', (width, 65 + cell_height * len(keys)), (29,31,34))
    draw = ImageDraw.Draw(sheet)
    draw.text((16,12),f'Meshy Model S repair / round {number} / repaired left / untouched Meshy centre / official studio right',font=font,fill='white')
    ref = Image.open(REFERENCE).convert('RGB')
    for row,(key,label) in enumerate(keys):
        y=65+row*cell_height
        for column,kind in enumerate(['hero','source','reference']):
            im = ref if kind=='reference' else Image.open(REVIEWS / f'round{number}_{kind}_{key}.png').convert('RGB')
            tile=ImageOps.contain(im,(792,508),Image.Resampling.LANCZOS)
            sheet.paste(tile,(800*column+(800-tile.width)//2,y+(508-tile.height)//2))
        draw.text((16,y+509),label,font=small,fill=(235,235,235))
        draw.text((816,y+509),'Untouched source / same view and lighting',font=small,fill=(195,199,203))
        draw.text((1616,y+509),'Tesla official studio reference / front-left',font=small,fill=(195,199,203))
    out=REVIEWS / f'round{number}.jpg'
    sheet.save(out,quality=88,optimize=True)
    print(f'REVIEW OUTPUT {out} ({sheet.width} x {sheet.height})',flush=True)


def build(number):
    import bpy
    import bmesh
    import numpy as np
    from mathutils import Matrix, Vector
    from mathutils.bvhtree import BVHTree
    from model3.mesh import Mesh, cord, finish, grid, interpolate, path, steps
    start=perf_counter()
    REVIEWS.mkdir(parents=True,exist_ok=True)
    OUTPUT.mkdir(parents=True,exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene
    scene.unit_settings.system='METRIC'
    bpy.ops.import_scene.gltf(filepath=str(SOURCE))
    original=next(o for o in scene.objects if o.type=='MESH')
    bpy.context.view_layer.objects.active=original
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    coords=np.empty(len(original.data.vertices)*3,dtype=np.float32)
    original.data.vertices.foreach_get('co',coords)
    coords=coords.reshape(-1,3)
    original_triangles=len(original.data.polygons)
    source_length=float(np.ptp(coords[:,0]))
    scale=4.72/source_length
    source_rear_axle=.5419
    source_front_axle=-.5952
    source_ground=float(coords[:,2].min())
    # Nose is -X in the source, confirmed by source_front_candidate/rear_candidate renders.
    transform=Matrix(((-scale,0,0,source_rear_axle*scale),
                      (0,-scale,0,0),(0,0,scale,-source_ground*scale),(0,0,0,1)))
    original.data.transform(transform)
    original.name='Untouched_Meshy'
    original.hide_render=True
    original.hide_set(True)
    original_mat=original.data.materials[0]
    raw=original.copy();raw.data=original.data.copy();scene.collection.objects.link(raw)
    raw.name='body';raw.hide_render=False;raw.hide_set(False)
    original.select_set(False);raw.select_set(True)
    bpy.context.view_layer.objects.active=raw
    # Weld UV islands before smoothing. Otherwise the UV seams become dents.
    bm=bmesh.new();bm.from_mesh(raw.data)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0006)
    bm.to_mesh(raw.data);bm.free()
    raw.data.materials.clear()
    mats={
        'paint':finish('Pearl White Paint clearcoat','#e9eceb',.35,.19,1),
        'glass':finish('Near-black panoramic glass','#04080c',.15,.075,.85),
        'trim':finish('Satin black trim','#111419',.2,.33),
        'liner':finish('Matte wheelhouse felt','#080a0c',0,.95),
        'seam':finish('Even panel closure shadow','#07090b',0,.7),
        'rubber':finish('Black tyre rubber','#101216',0,.75),
        'barrel':finish('Dark turbine wheel barrel','#1c2026',.65,.27),
        'metal':finish('Brushed silver badge','#bfc5ca',.82,.22),
        'lens':finish('Smoked lamp housing','#0b111a',.35,.14,.6),
        'head':finish('Headlight white DRL','#dceeff',.25,.18,0,'#e5f3ff',3),
        'tail':finish('Tail signature ruby','#8f0b13',.25,.17,0,'#ff1620',2),
        'brake':finish('Brake ruby','#31070a',.25,.18,0,'#ff1220',.01),
        'reverse':finish('Reverse white','#b7c3cc',.2,.16,0,'#eff5ff',.01),
        'turn_l':finish('Left indicator amber','#78360a',.2,.18,0,'#ff8708',.01),
        'turn_r':finish('Right indicator amber','#78360a',.2,.18,0,'#ff8708',.01),
        'caliper':finish('Red fixed brake caliper','#be1820',.2,.3,.25),
        'disc':finish('Steel brake rotor','#474d55',.8,.34),
    }
    for key in ['liner','rubber','seam']:
        mats[key].node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value=.2
    raw.data.materials.append(mats['paint'])
    # Regular quad retopology sampled from the original replaces the irregular
    # AI triangulation. Fairing the radial samples removes small normal ripples
    # before subdivision, while retaining the source's measured silhouette.
    depsgraph=bpy.context.evaluated_depsgraph_get()
    source_skin=BVHTree.FromObject(original,depsgraph)
    if number==1:
        raw.data.remesh_voxel_size=.020
        raw.data.remesh_voxel_adaptivity=0
        bpy.ops.object.voxel_remesh()
        smooth=raw.modifiers.new('First-round source fairing','SMOOTH');smooth.factor=.85;smooth.iterations=18
        bpy.ops.object.modifier_apply(modifier=smooth.name)
    else:
        nx,nt=144,64
        minx=min(v.co.x for v in original.data.vertices)
        maxx=max(v.co.x for v in original.data.vertices)
        xs=np.linspace(minx+.003,maxx-.003,nx+1)
        rings=np.zeros((nx+1,nt,2))
        for i,x in enumerate(xs):
            for j in range(nt):
                a=2*math.pi*j/nt
                direction=Vector((0,-math.cos(a),-math.sin(a)))
                startpoint=Vector((float(x),5*math.cos(a),.60+5*math.sin(a)))
                hit,normal,_,_=source_skin.ray_cast(startpoint,direction,10)
                # Skip the mirrors while reconstructing the body section.
                for attempt in range(8):
                    if hit is None or not (abs(hit.y)>.90 and 1.60<hit.x<2.12 and hit.z>.90):break
                    hit,normal,_,_=source_skin.ray_cast(hit+direction*.004,direction,10)
                if hit is None:
                    hit=Vector((float(x),0,.60))
                rings[i,j]=(hit.y,hit.z)
        # Match opposite sides before smoothing, without any UV-island seams.
        for j in range(nt):
            other=(nt//2-j)%nt
            y=(np.abs(rings[:,j,0])+np.abs(rings[:,other,0]))*.5
            z=(rings[:,j,1]+rings[:,other,1])*.5
            rings[:,j,0]=np.sign(math.cos(2*math.pi*j/nt))*y
            rings[:,j,1]=z
        def fair(values,axis,sigma,mode):
            radius=math.ceil(sigma*3)
            kernel=np.exp(-.5*(np.arange(-radius,radius+1)/sigma)**2);kernel/=kernel.sum()
            pad=[(0,0)]*values.ndim;pad[axis]=(radius,radius)
            padded=np.pad(values,pad,mode=mode)
            return np.apply_along_axis(lambda row:np.convolve(row,kernel,mode='valid'),axis,padded)
        rings=fair(fair(rings,0,2.7,'edge'),1,1.55,'wrap')
        verts=[(float(x),float(rings[i,j,0]),float(rings[i,j,1])) for i,x in enumerate(xs) for j in range(nt)]
        faces=[]
        for i in range(nx):
            for j in range(nt):
                k=(j+1)%nt
                faces.append((i*nt+j,i*nt+k,(i+1)*nt+k,(i+1)*nt+j))
        faces.append(tuple(reversed(range(nt))))
        faces.append(tuple(nx*nt+j for j in range(nt)))
        mesh=bpy.data.meshes.new('Faired source cross-section quad surface');mesh.from_pydata(verts,[],faces);mesh.materials.append(mats['paint']);mesh.update()
        raw.data=mesh
        bm=bmesh.new();bm.from_mesh(raw.data);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(raw.data);bm.free()
        subdiv=raw.modifiers.new('Continuous reflection surface','SUBSURF');subdiv.levels=1
        bpy.ops.object.modifier_apply(modifier=subdiv.name)
    # Retain uniform source scale, then recover the small longitudinal fairing loss.
    # All geometry including wheels is scaled by the same factor.
    xs=[v.co.x for v in raw.data.vertices]
    final_scale=4.72/(max(xs)-min(xs))
    raw.data.transform(Matrix.Scale(final_scale,4))
    original.data.transform(Matrix.Scale(final_scale,4))
    scale*=final_scale
    axles=[0.,(source_rear_axle-source_front_axle)*scale]
    radius=.1608*scale
    wheel_width=.248
    track=1.652
    # The remade tyre is tangent to the ground; the body remains at source height.
    print(f'SOURCE {original_triangles:,} triangles; UNIFORM SCALE {scale:.8f}; wheelbase {axles[1]:.5f}; radius {radius:.5f}; track {track:.5f}',flush=True)
    # Split the original mirror silhouettes before cutting the four fused wheels.
    bm=bmesh.new();bm.from_mesh(raw.data)
    # Extract mirror shells from the source itself, since retopology skips them.
    mirror_source=bmesh.new();mirror_source.from_mesh(original.data)
    mirror_faces=[f for f in mirror_source.faces if abs(f.calc_center_median().y)>.91 and 1.61<f.calc_center_median().x<2.10 and f.calc_center_median().z>.90]
    mirror_geometry=[]
    for sign in [1,-1]:
        faces=[f for f in mirror_faces if f.calc_center_median().y*sign>0]
        verts=list({v for f in faces for v in f.verts});ids={v:i for i,v in enumerate(verts)}
        mirror_geometry.append(([tuple(v.co) for v in verts],[[ids[v] for v in f.verts] for f in faces]))
    mirror_source.free()
    wheel_faces=[]
    for face in bm.faces:
        p=face.calc_center_median()
        if abs(p.y)>.59 and any((p.x-x)**2+(p.z-radius)**2<(.442**2) for x in axles):
            wheel_faces.append(face)
    if number==1:
        bmesh.ops.delete(bm,geom=wheel_faces,context='FACES')
    # Remove isolated remnants of the original tyre inside each wheelhouse.
    loose=[v for v in bm.verts if not v.link_faces]
    if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
    bm.to_mesh(raw.data);bm.free()
    if number==1:
        dec=raw.modifiers.new('Hero paint budget','DECIMATE');dec.ratio=min(1,61000/max(1,len(raw.data.polygons)*2));dec.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier=dec.name)
    else:
        for axle in axles:
            bpy.ops.mesh.primitive_cylinder_add(vertices=96,radius=.442,depth=3,location=(axle,0,radius),rotation=(math.pi/2,0,0))
            cutter=bpy.context.object
            bpy.context.view_layer.objects.active=raw
            cut=raw.modifiers.new('Clean continuous wheel arch','BOOLEAN');cut.operation='DIFFERENCE';cut.solver='EXACT';cut.object=cutter
            bpy.ops.object.modifier_apply(modifier=cut.name)
            bpy.data.objects.remove(cutter,do_unlink=True)
    for p in raw.data.polygons:p.use_smooth=True
    if number>2:
        # Restore the source fender width lost to cross-section fairing. The
        # height and length retain the same source scale.
        source_width=max(abs(v.co.y) for v in original.data.vertices if v.co.z<.90)*2
        faired_width=max(abs(v.co.y) for v in raw.data.vertices)*2
        for v in raw.data.vertices:v.co.y*=source_width/faired_width
        raw.data.update()
    # Surface lookup for clean glass/lamp/closure boundaries; no baked AI colour remains.
    depsgraph=bpy.context.evaluated_depsgraph_get()
    skin=BVHTree.FromObject(raw,depsgraph)
    def project(point,direction,offset=.003):
        p,n,_,_=skin.ray_cast(Vector(point),Vector(direction),10)
        if p is None:
            p,n,_,_=skin.find_nearest(Vector(point))
        return p+n*offset
    def top(x,y,offset=.004):return project((x,y,3),(0,0,-1),offset)
    def side(x,z,sign,offset=.004):return project((x,sign*2,z),(0,-sign,0),offset)
    def rear(y,z,offset=.005):return project((-3,y,z),(1,0,0),offset)
    def front(y,z,offset=.005):return project((6,y,z),(-1,0,0),offset)
    names='glass trim_black lights_head lights_tail lights_brake lights_reverse indicators_left indicators_right mirror_L mirror_R wordmark'.split()
    parts={n:Mesh() for n in names}
    # A smooth, closed, simple canopy laid over the faired source shell.
    # Cross-sections follow the Model S roof footprint, with a narrow even frit band.
    canopy=[(-.735,.43),(-.68,.61),(-.47,.685),(.0,.703),(.65,.718),(1.30,.728),(1.75,.737),(2.25,.761),(2.40,.72),(2.46,.56),(2.475,.28)]
    us=[i/96 for i in range(97)]
    def canopy_point(u,v):
        x=canopy[0][0]+u*(canopy[-1][0]-canopy[0][0])
        half=interpolate(canopy,x)
        return top(x,(2*v-1)*half)
    grid(parts['glass'],us,steps(32),canopy_point,'glass',(0,0,1))
    for v in [0,1]:
        cord(parts['trim_black'],[canopy_point(u,v) for u in us],.010,'trim',6)
    for u in [0,1]:
        cord(parts['trim_black'],[canopy_point(u,v) for v in steps(28)],.010,'trim',6)
    # Painted roof rails remain visible between panoramic and side glazing.
    # Side glazing uses a single clean perimeter and straight, polished B pillars.
    side_bottom=[(-.16,1.13),(.22,1.048),(1.10,1.015),(2.06,1.025)]
    side_top=[(-.16,1.13),(.15,1.22),(.55,1.305),(.95,1.355),(1.30,1.35),(1.62,1.28),(2.06,1.025)]
    for sign in [1,-1]:
        def glazing(u,v):
            x=-.16+u*2.22
            a=interpolate(side_bottom,x);b=interpolate(side_top,x)
            return side(x,a+(b-a)*v,sign)
        grid(parts['glass'],steps(72),steps(14),glazing,'glass',(0,sign,0))
        outline=[glazing(u,0) for u in steps(72)]+[glazing(u,1) for u in reversed(steps(72))]
        cord(parts['trim_black'],outline+[outline[0]],.011,'trim',6)
        for x in [.37,1.36]:
            z0=interpolate(side_bottom,x);z1=interpolate(side_top,x)
            cord(parts['trim_black'],[side(x,z0+(z1-z0)*v,sign,.009) for v in steps(12)],.016,'trim',6)
    # Door seams and flush handles are re-authored at a consistent 7 mm width.
    for sign in [1,-1]:
        for controls in [
            [(2.04,1.014),(2.10,.88),(2.18,.64),(2.25,.34)],
            [(1.35,.995),(1.33,.82),(1.31,.58),(1.29,.31)],
            [(.19,1.003),(.24,.86),(.38,.63),(.56,.32)],
            [(.55,.32),(1.25,.305),(2.25,.34)],
        ]:
            points=[side(x,z,sign,.003) for x,_,z in path([(x,0,z) for x,z in controls],55)]
            cord(parts['trim_black'],points,.0035,'seam',4)
        for x in [.63,1.83]:
            points=[side(x+.15*(v-.5),.965,sign,.006) for v in steps(12)]
            cord(parts['trim_black'],points,.013,'trim',6)
        # Liner closes both radial and back faces behind every steering angle.
        for axle in axles:
            for j in range(64):
                a=-.35+(math.pi+.7)*j/64;b=-.35+(math.pi+.7)*(j+1)/64
                outer=.454
                p=[(axle+outer*math.cos(t),sign*y,max(.025,radius+outer*math.sin(t))) for t,y in [(a,.585),(a,.88),(b,.88),(b,.585)]]
                parts['trim_black'].face(p,'liner')
            ring=[(axle+.448*math.cos(2*math.pi*j/64),sign*.592,max(.025,radius+.448*math.sin(2*math.pi*j/64))) for j in range(64)]
            parts['trim_black'].face(ring,'liner',outward=(0,sign,0),smooth=False)
    # Closed body booleans and felt backplates seal the underside of the arches.
    # Smooth 3D lamp outlines, fitted to the Meshy lens silhouettes.
    def patch_polygon(mesh,points,material,projector):
        centre=tuple(sum(p[k] for p in points)/len(points) for k in range(len(points[0])))
        for i,p in enumerate(points):
            q=points[(i+1)%len(points)]
            if number<3:
                mesh.face([projector(*centre),projector(*p),projector(*q)],material)
                continue
            divisions=8
            def sample(a,b):
                return projector(*(centre[k]*(1-a-b)+p[k]*a+q[k]*b for k in range(len(p))))
            for a in range(divisions):
                for b in range(divisions-a):
                    mesh.face([sample(a/divisions,b/divisions),sample((a+1)/divisions,b/divisions),sample(a/divisions,(b+1)/divisions)],material)
                    if a+b<divisions-1:
                        mesh.face([sample((a+1)/divisions,b/divisions),sample((a+1)/divisions,(b+1)/divisions),sample(a/divisions,(b+1)/divisions)],material)
    head_outline=[(3.53,.47),(3.49,.62),(3.28,.817),(3.16,.845),(3.235,.745),(3.46,.48)]
    for sign in [1,-1]:
        sample=lambda x,y:top(x,sign*y,.008)
        patch_polygon(parts['trim_black'],head_outline,'lens',sample)
        drl=[(3.52,.49),(3.48,.62),(3.28,.808),(3.18,.84),(3.24,.765)]
        pts=[sample(x,y) for x,_,y in path([(x,0,y) for x,y in drl],42)]
        cord(parts['lights_head'],pts,.009,'head',6)
        # Front corner inlet treatment.
        cord(parts['trim_black'],[side(3.39,.40,sign,.009),side(3.54,.40,sign,.009)],.018,'trim',6)
        # Rear wraparound lamp has a horizontal inner portion and tapered outer wing.
        tail_points=[(.39,.99),(.66,1.008),(.84,.97),(.873,.90),(.69,.902),(.41,.927)]
        rs=lambda y,z:rear(sign*y,z,.008)
        patch_polygon(parts['trim_black'],tail_points,'lens',rs)
        tail_line=[(.42,.97),(.65,.983),(.826,.951),(.835,.922),(.68,.924),(.45,.942)]
        cord(parts['lights_tail'],[rs(y,z) for y,_,z in path([(y,0,z) for y,z in tail_line],48)],.009,'tail',6)
        cord(parts['lights_brake'],[rs(y,.948) for y in [.47,.55,.63,.70]],.012,'brake',6)
        cord(parts['lights_reverse'],[rs(y,.916) for y in [.40,.47,.54]],.008,'reverse',6)
        turn='indicators_left' if sign>0 else 'indicators_right'
        material='turn_l' if sign>0 else 'turn_r'
        cord(parts[turn],[rs(y,.945) for y in [.72,.77,.82]],.009,material,6)
        cord(parts[turn],[sample(x,y) for x,y in [(3.19,.835),(3.26,.80)]],.006,material,6)
        # Black rear valance and red bumper reflectors.
        cord(parts['trim_black'],[rear(sign*y,.34,.007) for y in [.0,.18,.36,.55]],.018,'trim',6)
    cord(parts['lights_brake'],[top(-.47,y,.01) for y in [-.21,-.1,0,.1,.21]],.007,'brake',6)
    patch_polygon(parts['trim_black'],[(-.64,.42),(.64,.42),(.60,.30),(-.60,.30)],'trim',lambda y,z:front(y,z,.009))
    cord(parts['trim_black'],[front(y,.72,.007) for y in [-.25,-.15,0,.15,.25]],.015,'trim',6)
    # Bonnet and boot closure lines are clean and stay inside the original contour.
    for sign in [1,-1]:
        pts=[top(x,sign*y,.003) for x,_,y in path([(2.43,0,.70),(2.85,0,.71),(3.25,0,.61),(3.54,0,.43)],55)]
        cord(parts['trim_black'],pts,.0035,'seam',4)
        cord(parts['trim_black'],[rear(sign*y,z,.003) for y,z in [(0,.818),(.43,.818),(.59,.84),(.63,.91)]],.0035,'seam',4)
    # Both corrupt texture labels disappear with the original colour map.
    # Individual letters keep the requested small, widely spaced clean wordmark.
    def text_mesh(text,loc,rot,size,name):
        curve=bpy.data.curves.new(name,'FONT');curve.body=text;curve.align_x='CENTER';curve.align_y='CENTER';curve.size=size;curve.extrude=.0007;curve.bevel_depth=.00025;curve.resolution_u=3
        ob=bpy.data.objects.new(name,curve);scene.collection.objects.link(ob);ob.location=loc;ob.rotation_euler=rot;ob.data.materials.append(mats['metal'])
        bpy.ops.object.select_all(action='DESELECT');ob.select_set(True);bpy.context.view_layer.objects.active=ob;bpy.ops.object.convert(target='MESH')
        return ob
    rear_badge_point=rear(0,.987,.006)
    letters=text_mesh('T E S L A',rear_badge_point,(math.pi/2,0,-math.pi/2),.046,'clean_wordmark_letters')
    # Tesla T made from a clean top arc and tapered stem, front and rear.
    for projector,height in [(front,.78),(rear,1.08)]:
        pts=[projector(y,height+.008*(1-(y/.037)**2),.008) for y in [-.039,-.025,0,.025,.039]]
        cord(parts['wordmark'],pts,.004,'metal',6)
        p1=projector(-.007,height-.004,.008);p2=projector(.007,height-.004,.008);p3=projector(0,height-.055,.008)
        parts['wordmark'].face([p1,p2,p3],'metal',smooth=False)
    # Source mirror shells are retained and receive the player's paint parameter.
    for index,name in enumerate(['mirror_L','mirror_R']):
        verts,faces=mirror_geometry[index]
        data=bpy.data.meshes.new(name+' closed source shell');data.from_pydata(verts,[],faces);data.materials.append(mats['paint']);data.update()
        ob=bpy.data.objects.new(name+'_source',data);scene.collection.objects.link(ob)
        bm=bmesh.new();bm.from_mesh(data);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0006)
        boundary=[e for e in bm.edges if e.is_boundary]
        if boundary:bmesh.ops.holes_fill(bm,edges=boundary,sides=0)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(data);bm.free()
        bpy.context.view_layer.objects.active=ob
        sm=ob.modifiers.new('Clean mirror shell','SMOOTH');sm.factor=.7;sm.iterations=12;bpy.ops.object.modifier_apply(modifier=sm.name)
        dec=ob.modifiers.new('Mirror budget','DECIMATE');dec.ratio=min(1,650/max(1,len(data.polygons)));dec.use_collapse_triangulate=True;bpy.ops.object.modifier_apply(modifier=dec.name)
        for face in ob.data.polygons:parts[name].face([tuple(ob.data.vertices[i].co) for i in face.vertices],'paint')
        bpy.data.objects.remove(ob,do_unlink=True)
        sign=1 if name.endswith('L') else -1
        # Small sealed black backing also closes the extraction cut.
        centre=(1.855,sign*.987,1.044)
        for j in range(24):
            a=2*math.pi*j/24;b=2*math.pi*(j+1)/24
            p=lambda t:(centre[0]-.030,centre[1]+.068*math.cos(t),centre[2]+.037*math.sin(t))
            parts[name].face([centre,p(a),p(b)],'glass')
    # Trace the source's ten paired, swept turbine spokes as clean closed
    # solids. The textured AI face has hundreds of disconnected UV islands and
    # cannot be reduced into a clean rotating rim. The source determines the
    # turbine sweep, dark finishes, wheel dimensions and fixed red caliper.
    mats['wheel_front']=finish('Turbine graphite faces','#303740',.83,.27,.25)
    mats['wheel_edge']=finish('Turbine machined bevel','#626a73',.88,.23,.35)
    rimob=None
    wheel_origins={}
    for axle_index,axle in enumerate(axles):
        for sign in [1,-1]:
            name='wheel_'+('R' if axle_index==0 else 'F')+('L' if sign>0 else 'R')
            origin=(axle,sign*track/2,radius)
            wheel_origins[name]=origin
            wheel=Mesh()
            # Smooth rounded sidewalls, radial tread and lip. Closed annular solid.
            sections=[(.285,-.115),(.342,-.118),(.384,-.093),(radius,-.058),(radius,.055),(.384,.098),(.342,.118),(.285,.112)]
            for j in range(64):
                a=2*math.pi*j/64;b=2*math.pi*(j+1)/64
                for k in range(len(sections)):
                    r,y=sections[k];s,v=sections[(k+1)%len(sections)]
                    wheel.face([(r*math.cos(a),y,r*math.sin(a)),(r*math.cos(b),y,r*math.sin(b)),(s*math.cos(b),v,s*math.sin(b)),(s*math.cos(a),v,s*math.sin(a))],'rubber')
                for y in [-.050,.050]:
                    # Opaque face/barrel closes all spoke holes.
                    wheel.face([(0,y,0),(.310*math.cos(a),y,.310*math.sin(a)),(.310*math.cos(b),y,.310*math.sin(b))],'barrel',smooth=False)
                wheel.face([(.310*math.cos(a),-.050,.310*math.sin(a)),(.310*math.cos(b),-.050,.310*math.sin(b)),(.310*math.cos(b),.050,.310*math.sin(b)),(.310*math.cos(a),.050,.310*math.sin(a))],'barrel')
                for y in [-.113,.117]:
                    wheel.face([(.306*math.cos(a),y,.306*math.sin(a)),(.306*math.cos(b),y,.306*math.sin(b)),(.318*math.cos(b),y,.318*math.sin(b)),(.318*math.cos(a),y,.318*math.sin(a))],'barrel')
            # Closed graphite rim lip and hub, with bevels that catch lamps.
            for j in range(64):
                a=2*math.pi*j/64;b=2*math.pi*(j+1)/64
                section=[(.302,.101),(.307,.115),(.321,.115),(.328,.102),(.322,.085),(.303,.085)]
                for k,(r,y) in enumerate(section):
                    q,z=section[(k+1)%len(section)]
                    wheel.face([(r*math.cos(a),sign*y,r*math.sin(a)),(r*math.cos(b),sign*y,r*math.sin(b)),(q*math.cos(b),sign*z,q*math.sin(b)),(q*math.cos(a),sign*z,q*math.sin(a))], 'wheel_edge' if k==1 else 'barrel')
                # Rotor is recessed behind the paired blades and fixed caliper.
                wheel.face([(0,sign*.064,0),(.268*math.cos(a),sign*.064,.268*math.sin(a)),(.268*math.cos(b),sign*.064,.268*math.sin(b))],'disc',smooth=False)
                for y in [.108,.130]:
                    wheel.face([(0,sign*y,0),(.067*math.cos(a),sign*y,.067*math.sin(a)),(.067*math.cos(b),sign*y,.067*math.sin(b))],'wheel_front',smooth=False)
                wheel.face([(.067*math.cos(a),sign*.108,.067*math.sin(a)),(.067*math.cos(b),sign*.108,.067*math.sin(b)),(.067*math.cos(b),sign*.130,.067*math.sin(b)),(.067*math.cos(a),sign*.130,.067*math.sin(a))],'wheel_edge')
            for spoke in range(10):
                base=2*math.pi*spoke/10
                for pair in [-1,1]:
                    rings=[]
                    for j in range(7):
                        t=j/6;r=.059+(.310-.059)*t
                        angle=base+.20*t+pair*.065*t
                        width=.056-.031*t
                        y=.114+.010*math.sin(math.pi*t)
                        rings.append([(r*math.cos(angle-width),sign*y,r*math.sin(angle-width)),
                                      (r*math.cos(angle+width),sign*y,r*math.sin(angle+width)),
                                      (r*math.cos(angle+width),sign*.095,r*math.sin(angle+width)),
                                      (r*math.cos(angle-width),sign*.095,r*math.sin(angle-width))])
                    wheel.face(list(reversed(rings[0])),'barrel')
                    wheel.face(rings[-1],'barrel')
                    for j in range(6):
                        for k in range(4):
                            material='wheel_front' if k==0 else 'wheel_edge' if k==1 else 'barrel'
                            wheel.face([rings[j][k],rings[j][(k+1)%4],rings[j+1][(k+1)%4],rings[j+1][k]],material)
            wheelob=wheel.object(name,mats)
            # Paired blades share the hub root. Remove their identical hidden
            # closing face before serialization and parked decimation.
            wheelob.data.validate(clean_customdata=True)
            wheelob.data.update()
            wheelob.location=origin
            # A fixed caliper behind the source spokes remains stationary while
            # the wheel spins. Dark barrel and rotor close the wheel behind it.
            caliper=[(axle+x,origin[1]+sign*y,radius+z) for x,y,z in
                     [(.15,.070,-.11),(.24,.070,-.10),(.24,.070,.12),(.15,.070,.13),
                      (.15,.102,-.11),(.24,.102,-.10),(.24,.102,.12),(.15,.102,.13)]]
            for face in [(0,1,2,3),(4,7,6,5),(0,4,5,1),(1,5,6,2),(2,6,7,3),(3,7,4,0)]:
                parts['trim_black'].face([caliper[k] for k in face],'caliper')
    for name,mesh in parts.items():
        if mesh.faces:mesh.object(name,mats)
    # Merge clean vector lettering into its named badge node.
    badges=bpy.data.objects.get('wordmark')
    if badges is not letters:
        bpy.ops.object.select_all(action='DESELECT');letters.select_set(True);badges.select_set(True);bpy.context.view_layer.objects.active=badges;bpy.ops.object.join();badges.name='wordmark'
    hero_objects=[o for o in scene.objects if o.type=='MESH' and o not in [original,rimob]]
    for o in hero_objects:
        o.hide_render=False;o.hide_set(False)
    def export(file,objects):
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.select_set(True)
        temporary=file.with_name(file.stem+'.next.glb')
        bpy.ops.export_scene.gltf(filepath=str(temporary),export_format='GLB',use_selection=True,export_yup=True,export_cameras=False,export_lights=False)
        doc=read_glb(temporary)
        temporary.replace(file)
        counts={}
        for n in doc['nodes']:
            if 'mesh' in n:
                counts[n['name']]=sum(doc['accessors'][p['indices']]['count']//3 for p in doc['meshes'][n['mesh']]['primitives'])
        print(f'OUTPUT {file}\nTRIANGLES {sum(counts.values()):,} {counts}',flush=True)
        return counts
    hero_counts=export(OUTPUT/'hero.glb',hero_objects)
    assert sum(hero_counts.values())<=150000,hero_counts
    required=set('body glass trim_black lights_head lights_tail lights_brake lights_reverse indicators_left indicators_right mirror_L mirror_R wordmark wheel_FL wheel_FR wheel_RL wheel_RR'.split())
    assert set(hero_counts)==required,(set(hero_counts)-required,required-set(hero_counts))
    doc=read_glb(OUTPUT/'hero.glb')
    nodes={n['name']:n for n in doc['nodes']}
    for name,centre in wheel_origins.items():
        expected=(centre[0],centre[2],-centre[1])
        assert max(abs(a-b) for a,b in zip(nodes[name]['translation'],expected))<.00001,(name,nodes[name])
        assert not any(k in nodes[name] for k in ['rotation','matrix','scale']),nodes[name]
    # LODs keep the node schema, with a compact flat material on the wheel faces.
    def lod_export(filename,budget):
        copies=[]
        total=sum(hero_counts.values())
        ratio=budget*.86/total
        for ob in hero_objects:
            if budget < 2000 and not (ob.name in ['body','glass'] or ob.name.startswith('wheel_')):
                continue
            clone=ob.copy();clone.data=ob.data.copy();scene.collection.objects.link(clone);clone.name=ob.name+'_lodcopy';copies.append(clone)
            bpy.context.view_layer.objects.active=clone
            clone.hide_set(False)
            if ob.name.startswith('wheel_'):
                bm=bmesh.new();bm.from_mesh(clone.data)
                textured=[f for f in bm.faces if clone.data.materials[f.material_index]==original_mat]
                if textured:bmesh.ops.delete(bm,geom=textured,context='FACES')
                loose=[v for v in bm.verts if not v.link_faces]
                if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
                bm.to_mesh(clone.data);bm.free()
            if len(clone.data.polygons)>12:
                dec=clone.modifiers.new('Static parked mesh reduction','DECIMATE');dec.ratio=ratio;dec.use_collapse_triangulate=True
                bpy.ops.object.modifier_apply(modifier=dec.name)
            if ob.name.startswith('wheel_'):
                clone.data.materials.clear();clone.data.materials.append(mats['barrel'])
                for p in clone.data.polygons:p.material_index=0
            clone.data.validate(clean_customdata=True);clone.data.update()
            ob.name=ob.name+'_hero';clone.name=ob.name[:-5]
        counts=export(OUTPUT/filename,copies)
        assert sum(counts.values())<=budget,(filename,counts)
        for clone in copies:bpy.data.objects.remove(clone,do_unlink=True)
        for ob in hero_objects:
            if ob.name.endswith('_hero'):ob.name=ob.name[:-5]
        return sum(counts.values())
    lod_triangles=lod_export('hero_lod.glb',15000)
    far_triangles=lod_export('hero_far.glb',1500)
    bb=[o.matrix_world@Vector(c) for o in hero_objects for c in o.bound_box]
    mins=[min(p[k] for p in bb) for k in range(3)];maxs=[max(p[k] for p in bb) for k in range(3)]
    body_width=max(v.co.y for v in raw.data.vertices)*2
    metadata={'units':'metres','axes':'Blender XYZ: forward, left, up. Ground origin under rear axle.',
              'gltf_mapping':'(x, z, -y)','source':SOURCE.name,'source_triangles':original_triangles,
              'source_nose':'-X, established from textured front/rear inspection renders',
              'uniform_scale':scale,'triangles':hero_counts,'total_triangles':sum(hero_counts.values()),
              'lod_triangles':lod_triangles,'far_triangles':far_triangles,
              'bounding_box':{'min':mins,'max':maxs,'size':[b-a for a,b in zip(mins,maxs)],'body_width':body_width},
              'wheel_centres':wheel_origins,'wheel_radius':radius,'wheel_width':wheel_width,'wheelbase':axles[1],'track':track,
              'stations':{'front_bumper':max(v.co.x for v in raw.data.vertices),'rear_bumper':min(v.co.x for v in raw.data.vertices),
                          'trunk_lip':tuple(top(-.84,0)), 'front_axle':axles[1],'rear_axle':0.,'ground_clearance':.14},
              'review_round':number}
    (OUTPUT/'hero.json').write_text(json.dumps(metadata,indent=2)+'\n',encoding='utf-8')
    print(f'OUTPUT {OUTPUT / "hero.json"}',flush=True)
    review(scene,original,hero_objects,mats,number,axles[1],radius)
    subprocess.run([shutil.which('python'),str(Path(__file__).resolve()),'--compose','--round',str(number)],check=True)
    print(f'FINISHED {sum(hero_counts.values()):,} triangles / {lod_triangles:,} parked / {far_triangles:,} far. {perf_counter()-start:.1f}s',flush=True)


def read_glb(file):
    with file.open('rb') as stream:
        stream.read(12)
        length,kind=struct.unpack('<I4s',stream.read(8))
        assert kind==b'JSON'
        return json.loads(stream.read(length))


def review(scene,source,hero,mats,number,wheelbase,radius):
    import bpy
    from mathutils import Vector
    from model3.mesh import finish
    scene.render.engine='CYCLES'
    prefs=bpy.context.preferences.addons['cycles'].preferences;prefs.compute_device_type='OPTIX';prefs.refresh_devices()
    selected=[d for d in prefs.devices if d.type=='OPTIX' and '4070' in d.name]
    if not selected:raise RuntimeError('RTX 4070 OptiX device unavailable')
    for d in prefs.devices:d.use=d in selected
    scene.cycles.device='GPU';scene.cycles.samples=20;scene.cycles.use_denoising=True;scene.cycles.max_bounces=5;scene.cycles.seed=17
    scene.render.threads_mode='FIXED';scene.render.threads=4
    scene.render.resolution_x=1000;scene.render.resolution_y=635;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
    scene.view_settings.view_transform='AgX'
    world=bpy.data.worlds.new('Review studio');world.use_nodes=True;scene.world=world
    bg=world.node_tree.nodes.get('Background');bg.inputs['Color'].default_value=(.58,.65,.77,1);bg.inputs['Strength'].default_value=.33
    coord=world.node_tree.nodes.new('ShaderNodeTexCoord')
    wave=world.node_tree.nodes.new('ShaderNodeTexWave');wave.wave_type='BANDS';wave.bands_direction='X';wave.inputs['Scale'].default_value=5
    ramp=world.node_tree.nodes.new('ShaderNodeValToRGB');ramp.color_ramp.interpolation='CONSTANT';ramp.color_ramp.elements[0].position=.53;ramp.color_ramp.elements[0].color=(.002,.002,.002,1);ramp.color_ramp.elements[1].position=.69;ramp.color_ramp.elements[1].color=(3,3,3,1)
    world.node_tree.links.new(coord.outputs['Normal'],wave.inputs['Vector']);world.node_tree.links.new(wave.outputs['Fac'],ramp.inputs['Fac'])
    bpy.ops.mesh.primitive_plane_add(size=100,location=(0,0,-.009));floor=bpy.context.object
    floormat=finish('Studio neutral floor','#45484d',0,.56);floor.data.materials.append(floormat)
    camdata=bpy.data.cameras.new('Review lens');cam=bpy.data.objects.new('Review camera',camdata);scene.collection.objects.link(cam);scene.camera=cam
    def aim(ob,p):ob.rotation_euler=(Vector(p)-ob.location).to_track_quat('-Z','Y').to_euler()
    def light(name,loc,power,width,height,color=(1,1,1)):
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='RECTANGLE';data.size=width;data.size_y=height;data.color=color
        ob=bpy.data.objects.new(name,data);scene.collection.objects.link(ob);ob.location=loc;aim(ob,(1.35,0,.65));return ob
    studio=[light('Long overhead silk',(1,2.4,5.3),650,6,.85),light('Front edge strip',(5,-3,3.7),500,4,.6),light('Rear softbox',(-3,-2,2.5),380,3,.8),light('Door strip',(1.2,-5,1.8),150,6,.4)]
    # Real strips in a black environment make reflection continuity visible.
    zebra=[]
    for i in range(9):
        zebra.append(light('Zebra reflected strip '+str(i),(-2+i*.85,-1.7,4.8),100,.16,7))
    for ob in zebra:ob.hide_render=True
    night=light('Warm lot lamp',(-2.4,-2.9,6.2),1850,1.2,.7,(1,.64,.37));night.hide_render=True
    views=[('top',(1.35,0,10),(1.35,0,.5),5.5),('front',(11.5,0,1.2),(2.2,0,.65),3.2),
           ('rear',(-9,0,1.25),(.2,0,.7),3.2),('side',(1.35,-10,.85),(1.35,0,.74),5.5),
           ('quarter',(-4,-6.6,5),(1.25,0,.7),0),('zebra_front',(7,-7,4),(1.5,0,.7),0),
           ('zebra_rear',(-5,-6,3.5),(1.1,0,.7),0),('night',(-4,-6.5,7),(1.35,0,.6),0)]
    black=finish('Gloss black zebra test','#030405',.55,.075,1)
    saved={m:m.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value[:] for m in [mats['paint'],mats['glass']]}
    for kind in ['hero','source']:
        source.hide_render=kind!='source'
        for ob in hero:ob.hide_render=kind!='hero'
        for key,loc,target,scale in views:
            zebra_view=key.startswith('zebra')
            nighttime=key=='night'
            for ob in studio:ob.hide_render=zebra_view or nighttime
            for ob in zebra:ob.hide_render=not zebra_view
            night.hide_render=not nighttime
            bg.inputs['Strength'].default_value=.7 if zebra_view else .026 if nighttime else .33
            for link in list(bg.inputs['Color'].links):world.node_tree.links.remove(link)
            if zebra_view:world.node_tree.links.new(ramp.outputs['Color'],bg.inputs['Color'])
            if kind=='hero':
                for m in [mats['paint'],mats['glass']]:
                    bsdf=m.node_tree.nodes.get('Principled BSDF')
                    bsdf.inputs['Base Color'].default_value=(.003,.004,.005,1) if zebra_view else saved[m]
                    bsdf.inputs['Roughness'].default_value=.075 if zebra_view else .19 if m==mats['paint'] else .075
            # Source zebra also has flat black material, exposing its untouched geometry.
            source.data.materials[0]=black if zebra_view else original_material(source)
            cam.location=loc;aim(cam,target);camdata.type='ORTHO' if scale else 'PERSP';camdata.lens=55
            if scale:camdata.ortho_scale=scale
            scene.render.filepath=str(REVIEWS/f'round{number}_{kind}_{key}.png');bpy.ops.render.render(write_still=True)
    print('REVIEW',selected[0].name,'OptiX; 20 spp; source geometry unmodified except uniform pose/scale.',flush=True)


def original_material(source):
    import bpy
    # Source material is the only image-textured material in this build.
    return next(m for m in bpy.data.materials if m.use_nodes and any(n.type=='TEX_IMAGE' for n in m.node_tree.nodes))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--round',type=int,default=4)
    parser.add_argument('--compose',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else sys.argv[1:])
    if args.compose:compose(args.round)
    else:build(args.round)
