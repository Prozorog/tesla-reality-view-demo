"""Pair the reference and matching QA camera, then the orbit and aisle views."""
import sys
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps

sys.dont_write_bytecode=True
from layout import RENDERS, ROOT, WORK


def main(number):
    for label in ("overhead","turned","chase"):
        with Image.open(WORK/(label+".png")) as f:
            f.convert("RGB").save(RENDERS/(label+".jpg"),quality=74)
    reference=Path(os.environ.get("TESLA_REF_DIR", ROOT.parent / "ref")) / "park-a-04.jpg"
    panels=[(RENDERS/"overhead.jpg","BAKED LOT","Parking view / 14 m"),
            (reference,"CLIP A","park-a-04 / reference"),
            (RENDERS/"turned.jpg","ORBIT","40° turn / 60° elevation"),
            (RENDERS/"chase.jpg","CHASE","North arcade / 5 m")]
    sheet=Image.new("RGB",(1600,1040),"#171a1f")
    draw=ImageDraw.Draw(sheet)
    fonts=Path("C:/Windows/Fonts")
    title=ImageFont.truetype(str(fonts/"arialbd.ttf"),19)
    body=ImageFont.truetype(str(fonts/"arial.ttf"),16)
    for i,(path,label,detail) in enumerate(panels):
        x,y=(i%2)*800,(i//2)*520
        with Image.open(path) as src:
            frame=ImageOps.fit(src.convert("RGB"),(792,470),method=Image.Resampling.LANCZOS)
            sheet.paste(frame,(x+4,y+4))
        draw.text((x+14,y+486),label,font=title,fill="#eae7de")
        draw.text((x+780,y+488),detail,font=body,fill="#b7bdc3",anchor="ra")
    sheet.save(RENDERS/f"round{number}.jpg",quality=72,subsampling=0)


if __name__=="__main__":
    main(int(sys.argv[1]))
