"""Model X skin in metres. Longitudinal rails are digitised in side-photo pixels.
The two fasciae use the front/rear photo's vertical coordinates at their actual depth."""
import math
from mathutils import Vector
from model3.mesh import Mesh, grid, cord, path, interpolate
from math import sin, cos, pi, sqrt
import bpy

R=1
CAM={}
M={}
LINES=[]
A,B=-.61,3.38
WB,TRACK,RADIUS=2.965,1.70,.378
def mix(a,b,t): return a+(b-a)*t
def seq(a,b,n): return [a]+[mix(a,b,i/n) for i in range(1,n)]+[b]
def at(points,x): return interpolate(points,x)
def proj(v,p):
    c=CAM[v]; d=Vector(p)-Vector(c['location'])
    scale=-c['focal_px']/d.dot(Vector(c['back']))
    return c['cx']+scale*d.dot(Vector(c['right'])),c['cy']-scale*c['aspect']*d.dot(Vector(c['up']))
def elevation(view,x,y,pixel):
    c=CAM[view]; d=Vector((x,y,0))-Vector(c['location'])
    return c['location'][2]+(c['cy']-pixel)*(-d.dot(Vector(c['back'])))/(c['focal_px']*c['aspect'])
def sideheight(x,y,trace):
    u=proj('side',(x,-abs(y),0))[0]
    return elevation('side',x,-abs(y),at(trace,u))
def obj(name,mesh): return mesh.object(name,M)
def panel(name,fn,us,vs,mat,normal,sub=True):
    m=Mesh();grid(m,us,vs,fn,mat,normal)
    return panel_mesh(name,m,sub)

def panel_mesh(name,m,sub=True):
    o=obj(name,m)
    if sub and not name.startswith(('Lower sill','Mirror silver','front lower','rear lower')):
        # Hold panel perimeters exactly. Neighbouring panels share their curved rails.
        edges=o.data.attributes.new('crease_edge','FLOAT','EDGE')
        count={}
        for p in o.data.polygons:
            for e in p.edge_keys: count[e]=count.get(e,0)+1
        for e in o.data.edges:
            if count.get(e.key)==1: edges.data[e.index].value=1
        mod=o.modifiers.new('Held panel edges','SUBSURF');mod.levels=2;mod.render_levels=2
    return o
def line(name,points,r,mat,feature=True,mesh=None):
    pts=[tuple(p) for p in points]
    if feature: LINES.append(pts)
    target=mesh if mesh is not None else Mesh()
    cord(target,pts,r,mat,6)
    if mesh is None: return obj(name,target)
def side_width(x):
    return at([(A,.888),(-.55,.928),(-.38,.957),(0,1),(.55,.979),(1.52,.972),(2.41,.978),(2.965,1),(3.22,.979),(B,.934)],x)
CROWN=[(76,279),(124,260),(169,239),(233,213),(312,186),(390,169),(480,156),(558,152),(627,153),(690,158),(754,169),(830,191),(893,218),(954,254),(1018,290),(1050,299),(1105,310),(1170,326),(1226,344),(1278,366),(1317,396)]
WIN=[(102,278),(168,258),(219,236),(269,218),(335,197),(409,182),(479,173),(559,169),(624,170),(681,175),(747,187),(812,206),(876,231),(933,261),(981,294),(1016,321),(1084,338),(1197,361),(1308,391)]
SILL=[(80,310),(161,291),(218,251),(236,265),(270,277),(323,284),(408,294),(550,303),(691,311),(819,315),(939,321),(1013,328),(1119,343),(1201,369),(1307,391)]
def roofwidth(q):
    # A continuous broad hatch shoulder rounds the rear roof rail into the crown.
    return at([(A,.882),(-.55,.81),(-.49,.68),(-.455,.61),(-.30,.62),(.12,.644),(1.24,.703),(1.7,.72),(2.3,.762),(2.63,.802),(2.81,.851),(3.04,.885),(B,.934)],q)
