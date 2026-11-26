import { dot, forward, integrate, left, passengerBox, polygonClearance, wrapAngle } from './geometry.ts'
import type { Obstacle } from './geometry.ts'
import { parkedPose } from './lot.ts'
import type { Bay, Lot, ParkedCar, Point } from './lot.ts'
import type { PathPoint } from './parking.ts'
import type { CruiseRoute } from './route.ts'

export type TrafficPath = { points: PathPoint[]; length: number; station: number }

function branch(points: [Point, Point, Point, Point], station: number): TrafficPath {
  const [a, b, c, d] = points
  const samples: PathPoint[] = []
  let s = 0
  for (let i = 0; i <= 100; i++) {
    const t = i / 100, u = 1 - t
    const coord = (axis: 0 | 1) => u ** 3 * a[axis] + 3 * u * u * t * b[axis] + 3 * u * t * t * c[axis] + t ** 3 * d[axis]
    const tangent = (axis: 0 | 1) => u * u * (b[axis] - a[axis]) + 2 * u * t * (c[axis] - b[axis]) + t * t * (d[axis] - c[axis])
    const x = coord(0), z = coord(1), before = samples.at(-1)
    if (before) s += Math.hypot(x - before.x, z - before.z)
    samples.push({ x, z, h: Math.atan2(-tangent(1), tangent(0)), s, curvature: 0 })
  }
  return { points: samples, length: s, station }
}

export function streetBranches(lot: Lot, route: CruiseRoute) {
  const [x, z] = lot.entrance.pos
  // Separate inbound and outbound paths through the south hedge opening.
  const entry = route.closest([x + 6.3, z], 0).station
  const exit = route.closest([x - 11, z], 0).station
  if (route.closest([x + 6.3, z], 0).distance > 0.002) {
    // The compact cruise stays in the bay aisles. Enter its westbound lower
    // aisle through the open apron, and leave from the east end connector.
    const lower = lot.aisles.at(-1)!.points
    const middle = lot.aisles[1].points
    const merge = route.closest([lower[0][0] - 1, lower[0][1]], Math.PI).station
    const leave = route.closest([lower[0][0] + 6, (lower[0][1] + middle[0][1]) / 2], -Math.PI / 2).station
    const arrival = route.pose(merge), departure = route.pose(leave)
    const arriving = forward(arrival.h), departing = forward(departure.h)
    return {
      entry: branch([[x + 1.65, lot.street.z + 4.3], [x + 1.65, z + 2],
        [arrival.x - 4 * arriving[0], arrival.z - 4 * arriving[1]], [arrival.x, arrival.z]], merge),
      exit: branch([[departure.x, departure.z], [departure.x + 8 * departing[0], departure.z + 8 * departing[1]],
        [x - 3, z + 3.55], [x - 3, lot.street.z + 4.5]], leave),
    }
  }
  return {
    entry: branch([[x + 1.65, lot.street.z + 4.3], [x + 1.65, z + 3.55], [x + 1.65, z], [x + 6.3, z]], entry),
    exit: branch([[x - 11, z], [x - 2, z], [x - 3, z + 3.55], [x - 3, lot.street.z + 4.5]], exit),
  }
}

export function noseInPath(lot: Lot, route: CruiseRoute, bay: Bay, car: ParkedCar, obstacles: Obstacle[]): TrafficPath | undefined {
  if (bay.kind !== 'straight' && bay.kind !== 'accessible') return
  const [a, b] = lot.aisles[0].points
  const h = Math.atan2(a[1] - b[1], b[0] - a[0])
  const end = parkedPose(bay, car)
  const turn = wrapAngle(end.h - h)
  const across = left(h), nose = forward(end.h)
  const lateral = dot([end.x - a[0], end.z - a[1]], across)
  const nearby = obstacles.filter(box => box.id !== bay.id)
  for (const radius of [4.1, 4.7, 5.25, 5.8, 6.35]) {
    const curvature = Math.sign(turn) / radius
    const arc = Math.abs(turn) * radius
    const tip = integrate({ x: 0, z: 0, h }, arc, curvature)
    const straight = (lateral - dot([tip.x, tip.z], across)) / dot(nose, across)
    if (straight < 0.65) continue
    const x = end.x - tip.x - straight * nose[0], z = end.z - tip.z - straight * nose[1]
    const station = route.closest([x, z], h)
    const start = route.pose(station.station)
    if (station.distance > 0.002 || Math.abs(wrapAngle(start.h - h)) > 0.01 ||
      Math.abs(wrapAngle(route.pose(station.station - 2).h - h)) > 0.025) continue
    const length = arc + straight
    const count = Math.ceil(length / 0.085)
    const points = Array.from({ length: count + 1 }, (_, i) => {
      const s = i / count * length
      const pose = s <= arc ? integrate(start, s, curvature) : {
        x: end.x - (length - s) * nose[0], z: end.z - (length - s) * nose[1], h: end.h,
      }
      return { ...pose, s, curvature: s <= arc ? curvature : 0 }
    })
    if (points.every(pose => polygonClearance(passengerBox(bay.id, car.type, pose).polygon, nearby, 0.25) >= 0.22)) {
      return { points, length, station: station.station }
    }
  }
}
