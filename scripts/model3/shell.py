"""Longitudinal loft with explicit deck, roof rail, tumblehome and belt stations.

s measures distance along the car in Blender X. The end stations sweep around
the corners in plan. k=0..4 crosses centreline, glass edge, cant rail, daylight
opening and shoulder. v=0..1 runs down the side or bumper to the lower return.
"""
from functools import lru_cache
from math import acos, cos, exp, pi, sin

import bpy
from mathutils.bvhtree import BVHTree

from .mesh import Mesh, grid, interpolate, steps


REAR, FRONT = -.904, 3.707
AXLES = (0., 2.875)
RADIUS = .3345
CLEARANCE = .138
REAR_GLASS, HEADER, COWL = -.54, 1.47, 2.32
HOOD_EDGE = 3.677
# Allow 2 mm for the subdivided return and the chords between polar stations.
OPENING = RADIUS + .047
ARCH_SPAN = .418
LIP_RISE = .019
BACKLIGHT_TOP = .429
SIDE_BACK, SIDE_FRONT = -.315, 2.255

# s, centre Z, edge of central panel Y/Z, upper side-window Y/Z,
# lower side-window Y/Z, maximum body half-width, shoulder Z
SECTIONS = [
    (REAR, 1.029,.50,1.026,.622,1.016,.728,1.002,.814,.984),
    (-.79, 1.049,.52,1.045,.647,1.033,.752,1.014,.842,.990),
    (-.67, 1.071,.53,1.061,.663,1.043,.765,1.022,.865,.996),
    (-.54, 1.099,.50,1.080,.689,1.057,.774,1.038,.887,1.000),
    (-.315,1.157,.538,1.129,.769,1.071,.779,1.064,.910,.994),
    (-.06, 1.235,.567,1.204,.724,1.158,.791,1.023,.923,.981),
    (.30,  1.347,.592,1.319,.674,1.284,.801,.987,.919,.958),
    (.64,  1.425,.584,1.392,.659,1.361,.807,.969,.908,.940),
    (.91,  1.445,.585,1.410,.660,1.379,.812,.960,.904,.934),
    (1.19, 1.427,.591,1.397,.666,1.368,.817,.953,.904,.928),
    (1.47, 1.371,.612,1.347,.687,1.318,.819,.946,.906,.923),
    (1.78, 1.258,.640,1.241,.716,1.212,.820,.940,.910,.918),
    (2.05, 1.128,.675,1.114,.753,1.081,.819,.936,.914,.909),
    (2.255,1.018,.695,1.004,.797,.957,.815,.932,.916,.903),
    (2.32, .995,.700,.982,.791,.950,.827,.927,.918,.899),
    (2.59, .951,.657,.953,.748,.945,.832,.918,.919,.886),
    (2.875,.911,.605,.927,.737,.930,.843,.907,.924,.867),
    (3.12, .865,.571,.890,.725,.897,.843,.875,.919,.839),
    (3.36, .803,.532,.831,.681,.851,.808,.835,.898,.793),
    (3.54, .752,.494,.773,.643,.799,.770,.792,.872,.754),
    (3.645,.723,.464,.735,.614,.753,.740,.750,.846,.725),
    (FRONT,.689,.449,.696,.600,.714,.722,.713,.819,.686),
]
PROFILES = [list(zip([r[0] for r in SECTIONS], values)) for values in list(zip(*SECTIONS))[1:]]


@lru_cache(maxsize=8192)
def section(s):
    return tuple(interpolate(p, s) for p in PROFILES)


def end_weights(s):
    return max(0., 1-(s-REAR)/.53)**2, max(0., 1-(FRONT-s)/.53)**2


@lru_cache(maxsize=16384)
def top(s, k, sign=1):
    # Round the perimeter in plan, then sample the crown at its physical X.
    # This keeps the glass corners on the same fastback arc as the centreline.
    rounding=min(1., max(0., (s-REAR)/.36))
    rounding=rounding*rounding*(3-2*rounding)
    u=min(k,1)
    corner=1-(1-u*u)**.5
    offset=(.180*rounding*exp(-((s-REAR_GLASS)/.48)**2)*corner
            - .088*exp(-((s-COWL)/.33)**2)*u**4)*max(0,1-max(k-1,0)/3)
    zc, yg, zg, yr, zr, yw, zw, width, zs = section(s+offset)
    if k <= 1:
        y, z = yg*k, zc+(zg-zc)*k**2
    elif k <= 2:
        q=k-1
        y,z=yg+(yr-yg)*q, zg+(zr-zg)*q+.005*sin(pi*q)
    elif k <= 3:
        q=k-2
        y,z=yr+(yw-yr)*q+.012*sin(pi*q), zr+(zw-zr)*q
    else:
        q=k-3
        y,z=yw+(width-.014-yw)*q, zw+(zs-zw)*q+.002*sin(pi*q)
    r,f=end_weights(s)
    a=y/(width-.014)
    x=s+offset+r*(.034*a*a+.106*a**6) - f*(.095*a*a+.117*a**6)
    # The stamping lifts the last 245 mm progressively. The underlying deck
    # still falls towards the back, so the integrated lip has no valley ahead of it.
    z+=LIP_RISE*max(0,1-(s-REAR)/.245)**1.5*(1-.45*a*a)
    # Soft hood swages turn towards the nose emblem.
    if s > COWL:
        u=(s-COWL)/(FRONT-COWL)
        crease=.64-.23*u
        z -= .015*sin(pi*u)**.7 * exp(-((y-crease)/.064)**2)
        z -= .007*exp(-((s-3.44)/.24)**2-((y-.68)/.145)**2)
    return (x,sign*y,z)


