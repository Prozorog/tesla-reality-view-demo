import { MathUtils, PerspectiveCamera, Quaternion, Vector3 } from 'three'
import type { Assets } from '../assets/index.ts'
import { CABIN_LAYER, EXTERIOR_LAYER, RIBBON_LAYER } from '../assets/index.ts'
import type { Drive } from '../simulation/drive.ts'
import { bayRectangle, CENTER_OFFSET, clamp, FRONT, lerp, localPoint, rectangle, REAR, wrapAngle } from '../simulation/geometry.ts'
import type { Bay, Pose } from '../simulation/lot.ts'
import { MARKER_RANGE } from '../simulation/occupancy.ts'
import { pathPoint } from '../simulation/parking.ts'
import { coverFrame, ease, fitTablet, HUD_HEIGHT, HUD_WIDTH, TABLET_ASPECT } from './dive.ts'
import type { Dive } from './dive.ts'
import type { LotOcclusion } from './lot-occlusion.ts'
import type { SafeArea } from './safe-area.ts'
import { CHEVRON_RANGE, markerAnchor } from './markers.ts'

const radians = MathUtils.degToRad
const BASE_SEAT_FOV = 64
const BASE_REALITY_FOV = 50
const CRUISE_BACK = 13.4
// Low enough that the horizon sits about a quarter of the way down the picture (clip B b13).
const CRUISE_LIFT = 5.8
const CRUISE_DISTANCE = Math.hypot(CRUISE_BACK, CRUISE_LIFT)
const CRUISE_ELEVATION = Math.atan2(CRUISE_LIFT, CRUISE_BACK)
const CAR_CENTER_Y = 0.64
const CRUISE_SCREEN_Y = 0.58
const FAR_VIEW = 220
// Parking framing after clip B: a chase behind the car while it drives toward
// the bay (b09–b13), straight down with the nose up near it (b14–b18).
const CHASE_ELEVATION = radians(30)
const CHASE_RANGE = 16.5
const OVERHEAD_RANGE = 16.2
const CHASE_SCREEN_Y = 0.57
const OVERHEAD_SCREEN_Y = 0.46
const OVERHEAD_MODES = new Set(['shift', 'reverse', 'parked', 'exiting'])
// The cruise chase stays behind the car: at most 24° off its heading (clip B).
const CHASE_SWING = radians(24)
const CANDIDATE_YAWS = [0, 8, -8, 16, -16, 24, -24].map(radians)

function cruiseHeading(pose: Pose, bays: Bay[], windowAspect: number, preferredYaw: number) {
  const frame = coverFrame(windowAspect)
  const [x, z] = localPoint(pose, CENTER_OFFSET, 0)
  const nearby = bays.filter(bay => Math.hypot(bay.center[0] - pose.x, bay.center[1] - pose.z) <= CHEVRON_RANGE)
  const closer = nearby.filter(bay => Math.hypot(bay.center[0] - pose.x, bay.center[1] - pose.z) <= MARKER_RANGE - 0.8)
  const candidates = closer.length >= 4 ? closer : nearby
  const tanY = Math.tan(radians(25))
  const limitX = tanY * TABLET_ASPECT * frame.width / HUD_WIDTH * 0.90
  const limitY = tanY * frame.height / HUD_HEIGHT * 0.90
  const pitch = Math.atan2(CRUISE_LIFT - CAR_CENTER_Y, CRUISE_BACK) - radians(4)
  const markerDrop = CRUISE_LIFT - 1.6
  let bestHeading = pose.h, bestCount = -1, bestCost = Infinity
  for (const offset of [clamp(wrapAngle(preferredYaw - pose.h), -CHASE_SWING, CHASE_SWING), ...CANDIDATE_YAWS]) {
    const heading = pose.h + offset
    const cos = Math.cos(heading), sin = Math.sin(heading)
    let count = 0
    for (const bay of candidates) {
      const [bx, , bz] = markerAnchor(bay, 0)
      const dx = bx - x, dz = bz - z
      const along = dx * cos - dz * sin + CRUISE_BACK
      const depth = along * Math.cos(pitch) + markerDrop * Math.sin(pitch)
      const across = dx * sin + dz * cos
      const rise = along * Math.sin(pitch) - markerDrop * Math.cos(pitch)
      if (depth > 0 && Math.abs(across) < depth * limitX && Math.abs(rise) < depth * limitY) count++
    }
    count = Math.min(4, count)
    const cost = Math.abs(offset) + 0.8 * Math.abs(wrapAngle(heading - preferredYaw))
    if (count > bestCount || count === bestCount && cost < bestCost) {
      bestCount = count
      bestCost = cost
      bestHeading = heading
    }
  }
  return bestHeading
}

