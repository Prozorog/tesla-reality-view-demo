import {
  bodyRectangle, carRectangle, clamp, CLEARANCE, COLLISION_FRONT, COLLISION_HALF_WIDTH, COLLISION_REAR, dot, forward,
  integrate, left, MAX_STEER, obstacle, polygonClearance, rectangle, WHEELBASE, WHEEL_RADIUS, wrapAngle,
} from './geometry.ts'
import type { Obstacle } from './geometry.ts'
import type { Bay, Lot, ParkedCar, Pose } from './lot.ts'
import { MARKER_RANGE } from './occupancy.ts'
import { APPROACH, approachPoints, endError, pathPoint, planParking } from './parking.ts'
import type { ParkingPlan, PathPoint } from './parking.ts'
import { CruiseRoute } from './route.ts'
import { CRUISE_SPEED, Traffic } from './traffic.ts'
import { streetBranches } from './traffic-paths.ts'
import type { Player, TrafficZone } from './traffic.ts'

const REVERSE_SPEED = 0.88
const BACKTRACK_SPEED = 1.45
const SHIFT_DELAY = 0.46
const READY_TIME = 1.1
// Cruising like a careful driver: gentle acceleration, firm-but-calm braking,
// half speed through turns and junctions, 2–3 m behind whatever is ahead.
const ACCELERATION = 1.2
const BRAKING = 2.0
const EMERGENCY_BRAKING = 4.5
const PLANNED_BRAKING = 0.8
const JERK = 3.0
const FOLLOW_GAP = 2.5
const PROFILE_STEP = 0.5
const CORRIDOR = 5
const LANE_CHANGE = 12
type LaneShift = { from: number; span: number; a: number; b: number }
export type Gear = 'P' | 'R' | 'N' | 'D'
export type Mode = 'idle' | 'cruise' | 'ready' | 'pull-past' | 'shift' | 'reverse' | 'parked' | 'exiting' | 'manual' | 'rejoin'
export type Controls = { throttle: number; steer: number; active: boolean }
type ManualStep = { start: Pose; metres: number; curvature: number }
type ResumePoint = { mode: Mode; timer: number }

function moveToward(value: number, target: number, distance: number) {
  return value + clamp(target - value, -distance, distance)
}

export class Drive {
  readonly route: CruiseRoute
  readonly traffic: Traffic
  readonly firstFreeBay?: string
  pose: Pose
  mode: Mode = 'idle'
  gear: Gear = 'P'
  speed = 0
  steer = 0
  roll = 0
  braking = true
  overlapFrames = 0
  reverseTrafficStops = 0
  reverseBlocked = false
  time = 0
  station: number
  plan?: ParkingPlan
  pathDistance = 0
  private manualBay?: Bay
  private timer = 0
  private inactive = 0
  private cruiseTime = 0
  private botPicked = false
  private resume?: ResumePoint
  private trail: ManualStep[] = []
  private rejoinOffset = 0
  private extendedPath?: PathPoint[]
  private reverseLead = 0
  private gate = 0
  private releasing = false
  private stoppedMode?: Mode
  private accel = 0
  private lane: LaneShift = { from: 0, span: 1, a: 1, b: 1 }
  private readonly profile: Float32Array
  private readonly turnAhead: Int8Array
  blocked?: string
  private blockedTime = 0
  /** What the player is waiting for, for diagnostics. */
  waitingFor = ''
  longestStandstill = 0
  private standstill = 0

