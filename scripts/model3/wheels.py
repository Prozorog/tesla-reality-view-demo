"""235/45 R18 tyre and five swept, faceted aero vanes with open cooling pockets."""
from math import cos, pi, sin

from .mesh import steps
from .shell import RADIUS


def wheel(mesh,origin,sign):
    x,y,z=origin
    def point(r,theta,depth):
        return (x+r*cos(theta),y+sign*depth,z+r*sin(theta))

    def revolve(profile,segments=64):
        for (r0,d0,mat),(r1,d1,_) in zip(profile,profile[1:]):
            for i in range(segments):
                a,b=2*pi*i/segments,2*pi*(i+1)/segments
                outward=((d1-d0)*cos(a),sign*(r0-r1),(d1-d0)*sin(a))
                mesh.face([point(r0,a,d0),point(r1,a,d1),point(r1,b,d1),point(r0,b,d0)],mat,outward)

    tyre=[(.223,-.093,'rubber'),(.243,-.110,'rubber'),(.281,-.1175,'rubber'),
          (.309,-.110,'rubber'),(.328,-.093,'rubber'),(RADIUS,-.070,'tread'),
          (RADIUS,-.035,'tread'),(.331,-.032,'tread'),(RADIUS,-.028,'tread'),
          (RADIUS,.028,'tread'),(.331,.032,'tread'),(RADIUS,.035,'tread'),
          (RADIUS,.070,'tread'),(.329,.091,'rubber'),(.314,.106,'rubber'),
          (.284,.1175,'rubber'),(.262,.116,'rubber'),(.246,.110,'rubber'),(.224,.101,'rubber')]
    revolve(tyre)
    revolve([(.223,-.093,'barrel'),(.222,.098,'rim'),(.234,.104,'rim'),
             (.237,.103,'rim'),(.240,.097,'rubber')])
    # Brake backing is visible through the five vents. A fine rim catches the studio strip.
    revolve([(.001,.020,'barrel'),(.137,.020,'disc'),(.190,.024,'disc'),(.204,.020,'barrel')],48)
    revolve([(.001,.109,'aero'),(.060,.111,'rim'),(.074,.109,'aero'),(.092,.100,'aero')],40)
    for i in range(5):
        base=2*pi*i/5+.21
        # Polar cross sections widen into an asymmetric blade, leaving a proper gap.
        sections=[(.067,-.52,.49,.109),(.096,-.56,.48,.104),(.149,-.56,.45,.092),
                  (.199,-.55,.39,.097),(.224,-.54,.35,.102),(.232,-.47,.28,.102)]
        rows=[]
        for r,lo,hi,d in sections:
            sweep=-.41*(r/.232)**1.60
            rows.append([point(r,base+sweep+lo+(hi-lo)*u,d+h)
                         for u,h in [(0,-.010),(.13,0),(.73,.002),(.86,.006),(1,-.005)]])
        for a,b in zip(rows,rows[1:]):
            for j,mat in enumerate(['aero_edge','aero','aero_edge','rim']):
                mesh.face([a[j],b[j],b[j+1],a[j+1]],mat,(0,sign,0),False)
            for j in [0,-1]:
                def inset(p):
                    return (p[0],p[1]-sign*.011,p[2])
                mesh.face([a[j],inset(a[j]),inset(b[j]),b[j]],'barrel',(0,sign,0),False)
        # Recessed wheel fasteners with a dark edged hex head.
        mid=point(.043,base,.111)
        def bolt(r,k,d):
            a=2*pi*k/6
            return (mid[0]+r*cos(a),mid[1]+sign*d,mid[2]+r*sin(a))
        for j in range(6):
            mesh.face([bolt(.009,j,0),bolt(.009,j+1,0),bolt(.0058,j+1,.0015),bolt(.0058,j,.0015)],
                      'barrel',(0,sign,0),False)
            mesh.face([bolt(.0058,j,.0015),bolt(.0058,j+1,.0015),mid],'hardware',(0,sign,0),False)
    # Raised centre rondel, with a small machined T.
    revolve([(.001,.114,'aero_edge'),(.022,.114,'rim'),(.024,.112,'aero')],28)
    for loop in [[(-.013,.007),(0,.010),(.013,.007),(.011,.004),(0,.006),(-.011,.004)],
                 [(-.008,.003),(.008,.003),(.003,0),(0,-.011),(-.003,0)]]:
        mesh.face([(x+a,y+sign*.1146,z+b) for a,b in loop],'rim',(0,sign,0),False)