export class Cameras {
  readonly reality = new PerspectiveCamera(BASE_REALITY_FOV, TABLET_ASPECT, 0.1, FAR_VIEW)
  readonly seat = new PerspectiveCamera(BASE_SEAT_FOV, TABLET_ASPECT, 0.018, FAR_VIEW)
  readonly rear = new PerspectiveCamera(110, TABLET_ASPECT, 0.035, FAR_VIEW)
  parkingMix = 0
  /** Set by the scene each frame: the picture area free of interface. */
  safe?: SafeArea
  private overheadMix = 0
  private travelHeading = 0
  private parking = false
  private parkedPitch = 0
  private parkingDolly = 0
  private cruisePull = 0
  private parkHeading = 0
  private yaw = 0
  private elevation = CRUISE_ELEVATION
  private orbitYaw?: number
  private orbitElevation?: number
  private lookYaw = 0
  private lookPitch = 0
  private wantYaw = 0
  private wantPitch = 0
  private lookHeld = false
  private initialized = false
  private readonly pivot = new Vector3()
  private readonly framingOffset = new Vector3()
  private readonly aim = new Vector3()
  private readonly tabletPosition = new Vector3()
  private readonly tabletOrientation = new Quaternion()
  private readonly eye = new Vector3()
  private readonly marker = new Vector3()

  constructor(private readonly occlusion: LotOcclusion, private readonly footprint: Assets['exterior']['footprint']) {
    this.reality.layers.enable(EXTERIOR_LAYER)
    this.reality.layers.enable(RIBBON_LAYER)
    this.seat.layers.enable(CABIN_LAYER)
    this.rear.layers.enable(EXTERIOR_LAYER)
  }

  head(x: number, y: number, held: boolean) {
    this.lookHeld = held
    if (!held) {
      this.wantYaw = -clamp(x, -1, 1) * radians(25)
      this.wantPitch = -clamp(y, -1, 1) * radians(12)
    }
  }

  orbit(dx: number, dy: number) {
    this.orbitBy(dx * 0.005, dy * 0.005)
  }

  orbitBy(yaw: number, elevation: number) {
    this.orbitYaw = (this.orbitYaw ?? this.yaw) + yaw
    this.orbitElevation = clamp((this.orbitElevation ?? this.elevation) + elevation, radians(35), radians(88))
    this.yaw = this.orbitYaw
    this.elevation = this.orbitElevation
  }

  resetOrbit() {
    this.orbitYaw = undefined
    this.orbitElevation = undefined
  }

