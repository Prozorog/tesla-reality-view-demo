"""Build both far-car assets from the shipping GLB and its existing atlases."""
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import time

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree

sys.dont_write_bytecode = True
HELPERS = Path(__file__).resolve().parent / "cars"
sys.path.insert(0, str(HELPERS))
from catalog import MODELS
from lod_gltf import LodFile, accessor, bounds, primitives, read_glb


PAINT, TRIM, GLASS, HEAD, TAIL, TYRE, DISC = range(7)
# Linear RGB, including the pack's glass base colour.
COLOURS = np.array([(0, 0, 0), (.012, .015, .020), (.006, .008, .012),
                    (.53, .54, .50), (.16, .009, .007), (.009, .011, .014),
                    (.082, .088, .094)])
BUDGET = 900


def components(ids):
    """Faces joined at the supplied keys (XYZ for parts, XYZ + UV for atlas charts)."""
    parent = list(range(int(ids.max()) + 1))

    def root(i):
        while i != parent[i]:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b, c in ids:
        parent[root(a)] = root(b)
        parent[root(c)] = root(b)
    tags = np.array([root(i) for i in ids[:, 0]])
    return [np.flatnonzero(tags == tag) for tag in np.unique(tags)]


def corner_keys(values):
    flat = values.reshape(-1, values.shape[-1])
    return np.unique(flat.round(5), axis=0, return_inverse=True)[1].reshape(-1, 3)


def surface_faces(pos):
    parts = components(corner_keys(pos))
    shell = max(parts, key=len)
    size = np.ptp(pos.reshape(-1, 3), axis=0)
    top = pos[:, :, 1].max()
    keep = []
    for faces in parts:
        points = pos[faces].reshape(-1, 3)
        centre = (points.min(0) + points.max(0)) / 2
        mirror = np.abs(points[:, 2]).max() >= size[2] * .49
        roof_rail = points[:, 1].min() > top * .80 and np.ptp(points[:, 0]) > .7
        bumper_or_spoiler = abs(centre[0]) > size[0] * .31 and np.ptp(points[:, 2]) > .55
        if faces is shell or mirror or roof_rail or bumper_or_spoiler:
            keep.append(faces)
    return np.concatenate(keep)


def paint_samples(path, samples):
    image = bpy.data.images.load(str(MODELS / path))
    w, h = image.size
    pixels = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    # glTF UVs start at the top left. Blender image data starts at the bottom left.
    u, v = (samples % 1).T
    rgb = pixels.reshape(h, w, 4)[h - 1 - (v * h).astype(int), (u * w).astype(int), :3]
    bpy.data.images.remove(image)
    return rgb


def body_roles(pos, uv, spec, palette):
    # Compare the most distinct two production paints at four interior samples.
    # Classify entire continuous charts so a baked shadow or black panel line
    # inside a paint island never turns into a new material boundary.
    variants = sorted(spec["variants"], key=lambda v: sum(bytes.fromhex(palette[v["color"]][1:])))
    centre = uv.mean(axis=1, keepdims=True)
    samples = np.concatenate((centre, centre * .2 + uv * .8), axis=1).reshape(-1, 2)
    change = np.abs(paint_samples(variants[-1]["map"], samples)
                    - paint_samples(variants[0]["map"], samples)).max(axis=1).reshape(-1, 4)
    roles = np.full(len(uv), TRIM)
    cross = np.cross(pos[:, 1] - pos[:, 0], pos[:, 2] - pos[:, 0])
    for chart in components(corner_keys(np.concatenate((pos, uv), axis=2))):
        # The offroad canvas roof and the pickup bedliner are large fixed
        # finishes in the body atlas. Retain their shading and roughness too.
        upper = (pos[chart, :, 1].mean(1) > .52) & (unit(cross[chart])[:, 1] > .6)
        top_area = cross[chart[upper], 1].sum() * .5
        fixed_finish = spec["nodes"]["root"] in ("pickup", "offroad") and top_area > .16
        if change[chart].max() > .022 or fixed_finish:
            roles[chart] = PAINT
    return roles


