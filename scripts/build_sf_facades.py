"""Original Marina facade modules. Run with headless Blender 5.2 from the repo."""
import math
import sys
from pathlib import Path

sys.dont_write_bytecode = True
import bpy

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "models" / "sf" / "facades.glb"
WIDTH, FLOOR = 4.0, 3.2


def linear(hex_color):
    values = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values) + (1.,)


def material(name, color):
    result = bpy.data.materials.new(name)
    result.diffuse_color = linear(color)
    result.use_nodes = True
    shader = result.node_tree.nodes["Principled BSDF"]
    shader.inputs["Base Color"].default_value = result.diffuse_color
    shader.inputs["Roughness"].default_value = .84
    return result


class Module:
    def __init__(self, name):
        self.name = name
        self.vertices, self.faces, self.finishes = [], [], []

    def face(self, points, finish):
        start = len(self.vertices)
        self.vertices.extend((x, -z, y) for x, y, z in points)
        self.faces.append(tuple(range(start, len(self.vertices))))
        self.finishes.append(finish)

    def box(self, center, size, finish):
        x, y, z = center
        a, b, c = (value / 2 for value in size)
        self.face([(x-a,y-b,z+c),(x+a,y-b,z+c),(x+a,y+b,z+c),(x-a,y+b,z+c)], finish)
        self.face([(x+a,y-b,z-c),(x-a,y-b,z-c),(x-a,y+b,z-c),(x+a,y+b,z-c)], finish)
        self.face([(x-a,y+b,z+c),(x+a,y+b,z+c),(x+a,y+b,z-c),(x-a,y+b,z-c)], finish)
        self.face([(x-a,y-b,z-c),(x+a,y-b,z-c),(x+a,y-b,z+c),(x-a,y-b,z+c)], finish)
        self.face([(x+a,y-b,z+c),(x+a,y-b,z-c),(x+a,y+b,z-c),(x+a,y+b,z+c)], finish)
        self.face([(x-a,y-b,z-c),(x-a,y-b,z+c),(x-a,y+b,z+c),(x-a,y+b,z-c)], finish)

    def panel(self, x, y, z, width, height, finish):
        self.face([(x-width/2,y-height/2,z),(x+width/2,y-height/2,z),
                   (x+width/2,y+height/2,z),(x-width/2,y+height/2,z)], finish)

    def rail(self, a, b, thickness, finish):
        dx, dz = b[0] - a[0], b[2] - a[2]
        length = math.hypot(dx, dz)
        nx, nz = -dz / length * thickness / 2, dx / length * thickness / 2
        for low, high in [(a[1]-thickness/2, a[1]+thickness/2)]:
            self.face([(a[0]+nx,low,a[2]+nz),(b[0]+nx,low,b[2]+nz),
                       (b[0]+nx,high,b[2]+nz),(a[0]+nx,high,a[2]+nz)], finish)
            self.face([(b[0]-nx,low,b[2]-nz),(a[0]-nx,low,a[2]-nz),
                       (a[0]-nx,high,a[2]-nz),(b[0]-nx,high,b[2]-nz)], finish)
            self.face([(a[0]+nx,high,a[2]+nz),(b[0]+nx,high,b[2]+nz),
                       (b[0]-nx,high,b[2]-nz),(a[0]-nx,high,a[2]-nz)], finish)

    def wall(self):
        self.panel(0, FLOOR/2, .018, WIDTH, FLOOR, "paint")
        self.box((-1.94, FLOOR/2, .035), (.12, FLOOR, .09), "trim")
        self.box((1.94, FLOOR/2, .035), (.12, FLOOR, .09), "trim")

    def export(self):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata(self.vertices, [], self.faces)
        mesh.update()
        names = list(dict.fromkeys(self.finishes))
        for name in names:
            mesh.materials.append(MATERIALS[name])
        for polygon, name in zip(mesh.polygons, self.finishes):
            polygon.material_index = names.index(name)
        uv = mesh.uv_layers.new(name="UVMap")
        lightmap = mesh.uv_layers.new(name="Lightmap")
        grid = math.ceil(math.sqrt(len(mesh.polygons)))
        for polygon in mesh.polygons:
            cx, cy = polygon.index % grid, polygon.index // grid
            for corner, loop in enumerate(polygon.loop_indices):
                u, v = [(0, 0), (1, 0), (1, 1), (0, 1)][corner % 4]
                uv.data[loop].uv = (u, v)
                lightmap.data[loop].uv = ((cx+.05+.9*u)/grid, (cy+.05+.9*v)/grid)
        obj = bpy.data.objects.new(self.name, mesh)
        bpy.context.collection.objects.link(obj)
        obj["module_width"], obj["floor_height"] = WIDTH, FLOOR
        return obj


def bay(name, projection, split):
    module = Module(name)
    module.wall()
    plan = [(-1.03,.06),(-.72,projection),(.72,projection),(1.03,.06)]
    low, high = .82, 2.62
    for (ax, az), (bx, bz) in zip(plan, plan[1:]):
        module.face([(ax,low,az),(bx,low,bz),(bx,high,bz),(ax,high,az)], "window")
        for y in [low, split, high]:
            module.rail((ax,y,az+.018),(bx,y,bz+.018), .065, "trim")
    for x, z in plan:
        module.box((x,(low+high)/2,z+.018), (.068,high-low,.068), "trim")
    module.box((0,.69,projection*.55),(2.22,.18,projection+ .12),"trim")
    module.box((0,2.75,projection*.55),(2.24,.16,projection+.14),"trim")
    module.export()


