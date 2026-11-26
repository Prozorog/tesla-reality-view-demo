"""The driver's wheel and the floating display, both in their own local bases."""
from math import pi, sin, cos, exp, radians
import bpy
from mathutils import Matrix
from .geometry import Part, v, X,Y,Z,TAU,rounded,rectangle,interp


def steering(palette, center, tilt_deg, diameter):
    p=Part("steering_wheel",palette,mapped=False)
    tilt=radians(tilt_deg)
    axis=v((-cos(tilt),0,sin(tilt)))
    up=v((sin(tilt),0,cos(tilt)))
    right=-Y
    basis=Matrix((right,up,axis)).transposed()
    def ring_data(a):
        x,y=sin(a),cos(a)
        r=diameter*.5-.016
        thumb=exp(-((abs(x)-.90)/.13)**2 - ((y-.36)/.27)**2)
        pt=v((r*x,r*y+.013*max(-y,0)**6,-.004+ .004*max(-y,0)**3))
        return pt,v((x,y,0)),.016+thumb*.0035
    rings=[]
    welt=[]
    for j in range(112):
        a=TAU*j/112
        pt,rad,width=ring_data(a)
        rings.append([pt+rad*width*cos(TAU*k/18)+Z*.0173*sin(TAU*k/18) for k in range(18)])
        welt.append(pt-rad*(width*.88)+Z*.008)
    p.loft(rings,'Wheel leather',loop=True)
    p.tube(welt,.00068,'Shadow trim',6,closed=True,guide=Z)
    # Bound hide at six o'clock, with the butt joint on the inside of the rim.
    pt,rad,width=ring_data(pi)
    p.tube([pt+rad*(width+.00015)*cos(TAU*k/22)+Z*.0175*sin(TAU*k/22) for k in range(22)],
           .00055,'Shadow trim',6,closed=True,guide=X)
    # Rear hub and rounded airbag bolster. Smaller, separately embossed horn pad sits forward.
    def face(poly,base,thick,radius,edge,mat):
        p.panel((0,0,base),X,Y,rounded(poly,radius,6),thick,edge,mat)
    p.box((0,0,-.047),X,Y,.122,.110,.058,.03,.015,'Shadow trim')
    outer=[(-.086,.044),(-.069,.061),(.069,.061),(.086,.044),
           (.067,-.039),(.041,-.076),(-.041,-.076),(-.067,-.039)]
    face(outer,-.032,.063,.024,.016,'Wheel pad')
    horn=[(-.059,.039),(.059,.039),(.057,.018),(.040,-.047),(.030,-.052),
          (-.030,-.052),(-.040,-.047),(-.057,.018)]
    face(horn,.030,.0023,.014,.0006,'Vent throat')
    inset=rounded([(x*.963,y*.954) for x,y in horn],.014,7)
    p.loft([[(x*scale,y*scale,z) for x,y in inset]
            for scale,z in [(1.,.0321),(.985,.0340),(.95,.0351),
                            (.77,.0363),(.46,.0372),(.18,.0375)]],'Wheel pad')

    for side in (-1,1):
        def mirror(poly):
            return [(side*x,y) for x,y in poly]
        spoke=mirror([(.059,.053),(.112,.050),(.142,.040),(.163,.016),
                      (.160,-.012),(.131,-.017),(.064,-.030)])
        face(spoke,-.027,.036,.009,.006,'Wheel leather')
        plate=mirror([(.069,.047),(.112,.044),(.142,.034),(.158,.012),
                      (.149,.001),(.079,-.016)])
        face(plate,.005,.004,.006,.0015,'Bright edge')
        face([(x*.979+side*.002,y*.935-.0006) for x,y in plate],.009,.003,.006,.001,'Switch')
        p.tube(interp([(side*x,y,.0120) for x,y in
                       [(.073,.043),(.109,.045),(.137,.037),(.152,.022),(.157,.012)]],5),
               .0009,'Bright edge',8,guide=Z,aspect=.67)
        # Transverse ribbing over a cylindrical scroll barrel, resting in an oval well.
        sx,sy=side*.1155,.017
        p.box((sx,sy,.012),X,Y,.0185,.024,.003,.008,.001,'Vent throat')
        rings=[]
        for i in range(37):
            f=(i-18)/18
            radius=.0081-.0020*abs(f)**4-.00050*(.5+.5*cos(pi*i/2))**3
            rings.append([(sx+.0074*f,sy+radius*cos(TAU*k/20),.0105+radius*sin(TAU*k/20))
                          for k in range(20)])
        p.loft(rings,'Switch')
        # Navigation chevrons and differentiated left indicator / right voice marks.
        for dx in (-.018,.018):
            tip=1 if dx>0 else -1
            p.tube([(sx+dx-.0014*tip,sy-.002,.0127),(sx+dx+.0009*tip,sy,.0127),
                    (sx+dx-.0014*tip,sy+.002,.0127)],.00047,'Wheel legend',5,guide=Z)
        mx=sx-side*.015
        for j in range(3):
            height=(.0024,.0042,.0024)[j]
            p.tube([(mx+j*.0018,.032-height*.5,.0127),(mx+j*.0018,.032+height*.5,.0127)],
                   .00043,'Wheel legend',5,guide=Z)

    # Split lower spoke: a real aperture, wrapped with continuous brightwork.
    outline=[(-.061,-.047),(-.045,-.070),(-.025,-.128),(-.018,-.137),
             (.018,-.137),(.025,-.128),(.045,-.070),(.061,-.047)]
    for side in (-1,1):
        arm=[(side*x,y) for x,y in [(.044,-.049),(.065,-.041),(.040,-.114),
                                  (.026,-.157),(.011,-.161),(.015,-.143),(.030,-.088)]]
        face(arm,-.021,.028,.004,.004,'Shadow trim')
    face([(-.026,-.135),(.026,-.135),(.024,-.155),(-.024,-.155)],-.023,.03,.005,.003,'Gunmetal')
    p.tube(interp([(x,y,.008) for x,y in outline],5),.00265,'Bright edge',10,guide=Z,aspect=.6)

    # Raised, spaced TESLA wordmark. Open E bars and split A echo the wheel stamping.
    strokes={
        'T': [[(0,1),(.87,1)],[(.435,.96),(.435,0)]],
        'E': [[(0,1),(.84,1)],[(0,.5),(.69,.5)],[(0,0),(.84,0)]],
        'S': [[(.86,1),(.06,1),(0,.88),(0,.58),(.12,.50),(.74,.50),
               (.83,.40),(.83,.1),(.74,0),(0,0)]],
        'L': [[(0,1),(0,0),(.85,0)]],
        'A': [[(0,0),(.39,1),(.52,1),(.91,0)],[(.23,.37),(.67,.37)]]}
    for i,letter in enumerate("TESLA"):
        for stroke in strokes[letter]:
            p.tube([((i-2)*.0102+(x-.45)*.0053,.009+y*.0050,.03740)
                    for x,y in stroke],.00052,'Emboss',6,guide=Z,aspect=.75)
    ob=p.finish()
    ob.matrix_world=basis.to_4x4()
    ob.location=center
    ob["axis_blender_local"]=[0.,0.,1.]
    ob["axis_gltf_local"]=[0.,1.,0.]
    column=Part("column_shroud",palette)
    column.loft([[v(center)+axis*t+right*w*cos(TAU*i/44)+up*h*sin(TAU*i/44)
                  for i in range(44)] for t,w,h in [(-.037,.037,.039),(-.095,.055,.05),
                                                     (-.14,.067,.059),(-.29,.063,.052)]],'Shadow trim')
    column.finish()
    return ob,axis


