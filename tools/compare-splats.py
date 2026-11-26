"""Phase 1.4 review sheets. All app columns share a frozen simulation tick at DPR 1."""
from pathlib import Path
import sys
import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
references = Path(os.environ.get("TESLA_REF_DIR", root.parent / "ref"))
src = root / (sys.argv[1] if len(sys.argv)>1 else "tmp/p14-captures")
dst = root / "shots/p1.4"
dst.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 22)
def sheet(path, columns):
    width, height = columns[0][1].size
    out = Image.new("RGB", ((width+8)*len(columns)-8, height+44), "#15171b")
    draw = ImageDraw.Draw(out)
    for i,(label,im) in enumerate(columns):
        x = (width+8)*i
        draw.text((x+10,6),label,font=font,fill="white")
        out.paste(im.convert("RGB"),(x,44))
    out.save(dst / path, **({"quality":94,"subsampling":0} if path.endswith(".jpg") else {}))

modes = [("Mesh","mesh"),("Splat","splat"),("Splat + mesh cars","hybrid")]
for name, ref in [("free-bays","06"),("chase","13"),("overhead","17"),("seat",None)]:
    columns = []
    if ref:
        frame = Image.open(references / f"park-b-{ref}.jpg")
        columns.append((f"Clip B  ·  frame {ref}",frame.resize((1280,720),Image.Resampling.LANCZOS)))
    columns += [(label,Image.open(src/f"{mode}-{name}.png")) for label,mode in modes]
    sheet(f"compare-{name}.jpg",columns)
for label,name,box in [
    ("near-car","overhead",(345,200,587,433)), ("tree","free-bays",(406,94,567,171)),
    ("storefront","free-bays",(803,30,1278,268)), ("horizon","free-bays",(170,25,740,151))]:
    sheet(f"crops-{label}.png",[(l,Image.open(src/f"{m}-{name}.png").crop(box)) for l,m in modes[:2]])

ys = np.arange(380,437)
xs = (136+(ys-359)*.335).astype(int)
for mode in ["mesh","splat"]:
    free = np.asarray(Image.open(src/f"{mode}-free-bays.png"))
    chase = np.asarray(Image.open(src/f"{mode}-chase.png"))
    print(mode, {tag:np.median(sample.reshape(-1,3),axis=0).tolist() for tag,sample in [
        ("wall",free[83:126,1090:1122,:3]),("crown",free[128:145,441:456,:3]),("column",chase[ys,xs,:3])]})
