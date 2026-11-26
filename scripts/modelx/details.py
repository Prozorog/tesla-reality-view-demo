from modelx import panels as P
from modelx.panels import (Mesh, Vector, bpy, seq, at, mix, pi, sin, cos, obj, line, panel, path, grid,
                          facepoint, top, upper, sideheight, zside, side_width, A, B, WB, TRACK, RADIUS)
from math import radians
LIGHTS={}
FASCIA={}
def lathe(m,profile,material,segments=56):
    for (r,y),(rr,yy) in zip(profile,profile[1:]):
        for a,b in zip(seq(0,2*pi,segments),seq(0,2*pi,segments)[1:]):
            m.face([(r*cos(a),y,r*sin(a)),(rr*cos(a),yy,rr*sin(a)),(rr*cos(b),yy,rr*sin(b)),(r*cos(b),y,r*sin(b))],material)
def wheels():
    for side,sg in [('L',1),('R',-1)]:
        for axle,x in [('F',WB),('R',0)]:
            name=axle+side
            hub=bpy.data.objects.new('wheel_'+name,None);bpy.context.collection.objects.link(hub);hub.location=(x,sg*TRACK/2,RADIUS)
            def attach(label,m):
                o=obj(label+' '+name,m);o.parent=hub;o.scale.y=sg*.94
            tyre=Mesh()
            lathe(tyre,[(.284,.112),(.306,.126),(.345,.127),(.363,.119),(.374,.101),(.378,.084),(.378,-.087),(.373,-.112),(.355,-.13),(.285,-.125),(.284,.112)],'rubber')
            for radius in [.316,.344,.36]:
                lathe(tyre,[(radius,.126),(radius+.0018,.128),(radius+.003,.125)],'sidewall',40)
            for i in range(80):
                a=i*2*pi/80
                for s in [-1,1]:
                    def tread(angle,y,r):return(r*cos(angle),y*s,r*sin(angle))
                    tyre.face([tread(a,.100,.3755),tread(a+.021,.099,.376),tread(a+.050,.054,.3786),tread(a+.038,.052,.3786)],'sidewall')
            attach('Tyre',tyre)
            rim=Mesh()
            lathe(rim,[(.25,-.108),(.28,-.108),(.29,.104),(.287,.124),(.278,.126),(.264,.105),(.25,-.108)],'alloy')
            lathe(rim,[(0,.113),(.045,.122),(.069,.105),(.080,.075),(.052,.058),(0,.06)],'alloy')
            for i in range(10):
                a=i*2*pi/10
                rings=[]
                for r,delta,w,y in [(.046,0,.016,.107),(.084,.026,.021,.105),(.156,.075,.023,.082),(.237,.15,.028,.086),(.277,.185,.032,.11)]:
                    angle=a+delta
                    def point(width,depth):
                        return(r*cos(angle)-width*sin(angle),depth,r*sin(angle)+width*cos(angle))
                    rings.append([point(-w,y-.014),point(-w*.65,y),point(w*.55,y+.008),point(w,y-.001),point(w,y-.027),point(-w,y-.028)])
                for l,h in zip(rings,rings[1:]):
                    for j in range(6):rim.face([l[j],h[j],h[(j+1)%6],l[(j+1)%6]],'alloy',smooth=False)
            for i in range(5):
                angle=i*2*pi/5
                u,v=.052*cos(angle),.052*sin(angle)
                ring=[(u+.009*cos(a),.119,v+.009*sin(a)) for a in seq(0,2*pi,6)[:-1]]
                rim.face(ring,'rotor',(0,1,0),False)
            attach('Turbine alloy',rim)
            rotor=Mesh();lathe(rotor,[(0,.052),(.18,.052),(.218,.05),(.219,.042),(0,.042)],'rotor',40)
            attach('Brake disc',rotor)
            m=Mesh()
            for a,b in zip(seq(.72,1.52,9),seq(.72,1.52,9)[1:]):
                for r,s,y,yy in [(.171,.218,.069,.069),(.218,.218,.069,.025),(.171,.171,.025,.069)]:
                    m.face([(r*cos(a),sg*y,r*sin(a)),(s*cos(a),sg*yy,s*sin(a)),(s*cos(b),sg*yy,s*sin(b)),(r*cos(b),sg*y,r*sin(b))],'caliper')
            o=obj('caliper_'+name,m);o.location=hub.location