  constructor(readonly lot: Lot, private readonly bot: 'park' | 'cruise' | undefined, seed: number, bayId?: string) {
    this.route = new CruiseRoute(lot.route, lot.aisles)
    this.traffic = new Traffic(lot, this.route, seed, bayId)
    this.firstFreeBay = this.freeBays[0]?.id
    // Arrive a little inside the entrance, clear of the street branches.
    this.station = this.route.wrap(this.route.closest(lot.entrance.pos, lot.entrance.heading).station - 10)
    if (lot.start) this.station = this.route.closest([lot.start.x, lot.start.z], lot.start.h).station
    ;[this.profile, this.turnAhead] = this.buildProfile()
    const bay = lot.bays.find(candidate => candidate.id === bayId)
    const plan = bay && this.freeBays.includes(bay) && planParking(lot, this.route, bay, this.traffic.parkedObstacles)
    if (plan) this.station = this.route.wrap(plan.station - APPROACH - 4)
    else if (bay) this.station = this.route.wrap(this.route.closest(bay.center).station - 4)
    this.pose = this.lanePose(this.station)
    this.traffic.seedRoute(this.station, this.playerState())
    this.auditOverlap()
    if (bot) this.start()
  }

  get runtimeCars(): ReadonlyMap<string, ParkedCar> { return this.traffic.parked }
  get freeBays() { return this.lot.bays.filter(bay => !bay.taken && this.traffic.isAvailable(bay.id)) }
  get noOverlap() { return this.overlapFrames === 0 }
  get selectedBay() { return this.mode === 'idle' || this.releasing ? undefined : this.manualBay ?? this.plan?.bay }
  get canChoose() { return this.mode === 'idle' && !this.stoppedMode || this.mode === 'cruise' || this.mode === 'ready' }
  get canStart() { return this.mode === 'idle' || this.mode === 'parked' || this.mode === 'manual' }
  get canCancel() { return !!this.plan && ['ready', 'pull-past', 'shift', 'reverse'].includes(this.mode) }
  get isManual() { return this.mode === 'idle' || this.mode === 'manual' || this.mode === 'parked' && !!this.manualBay }
  get isParkingView() {
    const bay = this.selectedBay
    return !!bay && Math.hypot(this.pose.x - bay.center[0], this.pose.z - bay.center[1]) <= MARKER_RANGE + 3
  }
  get motionPath() { return this.extendedPath ?? this.plan?.reverse }
  get motionLength() { return (this.plan?.length ?? 0) + this.reverseLead }
  get approachStation() { return this.route.wrap((this.plan?.station ?? this.station) + this.reverseLead) }
  get approachRemaining() {
    const remaining = this.route.ahead(this.station, this.approachStation)
    return this.route.length - remaining < 0.001 ? 0 : remaining
  }
  private get laneStation() {
    if (['cruise', 'ready', 'pull-past', 'shift'].includes(this.mode) || this.mode === 'idle' && !this.stoppedMode) return this.station
    if (this.mode === 'reverse' && this.pathDistance < this.reverseLead) return this.route.wrap(this.approachStation - this.pathDistance)
    if (this.mode === 'idle' && ['cruise', 'ready', 'pull-past', 'shift'].includes(this.stoppedMode ?? '')) return this.station
    if (['manual', 'rejoin'].includes(this.mode) || this.mode === 'idle' && this.stoppedMode === 'manual') {
      const nearest = this.route.closest([this.pose.x, this.pose.z], this.pose.h)
      if (nearest.distance < 1.25) return nearest.station
    }
  }
  private get obstacles() { return this.traffic.parkedObstacles.concat(this.traffic.movingBoxes) }
  private get zone(): TrafficZone | undefined {
    if (!this.plan || this.mode === 'idle' || this.mode === 'parked' || this.mode === 'manual') return
    if ((this.mode === 'ready' || this.mode === 'pull-past') && this.approachRemaining > 17) return
    const stage = this.laneStation
    const split = stage !== undefined && this.mode !== 'reverse' ? this.route.delta(this.plan.station, stage) : this.reverseLead
    return { station: this.plan.station, gate: this.gate, split }
  }
  get status() {
    switch (this.mode) {
      case 'ready': return 'Autopark Ready'
      case 'pull-past': case 'shift': case 'exiting': return 'Parking'
      case 'reverse': return 'Reversing'
      case 'parked': return 'Parked'
      case 'cruise': case 'rejoin': return 'Self-Driving'
      default: return ''
    }
  }

