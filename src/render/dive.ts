import type { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { Tablet } from '../assets/tablet.ts'
import { clamp, lerp } from '../simulation/geometry.ts'

export const HUD_WIDTH = 1280
export const HUD_HEIGHT = 800
export const TABLET_ASPECT = HUD_WIDTH / HUD_HEIGHT
export const SCREEN_WIDTH = 0.3317
export const SCREEN_HEIGHT = SCREEN_WIDTH / TABLET_ASPECT
const APPROACH_DISTANCE = 0.155
const CROSS_FADE_SECONDS = 0.2
export type Frame = { x: number; y: number; width: number; height: number }
export const TABLET_FRAME: Frame = { x: 0, y: 0, width: HUD_WIDTH, height: HUD_HEIGHT }

export function coverFrame(aspect: number): Frame {
  const width = Math.min(HUD_WIDTH, HUD_HEIGHT * aspect)
  const height = Math.min(HUD_HEIGHT, HUD_WIDTH / aspect)
  return { x: (HUD_WIDTH - width) / 2, y: (HUD_HEIGHT - height) / 2, width, height }
}

export function blendFrame(a: Frame, b: Frame, t: number): Frame {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), width: lerp(a.width, b.width, t), height: lerp(a.height, b.height, t) }
}

export function cropReality(camera: PerspectiveCamera, frame: Frame) {
  camera.setViewOffset(HUD_WIDTH, HUD_HEIGHT, frame.x, frame.y, frame.width, frame.height)
}

export function fitTablet(tablet: Tablet, aspect: number, position: Vector3, orientation: Quaternion) {
  tablet.anchor.getWorldQuaternion(orientation)
  position.set(0, 0, APPROACH_DISTANCE)
  tablet.anchor.localToWorld(position)
  const visibleHeight = tablet.height * coverFrame(aspect).height / HUD_HEIGHT
  return 2 * Math.atan(visibleHeight / (2 * APPROACH_DISTANCE)) * 180 / Math.PI
}

export function ease(t: number) { return t * t * (3 - 2 * t) }

export class Dive {
  progress: number
  blend: number
  target: 0 | 1
  started: boolean
  private velocity = 0
  private wheelTotal = 0
  private lastWheel = -Infinity

  constructor(screen: boolean, seenHint: boolean) {
    this.target = screen ? 1 : 0
    this.progress = this.blend = this.target
    this.started = screen || seenHint
  }

  set(target: 0 | 1) {
    this.target = target
    if (target) this.started = true
  }

  wheel(deltaPixels: number, timeMs: number) {
    if (timeMs - this.lastWheel > 200 || Math.sign(this.wheelTotal) !== Math.sign(deltaPixels)) this.wheelTotal = 0
    this.lastWheel = timeMs
    this.wheelTotal += deltaPixels
    if (Math.abs(this.wheelTotal) >= 24) {
      this.set(this.wheelTotal > 0 ? 1 : 0)
      this.wheelTotal = 0
    }
  }

  update(dt: number) {
    if (this.target === 0 && this.blend > 0) {
      this.blend = Math.max(0, this.blend - dt / CROSS_FADE_SECONDS)
      return
    }
    if (this.progress !== this.target || this.velocity !== 0) {
      this.velocity += ((this.target - this.progress) * 110 - this.velocity * 19) * dt
      this.progress = clamp(this.progress + this.velocity * dt, 0, 1)
      if (Math.abs(this.target - this.progress) < 0.004 && Math.abs(this.velocity) < 0.07) {
        this.progress = this.target
        this.velocity = 0
      }
    }
    if (this.target === 1 && this.progress === 1 && this.velocity === 0) {
      this.blend = Math.min(1, this.blend + dt / CROSS_FADE_SECONDS)
    }
  }

  seek(progress: number) {
    this.progress = clamp(progress, 0, 1)
    this.velocity = 0
    this.blend = progress >= 1 ? 1 : 0
    this.set(progress > 0.5 ? 1 : 0)
  }
}