  update(dt: number, drive: Drive, aspect: number) {
    const parking = drive.isParkingView
    if (this.parking !== parking) {
      this.resetOrbit()
      if (parking) this.parkHeading = this.travelHeading = drive.pose.h
      this.parking = parking
    }
    this.parkingMix = clamp(this.parkingMix + (parking ? 1 : -1) * dt / 1.5, 0, 1)
    const blend = ease(this.parkingMix)
    const easing = this.initialized ? 1 - Math.exp(-dt * 7) : 1
    this.parkedPitch = lerp(this.parkedPitch, drive.mode === 'parked' ? 1 : 0, easing * 0.45)
    const overhead = parking && OVERHEAD_MODES.has(drive.mode)
    this.overheadMix = this.initialized ? clamp(this.overheadMix + (overhead ? 1 : -1) * dt / 1.3, 0, 1) : overhead ? 1 : 0
    const top = ease(this.overheadMix)
    // Chase looks along the direction of travel; overhead keeps the nose pointing up.
    this.travelHeading += wrapAngle(drive.pose.h - this.travelHeading) * (this.initialized ? 1 - Math.exp(-dt * 2.4) : 1)
    this.parkHeading = this.travelHeading
    const launchHeading = blend < 1 && this.orbitYaw === undefined
      ? cruiseHeading(drive.pose, drive.freeBays, aspect, this.initialized ? this.yaw : drive.pose.h) : drive.pose.h
    const defaultYaw = launchHeading + wrapAngle(this.parkHeading - launchHeading) * blend
    // Cruise: ease slowly toward the chosen heading and never swing more than 25° off the car.
    const yawEasing = this.initialized && blend < 1 && this.orbitYaw === undefined ? 1 - Math.exp(-dt * 2.2) : easing
    this.yaw += wrapAngle((this.orbitYaw ?? defaultYaw) - this.yaw) * yawEasing
    if (this.orbitYaw === undefined && blend < 0.5) {
      this.yaw = drive.pose.h + clamp(wrapAngle(this.yaw - drive.pose.h), -radians(25), radians(25))
    }
    const parkElevation = lerp(CHASE_ELEVATION, radians(84 + 4 * this.parkedPitch), top)
    this.elevation = lerp(this.elevation, this.orbitElevation ?? lerp(CRUISE_ELEVATION, parkElevation, blend), easing)

    const [x, z] = localPoint(drive.pose, CENTER_OFFSET, 0)
    this.pivot.lerp(new Vector3(x, 0, z), easing)
    this.initialized = true
    const selected = drive.selectedBay
    const frame = coverFrame(aspect)
    // Same share of the visible picture on either display path.
    const crop = HUD_HEIGHT / frame.height
    const range = lerp(CRUISE_DISTANCE, lerp(CHASE_RANGE, OVERHEAD_RANGE, top) * crop, blend)
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw)
    // Slide the aim along the ground so the car centre sits at its target height in the frame.
    const screenY = lerp(CHASE_SCREEN_Y, OVERHEAD_SCREEN_Y, top)
    const ndcY = 1 - 2 * (frame.y + screenY * frame.height) / HUD_HEIGHT
    const ahead = selected ? -ndcY * range * Math.tan(radians(BASE_REALITY_FOV / 2)) / Math.max(0.3, Math.sin(this.elevation)) : 0
    this.framingOffset.lerp(this.marker.set(cos * ahead * blend, 0, -sin * ahead * blend), easing)
    const centerX = lerp(x, this.pivot.x, blend), centerZ = lerp(z, this.pivot.z, blend)
    const back = Math.cos(this.elevation) * range
    const lift = Math.sin(this.elevation) * range
    this.reality.position.set(centerX - cos * back, lift, centerZ + sin * back).add(this.framingOffset)
    this.aim.set(centerX, lerp(CAR_CENTER_Y, 0.15, blend), centerZ).add(this.framingOffset)
    if (blend < 1) {
      const focus = this.marker.set(x, CAR_CENTER_Y, z)
      const distance = this.reality.position.distanceTo(focus)
      const blocked = distance - this.occlusion.cameraDistance(this.reality.position, focus)
      this.cruisePull = Math.max(blocked, lerp(this.cruisePull, blocked, easing))
      const pull = clamp(this.cruisePull * (1 - blend) / distance, 0, Math.max(0, 1 - 10.5 / distance))
      this.reality.position.lerp(focus, pull)
      const camera = this.reality.position
      const horizontal = Math.hypot(x - camera.x, z - camera.z)
      const drop = (2 * CRUISE_SCREEN_Y - 1) * frame.height / HUD_HEIGHT
      const pitch = Math.atan2(CAR_CENTER_Y - camera.y, horizontal) + Math.atan(drop * Math.tan(radians(BASE_REALITY_FOV / 2)))
      this.aim.lerp(focus.set(x, camera.y + horizontal * Math.tan(pitch), z), 1 - blend)
    } else {
      this.cruisePull = 0
    }
    this.reality.lookAt(this.aim)
    this.reality.updateMatrixWorld()
    const dolly = selected && parking ? this.fitParking(drive, selected, aspect) * blend : 0
    this.parkingDolly = Math.max(dolly, lerp(this.parkingDolly, dolly, easing * 0.45))
    if (this.parkingDolly > 0.001) {
      this.reality.position.addScaledVector(this.marker.setFromMatrixColumn(this.reality.matrixWorld, 2), this.parkingDolly)
      this.reality.updateMatrixWorld()
    }
    const needed = !parking && this.parkingMix === 0
      ? this.fitCruise(drive, aspect) : BASE_REALITY_FOV
    const fov = Math.max(needed, lerp(this.reality.fov, needed, easing))
    if (Math.abs(this.reality.fov - fov) > 0.001) {
      this.reality.fov = fov
      this.reality.updateProjectionMatrix()
    }
    if (!this.lookHeld) {
      this.lookYaw = lerp(this.lookYaw, this.wantYaw, easing)
      this.lookPitch = lerp(this.lookPitch, this.wantPitch, easing)
    }
  }

  /**
   * How far to pull the camera back along its view axis so the car, the
   * heading stripe and the chosen-bay stack stay inside the safe box, and the
   * bay itself stays in the picture.
   */
  private fitParking(drive: Drive, bay: Bay, aspect: number) {
    const frame = coverFrame(aspect)
    const tanY = Math.tan(radians(BASE_REALITY_FOV / 2)), tanX = tanY * TABLET_ASPECT
    const tx = (x: number) => (2 * x / HUD_WIDTH - 1) * tanX
    const ty = (y: number) => (1 - 2 * y / HUD_HEIGHT) * tanY
    const safe = this.safe ?? { left: frame.x + 0.12 * frame.width, right: frame.x + 0.88 * frame.width,
      top: frame.y + 0.18 * frame.height, bottom: frame.y + 0.6 * frame.height }
    let needed = 0
    const within = (points: [number, number][], y: number, box: { left: number; right: number; top: number; bottom: number }, avoidInset: boolean) => {
      const left = tx(box.left), right = tx(box.right), up = ty(box.top), down = ty(box.bottom)
      let leftOfInset = 0, belowInset = 0
      const inset = avoidInset ? safe.inset : undefined
      for (const [x, z] of points) {
        const p = this.marker.set(x, y, z).applyMatrix4(this.reality.matrixWorldInverse)
        // Moving back by D maps depth -p.z to -p.z + D: solve each bound for D.
        needed = Math.max(needed, p.x / right + p.z, p.x / left + p.z, p.y / up + p.z, p.y / down + p.z)
        if (inset) {
          leftOfInset = Math.max(leftOfInset, p.x / tx(inset.x) + p.z)
          belowInset = Math.max(belowInset, p.y / ty(inset.y + inset.height) + p.z)
        }
      }
      if (inset) needed = Math.max(needed, Math.min(leftOfInset, belowInset))
    }
    const { rear, front, width, height } = this.footprint
    const car = rectangle(drive.pose, rear, front, width / 2)
    within(car, 0, safe, true)
    within(car, height, safe, true)
    // The heading stripe: up to a car length along the next part of the move.
    const path = drive.motionPath
    const stripe: [number, number][] = []
    for (let s = 0.8; s <= front - rear + 0.01; s += 0.8) {
      if (drive.mode === 'reverse' && path) {
        const left = drive.motionLength - drive.pathDistance
        if (s > left) break
        const pose = pathPoint(path, drive.pathDistance + s)
        stripe.push(localPoint(pose, rear, -0.6), localPoint(pose, rear, 0.6))
      } else if (drive.mode === 'pull-past') {
        if (s > drive.approachRemaining) break
        const pose = drive.lanePose(drive.station + s)
        stripe.push(localPoint(pose, front, -0.6), localPoint(pose, front, 0.6))
      }
    }
    if (stripe.length) within(stripe, 0.03, safe, true)
    // The stack floats about 1.5 m over the bay mouth; the bay stays in the picture.
    if (drive.mode !== 'parked' && drive.mode !== 'exiting') {
      const [sx, sz] = localPoint({ x: bay.center[0], z: bay.center[1], h: bay.heading }, bay.depth * 0.25, 0)
      within([[sx, sz]], 2.05, safe, true)
      within([[sx, sz]], 0.95, safe, true)
    }
    const margin = 0.02
    within(bayRectangle(bay), 0.06, {
      left: frame.x + margin * frame.width, right: frame.x + (1 - margin) * frame.width,
      top: frame.y + margin * frame.height, bottom: frame.y + (1 - margin) * frame.height,
    }, false)
    return needed
  }

  private fitCruise(drive: Drive, aspect: number) {
    const frame = coverFrame(aspect)
    const fits: number[] = []
    for (const bay of drive.freeBays) {
      if (Math.hypot(bay.center[0] - drive.pose.x, bay.center[1] - drive.pose.z) > CHEVRON_RANGE) continue
      const [x, y, z] = markerAnchor(bay, 0)
      const p = this.marker.set(x, y, z)
      if (this.reality.position.distanceToSquared(p) < 64) continue
      p.applyMatrix4(this.reality.matrixWorldInverse)
      if (p.z >= -this.reality.near) continue
      const fit = Math.max(Math.abs(p.x) * HUD_HEIGHT / frame.width, Math.abs(p.y) * HUD_HEIGHT / frame.height) / -p.z
      fits.push(fit)
    }
    const { rear, front, width } = this.footprint
    let fitCar = 0
    for (const [x, z] of rectangle(drive.pose, rear, front, width / 2)) {
      const p = this.marker.set(x, 0, z).applyMatrix4(this.reality.matrixWorldInverse)
      fitCar = Math.max(fitCar, -p.y * HUD_HEIGHT / (0.42 * frame.height * -p.z))
    }
    fits.sort((a, b) => a - b)
    const fit = fits[Math.min(fits.length, 4) - 1]
    const markersFov = fit === undefined ? 0 : Math.min(66, MathUtils.radToDeg(2 * Math.atan(fit * 1.18)))
    return Math.max(BASE_REALITY_FOV, MathUtils.radToDeg(2 * Math.atan(fitCar)), markersFov)
  }

  placeCabin(assets: Assets, drive: Drive, dive: Dive, aspect: number) {
    const yaw = drive.pose.h - radians(11.5) + this.lookYaw
    const pitch = -radians(16) + this.lookPitch
    assets.cabin.eye.getWorldPosition(this.eye)
    this.seat.aspect = aspect
    this.seat.position.copy(this.eye)
    this.seat.lookAt(this.aim.set(
      this.eye.x + Math.cos(yaw) * Math.cos(pitch),
      this.eye.y + Math.sin(pitch),
      this.eye.z - Math.sin(yaw) * Math.cos(pitch),
    ))
    const fittedFov = fitTablet(assets.cabin.tablet, aspect, this.tabletPosition, this.tabletOrientation)
    const flight = ease(dive.progress)
    this.seat.position.lerp(this.tabletPosition, flight)
    this.seat.quaternion.slerp(this.tabletOrientation, flight)
    this.seat.fov = lerp(BASE_SEAT_FOV, fittedFov, flight)
    this.seat.updateProjectionMatrix()
    this.seat.updateMatrixWorld()
  }

  placeRear(assets: Assets, drive: Drive) {
    assets.exterior.rearCameraMount.getWorldPosition(this.rear.position)
    this.rear.lookAt(this.aim.set(
      this.rear.position.x - Math.cos(drive.pose.h) * 4,
      0.035,
      this.rear.position.z + Math.sin(drive.pose.h) * 4,
    ))
    this.rear.updateMatrixWorld()
  }
}
