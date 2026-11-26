"""Pair the phase 1.6 Reality View captures with the local clip B frames."""
import sys
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
source = Path(os.environ.get("TESLA_REF_DIR", root.parent / "ref"))
shots = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "shots/p1.6"
font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 23)

for name, reference in (("chase", "park-b-13.jpg"), ("free-bays", "park-b-06.jpg"), ("overhead", "park-b-17.jpg")):
    capture = shots / f"{name}.png"
    if not capture.exists():
        continue
    sheet = Image.new("RGB", (2576, 769), "#14171c")
    caption = ImageDraw.Draw(sheet)
    for kind, file, x in (("Reference", source / reference, 0), ("Phase 1.6", capture, 1296)):
        with Image.open(file) as frame:
            frame.thumbnail((1280, 720), Image.Resampling.LANCZOS)
            sheet.paste(frame.convert("RGB"), (x + (1280 - frame.width) // 2, 49))
        caption.text((x + 14, 12), f"{kind}  ·  {file.name}", font=font, fill="white")
    output = shots / f"compare-{name}.jpg"
    sheet.save(output, quality=93, subsampling=0)
    print(output)
