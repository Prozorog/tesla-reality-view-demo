"""Extract original FBX triangles, including their corner normals and UVs."""
from collections import defaultdict, namedtuple

import bpy
from mathutils import Matrix, Vector

Corner = namedtuple("Corner", "pos uv normal")


def extent(points):
    return (Vector([min(p[i] for p in points) for i in range(3)]),
            Vector([max(p[i] for p in points) for i in range(3)]))


def wheel_centre(obj):
    low, high = extent([obj.matrix_world @ v.co for v in obj.data.vertices])
    return (low + high) * .5


def car_transform(kind, target, body, wheels):
    centres = [wheel_centre(o) for o in wheels]
    # The two closest wheels form one axle. Averaging both axle midpoints
    # removes the turntable display yaw, including the coupe's baked-in yaw.
    pair = min(((i, j) for i in range(4) for j in range(i)), key=lambda ij:
               (centres[ij[0]] - centres[ij[1]]).length)
    axle_a = sum((centres[i] for i in pair), Vector()) / 2
    axle_b = sum((c for i, c in enumerate(centres) if i not in pair), Vector()) / 2
    forward = axle_a - axle_b
    forward.z = 0
    wheelbase = forward.length
    forward.normalize()
    nose = body.matrix_world.to_3x3() @ Vector((1, 0, 0) if kind == "coupe" else (0, -1, 0))
    if forward.dot(nose) < 0:
        forward.negate()
    up = Vector((0, 0, 1))
    axes = Matrix([forward, up.cross(forward), up]).to_4x4()
    points = [axes @ o.matrix_world @ v.co for o in [body, *wheels] for v in o.data.vertices]
    low, high = extent(points)
    centre = (low + high) * .5
    centre.z = low.z
    scale = target / (high.x - low.x)
    transform = Matrix.Scale(scale, 4) @ Matrix.Translation(-centre) @ axes
    return transform, (high - low) * scale, wheelbase * scale


def lens_tile(uv):
    # Pixel-space tile boundaries in lights.jpg, measured from its top left.
    u, v = uv.x % 1, 1 - uv.y % 1
    if v < .15 and u > .79 or .15 <= v < .345 and u > .634:
        return "red"
    if v > .775 and .35 < u < .55:
        return "red"
    if v < .15 and .59 < u <= .79 or .345 <= v < .55 and u > .634:
        return "amber"
    if v > .775 and .55 <= u < .77:
        return "amber"
    return "clear"


def source_triangles(obj, transform):
    mesh = obj.data
    mesh.calc_loop_triangles()
    matrix = transform @ obj.matrix_world
    normals = matrix.to_3x3().inverted().transposed()
    coords = [matrix @ v.co for v in mesh.vertices]
    uv = mesh.uv_layers.active.data
    flip = matrix.to_3x3().determinant() < 0
    corners = [Corner(coords[l.vertex_index], uv[l.index].uv.copy(),
                      (normals @ mesh.corner_normals[l.index].vector).normalized())
               for l in mesh.loops]
    for tri in mesh.loop_triangles:
        indices = tuple(tri.loops)
        if flip:
            indices = indices[::-1]
        face = [corners[i] for i in indices]
        if len({tuple(v.pos) for v in face}) == 3:
            yield tri.material_index, face


def clip_lens(face, height, upper):
    clipped = []
    for i, b in enumerate(face):
        a = face[i - 1]
        da, db = a.pos.z - height, b.pos.z - height
        if da * db < 0:
            t = da / (da - db)
            clipped.append(Corner(a.pos.lerp(b.pos, t), a.uv.lerp(b.uv, t),
                                  a.normal.lerp(b.normal, t).normalized()))
        if (upper and db >= 0) or (not upper and db <= 0):
            clipped.append(b)
    return clipped


def face_centre(face):
    return sum((v.pos for v in face), Vector()) / len(face)


def extract(kind, length, body, wheels):
    transform, size, wheelbase = car_transform(kind, length, body, wheels)
    groups = defaultdict(list)
    reds = []
    for material, face in source_triangles(body, transform):
        if material == 0:
            groups["body"].append(face)
        elif material == 2:
            groups["glass"].append(face)
        elif material == 1:
            tile = lens_tile(sum((v.uv for v in face), Vector((0, 0))) / 3)
            front = face_centre(face).x > 0
            if front and tile == "clear":
                groups["lights_head"].append(face)
            elif not front and tile == "red":
                reds.append(face)
            else:
                groups["lenses"].append(face)
        else:
            raise ValueError(f"Unexpected body material {material} on {kind}")
    # Divide the original red apertures into upper stop and lower running
    # sections. Shared cut vertices have interpolated UVs/normals and no overlap.
    low, high = extent([v.pos for f in reds for v in f])
    height = low.z + .55 * (high.z - low.z)
    for face in reds:
        for part, upper in (("lights_brake", True), ("lights_tail", False)):
            polygon = clip_lens(face, height, upper)
            for i in range(1, len(polygon) - 1):
                groups[part].append([polygon[0], polygon[i], polygon[i + 1]])
    for wheel in wheels:
        groups["wheels"].extend(face for _, face in source_triangles(wheel, transform))
    return groups, size, wheelbase


def make_mesh(root, key, triangles, material):
    name = root.name + "_" + key
    mesh = bpy.data.meshes.new(name)
    index, faces, normals, uvs = {}, [], [], []
    for tri in triangles:
        face = []
        for corner in tri:
            point = tuple(corner.pos)
            face.append(index.setdefault(point, len(index)))
            normals.append(tuple(corner.normal))
            uvs.extend(corner.uv)
        faces.append(face)
    mesh.from_pydata(list(index), [], faces, shade_flat=False)
    mesh.update()
    mesh.uv_layers.new(name="UVMap").data.foreach_set("uv", uvs)
    mesh.normals_split_custom_set(normals)
    # The FBX pickup contains two coincident body triangles after welding.
    # Validate now so the exporter and our counts see the same topology.
    mesh.validate(clean_customdata=False)
    mesh.materials.append(material)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = root
    return obj


def lamp_centres(triangles):
    totals = [Vector(), Vector()]
    areas = [0., 0.]
    for face in triangles:
        a, b, c = (v.pos for v in face)
        area = (b - a).cross(c - a).length * .5
        centre = (a + b + c) / 3
        side = 0 if centre.y > 0 else 1
        totals[side] += area * centre
        areas[side] += area
    centres = [p / area for p, area in zip(totals, areas)]
    return [[round(p.x, 5), round(p.z, 5), round(-p.y, 5)] for p in centres]