# Top of the black rear lower bumper across the rear view. Around the corner it
# stays level so it meets the side cladding without a step behind the wheel.
REAR_CUT=[(0,536),(.63,537),(.77,539),(.84,540),(1,541)]
def face(v):
    front=v=='front'; trace=P.FRONTTOP if front else P.REARTOP
    def row(t,h):
        a=abs(t)
        if front:
            cut=at([(0,555),(.44,555),(.52,562),(.61,589),(.82,582),(1,565)],a)
            ys=[at(trace,a),mix(at(trace,a),cut,.16),mix(at(trace,a),cut,.46),cut-15,cut-3,cut,cut+3,at([(0,621),(.64,612),(1,597)],a)]
        else:
            cut=at(REAR_CUT,a)
            ys=[at(trace,a),mix(at(trace,a),cut,.17),mix(at(trace,a),cut,.48),cut-22,cut-3,cut,cut+4,at([(0,630),(.75,626),(1,600)],a)]
        py=at(list(enumerate(ys)),h)
        p=facepoint(v,t,py)
        if not front and abs(t)<.53:
            # Pressed-in registration plate surround.
            recess=at([(0,.075),(.36,.073),(.50,0),(.53,0)],a)*at([(320,0),(352,0),(369,1),(409,1),(432,0)],py)
            p.x+=recess
        return p
    xs=seq(-1,1,24)
    if front:
        panel('Front bumper',row,xs,[0,.08,.28,.75,1,1.5,2,2.36,2.62,2.85,3,3.5,4,5],'paint',(1,0,0))
    else:
        def split(t):
            a=abs(t)
            return at([(0,474),(.64,471),(.72,453),(.80,448),(1,445)],a)
        def hatch(t,h):
            py=mix(at(trace,abs(t)),split(t)-.8,h);p=facepoint(v,t,py)
            # Shallow registration-plate pressing with soft walls.
            recess=at([(0,.034),(.30,.033),(.37,.031),(.46,.008),(.50,0)],abs(t))*at([(322,0),(350,0),(374,1),(404,1),(432,0)],py)
            p.x+=recess;return p
        hatch_rows=[0,.10,.27,.37,.405,.44,.48,.57,.65,.7,.75,.80,.94,1]
        def hatch_edge(h):
            return at([(0,.775),(.27,.78),(.65,.755),(.94,.71),(1,.69)],h)
        # The hatch cut is an actual 3.6 mm opening with a recessed painted jamb.
        # Separate quarter returns meet the crown without a dark cord on the paint.
        cut=.0018/side_width(A)
        panel('Tailgate pressing',lambda t,h:hatch(t*(hatch_edge(h)-cut),h),xs,hatch_rows,'paint',(-1,0,0))
        for sign in (-1,1):
            panel('Rear quarter return '+str(sign),lambda t,h:hatch(sign*mix(hatch_edge(h)+cut,1,t),h),
                  seq(0,1,8),hatch_rows,'paint',(-1,sign*.25,0))
            panel('Tailgate side jamb '+str(sign),lambda t,h:hatch(sign*(hatch_edge(h)+t*cut),h)+Vector((.006,0,0)),
                  [-1,1],hatch_rows,'gap',(-1,0,0),False)
        def inner_hatch(t,h):
            p=hatch(t*.99,h)
            return p+Vector((.035,-.012*t,-.015))
        panel('Tailgate inner lining',inner_hatch,xs,[0,.28,.58,1],'seal',(1,0,0),False)
        def bumper(t,h):
            py=mix(split(t)+.8,at(REAR_CUT,abs(t)),h)
            return facepoint(v,t,py)
        panel('Rear bumper',bumper,xs,[0,.08,.4,.83,1],'paint',(-1,0,0))
        line('Tailgate lower jamb',[facepoint(v,t,split(t),-.004) for t in seq(-.69,.69,60)],.0018,'gap')
    panel(v+' lower valance',row,xs,[5,5.12,6,6.7,7],'clad',(1 if front else -1,0,0))
    P.LINES.append([row(t,5) for t in seq(-1,1,80)])
