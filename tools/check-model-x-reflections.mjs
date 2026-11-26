// Isolate the actual lot lamp heads in the existing player probe on two frozen ticks.
// This observer lives only in the capture browser. No diagnostic switch is shipped.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import sharp from 'sharp'
const base = process.argv[2] ?? 'http://localhost:4106/'
const temp = resolve('tmp/model-x/browser')
mkdirSync(temp, { recursive: true })
process.env.TMP = process.env.TEMP = process.env.TMPDIR = temp
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist',
  '--disable-software-rasterizer', '--use-gl=angle', '--use-angle=d3d11', '--force_high_performance_gpu'] })
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  await page.addInitScript(() => {
    window.__THREE_DEVTOOLS__ = new EventTarget()
    const probe = window.probeCapture = {}
    window.__THREE_DEVTOOLS__.addEventListener('observe', ({ detail: renderer }) => {
      if (!renderer.isWebGLRenderer) return
      probe.renderer = renderer
      const render = renderer.render.bind(renderer)
      renderer.render = (scene, camera) => {
        if (camera.parent?.type === 'CubeCamera' && scene.children.some(n => n.isInstancedMesh)) {
          probe.scene = scene
          probe.cube = camera.parent
        }
        if (camera.view?.enabled && scene.getObjectByName('Bonnet')) {
          probe.world = scene
          probe.camera = camera.clone()
          probe.camera.matrixWorld.copy(camera.matrixWorld)
          probe.camera.matrixWorldInverse.copy(camera.matrixWorldInverse)
        }
        return render(scene,camera)
      }
    })
  })
  await page.goto(base + '?view=screen&shot=1&pause=1&q=high&bot=cruise')
  await page.waitForFunction(() => window.__rv?.worldPresented('screen'))
  await page.evaluate(() => { window.__rv.start(); window.__rv.advance(4); window.__rv.orbit(148,15); window.__rv.advance(0) })
  const records = []
  for (const step of [0, 4.5]) {
    const labels = await page.evaluate(t => {
      window.__rv.advance(t)
      const { scene, world, cube, camera } = window.probeCapture
      if (!scene || !world) throw Error('Could not locate the player world and reflection cube')
      const canvas = document.createElement('canvas')
      canvas.width = innerWidth
      canvas.height = innerHeight
      const ctx = canvas.getContext('2d')
      for (const [name,color] of [['Bonnet','red'],['Falcon_roof','lime']]) {
        const part = world.getObjectByName(name)
        if (!part) throw Error('Missing measured panel ' + name)
        part.traverse(mesh => {
          if (!mesh.isMesh) return
          const pos = mesh.geometry.attributes.position
          const verts = []
          for (let i=0; i<pos.count; i++) {
            const p = mesh.position.clone().fromBufferAttribute(pos,i).applyMatrix4(mesh.matrixWorld).project(camera)
            verts.push([(p.x+1)*innerWidth/2, (1-p.y)*innerHeight/2])
          }
          const idx = mesh.geometry.index.array
          ctx.fillStyle = color
          ctx.beginPath()
          for (let i=0;i<idx.length;i+=3) {
            ctx.moveTo(...verts[idx[i]])
            ctx.lineTo(...verts[idx[i+1]])
            ctx.lineTo(...verts[idx[i+2]])
            ctx.closePath()
          }
          ctx.fill()
        })
      }
      return { mask: canvas.toDataURL().split(',')[1], probe: cube.position.toArray(), time: window.__rv.state().time }
    },step)
    const yes = await page.screenshot()
    async function lamps(on) {
      await page.evaluate(visible => {
        const { scene, cube, renderer } = window.probeCapture
        for (const node of scene.children) if (node.isInstancedMesh) node.visible = visible
        cube.update(renderer,scene)
        window.__rv.advance(0)
      },on)
    }
    await lamps(false)
    const no = await page.screenshot()
    await lamps(true)
    const [a,b,m] = await Promise.all([yes,no,Buffer.from(labels.mask,'base64')].map(
      input => sharp(input).removeAlpha().raw().toBuffer()))
    const record = { time:labels.time, probe:labels.probe }
    for (const [ch,name] of ['bonnet','roof'].entries()) {
      let count=0, peak=0, pixels=0, total=0, xMoment=0, yMoment=0
      for(let i=0;i<m.length;i+=3) {
        if(m[i+ch]<230) continue
        count++
        const d = Math.max(0,(a[i]+a[i+1]+a[i+2]-b[i]-b[i+1]-b[i+2])/3)
        if(d<3) continue
        pixels++
        peak=Math.max(peak,d)
        total+=d
        xMoment+=d*((i/3)%1920)
        yMoment+=d*Math.floor(i/3/1920)
      }
      assert(count>20,'Empty '+name+' mask')
      record[name]={ count, pixels, peak, centroid:total?[xMoment/total,yMoment/total]:null }
    }
    records.push(record)
  }
  console.log(JSON.stringify(records))
  writeFileSync(resolve('shots/p1.5/reflections.json'), JSON.stringify(records,null,2))
} finally { await browser.close() }
