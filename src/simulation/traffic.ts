import { clamp, COLLISION_REAR, lotObstacles, MARGIN, overlaps, passengerBox, polygonClearance, wrapAngle } from './geometry.ts'
import type { Obstacle } from './geometry.ts'
import { carCatalog, parkedPose, pickPassenger, seededRandom } from './lot.ts'
import type { Bay, Lot, ParkedCar, Pose } from './lot.ts'
import { addRuntimeCars } from './occupancy.ts'
import { pathPoint } from './parking.ts'
import type { CruiseRoute } from './route.ts'
import { noseInPath, streetBranches } from './traffic-paths.ts'
import type { TrafficPath } from './traffic-paths.ts'

export const CRUISE_SPEED = 6 * 0.44704
const GAP = 6
const TARGET_CARS = 4
// Clearance kept from parked cars and kerbs while entering or leaving a bay.
const PARKED_SAFE = 0.12
// Clearance kept from the player, the space its next 5 m need, and other moving cars.
export const CAR_GAP = 0.5
const STUCK_TIME = 18
// After this long blocking the player (and blocked by it), traffic gives way.
const GIVE_WAY_AFTER = 3
const BACK_OFF = 4
const PROBE_STEP = 0.5
type Phase = 'enter' | 'route' | 'park' | 'depart' | 'leave'
type BayTurn = { bay: Bay; path: TrafficPath }
type GiveWay = { left: number; stalled: number; hold: number }
export type TrafficCar = {
  id: string
  car: ParkedCar
  pose: Pose
  box: Obstacle
  phase: Phase
  station: number
  distance: number
  speed: number
  braking: boolean
  indicator: number
  wait: number
  seeksBay: boolean
  merging: boolean
  turn?: BayTurn
  /** Seconds this car has been held back by the player or the player's path. */
  heldByPlayer: number
  giveWay?: GiveWay
  /** What this car is waiting for: 'player', 'parked' or another car's id. */
  cause?: string
  /** The last cause seen during the current wait (kept until the car moves). */
  waitCause?: string
  /** Next simulation time a bay reservation may be attempted. */
  reserveAt: number
}

export type TrafficZone = { station: number; gate: number; split: number }
export type Player = {
  box: Obstacle
  /** The player's footprint along its next 5 m of travel. */
  corridor: Obstacle[]
  /** True while the player is backing up along the loop. */
  reversing?: boolean
  station?: number
  bay?: string
  zone?: TrafficZone
  /** The traffic car the player is waiting for, and for how long. */
  blockedBy?: string
  blockedTime?: number
}
function centreDistance(pose: Pose, obstacle: Obstacle) {
  const { minX, maxX, minZ, maxZ } = obstacle.bounds
  return Math.hypot(pose.x - (minX + maxX) / 2, pose.z - (minZ + maxZ) / 2)
}
const halfLength = (car: ParkedCar) => carCatalog[car.type].length / 2 + MARGIN
type Verdict = 'ok' | 'parked' | 'player' | 'traffic'

export class Traffic {
  readonly parked: Map<string, ParkedCar>
  readonly moving: TrafficCar[] = []
  readonly movingBoxes: Obstacle[] = []
  /** Kerbs and parked cars at their drawn size: the parking planner's obstacles. */
  parkedObstacles: Obstacle[]
  /** Kerbs and parked cars with the collision margin. */
  parkedCollision: Obstacle[]
  revision = 0
  givenWay = 0
  private readonly staticObstacles: Obstacle[]
  private readonly bays: { bay: Bay; station: number }[]
  private readonly branches: ReturnType<typeof streetBranches>
  private readonly random: () => number
  private readonly parkingLimit: number
  private nextId = 0
  private enterAfter = 0
  private departAfter = 32
  private entered = 0
  private left = 0
  private parkedCount = 0
  private departed = 0
  private maxWait = 0
  private staticOverlap = false
  private player?: Player
  private lastBlock: Verdict = 'ok'

