// Self-driving proof: open ?view=screen, wait, click the real `Start Self-Driving`
// card and sample the drive every 0.5 s in real time.
// node tools/check-selfdrive.mjs <url> <wait seconds> <run seconds> [out.json] [shotDir]
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const [base = 'http://localhost:4106/', waitArg = '7', runArg = '40', out, shotDir] = process.argv.slice(2)
const wait = Number(waitArg), run = Number(runArg)
const browser = await chromium.launch({
  channel: 'chrome', headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-software-rasterizer', '--use-gl=angle', '--use-angle=d3d11', '--force_high_performance_gpu'],
})
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  const url = new URL(base)
  url.searchParams.set('view', 'screen')
  url.searchParams.set('q', 'high')
  await page.goto(url.href)
  await page.waitForFunction(() => window.__rv?.state, null, { timeout: 90_000 })
  await page.waitForTimeout(wait * 1000)
  const at = await page.evaluate(() => window.__rv.point('start'))
  if (!at) throw new Error('Start Self-Driving is not on screen')
  await page.mouse.click(at.x, at.y)
  const started = await page.evaluate(() => window.__rv.state().time)
  const samples = []
  let still = 0, longest = 0, pulledAway
  const t0 = Date.now()
  let shot = 0
  if (shotDir) mkdirSync(resolve(shotDir), { recursive: true })
  while ((Date.now() - t0) / 1000 < run) {
    await page.waitForTimeout(500)
    const s = await page.evaluate(() => {
      const st = window.__rv.state(), tr = window.__rv.traffic
      return { t: st.time, mode: st.mode, status: st.status, speed: st.speed, steer: st.steer, gear: st.gear, pose: st.pose,
        clearance: window.__rv.clearance, chevrons: window.__rv.chevrons?.().length,
        stuck: tr.stuck, maxWait: tr.maxWait, overlap: window.__rv.overlapFrames, block: window.__rv.blockReason?.() ?? '' }
    })
    s.t -= started
    if (pulledAway === undefined && Math.abs(s.speed) > 0.2) pulledAway = s.t
    still = Math.abs(s.speed) < 0.05 ? still + 0.5 : 0
    longest = Math.max(longest, still)
    samples.push(s)
    if (shotDir && (Date.now() - t0) / 1000 >= 4 + shot * 2 && shot < 6) {
      await page.screenshot({ path: resolve(shotDir, `cruise-${shot}.png`) })
      shot++
    }
  }
  const speeds = samples.map(s => Math.abs(s.speed))
  const steers = samples.map(s => s.steer)
  const accel = samples.slice(1).map((s, i) => (Math.abs(s.speed) - Math.abs(samples[i].speed)) / Math.max(0.01, s.t - samples[i].t))
  const summary = {
    wait, run, pulledAway, longestStandstill: longest,
    meanSpeedMph: speeds.reduce((a, b) => a + b, 0) / speeds.length / 0.44704,
    maxSpeedMph: Math.max(...speeds) / 0.44704,
    steerRange: [Math.min(...steers), Math.max(...steers)],
    maxAccel: Math.max(...accel), maxBrake: -Math.min(...accel),
    minClearance: Math.min(...samples.map(s => s.clearance ?? Infinity)),
    minCruisingChevrons: Math.min(...samples.filter(s => s.mode === 'cruise').map(s => s.chevrons ?? Infinity)),
    modes: [...new Set(samples.map(s => s.mode))], statuses: [...new Set(samples.map(s => s.status))],
    finalStuck: samples.at(-1).stuck, finalMaxWait: samples.at(-1).maxWait, overlapFrames: samples.at(-1).overlap, errors,
  }
  console.log(JSON.stringify(summary, null, 1))
  if (out) {
    mkdirSync(dirname(resolve(out)), { recursive: true })
    writeFileSync(resolve(out), JSON.stringify({ summary, samples }, null, 1))
  }
} finally {
  await browser.close()
}
