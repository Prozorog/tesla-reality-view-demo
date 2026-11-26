import {
  CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, OrthographicCamera, Plane, PlaneGeometry, Raycaster,
  Scene, ShaderMaterial, SRGBColorSpace, Vector2, Vector3,
} from 'three'
import type { PerspectiveCamera, Texture } from 'three'
import type { NowPlaying } from '../audio/cabin-audio.ts'
import type { Drive } from '../simulation/drive.ts'
import { clamp, integrate, localPoint, REAR, WHEELBASE } from '../simulation/geometry.ts'
import { ease, HUD_HEIGHT, HUD_WIDTH, TABLET_ASPECT } from '../render/dive.ts'
import type { Frame } from '../render/dive.ts'
import { MARKER_RANGE } from '../simulation/occupancy.ts'
import type { VisibleBayMarker } from '../render/markers.ts'
import { safeArea } from '../render/safe-area.ts'
import { contains, Panels } from './panels.ts'
import type { PanelHit } from './panels.ts'

export type ScreenPoint = { x: number; y: number }
export type Interaction = PanelHit | { kind: 'inset' } | { kind: 'bay'; id: string }
type Marker = { id: string; point: ScreenPoint; radius: number; chevron: boolean }
const GROUND = new Plane(new Vector3(0, 1, 0), 0)
const REAR_LENS_SCALE = 0.69
const REAR_LENS_CURVATURE = 0.22

function roundRect(ctx: CanvasRenderingContext2D, rect: Frame, radius: number) {
  ctx.beginPath()
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, radius)
}

export class RealityInterface {
  readonly scene = new Scene()
  readonly camera = new OrthographicCamera(0, HUD_WIDTH, HUD_HEIGHT, 0, 0.1, 20)
  rasterCount = 0
  private readonly canvas = document.createElement('canvas')
  private readonly ctx: CanvasRenderingContext2D
  private readonly texture: CanvasTexture
  private readonly rearQuad: Mesh<PlaneGeometry, ShaderMaterial>
  private readonly vector = new Vector3()
  private readonly raycaster = new Raycaster()
  private readonly panels: Panels
  private density = 1.25
  private readonly markers: Marker[] = []
  private inset?: Frame
  private rearHold = 0
  private insetProgress = 0
  private pulseTime = 0
  private pulsePoint?: ScreenPoint
  private hudState = ''
  private hudMotion = ''
  private lastPaint = -Infinity
  touch?: ScreenPoint
  hover?: Interaction

  constructor(rearTexture: Texture) {
    this.canvas.width = Math.round(HUD_WIDTH * this.density)
    this.canvas.height = Math.round(HUD_HEIGHT * this.density)
    // Use a CPU-backed canvas to avoid a cross-context GPU readback on upload.
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
    this.panels = new Panels(this.ctx)
    this.texture = new CanvasTexture(this.canvas)
    this.texture.colorSpace = SRGBColorSpace
    this.texture.minFilter = LinearFilter
    this.texture.generateMipmaps = false
    this.camera.position.z = 10
    const hud = new Mesh(new PlaneGeometry(HUD_WIDTH, HUD_HEIGHT), new MeshBasicMaterial({
      map: this.texture, transparent: true, depthWrite: false, depthTest: false,
    }))
    hud.position.set(HUD_WIDTH / 2, HUD_HEIGHT / 2, 1)
    hud.renderOrder = 2
    hud.frustumCulled = false
    this.rearQuad = new Mesh(new PlaneGeometry(1, 1), new ShaderMaterial({
      uniforms: { picture: { value: rearTexture } },
      vertexShader: `
        varying vec2 texCoord;
        void main() {
          texCoord = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D picture;
        varying vec2 texCoord;
        void main() {
          vec2 corner = abs((texCoord - 0.5) * vec2(320.0, 200.0)) - vec2(146.0, 86.0);
          float edge = length(max(corner, 0.0)) + min(max(corner.x, corner.y), 0.0) - 14.0;
          if (edge > 0.75) discard;
          vec2 ray = texCoord * 2.0 - 1.0;
          vec2 lens = ray * vec2(1.0, ${1 / TABLET_ASPECT});
          float radial = ${REAR_LENS_SCALE} / (1.0 - ${REAR_LENS_CURVATURE} * dot(lens, lens));
          gl_FragColor = vec4(texture2D(picture, 0.5 + 0.5 * ray * radial).rgb, 1.0 - smoothstep(-0.75, 0.75, edge));
          #include <colorspace_fragment>
        }
      `,
      transparent: true, depthWrite: false, depthTest: false,
    }))
    this.rearQuad.frustumCulled = false
    this.rearQuad.renderOrder = 1
    this.scene.add(this.rearQuad, hud)
  }

  get rearVisible() { return this.insetProgress > 0 }

