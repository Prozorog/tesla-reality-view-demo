import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const [base = 'http://127.0.0.1:4173/', manifestFile = 'tools/shots-s1.json'] = process.argv.slice(2)
const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
const gpuPreference = manifest.integratedGPU ? '--force_low_power_gpu' : '--force_high_performance_gpu'
const output = resolve(manifest.output)
const temp = resolve('tmp/chrome')
await mkdir(output, { recursive: true })
await mkdir(temp, { recursive: true })
process.env.TMP = process.env.TEMP = process.env.TMPDIR = temp

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: [
    '--enable-gpu', '--ignore-gpu-blocklist', '--disable-software-rasterizer',
    ...(manifest.checks?.some(entry => entry.query?.profile) ? ['--enable-webgl-developer-extensions'] : []),
    ...(process.platform === 'win32' ? ['--use-gl=angle', '--use-angle=d3d11', gpuPreference] : []),
  ],
})
async function stepThrough(page, steps, width, height) {
  for (const step of steps ?? []) {
    if (step.call) {
      const [method, ...args] = step.call
      const result = await page.evaluate(({ method, args }) => window.__rv[method](...args), { method, args })
      assert.notEqual(result, false, `Page hook ${method} rejected ${JSON.stringify(args)}`)
    } else if (step.click) {
      const handle = await page.waitForFunction(target => window.__rv.point(target), step.click, { timeout: 5000 })
        .catch(async cause => {
          const state = await page.evaluate(() => window.__rv.state())
          throw new Error(`Target ${step.click} did not appear: ${JSON.stringify(state)}`, { cause })
        })
      const point = await handle.jsonValue()
      await handle.dispose()
      assert(point && point.x >= 0 && point.x < width && point.y >= 0 && point.y < height, `Target ${step.click} is off screen`)
      await page.mouse.click(point.x, point.y)
    } else if (step.key) {
      const [method, key] = step.key
      await page.keyboard[method](key)
    } else if (step.move) {
      await page.mouse.move(...step.move)
    } else if (step.expect) {
      const state = await page.evaluate(() => window.__rv.state())
      for (const [field, value] of Object.entries(step.expect)) assert.equal(state[field], value, field)
    } else if (step.waitFor) {
      const handle = await page.waitForFunction(expected => {
        const state = window.__rv.state()
        return Object.entries(expected).every(([field, value]) => state[field] === value)
      }, step.waitFor, { timeout: step.timeoutMs ?? 5000 })
      await handle.dispose()
    } else if (step.waitForTime) {
      const handle = await page.waitForFunction(seconds => window.__rv.state().time >= seconds, step.waitForTime,
        { polling: 300, timeout: step.timeoutMs ?? 20000 })
      await handle.dispose()
    } else if (step.inRange) {
      const state = await page.evaluate(() => window.__rv.state())
      for (const [field, [minimum, maximum]] of Object.entries(step.inRange)) {
        assert(state[field] >= minimum && state[field] <= maximum, `${field} = ${state[field]} outside [${minimum}, ${maximum}]`)
      }
    } else if (step.parked) {
      const result = await page.evaluate(() => ({
        result: window.__rv.endPose, first: window.__rv.firstFreeBay,
        noOverlap: window.__rv.noOverlap, overlapFrames: window.__rv.overlapFrames, traffic: window.__rv.traffic,
        time: window.__rv.state().time,
      }))
      assert(result.result && result.noOverlap && result.overlapFrames === 0 && result.traffic.active >= 3,
        `Park with traffic failed: ${JSON.stringify(result)}`)
      assert.equal(result.result.bay, step.parked === true ? result.first : step.parked)
      assert(result.result.metres <= 0.15 && result.result.degrees <= 3)
      console.log(`Park: ${result.result.bay}, ${result.result.metres.toFixed(3)} m / ${result.result.degrees.toFixed(3)}°, ${result.overlapFrames} overlap frames, ${result.time.toFixed(1)} s, ${result.traffic.active} active traffic cars`)
    } else if (step.passes) {
      const passes = await page.evaluate(() => window.__rv.passes)
      console.log(`${step.passes}: ${JSON.stringify(passes)}`)
      const overlay = page.locator('.debug-overlay:visible')
      if (await overlay.count()) console.log(`F2 overlay:\n${await overlay.textContent()}`)
      const { calls, triangles } = passes.realityPeak
      assert(calls <= 250 && triangles <= 500_000, `Reality View budget exceeded: ${calls} draws / ${triangles} triangles`)
    } else if (step.orbitSweep) {
      const [increment, repeats] = step.orbitSweep
      const peak = await page.evaluate(({ increment, repeats }) => {
        const app = window.__rv
        const result = { calls: 0, triangles: 0, drawAngle: 0, triangleAngle: 0 }
        for (let i = 0; i < repeats; i++) {
          app.orbit(increment)
          app.advance(0)
          const { calls, triangles } = app.passes.reality
          if (calls > result.calls) { result.calls = calls; result.drawAngle = i * increment + increment }
          if (triangles > result.triangles) { result.triangles = triangles; result.triangleAngle = i * increment + increment }
        }
        return result
      }, { increment, repeats })
      console.log(`Orbit sweep peak: ${JSON.stringify(peak)}`)
      assert(peak.calls <= 250 && peak.triangles <= 500_000, `Reality View orbit budget exceeded: ${JSON.stringify(peak)}`)
    } else if (step.tabletWidth) {
      const framing = await page.evaluate(() => window.__rv.tabletFraming())
      assert(framing.fits && framing.width >= step.tabletWidth, `Tablet framing: ${JSON.stringify(framing)}`)
      console.log(`Tablet framing: ${(100 * framing.width).toFixed(2)}% of the window, all corners in frame`)
    } else if (step.absent) {
      const point = await page.evaluate(target => window.__rv.point(target), step.absent)
      assert.equal(point, undefined, `Target ${step.absent} was visible`)
    } else if (step.fps) {
      const fps = await page.evaluate(() => new Promise(resolve => {
        requestAnimationFrame(function measure(start) {
          let frames = 0
          requestAnimationFrame(function count(now) {
            frames++
            if (now - start >= 1200) resolve(frames * 1000 / (now - start))
            else requestAnimationFrame(count)
          })
        })
      }))
      console.log(`${step.fps}: ${fps.toFixed(1)} fps at ${width} × ${height}`)
    } else if (step.profile) {
      const result = await page.evaluate(async duration => {
        const app = window.__rv
        app.pause(false)
        await new Promise(resolve => setTimeout(resolve, 800))
        const start = app.state()
        const before = app.renderWork
        app.profile.start()
        await new Promise(resolve => setTimeout(resolve, duration))
        const data = app.profile.stop()
        const after = app.renderWork
        app.pause(true)
        const work = before && {
          hudRedraws: after.hudRedraws - before.hudRedraws,
          parkedRefreshes: after.parkedRefreshes - before.parkedRefreshes,
        }
        return { ...data, work, buffer: app.profile.buffer(), start, end: app.state(), passes: app.passes }
      }, manifest.profileMs ?? 2500)
      assert.deepEqual(result.buffer, [width, height])
      assert.equal(result.start.mode, step.profile)
      assert.equal(result.end.mode, step.profile)
      assert.equal(result.start.rearVisible, step.profile === 'reverse')
      assert.equal(result.end.rearVisible, step.profile === 'reverse')
      assert(result.passes.realityPeak.calls <= 250 && result.passes.realityPeak.triangles <= 500_000)
      if (step.profile === 'cruise') {
        const rearFrames = result.stages['rear world']?.cpu.n ?? 0
        if (result.start.blend === 1) {
          assert.equal(rearFrames, 0, 'Rear camera rendered at the Screen stop with the inset hidden')
        } else {
          const rate = rearFrames / (result.end.time - result.start.time)
          assert(rate >= 4.5 && rate <= 5.5, `Seat mirror refreshed at ${rate.toFixed(2)} Hz`)
        }
      }
      if (result.start.blend === 1) {
        assert(!result.stages['seat world'] && !result.stages['tablet world'], 'Cabin or tablet rendered at the Screen stop')
      }
      console.log(`Profile: ${JSON.stringify(result)}`)
    } else if (step.trafficFlow) {
      const { traffic, overlapFrames, state } = await page.evaluate(() => ({
        traffic: window.__rv.traffic, overlapFrames: window.__rv.overlapFrames, state: window.__rv.state(),
      }))
      assert.equal(state.mode, 'cruise')
      assert.equal(state.bay, null)
      assert.equal(overlapFrames, 0)
      assert.equal(traffic.stuck.length, 0, JSON.stringify(traffic))
      assert(traffic.maxWait < 18 && traffic.moving >= 3 && traffic.active <= 4, JSON.stringify(traffic))
      assert(traffic.entered > 0 && traffic.left > 0 && traffic.parked > 0 && traffic.departed > 0, JSON.stringify(traffic))
      console.log(`Unattended cruise: ${state.time.toFixed(1)} s, ${overlapFrames} overlap frames, ${JSON.stringify(traffic)}`)
    } else {
      throw new Error(`Unknown shot step: ${JSON.stringify(step)}`)
    }
  }
}