  constructor(private readonly lot: Lot, private readonly route: CruiseRoute, seed: number, reservedBay?: string) {
    this.random = seededRandom(seed ^ 0x5d839ee1)
    this.parked = addRuntimeCars(lot, route, seed, reservedBay)
    this.staticObstacles = lotObstacles(lot)
    this.parkedObstacles = this.staticObstacles
    this.parkedCollision = lotObstacles(lot, undefined, MARGIN)
    this.refreshParked()
    this.bays = lot.bays.filter(bay => !bay.taken && bay.id !== reservedBay && bay.kind !== 'angled')
      .map(bay => ({ bay, station: route.closest(bay.center, Math.PI).station }))
    this.parkingLimit = this.parked.size + 2
    this.branches = streetBranches(lot, route)
  }

  seedRoute(station: number, player: Player) {
    this.player = player
    for (const [i, offset] of [17, -12, 91, -71].entries()) {
      const s = this.route.wrap(station + offset)
      const c = this.addCar(pickPassenger(this.random), this.route.pose(s), 'route', s, i !== 0 && i !== 3)
      if (this.check(c, c.pose, player, false) !== 'ok') this.moving.pop()
    }
    this.syncBoxes()
  }

  isAvailable(id: string) {
    return !this.parked.has(id) && !this.moving.some(car => car.turn?.bay.id === id)
  }

  get stats() {
    return {
      active: this.moving.length, moving: this.moving.filter(car => Math.abs(car.speed) > 0.08).length,
      entered: this.entered, left: this.left, parked: this.parkedCount, departed: this.departed,
      maxWait: this.maxWait,
      // Stuck: a long wait that the player's own car does not explain (a deadlock among traffic).
      stuck: this.moving.filter(car => car.wait >= STUCK_TIME && !this.waitsForPlayer(car)).map(car => car.id),
      waitingForPlayer: this.moving.filter(car => car.wait >= STUCK_TIME && this.waitsForPlayer(car)).map(car => car.id),
      givenWay: this.givenWay, yielding: this.moving.filter(car => car.giveWay).map(car => car.id),
    }
  }

  /** Every pair of cars, on their collision rectangles: player, traffic and parked. */
  overlapsPlayer(player: Obstacle) {
    if (this.staticOverlap || this.parkedCollision.some(box => box.id.startsWith('B') && overlaps(box, player))) return true
    return this.movingBoxes.some((box, i) => overlaps(box, player) ||
      this.parkedCollision.some(parked => parked.id.startsWith('B') && overlaps(box, parked)) ||
      this.movingBoxes.slice(0, i).some(other => overlaps(box, other)))
  }

  // Bumper-to-bumper distance on the one-way aisle. Active merges reserve
  // their junction before the nose or tail reaches it.
  routeRoom(station: number, front: number, exclude?: TrafficCar, player?: Player, gap = GAP) {
    let room = Infinity
    let nearest: TrafficCar | undefined
    const limit = (at: number, rear: number, car?: TrafficCar) => {
      const along = this.route.delta(station, at)
      if (along >= 0) {
        const free = Math.max(0, along - rear - front - gap)
        if (free < room) {
          room = free
          nearest = car
        }
      }
    }
    for (const other of this.moving) {
      if (other === exclude) continue
      if (other.phase === 'route' || other.merging) limit(other.station, halfLength(other.car), other)
    }
    if (player?.station !== undefined) limit(player.station, -COLLISION_REAR)
    this.lastRoomCar = nearest
    return room
  }
  lastRoomCar?: TrafficCar

  private time = 0
  private backingOff = false
  private ticks = 0
  private near: { parked: Obstacle[]; dynamic: Obstacle[]; traffic: Obstacle[] } = { parked: [], dynamic: [], traffic: [] }

  update(dt: number, time: number, player: Player) {
    this.player = player
    this.time = time
    this.ticks++
    const stops = this.queueStops(player.zone)
    // Mutual block: the player waits for this car while it waits for the player.
    if (player.blockedBy && (player.blockedTime ?? 0) > GIVE_WAY_AFTER) {
      const c = this.moving.find(other => other.id === player.blockedBy)
      if (c && !c.giveWay && c.heldByPlayer > GIVE_WAY_AFTER) this.yieldTo(c)
    }
    for (const c of this.moving) {
      const before = c.pose
      const speed = c.speed
      if (c.giveWay) this.giveWay(c, dt, player)
      else if (c.phase === 'route') this.onRoute(c, dt, player, stops.get(c))
      else this.onPath(c, dt, player)
      c.braking = Math.abs(c.speed) < 0.05 || Math.abs(speed) - Math.abs(c.speed) > 0.015
      c.wait = Math.hypot(c.pose.x - before.x, c.pose.z - before.z) < 0.001 ? c.wait + dt : 0
      c.waitCause = c.giveWay ? 'player' : c.wait === 0 ? undefined : c.cause ?? c.waitCause
      this.maxWait = Math.max(this.maxWait, c.wait)
    }
    for (let i = this.moving.length - 1; i >= 0; i--) {
      const c = this.moving[i]
      if (c.phase === 'park' && c.distance >= c.turn!.path.length) {
        this.parked.set(c.turn!.bay.id, c.car)
        this.parkedCount++
        this.moving.splice(i, 1)
        this.refreshParked()
      } else if (c.phase === 'leave' && c.distance >= this.branches.exit.length) {
        this.left++
        this.moving.splice(i, 1)
      }
    }
    if (this.moving.length < TARGET_CARS && time >= this.enterAfter) {
      if (time < this.departAfter || !this.depart(time, player)) this.enter(time, player)
    }
    this.syncBoxes()
  }

