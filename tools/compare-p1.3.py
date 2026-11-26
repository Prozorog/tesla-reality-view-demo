"""Pair the four matched phase 1.3 Reality View captures with the user's local reference frames."""
from pathlib import Path
import os

from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
source = Path(os.environ.get("TESLA_REF_DIR", root.parent / "ref"))
shots = root / "shots/p1.3"
font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 23)

for name, reference in (
    ("chase", "park-b-13.jpg"), ("free-bays", "park-b-06.jpg"),
    ("overhead", "park-b-17.jpg"), ("reverse", "park-a-08.jpg"),
):
    sheet = Image.new("RGB", (2576, 769), "#14171c")
    caption = ImageDraw.Draw(sheet)
    for kind, file, x in (("Reference", source / reference, 0), ("Phase 1.3", shots / f"{name}.jpg", 1296)):
        with Image.open(file) as frame:
            frame.thumbnail((1280, 720), Image.Resampling.LANCZOS)
            sheet.paste(frame.convert("RGB"), (x + (1280 - frame.width) // 2, 49))
        caption.text((x + 14, 12), f"{kind}  ·  {file.name}", font=font, fill="white")
    output = shots / f"compare-{name}.jpg"
    sheet.save(output, quality=93, subsampling=0)
    print(output)