def match_quarter_normals():
    # The bumper and quarter share the same corner curve but export as separate
    # panels. Give their coincident edges the tangent of the assembled surface.
    names=['Tailgate pressing','Rear quarter return -1','Rear quarter return 1','Rear bumper','rear lower valance','Rear quarter L','Rear quarter R']
    dg=bpy.context.evaluated_depsgraph_get()
    curves={(sg,side):[] for sg in [-1,1] for side in [True,False]}
    meshes=[]
    for name in names:
        ob=bpy.data.objects[name]
        skin=bpy.data.meshes.new_from_object(ob.evaluated_get(dg),depsgraph=dg)
        ob.modifiers.clear();ob.data=skin
        side=name in ('Rear quarter L','Rear quarter R')
        for v in skin.vertices:
            x,y,z=v.co
            if abs(x-A)<.0001 and abs(abs(y)-side_width(A))<.0005:
                curves[(1 if y>0 else -1,side)].append((z,v.normal.copy()))
        meshes.append(skin)
    for values in curves.values():values.sort(key=lambda item:item[0])
    def sample(values,z):
        for (lo,a),(hi,b) in zip(values,values[1:]):
            if z<=hi:return a.lerp(b,max(0,z-lo)/max(.00001,hi-lo))
        return values[-1][1]
    for skin in meshes:
        normals=[]
        for v in skin.vertices:
            x,y,z=v.co;n=v.normal.copy();sg=1 if y>0 else -1
            if abs(x-A)<.16 and abs(y)>.75 and n.y*sg>.26:
                corner=(sample(curves[sg,True],z)+sample(curves[sg,False],z)).normalized()
                d=min(1,abs(x-A)/.16);weight=1-d*d*(3-2*d)
                n=n.lerp(corner,weight).normalized()
            normals.append(n)
        skin.normals_split_custom_set_from_vertices(normals)

def stamp(v,u,y,depth):
    # u is horizontal pixel distance from symmetry axis in the reference view.
    c=P.CAM[v]; edge=side_width(B if v=='front' else A)
    span=c['focal_px']*edge/abs((B if v=='front' else A)-c['location'][0])
    p=facepoint(v,u/span,y)
    front=v=='front'; sign=1 if front else -1
    if v not in FASCIA:
        from mathutils.bvhtree import BVHTree
        dg=bpy.context.evaluated_depsgraph_get()
        names=['Front bumper','front lower valance'] if front else ['Rear bumper','Tailgate pressing','rear lower valance']
        FASCIA[v]=[BVHTree.FromObject(bpy.data.objects[name],dg) for name in names]
    hits=[tree.ray_cast(Vector((sign*6,p.y,p.z)),Vector((-sign,0,0)))[0] for tree in FASCIA[v]]
    xs=[hit.x for hit in hits if hit is not None]
    if xs:p.x=(max(xs) if front else min(xs))
    p.x+=depth*sign
    return p
