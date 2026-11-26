"""Measure distances from independently picked photographic lines to visible model lines."""
from pathlib import Path
import json, sys
import numpy as np
from scipy.ndimage import distance_transform_edt
from PIL import Image, ImageDraw
from reference import ROOT
rnd=int(sys.argv[1])
features={
'side':{
'window waist':[(235,264),(275,279),(405,294),(603,307),(820,317),(1005,325)],
'window header':[(238,244),(282,225),(344,205),(411,191),(487,184),(575,180),(649,181),(729,192),(815,215),(888,251),(973,295),(1009,324)],
'front wheel moulding':[(979,533),(985,486),(1000,452),(1027,421),(1063,400),(1106,392),(1148,398),(1187,418),(1215,448),(1234,488),(1240,537)],
'falcon door front cut':[(642,310),(644,351),(649,404),(656,464),(661,526)],
'front door leading cut':[(965,325),(973,351),(977,393),(975,464),(970,532)]},
'front':{
'left lamp perimeter':[(377,355),(391,356),(436,367),(479,381),(509,399),(474,418),(445,416),(392,408),(378,402),(375,387),(377,355)],
'windscreen foot':[(439,269),(515,268),(691,267),(850,269),(953,270)],
'valance upper edge':[(366,563),(406,576),(492,589),(530,554),(564,546),(693,545),(829,546),(853,554),(896,588),(979,580),(1019,568)]},
'rear':{
'tailgate cut':[(453,298),(453,345),(456,386),(464,438),(472,458),(488,469),(539,473),(691,476),(855,473),(898,468),(911,453),(922,405),(927,372),(930,296)],
'tailgate chrome':[(491,350),(513,339),(558,335),(691,333),(837,336),(877,341),(893,350)],
'left tail lamp':[(393,382),(398,350),(405,328),(416,321),(440,317),(474,317),(505,322),(517,331),(536,367),(492,369),(471,372),(456,386),(408,385)]},
'top':{
'windscreen cowl':[(407,210),(398,235),(387,286),(380,344),(377,402),(382,457),(391,509),(405,551)],
'panoramic trailing edge':[(753,225),(753,294),(752,382),(752,462),(751,517)],
'near falcon hinge':[(788,514),(787,475),(786,415),(791,404),(841,403),(931,402),(997,402),(1004,408),(1003,502)]}}
strokes=json.loads((ROOT/f'tmp/model-x/round{rnd}/features.json').read_text())
results={}
for view,items in features.items():
    im=Image.new('1',(1376,768));d=ImageDraw.Draw(im)
    for line in strokes[view]:d.line([tuple(p) for p in line],fill=1)
    boundary=ROOT/f'tmp/model-x/round{rnd}/{view}-material-edges.png'
    if boundary.exists():im.paste(1,(0,0,1376,768),Image.open(boundary))
    dist=distance_transform_edt(~np.asarray(im))
    results[view]={}
    for name,pts in items.items():
        sample=Image.new('1',im.size);ImageDraw.Draw(sample).line(pts,fill=1)
        values=dist[np.asarray(sample)]
        results[view][name]=[round(float(np.median(values)),1),round(float(np.percentile(values,95)),1)]
target=ROOT/f'renders/x/round{rnd}-feature-errors.json'
target.write_text(json.dumps(results,indent=2)+'\n',encoding='utf8')
print(results)

