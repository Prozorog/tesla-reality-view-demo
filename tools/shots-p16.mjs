// Phase 1.6 Reality View captures matched to clip B: chase (b13, pulling past
// the bay with the stripe curving toward it) and free bays (b06, cruising).
// node tools/shots-p16.mjs <url> <outDir> [extra query]
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [base = 'http://localhost:4106/', outDir = 'shots/p1.6', extra = ''] = process.argv.slice(2)
mkdirSync(resolve(outDir), { recursive: true })
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-software-rasterizer', '--use-gl=angle', '--use-angle=d3d11', '--force_high_performance_gpu'] })
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(`${base}?view=screen&q=high&shot=1&bot=1&pause=1${extra}`)
  await page.waitForFunction(() => window.__rv?.worldPresented?.('screen'), null, { timeout: 150000 })
  const state = () => page.evaluate(() => window.__rv.state())
  const until = async (test, step = 0.25, limit = 400) => {
    for (let i = 0; i < limit && !test(await state()); i++) await page.evaluate(s => window.__rv.advance(s), step)
  }
  const take = async name => {
    await page.evaluate(() => window.__rv.advance(0.05))
    await page.waitForTimeout(1200)
    const s = await state()
    await page.screenshot({ path: resolve(outDir, `${name}.png`) })
    return { mode: s.mode, status: s.status, speed: s.speed, approachRemaining: s.approachRemaining, bay: s.bay, pose: s.pose }
  }
  const out = {}
  await until(s => s.mode === 'cruise' && s.time > 1.2)
  out['free-bays'] = await take('free-bays')
  await until(s => s.mode === 'pull-past' && s.approachRemaining < 3.2, 0.1, 1200)
  out.chase = await take('chase')
  await until(s => s.mode === 'pull-past' && s.approachRemaining < 0.6, 0.05, 400)
  out['chase-stop'] = await take('chase-stop')
  await until(s => s.mode === 'reverse' && s.reverseProgress > 0.3, 0.25, 800)
  out.overhead = await take('overhead')
  writeFileSync(resolve(outDir, 'shots-p16.json'), JSON.stringify({ out, errors }, null, 1))
  console.log(JSON.stringify(out), 'errors', errors.length)
} finally { await browser.close() }
