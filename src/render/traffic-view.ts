import { DynamicDrawUsage, Frustum, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, Quaternion, Vector2, Vector3 } from 'three'
import type { BufferGeometry, MeshStandardMaterial, PerspectiveCamera } from 'three'
import type { StandardMesh } from '../assets/gltf.ts'
import { shadeTeslaPaint } from '../assets/meshy-passengers.ts'
import type { ParkedBake } from '../assets/lot-model.ts'
import type { PassengerPack } from '../assets/passengers.ts'
import type { Drive } from '../simulation/drive.ts'
import type { SfTrip } from '../simulation/sf-trip.ts'
import { carCatalog, carTypes, parkedPose } from '../simulation/lot.ts'
import type { CarColor, CarType, Lot, Pose } from '../simulation/lot.ts'
import { disposeDecals } from './vehicle-decals.ts'
import type { VehicleDecals } from './vehicle-decals.ts'
import { probeSides, shadeVehicle, vehicleProbes } from './vehicle-lighting.ts'
import type { LotLighting, Probes } from './vehicle-lighting.ts'

type CarBounds = {
  center: Vector3
  nose: Vector3
  side: Vector3
  halfHeight: number
}

type Parked = {
  type: CarType
  color: CarColor
  tesla: boolean
  probes: Probes
  matrix: Matrix4
  shadow: Matrix4
  bounds: CarBounds
}

const LOD_DISTANCE = 30
const LOD_MARGIN = 1
const MOVE_STEP = 0.65
const TURN_STEP = Math.PI / 120
const PROJECTION_STEP = 0.024

function useLOD(camera: PerspectiveCamera, bounds: CarBounds, wasLow: boolean) {
  const distance = LOD_DISTANCE + (wasLow ? -LOD_MARGIN : LOD_MARGIN)
  return camera.position.distanceToSquared(bounds.center) > distance * distance
}

function carBounds(type: CarType): CarBounds {
  const { length, width, height } = carCatalog[type]
  return {
    center: new Vector3(0, height / 2, 0),
    nose: new Vector3(length / 2 + 0.01, 0, 0),
    side: new Vector3(0, 0, width / 2 + 0.01),
    halfHeight: height / 2 + 0.01,
  }
}

function placeBounds(bounds: CarBounds, type: CarType, pose: Pose, y = 0) {
  const { length, width, height } = carCatalog[type]
  const cos = Math.cos(pose.h), sin = Math.sin(pose.h)
  bounds.center.set(pose.x, y + height / 2, pose.z)
  bounds.nose.set(cos, 0, -sin).multiplyScalar(length / 2 + 0.01)
  bounds.side.set(sin, 0, cos).multiplyScalar(width / 2 + 0.01)
  return bounds
}

class ParkedBatch {
  readonly mesh: InstancedMesh<BufferGeometry, MeshStandardMaterial>
  private readonly partTransform = new Matrix4()
  private readonly matrix = new Matrix4()
  private visible: Parked[] = []

  constructor(part: StandardMesh, private readonly entries: Parked[], private readonly low: boolean) {
    const geometry = part.geometry.clone()
    const material = part.material.clone()
    material.emissiveIntensity = 0
    for (const side of probeSides) {
      geometry.setAttribute(`probe_${side}`, new InstancedBufferAttribute(new Float32Array(entries.length * 3), 3).setUsage(DynamicDrawUsage))
    }
    shadeTeslaPaint(material)
    shadeVehicle(material)
    this.partTransform.compose(part.position, part.quaternion, part.scale)
    this.mesh = new InstancedMesh(geometry, material, entries.length)
    this.mesh.name = part.name
    this.mesh.count = 0
    this.mesh.visible = false
    this.mesh.frustumCulled = false
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage)
  }

  prepare(levels: Map<Parked, boolean>) {
    const visible = this.entries.filter(entry => levels.get(entry) === this.low)
    if (visible.length === this.visible.length && visible.every((entry, i) => entry === this.visible[i])) return
    this.visible = visible
    this.mesh.count = visible.length
    this.mesh.visible = visible.length > 0
    if (!visible.length) return

    for (const [i, entry] of visible.entries()) this.mesh.setMatrixAt(i, this.matrix.copy(entry.matrix).multiply(this.partTransform))
    this.mesh.instanceMatrix.needsUpdate = true
    for (const side of probeSides) {
      const attribute = this.mesh.geometry.getAttribute(`probe_${side}`)
      for (const [i, entry] of visible.entries()) {
        const { r, g, b } = entry.probes[side]
        attribute.setXYZ(i, r, g, b)
      }
      attribute.needsUpdate = true
    }
  }

  dispose() {
    this.mesh.removeFromParent()
    this.mesh.dispose()
    this.mesh.geometry.dispose()
    this.mesh.material.dispose()
  }
}

