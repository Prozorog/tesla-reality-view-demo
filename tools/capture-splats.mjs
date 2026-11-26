// Capture all variants at the same frozen simulation tick and camera.
// heavy node tools/capture-splats.mjs URL OUTPUT_DIR
import { chromium } from 'playwright-core'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const [base='http://localhost:4106/', dir='tmp/p14-captures']=process.argv.slice(2)
const tmp=resolve('tmp/p14-chrome')
mkdirSync(tmp,{recursive:true})
process.env.TMP=process.env.TEMP=process.env.TMPDIR=tmp
mkdirSync(dir,{recursive:true})
const browser=await chromium.launch({channel:'chrome',args:['--enable-gpu','--ignore-gpu-blocklist','--disable-software-rasterizer',
  '--use-gl=angle','--use-angle=d3d11','--force_high_performance_gpu']})
try {
  const errors=[]
  const shots=JSON.parse(readFileSync('tools/shots-p1.3.json')).shots
  for(const [bay,names] of [['B011',['free-bays','seat','chase']],['B058',['overhead']]]){
    const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1})
    page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)})
    page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error(m.text())}})
    const query=new URLSearchParams({view:'screen',bay,q:'high',shot:'1',pause:'1'})
    await page.goto(base+'?'+query)
    await page.waitForFunction(()=>window.__rv?.state,null,{timeout:60000})
    await page.evaluate(()=>{window.__rv.start();window.__rv.advance(2.2)})
    let previous='mesh'
    for (const name of names) {
      const entry=shots.find(s=>s.name===name)
      await page.evaluate(({name,steps})=>{
        window.__rv.setDive(name==='seat'?0:1)
        for(const {call} of steps.slice(2)) if(call)window.__rv[call[0]](...call.slice(1))
        window.__rv.advance(0)
      },{name,steps:entry.steps})
      for(const mode of ['mesh','splat','hybrid']){
        if(mode!==previous){
          await page.keyboard.press('F2')
          await page.getByRole('combobox',{name:'World rendering'}).selectOption(mode)
          await page.keyboard.press('F2')
          await page.waitForFunction(()=>window.__rv.worldStatus==='ready',null,{timeout:90000})
        }
        for(let i=0;i<12;i++){await page.evaluate(()=>window.__rv.advance(0));await page.waitForTimeout(90)}
        const state=await page.evaluate(()=>({mode:window.__rv.state().mode, time:window.__rv.state().time, tris:window.__rv.passes.reality.triangles}))
        console.log(name,mode,JSON.stringify(state))
        await page.screenshot({path:dir+'/'+mode+'-'+name+'.png'})
        previous=mode
      }
    }
    await page.close()
  }
  if(errors.length)throw Error(errors.join('\n'))
}finally{await browser.close()}