def top_at_y(s,y,sign=1):
    a,b=0.,4.
    for _ in range(18):
        m=(a+b)/2
        if top(s,m)[1]<y:
            a=m
        else:
            b=m
    return top(s,(a+b)/2,sign)


@lru_cache(maxsize=8192)
def aperture(s,offset):
    """Concentric X/Z rings. Continue the circle below hub height into the sill."""
    axle=min(AXLES,key=lambda x:abs(s-x))
    d=s-axle
    radius=OPENING+offset
    sill=CLEARANCE+offset
    limit=acos((sill-RADIUS)/radius)
    t=max(-1,min(1,d/ARCH_SPAN))
    arc_x=axle+radius*sin(limit*t)
    if abs(d)<=ARCH_SPAN:
        return arc_x,RADIUS+radius*cos(limit*t)
    # Spread the small fore/aft displacement of the arch foot into the rocker.
    blend=max(0,1-(abs(d)-ARCH_SPAN)/.17)**2
    datum=top(s,4)[0]
    z=sill+.032*max(0,1-(s-REAR)/.46)+.025*max(0,1-(FRONT-s)/.46)
    return datum+blend*(arc_x-(axle+t*ARCH_SPAN)),z


SIDE_SWELL=[(0,0),(.051,.012),(.16,.014),(.35,.004),(.61,-.014),(.80,-.023),(1,-.029)]
REAR_BUMPER=[(0,0),(.10,-.016),(.28,-.0555),(.47,-.073),(.55,-.073),
             (.64,-.087),(.72,-.084),(.89,-.051),(1,-.025)]
FRONT_BUMPER=[(0,0),(.09,.019),(.22,.028),(.43,.0305),(.68,.0265),
              (.81,.022),(.91,.010),(1,-.014)]


@lru_cache(maxsize=16384)
def side(s,v,sign=1):
    xt,y,zt=top(s,4)
    if v<=.83:
        u=v/.83
        xl,zl=aperture(s,.044)
        x=xt+(xl-xt)*u*u
        z=zt+(zl-zt)*u
    else:
        offset=interpolate([(.83,.044),(.935,.011),(1,0)],v)
        x,z=aperture(s,offset)
    rear,front=end_weights(s)
    t=(zt-z)/(zt-aperture(s,0)[1])
    x+=rear*interpolate(REAR_BUMPER,t)+front*interpolate(FRONT_BUMPER,t)
    depth=(zt-z)/(zt-CLEARANCE)
    door=exp(-((s-1.43)/1.16)**4)
    crease=.291+.031*(1.43-s)
    y+=interpolate(SIDE_SWELL,depth)
    y-=.039*door*exp(-((z-crease-.093)/.095)**2)
    y+=.020*door*exp(-((z-crease)/.047)**2)
    radius=min(((x-c)**2+(z-RADIUS)**2)**.5 for c in AXLES)
    y+=.026*exp(-((radius-OPENING-.011)/.032)**2)
    y=min(y,section(s)[7])
    return (x,sign*y,z)


def side_at_z(s,z,sign=1):
    lo,hi=0.,1.
    for _ in range(15):
        mid=(lo+hi)/2
        if side(s,mid)[2]>z: lo=mid
        else: hi=mid
    return side(s,(lo+hi)/2,sign)


def end(s,k,v,sign=1):
    if v==0: return top(s,k,sign)
    x,y,zt=top(s,k)
    xe,ye,ze=top(s,4)
    sx,sy,sz=side(s,v)
    a=y/ye
    rear=s==REAR
    # Bumper centre reaches the dimension datum. Ends turn up into the fenders.
    edge_low=aperture(s,0)[1]
    t=(ze-sz)/(ze-edge_low)
    low=edge_low+(.022 if rear else -.005)*(1-a*a)
    z=zt+(low-zt)*t
    shift=interpolate(REAR_BUMPER if rear else FRONT_BUMPER,t)
    x+=shift*(1-a*a)+(sx-xe)*a*a
    if rear:
        # Recess beneath the stamped ledge carrying the letters; the outer
        # shoulder rolls into the lamp, while the plate well pinches in below.
        x+=.010*exp(-((z-.700)/.080)**4)*max(0,1-(a/.76)**6)**2
    return (x,sign*(y+(sy-ye)*a),z)