type ParkedView = {
  root: Group
  shadows: ReturnType<VehicleDecals['parkedShadows']>
  batches: ParkedBatch[]
  visible: Parked[]
  levels: Map<Parked, boolean>
  position: Vector3
  orientation: Quaternion
  min: Vector2
  max: Vector2
  hideBaked?: boolean
  ready: boolean
}

export class TrafficView {
  readonly root = new Group()
  parkedRefreshes = 0
  private readonly frustum = new Frustum()
  private readonly viewProjection = new Matrix4()
  private readonly paddedProjection = new Matrix4()
  private readonly viewMin = new Vector2()
  private readonly viewMax = new Vector2()
  private readonly baked: Parked[]
  private parked: Parked[] = []
  private readonly fullParts = new Map<StandardMesh, Parked[]>()
  private readonly lodParts = new Map<StandardMesh, Parked[]>()
  private readonly parkedViews = new Map<string, ParkedView>()
  private activeView?: ParkedView
  private readonly fleet = new Map<string, ReturnType<TrafficView['vehicle']>>()
  private readonly streetCars: ReturnType<TrafficView['vehicle']>[] = []
  private revision = -1

  constructor(
    private readonly lot: Lot,
    private readonly pack: PassengerPack,
    private readonly lighting: LotLighting,
    private readonly decals: VehicleDecals,
    baked: Record<string, ParkedBake>,
    street?: SfTrip,
  ) {
    this.root.name = 'passenger_cars'
    this.baked = lot.bays.flatMap(bay => {
      if (!bay.car) return []
      const entry = baked[bay.id]
      const heroColor = pack.hasTesla && pack.heroBays[bay.id]
      const color = heroColor ? heroColor as CarColor : bay.car.color
      if (!entry) return [this.place(bay.car.type, color, parkedPose(bay, bay.car), undefined, 0, !!heroColor)]
      const probes = vehicleProbes()
      for (const side of probeSides) probes[side].fromArray(entry.probes[side].rgb)
      const [x, y, z] = entry.position
      return [this.place(entry.type, color, { x, z, h: entry.heading }, probes, y, !!heroColor)]
    })
    if (street) {
      for (const { car, pose } of street.parkedCars) this.baked.push(this.place(car.type, car.color, pose))
    }
    for (let i = 0; i < (street ? 0 : 4); i++) {
      const type = carTypes[i]
      this.streetCars.push(this.vehicle(type, carCatalog[type].variants[0].color as CarColor))
    }
  }

  private place(type: CarType, color: CarColor, pose: Pose, probes = this.lighting.sample(pose, vehicleProbes()), y = 0, tesla = false): Parked {
    const { length, width } = carCatalog[type]
    return {
      type, color, tesla, probes,
      matrix: new Matrix4().makeRotationY(pose.h).scale(new Vector3().setScalar(this.pack.scale(type, color, tesla))).setPosition(pose.x, y, pose.z),
      shadow: this.decals.parkedMatrix(pose, length, width, this.lighting.nearestLamp(pose.x, pose.z)),
      bounds: placeBounds(carBounds(type), type, pose, y),
    }
  }

