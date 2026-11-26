"""Northgate architecture, perimeter planting and all surveyed street furniture."""
import math
import random
from pathlib import Path

import bpy
from mathutils import Vector

from layout import TEXTURES, street_lights
from mesh import Batch, material, rgb

# Fraction of the runtime sign emission used as a light source in the bake.
SIGN_BAKE=.12


def transform(x,z,y=0,h=0,scale=(1,1,1)):
    return {"position":[x,y,z],"heading":h,"scale":list(scale)}


def place(obj,tr):
    x,y,z=tr["position"]
    sx,sy,sz=tr["scale"]
    obj.location=(x,-z,y)
    obj.rotation_mode="XYZ"
    obj.rotation_euler=(0,0,tr["heading"])
    obj.scale=(sx,sz,sy)


class Environment:
    def __init__(self,lot):
        self.lot=lot
        self.rng=random.Random(lot["seed"]+181)
        self.static={}
        self.instances={}
        self.emissive={}
        self.exports=[]
        self.solid=material("Architectural finishes",.69)
        # Satin powdercoat. At 0.40 the thin trim and parapet caps caught the
        # night environment's hot spots as single-pixel glints.
        self.metal=material("Powdercoated hardware",.64)
        self.foliage=material("Planting",.85)
        self.leaves=self.alpha_material("Leaf cards",.88,"leaf_cluster.png",clamp=True)
        self.treeline=self.alpha_material("Tree line",.95,"treeline.png",clamp=False)
        self.glints=[]
        self.building()
        self.perimeter()
        self.furniture()
        self.distance()

    def alpha_material(self,name,rough,file,clamp):
        """Vertex-coloured foliage whose coverage comes from a mask on the Surface UV.
        The mask node casts dappled shadows in the bake; build_lot removes it before
        export and the runtime binds the same mask as an alpha-to-coverage map."""
        m=material(name,rough)
        nodes,links=m.node_tree.nodes,m.node_tree.links
        uv=nodes.new("ShaderNodeUVMap")
        uv.uv_map="Surface"
        uv.name="Leaf alpha UV"
        tex=nodes.new("ShaderNodeTexImage")
        tex.name="Leaf alpha"
        tex.image=bpy.data.images.load(str(TEXTURES/file),check_existing=True)
        tex.image.colorspace_settings.name="Non-Color"
        tex.extension="EXTEND" if clamp else "REPEAT"
        links.new(uv.outputs["UV"],tex.inputs["Vector"])
        links.new(tex.outputs["Color"],nodes.get("Principled BSDF").inputs["Alpha"])
        m["alphaMask"]="textures/lot/"+file
        return m

    def receiver(self,batch,density=8,mat=None,transforms=None):
        obj=batch.make(mat or self.solid,density)
        self.exports.append(obj)
        self.static[obj.name]={"density":density}
        if transforms:
            self.instances[obj.name]=transforms
            place(obj,transforms[0])
        return obj

    def emitter(self,batch,hexcolor,strength,transforms=None,tinted=False,bake_light=True):
        """tinted: each face emits its own vertex colour (scattered horizon lights).
        bake_light=False: shown at runtime only. Far, tiny emitters only added colour noise."""
        m=material(batch.name+" emission",.37,hexcolor,strength if bake_light else 0)
        if tinted:
            tree=m.node_tree
            tint=next(n for n in tree.nodes if n.bl_idname=="ShaderNodeVertexColor")
            tree.links.new(tint.outputs["Color"],tree.nodes.get("Principled BSDF").inputs["Emission Color"])
        obj=batch.make(m)
        self.exports.append(obj)
        self.emissive[obj.name]={"color":"#"+hexcolor,"intensity":strength}
        if tinted:
            self.emissive[obj.name]["vertexTint"]=True
        if transforms:
            self.instances[obj.name]=transforms
            place(obj,transforms[0])
        return obj

    def letters(self,name,word,x,z,y,size,color,strength,serif=False,yaw=0):
        """Emissive channel letters. The runtime shows them at full strength; the bake
        uses a small fraction, so their light stays within about a metre of the face."""
        data=bpy.data.curves.new(name,"FONT")
        data.body=word
        data.align_x="CENTER"
        data.align_y="CENTER"
        data.space_character=1.20 if not serif else 1.03
        data.size=size
        # Letter faces stand proud of the sign cabinet. Thin opaque vinyl does not need
        # duplicate backs or thousands of tiny extruded bevel faces at this distance.
        data.extrude=0
        data.resolution_u=3
        face=Path("C:/Windows/Fonts")/("georgia.ttf" if serif else "arialbd.ttf")
        if face.exists():
            data.font=bpy.data.fonts.load(str(face),check_existing=True)
        obj=bpy.data.objects.new(name,data)
        bpy.context.collection.objects.link(obj)
        obj.location=(x,-z,y)
        obj.rotation_euler.x=math.pi/2
        obj.rotation_euler.z=yaw
        mesh=bpy.data.meshes.new_from_object(obj.evaluated_get(bpy.context.evaluated_depsgraph_get()))
        saved=obj.matrix_world.copy()
        bpy.data.objects.remove(obj,do_unlink=True)
        obj=bpy.data.objects.new(name,mesh)
        bpy.context.collection.objects.link(obj)
        obj.matrix_world=saved
        mesh.materials.append(material(name+" enamel",.29,color,strength*SIGN_BAKE,colored=False))
        self.exports.append(obj)
        self.emissive[name]={"color":"#"+color,"intensity":strength}

    def textured_emitter(self,batch,coords,mat_name,uv_name,file,strength,glazing=False):
        m=material(mat_name,.24,colored=False)
        tex=m.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image=bpy.data.images.load(str(TEXTURES/file),check_existing=True)
        bs=m.node_tree.nodes.get("Principled BSDF")
        bs.inputs["Base Color"].default_value=(0,0,0,1)
        if glazing:
            m.node_tree.links.new(tex.outputs["Color"],bs.inputs["Base Color"])
        m.node_tree.links.new(tex.outputs["Color"],bs.inputs["Emission Color"])
        bs.inputs["Emission Strength"].default_value=strength
        obj=batch.make(m)
        uv=obj.data.uv_layers.new(name=uv_name)
        for poly,chart in zip(obj.data.polygons,coords):
            for li,st in zip(poly.loop_indices,chart):
                uv.data[li].uv=st
        self.exports.append(obj)
        self.emissive[obj.name]={"color":"#ffffff","intensity":strength,"map":"textures/lot/"+file}

    def building(self):
        data=self.lot["building"]
        poly=data["outline"]
        left,right=min(p[0] for p in poly),max(p[0] for p in poly)
        front=max(p[1] for p in poly)
        h,canopy=data["height"],data["canopyDepth"]
        span=right-left
        mid=(left+right)/2
        wall=Batch("Northgate_masonry")
        trim=Batch("Shopfront_joinery")
        display=Batch("Window_displays")
        # Keep the window wall recessed behind pilasters. The facade meets the supplied footprint.
        wall.slab([(x,min(z,front-1.02)) for x,z in poly],0,h,"8d8174")
        wall.box(mid,front-.32,h-.05,span,.65,.48,"b0a594")
        wall.box(mid,front-.30,h+.42,span+.12,.76,.085,"c6b8a4")
        for end in (left+.19,right-.19):
            wall.box(end,front-.50,0,.38,1.0,h+.44,"a29480")
        soffit=h*.552
        wall.box(mid,front+canopy/2-.46,soffit,span+.45,canopy+1.0,.19,"c6bba4")
        # Grey single-ply membrane on the canopy top: from above it read as a white band.
        wall.box(mid,front+canopy/2-.46,soffit+.19,span+.41,canopy+.96,.012,"77756f")
        trim.box(mid,front+canopy-.025,soffit+.16,span+.50,.19,.24,"4b4b47")
        trim.box(mid,front+canopy+.07,soffit+.36,span+.55,.07,.055,"b7ae98")
        wall.box(mid,front-.48,soffit+.45,span,.82,h-soffit-.48,"ad9a86")
        # Recesses break the long fascia into three shop signs with distinct proportions.
        for fraction,wid in ((.17,.18),(.5,.32),(.83,.18)):
            x=left+span*fraction
            trim.box(x,front-.026,soffit+.62,span*wid,.23,h-soffit-.71,"54524c" if fraction==.5 else "827565")
        for x in [left + span*i/24 for i in range(25)]:
            trim.box(x,front-.053,soffit+.5,.034,.055,h-soffit-.52,"746757")
        # Font size is the em; capitals are about 0.72 em: 0.83, 0.76 and 0.68 m tall.
        self.letters("Sign_Northgate",data["sign"],mid,front+.13,(h+soffit)/2+.10,1.15,"fff0d1",3.0)
        self.letters("Sign_Oriel","ORIEL & FIG",left+span*.17,front+.13,(h+soffit)/2+.08,1.10,"ff665b",3.8,True)
        self.letters("Sign_Fieldworks","FIELDWORKS",left+span*.83,front+.13,(h+soffit)/2+.08,.95,"fff0e6",3.6)

        glass=Batch("Shop_display_glass")
        glazing_uv=[]
        lamps=Batch("Canopy_luminaires")
        door_x=[pos[0] for pos in data["doors"]]
        cuts=sorted(set([left+.3,right-.3]+[a for x in door_x for a in (x-1.45,x+1.45)]))
        for a,b in zip(cuts,cuts[1:]):
            is_door=any(a<d<b for d in door_x)
            count=2 if is_door else max(1,round((b-a)/3.25))
            weights=[1 if is_door else (1.30,.72,1.10,.90)[k%4] for k in range(count)]
            edge=a
            for k,weight in enumerate(weights):
                width=(b-a)*weight/sum(weights)
                x=edge+width/2
                edge+=width
                shop=(x-left)/span
                sill=.19 if is_door else .46
                zp=front-.61 if is_door else front-.71
                top=soffit-.11
                glass.face([(x-width/2,zp,sill),(x-width/2,zp,top),
                            (x+width/2,zp,top),(x+width/2,zp,sill)],"ffffff")
                cell=4 if is_door else ((1,5) if shop<.32 else (3,6) if shop>.68 else (0,2))[k%2]
                # Across a vestibule the two leaves see a single continuous room.
                glazing_uv.append([((cell+(.003+.994*((u+k)/2 if is_door else u)))/7,v)
                                   for u,v in ((1,0),(1,1),(0,1),(0,0))])
                trim.box(x-width/2,front-.16,sill,.085,.21,top-sill,"393c38")
                trim.box(x,front-.15,top-.49,width,.16,.055,"64665b")
                trim.box(x,front-.14,sill-.048,width,.21,.075,"867f70")
                trim.box(x,front-.125,1.78,width,.10,.034,"4d5550")
                if not is_door:
                    trim.box(x,front-.12,sill,.042,.10,top-sill,"414b47")
                    # Recessed display shelves are real relief behind the glass.
                    for shelf_y in (1.03,1.52):
                        display.box(x,front-.48,shelf_y,width*.72,.24,.032,"a99d84")
                    for item in range(5):
                        u=(item-2)*width*.12
                        display.box(x+u,front-.46,1.06,.09,.11,.15+.08*((item+k)%3),
                                    ("727e6a","a18a70","8b776b","89968c","b5a88e")[item])
                if is_door:
                    trim.box(x,front-.17,.21,width-.08,.15,.20,"55584f")
                    trim.box(x,front-.12,2.45,width,.12,.085,"444840")
                    trim.box(x+width*.27,front-.014,.95,.030,.075,.42,"c2baa4")
                    lamps.box(x,front-.10,2.58,width-.08,.15,.075,"ffe8c0")
                    lamps.box(x+width*.27,front+.009,1.10,.018,.012,.11,"ffe8c0")
                    wall.box(x-width/2,front-.44,.18,.10,.84,2.40,"cbbda6")
                elif k%2==0:
                    # Display plinths and hanging shades sit in front of the lit back wall.
                    display.box(x,front-.40,.34,width*.62,.35,.46,"80745f")
                    for item in range(3):
                        ht=self.rng.uniform(.16,.48)
                        display.box(x+(item-1)*width*.14,front-.39,.8,.19,.17,ht,
                                    self.rng.choice(["b09872","8b776d","a49d81","717d78"]))
                if (not is_door and k==0) or k%4==3:
                    wall.box(x-width/2,front-.25,0,.34,.87,soffit,"ab9980")
                    wall.box(x-width/2,front-.22,0,.43,.94,.45,"807667")
        count=max(1,round(span/3.6))
        for i in range(count):
            x=left+span*(i+.5)/count
            trim.box(x,front+canopy*.62,soffit-.045,.99,.28,.05,"706c60")
            lamps.box(x,front+canopy*.62,soffit-.061,.87,.18,.023,"ffe8bf")
            trim.box(x,front+canopy/2-.25,soffit-.08,.038,canopy+.4,.075,"86816f")
        # The reveal and parapet have actual return walls and the canopy is supported.
        for i in range(1,10):
            x=left+span*i/10
            wall.box(x,front+canopy-.19,.15,.28,.31,soffit-.15,"a29782")
            trim.box(x,front+canopy-.19,.16,.34,.39,.44,"6a6258")
        # Individual canvas awnings in front of the continuous structural canopy.
        # The florist has three short scalloped bays, the outfitter two longer shades.
        for f,units,tint,piping in ((.17,3,"9d5046","dfab84"),(.83,2,"456f6e","aec3aa")):
            centre=left+span*f
            run=span*.255
            for i in range(units):
                x=centre-run/2+(i+.5)*run/units
                half=run/units/2-.16
                back,lip=front+canopy-.16,front+canopy+.80
                trim.face([(x-half,back,soffit+.54),(x+half,back,soffit+.54),
                           (x+half,lip,soffit+.12),(x-half,lip,soffit+.12)],tint)
                trim.box(x,lip,soffit-.11,2*half,.046,.23,tint)
                trim.box(x,lip+.025,soffit-.09,2*half,.025,.032,piping)
                for ex in (x-half+.10,x+half-.10):
                    trim.rod((ex,back,soffit-.21),(ex,lip,soffit+.10),.023,"656158",5)
            wall.box(centre,front-.40,h+.44,run+.4,.78,.33 if units==3 else .59,"a49788")
        self.receiver(wall,8)
        self.receiver(trim,7,self.metal)
        self.receiver(display,6)
        self.emitter(lamps,"ffe8bc",4.5)
        self.textured_emitter(glass,glazing_uv,"Window glazing and interior","Shop display","shop_glass.jpg",1.20,True)

    def perimeter(self):
        kerbs=Batch("Kerbs_and_paving")
        for k in self.lot["kerbs"]:
            poly=k["outline"]
            cx=sum(p[0] for p in poly)/len(poly)
            cz=sum(p[1] for p in poly)/len(poly)
            kerbs.slab(poly,-.035,.155,"958f83" if k["kind"]=="sidewalk" else "a09a88")
            if k["kind"]=="sidewalk":
                a,b=min(p[0] for p in poly),max(p[0] for p in poly)
                front=max(p[1] for p in poly)
                depth=front-min(p[1] for p in poly)
                n=max(1,round((b-a)/2.35))
                for i in range(n):
                    kerbs.box(a+(i+.5)*(b-a)/n,front-depth/2,.155,(b-a)/n-.018,depth-.04,.014,
                              self.rng.choice(["8f8b81","948f85","8d887e","98938a"]))
            else:
                inner=[(x+math.copysign(min(.12,abs(cx-x)*.28),cx-x),
                        z+math.copysign(min(.12,abs(cz-z)*.28),cz-z)) for x,z in poly]
                kerbs.slab(inner,.155,.169,"394332" if k['kind']=='hedge' else "59503e")
        self.receiver(kerbs,9)

    def crown(self,batch,center,rad,count,colors,size=.95):
        """Leaf-cluster cards on an ellipsoid shell. The mask gives each card a
        ragged, leafy outline; outward normals shade the crown as one volume."""
        x,z,y=center
        rx,rz,ry=rad
        flips=[((0,0),(1,0),(1,1),(0,1)),((1,0),(0,0),(0,1),(1,1)),
               ((0,1),(1,1),(1,0),(0,0)),((1,1),(0,1),(0,0),(1,0))]
        for i in range(count):
            azimuth=self.rng.uniform(0,math.tau)
            elevation=self.rng.uniform(-.75,1)
            shell=self.rng.uniform(.30,1)**.5
            r=math.sqrt(1-elevation*elevation)
            dx,dz=r*math.cos(azimuth),r*math.sin(azimuth)
            p=Vector((x+rx*dx*shell,z+rz*dz*shell,y+ry*elevation*shell))
            outward=Vector((dx,dz,elevation*.9+.2)).normalized()
            facing=(outward+Vector((self.rng.uniform(-.45,.45),self.rng.uniform(-.45,.45),
                                     self.rng.uniform(-.2,.45)))).normalized()
            up=Vector((0,0,1))
            u=facing.cross(up)
            if u.length<.2:
                u=facing.cross(Vector((1,0,0)))
            u.normalize()
            v=u.cross(facing).normalized()
            spin=self.rng.uniform(0,math.tau)
            u,v=u*math.cos(spin)+v*math.sin(spin),v*math.cos(spin)-u*math.sin(spin)
            half=size*self.rng.uniform(.78,1.2)/2
            card=[p-u*half-v*half,p+u*half-v*half,p+u*half+v*half,p-u*half+v*half]
            normal=Vector((dx,dz,max(.35,elevation*.85+.15))).normalized()
            batch.face(card,self.rng.choice(colors),[normal for _ in card],list(self.rng.choice(flips)))

    def furniture(self):
        groups={}
        for l in self.lot["lamps"]:
            groups.setdefault((l["height"],l["arms"]),[]).append(transform(*l["pos"]))
        for idx,((ht,arms),trs) in enumerate(groups.items()):
            pole=Batch("Lamp_column_"+str(idx+1))
            head=Batch("Lamp_LED_"+str(idx+1))
            pole.rod((0,0,0),(0,0,.27),.19,"8b867d",10,.16)
            pole.rod((0,0,.26),(0,0,ht-.28),.074,"777b78",8,.042)
            pole.rod((0,0,.24),(0,0,.33),.10,"535857",8,.075)
            for k in range(arms):
                a=k*math.tau/arms
                dx,dz=math.sin(a),math.cos(a)
                pole.rod((0,0,ht-.43),(dx*.84,dz*.84,ht-.11),.045,"858782")
                pole.box(dx*.94,dz*.94,ht-.09,.30,.51,.081,"535856")
                # The prismatic drop lens is visible side-on, with its lowest facet
                # just above the physical spot source. The housing caps the uplight.
                head.rod((dx*.94,dz*.94,ht-.193),(dx*.94,dz*.94,ht-.141),.095,"fff6ee",8,.158)
                head.box(dx*.94,dz*.94,ht-.148,.26,.46,.052,"fff6ee")
                # An exposed frosted crown gives the nadir view a bright source
                # and a small bloom core, while the dark housing still reads.
                head.box(dx*.94,dz*.94,ht+.012,.18,.36,.009,"fff6ee")
            self.receiver(pole,5,self.metal,trs)
            self.emitter(head,"fff4ea",52,trs)
        bollard=Batch("Bollard")
        bollard.rod((0,0,.17),(0,0,1.14),.075,"726e62",10)
        bollard.rod((0,0,1.04),(0,0,1.105),.077,"cebe91",10)
        bollard.rod((0,0,1.14),(0,0,1.17),.075,"9c998b",10,.059)
        if self.lot["bollards"]:
            self.receiver(bollard,5,self.metal,[transform(*p) for p in self.lot["bollards"]])
        for variant in range(3):
            tree=Batch("Serviceberry_"+str(variant+1))
            # Bark and branches sample the solid corner of the leaf mask.
            tree.default_uv=(-4.0,5.0)
            # The trunk flares into the planting bed below the kerb top.
            tree.rod((0,0,.02),(0,0,.36),.135,"463d30",8,.10)
            tree.rod((0,0,.14),(.07,-.05,2.82),.094,"574d3c",8,.048)
            palette=["1d2c1c","223321","1a291b","26371f","1c2a1d"]
            for j in range(7):
                a=j*2.4+self.rng.uniform(-.23,.23)
                d=self.rng.uniform(.44,.84) if j<5 else .18
                top=2.38+.23*(j%4)
                cx,cz=d*math.cos(a),d*math.sin(a)
                tree.rod((.04,-.03,1.52+.11*j),(cx,cz,top),.043,"5c513e",6,.016)
                if variant<2:
                    self.crown(tree,(cx,cz,top+.32),(.70+self.rng.random()*.17,.64+self.rng.random()*.16,.62+self.rng.random()*.18),22,palette)
                else:
                    for twig in (-1,1):
                        start=(cx*.82,cz*.82,top-.16)
                        tip=(cx+math.sin(a)*twig*.27,cz+math.cos(a)*twig*.27,top+.39)
                        tree.rod(start,tip,.018,"554c42",5,.006)
            trs=[]
            for x,z in self.lot["trees"][variant::3]:
                s=self.rng.uniform(.87,1.05)
                trs.append(transform(x,z,0,self.rng.random()*math.tau,(s,s,s)))
            if trs:
                self.receiver(tree,3,self.leaves,trs)
        corral=Batch("Cart_corral")
        for side in (-1,1):
            for end in (-1.95,0,1.95):
                corral.rod((end,side,0),(end,side,1.02),.044,"979b96")
            for h in (.46,1.01):
                corral.rod((-1.95,side,h),(1.95,side,h),.043,"b4b5ac")
        corral.rod((-1.95,-1,1),(-1.95,1,1),.044,"b4b5ac")
        corral.box(-1.95,0,.62,.06,.91,.27,"687c77")
        trs=[transform(*b["center"],h=b["heading"],scale=(b["depth"]/5.5,1,b["width"]/2.6))
             for b in self.lot["bays"] if b["id"] in self.lot["corrals"]]
        if trs:
            self.receiver(corral,6,self.metal,trs)

    def distance(self):
        street=self.lot["street"]
        a,b,z=street["from"],street["to"],street["z"]
        w,d=self.lot["size"]
        west=-w/2-10
        road=Batch("Street_beyond")
        road.face([(a,z-2.6,-.007),(b,z-2.6,-.007),(b,z+2.6,-.007),(a,z+2.6,-.007)],"62606a")
        road.face([(west-2.6,-47,-.007),(west+2.6,-47,-.007),
                   (west+2.6,z-2.6,-.007),(west-2.6,z-2.6,-.007)],"5b5a63")
        for i in range(math.floor((b-a)/7)):
            x=a+7*i+1.5
            road.face([(x,z,.001),(x+2.7,z,.001),(x+2.7,z+.075,.001),(x,z+.075,.001)],"b7ad94")
        for zz in range(-44,32,7):
            road.face([(west,zz,.001),(west+.075,zz,.001),(west+.075,zz+2.7,.001),(west,zz+2.7,.001)],"aaa28d")
        self.receiver(road,12)

        post=Batch("Street_columns")
        lens=Batch("Street_lenses")
        post.rod((0,0,0),(0,0,.34),.17,"97918a",8,.15)
        post.rod((0,0,.31),(0,0,4.88),.084,"727879",8,.054)
        post.rod((0,0,4.80),(0,.72,5.13),.040,"8b8e89",6)
        post.box(0,.86,5.01,.28,.50,.12,"56595a")
        lens.box(0,.86,4.95,.24,.43,.065,"fff1d3")
        lens.box(0,.86,5.142,.13,.30,.008,"fff1d3")
        trs=[transform(x,zz,h=angle) for x,zz,angle in street_lights(self.lot)]
        self.receiver(post,4,self.metal,trs)
        self.emitter(lens,"fff0e2",26,trs)

        self.horizon(w,d,west,z)
        verge=Batch("Outer_verge")
        verge.face([(-2*w,-2*d,-.095),(2*w,-2*d,-.095),(2*w,2*d,-.095),(-2*w,2*d,-.095)],"262624")
        self.receiver(verge,1)

        horizon=Batch("Night_horizon")
        ring=[(156*math.cos(i*math.tau/48),156*math.sin(i*math.tau/48)) for i in range(48)]
        charts=[]
        for p,q in zip(ring,ring[1:]+ring[:1]):
            horizon.face([(*q,-8),(*p,-8),(*p,80),(*q,80)],"ffffff")
            charts.append([(1,1),(0,1),(0,0),(1,0)])
        self.textured_emitter(horizon,charts,"Night horizon radiance","Sky elevation","night_horizon.png",1)

    def horizon(self,w,d,west,street_z):
        """Clip B's horizon: a low dark tree line, low dark roofs, a lit strip mall,
        other lots' lamp posts and many small scattered lights under a black sky."""
        rng=self.rng
        roofs=Batch("Horizon_roofs")
        lights=Batch("Distant_pinlights")
        heads=Batch("Distant_lamps")
        mall=Batch("Distant_storefront")
        trees=Batch("Distant_trees")

        front=street_z+26
        def outside(x,zz,margin):
            in_mall=-62-margin/2<x<8+margin/2 and front-margin/2<zz<front+14+margin/2
            return not in_mall and not (-w/2-margin<x<w/2+margin and -d/2-14-margin<zz<street_z+4+margin)

        def facing(x,zz):
            a=math.atan2(-zz,-x)
            return math.cos(a),math.sin(a)

        # Two staggered rings of tree-line cards. The mask tiles along each card.
        for ring,(radius,low,high) in enumerate(((104,7.5,10.5),(122,9,13))):
            n=34 if ring==0 else 40
            for i in range(n):
                a0=(i+rng.uniform(-.08,.08))*math.tau/n+ring*.07
                a1=a0+math.tau/n*1.22
                r0,r1=radius+rng.uniform(-6,6),radius+rng.uniform(-6,6)
                p0=(r0*math.cos(a0),r0*math.sin(a0)*.95)
                p1=(r1*math.cos(a1),r1*math.sin(a1)*.95)
                top=rng.uniform(low,high)
                span=math.dist(p0,p1)/24
                u0=rng.uniform(0,1)
                trees.face([(p1[0],p1[1],-.3),(p0[0],p0[1],-.3),(p0[0],p0[1],top),(p1[0],p1[1],top)],
                           rng.choice(["0d140f","101812","0c120d"]),
                           uv=[(u0+span,1),(u0,1),(u0,0),(u0+span,0)])

        # Low dark roofs, no window grids. Some carry one wall pack or a door light.
        placed=0
        while placed<22:
            r=rng.uniform(62,96)
            a=rng.uniform(0,math.tau)
            x,zz=r*math.cos(a),r*math.sin(a)*.85
            if not outside(x,zz,24) or (zz<-d/2-8 and abs(x)<w/2+12):
                continue
            placed+=1
            fx,fz=facing(x,zz)
            long,depth=rng.uniform(8,18),rng.uniform(6,10)
            height=rng.uniform(2.3,3.6)
            yaw=math.atan2(fz,fx)
            ca,sa=math.cos(yaw),math.sin(yaw)
            def at(u,v):
                return (x+u*ca-v*sa,zz+u*sa+v*ca)
            foot=[at(-depth/2,-long/2),at(depth/2,-long/2),at(depth/2,long/2),at(-depth/2,long/2)]
            roofs.slab(foot,-.1,height,rng.choice(["1b1c1b","1e1e1c","191a1a"]))
            if rng.random()<.5:
                ridge=height+rng.uniform(.6,1.2)
                s0,s1=at(0,-long/2),at(0,long/2)
                for side in (-1,1):
                    e0,e1=at(side*depth/2,-long/2),at(side*depth/2,long/2)
                    roofs.face([(e0[0],e0[1],height),(e1[0],e1[1],height),(s1[0],s1[1],ridge),(s0[0],s0[1],ridge)][::side],"232422")
            for k in range(rng.choice([0,1,1,2])):
                u=rng.uniform(-long*.4,long*.4)
                px,pz=at(depth/2+.05,u)
                y=rng.uniform(2.0,height-.4)
                lights.box(px,pz,y,.26,.26,.16,rng.choice(["fff1dc","ffe3b8","f3f6ff"]))

        # A long, low strip mall across the street: one continuous lit frontage.
        roofs.box(-27,front+7,-.1,68,14,5.2,"1c1c1b")
        roofs.box(-27,front-.4,4.2,69,1.0,.5,"2a2a28")
        for x0,x1,tone in ((-60,-44,"ffd9a8"),(-41,-25,"ffe6c4"),(-22,-10,"ffcf9a"),(-7,6,"ffe2bd")):
            mall.face([(x1,front-.02,.35),(x0,front-.02,.35),(x0,front-.02,2.9),(x1,front-.02,2.9)],tone)
        for x,tone in ((-34,"ff4636"),(-16,"ffffff"),(-52,"ff3b30")):
            mall.box(x,front-.15,3.35,3.2,.08,.55,tone)

        # Other lots' poles with bright heads, and many small scattered lights.
        posts=Batch("Distant_posts")
        placed=0
        while placed<24:
            r=rng.uniform(56,100)
            a=rng.uniform(0,math.tau)
            x,zz=r*math.cos(a),r*math.sin(a)*.85
            if not outside(x,zz,12):
                continue
            placed+=1
            ht=rng.uniform(7,10)
            posts.rod((x,zz,-.1),(x,zz,ht),.09,"2b2c2c",4)
            heads.box(x,zz,ht,.55,.55,.14,rng.choice(["fff4ea","fff4ea","ffe7cc"]))
            self.glints.append([x,ht-.03,zz])
        placed=0
        while placed<150:
            r=rng.uniform(48,100)
            a=rng.uniform(0,math.tau)
            x,zz=r*math.cos(a),r*math.sin(a)*.85
            if not outside(x,zz,6):
                continue
            placed+=1
            size=rng.uniform(.18,.42)
            fx,fz=facing(x,zz)
            tx,tz=-fz*size/2,fx*size/2
            y=rng.choice([rng.uniform(.4,1.2),rng.uniform(1.5,4.5),rng.uniform(4,7)])
            tone=rng.choice(["fff1dc"]*5+["ffd9a6"]*4+["e9f0ff"]*3+["ff5a40"])
            lights.face([(x+tx,zz+tz,y),(x-tx,zz-tz,y),(x-tx,zz-tz,y+size*.7),(x+tx,zz+tz,y+size*.7)],tone)
        self.receiver(roofs,1.2)
        self.receiver(posts,1)
        self.receiver(trees,.35,self.treeline)
        self.emitter(lights,"ffffff",2.6,tinted=True,bake_light=False)
        self.emitter(heads,"ffffff",22,tinted=True,bake_light=False)
        self.emitter(mall,"ffffff",1.5,tinted=True,bake_light=False)
