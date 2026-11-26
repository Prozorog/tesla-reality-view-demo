// Browser checks and image inputs for the private phase 1.6.1 proof sheets.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from 'playwright-core'

const base = process.argv[2] ?? 'http://localhost:4106/'
const out = resolve('shots/p1.6.1')
const browserTemp = resolve('tmp/p161-proof-browser')
for (const path of [out, browserTemp]) mkdirSync(path, { recursive: true })
process.env.TEMP = process.env.TMP = process.env.TMPDIR = browserTemp
const lot = JSON.parse(readFileSync('public/models/lot.json', 'utf8'))
const hero = JSON.parse(readFileSync('public/models/hero.json', 'utf8'))
const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-gpu', '--ignore-gpu-blocklist',
  '--disable-software-rasterizer', '--use-gl=angle', '--use-angle=d3d11', '--force_high_performance_gpu'] })
const errors = [], taps = []

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
  const visit = async (view, bot, pause) => {
    const url = new URL(base)
    for (const [key, value] of Object.entries({ scene: 'lot', view, bot, pause, world: 'mesh', shot: '1', q: 'high' })) {
      url.searchParams.set(key, value)
    }
    await page.goto(url.href)
    await page.waitForFunction(pass => window.__rv?.worldPresented(pass), view, { timeout: 90_000 })
  }
  const screenshot = name => page.screenshot({ path: resolve(out, name + '.png') })
  const clicks = async view => {
    await visit(view, 'cruise', '0')
    await page.waitForFunction(() => window.__rv.state().speed > 1 && window.__rv.chevrons().length > 0)
    const { speed, markers } = await page.evaluate(() => ({ speed: window.__rv.state().speed, markers: window.__rv.chevrons() }))
    const marker = markers.find(p => p.x > 0 && p.x < 1280 && p.y > 0 && p.y < 720)
    assert.ok(marker, `No clickable chevron in ${view}`)
    await page.mouse.click(marker.x, marker.y)
    await page.waitForFunction(id => window.__rv.state().bay === id, marker.id, { timeout: 2500 })
    taps.push({ view, id: marker.id, mph: speed / 0.44704 })
    await screenshot(`tap-${view}`)
  }

  await visit('screen', 'cruise', '1')
  const frames = []
  for (const seconds of [4, 2, 2, 2, 2, 2]) {
    await page.evaluate(seconds => window.__rv.advance(seconds), seconds)
    const frame = await page.evaluate(bumper => {
      const rv = window.__rv
      const grid = (forward, cross) => forward.flatMap(d => cross.map(x => rv.groundPoint(d, x)))
      const core = grid([1.6, 2.2, 2.8, 3.4].map(d => bumper + d), [-0.35, 0, 0.35])
      const cross = Array.from({ length: 41 }, (_, i) => (i - 20) * 0.2)
      return { state: rv.state(), chevrons: rv.chevrons().length, core,
        sides: [grid([5.6, 6.2, 6.8, 7.4], [-3.9, -3.6]), grid([5.6, 6.2, 6.8, 7.4], [3.6, 3.9])],
        near: grid([0, 1.5, 3, 4.5], [-3.3, -2.9, 2.9, 3.3]),
        middle: grid([18, 22, 27, 31], [-1.1, 0, 1.1]),
        far: grid([37, 42, 48, 56], [-2.3, -1, 0, 1, 2.3]),
        cross: grid([bumper + 2.8], cross), crossMetres: cross }
    }, hero.stations.front_bumper)
    frames.push(frame)
    await screenshot(`cruise-${frames.length - 1}`)
  }

  const [tx, tz] = lot.trees[0]
  await page.evaluate(([x, z]) => window.__rv.frameDetail([x + 4, 4.5, z + 3], [x, 3.0, z]), [tx, tz])
  await screenshot('tree-crown')
  const west = Math.min(...lot.building.outline.map(p => p[0])), east = Math.max(...lot.building.outline.map(p => p[0]))
  const front = Math.max(...lot.building.outline.map(p => p[1])), signX = west + (east - west) * 0.17
  await page.evaluate(([x, h, z]) => window.__rv.frameDetail([x + 4, h + 2.5, z + 13], [x, h - 0.8, z]), [signX, lot.building.height, front])
  await screenshot('oriel-fig')

  await visit('screen', '1', '1')
  await page.evaluate(() => { window.__rv.advance(220, { mode: 'parked' }); window.__rv.advance(3) })
  const parked = await page.evaluate(() => window.__rv.state())
  if (parked.mode === 'parked') await screenshot('model-x-parked-top')
  try {
    await clicks('screen')
    await clicks('seat')
  } finally {
    writeFileSync(resolve(out, 'lot-tails.json'), JSON.stringify({ frames, taps, parked, errors }, null, 2))
  }
  assert.equal(parked.mode, 'parked')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ chevrons: frames.map(f => f.chevrons), taps, parked: parked.bay, errors }))
} finally {
  await browser.close()
}
