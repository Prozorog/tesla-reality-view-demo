// Headlight cloud: four Reality View shots (chase, free bays, overhead, parked P)
// with the window positions of the cloud core and the asphalt beside it.
// node tools/measure-cloud.mjs <url> <outDir>   then   python tools/measure-cloud.py <outDir>
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [base = 'http://localhost:4106/', outDir = 'shots/p1.6', extra = ''] = process.argv.slice(2)
mkdirSync(resolve(outDir), { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-software-rasterizer', '--use-gl=angle', '--use-angle=d3d11', '--force_high_performance_gpu'] })
const BUMPER = 3.967
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`${base}?view=screen&q=high&shot=1&bot=1&pause=1${extra}`)
  await page.waitForFunction(() => window.__rv?.worldPresented?.('screen'), null, { timeout: 150000 })
  const points = async () => page.evaluate(BUMPER => {
    const rv = window.__rv, out = { core: [], left: [], right: [] }
    for (const along of [1.6, 2.2, 2.8, 3.4]) for (const across of [-0.35, 0, 0.35]) out.core.push(rv.groundPoint(BUMPER + along, across))
    for (const along of [1.6, 2.2, 2.8, 3.4]) for (const across of [0, 0.3]) {
      out.left.push(rv.groundPoint(BUMPER + along, 3.6 + across))
      out.right.push(rv.groundPoint(BUMPER + along, -3.6 - across))
    }
    out.state = rv.state()
    return out
  }, BUMPER)
  const shots = {}
  const take = async name => {
    await page.evaluate(() => window.__rv.advance(0.05))
    await page.waitForTimeout(400)
    shots[name] = await points()
    await page.screenshot({ path: resolve(outDir, `cloud-${name}.png`) })
  }
  await page.evaluate(() => window.__rv.advance(1.4))
  await take('chase')
  await page.evaluate(() => window.__rv.advance(40, { mode: 'ready' }))
  await page.evaluate(() => window.__rv.advance(0.6))
  await take('free-bays')
  for (let i = 0; i < 40 && await page.evaluate(() => window.__rv.state().mode !== 'reverse' || window.__rv.state().reverseProgress < 0.4); i++) {
    await page.evaluate(() => window.__rv.advance(2, { mode: 'reverse', reverseProgress: 0.45 }))
  }
  await page.waitForTimeout(1500)
  await take('overhead')
  for (let i = 0; i < 40 && await page.evaluate(() => window.__rv.state().mode !== 'parked'); i++) {
    await page.evaluate(() => window.__rv.advance(2, { mode: 'parked' }))
  }
  await page.evaluate(() => window.__rv.advance(2.5))
  await page.waitForTimeout(1500)
  await take('parked-P')
  writeFileSync(resolve(outDir, 'cloud-points.json'), JSON.stringify({ shots, errors }, null, 1))
  console.log(JSON.stringify(Object.fromEntries(Object.entries(shots).map(([k, v]) => [k, `${v.state.mode}/${v.state.gear}`])), null, 0), 'errors', errors.length)
} finally { await browser.close() }
