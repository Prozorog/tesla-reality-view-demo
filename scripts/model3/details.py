"""Surface-fitted closures, lighting optics, brightwork and mirror shells."""
from math import atan2, cos, pi, sin, sqrt

from mathutils import Vector

from .mesh import cord, grid, interpolate, path, steps
from .shell import COWL, FRONT, HEADER, HOOD_EDGE, REAR, REAR_GLASS, end_at, side_at_z, top, top_at_y


def fitted(point,lift):
    location,normal,_,_=skin.find_nearest(Vector(point))
    return location+normal*lift


def fascia(s,a,z,sign,lift):
    p=Vector(end_at(s,a,z,sign))
    return fitted(p,lift)


def band(mesh, points, sample, width, mat, outward, count=36):
    """Width is measured in the two coordinates of the designer's section drawing."""
    line=path(points,count)
    rows=[]
    for i,(a,b) in enumerate(line):
        x,y=line[min(i+1,count)]
        u,v=line[max(0,i-1)]
        dx,dy=x-u,y-v
        length=sqrt(dx*dx+dy*dy)
        w=width(i/count) if callable(width) else width
        nx,ny=-dy/length*w/2,dx/length*w/2
        rows.append((sample(a+nx,b+ny),sample(a-nx,b-ny)))
    for p,q in zip(rows,rows[1:]):
        mesh.face([p[0],p[1],q[1],q[0]],mat,outward)


def capsule(mesh, p, q, height, sample, mat, outward):
    # Rounded oblong with a straight land between the end radii.
    a,b=p
    c,d=q
    theta=atan2(d-b,c-a)
    points=[]
    for x,y,phase in [(c,d,-pi/2),(a,b,pi/2)]:
        for u in steps(6):
            angle=theta+phase+pi*u
            points.append(sample(x+.5*height*cos(angle),y+.5*height*sin(angle)))
    centre=sample((a+c)/2,(b+d)/2)
    for i in range(len(points)):
        mesh.face([centre,points[i-1],points[i]],mat,outward)


def rear(parts,sign):
    trim=parts['trim_black']
    n=(-1,sign*.4,.1)
    def sample(lift):
        return lambda a,z:fascia(REAR,a,z,sign,lift)
    def blade(mesh,sections,mat,lift):
        # Each section gives the top and bottom of the swept lamp lens.
        topkeys=[(u,h) for u,h,l in sections]
        botkeys=[(u,l) for u,h,l in sections]
        a0,a1=sections[0][0],sections[-1][0]
        def pt(t,v):
            a=a0+(a1-a0)*t
            return sample(lift)(a,interpolate(botkeys,a)*(1-v)+interpolate(topkeys,a)*v)
        grid(mesh,steps(48),[0,.33,.67,1],pt,mat,n)
    # The unlit spear continues along the quarter. The lit return turns much
    # earlier, just as the back face changes into the side of the fender.
    blade(trim,[(.335,.944,.940),(.46,.957,.923),(.65,.964,.923),(.685,.965,.852),
                (.86,.970,.840),(.992,.974,.843),(1.075,.975,.860),
                (1.21,.979,.918),(1.34,.981,.979)],'tail_housing',.0009)
    blade(parts['lights_brake'],[(.48,.940,.938),(.69,.949,.933),(.84,.950,.930),
          (.94,.949,.900),(.981,.945,.874),(1.003,.939,.875),
          (1.012,.925,.899)],'brake',.0019)
    outline=[(.351,.944),(.52,.952),(.76,.958),(.90,.959),(.972,.955),
             (1.005,.947),(1.022,.929),(1.030,.901),(1.032,.880),(1.022,.865),
             (.995,.858),(.94,.856),(.82,.857),(.684,.864)]
    band(parts['lights_tail'],outline,sample(.0031),lambda t:.003+.016*sin(pi*t)**.7,'tail',n,76)
    # Visible when switched, with a dark ruby/amber lens at rest.
    band(parts['indicators_left' if sign>0 else 'indicators_right'],
         [(1.085,.937),(1.15,.947),(1.23,.958)],sample(.0021),.009,'turn_l' if sign>0 else 'turn_r',n)
    band(parts['lights_reverse'],[(.752,.879),(.835,.876),(.910,.877)],sample(.0022),.006,'reverse',n,20)
    # Under bumper satin valance and its slim, passive red corner reflector.
    val=[(0,.421),(.60,.414),(.79,.394),(.95,.310),(1.05,.246),(1.20,.195),(1.3,.174)]
    def valance(t,v):
        a=t*1.30
        low=.146+.042*(1-min(a,1)**2)
        return sample(.0012)(a,low+(interpolate(val,a)-low)*v)
    grid(trim,steps(30),[0,.12,.65,1],valance,'valance',(-1,sign*.3,0))
    band(trim,[(.62,.355),(.72,.361),(.82,.355)],sample(.0020),.015,'reflector',n,16)
    # Opening line around the lid picks up below the shorter LED return.
    shut=[(.70,.831),(.674,.775),(.645,.656),(.60,.614),(.48,.603),(0,.600)]
    cord(trim,[sample(.002)(a,z) for a,z in path(shut,35)],.0026,'seam')
    # Reference-size European plate, embossed into a dark rear plinth.
    def plate(t,v):
        half=.341-.010*(2*v-1)**8
        return sample(.0008)(t*half,.637+.107*v)
    grid(trim,steps(8),steps(4),plate,'plate',(-1,0,0))
    for a in [.225,.237]:
        band(trim,[(a,.742),(a+.025,.742)],sample(.0014),.0025,'hardware',n,4)


