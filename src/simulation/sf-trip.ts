import {
  carRectangle, clamp, COLLISION_FRONT, distance, forward, integrate, MAX_STEER,
  obstacle, passengerBox, polygonClearance, WHEELBASE, WHEEL_RADIUS, wrapAngle,
} from './geometry.ts'
import type { Obstacle } from './geometry.ts'
import type { Controls, Gear } from './drive.ts'
import { carCatalog, pickPassenger, seededRandom } from './lot.ts'
import type { ParkedCar, Point, Pose } from './lot.ts'
import type { SfMap, SfControl } from './sf-map.ts'

type RoutePoint = Pose & { s: number; width: number; street: string; cx: number; cz: number; ch: number }
type StreetPoint = { x: number; z: number; width: number; street: string }
export type SfVehicle = { id: string; car: ParkedCar; pose: Pose; braking: boolean; indicator: number }
export type SfPedestrian = { id: string; x: number; z: number; h: number; walking: boolean }
type Control = { ids: (string | number)[]; at: number; start: number; end: number; kind: SfControl['kind']; crossing: boolean; index: number }
type CarState = {
  vehicle: SfVehicle; station: number; direction: 1 | -1; speed: number
  stopped: Map<number, number>; passed: Set<number>; wait: number
  waitingFor: 'control' | 'traffic' | 'player' | 'parked' | ''; blockedBy?: string
}
type Crossing = { control: Control; person: SfPedestrian; across: number; direction: 1 | -1; active: boolean; next: number }
type CrossCar = { control: Control; vehicle: SfVehicle; across: number; active: boolean; completed: boolean; wait: number; blockedBy?: string }
type StopState = { timer: Map<number, number>; passed: Set<number> }

const MPH = 0.44704
const CRUISE = 23.5 * MPH
const GAP = 0.55
const FOLLOWING = 5
const STOP_HOLD = 1.05
const PLAYER_CLEARANCE = GAP + 0.06

function blend(a: number, b: number, t: number) { return a + (b - a) * t }
function smooth(t: number) { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x) }
function heading(a: Point, b: Point) { return Math.atan2(a[1] - b[1], b[0] - a[0]) }
function right(pose: Pose, metres: number): Pose {
  return { ...pose, x: pose.x + Math.sin(pose.h) * metres, z: pose.z + Math.cos(pose.h) * metres }
}