  get indicator() {
    if (this.mode === 'cruise' || this.mode === 'ready' && this.approachRemaining > 20) return this.cruiseIndicator()
    if (!this.plan || !['ready', 'pull-past', 'shift', 'reverse'].includes(this.mode)) return 0
    const launch = this.plan.reverse[0]
    const [x, z] = this.plan.bay.center
    return Math.sign(dot([x - launch.x, z - launch.z], left(launch.h)))
  }

  start() {
    if (this.mode === 'idle') {
      const stopped = this.stoppedMode
      this.stoppedMode = undefined
      if (stopped === 'manual' || stopped === 'parked' && this.manualBay) {
        this.beginRejoin()
        return
      }
      if (stopped === 'rejoin') {
        this.mode = 'rejoin'
        return
      }
      if (this.plan && this.pathDistance > 0 && (stopped === 'parked' || stopped === 'reverse' || stopped === 'exiting')) {
        this.releasing = true
        this.mode = 'exiting'
      } else {
        this.clearPlan()
        this.mode = 'cruise'
      }
      this.gear = 'D'
    } else if (this.mode === 'manual') {
      this.beginRejoin()
    } else if (this.mode === 'parked') {
      if (this.manualBay) {
        this.beginRejoin()
      } else if (this.plan) {
        this.pathDistance = this.plan.length
        this.extendedPath = undefined
        this.reverseLead = 0
        this.mode = 'exiting'
        this.gear = 'D'
      }
    }
  }

  selectBay(id: string) {
    if (!this.canChoose) return false
    const bay = this.freeBays.find(candidate => candidate.id === id)
    if (!bay) return false
    const plan = planParking(this.lot, this.route, bay, this.traffic.parkedObstacles)
    if (!plan) return false
    const scale = this.laneScaleAt(this.station)
    this.plan = plan
    this.pathDistance = 0
    this.releasing = false
    this.prepareApproach(plan)
    // Return from the cruising lane to the aisle line before the pull-past.
    const remaining = this.approachRemaining
    const end = remaining > APPROACH + 4 ? remaining - APPROACH - 1 : remaining
    const start = Math.max(0, end - LANE_CHANGE)
    this.lane = { from: this.route.wrap(this.station + start), span: Math.max(0.5, end - start), a: scale, b: 0 }
    this.mode = 'ready'
    this.gear = 'D'
    this.timer = READY_TIME
    return true
  }

  cancel() {
    if (!this.canCancel) return
    if (this.mode === 'reverse' && this.pathDistance > 0) {
      this.mode = 'exiting'
      this.releasing = true
      this.speed = 0
    } else {
      this.clearPlan()
      this.mode = 'cruise'
    }
    this.gear = 'D'
  }

  endTrip() {
    if (this.mode === 'idle') return
    this.stoppedMode = this.mode
    this.mode = 'idle'
    this.speed = 0
    this.steer = 0
    this.gear = 'P'
    this.braking = true
    this.reverseBlocked = false
  }

  private clearPlan() {
    // Ease back out to the cruising lane.
    this.lane = { from: this.station, span: LANE_CHANGE, a: this.laneScaleAt(this.station), b: 1 }
    this.plan = undefined
    this.extendedPath = undefined
    this.reverseLead = 0
    this.pathDistance = 0
    this.releasing = false
  }

  private prepareApproach(plan: ParkingPlan) {
    const launch = plan.reverse[0], along = forward(launch.h)
    const back = Math.min(...plan.reverse.flatMap(pose => bodyRectangle(pose).map(([x, z]) =>
      dot([x - launch.x, z - launch.z], along))))
    this.gate = Math.min(-8, back - 4.5)
    this.extendedPath = undefined
    this.reverseLead = 0
    const behind = this.route.delta(plan.station, this.station)
    if (behind <= 0.001 || behind > 20) return
    const brakingDistance = this.speed ** 2 / (2 * 2.2)
    for (const length of [behind + brakingDistance, behind]) {
      const straight = approachPoints(this.route, plan.station + length, length)
      if (straight.some(pose => Math.abs(wrapAngle(pose.h - launch.h)) > 0.018 ||
        polygonClearance(bodyRectangle(pose), this.traffic.parkedObstacles, CLEARANCE + 0.022) < CLEARANCE + 0.022)) continue
      const lead = straight.reverse().map((pose, i) => ({ ...pose, s: length * i / (straight.length - 1), curvature: 0 }))
      this.reverseLead = length
      this.extendedPath = lead.slice(0, -1).concat(plan.reverse.map(point => ({ ...point, s: point.s + length })))
      return
    }
  }

