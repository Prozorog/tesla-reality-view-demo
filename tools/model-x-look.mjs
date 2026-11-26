// Model X look review: the four browser studio registrations next to the photos,
// plus optional night-lot captures (chase, paint pose, overhead, side crop).
// node tools/model-x-look.mjs <base-url> <out-dir> [studio|lot|all]
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import sharp from 'sharp'

const base = process.argv[2] ?? 'http://localhost:4106/'
const out = resolve(process.argv[3] ?? 'tmp/model-x/look')
const what = process.argv[4] ?? 'studio'
const views = (process.argv[5] ?? 'side,front,rear,top').split(',')
const temp = resolve('tmp/model-x/browser')
for (const dir of [temp, out]) mkdirSync(dir, { recursive: true })
process.env.TMP = process.env.TEMP = process.env.TMPDIR = temp
const browser = await chromium.launch({ channel: 'chrome', args: [
  '--enable-gpu', '--ignore-gpu-blocklist', '--disable-software-rasterizer',
  '--use-gl=angle', '--use-angle=d3d11', '--force_high_performance_gpu',
] })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1376, height: 768 }, deviceScaleFactor: 1 })
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(e.message))
  if (what !== 'lot') {
    const rows = []
    for (const [index, angle] of views.entries()) {
      await page.goto(base + '?studio=' + angle)
      await page.waitForSelector('#app[data-ready=true]', { timeout: 120000 })
      await page.waitForTimeout(400)
      const file = resolve(out, 'studio-' + angle + '.png')
      await page.screenshot({ path: file })
      const ref = resolve('../ref/model-x-user/x-' + (angle === 'side' ? 'side-right' : angle) + '.webp')
      rows.push({ input: ref, left: 0, top: index * 768 }, { input: file, left: 1376, top: index * 768 })
    }
    await sharp({ create: { width: 2752, height: 768 * views.length, channels: 3, background: '#888' } })
      .composite(rows).jpeg({ quality: 93 }).toFile(resolve(out, 'sheet.jpg'))
  }
  if (what !== 'studio') {
    await page.setViewportSize({ width: 2560, height: 1440 })
    // Paint pose of shots/p1.5/paint-comparison.jpg (tmp/model-x/check-white-paint.mjs).
    await page.goto(base + '?bot=1&view=screen&pause=1&shot=1&q=high')
    await page.waitForFunction(() => window.__rv?.worldPresented('screen'), null, { timeout: 120000 })
    await page.evaluate(() => {
      window.__rv.advance(160, { mode: 'pull-past' })
      for (let j = 0; j < 400 && window.__rv.state().approachRemaining >= 3.9; j++) window.__rv.advance(.05)
      window.__rv.orbit(177, -23)
      window.__rv.advance(0)
    })
    await page.waitForTimeout(300)
    let [cx, cy] = await page.evaluate(() => window.__rv.framing().centre)
    await page.screenshot({ path: resolve(out, 'paint-pose.png'), clip: { x: Math.round(cx * 2560 - 262), y: Math.round(cy * 1440 - 212), width: 524, height: 465 } })
    if (what === 'paint') throw Object.assign(new Error('done'), { done: true })
    // Chase framing at the same frozen pull-past pose.
    await page.goto(base + '?bot=1&q=high&shot=1')
    await page.waitForFunction(() => window.__rv?.worldPresented('seat'), null, { timeout: 120000 })
    await page.mouse.wheel(0, 580)
    // Step the frozen simulation to the pull-past pose instead of waiting in real
    // time: the AI-driver pace varies with machine load.
    await page.evaluate(() => {
      window.__rv.pause(true)
      window.__rv.advance(160, { mode: 'pull-past' })
      for (let j = 0; j < 400 && window.__rv.state().approachRemaining >= 14; j++) window.__rv.advance(.05)
      window.__rv.pause(false)
    })
    await page.waitForFunction(() => window.__rv.state().blend === 1 && window.__rv.framing().kind === 'chase' && window.__rv.state().mode === 'pull-past' && window.__rv.state().approachRemaining < 4, null, { timeout: 60000 })
    await page.evaluate(() => window.__rv.pause(true))
    await page.waitForTimeout(300)
    await page.screenshot({ path: resolve(out, 'chase.jpg'), quality: 95 })
    ;[cx, cy] = await page.evaluate(() => window.__rv.framing().centre)
    writeFileSync(resolve(out, 'chase-centre.json'), JSON.stringify({ cx, cy }))
    await page.evaluate(() => { window.__rv.orbit(90, -23); window.__rv.advance(0) })
    await page.waitForTimeout(200)
    ;[cx, cy] = await page.evaluate(() => window.__rv.framing().centre)
    await page.screenshot({ path: resolve(out, 'side-100pct.png'), clip: { x: Math.round(cx * 2560 - 262 + 12), y: Math.round(cy * 1440 - 170 + 30), width: 525, height: 340 } })
    await page.evaluate(() => { window.__rv.orbit(0, 0); window.__rv.advance(0) })
    await page.mouse.dblclick(600, 432)
    await page.evaluate(() => window.__rv.pause(false))
    await page.waitForFunction(() => window.__rv.framing().kind === 'overhead' && window.__rv.state().mode === 'reverse', null, { timeout: 150000 })
    await page.evaluate(() => window.__rv.pause(true))
    await page.waitForTimeout(300)
    await page.screenshot({ path: resolve(out, 'overhead.jpg'), quality: 95 })
    const fallbacks = await page.evaluate(() => window.__rv.assetFallbacks)
    writeFileSync(resolve(out, 'lot.json'), JSON.stringify({ fallbacks, errors }, null, 2))
  }
} catch (error) {
  if (!error.done) throw error
} finally {
  // Chrome's GPU process can take minutes to exit on this machine; heavy reaps it.
  await Promise.race([browser.close(), new Promise(done => setTimeout(done, 4000))])
}
console.log(JSON.stringify({ out, errors }))
process.exit(0)