  setDensity(requested: number) {
    const density = clamp(requested, 0.75, 2)
    if (Math.abs(density - this.density) < 0.01) return
    this.hudState = ''
    this.density = density
    this.canvas.width = Math.round(HUD_WIDTH * density)
    this.canvas.height = Math.round(HUD_HEIGHT * density)
    // A new backing size needs a new GL allocation.
    this.texture.dispose()
  }

  private parkingNoticeUntil = 0
  private wasParking = false

  update(dt: number, drive: Drive) {
    const parking = drive.status === 'Parking'
    if (parking && !this.wasParking && drive.mode === 'pull-past') this.parkingNoticeUntil = drive.time + 4
    if (drive.mode === 'idle' || drive.mode === 'cruise' || drive.mode === 'parked') this.parkingNoticeUntil = 0
    this.wasParking = parking
    this.rearHold = drive.gear === 'R' ? 1 : Math.max(0, this.rearHold - dt)
    this.insetProgress = clamp(this.insetProgress + (this.rearHold > 0 ? 1 : -1) * dt / 0.3, 0, 1)
    this.pulseTime = Math.max(0, this.pulseTime - dt)
  }

  /** Picture area free of interface for the given frame (see safe-area.ts). */
  safeArea(drive: Drive, frame: Frame) {
    return safeArea(frame, {
      notice: drive.time < this.parkingNoticeUntil,
      cancel: drive.canCancel && drive.mode !== 'reverse',
      inset: this.rearVisible,
    })
  }

  pulse(point: ScreenPoint) {
    this.pulsePoint = point
    this.pulseTime = 0.42
  }

  showFrame(frame: Frame) {
    this.camera.left = frame.x
    this.camera.right = frame.x + frame.width
    this.camera.top = HUD_HEIGHT - frame.y
    this.camera.bottom = HUD_HEIGHT - frame.y - frame.height
    this.camera.updateProjectionMatrix()
  }

  draw(drive: Drive, markers: readonly VisibleBayMarker[], rear: PerspectiveCamera, frame: Frame,
    music: NowPlaying, proximity: number, forceRefresh: boolean) {
    this.markers.length = 0
    for (const { id, x, y, radius, chevron } of markers) {
      const point = { x: (x + 1) * HUD_WIDTH / 2, y: (1 - y) * HUD_HEIGHT / 2 }
      if (contains(frame, point)) this.markers.push({ id, point, chevron, radius: clamp(radius * HUD_WIDTH / 2 + 6, 15, 110) })
    }
    // State changes refresh immediately. Clocks, progress, the inset guides,
    // and the touch cursor can share the slower animation cadence.
    const notice = drive.time < this.parkingNoticeUntil
    const state = [
      drive.mode, drive.gear, drive.isManual, drive.canStart, drive.canCancel,
      Math.round(Math.abs(drive.speed) / 0.44704), music.index, music.playing, this.rearVisible, notice,
    ].join('|')
    const motion = [
      frame.x, frame.y, frame.width, frame.height, Math.floor(Date.now() / 60_000),
      Math.floor(music.time * 15), music.duration, this.touch?.x, this.touch?.y, this.pulseTime, this.pulsePoint?.x, this.pulsePoint?.y,
      this.insetProgress, this.rearVisible && Math.round(drive.steer * 200), this.rearVisible && Math.round(proximity * 32),
    ].join('|')
    const now = performance.now()
    if (state === this.hudState && (motion === this.hudMotion || !forceRefresh && now - this.lastPaint < 1000 / 15)) return
    this.hudState = state
    this.hudMotion = motion
    this.lastPaint = now
    const ctx = this.ctx
    ctx.setTransform(this.density, 0, 0, this.density, 0, 0)
    ctx.clearRect(0, 0, HUD_WIDTH, HUD_HEIGHT)
    this.panels.draw(drive, frame, music, notice, this.touch)
    this.drawRear(drive, rear, frame, proximity)
    this.drawTouch()
    this.rasterCount++
    this.texture.needsUpdate = true
  }

