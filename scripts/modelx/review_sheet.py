"""Photo | browser studio sheet in the layout of review-p1.5-now-vs-photos.jpg.
Usage: python scripts/modelx/review_sheet.py <studio-capture-dir> <out.jpg>"""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from reference import photo, VIEWS

src, out = Path(sys.argv[1]), Path(sys.argv[2])
W, H, BAR = 800, 446, 24
sheet = Image.new('RGB', (2 * W, len(VIEWS) * (H + BAR)), (24, 24, 24))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype('arial.ttf', 14)
except OSError:
    font = ImageFont.load_default()
for row, view in enumerate(VIEWS):
    y = row * (H + BAR)
    for col, (label, image) in enumerate([('photo ' + view, photo(view)),
                                         ('browser studio (p1.6) ' + view, Image.open(src / f'studio-{view}.png').convert('RGB'))]):
        draw.text((col * W + 8, y + 5), label, fill=(235, 235, 235), font=font)
        sheet.paste(image.resize((W, H), Image.Resampling.LANCZOS), (col * W, y + BAR))
out.parent.mkdir(parents=True, exist_ok=True)
sheet.save(out, quality=93)
print(out)