def wordmark(parts):
    # Five stamped, alpha-free glyphs. In rear view positive Y reads to the left.
    letters=[
        [[(.01,1),(.98,1)],[(.5,.99),(.5,.0)]],
        [[(.08,1),(.96,1)],[(.08,.50),(.83,.50)],[(.08,.02),(.96,.02)]],
        [[(.96,1),(.16,1),(.06,.87),(.06,.60),(.17,.51),(.83,.51),(.94,.42),(.94,.13),(.84,.015),(.03,.015)]],
        [[(.11,1),(.11,.02),(.95,.02)]],
        [[(.02,0),(.44,.99),(.57,.99),(.99,0)],[(.22,.36),(.78,.36)]],
    ]
    for i,glyph in enumerate(letters):
        for stroke in glyph:
            points=[((2-i)*.110+(.5-u)*.059,.884+v*.042) for u,v in stroke]
            for (y0,z0),(y1,z1) in zip(points,points[1:]):
                def mark(y,z):
                    return fascia(REAR,abs(y)/top(REAR,4)[1],z,1 if y>=0 else -1,.0018)
                band(parts['wordmark'],[(y0,z0),(y1,z1)],mark,.0054,'letter',(-1,0,0),3)


def front(parts,sign):
    trim=parts['trim_black']
    n=(.55,sign*.2,1)
    # Slender, swept lamp recessed visually into the fender ridge.
    shape=[(0,3.695,.465,.006),(.20,3.652,.559,.078),(.52,3.588,.686,.126),
           (.74,3.491,.775,.143),(.90,3.325,.838,.099),(1,3.173,.875,.005)]
    keys=[[(r[0],r[i]) for r in shape] for i in [1,2,3]]
    def optic(t,v,lift):
        x,y,width=[interpolate(k,t) for k in keys]
        return fitted(top_at_y(x+(v-.5)*width,y,sign),lift)
    grid(trim,steps(25),[0,.3,.8,1],lambda t,v:optic(t,v,.003),'lens_smoke',n)
    def drl(t,v):
        u=.045+.90*t
        centre=interpolate([(0,.86),(.52,.85),(.73,.78),(1,.27)],t)
        return optic(u,centre+(v-.5)*(.15+.13*t),.0065)
    grid(parts['lights_head'],steps(28),[0,1],drl,'head',n)
    for a,b in [(.29,.44),(.49,.63),(.66,.76)]:
        grid(trim,steps(5),[0,1],lambda t,v:optic(a+(b-a)*t,.12+.21*v,.005),'projector',n)
    grid(parts['indicators_left' if sign>0 else 'indicators_right'],steps(8),[0,1],
         lambda t,v:optic(.79+.17*t,.19+.11*v,.007),'turn_l' if sign>0 else 'turn_r',n)
    # Smooth upper bumper and a single low, narrow air slot at the chin.
    def intake(t,v):
        a=.92*t
        h=.088*(1-t**5)**.75
        return fascia(FRONT,a,.242+.023*t*t+h*v,sign,.003)
    grid(trim,steps(28),[0,.16,.8,1],intake,'intake',(1,sign*.15,0))
    for z in [.267,.286]:
        band(trim,[(0,z),(.40,z+.002),(.67,z+.010),(.80,z+.014)],
             lambda a,h:fascia(FRONT,a,h,sign,.005),.003,'grille_rib',(1,0,0),18)
    # A slim shutline defines the leading edge and folds back up each hood swage.
    hood=[(COWL,.702),(2.66,.654),(3.08,.598),(3.36,.554),(3.56,.506),(3.646,.431),(3.669,.31),(HOOD_EDGE,0)]
    pts=[fitted(top_at_y(x,y,sign),.0015) for x,y in path(hood,55)]
    cord(trim,pts,.0024,'seam')
    # Raised T nose badge with a separate slender upper arc.
    for curve,w in [([(3.499,0),(3.508,.022),(3.513,.037)],.0055),
                    ([(3.512,0),(3.519,.017),(3.520,.030)],.005),
                    ([(3.511,.006),(3.539,.002),(3.551,0)],.005)]:
        band(trim,curve,lambda x,y:Vector(top_at_y(x,max(0,y),sign))+Vector((0,0,.0035)),
             w,'letter',(0,0,1),9)


