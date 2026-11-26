"""Pixel-local repairs to the source atlas and matched-view proof for the hero."""
import io
import json
import os
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / "tmp/meshy-hero"
VIEWS = ROOT / "renders/hero"
REF = Path(os.environ.get("TESLA_REF_DIR", ROOT.parent / "ref"))
SOURCE = Path(os.environ.get("TESLA_MESHY_SOURCE", REF / "Meshy_AI_White_Tesla_Model_S_Collage_20261123_texture.glb"))


POSITION_SHIFT = 10.0
GLASS_MAX = 150          # source glass, seals and cabin art sit below this; paint sits above 200
GLASS_MARGIN = 4         # texels kept free of paint evening around the glass
BAND_WIDTH = .025        # metres of black seal along every glass edge
BAND_RAMP = .008         # roughly one glass texel
BAND_COLOUR = np.array([13, 14, 16], dtype=np.float32)
PAINT = np.array([232, 234, 233], dtype=np.float32)
CALIPER_DARK = np.array([30, 31, 33], dtype=np.float32)
WHEELBASE, WHEEL_RADIUS = 2.82431, .39741   # from hero.json


def disk(radius):
    yy, xx = np.mgrid[-radius:radius + 1, -radius:radius + 1]
    return xx * xx + yy * yy <= radius * radius + .5


def nearest(mask):
    """Row/column of the nearest texel inside mask for every texel."""
    _, (rows, cols) = ndimage.distance_transform_edt(~mask, return_indices=True)
    return rows, cols


def source_colour():
    source = SOURCE.read_bytes()
    json_size = struct.unpack_from("<I", source, 12)[0]
    doc = json.loads(source[20:20 + json_size])
    view = doc["bufferViews"][doc["images"][doc["textures"][0]["source"]]["bufferView"]]
    start = 28 + json_size + view.get("byteOffset", 0)
    return Image.open(io.BytesIO(source[start:start + view["byteLength"]])).convert("RGB")


def glass_layers(colour, positions, covered):
    """Texel glass coverage (0..1, smoothed outline) and the black seal weight."""
    x, y, z = np.moveaxis(positions, 2, 0)
    side = abs(y)
    maximum = colour.max(2)
    spread = maximum - colour.min(2)
    mirror = (side > .84) & (x > 1.5) & (x < 2.2)
    # Glass faces of the mesh: the window band of the baked surface positions.
    region = covered & (x > -.95) & (x < 2.62) & (z > .88) & (side < .875) & ~mirror
    raw = region & (maximum < GLASS_MAX) & (spread < 45)
    # Gutters copy their nearest covered texel so island borders neither erode nor grow.
    rows, cols = nearest(covered)
    shape = raw[rows, cols]
    shape = ndimage.binary_closing(shape, disk(2), border_value=0)
    shape = ndimage.binary_opening(shape, disk(2), border_value=0)
    soft = ndimage.gaussian_filter(shape.astype(np.float32), 1.0)
    alpha = np.clip((soft - .5) * 3 + .5, 0, 1)
    loose = ndimage.binary_dilation(region, disk(3))
    alpha[~loose] = 0
    inside = covered & (alpha >= .5)
    # Seal weight from the 3D distance to the nearest non-glass texel, so UV seams
    # inside a window never draw a line while real glass edges on any island do.
    outside = covered & ~inside & (x > -1.15) & (x < 2.85) & (z > .78)
    tree = cKDTree(positions[outside])
    query = covered & (alpha > 0)
    distance, _ = tree.query(positions[query], distance_upper_bound=BAND_WIDTH + .03, workers=4)
    seal = np.zeros(alpha.shape, np.float32)
    seal[query] = np.clip((BAND_WIDTH + BAND_RAMP / 2 - np.minimum(distance, 1)) / BAND_RAMP, 0, 1)
    seal[query & ~inside] = 1
    return raw, alpha, seal, region


