"""Parked-car LODs of the finished Model X (hero_lod.glb ~15k, hero_far.glb ~1.5k).

Every evaluated hero triangle is sorted by its material into a few named
single-material meshes, which meshy-passengers.ts loads through its node path:
`body` takes the per-bay paint colour, the rest become two passive batches
(matte and glossy) coloured from their material base colours.
Mirrors are folded for a parked car and the cabin stand-ins behind the glass
are left out (the LOD glass is opaque)."""
import math
import bpy
import numpy as np
from mathutils import Vector

GROUPS = {
    'paint': 'body',
    'glass': 'glass', 'roofglass': 'glass', 'frontglass': 'glass', 'windscreen': 'glass', 'blackglass': 'glass',
    'clad': 'trim', 'sill': 'trim', 'seal': 'trim', 'gap': 'trim', 'housing': 'trim',
    'rubber': 'wheels', 'sidewall': 'wheels', 'alloy': 'wheels', 'rotor': 'wheels', 'caliper': 'wheels',
    'chrome': 'chrome', 'opticmetal': 'chrome',
    'led': 'lights_head', 'lens': 'lights_head', 'lamp': 'lights_head',
    'red': 'lights_tail', 'smoke': 'lights_tail', 'brake': 'lights_tail', 'amber': 'lights_tail',
}
FINISH = {'body': 'paint', 'glass': 'glass', 'trim': 'clad', 'wheels': 'rubber', 'chrome': 'chrome',
          'lights_head': 'led', 'lights_tail': 'red'}
SKIP = ('Mirror', 'Seat back', 'Head restraint', 'Instrument top', 'Cabin inner trim', 'Passenger compartment',
        'Tailgate inner lining', 'Windscreen ceramic border', 'Body shell underfloor')
BUDGETS = {
    'hero_lod.glb': {'body': 8200, 'glass': 1700, 'trim': 2000, 'wheels': 2300, 'chrome': 300, 'lights_head': 220, 'lights_tail': 260},
    'hero_far.glb': {'body': 700, 'glass': 170, 'trim': 140, 'wheels': 0, 'chrome': 0, 'lights_head': 30, 'lights_tail': 30},
}


def soup(scene):
    """World-space triangles per group, welded at 0.1 mm."""
    dg = bpy.context.evaluated_depsgraph_get()
    tris = {g: [] for g in FINISH}
    for ob in scene.objects:
        if ob.type != 'MESH' or ob.name.startswith(SKIP):
            continue
        ev = ob.evaluated_get(dg); me = ev.to_mesh(); me.calc_loop_triangles()
        mw = ev.matrix_world
        co = np.array([tuple(mw @ v.co) for v in me.vertices], dtype=np.float64)
        names = [m.name if m else '' for m in me.materials]
        for lt in me.loop_triangles:
            name = names[lt.material_index] if lt.material_index < len(names) else ''
            group = GROUPS.get(name)
            if group:
                tris[group].append(co[list(lt.vertices)])
        ev.to_mesh_clear()
    return {g: np.array(t) for g, t in tris.items() if t}


def wheel_drums(radius, track, wheelbase, segments=10):
    """Far LOD wheels: closed low cylinders at the four hubs."""
    out = []
    for x in (0, wheelbase):
        for side in (-1, 1):
            yc = side * track / 2
            ring = [(x + radius * math.cos(2 * math.pi * k / segments), radius + radius * math.sin(2 * math.pi * k / segments)) for k in range(segments)]
            for (a, b), (c, d) in zip(ring, ring[1:] + ring[:1]):
                inner, outer = yc - side * .11, yc + side * .12
                out.append([(a, inner, b), (c, inner, d), (c, outer, d)])
                out.append([(a, inner, b), (c, outer, d), (a, outer, b)])
                out.append([(x, outer, radius), (a, outer, b), (c, outer, d)])
    return np.array(out, dtype=np.float64)


def build(name, triangles, material, budget):
    flat = triangles.reshape(-1, 3)
    keys, inverse = np.unique(np.round(flat, 4), axis=0, return_inverse=True)
    faces = inverse.reshape(-1, 3)
    faces = faces[(faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in keys], [], [tuple(int(i) for i in f) for f in faces])
    mesh.validate(clean_customdata=True); mesh.update()
    mesh.materials.append(material)
    ob = bpy.data.objects.new(name, mesh); bpy.context.collection.objects.link(ob)
    if len(mesh.polygons) > budget:
        dec = ob.modifiers.new('Parked LOD reduction', 'DECIMATE')
        dec.ratio = budget / len(mesh.polygons); dec.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=dec.name)
    if budget >= 10 ** 6:
        import bmesh
        bm = bmesh.new(); bm.from_mesh(ob.data)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(ob.data); bm.free()
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def export_lods(scene, materials, folder, radius, track, wheelbase):
    groups = soup(scene)
    counts = {}
    # The hero keeps nodes called glass and lights_*; free those names while exporting.
    renamed = [ob for ob in scene.objects if ob.name in FINISH]
    for ob in renamed:
        ob.name = ob.name + '__hero'
    for filename, budgets in BUDGETS.items():
        made = []
        for group, budget in budgets.items():
            if group == 'wheels' and budget == 0:
                made.append(build(group, wheel_drums(radius, track, wheelbase), materials['rubber'], 10 ** 6))
                continue
            if budget == 0 or group not in groups:
                continue
            made.append(build(group, groups[group], materials[FINISH[group]], budget))
        for ob in scene.objects:
            ob.select_set(ob in made)
        bpy.ops.export_scene.gltf(filepath=str(folder / filename), export_format='GLB', use_selection=True,
                                  export_apply=True, export_yup=True, export_animations=False)
        counts[filename] = {ob.name: len(ob.data.polygons) for ob in made}
        for ob in made:
            bpy.data.objects.remove(ob, do_unlink=True)
    for ob in renamed:
        ob.name = ob.name[:-len('__hero')]
    return counts
