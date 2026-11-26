import { carCatalog, parkedPose } from './lot.ts'
import type { Bay, CarType, Lot, ParkedCar, Point, Pose } from './lot.ts'

import hero from '../../public/models/hero.json' with { type: 'json' }
import footprints from '../../public/models/footprints.json' with { type: 'json' }
// Painted body stations (bumpers, body width) for drawing.
export const REAR = hero.stations.rear_bumper
export const FRONT = hero.stations.front_bumper
export const HALF_WIDTH = hero.bounding_box.body_width / 2
// Car rectangles come from the rendered mesh bounds, mirrors included
// (tools/gen-footprints.mjs). Collisions add a 5 cm margin; the parking
// planner keeps the bare rectangles and its own 0.25 m swept margin.
type Footprint = { rear: number; front: number; left: number; right: number }
export const MARGIN = footprints.margin
const typeFootprints: Record<string, Footprint> = footprints.types
const teslaFootprints: Record<string, Footprint> = footprints.teslaBays
const PLAYER: Footprint = footprints.player
export const COLLISION_FRONT = PLAYER.front + MARGIN
export const COLLISION_REAR = PLAYER.rear - MARGIN
export const COLLISION_HALF_WIDTH = Math.max(PLAYER.left, PLAYER.right) + MARGIN
export const CENTER_OFFSET = (FRONT + REAR) / 2
export const WHEELBASE = hero.wheelbase
export const TRACK = hero.track
export const WHEEL_RADIUS = hero.wheel_radius
export const MIN_RADIUS = 5.8
// Swept parking clearance for the 2.00 m Model X on the original bay layout.
export const CLEARANCE = 0.25
export const MAX_STEER = Math.atan(WHEELBASE / MIN_RADIUS)

export const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const wrapAngle = (h: number) => Math.atan2(Math.sin(h), Math.cos(h))
export const forward = (h: number): Point => [Math.cos(h), -Math.sin(h)]
export const left = (h: number): Point => [-Math.sin(h), -Math.cos(h)]
export const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1]
export const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1])

export function localPoint(pose: Pose, along: number, across: number): Point {
  const sin = Math.sin(pose.h)
  const cos = Math.cos(pose.h)
  return [pose.x + along * cos - across * sin, pose.z - along * sin - across * cos]
}

export function rectangle(pose: Pose, rear: number, front: number, halfWidth: number): Point[] {
  return [
    localPoint(pose, rear, -halfWidth), localPoint(pose, front, -halfWidth),
    localPoint(pose, front, halfWidth), localPoint(pose, rear, halfWidth),
  ]
}

export const carRectangle = (pose: Pose) => rectangle(pose, COLLISION_REAR, COLLISION_FRONT, COLLISION_HALF_WIDTH)
// The parking planner keeps its phase 1.5 body rectangle (bumpers, 2.00 m body)
// and its 0.25 m swept margin.
export const bodyRectangle = (pose: Pose) => rectangle(pose, REAR, FRONT, HALF_WIDTH)
export const bayPose = (bay: Bay): Pose => ({ x: bay.center[0], z: bay.center[1], h: bay.heading })
export const bayRectangle = (bay: Bay) => rectangle(bayPose(bay), -bay.depth / 2, bay.depth / 2, bay.width / 2)
export function bayRearAxle(bay: Bay): Pose {
  const [x, z] = localPoint(bayPose(bay), -CENTER_OFFSET, 0)
  return { x, z, h: bay.heading }
}

type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number }
export type Obstacle = { id: string; polygon: Point[]; bounds: Bounds }

function bounds(polygon: Point[]): Bounds {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  for (const [x, z] of polygon) {
    minX = Math.min(minX, x)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, maxX, minZ, maxZ }
}

export function obstacle(id: string, polygon: Point[]): Obstacle {
  return { id, polygon, bounds: bounds(polygon) }
}

export function footprintOf(type: CarType, bayId?: string): Footprint {
  const shape = (bayId && teslaFootprints[bayId]) || typeFootprints[type]
  if (shape) return shape
  const { length, width } = carCatalog[type]
  return { rear: -length / 2, front: length / 2, left: width / 2, right: width / 2 }
}