def atlas():
    colour = source_colour()
    w, h = colour.size
    positions = np.load(WORK / "positions.npy")
    covered = positions.sum(2) > 1
    positions = positions - POSITION_SHIFT

    def draw_regions(faces, expansion):
        mask = Image.new("L", colour.size)
        plot = ImageDraw.Draw(mask)
        points = np.rint(faces * (w, -h) + (0, h - 1)).astype(int)
        for a, b, c in points.tolist():
            plot.polygon([tuple(a), tuple(b), tuple(c)], fill=255)
        return np.asarray(mask.filter(ImageFilter.MaxFilter(expansion))) > 0 if expansion > 1 else np.asarray(mask) > 0

    with np.load(WORK / "uv-regions.npz") as regions:
        body = draw_regions(regions["paint"], 3)
        letters = draw_regions(regions["lettering"], 5)
        calipers = draw_regions(regions["calipers"], 3) if "calipers" in regions else np.zeros((h, w), bool)
    source_colour_array = np.array(colour)
    source = source_colour_array.astype(np.float32)

    # 1-2. Glass: restore from the source, smooth the outline, add the black seal.
    raw, alpha, seal, region = glass_layers(source_colour_array.astype(np.int16), positions, covered)
    rows, cols = nearest(covered & ~raw)
    outside_colour = np.where(raw[:, :, None], source[rows, cols], source)
    rows, cols = nearest(raw)
    inside_colour = np.where(raw[:, :, None], source, source[rows, cols])
    inside_colour = inside_colour * (1 - seal[:, :, None]) + BAND_COLOUR * seal[:, :, None]
    composed = outside_colour * (1 - alpha[:, :, None]) + inside_colour * alpha[:, :, None]
    touched = covered & ndimage.binary_dilation(region, disk(3))
    composed = np.where(touched[:, :, None], composed, source)
    np.save(WORK / "glass.npy", (alpha * 255).astype(np.uint8))

    # 3-5. Paint evening, kept off the glass plus a margin.
    glass_zone = ndimage.binary_dilation(raw | (alpha > 0), disk(GLASS_MARGIN))
    maximum = source_colour_array.max(2)
    neutral = (maximum - source_colour_array.min(2)) < 37
    x, y, z = np.moveaxis(positions, 2, 0)
    wheel_zone = np.zeros_like(covered)
    for axle in (0, WHEELBASE):
        wheel_zone |= (abs(y) > .55) & (np.hypot(x - axle, z - WHEEL_RADIUS) < .405)
    candidate = Image.fromarray((body & neutral & (maximum >= 85) & ~glass_zone & ~wheel_zone).astype(np.uint8) * 255)
    candidate = candidate.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    coverage = np.asarray(candidate.filter(ImageFilter.GaussianBlur(.65)), dtype=np.float32) / 255
    coverage = coverage * ~glass_zone * ~wheel_zone
    letter_mask = Image.fromarray(letters.astype(np.uint8) * 255)
    coverage = np.maximum(coverage, np.asarray(letter_mask.filter(ImageFilter.GaussianBlur(1.15))) / 255)
    cleaned = composed * (1 - coverage[:, :, None]) + PAINT * coverage[:, :, None]

    # Gutters repeat their nearest covered texel so filtering never mixes in unrelated art.
    rows, cols = nearest(covered)
    cleaned = np.where(covered[:, :, None], cleaned, cleaned[rows, cols])
    shared = np.rint(cleaned).astype(np.uint8)

    normal_file = WORK / "normal.png"
    normals = np.array(Image.open(normal_file).convert("RGB"))
    normals[letters] = (128, 128, 255)
    Image.fromarray(normals).save(normal_file)
    for size in (1024, 512):
        Image.fromarray(shared).resize((size, size), Image.Resampling.LANCZOS).save(
            WORK / f"paint-{size}.jpg", quality=91, subsampling=0)
    # The main model's wheels read this atlas too; its caliper art moves to the
    # fixed caliper parts, so the turning wheel keeps a dark disc there.
    main = cleaned.copy()
    red, green, blue = np.moveaxis(source, 2, 0)
    in_caliper_ring = np.zeros_like(covered)
    for axle in (0, WHEELBASE):
        radial = np.hypot(x - axle, z - WHEEL_RADIUS)
        in_caliper_ring |= (abs(y) > .55) & (radial > .115) & (radial < .33)
    red_art = covered & in_caliper_ring & (red > 56) & (red > green * 1.38) & (red > blue * 1.28)
    caliper_texels = ndimage.binary_dilation(calipers | red_art, disk(1)) & covered & in_caliper_ring
    main[caliper_texels] = CALIPER_DARK
    Image.fromarray(np.rint(main).astype(np.uint8)).save(WORK / "paint.jpg", quality=96, subsampling=0)
    print(f"OUTPUT {WORK / 'paint.jpg'}; glass {float((alpha >= .5).mean()):.2%}, seal {float((seal * alpha).mean()):.3%}, "
          f"evening {float(coverage.mean()):.2%}, caliper texels {int(caliper_texels.sum())}", flush=True)


def proof(number):
    sheet = Image.new("RGB", (1600, 68 + 557 * 5), (27, 31, 37))
    captions = ImageDraw.Draw(sheet)
    font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 23)
    captions.text((16, 17), "Untouched Meshy source", font=font, fill="white")
    captions.text((816, 17), "Phase 1.3 source mesh and UV repairs", font=font, fill="white")
    results = {}
    for row, view in enumerate(("front", "rear", "side", "top", "quarter")):
        images = [Image.open(VIEWS / f"p13-{number}-{kind}-{view}.png").convert("RGBA") for kind in ("source", "hero")]
        a, b = [np.asarray(image.getchannel("A")) >= 128 for image in images]
        score = np.count_nonzero(a & b) / np.count_nonzero(a | b)
        results[view] = score
        y = 58 + 557 * row
        for col, image in enumerate(images):
            image.thumbnail((794, 527), Image.Resampling.LANCZOS)
            neutral = Image.new("RGBA", image.size, (75, 81, 89, 255))
            neutral.alpha_composite(image)
            sheet.paste(neutral.convert("RGB"), (col * 800 + 3, y))
        captions.text((16, y + 528), f"{view.title()}   ·   silhouette IoU {score:.3%}", font=font, fill="white")
        print(f"Silhouette {view}: {score:.3%}", flush=True)
    output = VIEWS / f"p13-round{number}.jpg"
    sheet.save(output, quality=91)
    (VIEWS / f"p13-round{number}.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(f"OUTPUT {output}", flush=True)
    rolls = [Image.open(WORK / f"caliper-roll-{step}.png").convert("RGBA") for step in (0, 1)]
    if all(rolls):
        pair = Image.new("RGB", (1400, 700), (75, 81, 89))
        for step, image in enumerate(rolls):
            backdrop = Image.new("RGBA", image.size, (75, 81, 89, 255))
            backdrop.alpha_composite(image)
            pair.paste(backdrop.convert("RGB"), (700 * step, 0))
        pair.save(VIEWS / f"p13-{number}-blender-caliper-roll.png")
    if min(results.values()) < .99:
        raise ValueError("A silhouette falls below 99%")


if __name__ == "__main__":
    if sys.argv[1] == "atlas":
        atlas()
    else:
        proof(int(sys.argv[1]))