def shape(name,v,points,sg,depth,mat,feature=False):
    # Concentric sampling makes these thin parts follow the curved fascia.
    if name.startswith(('Fog','Lower intake','Intake inner','Rear diffuser','Dipped beam','Tailgate chrome','Front black')):
        # Narrow strips follow the evaluated compound curvature at bumper-pocket depth.
        segments=list(zip(points,points[1:]+points[:1]))
        left=min(x for x,y in points);right=max(x for x,y in points)
        xs=sorted(set([x for x,y in points]+seq(left,right,max(3,round((right-left)/7)))))
        def sample(u,t):
            ys=[]
            for (x0,y0),(x1,y1) in segments:
                if min(x0,x1)<=u<=max(x0,x1):
                    if abs(x1-x0)<1e-7:ys.extend([y0,y1])
                    else:ys.append(mix(y0,y1,(u-x0)/(x1-x0)))
            # Chrome blades are convex across their height, so they pick up the
            # overhead light along the top and the floor along the bottom.
            crown=.007 if name.startswith('Tailgate chrome') else .0015 if name.startswith('Fog bright') else 0
            return stamp(v,sg*u,mix(min(ys),max(ys),t),depth+crown*sin(pi*t))
        if feature:P.LINES.append([stamp(v,sg*x,y,depth) for x,y in points+points[:1]])
        return panel(name,sample,xs,seq(0,1,7),mat,(1 if v=='front' else -1,0,0),False)
    mx=sum(x for x,y in points)/len(points); my=sum(y for x,y in points)/len(points)
    def ring(h):
        return [stamp(v,sg*mix(mx,x,h),mix(my,y,h),depth+.002*(1-h)) for x,y in points]
    m=Mesh()
    for l,h in zip([.0,.28,.65,.9],[.28,.65,.9,1.]):
        ra,rb=ring(l),ring(h)
        for j in range(len(points)):
            k=(j+1)%len(points);m.face([ra[j],rb[j],rb[k],ra[k]],mat,(1 if v=='front' else -1,0,0))
    if feature:P.LINES.append([tuple(p) for p in ring(1)+ring(1)[:1]])
    return obj(name,m)
def optic(name,v,pts,sg,depth,r,material):
    m=LIGHTS.setdefault(name,Mesh())
    line(name,[stamp(v,x*sg,y,depth) for x,y in path2(pts)],r,material,False,m)
def path2(pts):
    return [(a,b) for a,b,c in path([(x,y,0) for x,y in pts],max(8,len(pts)*4))]
def badge(v,y,scale):
    for sg in [1,-1]:
        for pts in [[(0,3),(4,1),(11,1),(17,3),(13,5),(8,4),(5,5),(0,31)],
                    [(0,-3),(7,-3),(15,-2),(19,0),(16,1),(8,-.4),(0,-.5)]]:
            shape('Tesla crest '+v,v,[(x*scale,y+dy*scale) for x,dy in pts],sg,.024,'chrome')
def lettering(text,v,u,y,size,depth=.034):
    cu=bpy.data.curves.new(text,'FONT');cu.body=text;cu.align_x='CENTER';cu.align_y='CENTER'
    cu.resolution_u=4;cu.bevel_resolution=1;cu.size=size;cu.space_character=1.32;cu.extrude=.0009;cu.bevel_depth=.00032
    ob=bpy.data.objects.new(text,cu);bpy.context.collection.objects.link(ob)
    from mathutils import Matrix
    ob.matrix_world=Matrix(((0,0,-1,0),(-1,0,0,0),(0,1,0,0),(0,0,0,1)))
    # Raised dark-chrome letters read crisply against the bright bar and paint.
    ob.location=stamp(v,u,y,depth);cu.materials.append(P.M['housing'])