async function visit(entry, capture) {
  const [width, height] = entry.viewport ?? manifest.viewport
  if (capture) assert((entry.clip?.width ?? width) <= 1280, 'Capture width must be at most 1280 px')
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const errors = []
  const assetWarnings = []
  let result
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text())
    if (message.type() === 'warning' && /GLTFLoader|\.glb|using fallback/i.test(message.text())) assetWarnings.push(message.text())
  })
  try {
    const query = new URLSearchParams({ shot: 1, pause: 1, ...entry.query })
    const url = new URL(base)
    url.search = query.toString()
    await page.goto(url.href)
    await page.waitForFunction(() => document.querySelector('#app').dataset.ready === 'true', undefined, { timeout: 60000 })
    const { renderer, tier, targets, assetFallbacks, lodTypes } = await page.evaluate(() => window.__rv)
    if (manifest.integratedGPU) assert.match(renderer, /Intel.*Iris/i)
    if (assetFallbacks) assert.deepEqual(assetFallbacks, [], 'Asset fallback is visible')
    if (entry.lodTypes !== undefined) assert.equal(lodTypes, entry.lodTypes)
    if (entry.tier) {
      assert.equal(tier, entry.tier)
      assert.deepEqual(targets, tier === 'high'
        ? { tablet: [1280, 800], rear: [480, 300], stride: 1 }
        : { tablet: [960, 600], rear: [320, 200], stride: 2 })
    }
    await stepThrough(page, manifest.setups?.[entry.setup], width, height)
    await stepThrough(page, entry.steps, width, height)
    if (capture) {
      const type = entry.clip ? 'png' : 'jpeg'
      const path = resolve(output, `${entry.name}.${entry.clip ? 'png' : 'jpg'}`)
      await page.screenshot({ path, type, ...(entry.clip ? { clip: entry.clip } : { quality: 70 }) })
    }
    result = `${entry.name}: ${tier} · ${renderer}`
  } finally {
    await context.close()
    if (errors.length) throw new Error(`${entry.name} browser errors:\n${errors.join('\n')}`)
    if (assetWarnings.length) throw new Error(`${entry.name} GLB warnings:\n${assetWarnings.join('\n')}`)
  }
  console.log(result)
}

let completed = false
try {
  for (const entry of manifest.shots) await visit(entry, true)
  for (const entry of manifest.checks ?? []) await visit(entry, false)
  completed = true
} finally {
  // The heavy queue owns the browser process tree if its Windows pipes stay open.
  const shutdown = setTimeout(() => {
    process.stderr.write('Chrome shutdown did not finish in 8 s. Releasing the queued process.\n', () => process.exit(completed ? 0 : 1))
  }, 8000)
  try { await browser.close() } finally { clearTimeout(shutdown) }
}

// Flush results and leave Chromium transport timers out of the CLI's lifetime.
process.stdout.write('', () => process.exit(0))
