"""Label the four Blender views and assemble the single review JPEG."""
import json
from pathlib import Path
import sys

from PIL import Image, ImageDraw, ImageFont
from catalog import PROJECT, MODELS


def main(folder):
    types = json.loads((MODELS / "cars.json").read_text(encoding="utf-8"))["types"]
    sheet = Image.new("RGB", (1584, 826), "#1b2025")
    draw = ImageDraw.Draw(sheet)
    fonts = Path("C:/Windows/Fonts")
    title = ImageFont.truetype(str(fonts / "segoeui.ttf"), 25)
    bold = ImageFont.truetype(str(fonts / "segoeuib.ttf"), 16)
    small = ImageFont.truetype(str(fonts / "segoeui.ttf"), 15)
    for name, xy in [("lineup", (24, 59)), ("top", (24, 309)),
                     ("variants", (24, 564)), ("night", (888, 564))]:
        with Image.open(folder / (name + ".png")) as im:
            sheet.paste(im, xy)
    ink, muted = "#eef0ed", "#b9c3cb"
    draw.text((24, 13), "Passenger cars", font=title, fill=ink)
    draw.text((1559, 23), "Nine types  /  common scale", anchor="ra", font=small, fill=muted)
    for i, (kind, car) in enumerate(types.items()):
        x = int(24 + (i + .5) * 1536 / 9)
        name = "SUV" if kind == "suv" else kind.capitalize()
        draw.text((x, 235), name, anchor="ma", font=bold, fill=ink)
        draw.text((x, 258), f"{car['length']:.2f} m", anchor="ma", font=small, fill=muted)
    draw.text((24, 284), "Overhead", font=bold, fill=ink)
    draw.line((24, 509, 1560, 509), fill="#41484e")
    draw.text((24, 528), "Sedan paint variants", font=bold, fill=ink)
    draw.text((888, 528), "Headlamps and tail lamps", font=bold, fill=ink)
    for i, variant in enumerate(types["sedan"]["variants"]):
        draw.text((int(24 + (i + .5) * 210), 768), variant["color"].capitalize(),
                  anchor="ma", font=small, fill=ink)
    out = PROJECT / "renders/cars/sheet.jpg"
    out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out, quality=74, optimize=True, subsampling=0)


if __name__ == "__main__":
    main(Path(sys.argv[1]))