  update(dt: number, controls: Controls) {
    this.time += dt
    const before = this.speed
    const blocked = this.reverseBlocked
    this.reverseBlocked = false
    this.blocked = undefined
    if (controls.active && this.mode !== 'manual') this.beginManual()
    switch (this.mode) {
      case 'idle':
      case 'parked':
        this.speed = 0
        this.gear = 'P'
        break
      case 'cruise':
      case 'ready':
      case 'pull-past':
        this.followRoute(dt)
        break
      case 'shift':
        this.timer -= dt
        if (this.timer <= 0) {
          this.mode = 'reverse'
          this.gear = 'R'
        }
        break
      case 'reverse':
      case 'exiting':
        this.followParkingPath(dt)
        break
      case 'manual':
        this.driveManual(dt, controls)
        break
      case 'rejoin':
        this.followManualTrail(dt)
        break
    }
    this.braking = Math.abs(this.speed) < 0.025 || Math.abs(before) - Math.abs(this.speed) > 0.004
    if (this.reverseBlocked && !blocked) this.reverseTrafficStops++
    const moving = Math.abs(this.speed) > 0.05
    this.blockedTime = this.blocked && !moving ? this.blockedTime + dt : 0
    if (!this.blocked) this.waitingFor = ''
    const selfDriving = ['cruise', 'ready', 'pull-past', 'reverse', 'exiting', 'rejoin'].includes(this.mode)
    this.standstill = selfDriving && !moving ? this.standstill + dt : 0
    this.longestStandstill = Math.max(this.longestStandstill, this.standstill)
    const state = this.playerState()
    this.traffic.update(dt, this.time, state)
    this.auditOverlap(state.box)
  }

  private playerState(): Player {
    return {
      box: obstacle('player', carRectangle(this.pose)), corridor: this.corridor(), station: this.laneStation, zone: this.zone,
      bay: this.manualBay?.id ?? this.plan?.bay.id ?? (this.bot === 'park' && !this.botPicked ? this.firstFreeBay : undefined),
      blockedBy: this.blocked, blockedTime: this.blockedTime,
      stationary: Math.abs(this.speed) < 0.025 && !this.plan,
      reversing: this.speed < -0.05 || this.mode === 'manual' && this.gear === 'R' || this.mode === 'reverse',
    }
  }

  /** The player's footprint along the next 5 m of its path, ahead of its bumper. */
  private corridor(): Obstacle[] {
    const poses: { x: number; z: number; h: number }[] = []
    const forwardRoute = ['cruise', 'ready', 'pull-past', 'rejoin'].includes(this.mode) || this.mode === 'idle' && !this.stoppedMode
    if (forwardRoute && this.mode !== 'rejoin') {
      const end = this.plan ? Math.min(CORRIDOR, this.approachRemaining) : CORRIDOR
      for (let d = 1.25; d <= end + 0.01; d += 1.25) poses.push(this.lanePose(this.station + d))
    } else if ((this.mode === 'reverse' || this.mode === 'shift' || this.mode === 'exiting') && this.motionPath) {
      const backing = this.mode !== 'exiting'
      const left = backing ? this.motionLength - this.pathDistance : this.pathDistance
      for (let d = 1.25; d <= Math.min(CORRIDOR, left) + 0.01; d += 1.25) poses.push(pathPoint(this.motionPath, this.pathDistance + (backing ? d : -d)))
    } else if (this.mode === 'manual' && Math.abs(this.speed) > 0.05) {
      const curvature = Math.tan(this.steer) / WHEELBASE
      for (let d = 1.25; d <= CORRIDOR; d += 1.25) poses.push(integrate(this.pose, Math.sign(this.speed) * d, curvature))
    }
    return poses.map((pose, i) => obstacle(`player-path-${i}`, carRectangle(pose)))
  }