def screen(palette,center,tilt,width,height):
    origin=v(center)
    right=-Y
    up=v((sin(radians(tilt)),0,cos(radians(tilt))))
    front=right.cross(up)
    case=Part("screen_bezel",palette)
    for w,h,d,t,r,e,mat in [
        (width+.009,height+.009,-.023,.012,.014,.0035,'Shadow trim'),
        (width+.016,height+.016,-.016,.011,.012,.003,'Display edge'),
        (width+.015,height+.015,-.0058,.0055,.0115,.0017,'Black glass bezel')]:
        case.panel(origin+front*d,right,up,rectangle(w,h,r),t,e,mat)
    case.finish()
    stand=Part("display_pedestal",palette)
    # The stalk lands on the lower rear shell. Its foot disappears into the dash knee.
    foot=origin+v((.127,0,-.111))
    tip=origin+v((.013,0,-.055))
    stand.loft([[v(pt)+right*u+up*v_ for u,v_ in rectangle(w,h,.008)]
                for pt,w,h in [(foot,.064,.039),(foot+v((-.033,0,.008)),.049,.033),
                                 (tip,.048,.038)]],'Shadow trim')
    stand.finish()
    uv=[(0,0),(1,0),(1,1),(0,1)]
    corners=[origin+right*(u-.5)*width+up*(vv-.5)*height for u,vv in uv]
    mesh=bpy.data.meshes.new("screen_surface")
    mesh.from_pydata(corners,[],[(0,1,2,3)])
    layer=mesh.uv_layers.new(name="SurfaceUV")
    for datum,xy in zip(layer.data,uv):
        datum.uv=xy
    mesh.materials.append(palette["screen"])
    ob=bpy.data.objects.new("screen_surface",mesh)
    bpy.context.collection.objects.link(ob)
    ob["lightmap_receiver"]=False
    return list(zip(corners,uv))