def deckx(q,t):
    delta=at([(A,-.438),(-.48,-.43),(-.30,-.30),(.10,-.044),(1.23,-.024),(2.3,.13),(2.63,.29),(2.86,.24),(B,.57)],q)
    return q+delta*(1-t**3)
# Face depth follows the plan silhouette. At the body side each photo trace joins
# a longitudinal rail. Smoothstep in the height direction rounds the bumper chin.
def facepoint(v,t,py,extra=0):
    front=v=='front'; s=abs(t)
    chin=at([(105,-.022),(360,-.022),(420,-.018),(451,-.055),(480,-.090),(508,-.039),(528,.012),(541,.020),(560,-.039),(584,-.024),(612,-.106)],py) if front else at([(120,0),(278,.014),(334,.026),(425,.008),(500,0),(554,-.025),(622,-.103)],py)
    x=(B+(.57+min(.020,chin))*(1-s**2.15)) if front else A-(.416+min(.022,chin))*(1-s**2.65)
    if front:
        pocket=at([(350,0),(459,0),(489,.055),(530,.072),(550,.018),(565,0)],py)
        x-=pocket*at([(0,0),(.55,0),(.76,1),(.91,.94),(1,0)],s)
    if front and s>.88:
        # The bumper returns to the wheel opening below the wing, where the arch
        # extends farther forward than the bonnet-to-bumper junction at B.
        z=elevation(v,B,side_width(B),py)
        radius=.449
        outer=WB+sqrt(max(0,radius*radius-max(0,z-RADIUS)**2))
        x+=max(0,outer-B)*((s-.88)/.12)**2
    c=CAM[v]; centre=694 if front else 692
    edge=side_width(B if front else A); depth=abs(x-c['location'][0])
    # Keep each row tangent to its side panel. Correct perspective for fascia relief.
    limit=c['focal_px']*edge/abs((B if front else A)-c['location'][0])
    y=t*limit*depth/c['focal_px']
    z=elevation(v,x,y,py)
    return Vector((x+(extra if front else -extra),y,z))
FRONTTOP=[(0,406),(.30,408),(.46,422),(.55,398),(.71,373),(.89,354),(1,367)]
REARTOP=[(0,274),(.55,278),(.78,290),(.91,305),(1,322)]
def cabinwidth(x,z,y):
    # Intersect the side rails with the traced frontal shoulder and roof sections.
    for view,outline in [('front',[(101,130),(110,176),(120,192),(146,213),(182,234),(230,252),(271,265),(295,276),(322,298),(354,327),(415,341),(668,343)]),
                         ('rear',[(120,88),(133,187),(142,195),(170,208),(210,222),(249,235),(275,250),(292,265),(308,280),(333,293),(386,304),(447,319),(674,322)])]:
        c=CAM[view];py=proj(view,(x,0,z))[1];depth=abs(c['location'][0]-x)
        y=min(y,at(outline,py)*depth/c['focal_px'])
    return y