  private syncBoxes() {
    this.movingBoxes.length = 0
    for (const c of this.moving) this.movingBoxes.push(c.box)
  }

  private refreshParked() {
    const boxes = Array.from(this.parked, ([id, car]) => {
      const bay = this.lot.bays.find(candidate => candidate.id === id)!
      return { id, car, pose: parkedPose(bay, car) }
    })
    this.parkedObstacles = this.staticObstacles.concat(boxes.map(({ id, car, pose }) => passengerBox(id, car.type, pose, 0)))
    this.parkedCollision = lotObstacles(this.lot, undefined, MARGIN).concat(boxes.map(({ id, car, pose }) => passengerBox(id, car.type, pose)))
    this.staticOverlap = this.parkedCollision.some((box, i, all) => box.id.startsWith('B') &&
      all.slice(0, i).some(other => other.id.startsWith('B') && overlaps(box, other)))
    this.revision++
  }

  private addCar(car: ParkedCar, pose: Pose, phase: Phase, station: number, seeksBay = false) {
    const id = `traffic-${++this.nextId}`
    const c: TrafficCar = { id, car, pose, box: passengerBox(id, car.type, pose), phase, station, distance: 0,
      speed: phase === 'route' ? CRUISE_SPEED : 0, braking: false, indicator: 0, wait: 0, seeksBay, merging: false, heldByPlayer: 0, reserveAt: 0 }
    this.moving.push(c)
    return c
  }

  /**
   * Can car `c` stand at `pose`? Parked cars and kerbs keep PARKED_SAFE, the
   * player, the player's next 5 m and other moving cars keep CAR_GAP. A move
   * that only increases a too-small clearance (backing away) is allowed.
   */
  private check(c: TrafficCar, pose: Pose, player: Player, moving = true): Verdict {
    const box = passengerBox(c.id, c.car.type, pose)
    const test = (obstacles: Obstacle[], gap: number) => {
      const next = polygonClearance(box.polygon, obstacles, gap)
      if (next >= gap) return true
      if (!moving) return false
      const now = polygonClearance(c.box.polygon, obstacles, gap)
      if (next > now + 1e-4) return true
      if (next < now - 1e-6) return false
      // Equal (typically both overlapping): allow only moves away from every obstacle still too close.
      return obstacles.every(other => polygonClearance(box.polygon, [other], gap) >= gap ||
        centreDistance(pose, other) > centreDistance(c.pose, other) + 1e-4)
    }
    const near = this.nearFor(c, player)
    if (!test(near.parked, PARKED_SAFE)) return 'parked'
    // Backing away from the player: its body still counts, its path ahead does not.
    const dynamic = this.backingOff ? near.dynamic.filter(box => box === player.box) : near.dynamic
    if (dynamic.length && !test(dynamic, CAR_GAP)) return 'player'
    if (near.traffic.length && !test(near.traffic, CAR_GAP)) return 'traffic'
    return 'ok'
  }

  // Obstacles within reach of car `c` this tick (probes look at most ~8 m ahead or back).
  private nearCar?: TrafficCar
  private nearTick = -1
  private nearFor(c: TrafficCar, player: Player) {
    if (this.nearCar === c && this.nearTick === this.ticks) return this.near
    const reach = 14
    const close = (box: Obstacle) => box.bounds.maxX > c.pose.x - reach && box.bounds.minX < c.pose.x + reach &&
      box.bounds.maxZ > c.pose.z - reach && box.bounds.minZ < c.pose.z + reach
    this.near = {
      parked: this.parkedCollision.filter(close),
      dynamic: [player.box, ...player.corridor].filter(close),
      traffic: this.moving.filter(other => other !== c).map(other => other.box).filter(close),
    }
    this.nearCar = c
    this.nearTick = this.ticks
    return this.near
  }

