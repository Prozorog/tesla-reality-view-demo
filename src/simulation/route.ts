import { clamp, distance, lerp, wrapAngle } from './geometry.ts'
import type { Point, Pose } from './lot.ts'

type Segment = { a: Point; b: Point; start: number; length: number; h: number }
type Aisle = { id: string; points: Point[] }
type Lane = { start: number; end: number; offset: number }
type Scale = number | ((station: number) => number)
// How far right of the aisle line the cruising car keeps (metres). The aisle
// lines are the parking launch lines; the car returns to them before a pull-past.
export const LANE_OFFSETS: Record<string, number> = { A1: 1.3, A2: 1.0, A3: 0.5 }
const LANE_FADE = 14
const smooth = (t: number) => {
  const x = clamp(t, 0, 1)
  return x * x * (3 - 2 * x)
}

export class CruiseRoute {
  readonly segments: Segment[]
  readonly length: number
  private readonly lanes: Lane[] = []

  constructor(points: Point[], aisles: Aisle[] = []) {
    let start = 0
    this.segments = []
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length]
      const length = distance(a, b)
      if (length < 1e-6) continue
      this.segments.push({ a, b, start, length, h: Math.atan2(a[1] - b[1], b[0] - a[0]) })
      start += length
    }
    this.length = start
    for (const aisle of aisles) {
      const offset = LANE_OFFSETS[aisle.id]
      if (!offset) continue
      const a = aisle.points[0], b = aisle.points.at(-1)!
      const span = distance(a, b)
      const dx = (b[0] - a[0]) / span, dz = (b[1] - a[1]) / span
      const ranges: { start: number; end: number }[] = []
      for (const segment of this.segments) {
        const lateral = (point: Point) => Math.abs((point[0] - a[0]) * dz - (point[1] - a[1]) * dx)
        if (lateral(segment.a) > 0.00001 || lateral(segment.b) > 0.00001 ||
          (segment.b[0] - segment.a[0]) * dx + (segment.b[1] - segment.a[1]) * dz <= 0) continue
        const previous = ranges.at(-1)
        if (previous && segment.start - previous.end < 0.00001) previous.end = segment.start + segment.length
        else ranges.push({ start: segment.start, end: segment.start + segment.length })
      }
      // An aisle can be visited twice, or cross station zero. Keep a separate
      // right-hand lane on every visit without a lane change at the wrap point.
      if (ranges.length > 1 && ranges[0].start < 0.00001 && this.length - ranges.at(-1)!.end < 0.00001) {
        const first = ranges.shift()!
        ranges.at(-1)!.end = this.length + first.end
      }
      this.lanes.push(...ranges.map(range => ({ ...range, offset })))
    }
  }

  /** Lateral offset to the right of the line at station `s` for the cruising lane. */
  laneOffset(s: number) {
    for (const lane of this.lanes) {
      const along = this.ahead(lane.start, s)
      const span = lane.end - lane.start
      if (along <= span) return lane.offset * smooth(along / LANE_FADE) * smooth((span - along) / LANE_FADE)
    }
    return 0
  }

  private lanePoint(s: number, scale: Scale): Point {
    const [x, z] = this.coordinates(s)
    const offset = (typeof scale === 'number' ? scale : scale(s)) * this.laneOffset(s)
    if (!offset) return [x, z]
    const [ax, az] = this.coordinates(s - 0.25), [bx, bz] = this.coordinates(s + 0.25)
    const h = Math.atan2(az - bz, bx - ax)
    return [x + offset * Math.sin(h), z + offset * Math.cos(h)]
  }

  /**
   * The cruising lane at station `s`; `scale` 0 is the aisle line, 1 the full
   * lane. A function of the station describes a lane change along the way.
   */
  lanePose(s: number, scale: Scale = 1): Pose {
    if (!scale || !this.laneOffset(s) && !this.laneOffset(s - 0.3) && !this.laneOffset(s + 0.3)) return this.pose(s)
    const [x, z] = this.lanePoint(s, scale)
    const [ax, az] = this.lanePoint(s - 0.25, scale)
    const [bx, bz] = this.lanePoint(s + 0.25, scale)
    return { x, z, h: Math.atan2(az - bz, bx - ax) }
  }

  laneCurvature(s: number, scale: Scale = 1) {
    return wrapAngle(this.lanePose(s + 0.65, scale).h - this.lanePose(s - 0.65, scale).h) / 1.3
  }

  wrap(s: number) {
    return ((s % this.length) + this.length) % this.length
  }

  ahead(from: number, to: number) {
    return this.wrap(to - from)
  }

  delta(from: number, to: number) {
    const distance = this.ahead(from, to)
    return distance > this.length / 2 ? distance - this.length : distance
  }

  private segmentAt(s: number) {
    let low = 0, high = this.segments.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (this.segments[middle].start <= s) low = middle
      else high = middle - 1
    }
    return low
  }

  private coordinates(s: number): Point {
    const wrapped = this.wrap(s)
    const segment = this.segments[this.segmentAt(wrapped)]
    const t = (wrapped - segment.start) / segment.length
    return [lerp(segment.a[0], segment.b[0], t), lerp(segment.a[1], segment.b[1], t)]
  }

  pose(s: number): Pose {
    const [x, z] = this.coordinates(s)
    const [ax, az] = this.coordinates(s - 0.25)
    const [bx, bz] = this.coordinates(s + 0.25)
    return { x, z, h: Math.atan2(az - bz, bx - ax) }
  }

  curvature(s: number) {
    return wrapAngle(this.pose(s + 0.65).h - this.pose(s - 0.65).h) / 1.3
  }

  closest(point: Point, heading?: number) {
    let best = Infinity, station = 0
    for (const { a, b, start, length, h } of this.segments) {
      if (heading !== undefined && Math.abs(wrapAngle(heading - h)) > Math.PI / 2) continue
      const t = clamp(((point[0] - a[0]) * (b[0] - a[0]) + (point[1] - a[1]) * (b[1] - a[1])) / length ** 2, 0, 1)
      const gap = Math.hypot(point[0] - lerp(a[0], b[0], t), point[1] - lerp(a[1], b[1], t))
      if (gap < best) {
        best = gap
        station = start + length * t
      }
    }
    return { station: this.wrap(station), distance: best }
  }
}