def lamp_wrap(sg,side):
    # The head lamp runs back along the wing under the bonnet line, as in the
    # side photo, instead of sitting only on the nose like a separate eye.
    from mathutils.bvhtree import BVHTree
    dg=bpy.context.evaluated_depsgraph_get()
    trees=[BVHTree.FromObject(bpy.data.objects[n],dg) for n in ('Front bumper','Front fender '+side)]
    end_top=stamp('front',sg*312,357,0);end_bot=stamp('front',sg*317,403,0)
    tip_x=end_top.x-.15;tip_z=end_top.z-.006
    def surf(x,z,off):
        best=None
        for tree in trees:
            hit=tree.ray_cast(Vector((x,sg*2,z)),Vector((0,-sg,0)))[0]
            if hit is not None and (best is None or abs(hit.y)>abs(best.y)):best=hit
        if best is None:best=Vector((x,sg*side_width(min(x,B)),z))
        return best+Vector((0,sg*off,0))
    def point(u,v,off=.0035):
        x=mix(tip_x,end_top.x+.012,u)
        top_z=mix(tip_z,end_top.z,u**.8);bottom_z=mix(tip_z,end_bot.z,u**.5)
        return surf(x,mix(bottom_z,top_z,v),off)
    us=seq(0,1,12);vs=seq(0,1,4)
    panel('Headlamp wrap '+side,point,us,vs,'lamp',(0,sg,0),False)
    line('Headlamp wrap edge '+side,[point(u,0,.004) for u in us]+[point(1,v,.004) for v in vs[1:]]+
         [point(u,1,.004) for u in us[-2::-1]],.0022,'housing')
def rear_cladding(sg,side):
    # The black lower bumper wraps from the rear fascia along the quarter to the
    # arch lip with one clean edge traced from the side photo, laid on the
    # quarter's actual surface so no white step or notch shows at the corner.
    from mathutils.bvhtree import BVHTree
    dg=bpy.context.evaluated_depsgraph_get()
    trees=[BVHTree.FromObject(bpy.data.objects[n],dg) for n in ('Rear quarter '+side,'Rear bumper','rear lower valance')]
    def point(u,v):
        x=mix(A+.004,-.483,u)
        top_z=sideheight(x,side_width(x),[(40,494),(80,497),(130,505),(181,512),(200,514)])
        z=mix(.212,top_z,v)
        hits=[abs(h.y) for h in (tree.ray_cast(Vector((x,sg*2,z)),Vector((0,-sg,0)))[0] for tree in trees) if h is not None]
        y=max(hits) if hits else abs(zside(x,z,sg).y)
        return Vector((x,sg*(y+.0035),z))
    panel('Rear lower side '+side,point,seq(0,1,16),seq(0,1,6),'clad',(0,sg,0),False)