  private place(c: TrafficCar, pose: Pose) {
    c.pose = pose
    c.box = passengerBox(c.id, c.car.type, pose)
  }

  /** Free distance along the car's own path before it would come too close to anything. */
  private probe(c: TrafficCar, poseAt: (distance: number) => Pose, reach: number, player: Player) {
    // Nothing near the whole probe: one test at each end covers the common case.
    const near = this.nearFor(c, player)
    if (!near.dynamic.length && !near.traffic.length) {
      const verdict = this.check(c, poseAt(Math.max(PROBE_STEP, reach)), player)
      if (verdict === 'ok' && this.check(c, poseAt(PROBE_STEP), player) === 'ok') {
        this.lastBlock = 'ok'
        return Infinity
      }
    }
    for (let d = PROBE_STEP; d <= reach + 1e-6; d += PROBE_STEP) {
      const verdict = this.check(c, poseAt(d), player)
      if (verdict !== 'ok') {
        this.lastBlock = verdict
        return Math.max(0, d - PROBE_STEP - 0.05)
      }
    }
    this.lastBlock = 'ok'
    return Infinity
  }

  private stepSpeed(c: TrafficCar, dt: number, max: number, room: number, direction = 1) {
    const target = direction * Math.min(max, Math.sqrt(2 * 1.9 * room))
    c.speed += clamp(target - c.speed, -2.5 * dt, 1.8 * dt)
    return Math.min(room, Math.max(0, direction * c.speed) * dt)
  }

  private reach(c: TrafficCar) {
    return Math.min(6, c.speed * c.speed / (2 * 1.9) + 1.5)
  }

  private holdFor(c: TrafficCar, dt: number, heldByPlayer: boolean) {
    c.heldByPlayer = heldByPlayer ? c.heldByPlayer + dt : 0
    if (heldByPlayer) c.cause = 'player'
  }

  /** Follows what a waiting car waits for; true when the chain ends at the player. */
  private waitsForPlayer(c: TrafficCar, depth = 0): boolean {
    const cause = c.waitCause ?? c.cause
    if (c.giveWay || cause === 'player') return true
    if (!cause || cause === 'parked' || depth > 6) return false
    const other = this.moving.find(car => car.id === cause)
    return !!other && this.waitsForPlayer(other, depth + 1)
  }

  // The closest other moving car in front of `c` (within 9 m).
  private carAhead(c: TrafficCar) {
    let best: TrafficCar | undefined, distance = 9
    const dx = Math.cos(c.pose.h), dz = -Math.sin(c.pose.h)
    for (const other of this.moving) {
      if (other === c) continue
      const ox = other.pose.x - c.pose.x, oz = other.pose.z - c.pose.z
      const d = Math.hypot(ox, oz)
      if (d < distance && ox * dx + oz * dz > -1) { best = other; distance = d }
    }
    return best
  }

  private causeOf(c: TrafficCar, limitedByProbe: boolean, aisleCar?: TrafficCar) {
    if (c.cause === 'player') return 'player'
    if (aisleCar) return aisleCar.id
    if (!limitedByProbe) return undefined
    if (this.lastBlock === 'traffic') return this.carAhead(c)?.id
    return this.lastBlock === 'ok' ? undefined : this.lastBlock
  }