def unit(values):
    return values / np.maximum(np.linalg.norm(values, axis=-1, keepdims=True), 1e-20)


def tree(pos):
    return BVHTree.FromPolygons(pos.reshape(-1, 3).tolist(),
                                np.arange(len(pos) * 3).reshape(-1, 3).tolist(), all_triangles=True)


def visible_faces(pos, roles, surface):
    # Opaque glazing hides the headliner, floor and inner door skins. Test the
    # original winding from several points on each face before spending LOD
    # triangles on it. Keep both sides of every visible trim/paint boundary.
    directions = unit(np.array([(x, y, z) for x in (-1, 0, 1) for y in (-1, 0, 1)
                                for z in (-1, 0, 1) if (x, y, z) != (0, 0, 0)]))
    visible = roles >= GLASS
    normal = unit(np.cross(pos[:, 1] - pos[:, 0], pos[:, 2] - pos[:, 0]))
    for f in np.flatnonzero(~visible):
        n = normal[f]
        centre = pos[f].mean(0)
        probes = np.vstack((centre, pos[f] * .82 + centre * .18)) + n * .0001
        outward = [tuple(d) for d in np.vstack((n, directions[directions @ n > .10]))]
        visible[f] = any(surface.ray_cast(tuple(p), d)[0] is None for p in probes for d in outward)
    ids = corner_keys(pos)
    keep = visible | (np.isin(ids, np.unique(ids[visible])).sum(1) >= 2)
    # An edge shared with a pillar can pull its interior headliner back into
    # that border ring. Exclude high, downward-facing lining sandwiched between
    # the cabin floor and the underside of the roof.
    centres = pos.mean(1)
    inside = ((roles <= TRIM) & (normal[:, 1] < -.65) & (centres[:, 1] > pos[:, :, 1].max() * .70)
              & (np.abs(centres[:, 2]) < np.ptp(pos[:, :, 2]) * .36))
    for f in np.flatnonzero(inside & keep):
        c = centres[f]
        above = surface.ray_cast(tuple(c + (0, .001, 0)), (0, 1, 0), .16)[0]
        below = surface.ray_cast(tuple(c - (0, .001, 0)), (0, -1, 0))[0]
        if above is not None and below is not None:
            keep[f] = False
    return keep