  private auditOverlap(player = obstacle('player', carRectangle(this.pose))) {
    if (this.traffic.overlapsPlayer(player)) this.overlapFrames++
  }

  get rearProximity() {
    if (this.reverseBlocked) return 1
    const reach = 3.4
    const obstacles = this.obstacles
    const behind = (distance: number) => rectangle(this.pose, COLLISION_REAR - distance, COLLISION_REAR, COLLISION_HALF_WIDTH + 0.1)
    if (polygonClearance(behind(reach), obstacles, 0.08) > 0.04) return 0
    let low = 0, high = reach
    for (let i = 0; i < 6; i++) {
      const middle = (low + high) / 2
      if (polygonClearance(behind(middle), obstacles, 0.08) <= 0.04) high = middle
      else low = middle
    }
    return 1 - high / reach
  }

  /** Where the cruising car sits at station `s`, including any lane transition. */
  lanePose(s: number) {
    return this.route.lanePose(s, (at: number) => this.laneScaleAt(at))
  }

  private laneScaleAt(s: number) {
    const { from, span, a, b } = this.lane
    const t = clamp(this.route.delta(from, s) / span, 0, 1)
    return a + (b - a) * t * t * (3 - 2 * t)
  }

  // Target speed along the loop: 6 mph on straights, about half through turns
  // and junctions, with gentle planned braking into them.
  private buildProfile(): [Float32Array, Int8Array] {
    const count = Math.ceil(this.route.length / PROFILE_STEP)
    const speed = new Float32Array(count), turn = new Int8Array(count)
    const curvature = Array.from({ length: count }, (_, i) => this.route.laneCurvature(i * PROFILE_STEP))
    const junctions = this.junctions()
    for (let i = 0; i < count; i++) {
      const s = i * PROFILE_STEP
      let v = CRUISE_SPEED / (1 + 6.4 * Math.abs(curvature[i]))
      if (junctions.some(at => Math.abs(this.route.delta(at, s)) < 4)) v = Math.min(v, CRUISE_SPEED * 0.55)
      speed[i] = v
    }
    for (let pass = 0; pass < 2; pass++) {
      for (let i = count - 1; i >= 0; i--) {
        const next = speed[(i + 1) % count]
        speed[i] = Math.min(speed[i], Math.sqrt(next * next + 2 * PLANNED_BRAKING * PROFILE_STEP))
      }
    }
    // Indicate from about 12 m before a turn until it has unwound.
    for (let i = 0; i < count; i++) {
      for (let k = 0; k <= 12 / PROFILE_STEP; k++) {
        const c = curvature[(i + k) % count]
        if (Math.abs(c) > 1 / 14) {
          turn[i] = Math.sign(c)
          break
        }
      }
    }
    return [speed, turn]
  }

  // Places where the loop meets another part of the loop or the street branches.
  private junctions() {
    const stations: number[] = []
    const step = 1
    const poses = Array.from({ length: Math.ceil(this.route.length / step) }, (_, i) => this.route.pose(i * step))
    for (const [i, pose] of poses.entries()) {
      const crossing = poses.some((other, j) => {
        const apart = Math.abs(this.route.delta(i * step, j * step))
        return apart > 25 && Math.hypot(other.x - pose.x, other.z - pose.z) < 7 &&
          Math.abs(Math.sin(wrapAngle(other.h - pose.h))) > 0.6
      })
      if (crossing && !stations.some(at => Math.abs(this.route.delta(at, i * step)) < 3)) stations.push(i * step)
    }
    const branches = streetBranches(this.lot, this.route)
    stations.push(branches.entry.station, branches.exit.station)
    return stations
  }