/** Smooth the surveyed centrelines before placing the right-hand driving lane. */
function streetPath(map: SfMap, arrival: Pose): RoutePoint[] {
  const raw: StreetPoint[] = []
  for (const segment of map.segments) {
    for (const [x, z] of segment.points) {
      const previous = raw.at(-1)
      if (previous && Math.hypot(previous.x - x, previous.z - z) < 0.01) {
        previous.width = segment.width
        previous.street = segment.name
      } else raw.push({ x, z, width: segment.width, street: segment.name })
    }
  }
  const boundaries = [0, ...raw.flatMap((point, index) => index > 0 &&
    (point.street !== raw[index - 1].street || point.width !== raw[index - 1].width) ? [index] : []), raw.length - 1]
  const retained = new Set(boundaries)
  const simplify = (start: number, end: number) => {
    const a = raw[start], b = raw[end], dx = b.x - a.x, dz = b.z - a.z
    let farthest = -1, error = 2
    for (let index = start + 1; index < end; index++) {
      const point = raw[index]
      const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / (dx * dx + dz * dz), 0, 1)
      const gap = Math.hypot(point.x - a.x - t * dx, point.z - a.z - t * dz)
      if (gap > error) { error = gap; farthest = index }
    }
    if (farthest < 0) return
    retained.add(farthest)
    simplify(start, farthest)
    simplify(farthest, end)
  }
  for (let index = 1; index < boundaries.length; index++) simplify(boundaries[index - 1], boundaries[index])
  const points = [...retained].sort((a, b) => a - b).map(index => raw[index])
  const centre: StreetPoint[] = [points[0]]
  const append = (point: StreetPoint) => {
    const previous = centre.at(-1)!
    const steps = Math.max(1, Math.ceil(Math.hypot(point.x - previous.x, point.z - previous.z)))
    for (let index = 1; index <= steps; index++) centre.push({
      x: blend(previous.x, point.x, index / steps), z: blend(previous.z, point.z, index / steps),
      width: blend(previous.width, point.width, index / steps), street: point.street,
    })
  }
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1], point = points[index], next = points[index + 1]
    const before = Math.hypot(point.x - previous.x, point.z - previous.z)
    const after = Math.hypot(next.x - point.x, next.z - point.z)
    const trim = Math.min(10, before * 0.47, after * 0.47)
    const entry = { ...point, x: point.x + (previous.x - point.x) * trim / before, z: point.z + (previous.z - point.z) * trim / before }
    const exit = { ...point, x: point.x + (next.x - point.x) * trim / after, z: point.z + (next.z - point.z) * trim / after }
    append(entry)
    const angle = Math.abs(wrapAngle(heading([previous.x, previous.z], [point.x, point.z]) -
      heading([point.x, point.z], [next.x, next.z])))
    const handle = angle < 0.0001 ? trim * 2 / 3 : trim * 4 / 3 * Math.tan(angle / 4) / Math.tan(angle / 2)
    const first = { x: entry.x + (point.x - previous.x) * handle / before,
      z: entry.z + (point.z - previous.z) * handle / before }
    const second = { x: exit.x - (next.x - point.x) * handle / after,
      z: exit.z - (next.z - point.z) * handle / after }
    const samples = Math.max(8, Math.ceil(trim * 2))
    for (let sample = 1; sample <= samples; sample++) {
      const t = sample / samples, u = 1 - t
      append({ ...point, x: u ** 3 * entry.x + 3 * u * u * t * first.x + 3 * u * t * t * second.x + t ** 3 * exit.x,
        z: u ** 3 * entry.z + 3 * u * u * t * first.z + 3 * u * t * t * second.z + t ** 3 * exit.z })
    }
  }
  append(points.at(-1)!)
  const lane = centre.map((point, index) => {
    const previous = centre[Math.max(0, index - 1)], next = centre[Math.min(centre.length - 1, index + 1)]
    const h = heading([previous.x, previous.z], [next.x, next.z])
    const neighbours = centre.slice(Math.max(0, index - 12), Math.min(centre.length, index + 13))
    const width = neighbours.reduce((sum, neighbour) => sum + neighbour.width, 0) / neighbours.length
    return { ...right({ x: point.x, z: point.z, h }, Math.max(1.65, width / 2 - 1.65)),
      cx: point.x, cz: point.z, ch: h, width, street: point.street, s: 0 }
  })
  // The final connection uses the lot's supplied launch pose and tangent.
  const join = Math.max(0, lane.length - 18)
  const start = lane[join], gap = Math.hypot(arrival.x - start.x, arrival.z - start.z)
  const [fx, fz] = forward(start.h), [tx, tz] = forward(arrival.h)
  lane.splice(join + 1)
  for (let index = 1; index <= 30; index++) {
    const t = index / 30, u = 1 - t, reach = Math.max(3, gap * 0.42)
    lane.push({ ...start, x: u ** 3 * start.x + 3 * u * u * t * (start.x + fx * reach) +
      3 * u * t * t * (arrival.x - tx * reach) + t ** 3 * arrival.x,
    z: u ** 3 * start.z + 3 * u * u * t * (start.z + fz * reach) +
      3 * u * t * t * (arrival.z - tz * reach) + t ** 3 * arrival.z })
  }
  let station = 0
  return lane.map((point, index) => {
    if (index) station += Math.hypot(point.x - lane[index - 1].x, point.z - lane[index - 1].z)
    const before = lane[Math.max(0, index - 1)], after = lane[Math.min(lane.length - 1, index + 1)]
    return { ...point, s: station, h: index === lane.length - 1 ? arrival.h : heading([before.x, before.z], [after.x, after.z]) }
  })
}

export class SfTrip {
  pose: Pose
  speed = 0
  steer = 0
  roll = 0
  braking = true
  indicator = 0
  gear: Gear = 'P'
  mode: 'idle' | 'cruise' | 'manual' | 'rejoin' = 'idle'
  arrived = false
  time = 0
  readonly cars: SfVehicle[] = []
  readonly parkedCars: SfVehicle[] = []
  readonly pedestrians: SfPedestrian[] = []
  readonly stats = {
    overlapFrames: 0, unsafeGapFrames: 0, minimumGap: Infinity, stuck: [] as string[],
    controlViolations: 0, redLightViolations: 0, stopSignViolations: 0,
    longestUnexplainedStop: 0, longestStop: 0, arrivalTime: undefined as number | undefined,
    fullStops: 0, pedestrianYields: 0,
    longestTrafficWait: 0, waitingForControl: [] as string[], waitingForPlayer: [] as string[],
    stuckFrames: 0,
  }
  private readonly path: RoutePoint[]
  private readonly controls: Control[] = []
  private readonly traffic: CarState[] = []
  private readonly crossings: Crossing[] = []
  private readonly crossCars: CrossCar[] = []
  private readonly stopState: StopState = { timer: new Map(), passed: new Set() }
  private readonly intersectionOwners = new Map<number, string>()
  private readonly intersectionQueues = new Map<number, Map<string, number>>()
  private readonly parkedBoxes: Obstacle[] = []
  private readonly turns: { at: number; street: string; direction: -1 | 0 | 1 }[] = []
  private station = 0
  private acceleration = 0
  private stopped = 0
  private unexplained = 0
  private reason = ''
  private pulledOut = false
  private rejoin?: { points: Pose[]; station: number; progress: number; length: number }
  private yieldingPedestrian = false
  private readonly oncomingEnd: number

  constructor(readonly map: SfMap, private readonly seed: number, readonly arrival: Pose) {
    this.path = streetPath(map, arrival)
    this.oncomingEnd = (this.path.find(point => point.width < 6.2)?.s ?? this.length) - 25
    const first = this.path[0]
    this.pose = right(first, first.width / 2 + 1.45 - this.laneOffset(first.width))
    for (let index = 1; index < map.segments.length; index++) {
      const before = map.segments[index - 1], after = map.segments[index]
      if (before.name === after.name) continue
      const at = this.closest(after.points[0]).station
      const angle = wrapAngle(this.at(at + 12).h - this.at(at - 12).h)
      this.turns.push({ at, street: after.name, direction: Math.abs(angle) < 0.2 ? 0 : angle > 0 ? 1 : -1 })
    }
    this.prepareControls()
    this.prepareTraffic()
  }