def top(q,t):
    a=abs(t);y=t*roofwidth(q);x=deckx(q,a)
    edgez=sideheight(q,roofwidth(q),WIN)+.023
    centerz=sideheight(deckx(q,0),0,CROWN)
    z=mix(centerz,edgez,a**3.5)
    correction=at([(A,0),(-.455,-.102),(-.25,-.048),(.15,-.015),(1.,-.015),(1.7,-.022),(2.63,-.074),(3.06,-.024),(B,0)],q)
    z+=correction*(1-.75*a*a)
    y=math.copysign(cabinwidth(x,z,abs(y)),y)
    # The quarter and hood taper into the crowned nose and folded hatch.
    for end,view,trace,dist in [(A,'rear',REARTOP,.29),(B,'front',FRONTTOP,.36)]:
        weight=max(0,1-abs(q-end)/dist)**2
        if weight:
            tip=facepoint(view,t,at(trace,a))
            x=mix(x,tip.x,weight);y=mix(y,tip.y,weight);z=mix(z,tip.z,weight)
    if q>=2.36:
        crest=sideheight(x,y,CROWN)
        # A domed bonnet: the centre rises nearly to the fender crowns instead
        # of dipping into a V where it meets the windscreen.
        across=max(0,sin(pi*a))**.65 if a>.5 else .86+.14*sin(pi*a)**2
        lift=at([(2.36,0),(2.63,0),(2.76,1.0),(3.25,1.08),(B,0)],q)*across
        z+=max(0,crest-z)*min(1,lift)
    for station,view,pp,reach in [(2.63,'front',269,.24),(-.455,'rear',274,.16)]:
        blend=max(0,1-abs(q-station)/reach)**2
        if view=='rear':blend*=1-.96*a**2
        z=mix(z,elevation(view,x,y,pp),blend)
    if q<.06:
        weight=at([(A,0),(-.455,1),(-.28,.84),(.05,0)],q)*a**3
        z=mix(z,sideheight(x,y,CROWN)-.013,weight)
    return Vector((x,y,z))
def waist(q,sign):
    y=side_width(q)-.045
    z=sideheight(q,y,SILL)
    y=cabinwidth(q,z,y)
    for end,v,tr in [(A,'rear',REARTOP),(B,'front',FRONTTOP)]:
        w=max(0,1-abs(q-end)/.35)**2
        z=mix(z,facepoint(v,1,at(tr,1)).z,w); y=mix(y,side_width(end),w)
    return Vector((q,sign*y,z))
def upper(q,t,sign):
    lo,hi=waist(q,sign),top(q,sign)
    p=lo.lerp(hi,t)
    # No outward bulge on the D pillar, so from above it runs into the
    # quarter shoulder instead of standing up as a bright pointed fin.
    p.y+=sign*min(.013,(hi-lo).length*.045)*sin(pi*t)*at([(A,0),(-.6,0),(-.30,1),(B,1)],q)
    return p
def arch_height(x,r):
    d=min(abs(x),abs(x-WB))
    return RADIUS+sqrt(max(0,r*r-d*d)) if d<r else .215
def lower(x,h,sign):
    edge=waist(x,sign); high=edge.z
    bottom=max(.195,arch_height(x,.446) if min(abs(x),abs(x-WB))<.446 else .195)
    shoulder,lowfold=folds(x)
    # Remap the whole pressing above the wheel opening. Clamping individual rows
    # to the arch used to stack several rows and fold their faces back into the wing.
    def stop(z):return min(high,max(.195,z))
    flat=at([(0,.195),(.16,stop(lowfold-.055)),(.20,stop(lowfold-.010)),(.24,stop(lowfold+.017)),
             (.58,stop((shoulder+lowfold)/2)),(.78,stop(shoulder-.017)),(.82,stop(shoulder+.001)),
             (.88,stop(shoulder+.033)),(1,high)],h)
    bottom=min(bottom,high-.012)
    cutoff=min(high,bottom+.09)
    z=flat if flat>=cutoff else mix(bottom,cutoff,(flat-.195)/(cutoff-.195))
    rear_weight=max(0,1-(x-A)/.165)**2
    if rear_weight:
        # Join the painted fascia and its black valance at their exact heights.
        end_z=elevation('rear',A,side_width(A),at([(0,600),(.16,554),(.58,446),(1,322)],h))
        z=mix(z,end_z,rear_weight)
    # The shoulder breaks away below the sill, then flares again over each tyre.
    yf=at([(.18,-.026),(.28,-.018),(.33,-.015),(.38,-.038),(.47,-.045),(.65,-.024),(.83,.0),(.91,-.003),(1.05,-.016),(1.3,-.038)],z)
    door=at([(A,0),(.36,.05),(.65,1),(2.24,1),(2.61,0),(B,0)],x)
    # Place the shoulder and sill folds at fixed physical heights. The wheel
    # cutout below them must not lift the reflection up the middle of a door.
    sculpt=at([(lowfold-.055,-.003),(lowfold-.010,.009),(lowfold+.020,-.018),
               ((shoulder+lowfold)/2,-.024),(shoulder-.017,-.006),(shoulder+.004,.006),
               (shoulder+.034,.004)],z)
    rad=math.hypot(min(abs(x),abs(x-WB)),z-RADIUS)
    arch_return=.019*math.exp(-((rad-.465)/.052)**2) if z>RADIUS else 0
    # Between the wheel openings the doors and sill carry a real tumblehome:
    # the shoulder crease is the widest line, the upper door rolls into the
    # window line and the lower door and rocker tuck under toward the sill.
    w=tuck_weight(x)
    y=side_width(x)+mix(yf+door*sculpt,tuck(z,shoulder,lowfold),w)+arch_return*(1-.6*w)
    y=cabinwidth(x,z,y)
    y=mix(y,abs(edge.y),max(0,(z-(high-.063))/.063))
    end_weight=min(1,max(rear_weight,max(0,1-(B-x)/.10)**2))
    p=Vector((x,sign*mix(y,side_width(x),end_weight),z))
    front_weight=max(0,1-(B-x)/.10)**2
    if front_weight:
        # Carry the wing into the bumper return on the same curve. The former
        # offset edge left a dark vertical crack at the front corner in profile.
        edge=facepoint('front',sign,proj('front',p)[1])
        p=p.lerp(edge,front_weight)
    return p