  private profileSpeed(s: number) {
    const i = this.route.wrap(s) / PROFILE_STEP
    const a = Math.floor(i) % this.profile.length, b = (a + 1) % this.profile.length
    return this.profile[a] + (this.profile[b] - this.profile[a]) * (i - Math.floor(i))
  }

  private cruiseIndicator() {
    return this.turnAhead[Math.floor(this.route.wrap(this.station) / PROFILE_STEP) % this.turnAhead.length]
  }

  /** Free distance ahead along the lane before the footprint would come within 0.3 m of a moving car. */
  private probeAhead(reach: number) {
    const moving = this.traffic.movingBoxes
    if (!moving.length) return { free: Infinity }
    for (let d = 0.5; d <= reach; d += 0.5) {
      const box = carRectangle(this.lanePose(this.station + d))
      for (const other of moving) {
        if (polygonClearance(box, [other], 0.3) < 0.3) return { free: d - 0.5, id: other.id }
      }
    }
    return { free: Infinity }
  }

  private followRoute(dt: number) {
    const plan = this.plan
    let target = Math.min(this.profileSpeed(this.station), this.profileSpeed(this.station + 1.5))
    let remaining = Infinity
    if (plan) {
      remaining = this.approachRemaining
      target = Math.min(target, Math.sqrt(2 * 1.0 * remaining))
      this.timer -= dt
      if (this.timer <= 0 && this.mode === 'ready') this.mode = 'pull-past'
    }
    // Traffic queued along the aisle, and anything else crossing the path ahead.
    const aisle = this.traffic.routeRoom(this.station, COLLISION_FRONT, undefined, undefined, FOLLOW_GAP)
    const aisleCar = this.traffic.lastRoomCar?.id
    const reach = Math.min(14, this.speed * this.speed / (2 * 1.5) + FOLLOW_GAP + 3)
    const probe = this.probeAhead(reach)
    const free = Math.min(aisle, Math.max(0, probe.free - (FOLLOW_GAP - 0.3)))
    this.blocked = free < 0.6 ? (probe.free - (FOLLOW_GAP - 0.3) <= aisle ? probe.id : aisleCar) : undefined
    if (this.blocked) this.waitingFor = this.blocked
    target = Math.min(target, Math.sqrt(2 * 1.5 * free))
    // Jerk-limited acceleration; harder braking only when something is close.
    const stopping = this.speed * this.speed / (2 * BRAKING)
    const limit = free < stopping ? EMERGENCY_BRAKING : BRAKING
    const wanted = clamp((target - this.speed) * 2.2, -limit, ACCELERATION)
    this.accel = wanted < this.accel ? Math.max(wanted, this.accel - (limit > BRAKING ? 3 * JERK : JERK) * dt) : Math.min(wanted, this.accel + JERK * dt)
    this.speed = Math.max(0, this.speed + this.accel * dt)
    if (this.speed > target && this.accel > 0) this.accel = 0
    if (this.speed === 0) this.accel = Math.max(0, this.accel)
    const travelled = Math.min(remaining, free + 0.3, this.speed * dt)
    const next = this.lanePose(this.station + travelled)
    if (travelled > 0 && polygonClearance(carRectangle(next), this.traffic.movingBoxes, 0.05) < 0.05) {
      this.speed = 0
      this.accel = 0
      return
    }
    this.station = this.route.wrap(this.station + travelled)
    this.pose = next
    const curvature = this.route.laneCurvature(this.station + 0.35, (at: number) => this.laneScaleAt(at))
    this.steer = moveToward(this.steer, clamp(Math.atan(WHEELBASE * curvature), -MAX_STEER, MAX_STEER), 1.2 * dt)
    this.roll -= travelled / WHEEL_RADIUS
    if (plan && remaining - travelled < 0.001) {
      this.speed = 0
      this.accel = 0
      this.steer = 0
      this.pathDistance = 0
      this.station = this.approachStation
      this.pose = this.motionPath![0]
      if (this.timer <= 0) {
        this.mode = 'shift'
        this.timer = SHIFT_DELAY
      }
    }
    if (this.bot === 'park' && this.firstFreeBay && !this.botPicked && this.mode === 'cruise') {
      this.cruiseTime += dt
      if (this.cruiseTime >= 2.2) {
        this.botPicked = this.selectBay(this.firstFreeBay)
      }
    }
  }

