import {
  bayRearAxle, bodyRectangle, CENTER_OFFSET, clamp, CLEARANCE, distance, dot, forward, FRONT,
  HALF_WIDTH, integrate, left, lerp, localPoint, MIN_RADIUS, polygonClearance, wrapAngle,
} from './geometry.ts'
import type { Obstacle } from './geometry.ts'
import type { Bay, Lot, Point, Pose } from './lot.ts'
import type { CruiseRoute } from './route.ts'

const STEP = 0.045
// The nearest sample is at most STEP / 2 away. Its corners also rotate around the rear axle.
const SWEEP_MARGIN = STEP / 2 * (1 + Math.hypot(FRONT, HALF_WIDTH) / MIN_RADIUS)
const RAMP = 0.72
export const APPROACH = 7
export type PathPoint = Pose & { s: number; curvature: number }
export type ParkingPlan = {
  bay: Bay
  station: number
  end: Pose
  reverse: PathPoint[]
  length: number
  clearance: number
}

function reverseTurn(heading: number, turn: number, radius: number): PathPoint[] {
  const sign = Math.sign(turn)
  const length = radius * Math.abs(turn) + RAMP
  const curvature = (s: number) => -sign / radius * clamp(Math.min(s, length - s) / RAMP, 0, 1)
  const turnAngle = (s: number) => {
    if (s <= RAMP) return sign / radius * s * s / (2 * RAMP)
    if (s < length - RAMP) return sign / radius * (s - RAMP / 2)
    return turn - sign / radius * (length - s) ** 2 / (2 * RAMP)
  }
  const steps = Math.ceil(length / STEP)
  const samples: PathPoint[] = [{ x: 0, z: 0, h: heading, s: 0, curvature: 0 }]
  for (let i = 1; i <= steps; i++) {
    const s = length * i / steps
    const before = samples.at(-1)!
    const h = heading + turnAngle(s)
    const ds = -(s - before.s)
    const pose = integrate(before, ds, (h - before.h) / ds)
    samples.push({ ...pose, h, s, curvature: curvature(s) })
  }
  return samples
}

function sweptClearance(samples: Pose[], obstacles: Obstacle[], earlyOut = false) {
  let closest = Infinity
  for (const pose of samples) {
    closest = polygonClearance(bodyRectangle(pose), obstacles, closest)
    if (earlyOut && closest < CLEARANCE + SWEEP_MARGIN) break
  }
  return closest - SWEEP_MARGIN
}

export function approachPoints(route: CruiseRoute, station: number, length = APPROACH): Pose[] {
  const steps = Math.max(1, Math.ceil(length / STEP))
  return Array.from({ length: steps + 1 }, (_, i) => route.pose(station - length + length * i / steps))
}

export function planParking(lot: Lot, route: CruiseRoute, bay: Bay, obstacles: Obstacle[]): ParkingPlan | undefined {
  const end = bayRearAxle(bay)
  const nose = forward(end.h)
  let best: ParkingPlan | undefined
  for (const aisle of lot.aisles) {
    const [a, b] = [aisle.points[0], aisle.points.at(-1)!]
    const heading = Math.atan2(a[1] - b[1], b[0] - a[0])
    const away = left(heading)
    const turn = wrapAngle(end.h - heading)
    const lateral = dot([a[0] - end.x, a[1] - end.z], away)
    if (Math.abs(turn) < 0.4 || Math.abs(turn) > Math.PI / 2 + 0.001 || lateral * turn < 0 || Math.abs(lateral) > 12) continue
    for (const radius of [MIN_RADIUS, 5.95, 6.1, 6.25, 6.4, 6.6, 6.8, 7.2, 7.6]) {
      const arc = reverseTurn(heading, turn, radius)
      const tip = arc.at(-1)!
      const straight = (lateral + dot([tip.x, tip.z], away)) / dot(nose, away)
      if (straight < 0.55) continue
      const start: Point = [end.x - tip.x + straight * nose[0], end.z - tip.z + straight * nose[1]]
      const along = dot([start[0] - a[0], start[1] - a[1]], forward(heading))
      if (along < 0.32 || along > distance(a, b) - 0.32) continue
      const nearest = route.closest(start, heading)
      const atStart = route.pose(nearest.station)
      if (nearest.distance > 0.002 || Math.abs(wrapAngle(atStart.h - heading)) > 0.004) continue
      const samples = arc.map(p => ({ ...p, x: p.x + start[0], z: p.z + start[1] }))
      const steps = Math.ceil(straight / STEP)
      for (let i = 1; i <= steps; i++) {
        const ds = straight * i / steps
        samples.push({ x: end.x + (straight - ds) * nose[0], z: end.z + (straight - ds) * nose[1], h: end.h, s: tip.s + ds, curvature: 0 })
      }
      const clearance = Math.min(sweptClearance(samples, obstacles, true), sweptClearance(approachPoints(route, nearest.station), obstacles, true))
      if (clearance >= CLEARANCE && (!best || clearance > best.clearance + 0.005)) {
        best = { bay, station: nearest.station, end, reverse: samples, length: tip.s + straight, clearance }
      }
    }
  }
  return best
}

export function pathPoint(path: PathPoint[], s: number): PathPoint {
  let low = 0, high = path.length - 1
  if (s <= 0) return path[low]
  if (s >= path[high].s) return path[high]
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (path[middle].s > s) high = middle
    else low = middle
  }
  const a = path[low], b = path[high]
  const t = (s - a.s) / (b.s - a.s)
  return { x: lerp(a.x, b.x, t), z: lerp(a.z, b.z, t), h: a.h + wrapAngle(b.h - a.h) * t, s, curvature: lerp(a.curvature, b.curvature, t) }
}

export function endError(pose: Pose, bay: Bay) {
  return {
    metres: distance(localPoint(pose, CENTER_OFFSET, 0), bay.center),
    degrees: Math.abs(wrapAngle(pose.h - bay.heading)) * 180 / Math.PI,
  }
}

export function checkPlan(plan: ParkingPlan, route: CruiseRoute, obstacles: Obstacle[]) {
  return {
    clearance: sweptClearance(approachPoints(route, plan.station).concat(plan.reverse), obstacles),
    ...endError(plan.reverse.at(-1)!, plan.bay),
  }
}
