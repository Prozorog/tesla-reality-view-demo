"""Small surface constructors. Coordinates and cross sections are in metres."""
from math import cos, sin, pi, sqrt
import bmesh
import bpy
from mathutils import Vector

X, Y, Z = (Vector(axis) for axis in ((1, 0, 0), (0, 1, 0), (0, 0, 1)))
TAU = 2 * pi


def v(value):
    return Vector(value)


def rounded(poly, radius, steps=5):
    """Trim each corner and join its tangent points with a quadratic arc."""
    points = [Vector(p) for p in poly]
    result = []
    for i, p in enumerate(points):
        a, b = points[i - 1] - p, points[(i + 1) % len(points)] - p
        trim = min(radius, a.length * .43, b.length * .43)
        a, b = p + a.normalized() * trim, p + b.normalized() * trim
        for j in range(steps + 1):
            t = j / steps
            result.append(a * (1 - t)**2 + p * (2 * (1 - t) * t) + b * t*t)
    return result


def rectangle(w, h, r):
    return rounded([(-w/2, -h/2), (w/2, -h/2), (w/2, h/2), (-w/2, h/2)], r)


def interp(points, steps=8):
    """Centripetal-looking Hermite path with endpoints and no duplicate knots."""
    p = [v(a) for a in points]
    result = []
    for i in range(len(p)-1):
        a, b = p[i:i+2]
        d = (b-a).length
        t0 = (b-p[max(0, i-1)]).normalized()*d
        t1 = (p[min(len(p)-1, i+2)]-a).normalized()*d
        for j in range(steps):
            t = j/steps
            result.append((2*t**3-3*t*t+1)*a + (t**3-2*t*t+t)*t0
                          + (-2*t**3+3*t*t)*b + (t**3-t*t)*t1)
    return result + [p[-1]]


class Part:
    def __init__(self, name, materials, warp=None, mapped=True):
        self.name, self.palette, self.warp, self.mapped = name, materials, warp, mapped
        self.verts, self.faces, self.face_info, self.surface_uv = [], [], [], []
        self.materials = []

    def face(self, indices, mat, smooth=False, uv=None):
        if mat not in self.materials:
            self.materials.append(mat)
        self.faces.append(tuple(indices))
        self.face_info.append((self.materials.index(mat), smooth))
        if uv is None:
            pts = [self.verts[k] for k in indices]
            norm = (pts[1]-pts[0]).cross(pts[-1]-pts[0])
            axis = max(range(3), key=lambda k: abs(norm[k]))
            a, b = [k for k in range(3) if k != axis]
            uv = [(p[a]*8, p[b]*8) for p in pts]
        self.surface_uv.append(uv)

    def loft(self, rings, mat, loop=False, cap=True, smooth=True):
        rings = [[v(p) for p in ring] for ring in rings]
        n, m, base = len(rings[0]), len(rings), len(self.verts)
        self.verts.extend(p for ring in rings for p in ring)
        # SurfaceUV repeats every 125 mm, independent of atlas layout.
        u = [0]
        for j in range(n):
            u.append(u[-1]+max((r[(j+1)%n]-r[j]).length for r in rings)*8)
        distance = 0
        for i in range(m if loop else m-1):
            k = (i+1) % m
            new = distance + sum((b-a).length for a,b in zip(rings[i], rings[k]))*8/n
            for j in range(n):
                h = (j+1) % n
                self.face([base+i*n+j, base+i*n+h, base+k*n+h, base+k*n+j],
                          mat if isinstance(mat,str) else mat[j], smooth,
                          [(u[j],distance),(u[j+1],distance),(u[j+1],new),(u[j],new)])
            distance = new
        if cap and not loop:
            self.face([base+j for j in reversed(range(n))], mat if isinstance(mat,str) else mat[0])
            self.face([base+(m-1)*n+j for j in range(n)], mat if isinstance(mat,str) else mat[0])

    def panel(self, origin, a, b, outline, depth, edge, mat):
        """Rounded extruded face. Origin is the centre of the back face."""
        origin,a,b = v(origin),v(a),v(b)
        normal = a.cross(b).normalized()
        points = [v(p) for p in outline]
        mid = sum(points, Vector((0,0)))/len(points)
        hx = max(abs(p.x-mid.x) for p in points) or .001
        hy = max(abs(p.y-mid.y) for p in points) or .001
        edge = min(edge,depth*.45,hx*.3,hy*.3)
        profile = [(0,edge),(.3*edge,.28*edge),(edge,0),
                   (depth-edge,0),(depth-.3*edge,.28*edge),(depth,edge)]
        self.loft([[origin+a*(mid.x+(p.x-mid.x)*(1-inset/hx))
                    +b*(mid.y+(p.y-mid.y)*(1-inset/hy))+normal*z for p in points]
                   for z,inset in profile],mat)

    def box(self, center, a, b, w, h, depth, corner, edge, mat):
        a,b=v(a),v(b)
        self.panel(v(center)-a.cross(b).normalized()*depth*.5,a,b,
                   rectangle(w,h,corner),depth,edge,mat)

    def tube(self, points, radius, mat, sides=8, closed=False, guide=None, aspect=1):
        points = [v(p) for p in points]
        rings = []
        for i,p in enumerate(points):
            prev = points[(i-1)%len(points)] if closed or i else p
            nxt = points[(i+1)%len(points)] if closed or i<len(points)-1 else p
            tangent = (nxt-prev).normalized()
            ref = v(guide) if guide is not None else (Z if abs(tangent.z)<.88 else Y)
            a = tangent.cross(ref).normalized()
            b = tangent.cross(a).normalized()
            width = radius[i] if isinstance(radius,list) else radius
            rings.append([p + width*(a*cos(TAU*j/sides)+b*sin(TAU*j/sides)*aspect)
                          for j in range(sides)])
        self.loft(rings,mat,loop=closed)

    def finish(self):
        mesh=bpy.data.meshes.new(self.name)
        coords = [self.warp(p) for p in self.verts] if self.warp else self.verts
        mesh.from_pydata(coords,[],self.faces)
        for mat in self.materials:
            mesh.materials.append(self.palette[mat])
        uv=mesh.uv_layers.new(name="SurfaceUV")
        for poly,(idx,smooth),tex in zip(mesh.polygons,self.face_info,self.surface_uv):
            poly.material_index,poly.use_smooth=idx,smooth
            for k,xy in zip(poly.loop_indices,tex):
                uv.data[k].uv=xy
        bm=bmesh.new()
        bm.from_mesh(mesh)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        # glTF tangents require triangles or quads. Keep authored quad strips
        # intact and tessellate only their n-gon end caps.
        bmesh.ops.triangulate(bm,faces=[f for f in bm.faces if len(f.verts)>4])
        bm.to_mesh(mesh)
        bm.free()
        mesh.update()
        obj=bpy.data.objects.new(self.name,mesh)
        bpy.context.collection.objects.link(obj)
        obj["lightmap_receiver"]=self.mapped
        return obj

