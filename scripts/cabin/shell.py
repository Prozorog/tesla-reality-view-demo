"""Instrument-free fascia, wraparound light guide, aperture trim and door cards."""
from math import sin, cos, pi
from .geometry import Part, X,Y,Z,TAU,v,rounded,rectangle,interp


def dash(palette,warp):
    def sweep(part,profile,width,mat,taper=0):
        section=rounded(profile,.011,4)
        rings=[]
        for i in range(45):
            f=(i-22)/22
            end=max(0,(abs(f)-.92)/.08)**1.8
            px=sum(p.x for p in section)/len(section)
            pz=sum(p.y for p in section)/len(section)
            rings.append([(px+(x-px)*(1-taper*end)-.115*f**2-.026*f**6,
                           f*width,pz+(z-pz)*(1-taper*.5*end)-.012*f**4) for x,z in section])
        part.loft(rings,mat)
    p=Part("dash_shell",palette,warp)
    sweep(p,[(2.324,.978),(2.315,.986),(2.269,.984),(2.219,.967),(2.176,.951),
             (2.159,.944),(2.173,.937),(2.250,.945),(2.320,.943)],.806,'Upper dash')
    sweep(p,[(2.303,.927),(2.274,.941),(2.152,.929),(2.094,.881),(2.059,.852),
             (2.016,.850),(1.994,.846),(1.989,.826),(2.022,.789),
             (2.081,.717),(2.201,.700),(2.350,.819)],.810,'Upper dash',.22)
    sweep(p,[(2.174,.925),(2.089,.918),(2.052,.906),(2.061,.873),(2.161,.875)],
          .788,'Vent throat',.65)
    sweep(p,[(2.166,.940),(2.104,.937),(2.035,.927),(2.014,.920),
             (2.013,.911),(2.033,.907),(2.156,.919)],.777,'Dash weave',.94)
    sweep(p,[(2.085,.913),(2.020,.911),(2.024,.906),(2.109,.904)],.77,'Shadow trim',.9)
    for side in (-1,1):
        cheeks=[]
        for y,t in [(.749,.04),(.773,.32),(.787,.85),(.806,1)]:
            section=rounded([(2.18,.950),(2.03,.918),(2.012,.838),(2.19,.879)],.013)
            cheeks.append([(2.18+(x-2.18)*t-.126,side*y,z-.011) for x,z in section])
        p.loft(cheeks,'Upper dash')
    # Glovebox cut, tucked into the lower pad and stopping before the door.
    p.tube(interp([(2.010,-.138,.821),(2.010,-.235,.818),(2.000,-.484,.814),
                   (1.968,-.68,.806)],6),.0015,'Vent throat',6,guide=Z)
    p.finish()
    path=[]
    for i in range(65):
        u=(i-32)/32
        path.append(v((2.277-.135*u*u-.025*u**6,.784*u,.981-.014*u**4)))
    p=Part('dash_light_channel',palette,warp)
    p.tube(path,.006,'Shadow trim',10,guide=Z,aspect=.76)
    p.finish()
    return [q+v((-.0022,0,.0035)) for q in path]


def door(palette,warp,side,front):
    tag='left' if side==1 else 'right'
    p=Part('door_card_'+tag,palette,warp)
    def band(profile,mat,radius=.009):
        prof=rounded(profile,radius,4)
        rings=[]
        for i in range(17):
            t=i/16
            x=.75+1.438*t
            yoff=.024*sin(pi*t)-.025*max(0,(t-.77)/.23)**2
            zoff=.018*(1-t)**2-.012*t*t
            rings.append([(x,side*(y+yoff),z+zoff) for y,z in prof])
        p.loft(rings,mat)
    band([(.855,.294),(.856,.958),(.836,.985),(.810,.979),(.797,.956),
          (.789,.770),(.787,.656),(.744,.490),(.746,.313),(.770,.285)],'Upper dash',.017)
    band([(.837,.955),(.805,.956),(.791,.928),(.769,.846),(.757,.788),
          (.770,.755),(.788,.748),(.829,.778)],'Door insert',.012)
    band([(.842,.973),(.819,.979),(.803,.970),(.801,.958),(.826,.958)],'Pillar seal',.006)
    # The insert dies into the black arm support in one upswept line.
    def doorpoint(x,y,z):
        return v((x,side*y,z))
    pts=[doorpoint(.76,.807,.978),doorpoint(1.04,.824,.973),doorpoint(1.35,.829,.967),
         doorpoint(1.71,.823,.961),doorpoint(1.98,.809,.958),front]
    path=interp(pts,9)
    p.tube([q+v((0,side*.003,-.0018)) for q in path],.006,'Shadow trim',8,guide=Z,aspect=.76)
    light_path=path
    # Soft armrest, ramped hand pull and the door-release thumb switch.
    rings=[]
    for x,y,z,w,h in [(1.012,.772,.623,.015,.012),(1.055,.764,.631,.040,.025),
                       (1.203,.753,.643,.054,.035),(1.42,.750,.653,.057,.040),
                       (1.558,.762,.672,.046,.039),(1.702,.783,.724,.031,.032),
                       (1.801,.792,.765,.018,.017)]:
        rings.append([doorpoint(x,y+u,z+vv) for u,vv in rectangle(2*w,2*h,.025)])
    p.loft(rings,'Wheel leather')
    handle=interp([doorpoint(1.406,.754,.662),doorpoint(1.53,.749,.690),
                   doorpoint(1.63,.753,.738),doorpoint(1.749,.775,.813),
                   doorpoint(1.784,.784,.82)],7)
    p.tube(handle,[.015+.004*sin(pi*i/(len(handle)-1)) for i in range(len(handle))],
           'Satin console',14,guide=Y,aspect=1.2)
    # The upper handgrip is captured in the door insert, with a recessed
    # escutcheon surrounding the electric release.
    p.panel(doorpoint(1.759,.801,.804),side*X,Z,
            rounded([(-.039,-.033),(.028,-.029),(.044,.015),
                     (.029,.029),(-.017,.033),(-.040,.015)],.014),
            .023,.006,'Shadow trim')
    p.box(doorpoint(1.756,.779,.812),X,side*Y,.045,.021,.010,.01,.003,'Switch')
    p.box(doorpoint(1.405,.753,.687),X,Y,.134,.062,.010,.021,.004,'Satin console')
    for x in ([1.374,1.427] if side==1 else [1.414]):
        for y in ([.740,.766] if side==1 else [.753]):
            p.box(doorpoint(x,y,.695),X,Y,.032,.017,.008,.004,.0025,'Switch')
            p.box(doorpoint(x+.005,y,.699),X,Y,.002,.008,.001,.0004,.0002,'Wheel legend')
    # Forward speaker enclosure and the deep storage pocket at the bottom of the card.
    normal_in=-side*Y
    a=X*side
    b=Z
    p.panel(doorpoint(1.905,.755,.523),a,b,
            rounded([(-.16,-.111),(.12,-.122),(.160,-.059),(.14,.096),
                     (.068,.135),(-.076,.112),(-.15,.048)],.063,7),
            .012,.004,'Speaker cloth')
    p.tube(interp([doorpoint(1.01,.751,.396),doorpoint(1.22,.728,.405),
                   doorpoint(1.46,.727,.433),doorpoint(1.61,.744,.493)],7),
           .012,'Shadow trim',10,guide=Z)
    p.finish()
    return light_path


