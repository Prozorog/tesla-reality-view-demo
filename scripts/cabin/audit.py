"""Parse the GLB payload itself, including accessor bytes and node transforms."""
import json
import struct
from mathutils import Matrix,Quaternion,Vector


def verify(path,report):
    raw=path.read_bytes()
    assert raw[:4]==b'glTF' and struct.unpack_from('<I',raw,8)[0]==len(raw)
    length=struct.unpack_from('<I',raw,12)[0]
    doc=json.loads(raw[20:20+length])
    buf=memoryview(raw)[28+length:]
    nodes={n['name']:n for n in doc['nodes']}
    required={'steering_wheel','screen_surface','screen_bezel','light_strip','eye_driver'}
    assert required <= nodes.keys() and 'mesh' not in nodes['eye_driver']
    def mesh(name):
        return doc['meshes'][nodes[name]['mesh']]['primitives']
    def read(i):
        acc=doc['accessors'][i]
        view=doc['bufferViews'][acc['bufferView']]
        fmt={'VEC3':'<3f','VEC2':'<2f'}[acc['type']]
        step=view.get('byteStride',struct.calcsize(fmt))
        offset=view.get('byteOffset',0)+acc.get('byteOffset',0)
        return [struct.unpack_from(fmt,buf,offset+j*step) for j in range(acc['count'])]
    def close(a,b):
        return (Vector(a)-Vector(b)).length<2e-5
    counts={}
    for name,mapping in report['mesh_lightmaps'].items():
        prims=mesh(name)
        counts[name]=sum(doc['accessors'][p['indices']]['count']//3 for p in prims)
        if mapping:
            assert all({'TEXCOORD_0','TEXCOORD_1'} <= p['attributes'].keys() for p in prims),name
    assert sum(counts.values())<=120000,counts
    s,=mesh('screen_surface')
    attr=s['attributes']
    assert doc['materials'][s['material']]['name']=='screen'
    assert doc['accessors'][attr['POSITION']]['count']==4 and counts['screen_surface']==2
    expected=report['screen_surface']['corners']
    for position,uv in zip(read(attr['POSITION']),read(attr['TEXCOORD_0'])):
        assert any(close(position,c['position_gltf']) and close(uv,(c['uv'][0],1-c['uv'][1]))
                   for c in expected),(position,uv)
    assert close(nodes['eye_driver']['translation'],report['eye_driver_gltf'])
    w=nodes['steering_wheel']
    assert close(w['translation'],report['steering_wheel']['pivot_gltf'])
    x,y,z,qw=w['rotation']
    rot=Quaternion((qw,x,y,z))
    assert close(rot@Vector((0,1,0)),report['steering_wheel']['axis_gltf_world'])
    eye=Vector(report['eye_driver_gltf'])
    pivot=Vector(w['translation'])
    pts=[pivot+rot@Vector(p) for prim in mesh('steering_wheel') for p in read(prim['attributes']['POSITION'])]
    slope=max((p.z-eye.z)/(p.x-eye.x) for p in pts)
    screen_slope=min((c['position_gltf'][2]-eye.z)/(c['position_gltf'][0]-eye.x) for c in expected)
    wheel_top=max(p.y for p in pts)
    assert slope<screen_slope and wheel_top<eye.y,(slope,screen_slope,wheel_top,eye.y)
    return counts,{'screen_accessor_vertices':4,'screen_triangles':2,
                   'mapped_meshes_with_two_uv_sets':sum(bool(f) for f in report['mesh_lightmaps'].values()),
                   'wheel_top_below_eye_horizon_m':round(eye.y-wheel_top,5),
                   'wheel_screen_angular_gap_deg':angular_gap(slope,screen_slope)}


def angular_gap(left,right):
    from math import atan,degrees
    return round(degrees(atan(right)-atan(left)),4)

