"""Phase 1.6 sheets: the cruise strip beside clip B b01-b06, and the four cloud shots with their numbers."""
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
shots = root / "shots/p1.6"
ref = Path(os.environ.get("TESLA_REF_DIR", root.parent / "ref"))
font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 22)

# Cruise strip: six chase frames, one every 2 s, beside b01-b06.
cell = (640, 400)
sheet = Image.new("RGB", (2 * cell[0] + 24, 6 * (cell[1] + 40) + 8), "#14171c")
draw = ImageDraw.Draw(sheet)
samples = json.loads((shots / "selfdrive-120.json").read_text(encoding="utf8"))["summary"]
for i in range(6):
    y = 8 + i * (cell[1] + 40)
    for x, file, label in ((0, ref / f"park-b-0{i + 1}.jpg", f"Reference · park-b-0{i + 1}.jpg"),
                           (cell[0] + 24, shots / "strip" / f"cruise-{i}.png", f"Phase 1.6 · cruise +{4 + 2 * i} s")):
        with Image.open(file) as frame:
            frame = frame.convert("RGB")
            frame.thumbnail(cell, Image.Resampling.LANCZOS)
            sheet.paste(frame, (x + (cell[0] - frame.width) // 2, y + 32))
        draw.text((x + 8, y), label, font=font, fill="white")
sheet.save(shots / "cruise-strip.jpg", quality=90)
print(shots / "cruise-strip.jpg", f"mean {samples['meanSpeedMph']:.2f} mph, max {samples['maxSpeedMph']:.2f} mph")

# Cloud shots with the measured numbers printed on them.
numbers = json.loads((shots / "cloud-numbers.json").read_text(encoding="utf8"))
for name, n in numbers.items():
    with Image.open(shots / f"cloud-{name}.png") as frame:
        frame = frame.convert("RGB")
    d = ImageDraw.Draw(frame)
    text = (f"cloud core {n['coreLuma']} vs asphalt {n['asphaltLuma']}  ratio {n['ratio']:.2f}   "
            f"B-R core {n['coreBminusR']:+d} / asphalt {n['asphaltBminusR']:+d}")
    if name == "overhead":
        text += "   (beside sample falls on parked cars)"
    box = d.textbbox((16, 16), text, font=font)
    d.rectangle((box[0] - 8, box[1] - 6, box[2] + 8, box[3] + 6), fill="#000000c0")
    d.text((16, 16), text, font=font, fill="white")
    frame.save(shots / f"cloud-{name}.jpg", quality=92)
    print(shots / f"cloud-{name}.jpg", text)
