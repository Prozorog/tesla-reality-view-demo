// Clean frame-rate reading: 2560 × 1440, High, DPR 1, ?bot=1 park.
// Three seconds of moving reverse with the rear inset, then the switch to Parked,
// each with the per-stage CPU/GPU profile (?profile=1).
// node tools/measure-fps.mjs <url> <label> [world=mesh|splat|hybrid] [adapter=rtx|any]
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const [base = 'http://localhost:4106/', label = 'reading', world = 'mesh', adapter = 'rtx', timing = 'frozen'] = process.argv.slice(2)
const live = timing === 'live'
const results = resolve('tmp/p16/fps')
mkdirSync(results, { recursive: true })
function quiet() {
  const status = execSync('agent-tools status', { encoding: 'utf8', windowsHide: true })
  const slots = status.split(/\r?\n/).filter(line => /^slot \d+:/.test(line))
  return slots.every(line => line.endsWith('free') || line.includes('measure-fps.mjs'))
}
async function idle() {
  const deadline = Date.now() + 300000
  while (!quiet()) {
    if (Date.now() > deadline) throw Error('No uncontended measurement window')
    await new Promise(r => setTimeout(r, 2500))
  }
}
await idle()
const gpuArgs = adapter === 'rtx' ? ['--force_high_performance_gpu'] : []
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-software-rasterizer',
  '--use-gl=angle', '--use-angle=d3d11', ...gpuArgs] })
try {
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  const q = new URLSearchParams({ view: 'screen', world: world === 'mesh' ? 'mesh' : 'splat', shot: '1', bot: '1', ...(live ? {} : { pause: '1' }), profile: '1',
    ...(adapter === 'rtx' ? { q: 'high' } : {}), ...(world === 'hybrid' ? { cars: 'mesh' } : {}) })
  await page.goto(base + '?' + q)
  await page.waitForFunction(() => window.__rv?.worldPresented?.('screen'), null, { timeout: 150000 })
  const gpu = await page.evaluate(() => window.__rv.renderer)
  const tier = await page.evaluate(() => window.__rv.tier)
  if (live) {
    await page.waitForFunction(() => window.__rv.state().mode === 'reverse' && window.__rv.state().reverseProgress > 0.1, null, { timeout: 200000, polling: 250 })
  } else {
    await page.evaluate(() => window.__rv.advance(150, { mode: 'reverse', reverseProgress: 0.10 }))
    await page.waitForFunction(() => window.__rv.state().rearVisible && window.__rv.worldPresented('rear'), null, { timeout: 60000 })
    await idle()
    await page.evaluate(() => window.__rv.pause(false))
    await page.waitForTimeout(800)
  }
  const sample = (seconds, stopAt) => page.evaluate(([seconds, stopAt]) => new Promise(done => {
    window.__rv.profile.start()
    const t0 = performance.now(), phase = window.__rv.state().mode
    let frames = 0
    requestAnimationFrame(function count(now) {
      frames++
      const mode = window.__rv.state().mode
      if (now - t0 < seconds * 1000 && !(stopAt && mode === stopAt && now - t0 > 400)) return requestAnimationFrame(count)
      const profile = window.__rv.profile.stop()
      done({ frames, ms: now - t0, fps: 1000 * frames / (now - t0), phase, end: mode, profile })
    })
  }), [seconds, stopAt])
  const reverse = await sample(3)
  if (!quiet()) throw Error('Another heavy job started during the reverse sample')
  // Fast-forward to just before the end of the reverse, then sample across the switch to Parked.
  if (live) await page.waitForFunction(() => window.__rv.state().reverseProgress > 0.97, null, { timeout: 200000, polling: 100 })
  else {
    await page.evaluate(() => { window.__rv.pause(true); window.__rv.advance(150, { mode: 'reverse', reverseProgress: 0.985 }); window.__rv.pause(false) })
    await page.waitForTimeout(150)
  }
  const parked = await sample(1.6)
  const result = { label, world, timing, gpu, tier, reverse, parked, errors, contended: !quiet() }
  writeFileSync(resolve(results, `${label}-${world}-${timing}.json`), JSON.stringify(result, null, 1))
  const top = Object.entries(reverse.profile.stages).map(([k, v]) => [k, v.cpu.mean ?? 0, v.gpu.mean ?? 0, v.draws])
    .sort((a, b) => (b[1] + b[2]) - (a[1] + a[2])).slice(0, 14)
  console.log(JSON.stringify({ label, world, gpu, tier, reverseFps: reverse.fps, reverseEnd: reverse.end, parkedFps: parked.fps, parkedPhase: `${parked.phase}->${parked.end}`,
    frameMs: reverse.profile.frames, cpuMs: reverse.profile.cpu, errors: errors.length, contended: result.contended }))
  for (const [k, cpu, g, draws] of top) console.log(`${k.padEnd(28)} cpu ${cpu.toFixed(2)} ms  gpu ${g.toFixed(2)} ms  draws ${draws.toFixed(0)}`)
} finally { await browser.close() }
