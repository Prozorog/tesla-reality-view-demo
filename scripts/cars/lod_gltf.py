"""Read the pack's indexed primitives and serialize the small Y-up LOD scene."""
import json
from pathlib import Path
import struct

import numpy as np


DTYPES = {5121: "u1", 5123: "<u2", 5125: "<u4", 5126: "<f4"}
WIDTHS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


def read_glb(path):
    data = path.read_bytes()
    magic, version, size, n, tag = struct.unpack_from("<4sIII4s", data)
    assert (magic, version, size, tag) == (b"glTF", 2, len(data), b"JSON")
    doc = json.loads(data[20:20 + n])
    length, tag = struct.unpack_from("<I4s", data, 20 + n)
    assert tag == b"BIN\0" and length == len(data) - 28 - n
    return doc, memoryview(data)[28 + n:]


def accessor(doc, binary, index):
    a = doc["accessors"][index]
    v = doc["bufferViews"][a["bufferView"]]
    dtype = np.dtype(DTYPES[a["componentType"]])
    width = WIDTHS[a["type"]]
    return np.ndarray((a["count"], width), dtype, buffer=binary,
                      offset=v.get("byteOffset", 0) + a.get("byteOffset", 0),
                      strides=(v.get("byteStride", width * dtype.itemsize), dtype.itemsize))


def primitives(doc):
    return {n["name"]: doc["meshes"][n["mesh"]]["primitives"][0]
            for n in doc["nodes"] if "mesh" in n}


def bounds(arrays):
    points = np.concatenate(arrays)
    return np.stack((points.min(axis=0), points.max(axis=0)))


class LodFile:
    def __init__(self, credit):
        self.data = bytearray()
        self.doc = {
            "asset": {"version": "2.0", "generator": "build_cars_lod.py", "copyright": credit},
            "scene": 0, "scenes": [{"nodes": []}], "nodes": [], "meshes": [],
            "bufferViews": [], "accessors": [], "images": [], "textures": [],
            "extensionsUsed": ["EXT_texture_webp"], "extensionsRequired": ["EXT_texture_webp"],
            "samplers": [{"magFilter": 9729, "minFilter": 9987}],
            "materials": [{"name": "traffic_lod_vertex_colours", "pbrMetallicRoughness":
                           {"metallicFactor": 0.05, "roughnessFactor": 0.26}}],
        }

    def paint(self, name, spec):
        slots = {}
        for slot, path in (("baseColorTexture", spec["variants"][0]["map"]),
                           ("metallicRoughnessTexture", spec["metallicMap"])):
            image = len(self.doc["images"])
            self.doc["images"].append({"uri": path})
            texture = {"sampler": 0}
            if Path(path).suffix == ".webp":
                texture["extensions"] = {"EXT_texture_webp": {"source": image}}
            else:
                texture["source"] = image
            slots[slot] = {"index": len(self.doc["textures"])}
            self.doc["textures"].append(texture)
        self.doc["materials"].append({"name": name + "_lod_paint", "pbrMetallicRoughness": slots})
        return len(self.doc["materials"]) - 1

    def array(self, values, component, form, target, *, positions=False, normalized=False):
        values = np.asarray(values, dtype=DTYPES[component]).reshape(-1, WIDTHS[form])
        self.data.extend(b"\0" * (-len(self.data) % 4))
        view = {"buffer": 0, "byteOffset": len(self.data), "byteLength": values.nbytes, "target": target}
        a = {"bufferView": len(self.doc["bufferViews"]), "componentType": component,
             "type": form, "count": len(values)}
        if positions:
            a.update(min=values.min(axis=0).tolist(), max=values.max(axis=0).tolist())
        if normalized:
            a["normalized"] = True
        self.doc["bufferViews"].append(view)
        self.doc["accessors"].append(a)
        self.data.extend(values.tobytes())
        return len(self.doc["accessors"]) - 1

    def mesh(self, name, corners, paint=None):
        # Rows are position, split normal, then either UV or linear RGB. Keep
        # mirrored UV islands and hard normal edges separate even at the same XYZ.
        rows, indices = np.unique(corners, axis=0, return_inverse=True)
        attrs = {"POSITION": self.array(rows[:, :3], 5126, "VEC3", 34962, positions=True),
                 "NORMAL": self.array(rows[:, 3:6], 5126, "VEC3", 34962)}
        if paint is not None:
            attrs["TEXCOORD_0"] = self.array(rows[:, 6:], 5126, "VEC2", 34962)
        else:
            rgba = np.column_stack((rows[:, 6:], np.ones(len(rows))))
            attrs["COLOR_0"] = self.array(np.rint(rgba * 255), 5121, "VEC4", 34962, normalized=True)
        prim = {"attributes": attrs, "material": paint or 0,
                "indices": self.array(indices, 5123, "SCALAR", 34963)}
        node = len(self.doc["nodes"])
        self.doc["nodes"].append({"name": name, "mesh": len(self.doc["meshes"])})
        self.doc["meshes"].append({"name": name, "primitives": [prim]})
        return node

    def car(self, kind, body, rest, spec):
        children = [self.mesh(kind + "_lod_body", body, self.paint(kind, spec)),
                    self.mesh(kind + "_lod_rest", rest)]
        self.doc["scenes"][0]["nodes"].append(len(self.doc["nodes"]))
        self.doc["nodes"].append({"name": kind, "children": children})

    def write(self, path):
        self.doc["buffers"] = [{"byteLength": len(self.data)}]
        meta = json.dumps(self.doc, separators=(",", ":")).encode()
        meta += b" " * (-len(meta) % 4)
        self.data.extend(b"\0" * (-len(self.data) % 4))
        path.write_bytes(struct.pack("<4sIII4s", b"glTF", 2, 28 + len(meta) + len(self.data),
                                     len(meta), b"JSON") + meta
                         + struct.pack("<I4s", len(self.data), b"BIN\0") + self.data)