  private drawRear(drive: Drive, camera: PerspectiveCamera, viewport: Frame, proximity: number) {
    this.rearQuad.visible = this.rearVisible
    this.inset = undefined
    if (!this.rearVisible) return
    const s = Math.min(viewport.width / HUD_WIDTH, viewport.height / HUD_HEIGHT)
    const width = 320 * s, height = 200 * s
    const travel = (1 - ease(this.insetProgress)) * (width + 36 * s)
    const rect = { x: viewport.x + viewport.width - width - 24 * s + travel, y: viewport.y + 52 * s, width, height }
    this.inset = rect
    this.rearQuad.position.set(rect.x + width / 2, HUD_HEIGHT - rect.y - height / 2, 0)
    this.rearQuad.scale.set(width, height, 1)
    const ctx = this.ctx
    const curvature = Math.tan(drive.steer) / WHEELBASE
    const guide = (metres: number, side: number) => {
      const pose = integrate(drive.pose, -metres, curvature)
      const [x, z] = localPoint(pose, REAR, side)
      const p = this.vector.set(x, 0.015, z).project(camera)
      // Invert the inset's division model to keep its ground guides registered.
      const r2 = p.x ** 2 + (p.y / TABLET_ASPECT) ** 2
      const radial = 2 / (REAR_LENS_SCALE + Math.sqrt(REAR_LENS_SCALE ** 2 + 4 * REAR_LENS_CURVATURE * r2))
      return { x: rect.x + (1 + p.x * radial) * width / 2, y: rect.y + (1 - p.y * radial) * height / 2 }
    }
    ctx.save()
    roundRect(ctx, rect, 14 * s)
    ctx.clip()
    const near = 0.69, far = 1.24 + proximity * 1.18
    const p1 = guide(near, -0.87), p2 = guide(far, -0.87), p3 = guide(far, 0.87), p4 = guide(near, 0.87)
    const gradient = ctx.createLinearGradient(0, (p2.y + p3.y) / 2, 0, (p1.y + p4.y) / 2)
    gradient.addColorStop(0, 'rgba(255,55,75,0.04)')
    gradient.addColorStop(0.55, `rgba(255,43,63,${0.18 + proximity * 0.43})`)
    gradient.addColorStop(1, `rgba(242,28,52,${0.40 + proximity * 0.36})`)
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.moveTo(p1.x, p1.y)
    ctx.lineTo(p2.x, p2.y)
    ctx.lineTo(p3.x, p3.y)
    ctx.lineTo(p4.x, p4.y)
    ctx.closePath()
    ctx.fill()
    for (const side of [-1, 1]) {
      ctx.beginPath()
      for (let i = 0; i <= 14; i++) {
        const p = guide(0.72 + i * 0.29, side * 0.87)
        if (i === 0) ctx.moveTo(p.x, p.y)
        else ctx.lineTo(p.x, p.y)
      }
      ctx.lineWidth = 2 * s
      ctx.strokeStyle = 'rgba(254,239,207,.86)'
      ctx.stroke()
    }
    ctx.restore()
    roundRect(ctx, rect, 14 * s)
    ctx.lineWidth = 1.3 * s
    ctx.strokeStyle = 'rgba(231,231,237,.22)'
    ctx.stroke()
  }

  private drawTouch() {
    const ctx = this.ctx
    if (this.touch) {
      ctx.beginPath()
      ctx.arc(this.touch.x, this.touch.y, 9, 0, 2 * Math.PI)
      ctx.lineWidth = 1.5
      ctx.strokeStyle = 'rgba(240,247,255,.72)'
      ctx.stroke()
    }
    if (this.pulseTime > 0 && this.pulsePoint) {
      const amount = 1 - this.pulseTime / 0.42
      ctx.beginPath()
      ctx.arc(this.pulsePoint.x, this.pulsePoint.y, 9 + amount * 21, 0, 2 * Math.PI)
      ctx.lineWidth = 2
      ctx.strokeStyle = `rgba(155,208,255,${(1 - amount) * 0.85})`
      ctx.stroke()
    }
  }

  hit(point: ScreenPoint, camera: PerspectiveCamera, drive: Drive): Interaction | undefined {
    if (this.inset && contains(this.inset, point)) return { kind: 'inset' }
    const control = this.panels.hit(point)
    if (control) return control
    if (!drive.canChoose) return
    let best: string | undefined, gap = Infinity
    for (const marker of this.markers) {
      if (!drive.traffic.isAvailable(marker.id)) continue
      const distance = Math.hypot(point.x - marker.point.x, point.y - marker.point.y)
      if (distance <= marker.radius && distance < gap) {
        best = marker.id
        gap = distance
      }
    }
    if (best) return { kind: 'bay', id: best }
    this.raycaster.setFromCamera(new Vector2(2 * point.x / HUD_WIDTH - 1, 1 - 2 * point.y / HUD_HEIGHT), camera)
    const ground = this.raycaster.ray.intersectPlane(GROUND, this.vector)
    if (!ground) return
    for (const bay of drive.freeBays) {
      const dx = ground.x - bay.center[0], dz = ground.z - bay.center[1]
      const cos = Math.cos(bay.heading), sin = Math.sin(bay.heading)
      if (Math.hypot(bay.center[0] - drive.pose.x, bay.center[1] - drive.pose.z) <= MARKER_RANGE &&
        Math.abs(dx * cos - dz * sin) <= bay.depth / 2 && Math.abs(dx * sin + dz * cos) <= bay.width / 2) {
        return { kind: 'bay', id: bay.id }
      }
    }
  }

  targetPoint(target: string): ScreenPoint | undefined {
    return this.panels.point(target) ?? this.markers.find(marker => marker.id === target)?.point
  }

  chevrons() { return this.markers.filter(marker => marker.chevron && !this.panels.hit(marker.point)) }
}
