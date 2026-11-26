// Collision proof in the browser: a 2-minute ?bot=1 run and a 1-minute manual
// drive (W held 30 s, then S held 30 s). Samples overlap frames and stuck traffic
// every 0.5 s and saves a screenshot when a traffic car gives way.
// node tools/check-traffic.mjs <url> <outDir>
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [base = 'http://localhost:4106/', outDir = 'shots/p1.6'] = process.argv.slice(2)
mkdirSync(resolve(outDir), { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-software-rasterizer', '--use-gl=angle', '--use-angle=d3d11', '--force_high_performance_gpu'] })
const results = {}
async function run(name, query, seconds, drive) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`${base}?view=screen&q=high${query}`)
  await page.waitForFunction(() => window.__rv?.state, null, { timeout: 90000 })
  const t0 = Date.now()
  let stuck = [], forPlayer = [], maxOverlap = 0, yielded = false, givenWay = 0, maxWait = 0, modes = new Set()
  if (drive) await page.mouse.click(640, 300)
  while ((Date.now() - t0) / 1000 < seconds) {
    const t = (Date.now() - t0) / 1000
    if (drive) await drive(page, t)
    await page.waitForTimeout(500)
    const s = await page.evaluate(() => ({ overlap: window.__rv.overlapFrames, traffic: window.__rv.traffic, mode: window.__rv.state().mode }))
    maxOverlap = Math.max(maxOverlap, s.overlap)
    stuck = [...new Set([...stuck, ...s.traffic.stuck])]
    forPlayer = [...new Set([...forPlayer, ...(s.traffic.waitingForPlayer ?? [])])]
    givenWay = s.traffic.givenWay
    maxWait = Math.max(maxWait, s.traffic.maxWait)
    modes.add(s.mode)
    if (!yielded && s.traffic.yielding.length) {
      yielded = true
      // Let it back off for a moment so the gap shows.
      await page.waitForTimeout(1500)
      await page.screenshot({ path: resolve(outDir, `give-way-${name}.png`) })
    }
  }
  if (drive) await page.keyboard.up('KeyS')
  results[name] = { seconds, overlapFrames: maxOverlap, stuckEver: stuck, waitedOver18sForPlayer: forPlayer, givenWay, maxWait: +maxWait.toFixed(1), modes: [...modes], errors }
  await page.close()
}
try {
  await run('bot', '&bot=1', 120)
  let phase = 0
  await run('manual', '', 60, async (page, t) => {
    if (phase === 0) { await page.keyboard.down('KeyW'); phase = 1 }
    if (phase === 1 && t >= 30) { await page.keyboard.up('KeyW'); await page.keyboard.down('KeyS'); phase = 2 }
  })
  writeFileSync(resolve(outDir, 'traffic-proof.json'), JSON.stringify(results, null, 1))
  console.log(JSON.stringify(results, null, 1))
} finally { await browser.close() }