def trim():
    for v in ['front','rear']:face(v)
    for sg,side in [(-1,'R'),(1,'L')]:
        head=[(181,399),(196,387),(221,376),(262,363),(299,354),(312,353),(318,363),(319,388),(316,403),(307,408),(260,417),(224,419),(206,414)]
        tail=[(152,369),(162,347),(174,326),(186,319),(229,315),(267,316),(281,324),(290,345),(295,381),(277,386),(232,387),(219,374),(211,369)]
        for view,pts in [('front',head),('rear',tail)]:
            shape('Optic housing '+view+side,view,pts,sg,.011 if view=='front' else .006,'housing',True)
            shape('Polycarbonate '+view+side,view,pts,sg,.020 if view=='front' else .012,'lens' if view=='front' else 'smoke')
            if view=='rear':
                # A painted lid over the lamp stack: from above the tail lamp no longer
                # shows its red inner edge past the body outline.
                rim=path2(pts[:9])
                panel('Tail lamp lid '+side,lambda u,h:stamp('rear',sg*rim[round(u)][0],rim[round(u)][1]-.5,mix(-.002,.0125,h)),
                      list(range(len(rim))),[0,1],'paint',(0,0,1),False)
        optic('lights_head','front',[(188,399),(214,409),(238,409),(282,397),(302,387),(306,363)],sg,.015,.0055,'led')
        optic('indicators_left' if sg==1 else 'indicators_right','front',[(203,392),(240,386),(282,371),(302,362)],sg,.016,.0035,'amber')
        shape('Dipped beam reflector '+side,'front',[(193,398),(208,385),(261,370),(296,358),(281,375),(250,390),(222,399)],sg,.015,'opticmetal')
        for i in range(5):
            u=233+12*i
            shape('Projector facet '+side,'front',[(u,399-i*2),(u+7,395-i*2),(u+10,390-i*2),(u+4,392-i*2)],sg,.018,'rotor')
        for off in [0,4]:
            optic('lights_tail','rear',[(162,360+off),(217,359+off),(273,356+off),(268,331+off),(250,325+off),(211,325+off),(183,330+off)],sg,.0075,.0035,'red')
        optic('lights_brake','rear',[(170,357),(217,353),(270,351)],sg,.0075,.0035,'brake')
        optic('lights_reverse','rear',[(199,340),(228,338),(261,337)],sg,.008,.003,'led')
        optic('indicators_left' if sg==1 else 'indicators_right','rear',[(235,374),(279,371)],sg,.008,.003,'amber')
        fog=[(263,496),(317,481),(312,533),(302,553),(287,559),(261,558)]
        shape('Fog recess '+side,'front',fog,sg,.011,'housing',True)
        for yy in [512,533]:
            # Slim bright strakes, nearly flush with the bumper corner.
            shape('Fog bright blade '+side,'front',[(236,yy+12),(283,yy+2),(301,yy-2),(300,yy+.5),(282,yy+5),(238,yy+14.5)],sg,.0025,'chrome')
        # One slim vertical fog light at the outer side of the dark recess.
        shape('Fog lamp '+side,'front',[(293,502),(305,499),(306,547),(294,550)],sg,.013,'opticmetal')
        shape('Rear bumper reflector '+side,'rear',[(126,546),(190,547),(208,550),(203,554),(150,556)],sg,.018,'red')
        shape('Front black moustache '+side,'front',[(0,405),(73,407),(133,412),(153,418),(154,423),(40,428),(24,432),(0,453)],sg,.009,'blackglass')
        shape('Lower intake '+side,'front',[(0,555),(156,555),(170,561),(198,589),(111,592),(0,592)],sg,.013,'housing')
        shape('Tailgate chrome blade '+side,'rear',[(0,333),(112,334),(173,338),(198,348),(201,352),(110,349),(0,349)],sg,.020,'chrome',True)
        x=2.61; z=sideheight(x,.98,[(981,367),(1031,372)])
        p=zside(x,z,sg)+Vector((0,sg*.007,0))
        m=Mesh();m.face([p+Vector((-.08,0,.021)),p+Vector((.082,0,.012)),p+Vector((.043,0,-.036))],'housing',(0,sg,0));obj('Side repeater '+side,m)
        mirror(sg,side)
        lamp_wrap(sg,side)
        rear_cladding(sg,side)
    badge('front',412,1);badge('rear',293,.91)
    lettering('T E S L A','rear',0,341,.029,.0285);lettering('MODEL X','rear',176,442,.028);lettering('P100D','rear',-184,442,.025)
    for key,m in LIGHTS.items():obj(key,m)
    for sg in [-1,1]:
        for y in (344,377):
            shape('Smoked rear optic divider','rear',[(229,y),(280,y-2),(280,y+2),(229,y+3)],sg,.022,'housing')
        for u in [60,142]:
            shape('Front parking sensor','front',[(u+1.3*cos(a),536+1.3*sin(a)) for a in seq(0,2*pi,12)[:-1]],sg,.002,'clad')
        for view,q,tip,dz in [('rear',A,-.55,.008)]:
            base=stamp(view,(311 if view=='front' else 287)*sg,362 if view=='front' else 334,.014)
            sidepoint=Vector((tip,sg*(side_width(tip)-.016),base.z+dz))
            def wing(t,h):
                # The top edge stays under the quarter's shoulder, out of sight from above.
                p=base.lerp(sidepoint,t);p.z+=mix(-.080,-.010,h)*(1-.95*t)
                # Wrap the lens around the quarter instead of standing out as a fin.
                skin=abs(zside(max(A,p.x),p.z,sg).y)+.003
                p.y=sg*min(abs(p.y)+.005*sin(t*pi),skin)
                return p
            panel(view+' optic wing',wing,seq(0,1,6),[0,.2,.85,1],'housing' if view=='front' else 'smoke',(0,sg,0),False)
            P.LINES.append([wing(t,1) for t in seq(0,1,16)])
        for y in [565,575,585]:
            shape('Intake inner blade','front',[(0,y),(150,y),(158,y+2),(0,y+2)],sg,.016,'clad')
        for yy in [593,617]:
            shape('Rear diffuser step','rear',[(0,yy),(216,yy),(249,yy+4),(239,yy+7),(0,yy+6)],sg,.014,'housing')
    for v,q in [('rear',A),('front',B)]:
        toe=[(0,621),(.64,612),(1,597)] if v=='front' else [(0,630),(.75,626),(1,600)]
        for sg in [-1,1]:
            def undertray(t,h):
                lip=facepoint(v,sg*t,at(toe,t))
                tucked=Vector((q+(-.07 if v=='front' else .07),sg*t*.72,.236))
                return lip.lerp(tucked,h)
            panel(v+' bumper return',undertray,seq(0,1,14),[0,.25,.9,1],'clad',(0,sg,-1),False)
    spoiler()
