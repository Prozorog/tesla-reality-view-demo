import { createAssets } from './assets/index.ts'
import { CabinAudio } from './audio/cabin-audio.ts'
import { Vector3 } from 'three'
import { Drive } from './simulation/drive.ts'
import { localPoint } from './simulation/geometry.ts'
import type { Controls, Mode } from './simulation/drive.ts'
import type { Lot } from './simulation/lot.ts'
import { Dive, HUD_HEIGHT, HUD_WIDTH } from './render/dive.ts'
import type { WorldMode } from './render/splat-views.ts'
import { SceneView } from './render/scene.ts'
import type { Interaction } from './ui/interface.ts'
import './style.css'

const STEP = 1 / 60
const DRIVING_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'])
const HINT_KEY = 'northgate-screen-hint-seen'
const app = document.querySelector<HTMLElement>('#app')!

function readHint() {
  try { return localStorage.getItem(HINT_KEY) === '1' } catch { return false }
}

function rememberHint() {
  try { localStorage.setItem(HINT_KEY, '1') } catch { /* Storage can be disabled. */ }
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = '') {
  const result = document.createElement(tag)
  result.className = className
  result.textContent = text
  app.append(result)
  return result
}

async function main() {
  const params = new URLSearchParams(location.search)
  const studio = params.get('studio')
  if (studio) {
    const { showModelXStudio } = await import('./render/model-x-studio.ts')
    await showModelXStudio(app, studio)
    return
  }
  const shot = params.get('shot') === '1'
  const bayId = params.get('bay') ?? undefined
  const response = await fetch(`${import.meta.env.BASE_URL}models/lot.json`)
  if (!response.ok) throw new Error(`Could not load lot.json (${response.status}).`)
  const lot: Lot = await response.json()
  const seed = shot ? lot.seed : crypto.getRandomValues(new Uint32Array(1))[0]
  const bot = params.get('bot')
  const drive = new Drive(lot, bot === '1' ? 'park' : bot === 'cruise' ? 'cruise' : undefined, seed, bayId)
  const dive = new Dive(params.get('view') === 'screen', readHint())
  const [assets] = await Promise.all([createAssets(lot), document.fonts.load('500 15px Inter')])
  const view = new SceneView(app, drive, params.get('q'), assets, params.get('profile') === '1')
  const hint = element('aside', 'seat-hint', 'Scroll to enter the screen')
  const debug = element('pre', 'debug-overlay')
  debug.hidden = true
  hint.hidden = shot || dive.started
  const keys = new Set<string>()
  let paused = params.get('pause') === '1'
  let dirty = true
  const invalidate = () => queueMicrotask(() => { dirty = true })
  const worldSelect = document.createElement('select')
  worldSelect.setAttribute('aria-label', 'World rendering')
  for (const [value, text] of [['mesh','Mesh'], ['splat','Splat'], ['hybrid','Splat + mesh cars']]) {
    worldSelect.add(new Option(text, value))
  }
  const selectWorld = (mode: WorldMode) => {
    worldSelect.value = mode
    void view.setWorld(mode, invalidate)
  }
  selectWorld(params.get('world') === 'splat' ? params.get('cars') === 'mesh' ? 'hybrid' : 'splat' : 'mesh')
  worldSelect.onchange = () => {
    const mode = worldSelect.value as WorldMode
    const url = new URL(location.href)
    url.searchParams.set('world', mode === 'mesh' ? 'mesh' : 'splat')
    if (mode === 'hybrid') url.searchParams.set('cars','mesh')
    else url.searchParams.delete('cars')
    history.replaceState(null, '', url)
    selectWorld(mode)
  }
  const worldLabel = document.createElement('label')
  worldLabel.append('World ', worldSelect)
  const details = document.createElement('span')
  debug.append(details, document.createElement('br'), worldLabel)
  let last = performance.now()
  let elapsed = 0
  let fps = 0, frameCount = 0, sampleTime = 0
  let clickTimer = 0
  const audio = new CabinAudio(import.meta.env.BASE_URL, () => { dirty = true })
  let gesture: { id: number; x: number; y: number; lastX: number; lastY: number; dragged: boolean; hit?: Interaction } | undefined

  function controls(): Controls {
    const held = (a: string, b: string) => Number(keys.has(a) || keys.has(b))
    return {
      active: keys.size > 0,
      throttle: held('KeyW', 'ArrowUp') - held('KeyS', 'ArrowDown'),
      steer: held('KeyA', 'ArrowLeft') - held('KeyD', 'ArrowRight'),
    }
  }

  function tick() {
    drive.update(STEP, controls())
    dive.update(STEP)
    view.update(STEP, drive)
  }

  function draw() {
    const proximity = drive.gear === 'R' || view.hud.rearVisible ? drive.rearProximity : 0
    audio.update(drive, dive.progress, proximity)
    view.draw(drive, dive, audio.music, proximity, paused)
    if (!hint.hidden) {
      hint.classList.toggle('dismissed', dive.started)
      if (dive.progress < 0.6) {
        const at = view.windowPoint({ x: HUD_WIDTH * 0.53, y: 0 }, dive)
        hint.style.left = `${at.x}px`
        hint.style.top = `${at.y - 12}px`
      }
    }
    if (!debug.hidden) {
      const { tablet, rear, stride } = view.targetSizes
      const traffic = drive.traffic.stats
      const pass = (label: string, count: { calls: number; triangles: number }) =>
        `${label} ${count.calls} draws / ${count.triangles.toLocaleString()} tris`
      const { reality, seat, rear: rearPass, parkingPeak } = view.passes
      details.textContent = `${view.rendererName}\n${view.tier.toUpperCase()}${fps ? ` · ${fps.toFixed(1)} FPS` : ''} · tablet ${tablet.join('×')} · rear ${rear.join('×')} · refresh 1/${stride}\n${pass('Reality View', reality)} · ${pass('Parking peak', parkingPeak)}\n${pass('Seat', seat)} · ${pass('Rear', rearPass)}\n${drive.mode} · ${drive.pose.x.toFixed(2)}, ${drive.pose.z.toFixed(2)} m · ${drive.freeBays.length} free\n${traffic.moving}/${traffic.active} moving · ${drive.overlapFrames} overlap frames · ${traffic.stuck.length} waiting over 18 s`
    }
    dirty = false
  }

  function chooseView(target: 0 | 1) {
    if (target && !dive.started && !shot) rememberHint()
    dive.set(target)
    if (paused) dive.seek(target)
    dirty = true
  }

  function action(hit?: Interaction) {
    if (hit?.kind === 'start') {
      drive.start()
      // Started from the seat: dive into the Reality View on its own, like the car does.
      if (dive.blend < 0.5) chooseView(1)
    }
    if (hit?.kind === 'cancel') drive.cancel()
    if (hit?.kind === 'bay') drive.selectBay(hit.id)
    if (hit?.kind === 'end-trip') drive.endTrip()
    if (hit?.kind === 'music-prev') audio.changeTrack(-1)
    if (hit?.kind === 'music-next') audio.changeTrack(1)
    if (hit?.kind === 'music-toggle') audio.toggle()
    dirty = true
  }

  view.canvas.addEventListener('pointermove', event => {
    const point = view.logicalPoint(event.clientX, event.clientY, dive)
    if (gesture && gesture.id === event.pointerId) {
      const g = gesture
      if (Math.hypot(event.clientX - g.x, event.clientY - g.y) > 5) g.dragged = true
      if (g.dragged && (!g.hit || g.hit.kind === 'bay')) view.cameras.orbit(event.clientX - g.lastX, event.clientY - g.lastY)
      g.lastX = event.clientX
      g.lastY = event.clientY
    }
    const rect = view.canvas.getBoundingClientRect()
    view.cameras.head(2 * (event.clientX - rect.left) / rect.width - 1, 2 * (event.clientY - rect.top) / rect.height - 1, !!point || !!gesture)
    view.hud.touch = point
    view.hud.hover = point ? view.hud.hit(point, view.cameras.reality, drive) : undefined
    view.canvas.style.cursor = gesture?.dragged ? 'grabbing' : view.hud.hover ? 'pointer' : point ? 'grab' : ''
    dirty = true
  })
  view.canvas.addEventListener('pointerleave', () => {
    view.hud.touch = view.hud.hover = undefined
    if (!gesture) view.cameras.head(0, 0, false)
    dirty = true
  })
  view.canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || gesture) return
    const point = view.logicalPoint(event.clientX, event.clientY, dive)
    const hit = point ? view.hud.hit(point, view.cameras.reality, drive) : undefined
    audio.unlock(hit?.kind !== 'music-toggle', dive.progress)
    if (!point) return
    const client = { x: event.clientX, y: event.clientY }
    gesture = { id: event.pointerId, ...client, lastX: client.x, lastY: client.y, dragged: false, hit }
    view.canvas.setPointerCapture(event.pointerId)
    audio.tap()
    view.hud.pulse(point)
    view.hud.touch = point
    dirty = true
  })
  view.canvas.addEventListener('pointerup', event => {
    if (gesture?.id !== event.pointerId) return
    const input = gesture
    gesture = undefined
    view.canvas.releasePointerCapture(event.pointerId)
    if (!input.dragged && input.hit) {
      if (dive.blend < 0.5 && event.pointerType === 'mouse') {
        window.clearTimeout(clickTimer)
        clickTimer = window.setTimeout(() => action(input.hit), 245)
      } else {
        action(input.hit)
      }
    }
    view.canvas.style.cursor = 'grab'
    dirty = true
  })
  view.canvas.addEventListener('pointercancel', () => { gesture = undefined })
  view.canvas.addEventListener('dblclick', event => {
    const point = view.logicalPoint(event.clientX, event.clientY, dive)
    if (!point) return
    if (dive.blend < 0.5) {
      window.clearTimeout(clickTimer)
      chooseView(1)
    } else if (!view.hud.hit(point, view.cameras.reality, drive)) {
      view.cameras.resetOrbit()
    }
  })
  view.canvas.addEventListener('wheel', event => {
    event.preventDefault()
    const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? view.canvas.clientHeight : 1
    const seen = dive.started
    dive.wheel(event.deltaY * scale, event.timeStamp)
    if (!seen && dive.started && !shot) rememberHint()
    if (paused) dive.seek(dive.target)
    dirty = true
  }, { passive: false })

  window.addEventListener('keydown', event => {
    if (DRIVING_KEYS.has(event.code)) {
      event.preventDefault()
      keys.add(event.code)
    }
    if (event.code === 'Space') event.preventDefault()
    if (event.code === 'Digit1' || event.code === 'Escape') chooseView(0)
    if (event.code === 'Digit2') chooseView(1)
    if ((event.code === 'Backquote' || event.code === 'F2') && !event.repeat) {
      event.preventDefault()
      debug.hidden = !debug.hidden
      fps = frameCount = sampleTime = 0
      dirty = true
    }
  })
  window.addEventListener('keyup', event => keys.delete(event.code))
  window.addEventListener('blur', () => keys.clear())
  window.addEventListener('resize', () => { view.resize(); dirty = true })

  const diagnostics = {
    worldPresented: (pass: string) => view.worldPresented(pass),
    get worldStatus() { return view.worldStatus },
    renderer: view.rendererName,
    tier: view.tier,
    targets: view.targetSizes,
    profile: view.profile && {
      start: () => view.profile!.start(), stop: () => view.profile!.stop(),
      buffer: () => [view.canvas.width, view.canvas.height],
    },
    assetFallbacks: assets.fallbacks,
    lodTypes: assets.passengers.lodTypes,
    get renderWork() { return view.renderWork },
    get passes() { return view.passes },
    firstFreeBay: drive.firstFreeBay,
    get noOverlap() { return drive.noOverlap },
    get overlapFrames() { return drive.overlapFrames },
    blockReason: () => drive.blocked ?? '',
    get longestStandstill() { return drive.longestStandstill },
    get traffic() { return { ...drive.traffic.stats, reverseStops: drive.reverseTrafficStops } },
    get endPose() { return drive.parkingResult() },
    state: () => ({
      mode: drive.mode, status: drive.status, gear: drive.gear, speed: drive.speed, steer: drive.steer, station: drive.station, pose: { ...drive.pose },
      bay: drive.selectedBay?.id ?? null, reverseProgress: drive.motionLength ? drive.pathDistance / drive.motionLength : 0,
      backingApproach: drive.motionLength - (drive.plan?.length ?? 0), approachRemaining: drive.approachRemaining,
      rearBlocked: drive.reverseBlocked, bayInFrame: view.chosenBayInFrame(drive, dive),
      dive: dive.progress, blend: dive.blend, rearVisible: view.hud.rearVisible, time: drive.time,
      runtimeCars: drive.runtimeCars.size,
      audioStarted: audio.started, musicTrack: audio.music.title, musicPlaying: audio.music.playing,
    }),
    framing: () => view.framingSample(drive),
    pause: (value: boolean) => { paused = value; elapsed = 0 },
    advance: (seconds: number, until?: { mode: Mode; reverseProgress?: number }) => {
      for (let i = 0; i < Math.round(seconds / STEP); i++) {
        tick()
        if (until?.mode === drive.mode && (until.reverseProgress === undefined ||
          drive.motionLength && drive.pathDistance / drive.motionLength >= until.reverseProgress)) break
      }
      draw()
    },
    start: () => { drive.start(); dirty = true },
    selectBay: (id: string) => { dirty = true; return drive.selectBay(id) },
    setDive: (progress: number) => { dive.seek(progress); dirty = true },
    orbit: (yaw: number, tilt = 0) => {
      view.cameras.orbitBy(yaw * Math.PI / 180, tilt * Math.PI / 180)
      view.cameras.update(0, drive, view.aspect)
      dirty = true
    },
    /** Window position of a ground point `along` m ahead of the car origin and `across` m to its left. */
    groundPoint: (along: number, across: number, height = 0.02) => {
      const [x, z] = localPoint(drive.pose, along, across)
      const p = new Vector3(x, height, z).project(view.cameras.reality)
      return view.windowPoint({ x: (p.x + 1) * HUD_WIDTH / 2, y: (1 - p.y) * HUD_HEIGHT / 2 }, dive)
    },
    point: (target: string) => {
      const point = view.hud.targetPoint(target)
      return point ? view.windowPoint(point, dive) : undefined
    },
    tabletFraming: () => {
      const rect = view.canvas.getBoundingClientRect()
      const corners = [0, HUD_WIDTH].flatMap(x => [0, HUD_HEIGHT].map(y => view.windowPoint({ x, y }, dive)))
      const xs = corners.map(p => p.x)
      return {
        width: (Math.max(...xs) - Math.min(...xs)) / rect.width,
        fits: corners.every(p => p.x >= rect.left && p.x <= rect.right && p.y >= rect.top && p.y <= rect.bottom),
      }
    },
  }
  Object.assign(window, { __rv: diagnostics })

  function frame(now: number) {
    view.profile?.beginFrame(now)
    view.profile?.begin('fixed step')
    if (!paused) {
      if (!debug.hidden) {
        frameCount++
        sampleTime += now - last
        if (sampleTime >= 1000) {
          fps = 1000 * frameCount / sampleTime
          frameCount = sampleTime = 0
        }
      }
      elapsed += Math.min((now - last) / 1000, 0.12)
      while (elapsed >= STEP) {
        tick()
        elapsed -= STEP
      }
    }
    last = now
    view.profile?.end()
    if (!paused || dirty) draw()
    view.profile?.endFrame()
    requestAnimationFrame(frame)
  }
  view.update(STEP, drive)
  draw()
  app.dataset.ready = 'true'
  requestAnimationFrame(frame)
}

void main().catch(error => {
  console.error(error)
  element('p', 'load-error', error instanceof Error ? error.message : String(error))
})
