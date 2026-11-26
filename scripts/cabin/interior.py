"""Seat upholstery, open tunnel furniture and toe board."""
from math import sin, cos, pi
from .geometry import Part,X,Y,Z,TAU,rounded,rectangle,interp,v


def seats(palette,warp,hpoint):
    def oval(x):
        return abs(x)**.65*(1 if x>=0 else -1)
    for side in (-1,1):
        mid=v((hpoint.x,side*hpoint.y,hpoint.z))
        name='driver_seat' if side==1 else 'passenger_seat'
        p=Part(name,palette,warp)
        # The central back is swept up and aft. Separate cheeks taper into the shoulders.
        def sculpt_back(stations,offset,mat):
            rings=[]
            for z,x,w,t in stations:
                rings.append([mid+v((x+t*oval(cos(TAU*i/36)),offset+w*oval(sin(TAU*i/36)),z))
                              for i in range(36)])
            p.loft(rings,mat)
        sculpt_back([(-.069,-.008,.131,.056),(-.044,-.012,.174,.072),(.045,-.027,.185,.078),
                     (.155,-.059,.163,.072),(.308,-.103,.165,.065),
                     (.402,-.130,.160,.052),(.462,-.148,.109,.033),
                     (.474,-.150,.078,.024)],0,'Seat hide')
        sculpt_back([(.015,.016,.102,.042),(.050,.021,.127,.045),
                     (.171,-.027,.132,.047),(.310,-.067,.135,.042),
                     (.394,-.093,.125,.031),(.417,-.106,.094,.020)],0,'Seat centre')
        for edge in (-1,1):
            sculpt_back([(-.036,.015,.036,.043),(.017,.032,.059,.078),
                         (.122,.004,.065,.080),(.252,-.038,.056,.069),
                         (.358,-.075,.051,.063),(.423,-.105,.045,.045),
                         (.455,-.134,.022,.025)],edge*.141,'Seat hide')
            path=interp([mid+v((x,edge*y,z)) for z,x,y in
                         [(.018,.099,.121),(.105,.075,.134),(.26,.014,.132),
                          (.357,-.025,.137),(.419,-.065,.130),(.45,-.118,.105)]],6)
            p.tube(path,.0012,'Shadow trim',6,guide=Y)
            # Short stitches along the tailored shoulder seam.
            for i in range(1,len(path)-1,2):
                p.tube([path[i]+Y*edge*.003,path[i].lerp(path[i+1],.63)+Y*edge*.003],
                       .00065,'Seam thread',5,guide=Y)
        sculpt_back([(.402,-.137,.057,.040),(.441,-.146,.074,.045),
                     (.482,-.152,.092,.058),(.536,-.170,.093,.062),
                     (.584,-.178,.088,.052),(.609,-.179,.074,.037),
                     (.617,-.180,.048,.025)],0,'Seat hide')
        # Cushion and thigh supports with a bowed leading edge.
        for offset,w,h,material in [(0,.151,.048,'Seat centre'),
                                     (-.166,.053,.063,'Seat hide'),(.166,.053,.063,'Seat hide')]:
            rings=[]
            for x,z,s in [(-.128,-.070,.61),(-.101,-.071,.90),(.004,-.065,1),
                          (.144,-.049,1),(.265,-.037,.95),(.310,-.045,.72),(.323,-.052,.45)]:
                rings.append([mid+v((x,offset+w*s*oval(cos(TAU*i/32)),
                                z+h*s*oval(sin(TAU*i/32)))) for i in range(32)])
            p.loft(rings,material)
        p.finish()