  private get length() { return this.path.at(-1)!.s }
  private laneOffset(width: number) { return Math.max(1.65, width / 2 - 1.65) }

  private at(station: number): RoutePoint {
    const target = clamp(station, 0, this.length)
    let low = 0, high = this.path.length - 1
    while (low + 1 < high) {
      const middle = (low + high) >> 1
      if (this.path[middle].s <= target) low = middle
      else high = middle
    }
    const a = this.path[low], b = this.path[high]
    const t = b.s === a.s ? 0 : (target - a.s) / (b.s - a.s)
    return { x: blend(a.x, b.x, t), z: blend(a.z, b.z, t), h: a.h + wrapAngle(b.h - a.h) * t,
      cx: blend(a.cx, b.cx, t), cz: blend(a.cz, b.cz, t), ch: a.ch + wrapAngle(b.ch - a.ch) * t,
      width: blend(a.width, b.width, t), street: t < 0.5 ? a.street : b.street, s: target }
  }

  private closest(point: Point) {
    let nearest = Infinity, station = 0
    for (let index = 1; index < this.path.length; index++) {
      const a = this.path[index - 1], b = this.path[index]
      const dx = b.x - a.x, dz = b.z - a.z
      const t = clamp(((point[0] - a.x) * dx + (point[1] - a.z) * dz) / Math.max(0.00001, dx * dx + dz * dz), 0, 1)
      const gap = Math.hypot(point[0] - a.x - t * dx, point[1] - a.z - t * dz)
      if (gap < nearest) { nearest = gap; station = blend(a.s, b.s, t) }
    }
    return { station, distance: nearest }
  }

  private prepareControls() {
    for (const source of this.map.controls) {
      const at = this.closest(source.pos).station
      const previous = this.controls.at(-1)
      if (previous && at - previous.at < 30) {
        previous.ids.push(source.id)
        previous.end = Math.max(previous.end, at)
        previous.crossing ||= source.crossing
        if (source.kind === 'signal') previous.kind = source.kind
        continue
      }
      this.controls.push({ ids: [source.id], at, start: at, end: at, kind: source.kind, crossing: source.crossing, index: this.controls.length })
    }
    for (const control of this.controls) {
      for (const turn of this.turns) {
        if (Math.abs(turn.at - control.at) < 30 && turn.direction !== 0) {
          control.start = Math.min(control.start, turn.at - 10)
          control.end = Math.max(control.end, turn.at + 10)
        }
      }
      if (!control.crossing || control.index % 3 !== 1) continue
      const point = this.at(control.at)
      const person: SfPedestrian = { id: `crossing-${control.index}`, ...right(point, -point.width / 2 - 2 - this.laneOffset(point.width)), walking: false }
      this.pedestrians.push(person)
      this.crossings.push({ control, person, across: -point.width / 2 - 2, direction: 1, active: false, next: 0 })
    }
  }

  private prepareTraffic() {
    const random = seededRandom(this.seed)
    for (let station = 42; station < this.length - 70; station += 175) {
      for (const direction of [1, -1] as const) {
        const point = this.at(station + (direction === -1 ? 75 : 0))
        if (direction === -1 && point.s > this.oncomingEnd) continue
        const car = pickPassenger(random)
        const vehicle: SfVehicle = { id: `street-${this.traffic.length}`, car,
          pose: this.trafficPose(point.s, direction), braking: false, indicator: 0 }
        this.cars.push(vehicle)
        this.traffic.push({ vehicle, station: point.s, direction, speed: CRUISE * 0.94,
          stopped: new Map(), passed: new Set(), wait: 0, waitingFor: '' })
      }
    }
    for (let station = 36; station < this.length - 120; station += 10.5) {
      const point = this.at(station)
      if (point.street === 'Palace Drive' || point.street === 'Access road' ||
        this.controls.some(control => Math.abs(control.at - station) < 20)) continue
      for (const side of [1, -1]) {
        const pose = right({ x: point.cx, z: point.cz, h: point.ch }, side * (point.width / 2 + 1.45))
        if (side < 0) pose.h = wrapAngle(pose.h + Math.PI)
        const car = pickPassenger(random)
        const vehicle = { id: `kerb-${this.parkedCars.length}`, car, pose, braking: false, indicator: 0 }
        const box = passengerBox(vehicle.id, car.type, pose)
        const sweep = [-5, -2.5, 0, 2.5, 5].flatMap(ahead => [1, -1].map(direction =>
          passengerBox('moving-envelope', 'offroad', this.trafficPose(station + ahead, direction as 1 | -1))))
        if (polygonClearance(box.polygon, sweep, 0.7) < 0.7) continue
        this.parkedCars.push(vehicle)
        this.parkedBoxes.push(box)
        if (this.parkedCars.length % 6 === 0) {
          const pedestrian = right(point, side * (point.width / 2 + 3.4) - this.laneOffset(point.width))
          this.pedestrians.push({ id: `sidewalk-${this.parkedCars.length}`, ...pedestrian, walking: true })
        }
      }
    }
    for (const control of this.controls.filter(candidate => candidate.index % 5 === 2 && candidate.at < this.length - 120 && candidate.end - candidate.start < 18 &&
      Math.abs(wrapAngle(this.at(candidate.at + 12).h - this.at(candidate.at - 12).h)) < 0.2)) {
      const point = this.at(control.at), car = pickPassenger(random)
      const across = -point.width / 2 - 8
      const pose = right(point, across - this.laneOffset(point.width))
      pose.h = wrapAngle(point.h - Math.PI / 2)
      const vehicle: SfVehicle = { id: `cross-traffic-${control.index}`, car, pose, braking: true, indicator: 0 }
      this.cars.push(vehicle)
      this.crossCars.push({ control, vehicle, across, active: false, completed: false, wait: 0 })
    }
  }