def doors(parts,sign):
    trim=parts['trim_black']
    def side_point(x,z,lift=.003):
        hit,normal,_,_=skin.ray_cast(Vector((x,sign*1.2,z)),Vector((0,-sign,0)),.42)
        if hit is not None:
            return hit+normal*lift
        return fitted(side_at_z(x,z,sign),lift)
    for curve in [[(2.222,.899),(2.255,.841),(2.282,.737),(2.274,.491),(2.247,.268),(2.205,.235)],
                  [(.957,.925),(.912,.875),(.888,.713),(.884,.506),(.891,.335),(.862,.240)],
                  [(-.008,.967),(-.014,.917),(.117,.768),(.267,.599),(.369,.422),(.421,.294),(.489,.250),(.635,.239),(1.55,.232),(2.205,.235)]]:
        cord(trim,[side_point(x,z,.0023) for x,z in path(curve,45)],.0025,'seam')
    for x,z in [(1.104,.857),(.174,.892)]:
        capsule(trim,(x,z),(x+.143,z-.004),.024,side_point,'handle',(0,sign,0))
        capsule(trim,(x+.013,z+.004),(x+.127,z+.001),.0028,lambda a,b:side_point(a,b,.0043),'aero_edge',(0,sign,0))
    # Trunk-to-quarter shutline turns off the rear point of the side glazing.
    joint=[(-.309,.772),(-.42,.755),(-.55,.735),(-.69,.715),(-.82,.701),(REAR,.696)]
    cord(trim,[fitted(top_at_y(x,y,sign),.0014) for x,y in path(joint,32)],.0023,'seam')
    # Slim triangular front fender repeater/camera housing, below the mirror.
    points=[side_point(2.382,.809),side_point(2.490,.824),side_point(2.459,.783),side_point(2.441,.777)]
    trim.face(points,'pillar',(0,sign,0))
    capsule(trim,(2.445,.794),(2.454,.795),.009,lambda a,b:side_point(a,b,.005),'projector',(0,sign,0))
    # Third stop lamp follows the upper rear-glass crown under its ceramic border.
    def stop(t,v):
        return fitted(top(.395+.015*v,.535*t,sign),.0018)
    grid(parts['lights_brake'],steps(12),[0,1],stop,'brake',(-.2,0,1))
    for s in [REAR_GLASS,HEADER,COWL]:
        grid(trim,steps(32),[0,1],lambda t,v:fitted(top(s+(v-.5)*.008,t,sign),.0009),
             'seam',(0,0,1))
    # Flush glass over the B-pillar, with narrow joints at the door and quarter.
    for s,sweep in [(.959,-.051),(.036,-.078)]:
        grid(trim,steps(16),[0,1],lambda t,v:fitted(top(s+sweep*t+(v-.5)*.005,2.045+.905*t,sign),.0008),
             'seam',(0,sign,0))
    grid(trim,steps(26),[0,.5,1],lambda t,v:side_point(.353+t*2.169,.150+.017*v),
         'valance',(0,sign,0))