  private onRoute(c: TrafficCar, dt: number, player: Player, stop?: number) {
    if (stop !== undefined && stop < -0.035) {
      // A late player selection can find a follower inside the sweep. Back
      // the queue out of the aisle gate in order, using the same swept boxes.
      const move = this.stepSpeed(c, dt, 1.4, -stop, -1)
      const pose = this.route.pose(c.station - move)
      if (move > 0 && this.check(c, pose, player) === 'ok') {
        this.place(c, pose)
        c.station = this.route.wrap(c.station - move)
      }
      c.indicator = 0
      this.holdFor(c, dt, true)
      return
    }
    if (!c.turn && stop === undefined && c.seeksBay && this.time >= c.reserveAt &&
      this.parked.size + this.moving.filter(other => other.turn?.bay).length < this.parkingLimit) {
      c.reserveAt = this.time + 0.6
      this.reserveBay(c, player)
    }
    const turn = c.turn
    const event = turn?.path.station ?? this.branches.exit.station
    const remaining = this.route.ahead(c.station, event)
    c.indicator = turn && remaining < 8 ? Math.sign(turn.path.points[0].curvature) : 0
    const gateRoom = stop === undefined ? Infinity : Math.max(0, stop)
    const aisle = this.routeRoom(c.station, halfLength(c.car), c, player)
    const probe = this.probe(c, d => this.route.pose(c.station + d), this.reach(c), player)
    const room = Math.min(remaining, gateRoom, aisle, probe)
    const byPlayer = gateRoom <= room + 0.01 && gateRoom < 1 || probe <= room + 0.01 && probe < 1 && this.lastBlock === 'player' ||
      aisle <= room + 0.01 && aisle < 1 && !this.lastRoomCar
    c.cause = undefined
    this.holdFor(c, dt, byPlayer)
    if (room < 1) c.cause = this.causeOf(c, probe <= room + 0.01, aisle <= room + 0.01 ? this.lastRoomCar : undefined)
    const bend = Math.abs(this.route.curvature(c.station + 1.5))
    const move = this.stepSpeed(c, dt, CRUISE_SPEED / (1 + 2.4 * bend), room)
    const next = remaining <= move + 0.00001 ? event : this.route.wrap(c.station + move)
    if (move > 0) {
      const pose = this.route.pose(next)
      if (this.check(c, pose, player) === 'ok') {
        this.place(c, pose)
        c.station = next
      } else c.speed = 0
    }
    if (Math.abs(this.route.delta(c.station, event)) > 0.001 || gateRoom < 0.025) return
    c.speed = 0
    c.distance = 0
    if (!turn) {
      c.phase = 'leave'
      return
    }
    const dynamic = [player.box, ...player.corridor, ...this.moving.filter(other => other !== c).map(other => other.box)]
    const clear = !this.insideZone(event, player.zone) && turn.bay.id !== player.bay &&
      turn.path.points.every(pose => polygonClearance(passengerBox(c.id, c.car.type, pose).polygon, this.parkedCollision, PARKED_SAFE) >= PARKED_SAFE &&
        polygonClearance(passengerBox(c.id, c.car.type, pose).polygon, dynamic, CAR_GAP) >= CAR_GAP)
    if (clear) c.phase = 'park'
    else {
      c.turn = undefined
      c.seeksBay = false
    }
  }

  private queueStops(zone?: TrafficZone) {
    const stops = new Map<TrafficCar, number>()
    if (!zone) return stops
    const cars = this.moving.filter(c => {
      const along = this.route.delta(zone.station, c.station)
      return c.phase === 'route' && along <= zone.split && along >= zone.gate - 54
    }).sort((a, b) => this.route.delta(zone.station, b.station) - this.route.delta(zone.station, a.station))
    let stop = zone.gate
    for (const [i, c] of cars.entries()) {
      if (i > 0) stop -= GAP + halfLength(c.car) + halfLength(cars[i - 1].car)
      stops.set(c, stop - this.route.delta(zone.station, c.station))
    }
    return stops
  }

  private insideZone(station: number, zone?: TrafficZone) {
    if (!zone) return false
    const along = this.route.delta(zone.station, station)
    return along >= zone.gate - 5 && along <= Math.max(8, zone.split + 8)
  }

  private reserveBay(c: TrafficCar, player: Player) {
    // Storefront bays are the ones approached nose-first from this one-way
    // route. Keep the angled rows open for the backed-in player manoeuvres.
    for (const { bay, station: rough } of this.bays.toReversed()) {
      if (bay.id === player.bay || !this.isAvailable(bay.id)) continue
      const ahead = this.route.ahead(c.station, rough)
      if (ahead < 12 || ahead > 45 || this.insideZone(rough, player.zone)) continue
      const path = noseInPath(this.lot, this.route, bay, c.car, this.parkedCollision)
      if (path && this.route.ahead(c.station, path.station) < 42) {
        c.turn = { bay, path }
        return
      }
    }
  }