def openings(palette,warp):
    p=Part('windshield_frame',palette,warp)
    head=Part('headliner_and_roof_reveal',palette,warp)
    for side in (-1,1):
        # A-pillar skin and the dark gasket follow the edge of the open windscreen.
        rings=[]
        gasket=[]
        for i in range(19):
            t=i/18
            x=2.215-.870*t
            y=side*(.814-.177*t+.014*sin(pi*t))
            z=.961+.424*t+.015*sin(pi*t)
            a=v((.447,0,.895))
            # The cover nests against the body pillar and narrows into the roof rail.
            w=.061-.025*t
            depth=.054-.028*t
            rings.append([v((x,y,z))+Y*(side*w*cos(TAU*k/16))+a*(depth*sin(TAU*k/16))
                          for k in range(16)])
            gasket.append(v((x,y-side*w*.75,z))+a*depth*.64)
        p.loft(rings,'Headlining')
        # Bury the lower tip in the trim before the seal runs along the glass.
        gasket[0]+=Y*(side*.010)-a*.008
        p.tube(gasket,[.002]+[.006]*(len(gasket)-1),'Pillar seal',9,guide=Y)
        # Forward sail trim is opaque, but both side-window apertures stay open.
        p.panel((2.089,side*.828,1.007),side*X,Z,
                rounded([(side*u,z) for u,z in
                        [(-.083,-.032),(.103,-.032),(.100,-.004),(-.076,.081)]],.011),
                .012,.004,'Pillar seal')
        path=interp([(.38,side*.655,1.338),(.65,side*.657,1.379),
                     (1.00,side*.650,1.410),(1.345,side*.637,1.382)],7)
        head.tube(path,.041,'Headlining',14,guide=Y,aspect=.89)
        head.tube([q+v((0,-side*.045,.012)) for q in path],.015,'Roof reveal',10,guide=Y)
    rings=[]
    for i in range(25):
        t=(i-12)/12
        rings.append([(1.343+u-.010*t*t,.641*t,1.385+vv-.004*t*t)
                      for u,vv in rectangle(.044,.020,.008)])
    head.loft(rings,'Headlining')
    head.tube(interp([(1.316,-.635,1.383),(1.326,0,1.387),(1.316,.635,1.383)]),
              .006,'Roof reveal',10,guide=Z)
    head.tube(interp([(.385,-.62,1.364),(.371,0,1.403),(.385,.62,1.364)]),
              .024,'Roof reveal',10,guide=Z)
    p.finish()
    head.finish()

    p=Part('mirror_housing',palette,warp)
    # Adhesive button on the raked glass; the neck drops into the mirror case.
    p.loft([[(1.657+u,y,z-.42*u) for u,y in rectangle(w,h,.006)]
            for z,w,h in [(1.275,.038,.032),(1.269,.035,.030),
                          (1.266,.023,.020)]],'Roof reveal')
    p.tube(interp([(1.657,0,1.267),(1.655,0,1.257),(1.651,0,1.248),
                   (1.649,0,1.239)],5),.008,'Shadow trim',12,guide=Y)
    # Slight driverward yaw, with a tapered lower edge and continuous glass bevel.
    a=v((-.15,-.989,0)).normalized()
    b=v((.085,-.013,.996)).normalized()
    mid=v((1.635,0,1.219))
    outline=[(-.103,.030),(-.096,-.030),(-.083,-.038),(.083,-.038),
             (.096,-.030),(.108,.029),(.097,.035),(-.094,.035)]
    p.panel(mid-a.cross(b)*.025,a,b,rounded(outline,.012,7),.032,.005,'Shadow trim')
    p.panel(mid+a.cross(b)*.0067,a,b,rounded([(u*.97,vv*.919) for u,vv in outline],.011,7),
            .0015,.0006,'Mirror glass')
    p.finish()