def console(palette,warp):
    p=Part("centre_console",palette,warp)
    # Open tunnel with separate sidewalls. Tray/cup mouths have no spanning top face.
    for side in (-1,1):
        rings=[]
        for x,w,top,bot in [(.836,.115,.539,.28),(.916,.135,.572,.27),(1.16,.139,.570,.26),
                             (1.32,.132,.538,.265),(1.56,.121,.508,.27),(1.695,.118,.521,.29),
                             (1.80,.122,.641,.359),(1.91,.119,.744,.421)]:
            profile=rounded([(w,bot),(w,top-.007),(w-.005,top),(w-.015,top),
                             (w-.021,top-.010),(w-.021,bot)],.006,3)
            rings.append([(x,side*y,z) for y,z in profile])
        p.loft(rings,'Satin console')
    p.box((1.36,0,.301),X,Y,.96,.21,.062,.035,.018,'Shadow trim')
    # Rubber-lined deep tray, with visible side and end walls.
    p.loft([[(x+1.607,y,z) for x,y in rectangle(w,h,.014)] for z,w,h in
            [(.506,.160,.201),(.496,.147,.188),(.443,.126,.171),(.439,.118,.164)]],
           'Rubber',cap=False)
    p.box((1.607,0,.438),X,Y,.122,.17,.008,.014,.002,'Rubber')
    # Two real recessed cup wells. The outer boundary of each annulus tiles half the deck.
    cx=1.453
    for side in (-1,1):
        cy=side*.052
        rings=[]
        for section in ('deck','lip','bead','well','base'):
            ring=[]
            for k in range(64):
                a=TAU*k/64
                ca,sa=cos(a),sin(a)
                if section=='deck':
                    r=min(.074/max(abs(ca),1e-9),.052/max(abs(sa),1e-9))
                    z=.518
                else:
                    r,z={'lip':(.044,.518),'bead':(.0418,.514),
                         'well':(.036,.448),'base':(.031,.441)}[section]
                ring.append((cx+r*ca,cy+r*sa,z))
            rings.append(ring)
        p.loft(rings[:2],'Lid',cap=False,smooth=False)
        p.loft(rings[1:3],'Gunmetal',cap=False)
        p.loft(rings[2:],'Rubber',cap=False)
        p.box((cx,cy,.440),X,Y,.064,.062,.004,.026,.0008,'Rubber')
        for a in (.85,2.75,4.9):
            path=[(cx+.0385*cos(a+u),cy+.0385*sin(a+u),.483+.003*cos(u*4))
                  for u in (-.23,-.13,0,.13,.23)]
            p.tube(path,.003,'Shadow trim',8,guide=Z)
    # Partially retracted split lids with a radiused bright finger rail.
    for x,z,w,h in [(1.321,.529,.113,.221),(1.699,.521,.035,.200)]:
        p.box((x,0,z),X,Y,w,h,.012,.008,.003,'Lid')
        p.tube(interp([(x+w*.40,-h*.43,z+.006),(x+w*.45,-h*.26,z+.008),
                       (x+w*.46,h*.26,z+.008),(x+w*.40,h*.43,z+.006)],5),
               .002,'Gunmetal',8,guide=Z)
    # Sloped dual-phone charging pad with a padded lip and centre rib.
    a=v((.64,0,.768)).normalized()
    b=Y
    n=a.cross(b)
    c=v((1.8,0,.630))
    p.box(c,a,b,.284,.218,.021,.017,.005,'Shadow trim')
    for side in (-1,1):
        p.box(c+Y*side*.053+n*.012,a,b,.243,.100,.009,.010,.002,'Rubber')
    p.box(c+n*.017,a,b,.242,.006,.009,.002,.002,'Shadow trim')
    p.box(c-a*.126+n*.021,a,b,.014,.204,.020,.004,.004,'Shadow trim')
    # Padded armrest with a narrow double seam along its cap.
    outline=rectangle(.403,.252,.048)
    p.panel((1.084,0,.543),X,Y,outline,.064,.014,'Seat hide')
    p.panel((1.084,0,.605),X,Y,rectangle(.390,.247,.046),.012,.004,'Wheel leather')
    for width in (.233,.226):
        path=[(1.084+u,vv,.617) for u,vv in rectangle(.373,width,.043)]
        p.tube(path,.0008,'Seam thread',5,closed=True,guide=Z)
    p.finish()


def footwell(palette,warp):
    p=Part('carpet_and_footwells',palette,warp)
    # The centre tunnel and cross-car firewall close low sight lines between
    # the tunnel sides, toe boards and underside of the dash.
    p.box((1.49,0,.246),X,Y,1.97,.37,.035,.045,.006,'Carpet')
    p.box((2.349,0,.536),Y,Z,1.67,.565,.057,.060,.012,'Carpet')
    p.box((2.193,0,.755),X,Y,.334,1.57,.079,.046,.014,'Upper dash')
    # Continuous toe board behind the pedals meets the fascia and both door heels.
    for side in (-1,1):
        rings=[]
        for x,z in [(.51,.285),(.76,.263),(1.4,.250),(1.88,.245),
                    (2.083,.265),(2.205,.349),(2.277,.491),(2.298,.748),(2.265,.809)]:
            section=[(.08,z+.012),(.13,z),(.51,z-.008),(.71,z+.010),(.775,z+.066),
                     (.830,z+.068),(.830,z-.027),(.08,z-.029)]
            rings.append([(x,side*y,zz) for y,zz in section])
        p.loft(rings,'Carpet')
        p.box((1.67,side*.437,.264),X,Y,.69,.438,.010,.04,.002,'Carpet')
    p.finish()
    p=Part('pedals',palette,warp)
    a=-Y
    b=v((.30,0,.954)).normalized()
    n=a.cross(b)
    for c,w,h in [((2.084,.474,.358),.086,.070),((2.098,.329,.351),.041,.112)]:
        c=v(c)
        p.box(c,a,b,w,h,.013,.012,.003,'Gunmetal')
        for i in range(5 if w>.05 else 3):
            count=5 if w>.05 else 3
            p.box(c+a*((i-(count-1)/2)*w/count)+n*.0072,a,b,.005,h*.81,.004,.002,.001,'Rubber')
        pivot=c+b*.124-n*.065
        p.tube([c-n*.007,c+b*.066-n*.031,pivot],.008,'Shadow trim',8,guide=Y)
        p.box(pivot,a,b,w*.74,.048,.066,.009,.006,'Rubber')
        p.tube([pivot-n*.020,pivot-n*.164],.014,'Vent throat',8,guide=Y)
    p.finish()

