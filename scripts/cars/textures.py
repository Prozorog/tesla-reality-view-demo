"""Prepare the pack's atlases with the system Python, Pillow and NumPy."""
import numpy as np
from PIL import Image

from catalog import CARS, PALETTE, TEXTURES, WORK, texture_prefix

SRC = WORK / "textures"


def load(name, size, mode):
    with Image.open(SRC / name) as image:
        return image.convert(mode).resize((size, size), Image.Resampling.BOX)


def save_rgb(pixels, name, quality=87):
    image = Image.fromarray(np.clip(pixels.round(), 0, 255).astype("uint8"))
    image.save(TEXTURES / name, quality=quality, subsampling=0, optimize=True)


def channels(prefix, size):
    return [np.asarray(load(f"{prefix}_{suffix}.png", size, "L"), dtype="float32")
            for suffix in ("Metallic", "Glossiness")]


def save_mr(prefix, metal, rough):
    # Lossless linear data, glTF convention. Both slots reference this one file.
    pixels = np.stack((np.full_like(rough, 255), rough, metal), axis=-1)
    image = Image.fromarray(np.clip(pixels.round(), 0, 255).astype("uint8"))
    image.save(TEXTURES / f"{prefix}_mr.webp", lossless=True, method=4)


def paint_coverage(metal, gloss):
    # Infer the paint fraction on antialiased boundaries between any two
    # authored finishes, e.g. half enamel / half rubber = M46.5, gloss148.5.
    best = np.full_like(metal, np.inf)
    coverage = np.zeros_like(metal)
    for m, g in ((93, 69), (49, 255), (255, 255), (255, 0), (0, 178), (115, 103)):
        dg = g - 228
        other = np.clip((metal * m + (gloss - 228) * dg) / (m*m + dg*dg), 0, 1)
        residual = (metal - other*m)**2 + (gloss - 228 - other*dg)**2
        closer = residual < best
        coverage[closer] = 1 - other[closer]
        best = np.minimum(best, residual)
    return coverage


def body_atlases(kind, diffuse, variants):
    src = load(diffuse + ".png", 1024, "RGB")
    rgb = np.asarray(src, dtype="float32")
    hsv = np.asarray(src.convert("HSV"), dtype="float32")
    metal, gloss = channels(texture_prefix(kind), 1024)
    enamel = paint_coverage(metal, gloss)
    core = enamel > .95
    value = hsv[:, :, 2]
    undercoat = rgb
    if kind == "suv":
        mask = enamel  # achromatic black, distinguished from trim by its PBR maps
    else:
        hue, sat = hsv[:, :, 0], hsv[:, :, 1]
        # Use the most saturated paint samples. Circular distance handles red at 0.
        peak = np.argmax(np.bincount(hue[core & (sat > 45)].astype(int), minlength=256))
        distance = abs((hue - peak + 128) % 256 - 128)
        chroma = np.clip((42 - distance) / 20, 0, 1) * np.clip((sat - 6) / 32, 0, 1)
        mask = chroma * enamel
        # The source diffuse already mixes body colour into boundary texels.
        # Recover their neutral component before blending in the new enamel.
        neutral = rgb.min(axis=2, keepdims=True)
        undercoat = rgb + (neutral - rgb) * chroma[:, :, None]
    reference = np.percentile(value[core & (mask > .8)], 87)
    # Keep the original AO, panel lines, and gradients, including the clipped
    # cyan/yellow highlights whose detail survives in the other colour channels.
    lightness = rgb @ np.array([.2126, .7152, .0722], dtype="float32")
    luma_reference = np.percentile(lightness[core & (mask > .8)], 87)
    shade = (.42 * value / reference + .58 * lightness / luma_reference) ** .78
    shade = np.minimum(shade, 1.12)
    for color in variants:
        target = np.array(tuple(bytes.fromhex(PALETTE[color])), dtype="float32")
        repaint = target * shade[:, :, None]
        out = undercoat + (repaint - undercoat) * mask[:, :, None]
        save_rgb(out, f"{kind}_{color}.jpg")
    save_mr(kind, metal, (255 - gloss) * (1 - .16 * mask))


def main():
    TEXTURES.mkdir(parents=True, exist_ok=True)
    for kind, (_, diffuse, _, variants) in CARS.items():
        body_atlases(kind, diffuse, variants)
    for wheel in sorted({car[2] for car in CARS.values()}):
        rgb = np.asarray(load(wheel + "_Diffuse.png", 512, "RGB"), dtype="float32")
        save_rgb(.90 * rgb + .10 * rgb.mean(axis=2, keepdims=True), wheel.lower() + ".jpg")
        metal, gloss = channels(wheel, 512)
        save_mr(wheel.lower(), metal, 255 - gloss)
    # Retain the ribs and reflector patterns in both the unlit and lit lenses.
    lenses = np.asarray(load("lights.jpg", 512, "RGB"), dtype="float32")
    save_rgb(lenses * [.77, .75, .72], "lenses.jpg", 90)
    brightness = lenses.max(axis=2) / 255
    save_rgb(255 * (.20 + .80 * brightness ** .65), "lens_emission.jpg", 88)
    print(f"Repainted {sum(len(car[3]) for car in CARS.values())} variants in {TEXTURES}")


if __name__ == "__main__":
    main()