def transferred_normals(triangles, xyz, texcoords, ids, pos, uv, normals, roles):
    """Sample the original smooth surface just inside the surviving faces.

    The authored normal right on a bevel includes the adjacent vertical panel.
    Stretching that one normal across a decimated roof makes a triangular
    specular streak. Sample inside the coarse triangle, where it covers paint.
    """
    # Work on the same connected UV/material chart. The closest 3D point
    # alone can be on the underside of a 2 cm thick roof or on the next lamp.
    island = np.empty(len(xyz), dtype=int)
    surfaces = []
    for chart, faces in enumerate(components(ids)):
        island[ids[faces]] = chart
        atlas = uv[faces]
        ab = atlas[:, 1] - atlas[:, 0]
        ac = atlas[:, 2] - atlas[:, 0]
        det = ab[:, 0] * ac[:, 1] - ab[:, 1] * ac[:, 0]
        inv = np.divide(1., det, out=np.zeros_like(det), where=np.abs(det) > 1e-12)
        surfaces.append((tree(pos[faces]), faces, atlas[:, 0], ab, ac, inv))
    result = []
    for tri in triangles:
        points = xyz[tri]
        centre = points.mean(0)
        n = unit(np.cross(points[1] - points[0], points[2] - points[0]))
        chart = island[tri[0]]
        assert np.all(island[tri] == chart), tri
        source, faces, origin, ab_uv, ac_uv, inv = surfaces[chart]
        tex = texcoords[tri]
        shading = []
        for point, st in zip(points * .76 + centre * .24, tex * .76 + tex.mean(0) * .24):
            if roles[faces[0]] == PAINT:
                delta = st - origin
                u = (delta[:, 0] * ac_uv[:, 1] - delta[:, 1] * ac_uv[:, 0]) * inv
                v = (ab_uv[:, 0] * delta[:, 1] - ab_uv[:, 1] * delta[:, 0]) * inv
                hits = np.flatnonzero((inv != 0) & (u >= 0) & (v >= 0) & (u + v <= 1))
                if len(hits):
                    w = np.stack((1-u[hits]-v[hits], u[hits], v[hits]), axis=1)
                    # Mirrored atlas faces can cover the same texel on two
                    # sides of a car. Select the one nearest this 3D sample.
                    samples = np.einsum("ij,ijk->ik", w, pos[faces[hits]])
                    best = np.linalg.norm(samples - point, axis=1).argmin()
                    shading.append(unit(w[best] @ normals[faces[hits[best]]]))
                    continue
            near, _, local, _ = source.find_nearest(tuple(point))
            f = faces[local]
            a, b, c = pos[f]
            ab, ac = b - a, c - a
            cross = np.cross(ab, ac)
            denominator = max(cross @ cross, 1e-30)
            delta = np.asarray(near) - a
            u = np.cross(delta, ac) @ cross / denominator
            v = np.cross(ab, delta) @ cross / denominator
            shading.append(unit((1-u-v)*normals[f, 0] + u*normals[f, 1] + v*normals[f, 2]))
        shading = np.asarray(shading)
        # A collapsed bevel can fold back against the source by a few mm.
        # Retain the outward side for back-face culling in the game.
        if shading.mean(0) @ n < 0:
            tri[:] = tri[::-1]
            shading = shading[::-1]
        result.append(shading)
    result = np.asarray(result)
    # Share nearby normal estimates across smooth edges. Preserve sharp panel
    # breaks where the source samples point in substantially different directions.
    corners = triangles.ravel()
    flat = result.reshape(-1, 3)
    smooth = flat.copy()
    for index in np.unique(corners):
        group = np.flatnonzero(corners == index)
        patch = flat[group]
        smooth[group] = unit((patch @ patch.T > .90).astype(float) @ patch)
    smooth = smooth.reshape(result.shape)
    p = xyz[triangles]
    geometric = np.cross(p[:, 1] - p[:, 0], p[:, 2] - p[:, 0])
    reverse = np.einsum("ij,ij->i", smooth.mean(1), geometric) < 0
    triangles[reverse] = triangles[reverse, ::-1]
    smooth[reverse] = smooth[reverse, ::-1]
    return smooth


def wheels(points):
    """Closed octagonal tyres and shallow alloy hub covers at the original width."""
    corners = []
    angles = np.arange(8) * math.tau / 8
    radial = np.column_stack((np.cos(angles), np.sin(angles), np.zeros(8)))

    def face(vertices, normals, role):
        corners.extend(np.r_[p, n, COLOURS[role]] for p, n in zip(vertices, normals))

    for front in (False, True):
        for right in (False, True):
            tyre = points[((points[:, 0] > 0) == front) & ((points[:, 2] > 0) == right)]
            low, high = tyre.min(0), tyre.max(0)
            centre, radii = (low + high) / 2, (high - low) / 2
            inside, outside = (low[2], high[2]) if right else (high[2], low[2])
            ring = radial * radii + centre
            inner, outer, hub = ring.copy(), ring.copy(), centre + .62 * radial * radii
            normal = np.array([0, 0, 1 if right else -1])
            inner[:, 2], outer[:, 2], hub[:, 2] = inside, outside - normal[2] * .005, outside
            for k in range(8):
                a, b = (k, (k + 1) % 8) if right else ((k + 1) % 8, k)
                face([inner[a], inner[b], outer[b]], radial[[a, b, b]], TYRE)
                face([inner[a], outer[b], outer[a]], radial[[a, b, a]], TYRE)
            order = list(range(8)) if right else list(reversed(range(8)))
            for i in range(1, 7):
                a, b, c = order[0], order[i], order[i + 1]
                face(hub[[a, b, c]], [normal] * 3, DISC)
                face(outer[[a, b, c]], [normal] * 3, TYRE)
                face(inner[[c, b, a]], [-normal] * 3, TYRE)
    return np.asarray(corners)