def sash(name, double, balcony):
    module = Module(name)
    module.wall()
    centers = [-.67,.67] if double else [0]
    width = 1.02 if double else 1.65
    for x in centers:
        module.panel(x,1.73,.055,width,1.77,"window")
        for dx in [-width/2,width/2]:
            module.box((x+dx,1.73,.09),(.068,1.91,.10),"trim")
        for y in [.81,1.68,2.65]:
            module.box((x,y,.09),(width+.12,.07,.10),"trim")
        module.box((x,.72,.12),(width+.28,.14,.24),"trim")
    if balcony:
        module.box((0,.67,.37),(2.7,.12,.75),"trim")
        for x in [-1.25,-.9,-.55,-.2,.2,.55,.9,1.25]:
            module.box((x,1.12,.69),(.035,.8,.035),"iron")
        module.box((0,1.53,.69),(2.6,.045,.045),"iron")
    module.export()


def ground(name, garage):
    module = Module(name)
    module.wall()
    if garage:
        module.panel(-.38,1.25,.055,2.52,2.35,"garage")
        for y in [.38,.77,1.16,1.55,1.94,2.33]:
            module.panel(-.38,y,.068,2.5,.025,"iron")
        module.panel(1.35,1.29,.062,.62,2.39,"door")
        module.panel(1.35,1.87,.078,.39,.81,"glass")
        module.box((1.56,1.18,.095),(.035,.15,.035),"trim")
    else:
        module.panel(0,1.25,.075,1.06,2.44,"door")
        module.panel(0,1.74,.09,.76,1.04,"glass")
        for x in [-.63,.63]:
            module.box((x,1.28,.1),(.16,2.56,.18),"trim")
        module.box((0,2.6,.14),(1.65,.23,.34),"trim")
        for x in [-1.35,1.35]:
            module.panel(x,1.6,.045,.74,1.62,"window")
    module.export()


def shop(name, striped):
    module = Module(name)
    module.wall()
    module.panel(-.56,1.26,.055,2.48,2.16,"shop_window")
    module.panel(1.27,1.22,.078,.8,2.3,"shop_window")
    for x in [-1.85,.69,.81,1.75]:
        module.box((x,1.3,.10),(.07,2.5,.12),"iron")
    module.box((-.55,.23,.11),(2.55,.23,.16),"trim")
    for index in range(12):
        x = -1.95 + index*3.9/12
        finish = "awning" if not striped or index % 2 == 0 else "trim"
        module.face([(x,2.54,.04),(x+3.9/12,2.54,.04),(x+3.9/12,2.28,.9),(x,2.28,.9)],finish)
        module.face([(x,2.28,.9),(x+3.9/12,2.28,.9),(x+3.9/12,2.1,.9),(x,2.1,.9)],finish)
    module.export()


def cornice(name, ornate):
    module = Module(name)
    for y, depth, height in [(.035,.14,.07),(.12,.30,.1),(.23,.44,.12)]:
        module.box((0,y,depth/2),(4.04,height,depth),"trim")
    if ornate:
        for x in [-1.75,-1.25,-.75,-.25,.25,.75,1.25,1.75]:
            module.box((x,-.05,.13),(.11,.15,.22),"trim")
    module.export()


def sign(index, text):
    module = Module("sign_" + str(index))
    module.box((0,0,.13),(3.6,.47,.13),"sign_board")
    parent = module.export()
    curve = bpy.data.curves.new("Fictional lettering", type="FONT")
    curve.body, curve.align_x, curve.align_y = text.upper(), "CENTER", "CENTER"
    curve.size, curve.extrude, curve.resolution_u = .28, .0015, 1
    lettering = bpy.data.objects.new("Letters " + str(index), curve)
    bpy.context.collection.objects.link(lettering)
    lettering.location = (0,-.205,-.005)
    lettering.rotation_euler.x = math.pi/2
    lettering.parent = parent
    curve.materials.append(MATERIALS["sign_letters"])
    bpy.context.view_layer.objects.active = lettering
    lettering.select_set(True)
    bpy.ops.object.convert(target="MESH")
    lettering.select_set(False)
    parent["fictional_name"] = text


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.threads_mode = "FIXED"
bpy.context.scene.render.threads = 4
MATERIALS = {key: material("NightFacade_"+key, color) for key, color in {
    "paint":"#e7e4da", "trim":"#d8d4c7", "glass":"#243c48", "window":"#f1c78a",
    "shop_window":"#ffcd86", "iron":"#28383c", "garage":"#929e94", "door":"#4e625b",
    "awning":"#315e5b", "sign_board":"#263f43", "sign_letters":"#ffe4b1",
}.items()}
bay("bay_a",.52,1.84)
bay("bay_b",.40,1.66)
sash("sash_a",True,False)
sash("sash_b",False,True)
ground("garage_a",True)
ground("entry_a",False)
shop("shop_a",True)
shop("shop_b",False)
cornice("cornice_a",False)
cornice("cornice_b",True)
for name, width, height, y, finish in [
    ("far_window",1.55,1.56,1.71,"window"), ("far_shop",2.8,2.05,1.3,"shop_window")]:
    module = Module(name)
    module.panel(0,y,.06,width,height,finish)
    module.export()
for index, text in enumerate(["Velune Kitchen","Brindle Star","Luma Finch","Nori & Nacre",
                              "Ternlight Bakery","Aster Pier","Marble Wren","Ochre Umbrella"]):
    sign(index,text)
OUTPUT.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(OUTPUT),export_format="GLB",export_yup=True,
                          export_apply=True,export_animations=False,export_extras=True)
print("Facade kit:",OUTPUT,flush=True)
