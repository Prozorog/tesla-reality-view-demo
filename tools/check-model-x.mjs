// Capture the four studio registrations and one real-time, high-tier bot park.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'
import sharp from 'sharp'

const base = process.argv[2] ?? 'http://localhost:4106/'
const temp = resolve('tmp/model-x/browser')
const out = resolve('shots/p1.5')
for (const dir of [temp, out]) mkdirSync(dir, { recursive: true })
process.env.TMP = process.env.TEMP = process.env.TMPDIR = temp
const browser = await chromium.launch({ channel: 'chrome', args: [
  '--enable-gpu', '--ignore-gpu-blocklist', '--disable-software-rasterizer',
  '--use-gl=angle', '--use-angle=d3d11', '--force_high_performance_gpu',
] })
try {
  const page = await browser.newPage({ viewport: { width: 1376, height: 768 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', e => errors.push(e.message))
  const rows = []
  for (const [index, angle] of ['side', 'front', 'rear', 'top'].entries()) {
    await page.goto(base + '?studio=' + angle)
    await page.waitForSelector('#app[data-ready=true]')
    const render = await page.screenshot()
    const ref = resolve('../ref/model-x-user/x-' + (angle === 'side' ? 'side-right' : angle) + '.webp')
    rows.push({ input: ref, left: 0, top: index * 768 }, { input: render, left: 1376, top: index * 768 })
  }
  await sharp({ create: { width: 2752, height: 3072, channels: 3, background: '#888' } })
    .composite(rows).jpeg({ quality: 94 }).toFile(resolve(out, 'browser-studio.jpg'))
  await page.setViewportSize({ width: 2560, height: 1440 })
  await page.goto(base + '?bot=1&q=high&shot=1')
  await page.waitForFunction(() => window.__rv?.worldPresented('seat'), null, { timeout: 90000 })
  await page.screenshot({ path: resolve(temp, 'seat.jpg') })
  await page.mouse.wheel(0, 580)
  await page.waitForFunction(() => window.__rv.state().blend === 1 && window.__rv.framing().kind === 'chase' && window.__rv.state().mode === 'pull-past' && window.__rv.state().approachRemaining < 4, null, { timeout: 120000 })
  await page.evaluate(() => window.__rv.pause(true))
  const capture = name => page.screenshot({ path: resolve(out, name + '.jpg'), quality: 95 })
  await capture('chase')
  // Orbit the frozen chase pose, keeping the same image scale and lighting for inspection.
  const orbit = async (yaw, tilt) => page.evaluate(([y,t]) => {
    window.__rv.orbit(y,t)
    window.__rv.advance(0)
  }, [yaw, tilt])
  const crop = async (name, width, height, offsetY = 0, offsetX = 0) => {
    const [cx,cy] = await page.evaluate(() => window.__rv.framing().centre)
    await page.screenshot({ path: resolve(out, name + '.jpg'), quality: 97,
      clip: { x: Math.round(cx * 2560 - width / 2 + offsetX), y: Math.round(cy * 1440 - height / 2 + offsetY), width, height } })
  }
  await crop('tail-100pct', 270, 217, 104, -129)
  await orbit(90,-23)
  await crop('side-100pct', 525, 340, 30, 12)
  await capture('low-orbit')
  await orbit(53,0)
  await crop('nose-100pct', 278, 205, 133, 5)
  await page.mouse.dblclick(600, 432)
  await page.evaluate(() => window.__rv.pause(false))
  await page.waitForFunction(() => window.__rv.framing().kind === 'overhead' && window.__rv.state().mode === 'reverse', null, { timeout: 120000 })
  await capture('overhead')
  await page.keyboard.press('F2')
  const sample = await page.evaluate(() => new Promise(resolve => {
    requestAnimationFrame(start => {
      let frames = 0
      function count(now) {
        frames++
        if (now - start < 3000) return requestAnimationFrame(count)
        resolve({ frames, ms: now-start, fps: frames*1000/(now-start),
          f2: document.querySelector('.debug-overlay').innerText, mode: window.__rv.state().mode })
      }
      requestAnimationFrame(count)
    })
  }))
  await page.keyboard.press('F2')
  await page.waitForFunction(() => window.__rv.state().mode === 'parked', null, { timeout: 150000 })
  const result = await page.evaluate(() => ({ state: window.__rv.state(), renderer: window.__rv.renderer,
    end: window.__rv.endPose, overlaps: window.__rv.overlapFrames, fallbacks: window.__rv.assetFallbacks }))
  writeFileSync(resolve(out, 'live.json'), JSON.stringify({ ...result, sample, errors }, null, 2))
  console.log(JSON.stringify({ ...result, sample, errors }))
  assert.deepEqual(errors, [])
  assert.deepEqual(result.fallbacks, [])
  assert.equal(result.overlaps, 0)
  assert(result.end.metres < .15 && result.end.degrees < 3)
} finally {
  await browser.close()
}