def simplify(kind, pos, uv, normals, roles, target):
    # Weld rounded positions across the shell, glazing and lenses. Split the
    # index at actual material and UV discontinuities. All surfaces undergo the
    # same edge collapses, retaining both sides of a shared aperture edge.
    surface = tree(pos)
    keep = visible_faces(pos, roles, surface)
    pos, uv, normals, roles = pos[keep], uv[keep], normals[keep], roles[keep]
    surface = tree(pos)
    uv[roles != PAINT] = 0
    labels = np.repeat(roles[:, None, None], 3, axis=1)
    keys = np.concatenate((pos.round(5), uv.round(6), labels), axis=2).reshape(-1, 6)
    vertices, original, mapping = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    ids = mapping.reshape(-1, 3)
    xyz, texcoords, role = vertices[:, :3], uv.reshape(-1, 2)[original], vertices[:, 5].astype(int)
    cross = np.cross(pos[:, 1] - pos[:, 0], pos[:, 2] - pos[:, 0])
    shading = np.zeros_like(xyz)
    for k in range(3):
        np.add.at(shading, ids[:, k], normals[:, k] * np.linalg.norm(cross, axis=1)[:, None])
    locks = np.zeros(len(xyz), dtype=int)
    for axis in range(3):
        for index in (xyz[:, axis].argmin(), xyz[:, axis].argmax()):
            # An isolated locked point can survive as a zero-area mirror. Keep
            # an incident face so its extremum is still in the emitted indices.
            adjacent = np.flatnonzero((ids == index).any(1))
            largest = adjacent[np.linalg.norm(cross[adjacent], axis=1).argmax()]
            locks[ids[largest]] = 1
    # Sample longitudinal stations on the actual top surface. These retain the
    # roof crown, bonnet shoulders, glazing outline and pickup bed at this budget.
    lo, hi = xyz.min(0), xyz.max(0)
    for x in np.linspace(lo[0] + .15, hi[0] - .15, 8):
        for z in hi[2] * np.array([-.62, 0, .62]):
            hit, _, f, _ = surface.ray_cast((x, hi[1] + 1, z), (0, -1, 0))
            if hit is not None:
                corners = ids[f]
                locks[corners[np.linalg.norm(xyz[corners] - np.asarray(hit), axis=1).argmin()]] = 1
    # A thin flush lamp can collapse to a line for almost no geometric error.
    # Anchor its outline in the lens plane, including both sides of the car.
    for lamp in (HEAD, TAIL):
        for right in (False, True):
            selector = (roles == lamp) & ((pos[:, :, 2].mean(1) > 0) == right)
            lens_ids = ids[selector]
            areas = np.linalg.norm(cross[selector], axis=1)
            main_lens = max(components(lens_ids), key=lambda group: areas[group].sum())
            indices = np.unique(lens_ids[main_lens])
            points = xyz[indices]
            basis = np.linalg.svd(points - points.mean(0), full_matrices=False)[2][:2]
            for angle in np.arange(6) * math.tau / 6:
                direction = math.cos(angle) * basis[0] + math.sin(angle) * basis[1]
                locks[indices[np.argmax(points @ direction)]] = 1
    args = {"positions": xyz.ravel().tolist(), "indices": ids.ravel().tolist(), "target": target,
            "locks": locks.tolist(), "attributes": np.c_[texcoords, unit(shading)].ravel().tolist()}
    run = subprocess.run(["node", str(HELPERS / "lod_simplify.mjs")], input=json.dumps(args),
                         stdout=subprocess.PIPE, check=True, text=True)
    triangles = np.asarray(json.loads(run.stdout)).reshape(-1, 3)
    assert len(triangles) <= target, (kind, len(triangles), target)
    assert (role[triangles] == role[triangles[:, :1]]).all(), kind

    shading = transferred_normals(triangles, xyz, texcoords, ids, pos, uv, normals, roles)
    body, rest = [], []
    for tri, corner_normals in zip(triangles, shading):
        for index, n in zip(tri, corner_normals):
            if role[index] == PAINT:
                body.append(np.r_[xyz[index], n, texcoords[index]])
            else:
                rest.append(np.r_[xyz[index], n, COLOURS[role[index]]])
    return np.asarray(body), np.asarray(rest)