  private followParkingPath(dt: number) {
    const plan = this.plan!
    const path = this.motionPath!
    const backing = this.mode === 'reverse'
    const remaining = backing ? this.motionLength - this.pathDistance : this.pathDistance
    const straightLeft = this.reverseLead - this.pathDistance
    const limit = straightLeft > 0 ? Math.min(BACKTRACK_SPEED, Math.sqrt(REVERSE_SPEED ** 2 + straightLeft * 1.4)) : REVERSE_SPEED
    const targetSpeed = Math.min(backing ? limit : 1.65, Math.sqrt(2 * 0.85 * remaining))
    const speed = moveToward(Math.abs(this.speed), targetSpeed, dt * 1.05)
    const travelled = Math.min(remaining, speed * dt)
    const direction = backing ? 1 : -1
    const point = pathPoint(path, this.pathDistance + direction * travelled)
    const moving = this.traffic.movingBoxes
    const checkpoints = backing ? [travelled, 0.45, 0.97] : [travelled, 0.47]
    const blocker = checkpoints.map(distance => carRectangle(pathPoint(path, this.pathDistance + direction * Math.min(remaining, distance))))
      .map(box => moving.find(other => polygonClearance(box, [other], 0.34) < 0.33)).find(Boolean)
    if (blocker) {
      this.speed = 0
      this.reverseBlocked = backing
      this.blocked = blocker.id
      this.waitingFor = blocker.id
      return
    }
    this.blocked = undefined
    this.pathDistance += direction * travelled
    this.speed = backing ? -speed : speed
    this.roll += (backing ? travelled : -travelled) / WHEEL_RADIUS
    this.steer = Math.atan(WHEELBASE * point.curvature)
    this.pose = point
    if (remaining - travelled > 0.001) return
    this.speed = 0
    this.steer = 0
    if (backing) {
      this.pose = plan.end
      this.mode = 'parked'
      this.gear = 'P'
    } else {
      this.station = this.approachStation
      this.pose = this.lanePose(this.station)
      this.clearPlan()
      this.mode = 'cruise'
    }
  }

  private beginManual() {
    if (this.mode === 'rejoin' || this.stoppedMode === 'rejoin') {
      const step = this.trail.at(-1)
      if (step) step.metres -= Math.sign(step.metres) * this.rejoinOffset
      this.rejoinOffset = 0
    } else if (!this.manualBay && this.stoppedMode !== 'manual') {
      this.resume = { mode: this.stoppedMode ?? this.mode, timer: this.timer }
      this.trail = []
    }
    this.stoppedMode = undefined
    this.manualBay = undefined
    this.mode = 'manual'
    this.inactive = 0
  }

