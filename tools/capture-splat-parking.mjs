import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const [base='http://localhost:4106/']=process.argv.slice(2)
const tmp=resolve('tmp/p14-chrome'), dir=resolve('tmp/p14-motion')
mkdirSync(tmp,{recursive:true}); mkdirSync(dir,{recursive:true})
process.env.TMP=process.env.TEMP=process.env.TMPDIR=tmp
const browser=await chromium.launch({channel:'chrome',args:['--enable-gpu','--ignore-gpu-blocklist','--disable-software-rasterizer',
  '--use-gl=angle','--use-angle=d3d11','--force_high_performance_gpu']})
try {
  const page=await browser.newPage({viewport:{width:1280,height:720},deviceScaleFactor:1})
  const errors=[]
  page.on('pageerror',e=>{errors.push(e.message);console.error(e.message)})
  page.on('console',m=>{if(m.type()==='error'){errors.push(m.text());console.error(m.text())}})
  await page.goto(base+'?bot=1&world=splat&q=high&shot=1')
  await page.waitForFunction(()=>window.__rv?.worldPresented('seat') && window.__rv.worldPresented('tablet'),null,{timeout:100000})
  await page.screenshot({path:resolve(dir,'seat.png')})
  await page.mouse.wheel(0,560)
  for(let i=0;i<5;i++){await page.screenshot({path:resolve(dir,'dive-'+i+'.png')});await page.waitForTimeout(70)}
  await page.waitForFunction(()=>window.__rv.state().blend===1,null,{timeout:15000})
  for(let i=0;i<5;i++){await page.screenshot({path:resolve(dir,'moving-'+i+'.png')});await page.waitForTimeout(170)}
  await page.waitForFunction(()=>window.__rv.state().mode==='reverse',null,{timeout:150000})
  for(let i=0;i<5;i++){await page.screenshot({path:resolve(dir,'reverse-'+i+'.png')});await page.waitForTimeout(200)}
  // Flip the actual F2 control during the manoeuvre; URL and simulation should
  // change independently. Keep the live run in splat mode through its finish.
  const navigationStart=await page.evaluate(()=>performance.timeOrigin)
  await page.keyboard.press('F2')
  const toggle=page.getByRole('combobox',{name:'World rendering'})
  await toggle.selectOption('hybrid')
  await page.waitForFunction(()=>location.search.includes('cars=mesh') && window.__rv.worldPresented('screen'))
  await toggle.selectOption('splat')
  await page.keyboard.press('F2')
  await page.waitForFunction(()=>!location.search.includes('cars=mesh') && window.__rv.worldPresented('screen'))
  assert.equal(await page.evaluate(()=>performance.timeOrigin),navigationStart)
  await page.waitForFunction(()=>window.__rv.state().mode==='parked',null,{timeout:150000})
  const result=await page.evaluate(()=>({state:window.__rv.state(),end:window.__rv.endPose,overlaps:window.__rv.overlapFrames,traffic:window.__rv.traffic}))
  assert.equal(result.overlaps,0);assert(result.end && result.end.metres<.15);assert.deepEqual(errors,[])
  console.log(JSON.stringify({...result,errors}))
  writeFileSync(resolve(dir,'park.json'),JSON.stringify({...result,errors},null,2))
}finally{await browser.close()}