def mirror(sg,side):
    center=Vector((2.29,sg*1.026,1.115))
    m=Mesh()
    for h,k in zip(seq(-pi/2,pi/2,12),seq(-pi/2,pi/2,12)[1:]):
        for a,b in zip(seq(0,2*pi,32),seq(0,2*pi,32)[1:]):
            def point(theta,phi):
                def pw(n,p):return (1 if n>=0 else -1)*abs(n)**p
                x=.139*pw(cos(theta),.64)*pw(cos(phi),.64)
                y=.095*pw(cos(theta),.64)*pw(sin(phi),.68)
                z=.064*pw(sin(theta),.66)-.20*x-.20*y
                return center+Vector((x,sg*(y-.20*x),z))
            m.face([point(h,a),point(k,a),point(k,b),point(h,b)],'paint' if h>-.48 else 'clad',
                   tuple(point((h+k)/2,(a+b)/2)-center))
    obj('Mirror cap '+side,m)
    line('Mirror stalk '+side,[(2.39,sg*.875,1.069),(2.32,sg*.976,1.062),(2.29,sg*1.035,1.067)],.022,'clad',False)
    panel('Mirror silver '+side,lambda a,r:(2.208-.026*r*cos(a),sg*(1.027+.073*r*cos(a)),1.111+.044*r*sin(a)),
          seq(0,2*pi,28),[.001,1],'mirror',(-1,sg,0),False)
def spoiler():
    def blade(t,h):
        x=-.963+.055*t*t+h*(.164-.045*t*t)
        y=t*.539
        z=P.elevation('rear',x,y,240+16*t*t)+.007*sin(pi*h)
        return Vector((x,y,z))
    span=seq(-1,1,24);cross=[0,.10,.48,.87,1]
    def underside(t,h):return blade(t,h)-Vector((0,0,.012+.009*sin(pi*h)))
    skin=Mesh()
    P.grid(skin,span,cross,blade,'paint',(0,0,1))
    P.grid(skin,span,cross,underside,'clad',(0,0,-1))
    for h in (0,1):
        P.grid(skin,span,[0,1],lambda t,u:underside(t,h).lerp(blade(t,h),u),'paint',(2*h-1,0,0))
    for sg in (-1,1):
        P.grid(skin,cross,[0,1],lambda h,u:underside(sg,h).lerp(blade(sg,h),u),'paint',(0,sg,0))
        base=underside(sg*.92,.64)
        line('Spoiler pedestal',[base+Vector((.022,0,-.073)),base],.020,'clad',False)
    obj('Deployable spoiler',skin)

