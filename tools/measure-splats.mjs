// High, DPR 1, 2560x1440. Use a fresh Chrome process per cold-cache reading.
import assert from 'node:assert/strict'
import { execFile, execSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
const [base='http://localhost:4106/',mode='mesh']=process.argv.slice(2)
const tmp=resolve('tmp/p14-chrome'), results=resolve('tmp/p14-results')
mkdirSync(tmp,{recursive:true});mkdirSync(results,{recursive:true})
process.env.TMP=process.env.TEMP=process.env.TMPDIR=tmp
const run=promisify(execFile)
function quiet(){
  const status=execSync('agent-tools status',{encoding:'utf8',windowsHide:true})
  const slots=status.split(/\r?\n/).filter(line=>/^slot \d+:/.test(line))
  return slots.length && slots.every(line=>line.endsWith('free') || line.includes('measure-splats.mjs'))
}
// An arriving job can share the queue during setup. Hold the frozen pose
// until the queue is clear again before sampling GPU memory and frame time.
async function idle() {
  const deadline=Date.now()+150000
  while (!quiet()) {
    if(Date.now()>deadline)throw Error('No uncontended measurement window')
    await new Promise(resolve=>setTimeout(resolve,2500))
  }
}
await idle()
const browser=await chromium.launch({channel:'chrome',args:['--enable-gpu','--ignore-gpu-blocklist','--disable-software-rasterizer',
  '--use-gl=angle','--use-angle=d3d11','--force_high_performance_gpu']})
try{
  const page=await browser.newPage({viewport:{width:2560,height:1440},deviceScaleFactor:1})
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  const q=new URLSearchParams({view:'screen',world:mode==='mesh'?'mesh':'splat',shot:'1',bot:'1',q:'high',pause:'1',
    ...(mode==='hybrid'?{cars:'mesh'}:{})})
  await page.goto(base+'?'+q)
  const loadMs=await page.evaluate(async()=>{
    return await new Promise((resolve,reject)=>{
      function ready(){
        if(performance.now()>100000)return reject(Error('World load timed out'))
        if(window.__rv?.worldPresented?.('screen'))resolve(performance.now())
        else requestAnimationFrame(ready)
      }
      ready()
    })
  })
  const gpu=await page.evaluate(()=>window.__rv.renderer)
  assert.match(gpu,/RTX 4070/)
  await page.evaluate(()=>{window.__rv.advance(150,{mode:'reverse',reverseProgress:.10})})
  await page.waitForFunction(()=>window.__rv.state().rearVisible && window.__rv.worldPresented('rear'))
  const cdp=await browser.newBrowserCDPSession()
  const gpuPID=(await cdp.send('SystemInfo.getProcessInfo')).processInfo.find(p=>p.type.toLowerCase()==='gpu')?.id
  assert(Number.isInteger(gpuPID))
  const memory=()=>run('powershell.exe',['-NoProfile','-Command',
    `$m=Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory -Filter "Name LIKE 'pid_${gpuPID}_%'"; ($m | Measure-Object DedicatedUsage -Sum).Sum`],{windowsHide:true})
  await idle()
  await page.evaluate(()=>window.__rv.pause(false))
  await page.waitForTimeout(600)
  const [reading,counter]=await Promise.all([page.evaluate(()=>new Promise(resolve=>{
    requestAnimationFrame(function begin(start){
      const phase=window.__rv.state().mode
      let frames=0
      requestAnimationFrame(function count(now){
        frames++
        if(now-start<3000)return requestAnimationFrame(count)
        const end=window.__rv.state().mode
        window.__rv.pause(true)
        resolve({frames,durationMs:now-start,fps:1000*frames/(now-start),phase,end})
      })
    })
  })),memory()])
  assert(quiet(),'Another heavy job started during the sample')
  const mb=Number(counter.stdout.trim())/1048576
  assert(mb>0 && reading.phase==='reverse' && reading.end==='reverse')
  assert.deepEqual(errors,[])
  const result={variant:mode,gpu,loadMs,...reading,dedicatedMiB:mb}
  writeFileSync(resolve(results,mode+'.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify(result))
}finally{await browser.close()}
