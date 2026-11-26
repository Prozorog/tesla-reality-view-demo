"""Small mesh-writing tools. All dimensions passed to these helpers are metres."""
from math import cos, pi, sin

import bpy
from mathutils import Vector


def linear(hex_color):
    values = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values) + (1.,)


def finish(name, color, metallic, roughness, coat=0., emission=None, strength=0., ior=1.48):
    mat = bpy.data.materials.new(name)
    rgba = linear(color)
    mat.diffuse_color = rgba
    if not mat.node_tree:
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    for key, value in {"Base Color": rgba, "Metallic": metallic, "Roughness": roughness,
                       "IOR": ior, "Coat Weight": coat, "Coat Roughness": .12}.items():
        bsdf.inputs[key].default_value = value
    if emission:
        bsdf.inputs["Emission Color"].default_value = linear(emission)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


class Mesh:
    def __init__(self):
        self.vertices = []
        self.lookup = {}
        self.faces = []
        self.materials = []
        self.smoothing = []
        self.normals = {}

    def index(self, point):
        key = tuple(round(float(v), 7) for v in point)
        if key not in self.lookup:
            self.lookup[key] = len(self.vertices)
            self.vertices.append(key)
        return self.lookup[key]

    def face(self, points, mat, outward=None, smooth=True):
        ids = list(dict.fromkeys(self.index(p) for p in points))
        if len(ids) < 3:
            return
        if outward is not None:
            a, b, c = (Vector(self.vertices[i]) for i in ids[:3])
            if (b - a).cross(c - a).dot(Vector(outward)) < 0:
                ids.reverse()
        self.faces.append(ids)
        self.materials.append(mat)
        self.smoothing.append(smooth)

    def object(self, name, mats, origin=(0, 0, 0)):
        data = bpy.data.meshes.new(name)
        verts = [tuple(p[i] - origin[i] for i in range(3)) for p in self.vertices]
        data.from_pydata(verts, [], self.faces)
        data.update()
        slots = list(dict.fromkeys(self.materials))
        for slot in slots:
            data.materials.append(mats[slot])
        data.polygons.foreach_set("material_index", [slots.index(m) for m in self.materials])
        data.polygons.foreach_set("use_smooth", self.smoothing)
        if self.normals:
            # The painted rail, frit and glazing were one smoothed surface.
            # Retain its normals at the boundaries between exported mesh nodes.
            data.normals_split_custom_set_from_vertices([self.normals.get(i,(0,0,0)) for i in range(len(verts))])
        obj = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(obj)
        obj.location = origin
        return obj


def grid(mesh, u, v, sample, mat, normal, smooth=True):
    rows = [[sample(a, b) for b in v] for a in u]
    for i in range(len(u) - 1):
        for j in range(len(v) - 1):
            material = mat((u[i] + u[i + 1]) / 2, (v[j] + v[j + 1]) / 2) if callable(mat) else mat
            mesh.face([rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]],
                      material, normal, smooth)


def steps(n):
    return [i / n for i in range(n + 1)]


def interpolate(keys, t):
    """Shape-preserving cubic Hermite interpolation, including unevenly spaced stations."""
    if t <= keys[0][0]:
        return keys[0][1]
    if t >= keys[-1][0]:
        return keys[-1][1]
    for i in range(len(keys) - 1):
        a, b = keys[i], keys[i + 1]
        if t <= b[0]:
            break
    def slope(j):
        def sec(k):
            return (keys[k+1][1] - keys[k][1]) / (keys[k+1][0] - keys[k][0])
        if j == 0 or j == len(keys) - 1:
            return sec(0 if j == 0 else j - 1)
        p, q = sec(j - 1), sec(j)
        if p * q <= 0:
            return 0.
        h, k = keys[j][0]-keys[j-1][0], keys[j+1][0]-keys[j][0]
        return 3*(h+k) / ((2*k+h)/p + (k+2*h)/q)
    h = b[0] - a[0]
    v = (t - a[0]) / h
    return ((2*v**3-3*v*v+1)*a[1] + (v**3-2*v*v+v)*h*slope(i)
            + (-2*v**3+3*v*v)*b[1] + (v**3-v*v)*h*slope(i+1))


def path(points, count=40):
    pts = [Vector(p) for p in points]
    s = [0.]
    for a, b in zip(pts, pts[1:]):
        s.append(s[-1] + (a-b).length)
    axes = [list(zip(s, values)) for values in zip(*points)]
    return [tuple(interpolate(axis, u*s[-1]) for axis in axes) for u in steps(count)]


def cord(mesh, points, radius, mat, sides=6):
    """Sweep a circular gasket/fillet along a polyline with parallel-transport frames."""
    pts = [Vector(p) for p in points]
    prev = None
    for i, p in enumerate(pts):
        axis = (pts[min(i+1,len(pts)-1)] - pts[max(i-1,0)]).normalized()
        if prev is None:
            ref = Vector((0,0,1)) if abs(axis.z) < .9 else Vector((0,1,0))
            n = axis.cross(ref).normalized()
        else:
            n = (n - axis*n.dot(axis)).normalized()
        b = axis.cross(n)
        ring = [p + radius*(cos(2*pi*k/sides)*n + sin(2*pi*k/sides)*b) for k in range(sides)]
        if prev is not None:
            for k in range(sides):
                j=(k+1)%sides
                mesh.face([prev[k],prev[j],ring[j],ring[k]],mat)
        prev=ring