  private trafficPose(station: number, direction: 1 | -1): Pose {
    const point = this.at(station)
    if (direction === 1) return point
    const position = (at: number) => {
      const centre = this.at(at)
      return right({ x: centre.cx, z: centre.cz, h: centre.ch }, -this.laneOffset(centre.width))
    }
    const shifted = position(station), before = position(station - 0.3), after = position(station + 0.3)
    shifted.h = heading([after.x, after.z], [before.x, before.z])
    return shifted
  }

  signal(id: string | number): 'red' | 'green' | 'yellow' {
    let hash = this.seed
    for (const character of String(id)) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
    const phase = (this.time + hash % 38) % 38
    return phase < 17 ? 'green' : phase < 20 ? 'yellow' : 'red'
  }

  get navigation() {
    const turn = this.turns.find(candidate => candidate.at > this.station + 3)
    const remaining = Math.max(0, this.length - this.station)
    return {
      remaining, eta: remaining / (17 * MPH) + this.controls.filter(control => control.at > this.station).length * 4.2,
      turn: turn?.street ?? 'Palace of Fine Arts', direction: turn?.direction ?? 0,
      turnDistance: turn ? turn.at - this.station : remaining, reason: this.reason,
    }
  }

  start() {
    if (this.arrived) return
    if (this.mode === 'manual' || this.mode === 'idle' && this.pulledOut) {
      const closest = this.closest([this.pose.x, this.pose.z])
      for (const control of this.controls) {
        if (control.start - COLLISION_FRONT - 6 >= closest.station - 0.2) {
          this.stopState.passed.delete(control.index)
          this.stopState.timer.delete(control.index)
        }
      }
      const station = Math.min(this.length, closest.station + Math.max(12, closest.distance * 3))
      const target = this.at(station), start = this.pose
      const reach = Math.max(5, distance([start.x, start.z], [target.x, target.z]) * 0.45)
      const [fx, fz] = forward(start.h), [tx, tz] = forward(target.h)
      const points: Pose[] = []
      let length = 0
      for (let index = 0; index <= 60; index++) {
        const t = index / 60, u = 1 - t
        const x = u ** 3 * start.x + 3 * u * u * t * (start.x + fx * reach) +
          3 * u * t * t * (target.x - tx * reach) + t ** 3 * target.x
        const z = u ** 3 * start.z + 3 * u * u * t * (start.z + fz * reach) +
          3 * u * t * t * (target.z - tz * reach) + t ** 3 * target.z
        const previous = points.at(-1)
        if (previous) length += Math.hypot(x - previous.x, z - previous.z)
        points.push({ x, z, h: start.h + wrapAngle(target.h - start.h) * smooth(t) })
      }
      for (let index = 1; index < points.length - 1; index++) {
        points[index].h = heading([points[index - 1].x, points[index - 1].z], [points[index + 1].x, points[index + 1].z])
      }
      this.rejoin = { points, station, progress: 0, length }
      this.mode = 'rejoin'
    } else this.mode = 'cruise'
    this.gear = 'D'
  }

  endTrip() {
    this.mode = 'idle'
    this.speed = 0
    this.acceleration = 0
    this.gear = 'P'
    this.braking = true
    this.indicator = 0
    this.reason = ''
  }

  preview(aheadMetres: number): Pose {
    if (this.mode === 'rejoin' && this.rejoin) {
      const t = clamp((this.rejoin.progress + aheadMetres) / this.rejoin.length, 0, 1)
      return this.rejoin.points[Math.round(t * (this.rejoin.points.length - 1))]
    }
    const position = (station: number) => {
      const point = this.at(station)
      const pullout = this.pulledOut ? 0 : (point.width / 2 + 1.45 - this.laneOffset(point.width)) * (1 - smooth(station / 24))
      return right(point, pullout)
    }
    const station = this.station + aheadMetres
    const point = position(station), before = position(station - 0.3), after = position(station + 0.3)
    point.h = this.length - station < 0.3 ? this.arrival.h : heading([before.x, before.z], [after.x, after.z])
    return point
  }

