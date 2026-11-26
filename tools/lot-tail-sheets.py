"""Make local phase 1.6.1 proof sheets from the browser captures and clip B."""

import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
import numpy as np


root = Path(__file__).resolve().parents[1]
shots = root / "shots/p1.6.1"
reference = Path(os.environ.get("TESLA_REF_DIR", root.parent / "ref"))
font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 22)
capture = json.loads((shots / "lot-tails.json").read_text(encoding="utf8"))
weights = np.array([0.2126, 0.7152, 0.0722])


def pixels(image, points):
    parts = []
    for point in points:
        x, y = round(point["x"]), round(point["y"])
        if 2 <= x < image.shape[1]-2 and 2 <= y < image.shape[0]-2:
            parts.append(image[y-2:y+3, x-2:x+3].reshape(-1, 3))
    return np.concatenate(parts) if parts else None


def median_luma(image, points):
    sample = pixels(image, points)
    return round(float(np.median(sample @ weights))) if sample is not None else None


def numbers(path, frame):
    with Image.open(path) as source:
        image = np.asarray(source.convert("RGB"), dtype=float)
    core = pixels(image, frame["core"])
    sides = [pixels(image, positions) for positions in frame["sides"]]
    asphalt = min((side for side in sides if side is not None), key=lambda s: np.median(s @ weights))
    core_luma, asphalt_luma = float(np.median(core @ weights)), float(np.median(asphalt @ weights))
    blue = core[:, 2] - core[:, 0]
    core_blue = float(np.median(blue))
    side_blue = float(np.median(asphalt[:, 2] - asphalt[:, 0]))
    edge = (core_blue + side_blue) / 2
    width_points = []
    for distance, point in zip(frame["crossMetres"], frame["cross"], strict=True):
        patch = pixels(image, [point])
        if patch is not None and np.median(patch[:, 2] - patch[:, 0]) > edge:
            width_points.append(distance)
    # Restrict the estimate to the continuous cloud containing its centre.
    first = last = 0.0
    for distance in reversed([value for value in frame["crossMetres"] if value < 0]):
        if distance not in width_points:
            break
        first = distance
    for distance in (value for value in frame["crossMetres"] if value > 0):
        if distance not in width_points:
            break
        last = distance
    width = (last - first) / 2.0 if 0.0 in width_points else 0
    return {**{band: median_luma(image, frame[band]) for band in ("near", "middle", "far")},
            "core": round(core_luma), "asphalt": round(asphalt_luma), "ratio": round(core_luma / max(1, asphalt_luma), 2),
            "BminusR": round(core_blue), "approxWidthInCarWidths": round(width, 2)}


def sheet(name, cells, columns):
    cell_w, cell_h = 680, 430
    rows = (len(cells) + columns - 1) // columns
    output = Image.new("RGB", (columns * cell_w, rows * cell_h), "#141821")
    draw = ImageDraw.Draw(output)
    for i, (path, label) in enumerate(cells):
        x, y = (i % columns) * cell_w, (i // columns) * cell_h
        draw.text((x + 12, y + 9), label, font=font, fill="white")
        with Image.open(path) as source:
            frame = source.convert("RGB")
            frame.thumbnail((cell_w - 14, cell_h - 42), Image.Resampling.LANCZOS)
            output.paste(frame, (x + (cell_w - frame.width) // 2, y + 37))
    output.save(shots / name, quality=93)


cruise_frames = [shots / f"cruise-{i}.png" for i in range(6)]
measurements = [numbers(path, frame) for path, frame in zip(cruise_frames, capture["frames"], strict=True)]
strip = []
for i, frame in enumerate(capture["frames"]):
    strip.extend(((reference / f"park-b-0{i+1}.jpg", f"Clip B · frame {i+1:02d}"),
                  (cruise_frames[i], f"Lot · +{frame['state']['time']:.0f} s · {frame['chevrons']} chevrons")))
sheet("cruise-strip.jpg", strip, 2)
matched = measurements[1]
before = root / "shots/p1.6/strip/cruise-1.png"
comparison = [(reference / "park-b-02.jpg", "b02 · near 137–158 · middle 162 · far 156")]
if before.is_file():
    comparison.append((before, "1.6 · near 85–92 · middle 103 · far 38"))
comparison.append((cruise_frames[1], f"1.6.1 · near {matched['near']} · middle {matched['middle']} · far {matched['far']}"))
sheet("lot-light.jpg", comparison, len(comparison))
sheet("cloud-cruise.jpg", [(reference / "park-b-02.jpg", "b02 · 1.30–1.45 · B−R +34 · about 2 car widths"),
                           (cruise_frames[1], f"1.6.1 · {matched['ratio']:.2f} · B−R {matched['BminusR']:+d} · ~{matched['approxWidthInCarWidths']:.1f} car widths")], 2)
if (shots / "model-x-parked-top.png").exists():
    with Image.open(shots / "model-x-parked-top.png") as frame:
        frame.convert("RGB").save(shots / "model-x-parked-top.jpg", quality=94)
(shots / "lot-tails-measurements.json").write_text(json.dumps(measurements, indent=2), encoding="utf8")
print(json.dumps(measurements, indent=2))