  private driveManual(dt: number, input: Controls) {
    this.inactive = input.active ? 0 : this.inactive + dt
    this.steer = moveToward(this.steer, input.steer * MAX_STEER, dt * 2.2)
    const curvature = Math.tan(this.steer) / WHEELBASE
    const requested = input.throttle * (input.throttle < 0 ? 1.36 : 2.25)
    const direction = Math.sign(this.speed || requested)
    const obstacles = this.obstacles
    let safeSpeed = Math.abs(requested)
    for (const distance of [0.1, 0.22, 0.42, 0.72, 1.15, 1.7]) {
      const box = carRectangle(integrate(this.pose, direction * distance, curvature))
      if (polygonClearance(box, obstacles, 0.12) < 0.044) {
        safeSpeed = Math.min(safeSpeed, Math.sqrt(2 * 1.85 * Math.max(0, distance - 0.10)))
        // Waiting on a moving car lets traffic give way after a few seconds.
        if (requested) this.blocked = this.traffic.movingBoxes.find(other => polygonClearance(box, [other], 0.12) < 0.044)?.id
        break
      }
    }
    const target = Math.sign(requested) * safeSpeed
    this.speed = moveToward(this.speed, target, dt * (Math.abs(this.speed) > safeSpeed ? 2.25 : 1.65))
    const metres = this.speed * dt
    const next = integrate(this.pose, metres, curvature)
    if (polygonClearance(carRectangle(next), obstacles, 0.12) < 0.035) {
      this.speed = 0
    } else if (Math.abs(metres) > 1e-7) {
      this.trail.push({ start: this.pose, metres, curvature })
      this.pose = next
      this.roll -= metres / WHEEL_RADIUS
    }
    const gearDirection = Math.sign(this.speed || requested)
    if (gearDirection) this.gear = gearDirection < 0 ? 'R' : 'D'
    if (this.inactive < 2) return
    this.manualBay = this.freeBays.find(bay => {
      const dx = this.pose.x - bay.center[0], dz = this.pose.z - bay.center[1]
      if (Math.hypot(dx, dz) > 3 || Math.abs(Math.sin(wrapAngle(this.pose.h - bay.heading))) > Math.sin(8 * Math.PI / 180)) return false
      const s = Math.sin(bay.heading), c = Math.cos(bay.heading)
      return carRectangle(this.pose).every(([x, z]) => {
        x -= bay.center[0]
        z -= bay.center[1]
        return Math.abs(x * c - z * s) <= bay.depth / 2 && Math.abs(x * s + z * c) <= bay.width / 2
      })
    })
    if (this.manualBay) {
      this.speed = 0
      this.gear = 'P'
      this.mode = 'parked'
    } else {
      this.beginRejoin()
    }
  }

  private beginRejoin() {
    this.mode = 'rejoin'
    this.speed = 0
    this.rejoinOffset = 0
  }

  private followManualTrail(dt: number) {
    const step = this.trail.at(-1)
    if (!step) {
      const resume = this.resume
      this.mode = resume?.mode === 'parked' && this.plan ? 'exiting' : resume && resume.mode !== 'idle' && resume.mode !== 'parked' ? resume.mode : 'cruise'
      this.speed = 0
      this.gear = this.mode === 'reverse' ? 'R' : 'D'
      this.timer = resume?.timer ?? 0
      this.resume = undefined
      this.manualBay = undefined
      return
    }
    const direction = -Math.sign(step.metres)
    this.speed = direction * moveToward(this.speed * direction, direction > 0 ? 1.6 : 1.05, dt * 1.9)
    this.gear = direction < 0 ? 'R' : 'D'
    let budget = Math.abs(this.speed) * dt
    while (budget > 0) {
      const next = this.trail.at(-1)
      if (!next || -Math.sign(next.metres) !== direction) {
        this.speed = 0
        break
      }
      const length = Math.abs(next.metres)
      const travelled = Math.min(budget, length - this.rejoinOffset)
      const pose = integrate(next.start, -direction * (length - this.rejoinOffset - travelled), next.curvature)
      if (polygonClearance(carRectangle(pose), this.obstacles, 0.12) < 0.035) {
        this.speed = 0
        break
      }
      this.rejoinOffset += travelled
      this.pose = pose
      this.steer = Math.atan(WHEELBASE * next.curvature)
      this.roll -= travelled * direction / WHEEL_RADIUS
      budget -= travelled
      if (this.rejoinOffset >= length - 1e-7) {
        this.trail.pop()
        this.rejoinOffset = 0
      }
    }
  }

  parkingResult() {
    if (this.mode !== 'parked' || !this.selectedBay) return null
    return { bay: this.selectedBay.id, pose: { x: this.pose.x, z: this.pose.z, h: this.pose.h }, ...endError(this.pose, this.selectedBay) }
  }
}