MIRROR_CENTRE=(2.066,.958,.997)


def mirror(parts,sign):
    mesh=parts['mirror_L' if sign>0 else 'mirror_R']
    # Stalk lofts out of the front sail; trailing face is a convex mirror insert.
    rings=[]
    for y,x,z,rx,rz in [(.805,2.126,.942,.073,.031),(.835,2.113,.947,.084,.030),
                          (.887,2.085,.958,.057,.019),(.928,2.069,.968,.061,.023)]:
        rings.append([(x+rx*cos(2*pi*t),sign*y,z+rz*sin(2*pi*t)) for t in steps(16)[:-1]])
    for a,b in zip(rings,rings[1:]):
        for i in range(16):
            j=(i+1)%16
            mesh.face([a[i],a[j],b[j],b[i]],'gasket',(a[i][0]-2.10,sign*.005,a[i][2]-.95))
    rings=[]
    for x,y,z,w,h in [(1.981,.952,.997,.086,.046),(1.987,.954,.998,.0905,.050),
                       (2.023,.956,.999,.0885,.053),(2.071,.953,1.003,.083,.052),
                       (2.122,.948,1.000,.067,.044),(2.162,.944,.992,.041,.028),(2.18,.941,.989,.007,.007)]:
        ring=[]
        for t in steps(28)[:-1]:
            angle=2*pi*t
            c,s=cos(angle),sin(angle)
            yy=w*abs(c)**.85*(1 if c>=0 else -1)
            zz=h*abs(s)**.78*(1 if s>=0 else -1)
            ring.append((x+.027*c,sign*(y+yy),z+zz+.007*c))
        rings.append(ring)
    for a,b in zip(rings,rings[1:]):
        for i in range(28):
            j=(i+1)%28
            mesh.face([a[i],b[i],b[j],a[j]],'paint' if sin((i+.5)*2*pi/28)>-.30 else 'gasket',
                      (0,sign*cos(i*2*pi/28),sin(i*2*pi/28)))
    for ring,centre,mat,direction in [(rings[0],(1.977,sign*.952,.997),'mirror_glass',-1),
                                      (rings[-1],(2.182,sign*.941,.989),'paint',1)]:
        for i in range(28):
            j=(i+1)%28
            inner=Vector(centre)+(Vector(ring[i])-Vector(centre))*.90
            inner2=Vector(centre)+(Vector(ring[j])-Vector(centre))*.90
            mesh.face([ring[i],ring[j],inner2,inner],'gasket' if direction<0 else mat,(direction,0,0))
            mesh.face([inner,inner2,centre],mat,(direction,0,0))


def add_details(parts,subdivided_skin):
    global skin
    skin=subdivided_skin
    for sign in [1,-1]:
        rear(parts,sign)
        front(parts,sign)
        doors(parts,sign)
        mirror(parts,sign)
    wordmark(parts)