  private rebuildParked(drive: Drive) {
    for (const view of this.parkedViews.values()) {
      view.root.removeFromParent()
      view.shadows.dispose()
      view.shadows.material.dispose()
      for (const batch of view.batches) batch.dispose()
    }
    this.parkedViews.clear()
    this.fullParts.clear()
    this.lodParts.clear()
    this.activeView = undefined
    this.parked = [...this.baked, ...this.lot.bays.flatMap(bay => {
      const car = drive.runtimeCars.get(bay.id)
      return car ? [this.place(car.type, car.color, parkedPose(bay, car))] : []
    })]
    for (const entry of this.parked) {
      this.addParts(this.fullParts, entry, false)
      if (this.pack.hasLOD(entry.type, entry.color, entry.tesla)) this.addParts(this.lodParts, entry, true)
    }
  }

  private addParts(batches: Map<StandardMesh, Parked[]>, entry: Parked, low: boolean) {
    for (const part of this.pack.parts(entry.type, entry.color, low ? 'low' : 'parked', entry.tesla)) {
      let group = batches.get(part)
      if (!group) batches.set(part, group = [])
      group.push(entry)
    }
  }

  // The tablet and cropped Screen view also need independent buffers during the dive.
  private parkedView(pass: string) {
    let view = this.parkedViews.get(pass)
    if (!view) {
      const root = new Group()
      const shadows = this.decals.parkedShadows(this.parked.length)
      shadows.instanceMatrix.setUsage(DynamicDrawUsage)
      shadows.count = 0
      shadows.visible = false
      const batches = [
        ...Array.from(this.fullParts, ([part, entries]) => new ParkedBatch(part, entries, false)),
        ...Array.from(this.lodParts, ([part, entries]) => new ParkedBatch(part, entries, true)),
      ]
      root.add(shadows, ...batches.map(batch => batch.mesh))
      this.root.add(root)
      view = {
        root, shadows, batches, visible: [], levels: new Map(),
        position: new Vector3(), orientation: new Quaternion(), min: new Vector2(), max: new Vector2(), ready: false,
      }
      this.parkedViews.set(pass, view)
    }
    if (this.activeView) this.activeView.root.visible = false
    this.activeView = view
    view.root.visible = true
    return view
  }

