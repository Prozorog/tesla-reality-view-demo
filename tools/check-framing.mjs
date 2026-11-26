// Safe-box framing check: drive a ?bot=1 park in fixed 0.5 s steps and project
// the car's bounding box with the Reality View camera at every step.
import { chromium } from 'playwright-core'

export async function checkFraming(base, { width = 1280, height = 720, seed } = {}) {
  const browser = await chromium.launch({
    channel: 'chrome', headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--disable-software-rasterizer',
      ...(process.platform === 'win32' ? ['--use-gl=angle', '--use-angle=d3d11', '--force_high_performance_gpu'] : [])],
  })
  try {
    const page = await browser.newPage({ viewport: { width, height } })
    const errors = []
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('pageerror', error => errors.push(String(error)))
    const url = new URL(base)
    for (const [key, value] of Object.entries({ bot: '1', pause: '1', view: 'screen', q: 'high', ...(seed ? { seed } : {}) })) url.searchParams.set(key, value)
    await page.goto(url.href)
    await page.waitForFunction(() => window.__rv?.state, null, { timeout: 90_000 })
    await page.evaluate(() => window.__rv.start())
    const samples = []
    for (let t = 0; t < 180; t += 0.5) {
      await page.evaluate(() => window.__rv.advance(0.5))
      const sample = await page.evaluate(() => window.__rv.framing())
      samples.push({ t, ...sample })
      if (sample.mode === 'parked') break
    }
    const report = {}
    for (const kind of ['chase', 'overhead']) {
      const list = samples.filter(sample => sample.kind === kind)
      const inside = list.filter(sample => sample.inside).length
      const mean = key => list.length ? list.reduce((sum, sample) => sum + sample[key], 0) / list.length : NaN
      const centreX = list.length ? list.reduce((sum, s) => sum + s.centre[0], 0) / list.length : NaN
      const centreY = list.length ? list.reduce((sum, s) => sum + s.centre[1], 0) / list.length : NaN
      report[kind] = {
        samples: list.length, inside, share: list.length ? inside / list.length : 0,
        centre: [centreX, centreY], boxWidth: mean('boxWidth'), boxHeight: mean('boxHeight'), pitch: mean('pitch'),
        outside: list.filter(sample => !sample.inside).map(sample => `${sample.t}s ${sample.mode}`),
      }
    }
    return { report, parked: samples.at(-1)?.mode === 'parked', samples: samples.length, errors }
  } finally {
    await browser.close()
  }
}

if (import.meta.url === new URL(process.argv[1], 'file:').href || process.argv[1]?.endsWith('check-framing.mjs')) {
  const result = await checkFraming(process.argv[2] ?? 'http://localhost:4106/')
  printFraming(result)
}

export function printFraming({ report, parked, samples, errors }) {
  const pct = value => `${(100 * value).toFixed(1)}%`
  for (const [kind, r] of Object.entries(report)) {
    console.log(`Framing ${kind}: ${r.inside}/${r.samples} samples inside the safe box (${pct(r.share)}), ` +
      `car centre at ${pct(r.centre[0])} × ${pct(r.centre[1])}, box ${pct(r.boxWidth)} wide × ${pct(r.boxHeight)} high, pitch ${r.pitch.toFixed(1)}°` +
      (r.outside.length ? `; outside at ${r.outside.join(', ')}` : ''))
  }
  console.log(`Framing run: ${samples} samples, ${parked ? 'parked' : 'did not park'}, ${errors.length} console errors`)
  for (const error of errors) console.error(error)
  const ok = parked && !errors.length && Object.values(report).every(r => r.samples > 0 && r.share >= 0.95)
  if (!ok) process.exitCode = 1
  return ok
}
