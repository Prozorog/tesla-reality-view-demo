#!/usr/bin/env node
/* Triangle sampling adapted from the Hall of the Goblet converter, based on
   cobanov/pixelart-gaussiansplat. Upstream notice follows.
MIT License

Copyright (c) 2026 Mert Cobanov

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
// Convert static, metre-scale baked glTF geometry to Spark RAD surfels.
// Paths in the config are relative to the working directory. See tools/splat-lot.json.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { Box3, Color, Matrix3, Matrix4, Quaternion, Vector3 } from 'three'
import sharp from 'sharp'
import { RadWriter } from './splat-rad.mjs'

const read = path => JSON.parse(readFileSync(path,'utf8'))
const config = read(process.argv[2] ?? 'tools/splat-lot.json')
const root = resolve(config.modelDir), out = resolve(config.output)
const data = config.lightmaps ? read(join(root,config.lightmaps)) : {}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const model = async file => (await io.read(join(root,file))).getRoot().listNodes().filter(n=>n.getMesh())
const lot = await model(config.model)
mkdirSync(out,{recursive:true})
sharp.concurrency(1)
const textures = new Map()
async function texture(source) {
  if (!source) return null
  if (!textures.has(source)) {
    const bytes = typeof source==='string' ? join(root,source) : Buffer.from(source.getImage())
    textures.set(source, sharp(bytes).ensureAlpha().raw().toBuffer({resolveWithObject:true}))
  }
  return textures.get(source)
}

const linear = x => x<=.04045 ? x/12.92 : ((x+.055)/1.055)**2.4
const srgb = x => x<=.0031308 ? 12.92*x : 1.055*x**(1/2.4)-.055
const clamp = (x,lo=0,hi=1) => Math.min(hi,Math.max(lo,x))
const lut = Float32Array.from({length:256},(_,i)=>linear(i/255))
const unit = Float32Array.from({length:256},(_,i)=>i/255)
const smooth = (a,b,x) => {const t=clamp((x-a)/(b-a)); return t*t*(3-2*t)}
const hex = value => new Color(value).toArray()
function sample(tex,u,v,repeat,lookup,out) {
  if (!tex) {out.fill(1);return out}
  const {width:w,height:h}=tex.info, pixels=tex.data
  const x=(repeat?u-Math.floor(u):clamp(u))*w-.5, y=(repeat?v-Math.floor(v):clamp(v))*h-.5
  const ix=Math.floor(x), iy=Math.floor(y), t=x-ix, s=y-iy
  const wrap=(a,n)=>repeat?(a+n)%n:clamp(a,0,n-1)
  const x0=wrap(ix,w), x1=wrap(ix+1,w), y0=wrap(iy,h)*w, y1=wrap(iy+1,h)*w
  for(let k=0;k<4;k++){
    const table=k===3?unit:lookup
    out[k]=((1-t)*table[pixels[(x0+y0)*4+k]]+t*table[pixels[(x1+y0)*4+k]])*(1-s)
      +((1-t)*table[pixels[(x0+y1)*4+k]]+t*table[pixels[(x1+y1)*4+k]])*s
  }
  return out
}
const up=new Vector3(0,1,0)
function placement(entry) {
  return new Matrix4().compose(new Vector3(...entry.position),new Quaternion().setFromAxisAngle(up,entry.heading),
    new Vector3(...(entry.scale??[1,1,1])))
}
const geometries = new Map()
function geometry(primitive) {
  if(geometries.has(primitive)) return geometries.get(primitive)
  function attr(name) {
    const a=primitive.getAttribute(name)
    if(!a)return null
    const values=[],v=[]
    for(let i=0;i<a.getCount();i++)values.push(...a.getElement(i,v))
    return {v:Float32Array.from(values),d:a.getElementSize()}
  }
  const pos=attr('POSITION'),idx=primitive.getIndices()?.getArray()??Uint32Array.from({length:pos.v.length/3},(_,i)=>i)
  const g={pos,normal:attr('NORMAL'),uv:attr('TEXCOORD_0'),uv1:attr('TEXCOORD_1'),color:attr('COLOR_0'),idx}
  geometries.set(primitive,g)
  return g
}
async function parkedInputs(settings) {
  const catalog=read(join(root,settings.catalog)), overrides=read(join(root,settings.heroBays))
  const pack=await model(settings.models), hero=await model(settings.hero)
  const bounds=new Box3(), p=new Vector3()
  for(const node of hero) for(const prim of node.getMesh().listPrimitives()){
    const pos=geometry(prim).pos.v, m=new Matrix4().fromArray(node.getWorldMatrix())
    for(let i=0;i<pos.length;i+=3)bounds.expandByPoint(p.fromArray(pos,i).applyMatrix4(m))
  }
  const size=bounds.getSize(new Vector3()), center=bounds.getCenter(new Vector3())
  const inputs=[]
  for(const [id,entry] of Object.entries(data.parkedCars)){
    const info=catalog.types[entry.type], isHero=!!overrides[id], carColor=overrides[id]??entry.color
    const selected=isHero?hero:pack.filter(n=>n.getParentNode()?.getName()===info.nodes.root)
    if(!selected.length)throw Error('Missing parked model '+id)
    for(const node of selected){
      const m=placement(entry)
      if(isHero){
        const scale=Math.min(1,info.length/size.x,info.width/size.z)
        m.scale(new Vector3(scale,scale,scale)).multiply(new Matrix4().makeTranslation(-center.x,-bounds.min.y,-center.z))
      }
      m.multiply(new Matrix4().fromArray(node.getWorldMatrix()))
      const name=node.getName(), car={probes:entry.probes,heading:entry.heading}
      if(isHero && !/wheel/.test(name))car.tint=hex(catalog.palette[carColor])
      if(!isHero && name===info.nodes.glass)car.glass=true
      if(!isHero && name===info.nodes.body)car.paint=info.variants.find(v=>v.color===carColor)?.map
      inputs.push({node,m,car})
    }
  }
  return inputs
}
function lotInputs(group) {
  return lot.filter(n=>new RegExp(group.nodes).test(n.getName())).flatMap(node=>{
    const placements=data.instances?.[node.getName()]
    return placements ? placements.map(entry=>({node,m:placement(entry),entry})) :
      [{node,m:new Matrix4().fromArray(node.getWorldMatrix())}]
  })
}
function transformPositions(g,m) {
  const v=new Vector3(),result=new Float32Array(g.pos.v.length)
  for(let i=0;i<result.length;i+=3)v.fromArray(g.pos.v,i).applyMatrix4(m).toArray(result,i)
  return result
}
const a=new Vector3(),b=new Vector3(),c=new Vector3(),ab=new Vector3(),ac=new Vector3(),cross=new Vector3()
function triangle(pos,indices,i) {
  a.fromArray(pos,3*indices[i]); b.fromArray(pos,3*indices[i+1]); c.fromArray(pos,3*indices[i+2])
  ab.subVectors(b,a); ac.subVectors(c,a)
  return cross.crossVectors(ab,ac).length()*.5
}
let seed=12345
const random=()=>((seed=(Math.imul(1664525,seed)+1013904223)>>>0)/4294967296)
const axis=new Vector3(0,0,1),rotation=new Quaternion()
async function emitSurface(writer,item,group,factor){
  const {g,pos,prim,input}=item, {car,entry}=input,name=input.node.getName(), mat=prim.getMaterial()
  const lm=data.meshes?.[name],em=data.emissive?.[name],maskFile=data.alphaMasks?.[mat?.getName()]
  if(lm && !g.uv1)throw Error(name+' has no baked UV set')
  const [baseTex,lightTex,maskTex,emTex]=await Promise.all([texture(car?.paint??mat?.getBaseColorTexture()),texture(lm?.file),
    texture(maskFile),texture(em?.map??mat?.getEmissiveTexture())])
  const base=car?.glass?[...hex('#05080d'),1]:mat?.getBaseColorFactor()??[1,1,1,1]
  const emission=em?hex(em.color).map(x=>x*em.intensity):mat?.getEmissiveFactor()??[0,0,0]
  const rect=[...(entry?.lightmapScale??[1,1]),...(entry?.lightmapOffset??[0,0])]
  const diffuse=lm?lm.threeStandardLightMapIntensity/Math.PI:1
  const metal=mat?.getMetallicFactor()??0
  const h=item.spacing*factor, rgb=[0,0,0], p=[0,0,0], tex=[0,0,0,0], light=[0,0,0,0], e=[0,0,0,0], mask=[0,0,0,0]
  const cutoff=mat?.getAlphaMode()==='MASK'?mat.getAlphaCutoff():0
  const interpNormal = new Vector3(), normalBasis = new Matrix3().getNormalMatrix(input.m)
  const carCo = car ? Math.cos(car.heading) : 0, carSi = car ? Math.sin(car.heading) : 0
  const illumination = [0,0,0]
  for(let i=0;i<g.idx.length;i+=3){
    const area=triangle(pos,g.idx,i)
    if(area<1e-12)continue
    let ids=[g.idx[i],g.idx[i+1],g.idx[i+2]]
    const edges=[a.distanceTo(b),b.distanceTo(c),c.distanceTo(a)], length=Math.max(...edges), j=edges.indexOf(length)
    ids=[ids[j],ids[(j+1)%3],ids[(j+2)%3]]
    const [ia,ib,ic]=ids
    const n=cross.normalize(), q=rotation.setFromUnitVectors(axis,n).toArray()
    const scales=[h*group.width,h*group.width,group.planar ? 0 : h*.11]
    const samplePoint=(u,v)=>{
      const w=1-u-v
      const attr=(a,k,defaultValue=0)=>a?w*a.v[ia*a.d+k]+u*a.v[ib*a.d+k]+v*a.v[ic*a.d+k]:defaultValue
      const x=attr(g.uv,0), y=attr(g.uv,1)
      sample(baseTex,x,y,true,lut,tex)
      const opacity=tex[3]*base[3]
      if(opacity<cutoff || maskTex && sample(maskTex,x,y,/treeline/.test(maskFile),unit,mask)[1]<.5)return
      if(lightTex)sample(lightTex,attr(g.uv1,0)*rect[0]+rect[2],(lm.flipY?1-(attr(g.uv1,1)*rect[1]+rect[3]):attr(g.uv1,1)*rect[1]+rect[3]),false,lut,light)
      if(emTex)sample(emTex,x,y,false,lut,e)
      for(let k=0;k<3;k++)rgb[k]=base[k]*tex[k]*attr(g.color,k,1)
      if(car?.tint){
        const l=.2126*rgb[0]+.7152*rgb[1]+.0722*rgb[2], m=smooth(.072,.33,l)*(1-smooth(.13,.39,Math.max(...rgb)-Math.min(...rgb)))
        for(let k=0;k<3;k++)rgb[k]=rgb[k]*.64*(1-m)+car.tint[k]*(.68+.37*l)*m
      }
      if (car) {
        if (g.normal) interpNormal.set(attr(g.normal,0),attr(g.normal,1),attr(g.normal,2)).applyNormalMatrix(normalBasis)
        else interpNormal.copy(n)
        const nx=carCo*interpNormal.x-carSi*interpNormal.z, ny=interpNormal.y, nz=carSi*interpNormal.x+carCo*interpNormal.z
        const probes=car.probes
        for (let k=0;k<3;k++) illumination[k]=nx*nx*probes[nx>0?'nose':'tail'].rgb[k]+nz*nz*probes[nz<0?'left':'right'].rgb[k]
          +ny*ny*(ny>0?probes.roof.rgb[k]:[.022,.025,.035][k])
      }
      for(let k=0;k<3;k++){
        const irradiance=car?illumination[k]:lightTex?light[k]*diffuse*(1-metal):0
        const emissive=car?0:emission[k]*(emTex?e[k]:1)*(em?.vertexTint?attr(g.color,k,1):1)
        rgb[k]=1.19*(rgb[k]*irradiance+emissive+(car?.glass ? .010 : car ? .007 : (group.ambient?.[k] ?? .0008)))
      }
      const peak=Math.max(.0001,...rgb),excess=Math.max(peak-.58,0),shoulder=1-excess*excess/((excess+.42)*peak)
      for(let k=0;k<3;k++){
        rgb[k]=srgb(Math.max(0,rgb[k]*shoulder))
        p[k]=w*pos[ia*3+k]+u*pos[ib*3+k]+v*pos[ic*3+k]
      }
      writer.add(p,rgb,Math.min(.99,opacity),scales,q)
    }
    const target=area/(h*h)
    if(target<4){
      const count=Math.floor(target+random())
      for(let k=0;k<count;k++){
        let u=random(),v=random()
        if(u+v>1){u=1-u;v=1-v}
        samplePoint(u,v)
      }
    }else{
      const rows=Math.max(1,Math.round(2*area/(length*h)))
      for(let row=0;row<rows;row++){
        const v=(row+.4+.2*random())/rows, cols=Math.max(1,Math.round((1-v)*length/h))
        for(let col=0;col<cols;col++)samplePoint((1-v)*(col+.33+.34*random())/cols,v)
      }
    }
  }
}
const manifest={groups:[]}
for(const group of config.groups){
  const inputs=group.parked?await parkedInputs(group.parked):lotInputs(group)
  const surfaces=[]
  let estimate=0
  for(const input of inputs){
    const rule=group.overrides?.find(o=>new RegExp(o.nodes).test(input.node.getName()))
    const spacing=rule?.spacing??group.spacing
    for(const prim of input.node.getMesh().listPrimitives()){
      const g=geometry(prim),pos=transformPositions(g,input.m)
      let area=0
      for(let i=0;i<g.idx.length;i+=3)area+=triangle(pos,g.idx,i)
      surfaces.push({input,g,pos,prim,spacing})
      estimate+=area/(spacing*spacing)
    }
  }
  if(!surfaces.length)throw Error('No geometry for '+group.id)
  const factor=Math.max(1,Math.sqrt(estimate/group.maxCount))
  const writer=new RadWriter()
  for(const surface of surfaces)await emitSurface(writer,surface,group,factor)
  const file=group.id+'.rad',path=join(out,file)
  writer.save(path+'.tmp');renameSync(path+'.tmp',path)
  const record={id:group.id,file,count:writer.count,bytes:statSync(path).size,spacingFactor:+factor.toFixed(3),
    nodes:[...new Set(inputs.map(i=>i.node.getName()))]}
  if(group.parked)record.nodes=[]
  manifest.groups.push(record)
  console.log(group.id,record.count,record.bytes,'bytes, spacing ×',record.spacingFactor)
}
const count=manifest.groups.reduce((n,g)=>n+g.count,0)
if(count>config.budget)throw Error(count+' exceeds budget '+config.budget)
writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n')
console.log(count,'splats')