  update(dt: number, controls: Controls) {
    this.time += dt
    for (const [index, id] of this.intersectionOwners) {
      const actor = this.traffic.find(car => car.vehicle.id === id)
      const station = actor?.station ?? this.station
      const direction = actor?.direction ?? 1
      const control = this.controls[index]
      const cleared = direction === 1 ? station > control.end + 6 : station < control.start - 6
      if (cleared || Math.abs(station - control.at) > 80) {
        this.intersectionOwners.delete(index)
        this.intersectionQueues.get(index)?.delete(id)
      }
    }
    for (const control of this.controls) {
      if (control.kind === 'signal' && control.end - control.start < 12) continue
      if (this.intersectionOwners.has(control.index)) continue
      const inside = this.traffic.filter(car => car.station > control.start - 0.2 && car.station < control.end + 0.2)
        .sort((a, b) => Math.abs(a.station - (a.direction === 1 ? control.end : control.start)) -
          Math.abs(b.station - (b.direction === 1 ? control.end : control.start)))[0]
      if (inside) this.intersectionOwners.set(control.index, inside.vehicle.id)
    }
    this.updateCrossings(dt)
    this.updateTraffic(dt)
    if (controls.active && !this.arrived) {
      this.mode = 'manual'
      this.rejoin = undefined
      this.pulledOut = true
    }
    const previousSpeed = this.speed
    this.reason = ''
    if (!this.arrived) {
      if (this.mode === 'cruise') this.driveRoute(dt)
      else if (this.mode === 'manual') this.driveManual(dt, controls)
      else if (this.mode === 'rejoin') this.driveRejoin(dt)
    }
    this.braking = Math.abs(this.speed) < 0.05 || Math.abs(previousSpeed) - Math.abs(this.speed) > 0.015
    const waiting = this.mode !== 'idle' && !this.arrived && Math.abs(this.speed) < 0.05
    this.stopped = waiting ? this.stopped + dt : 0
    this.unexplained = waiting && !this.reason ? this.unexplained + dt : 0
    this.stats.longestStop = Math.max(this.stats.longestStop, this.stopped)
    this.stats.longestUnexplainedStop = Math.max(this.stats.longestUnexplainedStop, this.unexplained)
    this.audit()
  }