def folds(x):
    shoulder=sideheight(x,side_width(x),[(80,340),(325,342),(660,356),(981,371),(1150,376),(1318,396)])
    lowfold=sideheight(x,side_width(x),[(76,481),(438,489),(655,500),(974,518),(1318,518)])
    return shoulder,lowfold
def tuck_weight(x):
    return at([(A,0),(.24,0),(.40,1),(2.56,1),(2.70,0),(B,0)],x)
def tuck(z,shoulder=.935,lowfold=.45):
    # Lateral offset of the door section from the plan width, by height. Below
    # the shoulder crease the side rolls under progressively (the tilt grows
    # toward the sill); a faint lower character line sits at the low fold.
    if z<shoulder:
        d=shoulder-z
        under=max(0,lowfold-.04-z)
        return -.20*d*d-1.0*under*under+.003*math.exp(-((z-lowfold)/.028)**2)
    return at([(shoulder,0),(shoulder+.03,-.005),(1.02,-.017),(1.08,-.03),(1.3,-.045)],z)
def zside(x,z,sign):
    a,b=0.,1.
    for i in range(14):
        mid=(a+b)/2
        if lower(x,mid,sign).z<z:a=mid
        else:b=mid
    return lower(x,(a+b)/2,sign)
def archxs(a,b):
    vals=seq(a,b,max(2,round((b-a)/.15)))
    for hub in [0,WB]:
        vals.extend(hub+.446*cos(t) for t in seq(0,pi,14))
        for k in [-1,1]: vals.extend([hub+k*.446,hub+k*.4462])
    return sorted(set(round(x,7) for x in vals if a<=x<=b))
def perimeter(name,fn,us,vs,r,mat):
    line(name,[fn(x,vs[0]) for x in us]+[fn(us[-1],y) for y in vs[1:]]+
         [fn(x,vs[-1]) for x in us[-2::-1]]+[fn(us[0],y) for y in vs[-2::-1]],r,mat)
