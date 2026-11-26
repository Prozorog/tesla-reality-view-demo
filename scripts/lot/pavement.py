"""Rasterize the surveyed markings and seeded pavement layers into shipping PBR maps."""
import math
import random
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.dont_write_bytecode = True
from layout import TEXTURES, ground_bounds, local, read, tile_info


def shop_glass(seed):
    """Seven contiguous shop/vestibule panels. Geometry supplies the outer frames."""
    rng=random.Random(seed+73)
    sheets=Image.new("RGB",(3584,512))
    for tile in range(4):
        y,x=np.mgrid[:512,:512]
        glow=np.maximum(0,1-np.hypot((x-(170+tile*53))/570,(y-165)/500))
        shade=.44+.65*glow+.04*np.sin(y/39)
        hue=np.array([(185,142,97),(135,159,155),(182,157,128),(158,133,119)][tile])
        room=Image.fromarray((shade[:,:,None]*hue).clip(0,255).astype("uint8"))
        p=ImageDraw.Draw(room)
        # Back-wall bays, ceiling coffers and stepped aisles behind the shop glass.
        for xx in range(-100,650,93):
            p.line([(xx,0),((xx+230)//2,105)],fill=(94,81,73),width=3)
        for yy in (28,66,94):
            p.line([(0,yy),(511,yy)],fill=(134,118,98),width=2)
        for xx in (50,255,458):
            p.line([(xx,0),(xx,53)],fill=(76,66,57),width=2)
            p.polygon([(xx-12,60),(xx-4,51),(xx+4,51),(xx+12,60)],fill=(70,65,60))
            p.line([(xx-10,61),(xx+10,61)],fill=(251,220,168),width=3)
        for rack in (range(3) if tile in (0,2) else range(0)):
            left=13+rack*174+rng.randint(-7,6)
            top=rng.randint(135,185)
            p.rectangle([left,top,left+144,409],fill=(91+tile*5,80+tile*4,66+tile*3))
            for yy in range(top+38,410,44):
                cursor=left+6
                while cursor<left+134:
                    width=rng.randint(5,19)
                    height=rng.randint(10,31)
                    col=rng.choice([(118,96,75),(151,126,92),(152,140,114),(134,99,86),(92,114,104),(108,110,106)])
                    p.rectangle([cursor,yy-height,min(cursor+width,left+138),yy-2],fill=col)
                    if width>10:
                        p.line([(cursor+2,yy-6),(cursor+width-2,yy-6)],fill=(163,149,117))
                    cursor+=width+3
                p.rectangle([left,yy,left+144,yy+4],fill=(61,57,53))
                p.line([(left,yy),(left+144,yy)],fill=(182,157,118))
        if tile==1:
            # Oriel's cooler gallery: framed art, plants, a reading chair and side table.
            for left in (45,165,320):
                p.rectangle((left,126,left+89,239),fill=(82,89,78))
                p.rectangle((left+5,131,left+84,234),fill=(174,162,132))
                p.ellipse((left+17,150,left+68,204),fill=(128,121,96))
                p.arc((left+23,160,left+77,219),58,270,fill=(93,105,94),width=4)
            p.rounded_rectangle((181,292,308,365),14,fill=(111,104,88))
            p.rounded_rectangle((172,341,313,389),12,fill=(128,111,91))
            for xx in (186,292):
                p.line((xx,384,xx-3,424),fill=(74,69,60),width=5)
            p.rectangle((363,343,439,350),fill=(97,87,73))
            p.line((399,350,399,415),fill=(91,81,66),width=6)
            p.polygon([(66,363),(126,363),(118,425),(77,425)],fill=(145,121,90))
            for _ in range(23):
                ex,ey=rng.randint(41,147),rng.randint(242,337)
                p.line((96,365,ex,ey),fill=(79,86,60),width=3)
                p.ellipse((ex-8,ey-10,ex+9,ey+4),fill=rng.choice([(74,90,66),(97,109,77),(116,122,88)]))
        if tile==3:
            # Clothing rail, folded stock and a linen curtain in the neighbouring unit.
            for xx in range(325,512,11):
                p.rectangle((xx,81,xx+6,421),fill=(130+(xx%8),113,96))
            p.rectangle((22,170,292,177),fill=(91,85,74))
            for xx in range(40,281,26):
                col=rng.choice([(131,98,88),(144,128,99),(86,100,99),(161,146,114)])
                p.line((xx,175,xx+3,197),fill=(91,78,65),width=2)
                p.polygon([(xx,194),(xx+11,199),(xx+18,223),(xx+13,229),(xx+10,224),
                           (xx+13,292),(xx-12,292),(xx-9,224),(xx-16,232),(xx-20,223),(xx-12,201)],fill=col)
            p.rectangle((84,345,302,370),fill=(143,122,96))
            for xx in (89,290):
                p.rectangle((xx,370,xx+7,424),fill=(94,84,73))
        # Glazing darkens the foot of the display and catches broad diagonal reflections.
        a=np.asarray(room.filter(ImageFilter.GaussianBlur(1.1))).astype("float32")
        reflection=np.clip(1-abs(x+y*.52-350)/57,0,1)*.11
        a=a*(1-reflection[:,:,None])+np.array((119,149,161))*reflection[:,:,None]
        a*=np.clip(1-(y/512)**3*.40,.6,1)[:,:,None]
        sheets.paste(Image.fromarray(a.clip(0,255).astype("uint8")),(tile*512,0))
    for tile in range(4,7):
        # One-point perspective, with recessed ceiling lights and floor joints.
        # The entrance uses one continuous room across both sliding door leaves.
        room=Image.new("RGB",(512,512),[(192,148,111),(144,111,94),(122,145,139)][tile-4])
        p=ImageDraw.Draw(room)
        p.polygon([(0,0),(512,0),(423,114),(103,114)],fill=(161,144,120))
        p.polygon([(0,512),(512,512),(423,315),(103,315)],fill=(174,151,124))
        p.polygon([(0,0),(103,114),(103,315),(0,512)],fill=(144,124,111))
        p.polygon([(512,0),(423,114),(423,315),(512,512)],fill=(133,117,102))
        for yy in (333,361,413,487):
            p.line((0,yy,512,yy),fill=(143,128,110),width=2)
        for xx in range(-300,900,135):
            p.line((xx,512,247+(xx-247)*.35,315),fill=(136,122,109),width=2)
        for xx in (96,260,421):
            p.polygon([(xx-25,24),(xx+25,24),(xx+21,42),(xx-16,42)],fill=(255,239,204))
            p.rectangle((205+(xx-205)*.65,86,230+(xx-205)*.65,94),fill=(245,222,183))
        if tile==4:
            p.rectangle((123,116,393,315),fill=(99,90,82))
            p.rectangle((131,126,385,307),fill=(211,184,144))
            for xx in (131,254,378):
                p.rectangle((xx,125,xx+6,308),fill=(76,74,68))
            p.rectangle((132,165,384,170),fill=(87,83,71))
            p.rectangle((228,104,283,112),fill=(148,205,167))
            p.polygon([(177,352),(341,352),(384,412),(137,412)],fill=(98,91,84))
        elif tile==5:
            # The florist's staggered terracotta pots below its tall-cut stems.
            for xx in (88,141,257,328,405):
                yy=rng.randint(298,366)
                p.polygon([(xx-17,yy-39),(xx+17,yy-39),(xx+12,yy),(xx-13,yy)],fill=(142,87,66))
                for _ in range(16):
                    ex,ey=xx+rng.randint(-29,29),yy-rng.randint(54,115)
                    p.line((xx,yy-36,ex,ey),fill=(75,87,66),width=3)
                    p.ellipse((ex-5,ey-6,ex+6,ey+4),fill=rng.choice([(177,113,104),(214,174,138),(118,132,95)]))
        else:
            # Two wall-mounted packs above an oak gear bench in the outfitter.
            for xx,colour in ((185,(92,112,103)),(324,(149,109,79))):
                p.rounded_rectangle((xx-34,167,xx+33,254),radius=15,fill=colour)
                p.rounded_rectangle((xx-24,209,xx+23,243),radius=8,outline=(63,69,63),width=3)
                p.arc((xx-10,154,xx+10,178),180,360,fill=(83,77,70),width=4)
            p.rectangle((108,293,402,307),fill=(160,131,98))
            for xx in (120,378):
                p.rectangle((xx,307,xx+8,346),fill=(71,75,69))
        sheets.paste(room.filter(ImageFilter.GaussianBlur(.8)),(tile*512,0))
    sheets.save(TEXTURES/"shop_glass.jpg",quality=90)


def leaf_alpha(seed):
    """Coverage masks for the crown cards and the distant tree line (white = leaf)."""
    rng=random.Random(seed+911)
    size=512
    big=Image.new("L",(size*2,size*2))
    p=ImageDraw.Draw(big)
    c=size
    # A dense cluster of overlapping leaves; sparser, serrated toward the rim.
    for _ in range(1100):
        r=c*.92*rng.random()**.55
        a=rng.uniform(0,math.tau)
        x,y=c+r*math.cos(a),c+r*math.sin(a)
        length=rng.uniform(46,92)*(1.05-.35*r/c)
        width=length*rng.uniform(.36,.52)
        t=a+rng.uniform(-.9,.9)
        pts=[]
        for k in range(14):
            u=k/13*math.pi
            along=-math.cos(u)*length/2
            across=math.sin(u)*width/2
            pts.append((x+along*math.cos(t)-across*math.sin(t),y+along*math.sin(t)+across*math.cos(t)))
        for k in range(14):
            u=math.pi+k/13*math.pi
            along=-math.cos(u)*length/2
            across=math.sin(u)*width/2
            pts.append((x+along*math.cos(t)-across*math.sin(t),y+along*math.sin(t)+across*math.cos(t)))
        p.polygon(pts,fill=255)
    for _ in range(26):
        # Small gaps let the lamp light through the crown.
        r=c*.8*rng.random()**.5
        a=rng.uniform(0,math.tau)
        x,y=c+r*math.cos(a),c+r*math.sin(a)
        s=rng.uniform(6,16)
        p.ellipse((x-s,y-s,x+s,y+s),fill=0)
    # Solid corner block: bark and branches clamp to it at every useful mip level.
    p.rectangle((0,0,127,127),fill=255)
    big.resize((size,size),Image.Resampling.LANCZOS).save(TEXTURES/"leaf_cluster.png")
    # Tree line: solid foot and an uneven, continuous canopy edge of rounded crowns.
    w,h=1024,256
    line=Image.new("L",(w*2,h*2))
    p=ImageDraw.Draw(line)
    waves=[(rng.uniform(.004,.02),rng.uniform(0,math.tau),rng.uniform(.02,.06)) for _ in range(5)]
    x=0
    while x<w*2:
        # Periodic in x so the strip tiles along the ring.
        top=h*2*(.36+sum(a*math.sin(2*math.pi*round(f*w*2/(2*math.pi))*x/(w*2)+ph) for f,ph,a in waves))
        rad=rng.uniform(22,58)
        top+=rng.uniform(-70,25)
        p.ellipse((x-rad,top,x+rad,top+2*rad),fill=255)
        for _ in range(6):
            a=rng.uniform(math.pi*1.1,math.pi*1.9)
            bx,by=x+rad*math.cos(a),top+rad+rad*math.sin(a)
            r2=rng.uniform(6,14)
            p.ellipse((bx-r2,by-r2,bx+r2,by+r2),fill=255)
        p.rectangle((x-rad,top+rad,x+rad,h*2),fill=255)
        x+=rng.uniform(.8,1.5)*rad
    line.resize((w,h),Image.Resampling.LANCZOS).save(TEXTURES/"treeline.png")


def night_horizon():
    # sRGB sky at the skirt's physical heights, interpolated with no hard bands.
    heights=(-8,0,3,8,17,30,52,80)
    colors=[(5,6,7),(11,10,11),(13,11,13),(10,9,12),
            (7,6,9),(5,5,7),(3,4,6),(2,3,5)]
    ys=np.linspace(80,-8,256)
    strip=np.stack([np.interp(ys,heights,c) for c in zip(*colors)],axis=-1)
    strip=np.broadcast_to(strip[:,None],(256,16,3))
    Image.fromarray(np.rint(strip).astype("uint8")).save(TEXTURES/"night_horizon.png")


def bake(lot):
    tiles = list(tile_info(lot))
    _, _, _, tw, th, _ = tiles[0]
    w, h = tw*2+4, th*2+4
    x0, z0, x1, z1 = ground_bounds(lot)
    sx, sz = tw*2/(x1-x0), th*2/(z1-z0)
    rng = random.Random(lot["seed"])
    noise = np.random.default_rng(lot["seed"])

    def xy(p):
        return (round(2+(p[0]-x0)*sx), round(2+(p[1]-z0)*sz))

    def field(n):
        small = noise.integers(0, 256, (max(2,round(n*h/w)), n), dtype=np.uint8)
        return np.asarray(Image.fromarray(small).resize((w,h),Image.Resampling.BICUBIC)).astype("float32")/255

    # Oxidised binder, aggregate, resurfacing rectangles, drainage scars and crack seal.
    grit = noise.normal(0, 3.0, (h,w)).astype("float32")
    # Asphalt 02 by Rob Tuytel, Poly Haven, CC0. Two world scales and a
    # staggered second orientation keep aggregate and cracks from repeating.
    sources = Path(__file__).with_name("sources")
    photo = np.asarray(Image.open(sources/"asphalt_02_diff_2k.jpg").convert("L"), dtype="float32")
    photo_rough = np.asarray(Image.open(sources/"asphalt_02_rough_2k.jpg").convert("L"), dtype="float32")
    row, col = np.ogrid[:h,:w]
    def tile(image, metres, rotate=False):
        n = image.shape[0]
        if rotate:
            u, v = row/(sz*metres)+.33, -col/(sx*metres)+.62
        else:
            u, v = col/(sx*metres), row/(sz*metres)
        return image[np.floor(v*n).astype("int32") % n, np.floor(u*n).astype("int32") % n]
    small = tile(photo, 3.1) - np.median(photo)
    large = tile(photo, 8.65, True) - np.median(photo)
    mix = .33 + .40*field(15)
    # Clip B reads as an even, light grey surface. Keep the aggregate and the
    # large-scale weathering, at a lower amplitude than the raw photograph.
    stone = 97 + .52*(mix*small + (1-mix)*large) + 13*(field(19)-.5) + .7*grit
    repairs = Image.new("L",(w,h),128)
    sketch = ImageDraw.Draw(repairs)
    for _ in range(round((x1-x0)*(z1-z0)/143)):
        x,z = rng.uniform(x0,x1),rng.uniform(z0,z1)
        width,length = rng.uniform(1.5,6.5),rng.uniform(2.1,10)
        skew = rng.uniform(-.25,.25)
        # Cold patches retain the saw cut, with broken corners and slightly fretted seams.
        poly = [(x+.21,z),(x+width*.52,z+.045),(x+width-.09,z+skew),
                (x+width,z+skew+.14),(x+width+.03,z+length*.55),
                (x+width+.06,z+length-.12),(x+width-.13,z+length),
                (x-.04,z+length+.06),(x+.03,z+.27)]
        sketch.polygon([xy(p) for p in poly],fill=rng.randint(103,120))
        sketch.line([xy(p) for p in poly+[poly[0]]],fill=rng.randint(103,119),width=1)
    for _ in range(round((x1-x0)*(z1-z0)/40)):
        x,z = rng.uniform(x0,x1),rng.uniform(z0,z1)
        a = rng.uniform(0,math.tau)
        path = []
        for _ in range(rng.randint(5,35)):
            path.append(xy((x,z)))
            a += rng.uniform(-.53,.53)
            step = rng.uniform(.09,.30)
            x += math.cos(a)*step
            z += math.sin(a)*step
        sketch.line(path,fill=rng.randint(75,102),width=rng.choice([1,1,2]))
        if len(path)>12:
            bx,bz=path[len(path)//2]
            sketch.line([(bx,bz),(bx+4,bz-5),(bx+6,bz-13),(bx+11,bz-18)],fill=107,width=1)
    # Older sealed cracks run across multiple stalls and the drive aisles.
    for _ in range(47):
        x,z=rng.uniform(x0+2,x1-2),rng.uniform(z0+2,z1-2)
        angle=rng.uniform(0,math.tau)
        route=[(x,z)]
        for _ in range(rng.randint(9,28)):
            span=rng.uniform(.13,.66)
            angle+=rng.uniform(-.40,.40)
            x,z=x+span*math.cos(angle),z+span*math.sin(angle)
            route.append((x,z))
        coords=[xy(p) for p in route]
        sketch.line(coords,fill=107,width=3,joint="curve")
        sketch.line(coords,fill=61,width=2,joint="curve")
        j=len(route)//2
        x,z=route[j]
        branch=[(x,z),(x+.43,z+.56),(x+.99,z+.80),(x+1.22,z+1.45)]
        sketch.line([xy(p) for p in branch],fill=86,width=1)
    stone += .62*(np.asarray(repairs).astype("float32")-128)

    oil = Image.new("L",(w,h))
    s = ImageDraw.Draw(oil)
    for b in lot["bays"]:
        if rng.random()<.17:
            continue
        pos = local(b["center"], b["heading"],rng.uniform(-1.15,1.15),rng.uniform(-.24,.24))
        for _ in range(rng.randint(3,9)):
            a = rng.uniform(.04,.32)
            c = local(pos,b["heading"],rng.gauss(0,.32),rng.gauss(0,.14))
            pts = [local(c,b["heading"],a*math.cos(t)*rng.uniform(.75,1.3),
                         a*math.sin(t)*rng.uniform(.5,.95)) for t in np.arange(0,math.tau,.36)]
            s.polygon([xy(p) for p in pts],fill=rng.randint(55,192))
    stain = np.asarray(oil.filter(ImageFilter.GaussianBlur(1.8))).astype("float32")/255
    stone -= 29*stain
    paint = Image.new("L",(w,h))
    blue = Image.new("L",(w,h))
    pen = ImageDraw.Draw(paint)
    bpen = ImageDraw.Draw(blue)

    def line(draw, points, width=.085, value=255):
        draw.line([xy(p) for p in points], fill=value,width=max(1,round(sx*width)),joint="curve")

    for b in lot["bays"]:
        length, side = b["depth"]/2, b["width"]/2
        def p(a,v):
            return local(b["center"],b["heading"],a,v)
        for v in (-side,side):
            line(pen,[p(length,v),p(-length,v)],.093)
        if b["kind"] in ("straight","accessible","corral"):
            line(pen,[p(-length,-side),p(-length,side)],.085)
        if b["kind"]=="accessible":
            bpen.polygon([xy(p(a,v)) for a,v in [(1,1),(-1,1),(-1,-1),(1,-1)]],fill=245)
            # International Symbol of Access, arranged upright along the bay.
            def symbol(u,v):
                return p(v,-u)
            pts=[symbol(-.15+.37*math.cos(t),-.26+.37*math.sin(t)) for t in np.linspace(1.8,6.4,28)]
            line(pen,pts,.10)
            line(pen,[symbol(-.19,.36),symbol(-.13,-.05),symbol(.22,-.05),
                      symbol(.39,-.36),symbol(.55,-.28)],.12)
            line(pen,[symbol(-.14,.18),symbol(.17,.18)],.085)
            pen.polygon([xy(symbol(-.24+.14*math.cos(t),.57+.14*math.sin(t))) for t in np.linspace(0,math.tau,18)],fill=255)
    for hatch in lot["hatches"]:
        poly=hatch["outline"]
        line(pen,poly+[poly[0]],.085)
        # Intersect x-z=c with the supplied polygon, including skewed row ends.
        cs=[p[0]-p[1] for p in poly]
        for c in np.arange(min(cs)+.3,max(cs),.59):
            ends=[]
            for i,a in enumerate(poly):
                b=poly[(i+1)%len(poly)]
                ca,cb=a[0]-a[1],b[0]-b[1]
                if min(ca,cb)<=c<max(ca,cb):
                    t=(c-ca)/(cb-ca)
                    ends.append((a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t))
            if len(ends)==2:
                line(pen,ends,.075)
    for ar in lot["arrows"]:
        points=[(-1.12,-.10),(.34,-.10),(.10,-.40),(.28,-.44),(1.10,0),
                (.28,.44),(.10,.40),(.34,.10),(-1.12,.10)]
        pen.polygon([xy(local(ar["pos"],ar["heading"],a,v)) for a,v in points],fill=210)
    weather = field(277)
    # Worn traffic yellow: chalky, thinner where tyres cross, with small flakes missing.
    wear = np.clip(.70 + .70*(weather-.5) + grit*.03,0,.92)
    wear *= np.where((weather<.42) & (noise.random((h,w),dtype=np.float32)<.45),.30,1).astype("float32")
    white = np.asarray(paint).astype("float32")/255*wear
    azure = np.asarray(blue).astype("float32")/255*wear
    rgb = np.empty((h,w,3),dtype=np.uint8)
    for channel,(tint,pigment,access) in enumerate(zip([1,1,1.012],[212,184,86],[49,103,166])):
        base = stone*tint
        base += (access-base)*azure
        rgb[:,:,channel] = np.clip(base+(pigment-base)*white,0,255).astype(np.uint8)
    albedo = Image.fromarray(rgb)
    surface = ImageDraw.Draw(albedo)
    for x,z in ((-23,-14.3),(11,-14.3),(30,-3.7),(-9,3.7),(20,12.7),(38,14.0)):
        a,b = xy((x-.40,z-.28)),xy((x+.40,z+.28))
        surface.rectangle((*a,*b),fill="#242328",outline="#827870",width=2)
        for ix in range(a[0]+3,b[0]-2,3):
            surface.line((ix,a[1]+3,ix,b[1]-3),fill="#6d6762",width=1)
        surface.line((a[0]+2,(a[1]+b[1])//2,b[0]-2,(a[1]+b[1])//2),fill="#71675f",width=2)
    for x,z in ((6.8,-1.55),(-28.9,-18.3),(33.2,10.3)):
        a,b = xy((x-.34,z-.34)),xy((x+.34,z+.34))
        surface.ellipse((*a,*b),fill="#49464a",outline="#867b72",width=2)
        for px in range(a[0]+4,b[0]-3,3):
            for py in range(a[1]+4,b[1]-3,3):
                dx=(px-(a[0]+b[0])/2)/(b[0]-a[0])
                dy=(py-(a[1]+b[1])/2)/(b[1]-a[1])
                if dx*dx+dy*dy<.15:
                    surface.point((px,py),fill="#9a938b")
    photographed = tile(photo_rough, 3.1) - np.median(photo_rough)
    rough = np.clip(181+photographed*.42+grit*1.3-stain*71-white*14,55,231).astype("uint8")
    for name,i,j,_,_,_ in tiles:
        box=(i*tw,j*th,(i+1)*tw+4,(j+1)*th+4)
        albedo.crop(box).save(TEXTURES/(name.lower()+".jpg"),quality=93,subsampling=0)
        # Quarter-resolution roughness field. G = roughness, B = dielectric metallic zero.
        tile=Image.fromarray(rough).crop(box).resize(((tw+4)//4,(th+4)//4),Image.Resampling.BOX)
        packed=Image.merge("RGB",(Image.new("L",tile.size,255),tile,Image.new("L",tile.size)))
        packed.save(TEXTURES/(name.lower()+"_mr.png"))


if __name__ == "__main__":
    TEXTURES.mkdir(parents=True,exist_ok=True)
    bake(read("lot.json"))
    shop_glass(read("lot.json")["seed"])
    leaf_alpha(read("lot.json")["seed"])
    night_horizon()