  prepare(camera: PerspectiveCamera, pass: string, hideBaked = false) {
    this.frustum.setFromProjectionMatrix(this.viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
    for (const car of this.fleet.values()) this.prepareMoving(car, camera, pass, true)
    for (const car of this.streetCars) this.prepareMoving(car, camera, pass, car.root.visible)

    const view = this.parkedView(pass)
    if (!!view.hideBaked !== hideBaked) view.ready = false
    view.hideBaked = hideBaked
    camera.getViewBounds(1, this.viewMin, this.viewMax)
    if (view.ready && view.position.distanceToSquared(camera.position) <= MOVE_STEP * MOVE_STEP &&
      Math.abs(view.orientation.dot(camera.quaternion)) >= Math.cos(TURN_STEP / 2) &&
      view.min.distanceToSquared(this.viewMin) <= PROJECTION_STEP * PROJECTION_STEP &&
      view.max.distanceToSquared(this.viewMax) <= PROJECTION_STEP * PROJECTION_STEP) return
    this.refreshParked(camera, view)
  }

  private refreshParked(camera: PerspectiveCamera, view: ParkedView) {
    this.parkedRefreshes++
    view.ready = true
    view.position.copy(camera.position)
    view.orientation.copy(camera.quaternion)
    view.min.copy(this.viewMin)
    view.max.copy(this.viewMax)

    // Include cars that could enter the frustum before the next threshold.
    // View bounds are measured at unit depth, so this pad also grows with distance.
    const slope = Math.hypot(Math.max(Math.abs(view.min.x), Math.abs(view.max.x)),
      Math.max(Math.abs(view.min.y), Math.abs(view.max.y)))
    const turn = Math.tan(TURN_STEP)
    const pad = PROJECTION_STEP + (1 + slope * slope) * turn / (1 - slope * turn)
    const near = camera.near
    this.paddedProjection.makePerspective((view.min.x - pad) * near, (view.max.x + pad) * near,
      (view.max.y + pad) * near, (view.min.y - pad) * near, near, camera.far)
    this.frustum.setFromProjectionMatrix(this.viewProjection.multiplyMatrices(this.paddedProjection, camera.matrixWorldInverse))
    for (const plane of this.frustum.planes) plane.constant += MOVE_STEP

    const visible = this.parked.filter(car => this.visible(car.bounds))
    const previous = view.levels
    view.levels = new Map(visible.map(car => [car, this.pack.hasLOD(car.type, car.color, car.tesla) && useLOD(camera, car.bounds, previous.get(car) ?? false)]))
    if (visible.length !== view.visible.length || visible.some((car, i) => car !== view.visible[i])) {
      view.visible = visible
      for (const [i, car] of visible.entries()) view.shadows.setMatrixAt(i, car.shadow)
      view.shadows.count = visible.length
      view.shadows.visible = visible.length > 0
      view.shadows.instanceMatrix.needsUpdate = true
    }
    const meshLevels = view.hideBaked ? new Map([...view.levels].filter(([car]) => !this.baked.includes(car))) : view.levels
    for (const batch of view.batches) batch.prepare(meshLevels)
  }

  private prepareMoving(car: ReturnType<TrafficView['vehicle']>, camera: PerspectiveCamera, pass: string, active: boolean) {
    car.body.visible = active && this.visible(car.bounds)
    if (!car.low || !car.body.visible) return
    const low = useLOD(camera, car.bounds, car.lodByView.get(pass) ?? false)
    car.lodByView.set(pass, low)
    car.low.visible = low
    car.full.visible = !low
  }

  private visible(bounds: CarBounds) {
    return this.frustum.planes.every(plane => plane.distanceToPoint(bounds.center) +
      Math.abs(plane.normal.dot(bounds.nose)) + Math.abs(plane.normal.dot(bounds.side)) +
      Math.abs(plane.normal.y) * bounds.halfHeight >= 0)
  }

  private vehicle(type: CarType, color: CarColor) {
    const asset = this.pack.moving(type, color)
    const { length, width } = carCatalog[type]
    const root = new Group()
    const decals = this.decals.moving(root, length, width)
    root.add(asset.root)
    this.root.add(root)
    return {
      ...asset, root, body: asset.root, type, bounds: carBounds(type), decals, lodByView: new Map<string, boolean>(),
      dispose() { root.removeFromParent(); asset.dispose(); disposeDecals(decals) },
    }
  }

  private move(vehicle: ReturnType<TrafficView['vehicle']>, pose: Pose, braking: boolean) {
    vehicle.root.position.set(pose.x, 0, pose.z)
    vehicle.root.rotation.y = pose.h
    placeBounds(vehicle.bounds, vehicle.type, pose)
    this.lighting.sample(pose, vehicle.probes)
    vehicle.lights.head.emissiveIntensity = 1.65
    vehicle.lights.tail.emissiveIntensity = 0.62
    vehicle.lights.brake.emissiveIntensity = braking ? 2.5 : 0
    vehicle.decals.brake.material.opacity = braking ? 0.22 : 0.032
  }

  draw(drive: Drive) {
    const traffic = drive.traffic
    const moving = drive.street?.cars ?? traffic.moving
    if (this.revision !== traffic.revision) {
      this.rebuildParked(drive)
      this.revision = traffic.revision
    }
    for (const [id, vehicle] of this.fleet) {
      if (moving.some(c => c.id === id)) continue
      vehicle.dispose()
      this.fleet.delete(id)
    }
    for (const car of moving) {
      let vehicle = this.fleet.get(car.id)
      if (!vehicle) {
        vehicle = this.vehicle(car.car.type, car.car.color)
        this.fleet.set(car.id, vehicle)
      }
      this.move(vehicle, car.pose, car.braking)
      vehicle.signal.value = Math.floor(drive.time * 3.1) % 2 === 0 ? car.indicator : 0
    }
    const { from, to, z } = this.lot.street
    const span = to - from
    for (const [i, vehicle] of this.streetCars.entries()) {
      const d = (drive.time * (8.3 + i * 0.44) + 23 + i * 53) % (span + 46)
      const eastbound = i % 2 === 0
      vehicle.root.visible = d < span
      if (!vehicle.root.visible) continue
      this.move(vehicle, {
        x: eastbound ? from + d : to - d,
        z: z + (eastbound ? 1.45 : -1.45),
        h: eastbound ? 0 : Math.PI,
      }, false)
    }
  }
}
