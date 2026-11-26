"""Rasterise the evaluated Blender triangles and composite the visible 3D feature lines."""
import json, sys
import numpy as np
from PIL import Image, ImageDraw
from reference import ROOT, photo, mask, VIEWS
from pathlib import Path
rnd=int(sys.argv[1]); prefix='round'+str(rnd)
source=ROOT/'tmp/model-x'/prefix
out=ROOT/'renders/x';out.mkdir(parents=True,exist_ok=True)
geo=np.load(source/'geometry.npz')
cams=json.loads(Path(__file__).with_name('cameras.json').read_text())
lines=json.loads((source/'features.json').read_text())
results={};sheet=Image.new('RGB',(2752,3072))
for idx,view in enumerate(VIEWS):
    c=cams[view];d=geo['vertices']-c['location']
    scale=-c['focal_px']/(d@c['back'])
    points=np.column_stack([c['cx']+scale*(d@c['right']),c['cy']-scale*c['aspect']*(d@c['up'])])
    silhouette=Image.new('1',(1376,768));draw=ImageDraw.Draw(silhouette)
    for tri in points[geo['triangles']].round().astype(int).reshape(-1,6).tolist():draw.polygon(tri,fill=1)
    target=mask(view); actual=np.asarray(silhouette)
    difference=np.zeros((768,1376,3),np.uint8)
    difference[actual & target]=[110,110,110];difference[actual & ~target]=[255,108,61];difference[target & ~actual]=[0,200,244]
    check=Image.fromarray(difference);check.thumbnail((688,384));check.save(source/(view+'-mask.png'))
    results[view]=round(float(100*np.count_nonzero(actual & target)/np.count_nonzero(actual | target)),3)
    ref=photo(view);colour=ref.copy();draw=ImageDraw.Draw(colour)
    if (source/'visible-regions.npz').exists():
        from scipy.ndimage import maximum_filter,minimum_filter
        ids=np.load(source/'visible-regions.npz')[view]
        edges=(maximum_filter(ids,2)!=minimum_filter(ids,2))
        outline=Image.fromarray(edges).resize(ref.size,Image.Resampling.NEAREST)
        outline.save(source/(view+'-material-edges.png'))
        colour.paste((0,245,224),(0,0,1376,768),outline)
    for stroke in lines[view]:draw.line([tuple(p) for p in stroke],fill=(0,245,224),width=3)
    Image.blend(ref,colour,.5).save(out/f'{prefix}-overlay-{view}.jpg',quality=94)
    sheet.paste(ref,(0,idx*768));sheet.paste(Image.open(source/(view+'.jpg')),(1376,idx*768))
sheet.save(out/(prefix+'-sheet.jpg'),quality=93)
sheet.thumbnail((1100,1228));sheet.save(source/'review.jpg',quality=92)
(out/(prefix+'-iou.json')).write_text(json.dumps(results,indent=2)+'\n',encoding='utf8')
print(results,out/(prefix+'-sheet.jpg'))