  private pathOf(c: TrafficCar) {
    return c.phase === 'enter' ? this.branches.entry : c.phase === 'leave' ? this.branches.exit : c.turn!.path
  }

  private pathPose(c: TrafficCar, distance: number) {
    const path = this.pathOf(c)
    return pathPoint(path.points, c.phase === 'depart' ? path.length - distance : distance)
  }

  private onPath(c: TrafficCar, dt: number, player: Player) {
    const path = this.pathOf(c)
    const remaining = path.length - c.distance
    // Wait with the nose clear of the aisle lane until the merge is free.
    const waitLine = 8.4
    if (c.phase === 'enter' && !c.merging && remaining <= waitLine + 0.002 &&
      !this.insideZone(path.station, player.zone) && this.mergeClear(path.station, c, player)) c.merging = true
    const allowed = c.phase === 'enter' && !c.merging ? Math.max(0, remaining - waitLine) : remaining
    const backing = c.phase === 'depart'
    const probe = this.probe(c, d => this.pathPose(c, Math.min(path.length, c.distance + d)), Math.min(this.reach(c), remaining), player)
    const room = Math.min(allowed, probe)
    c.cause = undefined
    this.holdFor(c, dt, probe <= room + 0.01 && probe < 1 && this.lastBlock === 'player' ||
      c.phase === 'enter' && !c.merging && allowed < 0.05 && this.nearPlayer(path.station, player))
    if (room < 1 && !c.cause) {
      c.cause = probe <= room + 0.01 ? this.causeOf(c, true) : this.mergeBlocker(path.station, c)
    }
    const move = this.stepSpeed(c, dt, backing ? 1.55 : 2.45, room)
    const next = c.distance + move
    if (move > 0) {
      const pose = this.pathPose(c, next)
      if (this.check(c, pose, player) === 'ok') {
        this.place(c, pose)
        c.distance = next
      } else c.speed = 0
    }
    if (path.length - c.distance > 0.001) return
    if (c.phase === 'enter' || c.phase === 'depart') {
      c.phase = 'route'
      c.station = path.station
      c.turn = undefined
      c.indicator = 0
      c.merging = false
    } else c.distance = path.length
  }

  private nearPlayer(station: number, player: Player) {
    if (player.station === undefined) return false
    const delta = this.route.delta(station, player.station)
    // A player behind the merge and backing away from it leaves the merge free.
    if (player.reversing && delta < -4) return false
    return Math.abs(delta) < 13
  }

  // A route pose `d` metres along, easing out any small offset between the car and the route line.
  private blendRoute(c: TrafficCar, d: number): Pose {
    const at = this.route.pose(c.station), next = this.route.pose(c.station + d)
    const k = Math.max(0, 1 - Math.abs(d) / 2)
    return { x: next.x + (c.pose.x - at.x) * k, z: next.z + (c.pose.z - at.z) * k, h: next.h + wrapAngle(c.pose.h - at.h) * k }
  }

  private yieldTo(c: TrafficCar) {
    c.giveWay = { left: BACK_OFF, stalled: 0, hold: 0 }
    c.indicator = 0
    // Release any junction it had reserved; it asks again once the player is past.
    c.merging = false
    this.givenWay++
  }