def end_at(s,a,z,sign=1):
    """Sample a fascia by fraction of its plan half-width, then wrap onto the wing."""
    if a>1:
        along=s+(a-1)*(.72 if s==REAR else -.72)
        return side_at_z(along,z,sign)
    want=top(s,4)[1]*a
    lo,hi=0.,4.
    for _ in range(17):
        k=(lo+hi)/2
        if top(s,k)[1]<want: lo=k
        else: hi=k
    k=(lo+hi)/2
    lo,hi=0.,1.
    for _ in range(15):
        mid=(lo+hi)/2
        if end(s,k,mid)[2]>z: lo=mid
        else: hi=mid
    return end(s,k,(lo+hi)/2,sign)


def longitudinal_grid():
    cuts={REAR,FRONT,REAR_GLASS,HEADER,COWL,SIDE_BACK,SIDE_FRONT}
    cuts.update(r[0] for r in SECTIONS)
    cuts.update([REAR+.014,FRONT-.019,BACKLIGHT_TOP])
    for x in AXLES:
        cuts.update(x+ARCH_SPAN*(2*t-1) for t in steps(26))
        for sign in [-1,1]:
            cuts.add(x+sign*(ARCH_SPAN+.013))
    keys=sorted(cuts)
    return sorted({a+(b-a)*t for a,b in zip(keys,keys[1:]) for t in steps(max(1,round((b-a)/.086)))})


K=[0,.42,.72,.90,.978,1,1.075,1.48,1.96,2.045,2.22,2.60,2.95,3.065,3.37,3.73,4]
V=[0,.023,.075,.155,.29,.43,.495,.575,.70,.83,.935,1]


def roof_material(s,k):
    if REAR_GLASS<s<COWL and k<1:
        return 'glazing'
    if REAR_GLASS<s<COWL and k<1.075:
        return 'gasket'
    if SIDE_BACK<s<SIDE_FRONT and 1.96<k<3.065:
        return 'glazing' if 2.045<k<2.95 else 'gasket'
    return 'paint'


def build_shell(parts,mats):
    cage=Mesh()
    stations=longitudinal_grid()
    for sign in [-1,1]:
        grid(cage,stations,K,lambda s,k:top(s,k,sign),roof_material,(0,sign*.35,1))
        grid(cage,stations,V,lambda s,v:side(s,v,sign),'paint',(0,sign,0))
        for s in [REAR,FRONT]:
            grid(cage,K,V,lambda k,v:end(s,k,v,sign),'paint',(-1 if s==REAR else 1,0,0))
        # Fold the sill back. Inside each arch the same continuous boundary becomes
        # a deep wheelhouse and an opaque inboard liner. The central floor is open.
        for a,b in zip(stations,stations[1:]):
            pa,pb=side(a,1,sign),side(b,1,sign)
            ia=(pa[0],sign*.625,pa[2]+.001)
            ib=(pb[0],sign*.625,pb[2]+.001)
            # A short folded edge supports the paint before the deep felt return.
            ga=(pa[0],pa[1]-sign*.009,pa[2])
            gb=(pb[0],pb[1]-sign*.009,pb[2])
            mid=(a+b)/2
            axle=min(AXLES,key=lambda x:abs(mid-x))
            in_arch=abs(mid-axle)<ARCH_SPAN
            inward=(axle-(pa[0]+pb[0])/2,0,RADIUS-(pa[2]+pb[2])/2) if in_arch else (0,0,-1)
            cage.face([pa,pb,gb,ga],'liner',inward)
            cage.face([ga,gb,ib,ia],'liner',inward)
            if in_arch:
                parts['trim_black'].face([ia,ib,(ib[0],ib[1],.149),(ia[0],ia[1],.149)],'liner',(0,sign,0))
    ob=cage.object('loft_cage',mats)
    mod=ob.modifiers.new('One Catmull-Clark pass on joined cross sections','SUBSURF')
    mod.levels=1
    ev=ob.evaluated_get(bpy.context.evaluated_depsgraph_get())
    surface=ev.to_mesh()
    skin=BVHTree.FromPolygons([v.co.copy() for v in surface.vertices],
                              [tuple(p.vertices) for p in surface.polygons])
    by_material={v.name:k for k,v in mats.items()}
    for poly in surface.polygons:
        mat=by_material[surface.materials[poly.material_index].name]
        group='body' if mat=='paint' else 'glass' if mat=='glazing' else 'trim_black'
        part=parts[group]
        vertices=[surface.vertices[i] for i in poly.vertices]
        part.face([v.co for v in vertices],mat)
        for vertex in vertices:
            part.normals[part.index(vertex.co)]=tuple(vertex.normal)
    ev.to_mesh_clear()
    data=ob.data
    bpy.data.objects.remove(ob,do_unlink=True)
    bpy.data.meshes.remove(data)
    return skin
