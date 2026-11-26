"""Compare both shipping GLBs at identical poses, lights and pixel density."""
import json
import math
from pathlib import Path
import subprocess
import sys
import tempfile
import time

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from catalog import MODELS, PROJECT


OUT = PROJECT / "renders/cars/lod_sheet.jpg"
PAINTS = {"sedan": "silver", "wagon": "darkblue", "hatchback": "white",
          "compact": "silver", "coupe": "red", "minivan": "white",
          "pickup": "silver", "suv": "white", "offroad": "silver"}
TILE = (200, 116)
CLOSE = (604, 304)


def compose(folder):
    from PIL import Image, ImageDraw, ImageFont

    sheet = Image.new("RGB", (1272, 1282), "#171d23")
    draw = ImageDraw.Draw(sheet)
    fonts = Path("C:/Windows/Fonts")
    title = ImageFont.truetype(str(fonts / "segoeuib.ttf"), 28)
    label = ImageFont.truetype(str(fonts / "segoeuib.ttf"), 17)
    small = ImageFont.truetype(str(fonts / "segoeui.ttf"), 14)
    ink, muted, line = "#eef1ed", "#b6c3c8", "#3a464c"
    draw.text((20, 10), "Traffic cars at 30 m", font=title, fill=ink)
    draw.text((20, 51), "Full model on the left, LOD on the right. Upper views are at 55° elevation. Lower views are directly overhead.",
              font=small, fill=muted)
    draw.line((20, 80, 1252, 80), fill=line)
    for i, (kind, paint) in enumerate(PAINTS.items()):
        x = 20 + i % 3 * 416
        y = 89 + i // 3 * 279
        name = "SUV" if kind == "suv" else kind.capitalize()
        draw.text((x, y), name, font=label, fill=ink)
        draw.text((x + 404, y + 3), paint.replace("darkblue", "dark blue"), font=small,
                  anchor="ra", fill=muted)
        for row, view in enumerate(("angle", "top")):
            for col, level in enumerate(("full", "lod")):
                with Image.open(folder / f"{kind}-{view}-{level}.png") as im:
                    sheet.paste(im.convert("RGB"), (x + col * 204, y + 28 + row * 119))
    draw.line((20, 923, 1252, 923), fill=line)
    draw.text((20, 931), "Sedan at 7 m", font=label, fill=ink)
    draw.text((624, 935), "Full model", font=small, anchor="ra", fill=muted)
    draw.text((1252, 935), "LOD", font=small, anchor="ra", fill=muted)
    for x, level in ((20, "full"), (648, "lod")):
        with Image.open(folder / f"sedan-close-{level}.png") as im:
            sheet.paste(im.convert("RGB"), (x, 962))
    sheet.save(OUT, quality=75, optimize=True, subsampling=0)


def render_sheet():
    import bpy
    from mathutils import Vector
    sys.path.insert(0, str(HERE.parent))
    from render_cars import aim, light, paint, scene_setup, visible

    start = time.perf_counter()
    sc, floor = scene_setup()
    src = json.loads((MODELS / "cars.json").read_text(encoding="utf-8"))["types"]
    full = {k: bpy.data.objects[k] for k in PAINTS}
    for k, root in full.items():
        root.name = "Full " + k
        visible(root, False)
    bpy.ops.import_scene.gltf(filepath=str(MODELS / "cars_lod.glb"))
    lod = {k: bpy.data.objects[k] for k in PAINTS}
    for k, root in lod.items():
        visible(root, False)
        variant = next(v for v in src[k]["variants"] if v["color"] == PAINTS[k])
        for body in (src[k]["nodes"]["body"], k + "_lod_body"):
            paint(bpy.data.objects[body].active_material, variant)
    bg = sc.world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (.27, .36, .57, 1)
    bg.inputs["Strength"].default_value = .22
    floor.inputs["Base Color"].default_value = (.052, .041, .035, 1)
    floor.inputs["Roughness"].default_value = .73
    light("Parking lamp", (2, -3, 7), (0, 0, .6), 1050, (1, .77, .54), 3.5, 2.2)
    light("Storefront", (-2, 3, 4), (0, 0, .6), 610, (1, .74, .52), 7, 1.3)
    light("Sky fill", (-2, -4, 5), (0, 0, .6), 330, (.54, .69, 1), 6, 3)
    sc.render.use_persistent_data = True
    sc.cycles.samples = 32
    cam = sc.camera
    cam.data.type = "PERSP"
    cam.data.sensor_fit = "HORIZONTAL"
    cam.data.sensor_width = 36
    # Centre crops at native pixel scale from a 720 px tall, 50° vertical-FOV
    # view. Shrinking the sensor's field of view avoids rendering the unused lot.
    focal_pixels = 720 / (2 * math.tan(math.radians(25)))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=OUT.parent) as temp:
        folder = Path(temp)
        for k in PAINTS:
            views = ["angle", "top"] + (["close"] if k == "sedan" else [])
            for view in views:
                close = view == "close"
                target = Vector((0, 0, src[k]["height"] * (.36 if close else .49)))
                elevation = math.radians(25 if close else 55)
                azimuth = math.radians(-59)
                direction = Vector((math.cos(azimuth) * math.cos(elevation),
                                    math.sin(azimuth) * math.cos(elevation), math.sin(elevation)))
                if view == "top":
                    direction = Vector((0, 0, 1))
                cam.location = target + direction * (7 if close else 30)
                if view == "top":
                    cam.rotation_euler = (0, 0, 0)
                else:
                    aim(cam, target)
                width, height = CLOSE if close else TILE
                cam.data.lens = cam.data.sensor_width * focal_pixels / width
                sc.render.resolution_x, sc.render.resolution_y = width, height
                for level, root in (("full", full[k]), ("lod", lod[k])):
                    visible(root, True)
                    sc.render.filepath = str(folder / f"{k}-{view}-{level}.png")
                    bpy.ops.render.render(write_still=True)
                    visible(root, False)
        subprocess.run(["python", "-B", __file__, "--compose", temp], check=True)
    print(f"{OUT}  |  38 views  |  {time.perf_counter() - start:.1f} s")


if __name__ == "__main__":
    if sys.argv[1:2] == ["--compose"]:
        compose(Path(sys.argv[2]))
    else:
        render_sheet()