// The drawn rectangle of a passenger car, grown by `margin` (collisions use MARGIN).
export function passengerBox(id: string, type: CarType, pose: Pose, margin = MARGIN) {
  const { rear, front, left, right } = footprintOf(type, id)
  return obstacle(id, rectangle(pose, rear - margin, front + margin, Math.max(left, right) + margin))
}

// Kerbs, corrals and parked cars. The planner uses the bare drawn rectangles
// (margin 0); collisions between cars use MARGIN.
export function lotObstacles(lot: Lot, runtimeCars: ReadonlyMap<string, ParkedCar> = new Map(), margin = 0): Obstacle[] {
  const obstacles = lot.kerbs.map(kerb => obstacle(kerb.id, kerb.outline))
  for (const bay of lot.bays) {
    const car = bay.car ?? runtimeCars.get(bay.id)
    if (car) {
      obstacles.push(passengerBox(bay.id, car.type, parkedPose(bay, car), margin))
    } else if (bay.kind === 'corral') {
      obstacles.push(obstacle(bay.id, bayRectangle(bay)))
    }
  }
  return obstacles
}

function hasSeparatingAxis(from: Point[], other: Point[]) {
  for (let i = 0; i < from.length; i++) {
    const a = from[i], b = from[(i + 1) % from.length]
    const axis: Point = [b[1] - a[1], a[0] - b[0]]
    let fromMin = Infinity, fromMax = -Infinity, otherMin = Infinity, otherMax = -Infinity
    for (const p of from) {
      const v = dot(p, axis)
      fromMin = Math.min(fromMin, v)
      fromMax = Math.max(fromMax, v)
    }
    for (const p of other) {
      const v = dot(p, axis)
      otherMin = Math.min(otherMin, v)
      otherMax = Math.max(otherMax, v)
    }
    if (fromMax < otherMin || otherMax < fromMin) return true
  }
  return false
}

export function overlaps(a: Obstacle, b: Obstacle) {
  return a.bounds.maxX >= b.bounds.minX && b.bounds.maxX >= a.bounds.minX &&
    a.bounds.maxZ >= b.bounds.minZ && b.bounds.maxZ >= a.bounds.minZ &&
    !hasSeparatingAxis(a.polygon, b.polygon) && !hasSeparatingAxis(b.polygon, a.polygon)
}

function edgeDistanceSquared(vertices: Point[], edges: Point[]) {
  let result = Infinity
  for (let i = 0; i < edges.length; i++) {
    const a = edges[i], b = edges[(i + 1) % edges.length]
    const dx = b[0] - a[0], dz = b[1] - a[1]
    const lengthSquared = dx * dx + dz * dz
    for (const p of vertices) {
      const x = p[0] - a[0], z = p[1] - a[1]
      const t = lengthSquared ? clamp((x * dx + z * dz) / lengthSquared, 0, 1) : 0
      result = Math.min(result, (x - dx * t) ** 2 + (z - dz * t) ** 2)
    }
  }
  return result
}

export function polygonClearance(polygon: Point[], obstacles: Obstacle[], ceiling = Infinity): number {
  const a = bounds(polygon)
  let best = ceiling * ceiling
  for (const { polygon: other, bounds: b } of obstacles) {
    const dx = Math.max(0, a.minX - b.maxX, b.minX - a.maxX)
    const dz = Math.max(0, a.minZ - b.maxZ, b.minZ - a.maxZ)
    if (dx * dx + dz * dz >= best) continue
    if (!hasSeparatingAxis(polygon, other) && !hasSeparatingAxis(other, polygon)) return 0
    best = Math.min(best, edgeDistanceSquared(polygon, other), edgeDistanceSquared(other, polygon))
  }
  return Math.sqrt(best)
}

export function integrate(pose: Pose, metres: number, curvature: number): Pose {
  const angle = metres * curvature
  const middle = pose.h + angle / 2
  const reach = angle ? metres * Math.sin(angle / 2) / (angle / 2) : metres
  return { x: pose.x + reach * Math.cos(middle), z: pose.z - reach * Math.sin(middle), h: pose.h + angle }
}