  private controlRoom(station: number, speed: number, front: number, direction: 1 | -1, state: StopState, dt: number, player: boolean, actorId?: string) {
    let room = Infinity, reason = '', owner: string | undefined
    for (const control of this.controls) {
      const stop = direction === 1 ? control.start - front - 6 : control.end + front + 6
      const gap = (stop - station) * direction
      if (gap < -0.15) { state.passed.add(control.index); continue }
      if (gap > 65) continue
      let holds = false
      let controlReason = ''
      let waitingOwner: string | undefined
      if (control.kind === 'signal') {
        const colour = this.signal(control.ids[0])
        holds = colour === 'red' || colour === 'yellow' && gap > speed * speed / 5.2 + 1
        if (holds) controlReason = `${colour === 'red' ? 'Red' : 'Yellow'} light`
      } else {
        let timer = state.timer.get(control.index) ?? 0
        if (gap < 0.18 && speed < 0.08) timer += dt
        state.timer.set(control.index, timer)
        holds = !state.passed.has(control.index) && timer < STOP_HOLD
        if (holds) controlReason = 'Stop sign'
        else if (player && !state.passed.has(control.index)) {
          this.stats.fullStops++
          state.passed.add(control.index)
        }
      }
      const pedestrian = this.crossings.some(crossing => crossing.control === control && crossing.active)
      const crossingCar = this.crossCars.find(car => car.control === control && car.active)
      if (pedestrian) { holds = true; controlReason = 'Yielding to pedestrian' }
      if (crossingCar) { holds = true; controlReason = 'Cross traffic has right of way'; waitingOwner = crossingCar.vehicle.id }
      if (!holds && actorId && gap < 18 && (control.kind !== 'signal' || control.end - control.start >= 12)) {
        let queue = this.intersectionQueues.get(control.index)
        if (!queue) { queue = new Map(); this.intersectionQueues.set(control.index, queue) }
        if (!queue.has(actorId)) queue.set(actorId, this.time)
        let admitted = this.intersectionOwners.get(control.index)
        if (!admitted) {
          admitted = [...queue].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))[0][0]
          this.intersectionOwners.set(control.index, admitted)
        }
        if (admitted !== actorId) { holds = true; controlReason = 'Yielding at all-way stop'; waitingOwner = admitted }
      }
      if (holds && gap < room) { room = Math.max(0, gap); reason = controlReason; owner = waitingOwner }
    }
    return { room, reason, owner }
  }

  private driveRoute(dt: number) {
    const before = this.station
    const bends = [0, 8, 16].map(ahead => Math.abs(wrapAngle(this.at(this.station + ahead + 1.5).h - this.at(this.station + ahead - 1.5).h)) / 3)
    let target = Math.min(CRUISE, Math.sqrt(2.15 / Math.max(0.0001, ...bends)))
    const control = this.controlRoom(this.station, this.speed, COLLISION_FRONT, 1, this.stopState, dt, true, 'player')
    let room = Math.min(control.room, this.length - this.station)
    if (control.room < 60) this.reason = control.reason
    const lead = this.traffic.filter(car => car.direction === 1 && car.station > this.station)
      .sort((a, b) => a.station - b.station)[0]
    if (lead) {
      const gap = lead.station - this.station - COLLISION_FRONT - carCatalog[lead.vehicle.car.type].length / 2 - FOLLOWING
      if (gap < room) { room = Math.max(0, gap); this.reason = 'Following traffic' }
      target = Math.min(target, lead.speed + Math.max(0, gap - 3) * 0.35)
    }
    if (this.station > this.length - 45) target = Math.min(target, 15 * MPH)
    target = Math.min(target, Math.sqrt(2 * 2.2 * Math.max(0, room)))
    const wanted = clamp((target - this.speed) * 2.5, -3.5, 1.7)
    this.acceleration += clamp(wanted - this.acceleration, -4 * dt, 3 * dt)
    this.speed = Math.max(0, this.speed + this.acceleration * dt)
    const travel = Math.min(room, this.speed * dt)
    const next = this.preview(travel)
    if (travel > 0 && !this.safe(next, PLAYER_CLEARANCE)) {
      this.speed = 0
      this.acceleration = 0
      this.reason = 'Yielding to traffic'
      return
    }
    this.station += travel
    this.pose = next
    if (room < 0.002) { this.speed = 0; this.acceleration = 0 }
    this.roll -= travel / WHEEL_RADIUS
    const curvature = wrapAngle(this.preview(1).h - this.preview(0).h)
    this.steer += clamp(Math.atan(WHEELBASE * curvature) - this.steer, -1.1 * dt, 1.1 * dt)
    const turn = this.turns.find(candidate => candidate.at > this.station - 5 && candidate.at < this.station + 38)
    this.indicator = !this.pulledOut && this.station < 24 ? 1 : turn?.direction ?? 0
    if (this.station >= 24) this.pulledOut = true
    for (const controlPoint of this.controls) {
      if (before < controlPoint.at && this.station >= controlPoint.at) {
        if (controlPoint.kind === 'signal' && this.signal(controlPoint.ids[0]) === 'red') {
          this.stats.controlViolations++
          this.stats.redLightViolations++
        } else if (controlPoint.kind !== 'signal' && !this.stopState.passed.has(controlPoint.index)) {
          this.stats.controlViolations++
          this.stats.stopSignViolations++
        }
      }
    }
    const pedestrianYield = this.reason === 'Yielding to pedestrian'
    if (pedestrianYield && !this.yieldingPedestrian) this.stats.pedestrianYields++
    this.yieldingPedestrian = pedestrianYield
    if (this.length - this.station < 0.025) {
      this.pose = { ...this.arrival }
      this.station = this.length
      this.speed = 0
      this.steer = 0
      this.indicator = 0
      this.arrived = true
      this.stats.arrivalTime = this.time
    }
  }

  private driveManual(dt: number, controls: Controls) {
    const desired = controls.throttle * (controls.throttle < 0 ? 6 * MPH : 25 * MPH)
    this.speed += clamp(desired - this.speed, -3.5 * dt, 2.1 * dt)
    this.steer += clamp(controls.steer * MAX_STEER - this.steer, -1.7 * dt, 1.7 * dt)
    const travel = this.speed * dt
    const next = integrate(this.pose, travel, Math.tan(this.steer) / WHEELBASE)
    if (!this.safe(next, PLAYER_CLEARANCE)) { this.speed = 0; this.reason = 'Yielding to traffic'; return }
    this.pose = next
    this.station = this.closest([next.x, next.z]).station
    this.roll -= travel / WHEEL_RADIUS
    this.gear = this.speed < -0.05 ? 'R' : 'D'
    this.indicator = 0
  }

  private driveRejoin(dt: number) {
    const rejoin = this.rejoin!
    const control = this.controlRoom(this.station, this.speed, COLLISION_FRONT, 1, this.stopState, dt, true, 'player')
    const target = Math.min(3.2, Math.sqrt(2 * 2.2 * Math.max(0, control.room)))
    this.speed += clamp(target - this.speed, -3 * dt, 1.2 * dt)
    this.reason = control.reason
    const progress = Math.min(rejoin.length, rejoin.progress + Math.min(control.room, this.speed * dt))
    const index = progress / rejoin.length * (rejoin.points.length - 1)
    const a = rejoin.points[Math.floor(index)], b = rejoin.points[Math.min(rejoin.points.length - 1, Math.ceil(index))]
    const t = index - Math.floor(index)
    const next = { x: blend(a.x, b.x, t), z: blend(a.z, b.z, t), h: a.h + wrapAngle(b.h - a.h) * t }
    if (!this.safe(next, PLAYER_CLEARANCE)) { this.speed = 0; this.reason = 'Yielding to traffic'; return }
    this.roll -= (progress - rejoin.progress) / WHEEL_RADIUS
    this.pose = next
    this.station = this.closest([next.x, next.z]).station
    const curvature = wrapAngle(b.h - a.h) / Math.max(0.01, distance([a.x, a.z], [b.x, b.z]))
    this.steer += clamp(Math.atan(WHEELBASE * curvature) - this.steer, -1.1 * dt, 1.1 * dt)
    rejoin.progress = progress
    if (progress >= rejoin.length) {
      this.station = rejoin.station
      this.pose = this.at(this.station)
      this.rejoin = undefined
      this.pulledOut = true
      this.mode = 'cruise'
    }
  }

  private updateTraffic(dt: number) {
    const ordered = [...this.traffic].sort((a, b) => a.direction === b.direction ? (b.station - a.station) * a.direction : b.direction - a.direction)
    const player = obstacle('player', carRectangle(this.pose))
    for (const state of ordered) {
      const { vehicle, direction } = state
      const half = carCatalog[vehicle.car.type].length / 2
      const control = this.controlRoom(state.station, state.speed, half, direction, { timer: state.stopped, passed: state.passed }, dt, false, vehicle.id)
      let room = control.room
      state.waitingFor = control.owner ? 'traffic' : control.reason ? 'control' : ''
      state.blockedBy = control.owner
      for (const other of this.traffic) {
        if (other === state || other.direction !== direction) continue
        const gap = (other.station - state.station) * direction - half - carCatalog[other.vehicle.car.type].length / 2 - FOLLOWING
        if ((other.station - state.station) * direction > 0 && Math.max(0, gap) < room) {
          room = Math.max(0, gap)
          state.waitingFor = 'traffic'
          state.blockedBy = other.vehicle.id
        }
      }
      if (direction === 1 && this.station > state.station && this.station - state.station < 70) {
        const gap = Math.max(0, this.station - state.station - half - 1.2 - FOLLOWING)
        if (gap < room) { room = gap; state.waitingFor = 'player'; state.blockedBy = 'player' }
      }
      const point = this.at(state.station)
      const narrow = point.width < 6.2 && direction === -1
      let target = Math.min(CRUISE * 0.94, Math.sqrt(2 * 2.1 * Math.max(0, room)))
      if (narrow) target = 0
      const bend = Math.abs(wrapAngle(this.at(state.station + 2).h - this.at(state.station - 2).h)) / 4
      target = Math.min(target, Math.sqrt(1.9 / Math.max(0.0001, bend)))
      const oldSpeed = state.speed
      state.speed += clamp(target - state.speed, -3.8 * dt, 1.55 * dt)
      const nextStation = state.station + direction * Math.min(room, state.speed * dt)
      if (nextStation < 1 || nextStation > this.length - 55) {
        const spawn = direction === 1 ? 4 : this.oncomingEnd
        const pose = this.trafficPose(spawn, direction)
        const blockers = this.cars.filter(other => other !== vehicle).map(other => passengerBox(other.id, other.car.type, other.pose))
          .concat(this.parkedBoxes, player)
        if (polygonClearance(passengerBox(vehicle.id, vehicle.car.type, pose).polygon, blockers, GAP) >= GAP) {
          state.station = spawn
          state.passed.clear()
          state.stopped.clear()
        } else { state.speed = 0; state.waitingFor = 'traffic' }
      } else {
        const next = this.trafficPose(nextStation, direction)
        const box = passengerBox(vehicle.id, vehicle.car.type, next)
        const near = this.cars.filter(other => other !== vehicle && distance([next.x, next.z], [other.pose.x, other.pose.z]) < 13)
          .map(other => passengerBox(other.id, other.car.type, other.pose))
        near.push(...this.parkedBoxes.filter(parked => Math.abs(parked.bounds.minX - next.x) < 13 && Math.abs(parked.bounds.minZ - next.z) < 13))
        if (distance([next.x, next.z], [this.pose.x, this.pose.z]) < 15) near.push(player)
        const blocker = near.find(other => polygonClearance(box.polygon, [other], GAP) < GAP)
        if (blocker) {
          state.speed = 0
          state.blockedBy = blocker.id
          state.waitingFor = blocker.id === 'player' ? 'player' : blocker.id.startsWith('kerb-') ? 'parked' : 'traffic'
        }
        else state.station = nextStation
      }
      vehicle.pose = this.trafficPose(state.station, direction)
      vehicle.braking = state.speed < 0.05 || oldSpeed - state.speed > 0.015
      const turn = this.turns.find(candidate => Math.abs(candidate.at - state.station) < 30)
      vehicle.indicator = turn ? turn.direction * direction : 0
      state.wait = state.speed < 0.05 ? state.wait + dt : 0
      this.stats.longestTrafficWait = Math.max(this.stats.longestTrafficWait, state.wait)
    }
  }

  private updateCrossings(dt: number) {
    for (const crossing of this.crossings) {
      const point = this.at(crossing.control.at), width = point.width / 2 + 2
      const gap = crossing.control.at - this.station
      if (!crossing.active && this.time >= crossing.next && gap > Math.max(20, this.speed * this.speed / 4 + 10) && gap < 60) crossing.active = true
      if (crossing.active) {
        crossing.across += crossing.direction * 1.55 * dt
        if (Math.abs(crossing.across) >= width) {
          crossing.across = crossing.direction * width
          crossing.direction = crossing.direction === 1 ? -1 : 1
          crossing.active = false
          crossing.next = this.time + 45
        }
      }
      const pose = right(point, crossing.across - this.laneOffset(point.width))
      Object.assign(crossing.person, { x: pose.x, z: pose.z,
        h: wrapAngle(point.h - crossing.direction * Math.PI / 2), walking: crossing.active })
    }
    for (const crossing of this.crossCars) {
      const point = this.at(crossing.control.at)
      const gap = crossing.control.at - this.station
      const clear = !this.traffic.some(car => car.station > crossing.control.start - 6 && car.station < crossing.control.end + 6 ||
        car.speed > 0.05 && car.station > crossing.control.start - 20 && car.station < crossing.control.end + 20)
      if (!crossing.completed && !crossing.active && clear && gap > 28 && gap < 70) crossing.active = true
      if (crossing.active) {
        const next = crossing.across + 4.2 * dt
        const pose = right(point, next - this.laneOffset(point.width))
        pose.h = wrapAngle(point.h - Math.PI / 2)
        const blockers = this.cars.filter(car => car !== crossing.vehicle && distance([car.pose.x, car.pose.z], [pose.x, pose.z]) < 13)
          .map(car => passengerBox(car.id, car.car.type, car.pose))
        blockers.push(obstacle('player', carRectangle(this.pose)))
        const box = passengerBox(crossing.vehicle.id, crossing.vehicle.car.type, pose)
        const blocker = blockers.find(other => polygonClearance(box.polygon, [other], GAP) < GAP)
        const safe = !blocker
        crossing.vehicle.braking = !safe
        crossing.wait = safe ? 0 : crossing.wait + dt
        crossing.blockedBy = blocker?.id
        this.stats.longestTrafficWait = Math.max(this.stats.longestTrafficWait, crossing.wait)
        if (safe) crossing.across = next
        if (crossing.across > point.width / 2 + 8) { crossing.active = false; crossing.completed = true }
      }
      crossing.vehicle.pose = right(point, crossing.across - this.laneOffset(point.width))
      crossing.vehicle.pose.h = wrapAngle(point.h - Math.PI / 2)
    }
    for (const person of this.pedestrians) {
      if (!person.id.startsWith('sidewalk-')) continue
      const [fx, fz] = forward(person.h)
      person.x += fx * 0.7 * dt
      person.z += fz * 0.7 * dt
    }
  }

  private safe(pose: Pose, gap: number) {
    const near = this.cars.filter(car => distance([car.pose.x, car.pose.z], [pose.x, pose.z]) < 15)
      .map(car => passengerBox(car.id, car.car.type, car.pose))
    near.push(...this.parkedBoxes.filter(box => Math.abs(box.bounds.minX - pose.x) < 13 && Math.abs(box.bounds.minZ - pose.z) < 13))
    if (polygonClearance(carRectangle(pose), near, gap) < gap) return false
    return !this.crossings.some(crossing => crossing.active &&
      distance([crossing.person.x, crossing.person.z], [pose.x + Math.cos(pose.h) * 1.5, pose.z - Math.sin(pose.h) * 1.5]) < 3.3)
  }

  private audit() {
    const dynamic = this.cars.map(car => passengerBox(car.id, car.car.type, car.pose))
    dynamic.push(obstacle('player', carRectangle(this.pose)))
    let closest = Infinity
    for (const [index, box] of dynamic.entries()) {
      const other = dynamic.slice(0, index).concat(this.parkedBoxes)
        .filter(candidate => Math.abs(candidate.bounds.minX - box.bounds.minX) < 14 && Math.abs(candidate.bounds.minZ - box.bounds.minZ) < 14)
      closest = Math.min(closest, polygonClearance(box.polygon, other, 1))
    }
    this.stats.minimumGap = Math.min(this.stats.minimumGap, closest)
    if (closest <= 0.001) this.stats.overlapFrames++
    if (closest < 0.5 - 0.001) this.stats.unsafeGapFrames++
    const explained = (id: string, visited: Set<string>): 'control' | 'player' | undefined => {
      if (visited.has(id)) return
      visited.add(id)
      const crossing = this.crossCars.find(car => car.vehicle.id === id)
      if (crossing) return crossing.wait < 18 ? 'control' : crossing.blockedBy ? explained(crossing.blockedBy, visited) : undefined
      const state = this.traffic.find(car => car.vehicle.id === id)
      if (!state) return
      if (state.waitingFor === 'control') return 'control'
      if (state.waitingFor === 'player') return 'player'
      return state.blockedBy ? explained(state.blockedBy, visited) : undefined
    }
    const longWaits = this.traffic.filter(car => car.wait > 18)
    this.stats.waitingForControl = longWaits.filter(car => explained(car.vehicle.id, new Set()) === 'control').map(car => car.vehicle.id)
    this.stats.waitingForPlayer = longWaits.filter(car => explained(car.vehicle.id, new Set()) === 'player').map(car => car.vehicle.id)
    this.stats.stuck = longWaits.filter(car => !explained(car.vehicle.id, new Set())).map(car => car.vehicle.id)
      .concat(this.crossCars.filter(car => car.wait > 18 && !explained(car.vehicle.id, new Set())).map(car => car.vehicle.id))
    if (this.stats.stuck.length) this.stats.stuckFrames++
  }
}