def build_car(kind, spec, palette, doc, binary, parts):
    positions, normals, texcoords, roles, full_bounds = [], [], [], [], []
    for part, name in spec["nodes"].items():
        if part == "root":
            continue
        prim = parts[name]
        ix = accessor(doc, binary, prim["indices"]).reshape(-1, 3)
        attrs = {k: accessor(doc, binary, v) for k, v in prim["attributes"].items()}
        full_bounds.append(attrs["POSITION"])
        pos = attrs["POSITION"][ix].astype(np.float64)
        if part == "wheels":
            wheel_corners = wheels(attrs["POSITION"])
            continue
        uv = attrs["TEXCOORD_0"][ix].astype(np.float64)
        n = attrs["NORMAL"][ix]
        if part == "body":
            keep = surface_faces(pos)
            pos, uv, n = pos[keep], uv[keep], n[keep]
            tags = body_roles(pos, uv, spec, palette)
        elif part == "lenses":
            tags = np.where(pos[:, :, 0].mean(axis=1) > 0, HEAD, TAIL)
        else:
            tag = {"glass": GLASS, "lights_head": HEAD, "lights_tail": TAIL, "lights_brake": TAIL}[part]
            tags = np.full(len(pos), tag)
            if part == "glass":
                for panel in components(corner_keys(pos)):
                    x, y, _ = pos[panel].mean(axis=(0, 1))
                    if abs(x) > .33 * spec["length"] and y < .62 * spec["height"]:
                        tags[panel] = HEAD if x > 0 else TAIL
        positions.append(pos)
        texcoords.append(uv)
        normals.append(n)
        roles.append(tags)
    body, rest = simplify(kind, np.concatenate(positions), np.concatenate(texcoords),
                          np.concatenate(normals), np.concatenate(roles), BUDGET - len(wheel_corners) // 3)
    return body, np.concatenate((rest, wheel_corners)), bounds(full_bounds)


def verify(path, source_manifest, originals, source_doc, source_binary, source_parts):
    doc, binary = read_glb(path)
    nodes = doc["nodes"]
    roots = doc["scenes"][doc["scene"]]["nodes"]
    assert len(nodes) == 27 and len(doc["meshes"]) == 18 and len(roots) == 9
    assert {nodes[i]["name"] for i in roots} == set(source_manifest["types"])
    assert all(not {"matrix", "translation", "rotation", "scale"}.intersection(n) for n in nodes)
    specs = {}
    for i in roots:
        root = nodes[i]
        kind = root["name"]
        names = {key: f"{kind}_lod_{key}" for key in ("body", "rest")}
        children = {nodes[c]["name"]: nodes[c] for c in root["children"]}
        assert len(root["children"]) == 2 and set(children) == set(names.values())
        counts, arrays = {}, []
        for key, name in names.items():
            mesh = doc["meshes"][children[name]["mesh"]]
            assert mesh["name"] == name and len(mesh["primitives"]) == 1
            prim, = mesh["primitives"]
            attrs = prim["attributes"]
            channel = "TEXCOORD_0" if key == "body" else "COLOR_0"
            assert set(attrs) == {"POSITION", "NORMAL", channel}
            pos, normal, data = (accessor(doc, binary, attrs[k]) for k in ("POSITION", "NORMAL", channel))
            assert len(pos) == len(normal) == len(data) and np.isfinite(data).all()
            assert np.allclose(np.linalg.norm(normal, axis=1), 1, atol=.001)
            ix = accessor(doc, binary, prim["indices"]).reshape(-1, 3)
            assert ix.max() < len(pos)
            pts = pos[ix]
            geometric = np.cross(pts[:, 1] - pts[:, 0], pts[:, 2] - pts[:, 0])
            assert np.all(np.linalg.norm(geometric, axis=1) > 0)
            assert np.all(np.einsum("ij,ij->i", geometric, normal[ix].mean(1)) > -1e-9)
            pbr = doc["materials"][prim["material"]]["pbrMetallicRoughness"]
            if key == "body":
                src = source_manifest["types"][kind]
                attrs_full = source_parts[src["nodes"]["body"]]["attributes"]
                def atlas_corners(positions, uv):
                    return set(map(tuple, np.c_[np.rint(positions.astype(float) * 1e5), uv]))
                authored = atlas_corners(*(accessor(source_doc, source_binary, attrs_full[k])
                                           for k in ("POSITION", "TEXCOORD_0")))
                assert atlas_corners(pos, data) <= authored, (kind, "atlas")
                for slot, expected in (("baseColorTexture", src["variants"][0]["map"]),
                                       ("metallicRoughnessTexture", src["metallicMap"])):
                    tex = doc["textures"][pbr[slot]["index"]]
                    image = tex.get("extensions", {}).get("EXT_texture_webp", tex)["source"]
                    assert doc["images"][image]["uri"] == expected and (MODELS / expected).is_file()
            else:
                assert not any("Texture" in slot for slot in pbr) and doc["accessors"][attrs[channel]]["normalized"]
                for tag in (TRIM, GLASS, HEAD, TAIL, TYRE, DISC):
                    subset = pos[np.all(data[:, :3] == np.rint(COLOURS[tag] * 255), axis=1)]
                    assert len(subset) and subset[:, 2].min() < 0 < subset[:, 2].max(), (kind, tag)
            counts[key] = len(ix)
            arrays.append(pos)
        counts["total"] = sum(counts.values())
        bbox = bounds(arrays)
        error = np.max(np.abs(bbox - originals[kind]))
        assert error <= .02 and counts["total"] <= BUDGET, (kind, error, counts)
        specs[kind] = {
            "nodes": {"root": kind, **names}, "triangles": counts,
            "boundingBox": dict(zip(("min", "max"), bbox.astype(float).round(6).tolist())),
            "bodyMaps": f"Use cars.json types.{kind}.variants[].map and the shared metallicMap / roughnessMap.",
        }
        print(f"{kind:10} {counts['body']:3} body + {counts['rest']:3} rest = {counts['total']:3} triangles"
              f"   maximum bound error {1000 * error:.3f} mm", flush=True)
    return specs


def main():
    start = time.perf_counter()
    src = json.loads((MODELS / "cars.json").read_text(encoding="utf-8"))
    doc, binary = read_glb(MODELS / "cars.glb")
    parts = primitives(doc)
    writer = LodFile(src["credit"])
    originals = {}
    for kind, spec in src["types"].items():
        body, rest, originals[kind] = build_car(kind, spec, src["palette"], doc, binary, parts)
        writer.car(kind, body, rest, spec)
    with tempfile.TemporaryDirectory(dir=MODELS) as work:
        path = Path(work) / "cars_lod.glb"
        writer.write(path)
        manifest = {key: src[key] for key in ("units", "axes", "origin", "credit", "source")}
        manifest["types"] = verify(path, src, originals, doc, binary, parts)
        info = path.with_suffix(".json")
        info.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        path.replace(MODELS / path.name)
        info.replace(MODELS / info.name)
    print(f"{MODELS / path.name}\n{MODELS / info.name}\nVerified in {time.perf_counter() - start:.1f} s")


if __name__ == "__main__":
    main()
