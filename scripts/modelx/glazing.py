"""Head restraints and dashboard surfaces seen through the exterior glazing."""
from . import panels as P
from .panels import Vector, seq, sin, cos, pi, bpy
def power(v,n):return (1 if v>=0 else -1)*abs(v)**n
def cushion(name,center,half,lean,parent):
    m=P.Mesh()
    def sample(a,b):
        x=half[0]*power(cos(a),.52)*power(cos(b),.46)
        y=half[1]*power(cos(a),.52)*power(sin(b),.46)
        z=half[2]*power(sin(a),.53)
        return Vector((center[0]+x-lean*z,center[1]+y,center[2]+z))
    aa=seq(-pi/2,pi/2,8);bb=seq(0,2*pi,16)
    for a,b in zip(aa,aa[1:]):
        for u,v in zip(bb,bb[1:]):
            p=sample((a+b)/2,(u+v)/2)
            m.face([sample(a,u),sample(b,u),sample(b,v),sample(a,v)],'upholstery',p-Vector(center))
    o=P.obj(name,m);o.parent=parent
def split_falcon_roof(parent):
    """Separate at the hidden centre hinge after evaluating the common roof curvature."""
    roof=bpy.data.objects['Falcon roof']
    source=roof.evaluated_get(bpy.context.evaluated_depsgraph_get())
    skin=source.to_mesh()
    wings={-1:P.Mesh(),1:P.Mesh()}
    for poly in skin.polygons:
        sign=1 if poly.center.y>0 else -1
        wing=wings[sign]
        positions=[]
        for i in poly.vertices:
            v=skin.vertices[i];p=v.co.copy()
            if abs(p.y)<.00001:p.y=sign*.0023
            positions.append(tuple(p))
            wing.normals[wing.index(p)]=tuple(v.normal)
        wing.face(positions,'roofglass')
    source.to_mesh_clear()
    roof.name='Roof construction surface'
    hinge=bpy.data.objects.new('Falcon roof',None);bpy.context.collection.objects.link(hinge);hinge.parent=parent
    for sign,name in [(-1,'Right falcon roof glass'),(1,'Left falcon roof glass')]:
        P.obj(name,wings[sign]).parent=hinge
    bpy.data.objects.remove(roof,do_unlink=True)

def install(parent):
    split_falcon_roof(parent)
    for x in [.09,1.44]:
        for y in [-.39,.39]:
            cushion('Seat back',(x,y,.92),(.105,.248,.307),.19,parent)
            cushion('Head restraint',(x-.052,y,1.252),(.075,.14,.105),.18,parent)
    cushion('Instrument top',(2.42,0,.949),(.40,.73,.093),0,parent)
    # Seal the passenger compartment behind its transparent glass. The exterior
    # panels are single skins and the lamp backs sit outside this dark inner trim.
    tub=P.Mesh()
    stations=[-.455,-.28,-.08,.38,1.15,1.72,2.16,2.42,2.63]
    def rim(q,s):
        p=P.waist(q,s)
        return Vector((q,p.y-s*.019,p.z-.023))
    def floor(q,s):
        return Vector((q,s*min(abs(rim(q,s).y)-.09,.63),.445))
    for q,r in zip(stations,stations[1:]):
        tub.face([floor(q,-1),floor(r,-1),floor(r,1),floor(q,1)],'seal',(0,0,1))
        for s in (-1,1):
            tub.face([floor(q,s),floor(r,s),rim(r,s),rim(q,s)],'upholstery',(0,-s,0))
    for q,inner,normal in [(-.455,-.08,1),(2.63,2.16,-1)]:
        def deck(u,t):
            outer=P.top(q,t)-Vector((0,t*.018,.025))
            inner_edge=rim(inner,1)
            inner_point=Vector((inner,t*inner_edge.y,inner_edge.z-.047*(1-t*t)))
            return outer.lerp(inner_point,u)
        for a,b in zip(seq(-1,1,16),seq(-1,1,16)[1:]):
            tub.face([deck(0,a),deck(1,a),deck(1,b),deck(0,b)],'upholstery',(0,0,1))
            tub.face([deck(1,a),deck(1,b),floor(inner,1).lerp(floor(inner,-1),(1-b)/2),
                      floor(inner,1).lerp(floor(inner,-1),(1-a)/2)],'seal',(normal,0,0))
        for s in (-1,1):
            tub.face([deck(0,s),deck(1,s),rim(q,s)],'upholstery',(0,-s,0))
    P.obj('Cabin inner trim',tub).parent=parent
    cushion('Passenger compartment',(1.09,0,.49),(1.81,.81,.23),0,parent)
    P.panel('Windscreen ceramic border',lambda q,t:P.top(q,t)-Vector((0,0,.004)),
            [2.555,2.60,2.63],seq(-1,1,16),'seal',(0,0,1),False).parent=parent
    for ob in list(parent.children):
        if ob.type!='MESH':continue
        if ob.name.startswith('Panoramic windscreen'):
            mat=P.M['windscreen'];ob.data.materials[0]=mat
            uv=ob.data.uv_layers.new(name='Glass tint')
            for loop in ob.data.loops:
                x=ob.data.vertices[loop.vertex_index].co.x
                uv.data[loop.index].uv=(max(0,min(1,(x-1.20)/1.58)),.5)
        elif ob.name.startswith('Front side glass'):ob.data.materials[0]=P.M['frontglass']

