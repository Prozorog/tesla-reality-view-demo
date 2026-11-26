"""Small face batches with metre-scaled lightmap charts and a single vertex-colour material."""
import math

import bpy
from mathutils import Vector


def linear(value):
    v=int(value,16)/255
    return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4


def rgb(code):
    return tuple(linear(code[i:i+2]) for i in (0,2,4))


def shelf(sizes, width):
    """Pixel rectangles, placed in descending height order with integral gutters."""
    x=y=row=0
    places=[None]*len(sizes)
    for i in sorted(range(len(sizes)),key=lambda k:-sizes[k][1]):
        w,h=sizes[i]
        if x+w>width and x:
            y+=row
            row=x=0
        places[i]=(x,y)
        x+=w
        row=max(row,h)
    return places,y+row


class Batch:
    def __init__(self,name):
        self.name=name
        self.faces=[]
        self.colors=[]
        self.normals=[]
        self.uvs=[]
        # Texture coordinate for faces without their own (trunks on an alpha material).
        self.default_uv=None

    def face(self,points,color,normals=None,uv=None):
        """uv: optional texture coordinates per point for a textured (alpha) card."""
        self.faces.append([Vector((x,-z,y)) for x,z,y in reversed(points)])
        self.colors.append(color)
        self.normals.append([Vector((x,-z,y)) for x,z,y in reversed(normals)] if normals else None)
        self.uvs.append(list(reversed(uv)) if uv else None)

    def box(self,x,z,bottom,w,d,h,color):
        self.slab([(x-w/2,z-d/2),(x+w/2,z-d/2),(x+w/2,z+d/2),(x-w/2,z+d/2)],bottom,bottom+h,color)

    def slab(self,poly,bottom,top,color):
        if sum(a[0]*b[1]-a[1]*b[0] for a,b in zip(poly,poly[1:]+poly[:1]))<0:
            poly=list(reversed(poly))
        low=[(*p,bottom) for p in poly]
        high=[(*p,top) for p in poly]
        self.face(high,color)
        self.face(low[::-1],color)
        for i in range(len(poly)):
            j=(i+1)%len(poly)
            self.face([low[i],low[j],high[j],high[i]],color)

    def rod(self,a,b,r,color,ends=8,r2=None):
        axis=(Vector(b)-Vector(a)).normalized()
        perp=axis.cross(Vector((1,0,0)) if abs(axis.x)<.8 else Vector((0,1,0))).normalized()
        other=axis.cross(perp)
        ring=[perp*math.cos(i*math.tau/ends)+other*math.sin(i*math.tau/ends) for i in range(ends)]
        low=[Vector(a)+r*v for v in ring]
        high=[Vector(b)+(r if r2 is None else r2)*v for v in ring]
        self.face(low[::-1],color)
        self.face(high,color)
        for i in range(ends):
            j=(i+1)%ends
            self.face([low[i],low[j],high[j],high[i]],color)

    def make(self,mat,density=0):
        verts=[]
        faces=[]
        charts=[]
        sizes=[]
        for pts in self.faces:
            offset=len(verts)
            verts.extend(pts)
            faces.append(tuple(range(offset,offset+len(pts))))
            if density:
                # Exact orthonormal projection, preserving lengths on each planar face.
                u=(pts[1]-pts[0]).normalized()
                n=u.cross(pts[-1]-pts[0]).normalized()
                v=n.cross(u)
                st=[((p-pts[0]).dot(u),(p-pts[0]).dot(v)) for p in pts]
                s,t=zip(*st)
                chart=[((a-min(s))*density,(b-min(t))*density) for a,b in st]
                charts.append(chart)
                sizes.append((math.ceil((max(s)-min(s))*density)+7,math.ceil((max(t)-min(t))*density)+7))
        mesh=bpy.data.meshes.new(self.name)
        mesh.from_pydata(verts,[],faces)
        if any(self.normals):
            custom=[]
            for poly,normal in zip(mesh.polygons,self.normals):
                poly.use_smooth=normal is not None
                custom.extend(normal or [(0,0,0)]*len(poly.loop_indices))
            mesh.normals_split_custom_set(custom)
        mesh.materials.append(mat)
        obj=bpy.data.objects.new(self.name,mesh)
        bpy.context.collection.objects.link(obj)
        if self.colors:
            attr=mesh.color_attributes.new(name="Tint",type="BYTE_COLOR",domain="CORNER")
            palette={c:(*rgb(c),1) for c in set(self.colors)}
            for poly,color in zip(mesh.polygons,self.colors):
                for loop in poly.loop_indices:
                    attr.data[loop].color=palette[color]
        if density:
            width=max(max(w for w,h in sizes),math.ceil(math.sqrt(sum(w*h for w,h in sizes))*1.15))
            offsets,height=shelf(sizes,width)
            mesh.uv_layers.new(name="Surface")
            lm=mesh.uv_layers.new(name="Lightmap")
            for poly,chart,(x,y),card in zip(mesh.polygons,charts,offsets,self.uvs):
                for k,(loop,(s,t)) in enumerate(zip(poly.loop_indices,chart)):
                    uv=((x+3.5+s)/width,(y+3.5+t)/height)
                    mesh.uv_layers[0].data[loop].uv=card[k] if card else self.default_uv or uv
                    lm.data[loop].uv=uv
            mesh.uv_layers.active_index=0
            obj["chartPixels"]=[width,height]
        return obj


def material(name,rough=.65,glow=None,strength=0,colored=True):
    m=bpy.data.materials.new(name)
    bs=m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Roughness"].default_value=rough
    if colored:
        attr=m.node_tree.nodes.new("ShaderNodeVertexColor")
        attr.layer_name="Tint"
        m.node_tree.links.new(attr.outputs["Color"],bs.inputs["Base Color"])
    if glow:
        bs.inputs["Emission Color"].default_value=(*rgb(glow),1)
        bs.inputs["Emission Strength"].default_value=strength
    return m