def shell():
    glass=bpy.data.objects.new('glass',None);bpy.context.collection.objects.link(glass)
    fender_x=sorted(set(archxs(2.4423,B)+[2.63]))
    crown_x=[q for q in fender_x if q>=2.63]
    def hood_edge(q):return at([(2.63,.94),(2.85,.88),(3.14,.85),(B,.91)],q)
    def hood_gap(q):return .0017/roofwidth(q)
    def glass_edge(q):
        width=at([(-.455,.064),(-.35,.059),(-.25,.054),(.05,.048),(.8,.042),(1.7,.044),(2.63,.039)],q)
        return 1-width/roofwidth(q)
    # Boundaries in q follow hatch glass, falcon-wing roof and panoramic windscreen.
    for i,(a,b,name,mat) in enumerate([(A,-.455,'Tailgate crown','paint'),(-.455,.055,'Tailgate glass','glass'),
          (.055,1.225,'Falcon roof','glass'),(1.225,2.63,'Panoramic windscreen','glass'),(2.63,B,'Bonnet','paint')]):
        start=a+(.0023 if i else 0);end=b-(.0023 if b!=B else 0)
        us=seq(start,end,max(5,round((b-a)/.14))); vs=seq(-1,1,24 if name in ('Bonnet','Tailgate crown') else 10)
        if name=='Bonnet':
            us=[start]+crown_x[1:]
            ob=panel(name,lambda q,t:top(q,t*(hood_edge(q)-hood_gap(q))),us,seq(-1,1,16),mat,(0,0,1))
            for sg in [-1,1]:
                panel('Bonnet jamb',lambda q,t:top(q,sg*(hood_edge(q)+t*hood_gap(q)*2))-Vector((0,0,.003)),
                      us,[-1,1],'gap',(0,0,1),False)
                LINES.append([top(q,sg*hood_edge(q)) for q in us])
        elif mat=='glass':
            # The pane and its painted frame meet on the same curved boundary.
            # The frame tapers continuously across the rear glass and both roof doors.
            ob=panel(name,lambda q,t:top(q,t*glass_edge(q)),us,vs,mat,(0,0,1))
            ob.parent=glass
            for sign in [-1,1]:
                rail=lambda q,t:top(q,sign*mix(glass_edge(q),1,t))
                panel('Painted roof frame '+name,rail,us,[0,.56,1],'paint',(0,0,1))
        else:
            ob=panel(name,top,us,vs,mat,(0,0,1))
        if name=='Falcon roof':
            for sign in [-1,1]:
                fn=lambda q,t:top(q,t*sign)+Vector((0,0,.0015))
                us2=seq(.067,1.075,14);vs2=seq(.18,.949,9)
                perimeter('Falcon hinge seal',fn,us2,vs2,.004,'seal')
                # The central opaque spine and edge frit frame the two glazed roof sections.
                panel('Falcon hinge cover',fn,us2,[0,.08,.174],'blackglass',(0,0,1),False).parent=glass
        if mat=='glass':
            for end in [a,b]:
                rr=.007 if name=='Panoramic windscreen' else .0045
                line('Ceramic edge '+name,[top(end,t*glass_edge(end)) for t in seq(-1,1,48)],rr,'blackglass')
        if b!=B: line('Recess '+name,[top(b,t)-Vector((0,0,.003)) for t in seq(-1,1,50)],.004,'seal')
    for sign,side in [(-1,'R'),(1,'L')]:
        # Painted roof rails, bright drip mouldings, individual panes and pillars.
        ranges=[(A,-.32,'D pillar','paint'),(-.32,.28,'Quarter glass','glass'),(.28,.302,'Quarter divider','seal'),
                (.302,1.16,'Falcon side glass','glass'),(1.16,1.31,'B pillar','blackglass'),
                (1.31,2.48,'Front side glass','glass'),(2.48,2.52,'Mirror divider','seal'),(2.52,2.63,'Sail glass','glass')]
        def window_band(q):
            tip=max(0,1-(q+.32)/.19)**2
            return .48*tip,.925-.44*tip
        for a,b,name,mat in ranges:
            us=seq(a,b,max(6 if a==A else 3,round((b-a)/.10)))
            if name=='D pillar':
                panel(name+' '+side,lambda q,t:upper(q,t,sign),us,[0,.25,.6,.9,1],mat,(0,sign,.2))
                continue
            def pane(q,t):return upper(q,mix(*window_band(q),t),sign)
            o=panel(name+' '+side,pane,us,[0,.12,.55,1],mat,(0,sign,.2))
            if mat in ('glass','blackglass'):o.parent=glass
            panel('Window header '+name+' '+side,lambda q,t:upper(q,mix(window_band(q)[1],1,t),sign),
                  us,[0,1],'paint',(0,sign,.5))
            if name=='Quarter glass':
                panel('Quarter light lower corner '+side,lambda q,t:upper(q,t*window_band(q)[0],sign),
                      us,[0,1],'paint',(0,sign,.3))
        us=seq(-.32,2.63,74)
        for index,name in enumerate(('waist chrome','upper chrome')):
            pts=[upper(q,window_band(q)[index],sign)+Vector((0,sign*.002,0)) for q in us]
            line(name+' '+side,pts,.009,'chrome')
        # Side panel breaks lean to match the door cut at the front of each arch.
        def shift(q,h):
            # Lean the door cuts, keeping the vertical wheel-opening corners fixed.
            offsets=[(.035,-.048,.30),(1.285,-.075,.38),(2.44,.027,.072)]
            return q+h*sum(offset*max(0,1-abs(q-cut)/span)**2 for cut,offset,span in offsets)
        bounds=[A,.035,1.285,2.44,B]
        for i,name in enumerate(['Rear quarter','Falcon wing door','Front door','Front fender']):
            a,b=bounds[i:i+2];aa=a+(.0017 if i else 0);bb=b-(.0017 if i<3 else 0)
            def fn(q,h):
                p=lower(shift(q,h),h,sign)
                dist=min(q-aa if i>0 else 1,bb-q if i<3 else 1)
                p.y-=sign*.003*max(0,1-dist/.007)**2
                return p
            xs=archxs(aa,bb)
            if i>0:xs.append(aa+.008)
            if i<3:xs.append(bb-.008)
            # Dense columns where the quarter turns into the rear fascia keep the
            # black lower-bumper edge continuous instead of stepping at the join.
            if i==0:xs.extend(A+d for d in (.012,.03,.055,.085,.12,.16,.21,.27))
            xs=sorted(set(xs))
            rows=[0,.16,.20,.24,.58,.78,.82,.88,1]
            if name=='Front fender':
                # The wheel arch, shoulder and crown are one stamped wing. Shared
                # vertices avoid a second, ragged seam below the real bonnet joint.
                wing=Mesh()
                grid(wing,sorted(set(fender_x+xs)),rows,fn,'paint',(0,sign,0))
                def shoulder(q,t):
                    lo=fn(q,1);hi=top(q,sign)
                    return lo.lerp(hi,t)
                grid(wing,crown_x,[0,.42,.82,1],shoulder,'paint',(0,sign,.3))
                def crown(q,t):return top(q,sign*mix(1,hood_edge(q)+hood_gap(q),t))
                grid(wing,crown_x,[0,.40,1],crown,'paint',(0,0,1))
                panel_mesh(name+' '+side,wing)
            else:
                finish=(lambda q,h:'clad' if q<-.446 and h<.16 else 'paint') if i==0 else 'paint'
                panel(name+' '+side,fn,xs,rows,finish,(0,sign,0))
            if i<3:
                def jamb(t,h):
                    q=b+.008*t
                    return lower(shift(q,h),h,sign)-Vector((0,sign*.0055,0))
                panel('Door jamb '+name+' '+side,jamb,[-1,1],rows,'gap',(0,sign,0))
                LINES.append([jamb(0,h) for h in seq(0,1,22)])
        for xhub in [0,WB]:
            panel('Wheel tub inset '+side,lambda a,t:(xhub+.458*t*cos(a),sign*.715,RADIUS+.458*t*sin(a)),
                  seq(-pi*.14,pi*1.14,36),[.001,1],'seal',(0,sign,0),False)
            
            # A folded moulding connects the arch face to the inner wheel liner.
            # Its forward foot turns into the bumper at the valance height.
            angles=[-1,-.76,0]+seq(0,pi,32)[1:-1]+[pi,pi+.76,pi+1]
            def arch(u,t):
                angle=min(pi,max(0,u));leg=max(-u,u-pi,0)
                # A ~4 cm flush black lip on the wing around the opening (rad .446-.487),
                # turning in over the opening edge, like the photo's arch trim.
                rad=at([(-1,.425),(0,.440),(.10,.446),(.88,.482),(1,.487)],t)
                front_foot=xhub==WB and u<0
                if front_foot:rad=mix(rad,mix(.440,.480,max(0,t)),leg**2)
                x=xhub+rad*cos(angle)
                toe=.224 if front_foot else .209
                z=RADIUS+rad*sin(angle)-leg*(RADIUS-toe)
                # Laid on the wing surface (under 2 mm proud), so from the front and
                # rear it is only a sliver and the sides stay white down to the wheels.
                y=abs(zside(min(B,max(A,x)),z,sign).y)
                y+=at([(-1,-.016),(0,-.003),(.10,.0045),(.88,.005),(1,.0025)],t)
                if front_foot:y=mix(y,abs(zside(B,z,sign).y)+.0045*max(t,0)-.004*max(-t,0),leg**2)
                return Vector((x,sign*y,z))
            mould=Mesh()
            grid(mould,angles,[-1,0,.10,.88,1],arch,lambda u,t:'seal' if t<0 else 'sill',(0,sign,0))
            for u in [-1,pi+1]:
                mould.face([arch(u,t) for t in [-1,0,.10,.88,1]],'sill',(0,0,-1))
            obj('Arch moulding '+side+str(xhub),mould)
            LINES.append([arch(v,1) for v in [-1]+seq(0,pi,50)+[pi+1]])
            # The liner stays inside the wing and lip so it never shows past the body from the ends.
            panel('Wheelhouse liner '+side+str(xhub),lambda a,t:(xhub+.422*cos(a),sign*mix(.70,min(.975,abs(zside(min(B,max(A,xhub+.43*cos(a))),RADIUS+.43*sin(a),sign).y)-.02),t),RADIUS+.422*sin(a)),
                  seq(0,pi,36),[0,1],'seal',(0,sign,-1),False)
        def rocker(x,h):
            # Slim sill strip: its top sits at the photo's door bottom (about 1.4 cm lower than before).
            cap=sideheight(x,side_width(x),[(74,491),(181,512),(452,524),(973,535),(1240,535),(1317,517)])-.014
            z=mix(.209,cap,h)
            # Continue the door tuck and roll the black sill under the floor.
            y=side_width(x)+tuck(z,*folds(x))+.0035+.003*sin(h*pi)
            return (x,sign*y,z)
        # Satin sill strip above, matte underbody return below, as in the side photo.
        panel('Lower sill '+side,rocker,seq(.447,WB-.447,12),[0,.08,.36,.45,.86,1],lambda x,h:'seal' if h<.36 else 'sill',(0,sign,0))
        LINES.append([rocker(x,1) for x in seq(.447,WB-.447,30)])
        for x in [1.12,1.35]:
            z=sideheight(x,.97,[(575,335),(708,343)])
            line('Flush handle '+side,[zside(x+dx,z+dz,sign)+Vector((0,sign*.009,0)) for dx,dz in [(-.107,.004),(-.095,0),(.09,-.004),(.107,-.007)]],.012,'chrome',False)
    panel('Body shell underfloor',lambda x,t:(x,t*.79,.197),[A,.1,1,2,B],[-1,1],'seal',(0,0,-1),False)
    return glass

