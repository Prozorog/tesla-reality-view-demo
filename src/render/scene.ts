import {
  Color, Fog, HalfFloatType, LinearFilter, Mesh, MeshBasicMaterial, OrthographicCamera,
  PlaneGeometry, Raycaster, Scene, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three'
import type { Camera, PerspectiveCamera } from 'three'
import { CABIN_LAYER } from '../assets/index.ts'
import type { Assets } from '../assets/index.ts'
import { tabletPoint } from '../assets/tablet.ts'
import type { NowPlaying } from '../audio/cabin-audio.ts'
import type { Drive } from '../simulation/drive.ts'
import { bayRectangle, clamp, localPoint, rectangle, TRACK, WHEELBASE } from '../simulation/geometry.ts'
import { RealityInterface } from '../ui/interface.ts'
import type { ScreenPoint } from '../ui/interface.ts'
import { CabinWash } from './cabin-wash.ts'
import { Cameras } from './cameras.ts'
import { CarReflections } from './car-reflections.ts'
import { blendFrame, coverFrame, cropReality, ease, HUD_HEIGHT, HUD_WIDTH, TABLET_FRAME } from './dive.ts'
import type { Dive, Frame } from './dive.ts'
import { BayMarkers } from './markers.ts'
import { NIGHT_FOG_FAR, NIGHT_FOG_NEAR, nightEnvironment } from './night-light.ts'
import { RenderProfile } from './profile.ts'
import { insideSafe } from './safe-area.ts'
import { PavementLights } from './pavement-lights.ts'
import { Ribbon } from './ribbon.ts'
import { TrafficView } from './traffic-view.ts'
import { VehicleDecals } from './vehicle-decals.ts'
import { LotLighting } from './vehicle-lighting.ts'
import { WorldPicture, worldTarget } from './world-picture.ts'

import type { SplatViews, WorldMode } from './splat-views.ts'

type Tier = 'high' | 'low'
const TIERS = {
  high: { tablet: [1280, 800], rear: [480, 300], stride: 1 },
  low: { tablet: [960, 600], rear: [320, 200], stride: 2 },
}
const AXLE = new Vector3(0, 0, 1)
const EMPTY_PASS = { calls: 0, triangles: 0 }
const MIRROR_INTERVAL = 1 / 5

export class SceneView {
  readonly renderer: WebGLRenderer
  readonly rendererName: string
  readonly tier: Tier
  readonly profile?: RenderProfile
  readonly cameras: Cameras
  readonly hud: RealityInterface
  readonly canvas = document.createElement('canvas')
  private readonly scene = new Scene()
  private readonly overlays = new Scene()
  private readonly ribbon = new Ribbon()
  private readonly markers: BayMarkers
  private readonly traffic: TrafficView
  private readonly picture: WorldPicture
  private readonly tabletPicture: WebGLRenderTarget
  private readonly screenPicture = worldTarget(1, 1)
  private readonly seatPicture = new WebGLRenderTarget(1, 1, { minFilter: LinearFilter, type: HalfFloatType })
  private readonly tablet: WebGLRenderTarget
  private readonly rear: WebGLRenderTarget
  private readonly lighting: LotLighting
  private readonly cabinWash: CabinWash
  private readonly reflections?: CarReflections
  private readonly pavementLights: PavementLights
  private readonly playerDecals: ReturnType<VehicleDecals['player']>
  private readonly wheelRest
  private readonly steeringRest
  private readonly fade = new WebGLRenderTarget(1, 1)
  private readonly fadeScene = new Scene()
  private readonly fadeCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2)
  private readonly fadeMaterial = new MeshBasicMaterial({ map: this.fade.texture, transparent: true, depthWrite: false, depthTest: false })
  private readonly raycaster = new Raycaster()
  private frame = 0
  private tabletValid = false
  private rearInsetWasVisible = false
  private lastRearFrame = -Infinity
  private width = 1
  private height = 1
  private crop: Frame = TABLET_FRAME
  private markerFade = 1
  readonly passes = {
    reality: EMPTY_PASS, seat: EMPTY_PASS, rear: EMPTY_PASS, realityPeak: EMPTY_PASS, parkingPeak: EMPTY_PASS,
  }

  constructor(app: HTMLElement, drive: Drive, override: string | null, private readonly assets: Assets, instrument = false) {
    const context = this.canvas.getContext('webgl2', { alpha: false, antialias: true, powerPreference: 'high-performance' })
    if (!context) throw new Error('This simulator requires WebGL2.')
    this.cameras = new Cameras(assets.occlusion, assets.exterior.footprint)
    if (instrument) this.profile = new RenderProfile(context)
    const debug = context.getExtension('WEBGL_debug_renderer_info')
    this.rendererName = context.getParameter(debug?.UNMASKED_RENDERER_WEBGL ?? context.RENDERER) as string
    this.tier = override === 'high' || override === 'low' ? override : /NVIDIA|GeForce|Radeon RX/i.test(this.rendererName) ? 'high' : 'low'
    console.info(`Reality View WebGL renderer: ${this.rendererName} (${this.tier})`)
    this.renderer = new WebGLRenderer({ canvas: this.canvas, context })
    this.canvas.setAttribute('aria-label', 'Drive and park at Northgate')
    app.prepend(this.canvas)
    const quality = TIERS[this.tier]
    this.picture = new WorldPicture(this.tier === 'high')
    this.tablet = new WebGLRenderTarget(quality.tablet[0], quality.tablet[1], { minFilter: LinearFilter })
    this.tabletPicture = worldTarget(this.tablet.width, this.tablet.height)
    this.tablet.samples = this.tier === 'high' ? Math.min(this.renderer.capabilities.maxSamples, 4) : 0
    this.seatPicture.samples = this.tier === 'high' ? Math.min(this.renderer.capabilities.maxSamples, 2) : 0
    // Multisampled world pictures resolve thin trim, roof edges and foliage coverage.
    this.screenPicture.samples = this.tabletPicture.samples = this.tier === 'high' ? Math.min(this.renderer.capabilities.maxSamples, 4) : 0
    this.rear = new WebGLRenderTarget(quality.rear[0], quality.rear[1], { minFilter: LinearFilter })
    this.hud = new RealityInterface(this.rear.texture)
    this.markers = new BayMarkers(drive.lot)
    const decals = new VehicleDecals()
    this.lighting = new LotLighting(drive.lot)
    this.cabinWash = new CabinWash(assets.cabin.root, drive.lot.lamps)
    if (assets.exterior.reflectors) {
      this.reflections = new CarReflections(drive.lot, assets.world, assets.exterior.reflectors, this.tier === 'high')
    }
    this.traffic = new TrafficView(drive.lot, assets.passengers, this.lighting, decals, assets.parkedCars)
    this.pavementLights = new PavementLights(assets.world, assets.exterior.footprint)
    this.playerDecals = decals.player(assets.car, this.scene, assets.exterior.footprint)
    this.wheelRest = assets.exterior.wheels.map(wheel => wheel.quaternion.clone())
    this.steeringRest = assets.cabin.steeringWheel.quaternion.clone()
    assets.cabin.tablet.surface.material.map = this.tablet.texture
    assets.cabin.bindMirror(this.rear.texture)
    this.raycaster.layers.set(CABIN_LAYER)
    this.scene.background = new Color('#030306')
    this.scene.fog = new Fog('#0c0b0e', NIGHT_FOG_NEAR, NIGHT_FOG_FAR)
    this.scene.environment = nightEnvironment()
    this.scene.add(assets.world, assets.car, this.traffic.root)
    this.overlays.add(this.ribbon.mesh, this.markers.root)
    const overlay = new Mesh(new PlaneGeometry(2, 2), this.fadeMaterial)
    this.fadeCamera.position.z = 1
    this.fadeScene.add(overlay)
    this.resize()
  }

  private splats?: SplatViews
  private loadingViews?: Promise<SplatViews>
  worldMode: WorldMode = 'mesh'
  get worldStatus() { return this.splats?.status ?? (this.worldMode === 'mesh' ? 'ready' : 'loading') }

  worldPresented(pass: string) { return this.worldMode === 'mesh' || !!this.splats?.presented(pass) }

  async setWorld(mode: WorldMode, invalidate: () => void) {
    this.worldMode = mode
    if (mode !== 'mesh' && !this.splats) {
      this.loadingViews ??= import('./splat-views.ts').then(({ SplatViews }) =>
        new SplatViews(this.renderer, this.scene, this.assets.world, this.assets.occlusion, invalidate))
      this.splats = await this.loadingViews
    }
    this.splats?.setMode(this.worldMode)
    this.tabletValid = false
    invalidate()
  }

  get aspect() { return this.width / this.height }
  get targetSizes() {
    return { tablet: [this.tablet.width, this.tablet.height], rear: [this.rear.width, this.rear.height], stride: TIERS[this.tier].stride }
  }
  get renderWork() {
    return { hudRedraws: this.hud.rasterCount, parkedRefreshes: this.traffic.parkedRefreshes }
  }

  resize() {
    this.width = Math.max(1, this.canvas.parentElement!.clientWidth)
    this.height = Math.max(1, this.canvas.parentElement!.clientHeight)
    const density = Math.min(window.devicePixelRatio || 1, 2)
    this.renderer.setPixelRatio(density)
    this.renderer.setSize(this.width, this.height, false)
    const buffer = this.renderer.getDrawingBufferSize(new Vector2())
    this.fade.setSize(buffer.x, buffer.y)
    this.screenPicture.setSize(buffer.x, buffer.y)
    this.seatPicture.setSize(buffer.x, buffer.y)
    this.crop = coverFrame(this.aspect)
    this.tabletValid = false
  }

  update(dt: number, drive: Drive) {
    this.cameras.safe = this.hud.safeArea(drive, this.crop)
    this.cameras.update(dt, drive, this.aspect)
    this.assets.occlusion.fade(dt, this.cameras.reality.position, drive.pose, this.assets.exterior.footprint, drive.selectedBay)
    this.hud.update(dt, drive)
    this.ribbon.update(dt, drive)
    this.markerFade += ((drive.selectedBay ? 0.41 : 1) - this.markerFade) * (1 - Math.exp(-dt * 7))
  }

  private syncCar(drive: Drive, seatVisible: boolean) {
    const { car, exterior, cabin } = this.assets
    car.position.set(drive.pose.x, 0, drive.pose.z)
    car.rotation.y = drive.pose.h
    const turn = Math.tan(drive.steer)
    for (const [i, wheel] of exterior.wheels.entries()) {
      wheel.quaternion.copy(this.wheelRest[i])
      if (i < 2) {
        const offset = i === 0 ? -TRACK / 2 : TRACK / 2
        wheel.rotateY(Math.atan2(WHEELBASE * turn, WHEELBASE + offset * turn))
      }
      // Calipers share the hub pivot and rest pose: steer only, never the roll.
      exterior.calipers?.[i]?.quaternion.copy(wheel.quaternion)
      wheel.rotateOnAxis(AXLE, drive.roll)
    }
    cabin.root.visible = seatVisible
    if (seatVisible) {
      cabin.steeringWheel.quaternion.copy(this.steeringRest)
      cabin.steeringWheel.rotateOnAxis(cabin.steeringAxis, drive.steer * 10)
    }
    car.updateMatrixWorld(true)
    if (exterior.probes) this.lighting.sample(drive.pose, exterior.probes)
    const braking = drive.gear !== 'P' && (drive.braking || Math.abs(drive.speed) < 0.025)
    const reversing = drive.gear === 'R'
    const blink = Math.floor(drive.time * 3.1) % 2 === 0
    exterior.lights.head.material.emissiveIntensity = drive.gear !== 'P' ? 2.1 : 1.1
    exterior.lights.tail.material.emissiveIntensity = 0.85
    exterior.lights.brake.visible = braking
    exterior.lights.brake.material.emissiveIntensity = 2.45
    exterior.lights.reverse.visible = reversing
    exterior.lights.reverse.material.emissiveIntensity = 1.7
    exterior.lights.left.visible = drive.indicator > 0 && blink
    exterior.lights.right.visible = drive.indicator < 0 && blink
    exterior.lights.left.material.emissiveIntensity = exterior.lights.right.material.emissiveIntensity = 2.0
    this.pavementLights.update(drive, this.cameras.parkingMix, braking)
    this.playerDecals.updateShadow(drive.pose, drive.lot.lamps)
  }

  draw(drive: Drive, dive: Dive, music: NowPlaying, proximity: number, forceRefresh = false) {
    const seatVisible = dive.blend < 1
    this.profile?.begin('world sync')
    this.syncCar(drive, seatVisible)
    this.traffic.draw(drive)
    this.ribbon.draw(drive)
    this.profile?.end()
    const crossFade = dive.blend > 0 && dive.blend < 1
    const directVisible = dive.blend > 0
    if (this.reflections?.needsUpdate(drive.pose, this.frame)) {
      this.profile?.begin('car reflections', true)
      this.reflections.capture(this.renderer)
      this.profile?.end()
    }
    const stride = this.frame++ % TIERS[this.tier].stride === 0 || forceRefresh
    const refreshTablet = seatVisible && (stride || !this.tabletValid || crossFade)
    const uiBlend = ease(clamp((dive.progress - 0.66) / 0.34, 0, 1))
    const uiFrame = blendFrame(TABLET_FRAME, this.crop, uiBlend)
    const insetVisible = this.hud.rearVisible
    const mirrorRefresh = seatVisible && dive.progress < 0.88 && (drive.time - this.lastRearFrame >= MIRROR_INTERVAL || (forceRefresh && this.worldMode !== 'mesh'))
    this.passes.rear = EMPTY_PASS
    if (insetVisible ? stride || !this.rearInsetWasVisible : mirrorRefresh) {
      this.cameras.placeRear(this.assets, drive)
      this.renderer.setRenderTarget(this.rear)
      this.passes.rear = this.renderWorld(this.cameras.rear, 'rear')
      this.lastRearFrame = drive.time
    }
    this.rearInsetWasVisible = insetVisible
    if (refreshTablet || directVisible) {
      this.profile?.begin('markers')
      this.markers.draw(drive, this.cameras.reality, this.cameras.parkingMix, this.markerFade,
        this.hud.hover?.kind === 'bay' ? this.hud.hover.id : undefined)
      this.profile?.end()
      this.profile?.begin('hud canvas')
      // The tablet target limits text resolution until the final part of the dive.
      this.hud.setDensity(directVisible || uiBlend > 0
        ? Math.max(1.25, this.screenPicture.width / HUD_WIDTH, this.screenPicture.height / HUD_HEIGHT)
        : this.tablet.width / HUD_WIDTH)
      this.hud.draw(drive, this.markers.visible, this.cameras.rear, uiFrame, music, proximity, forceRefresh)
      this.profile?.end()
    }
    if (refreshTablet) {
      this.renderReality(this.tablet, TABLET_FRAME)
      this.tabletValid = true
    }
    if (seatVisible) {
      this.cameras.placeCabin(this.assets, drive, dive, this.aspect)
      this.cabinWash.update(drive.pose, this.cameras.seat)
      this.renderer.setRenderTarget(this.seatPicture)
      const world = this.renderWorld(this.cameras.seat, 'seat')
      const post = this.presentPicture(this.seatPicture, crossFade ? this.fade : null, this.crop, 'seat', false)
      this.passes.seat = { calls: world.calls + post.calls, triangles: world.triangles + post.triangles }
    } else {
      this.tabletValid = false
      this.passes.seat = EMPTY_PASS
    }
    if (directVisible) {
      cropReality(this.cameras.reality, this.crop)
      this.renderReality(null, this.crop)
      this.cameras.reality.clearViewOffset()
    }
    if (crossFade) {
      this.fadeMaterial.opacity = 1 - dive.blend
      this.profile?.begin('dive blend', true)
      this.drawOverlay(this.fadeScene, this.fadeCamera)
      this.profile?.end(this.renderCount())
    }
  }

  private renderWorld(camera: PerspectiveCamera, pass: string) {
    this.profile?.begin(`${pass} visibility`)
    const prepareParked = (hideBaked: boolean) => this.traffic.prepare(camera, pass, hideBaked)
    if (!this.splats || this.splats.mode === 'mesh') prepareParked(false)
    this.profile?.end()
    this.profile?.begin(`${pass} world`, true)
    this.assets.occlusion.inRealityView.value = camera === this.cameras.reality
    this.pavementLights.usePass(pass)
    let count
    if (this.splats && this.splats.mode !== 'mesh') count = this.splats.render(camera, pass, prepareParked)
    else {
      this.renderer.render(this.scene, camera)
      count = this.renderCount()
    }
    this.profile?.end(count)
    return count
  }

  private renderCount() {
    const { calls, triangles } = this.renderer.info.render
    return { calls, triangles }
  }

  private presentPicture(source: WebGLRenderTarget, target: WebGLRenderTarget | null, frame: Frame, pass: string, soften: boolean) {
    this.profile?.begin(`${pass} bloom`, true)
    const bloom = this.picture.bloom(this.renderer, source, frame)
    const bloomCount = this.renderCount()
    this.profile?.end(bloomCount)
    this.renderer.setRenderTarget(target)
    this.profile?.begin(`${pass} ${soften ? 'softness' : 'composite'}`, true)
    this.picture.draw(this.renderer, source, bloom, frame, soften)
    const composite = this.renderCount()
    this.profile?.end(composite)
    return { calls: bloomCount.calls + composite.calls, triangles: bloomCount.triangles + composite.triangles }
  }

  private renderReality(target: WebGLRenderTarget | null, frame: Frame) {
    const picture = target ? this.tabletPicture : this.screenPicture
    const pass = target ? 'tablet' : 'screen'
    this.renderer.setRenderTarget(picture)
    const count = this.renderWorld(this.cameras.reality, pass)
    const post = this.presentPicture(picture, target, frame, pass, true)
    this.profile?.begin(`${pass} overlays`, true)
    this.drawOverlay(this.overlays, this.cameras.reality)
    const overlays = this.renderCount()
    this.profile?.end(overlays)
    this.hud.showFrame(frame)
    this.profile?.begin(`${pass} hud`, true)
    this.drawOverlay(this.hud.scene, this.hud.camera)
    const hud = this.renderCount()
    this.profile?.end(hud)
    const current = {
      calls: count.calls + post.calls + overlays.calls + hud.calls,
      triangles: count.triangles + post.triangles + overlays.triangles + hud.triangles,
    }
    this.passes.reality = current
    const peak = (previous: typeof current) => ({
      calls: Math.max(previous.calls, current.calls), triangles: Math.max(previous.triangles, current.triangles),
    })
    this.passes.realityPeak = peak(this.passes.realityPeak)
    if (this.cameras.parkingMix >= 0.99) this.passes.parkingPeak = peak(this.passes.parkingPeak)
  }

  private drawOverlay(scene: Scene, camera: Camera) {
    this.renderer.autoClear = false
    this.renderer.render(scene, camera)
    this.renderer.autoClear = true
  }

  chosenBayInFrame(drive: Drive, dive: Dive) {
    const bay = drive.selectedBay
    if (!bay) return false
    const frame = dive.blend >= 0.5 ? this.crop : TABLET_FRAME
    return bayRectangle(bay).every(([x, z]) => {
      const point = new Vector3(x, 0.055, z).project(this.cameras.reality)
      const logicalX = (point.x + 1) * HUD_WIDTH / 2, logicalY = (1 - point.y) * HUD_HEIGHT / 2
      return point.z >= -1 && point.z < 1 &&
        logicalX >= frame.x && logicalX <= frame.x + frame.width &&
        logicalY >= frame.y && logicalY <= frame.y + frame.height
    })
  }

  /** One framing sample for the parking check: which view, and whether the car's box is inside the safe box. */
  framingSample(drive: Drive) {
    const camera = this.cameras.reality
    const view = new Vector3()
    camera.getWorldDirection(view)
    const pitch = Math.asin(clamp(-view.y, -1, 1)) * 180 / Math.PI
    const kind = !drive.isParkingView || this.cameras.parkingMix < 0.99 ? 'other' : pitch < 40 ? 'chase' : pitch > 70 ? 'overhead' : 'transition'
    const safe = this.hud.safeArea(drive, this.crop)
    const { rear, front, width, height } = this.assets.exterior.footprint
    const xs: number[] = [], ys: number[] = []
    for (const y of [0, height]) {
      for (const [x, z] of rectangle(drive.pose, rear, front, width / 2)) {
        const p = new Vector3(x, y, z).project(camera)
        xs.push((p.x + 1) * HUD_WIDTH / 2)
        ys.push((1 - p.y) * HUD_HEIGHT / 2)
      }
    }
    const inside = xs.every((x, i) => insideSafe(safe, x, ys[i]))
    const [cx, cz] = localPoint(drive.pose, (front + rear) / 2, 0)
    const centre = new Vector3(cx, height / 2, cz).project(camera)
    const ground = (along: number) => {
      const [x, z] = localPoint(drive.pose, along, 0)
      return new Vector3(x, 0, z).project(camera)
    }
    const nose = ground(front), tail = ground(rear)
    const frame = this.crop
    return {
      kind, pitch, inside, mode: drive.mode,
      centre: [((centre.x + 1) * HUD_WIDTH / 2 - frame.x) / frame.width, ((1 - centre.y) * HUD_HEIGHT / 2 - frame.y) / frame.height],
      boxWidth: (Math.max(...xs) - Math.min(...xs)) / frame.width,
      boxHeight: (Math.max(...ys) - Math.min(...ys)) / frame.height,
      length: Math.hypot((nose.x - tail.x) * HUD_WIDTH / 2, (nose.y - tail.y) * HUD_HEIGHT / 2),
      frame, safe,
    }
  }

  logicalPoint(clientX: number, clientY: number, dive: Dive): ScreenPoint | undefined {
    const rect = this.canvas.getBoundingClientRect()
    const x = (clientX - rect.left) / rect.width, y = (clientY - rect.top) / rect.height
    if (x < 0 || y < 0 || x > 1 || y > 1) return
    if (dive.blend >= 0.5) return { x: this.crop.x + x * this.crop.width, y: this.crop.y + y * this.crop.height }
    this.raycaster.setFromCamera(new Vector2(2 * x - 1, 1 - 2 * y), this.cameras.seat)
    const uv = this.raycaster.intersectObject(this.assets.cabin.tablet.surface, false)[0]?.uv
    if (uv) return { x: uv.x * HUD_WIDTH, y: (1 - uv.y) * HUD_HEIGHT }
  }

  windowPoint(point: ScreenPoint, dive: Dive) {
    const rect = this.canvas.getBoundingClientRect()
    if (dive.blend >= 0.5) return {
      x: rect.left + (point.x - this.crop.x) / this.crop.width * rect.width,
      y: rect.top + (point.y - this.crop.y) / this.crop.height * rect.height,
    }
    const projection = tabletPoint(this.assets.cabin.tablet, point.x / HUD_WIDTH, 1 - point.y / HUD_HEIGHT).project(this.cameras.seat)
    return { x: rect.left + (projection.x + 1) / 2 * rect.width, y: rect.top + (1 - projection.y) / 2 * rect.height }
  }
}