  /**
   * Give way to the player: back off along the car's own path (up to BACK_OFF
   * metres), then wait there until the player's body and next 5 m are clear
   * of the car's way ahead.
   */
  private giveWay(c: TrafficCar, dt: number, player: Player) {
    const way = c.giveWay!
    c.heldByPlayer = 0
    if (way.left > 0.01) {
      const back = (d: number) => c.phase === 'route' ? this.blendRoute(c, -d) : this.pathPose(c, Math.max(0, c.distance - d))
      const limit = c.phase === 'route' ? way.left : Math.min(way.left, c.distance)
      this.backingOff = true
      const room = Math.min(limit, this.probe(c, back, Math.min(2, limit), player))
      const move = this.stepSpeed(c, dt, 1.0, room, -1)
      const free = move > 1e-4 && this.check(c, back(move), player) === 'ok'
      this.backingOff = false
      if (free) {
        this.place(c, back(move))
        if (c.phase === 'route') c.station = this.route.wrap(c.station - move)
        else c.distance -= move
        way.left -= move
        way.stalled = 0
      } else {
        c.speed = 0
        way.stalled += dt
        // Ask a car right behind to make room as well.
        if (this.lastBlock === 'traffic' && way.stalled > 0.5) {
          const behind = this.moving.find(other => other !== c && !other.giveWay &&
            polygonClearance(other.box.polygon, [passengerBox(c.id, c.car.type, back(1))], CAR_GAP) < CAR_GAP)
          if (behind) this.yieldTo(behind)
        }
        if (way.stalled > 1.5 || limit < 0.01) way.left = 0
      }
      return
    }
    c.speed = 0
    way.hold += dt
    // Still in the player's way after backing off (e.g. the player keeps reversing toward it): back off again.
    if (player.blockedBy === c.id && (player.blockedTime ?? 0) > GIVE_WAY_AFTER && way.hold > GIVE_WAY_AFTER) {
      way.left = BACK_OFF
      way.stalled = 0
      way.hold = 0
      return
    }
    const ahead = (d: number) => c.phase === 'route' ? this.route.pose(c.station + d) : this.pathPose(c, Math.min(this.pathOf(c).length, c.distance + d))
    const zone = [player.box, ...player.corridor]
    const clear = player.blockedBy !== c.id && [1, 2.5, 4, 6].every(d =>
      polygonClearance(passengerBox(c.id, c.car.type, ahead(d)).polygon, zone, CAR_GAP + 0.3) >= CAR_GAP + 0.3)
    if (clear && way.hold > 1 || way.hold > 25) {
      if (c.phase === 'depart') {
        if (!this.mergeClear(this.pathOf(c).station, c, player) && way.hold <= 25) return
        c.merging = true
      }
      c.giveWay = undefined
    }
  }

  // The car on the loop that keeps a merge at `station` closed.
  private mergeBlocker(station: number, c: TrafficCar) {
    let best: TrafficCar | undefined, distance = Infinity
    for (const other of this.moving) {
      if (other === c || other.phase !== 'route' && !other.merging) continue
      const d = Math.abs(this.route.delta(station, other.station))
      if (d < distance) { best = other; distance = d }
    }
    return best?.id
  }

  private mergeClear(station: number, c: TrafficCar, player: Player) {
    if (this.nearPlayer(station, player)) return false
    return this.moving.every(other => other === c || other.phase !== 'route' && !other.merging ||
      Math.abs(this.route.delta(station, other.station)) >= GAP + halfLength(c.car) + halfLength(other.car) + 1)
  }

  private depart(time: number, player: Player) {
    for (const { bay } of this.bays) {
      const car = this.parked.get(bay.id)
      if (!car?.noseIn || bay.id === player.bay) continue
      const dynamic = [player.box, ...player.corridor, ...this.moving.map(c => c.box)]
      const others = this.parkedCollision.filter(box => box.id !== bay.id)
      const path = noseInPath(this.lot, this.route, bay, car, others.concat(dynamic))
      if (!path || this.insideZone(path.station, player.zone)) continue
      // Never start moving where the footprint touches the player or a parked car,
      // and keep the whole way out clear of the player and its next 5 m.
      if (path.points.some(pose => polygonClearance(passengerBox(bay.id, car.type, pose).polygon, dynamic, CAR_GAP) < CAR_GAP)) continue
      if (polygonClearance(passengerBox(bay.id, car.type, parkedPose(bay, car)).polygon, others, 0.02) < 0.02) continue
      const c = this.addCar(car, parkedPose(bay, car), 'depart', path.station)
      if (!this.mergeClear(path.station, c, player)) {
        this.moving.pop()
        continue
      }
      this.parked.delete(bay.id)
      this.refreshParked()
      c.turn = { bay, path }
      c.indicator = -Math.sign(path.points[0].curvature)
      c.merging = true
      this.departed++
      this.departAfter = time + 40
      this.enterAfter = time + 2
      return true
    }
    return false
  }

  private enter(time: number, player: Player) {
    const path = this.branches.entry
    const pose = path.points[0]
    if (this.moving.some(c => c.phase === 'enter' && c.distance < 9)) return
    const car = pickPassenger(this.random)
    const c = this.addCar(car, pose, 'enter', path.station, this.nextId % 3 !== 0)
    if (this.check(c, pose, player, false) !== 'ok') {
      this.moving.pop()
      this.enterAfter = time + 1
      return
    }
    this.entered++
    this.enterAfter = time + 3
  }
}
