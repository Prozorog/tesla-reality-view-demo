import {
  Box3, BoxGeometry, Color, DoubleSide, DynamicDrawUsage, ExtrudeGeometry, Float32BufferAttribute,
  Frustum, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera,
  PlaneGeometry, Quaternion, Shape, ShapeGeometry, SphereGeometry, Vector2, Vector3, BufferGeometry,
} from 'three'
import type { Object3D } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { bayRectangle } from '../simulation/geometry.ts'
import type { Lot, Point } from '../simulation/lot.ts'
import type { SfMap, SfRoad } from '../simulation/sf-map.ts'
import type { SfTrip } from '../simulation/sf-trip.ts'
import { batch, canvasTexture } from './boxes.ts'
import type { BoxSpec } from './boxes.ts'
import { facadeTint, SfFacades } from './sf-facades.ts'
import type { SfFacadeKit } from './sf-facades.ts'

const CHUNK_SIZE = 128
const CURB_LANE_STREETS = new Set(['Chestnut Street', 'Divisadero Street', 'Marina Boulevard', 'Baker Street', 'Bay Street'])
type Surface = 'buildings' | 'roads' | 'sidewalks' | 'paint' | 'parks' | 'water'
type Chunk = { root: Group; surfaces: Map<Surface, BufferGeometry[]>; hardware: BoxSpec[]; bounds: Box3 }
type RoadPosition = { point: Point; direction: Point; road: SfRoad; distance: number }
type Signal = { id: number | string; first: number }

function polygon(points: Point[], height = 0, base = 0) {
  const shape = new Shape(points.map(([x, z]) => new Vector2(x, -z)))
  const geometry = height > 0
    ? new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, steps: 1, curveSegments: 1 })
    : new ShapeGeometry(shape)
  return geometry.rotateX(-Math.PI / 2).translate(0, base, 0)
}

function ribbon(a: Point, b: Point, inner: number, outer: number, y: number) {
  const dx = b[0] - a[0], dz = b[1] - a[1]
  const length = Math.hypot(dx, dz)
  const nx = -dz / length, nz = dx / length
  const low = Math.min(inner, outer), high = Math.max(inner, outer)
  const point = (p: Point, offset: number) => [p[0] + nx * offset, y, p[1] + nz * offset]
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute([
    ...point(a, low), ...point(b, high), ...point(b, low),
    ...point(a, low), ...point(a, high), ...point(b, high),
  ], 3))
  geometry.computeVertexNormals()
  return geometry
}

function stroke(a: Point, b: Point, width: number, y = 0.022) {
  return ribbon(a, b, -width / 2, width / 2, y)
}

function loopSurface(route: Point[], halfWidth: number, y: number) {
  const edge = route.map((point, i) => {
    const previous = route[(i + route.length - 1) % route.length], next = route[(i + 1) % route.length]
    const incoming = Math.atan2(point[1] - previous[1], point[0] - previous[0])
    const outgoing = Math.atan2(next[1] - point[1], next[0] - point[0])
    const delta = Math.atan2(Math.sin(outgoing - incoming), Math.cos(outgoing - incoming))
    const normal = incoming + delta / 2 + Math.PI / 2
    const offset = halfWidth / Math.max(0.65, Math.cos(delta / 2))
    return [offset * Math.cos(normal), offset * Math.sin(normal)] as Point
  })
  const vertices: number[] = []
  for (let i = 0; i < route.length; i++) {
    const next = (i + 1) % route.length
    const vertex = (index: number, side: number) => [route[index][0] + edge[index][0] * side, y, route[index][1] + edge[index][1] * side]
    vertices.push(...vertex(i, -1), ...vertex(next, 1), ...vertex(next, -1),
      ...vertex(i, -1), ...vertex(i, 1), ...vertex(next, 1))
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
  geometry.computeVertexNormals()
  return geometry
}

function centre(points: Point[]): Point {
  return points.reduce(([x, z], p) => [x + p[0] / points.length, z + p[1] / points.length], [0, 0])
}

function along(point: Point, direction: Point, distance: number, lateral = 0): Point {
  return [point[0] + direction[0] * distance - direction[1] * lateral,
    point[1] + direction[1] * distance + direction[0] * lateral]
}

function pavedWidth(road: Pick<SfRoad, 'name' | 'width'>) {
  return road.width + (CURB_LANE_STREETS.has(road.name) ? 5.8 : 0)
}

export class SfWorld {
  readonly root = new Group()
  private readonly chunks = new Map<string, Chunk>()
  private readonly frustum = new Frustum()
  private readonly projection = new Matrix4()
  private readonly signals: Signal[] = []
  private readonly signalLamps: InstancedMesh
  private readonly pedestrians: InstancedMesh
  private readonly matrix = new Matrix4()
  private readonly position = new Vector3()
  private readonly scale = new Vector3()
  private readonly rotation = new Quaternion()
  private readonly up = new Vector3(0, 1, 0)
  private readonly color = new Color()
  private readonly facades?: SfFacades

  constructor(private readonly map: SfMap, lot: Lot, private readonly facadeKit?: SfFacadeKit, landmarks?: Object3D) {
    this.root.name = 'San Francisco'
    if (landmarks) this.root.add(landmarks)
    const skipped = new Set(landmarks ? ['288371295', '288371310', '288371313', '288371306', '288371314'] : [])
    const ground = new Mesh(new PlaneGeometry(3000, 2200).rotateX(-Math.PI / 2),
      new MeshBasicMaterial({ color: '#33383d' }))
    ground.position.set(500, -0.04, 180)
    ground.name = 'City ground'
    this.root.add(ground)

    for (const building of map.buildings) {
      if (skipped.has(String(building.id))) continue
      const geometry = polygon(building.outline, building.height, 0.12)
      const normals = geometry.getAttribute('normal')
      const colors = new Float32Array(normals.count * 3)
      const tint = facadeKit ? facadeTint(building.id) : new Color('#ffffff')
      for (let i = 0; i < normals.count; i++) {
        const shade = 0.47 + Math.max(0, normals.getY(i)) * 0.16 + Math.max(0, normals.getX(i) * 0.4 - normals.getZ(i) * 0.5) * 0.12
        this.color.setRGB(shade * tint.r, shade * 1.015 * tint.g, shade * 1.035 * tint.b).toArray(colors, i * 3)
      }
      geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
      if (facadeKit) {
        geometry.setAttribute('facadeWindow', new Float32BufferAttribute(new Float32Array(normals.count), 1))
        geometry.setAttribute('instanceWindow', new Float32BufferAttribute(new Float32Array(normals.count), 1))
      }
      this.add('buildings', centre(building.outline), geometry)
    }
    for (const road of map.roads) this.road(road)
    for (const park of map.parks) this.add('parks', centre(park.outline), polygon(park.outline, 0, 0.008))
    for (const water of map.water) this.add('water', centre(water.outline), polygon(water.outline, 0, 0.012))
    this.arrival(lot)

    const crossingKeys = new Set<string>()
    for (const crossing of map.crosswalks) {
      const nearest = this.nearest(crossing.pos, crossing.road)
      const key = `${Math.round(crossing.pos[0] / 2)},${Math.round(crossing.pos[1] / 2)}`
      if (nearest && nearest.distance < nearest.road.width / 2 + 3 && !crossingKeys.has(key)) {
        crossingKeys.add(key)
        this.crosswalk(nearest.point, nearest.direction, nearest.road.width)
      }
    }

    const stops: { point: Point; direction: Point }[] = []
    const lamps: { point: Point; y: number }[] = []
    for (const control of map.controls) {
      const nearest = this.routePosition(control.station) ?? this.nearest(control.pos)
      if (!nearest) continue
      const { direction, road } = nearest
      const stop = along(control.pos, direction, -2.2)
      this.add('paint', stop, stroke(along(stop, direction, 0, 0.16),
        along(stop, direction, 0, road.width / 2 - 0.18), 0.42))
      if (control.crossing && !map.crosswalks.some(crossing => Math.hypot(crossing.pos[0] - control.pos[0], crossing.pos[1] - control.pos[1]) < 3)) {
        this.crosswalk(along(control.pos, direction, 1.4), direction, road.width)
      }
      const curb = along(control.pos, direction, -0.8, pavedWidth(road) / 2 + 0.65)
      this.chunk(curb).hardware.push({ pos: [curb[0], control.kind === 'signal' ? 2.15 : 1.04, curb[1]],
        size: [0.075, control.kind === 'signal' ? 4.3 : 2.08, 0.075], color: '#919699' })
      if (control.kind === 'stop') {
        stops.push({ point: curb, direction })
      } else {
        const face = along(curb, direction, -0.19)
        this.chunk(curb).hardware.push({ pos: [curb[0], 3.9, curb[1]], size: [0.44, 1.13, 0.32],
          yaw: Math.atan2(-direction[0], -direction[1]), color: '#171c20' })
        this.signals.push({ id: control.id, first: lamps.length })
        for (const y of [4.24, 3.91, 3.58]) lamps.push({ point: face, y })
      }
    }
    this.stopSigns(stops)
    this.signalLamps = new InstancedMesh(new SphereGeometry(0.13, 8, 6),
      new MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), lamps.length)
    for (const [index, lamp] of lamps.entries()) {
      this.matrix.makeTranslation(lamp.point[0], lamp.y, lamp.point[1])
      this.signalLamps.setMatrixAt(index, this.matrix)
      this.signalLamps.setColorAt(index, this.color.set('#321c18'))
    }
    this.signalLamps.instanceColor?.setUsage(DynamicDrawUsage)
    this.signalLamps.computeBoundingSphere()
    this.root.add(this.signalLamps)

    this.pedestrians = new InstancedMesh(new BoxGeometry(1, 1, 1),
      new MeshBasicMaterial({ color: '#9b9ea1' }), Math.max(64, map.crosswalks.length * 2) * 4)
    this.pedestrians.instanceMatrix.setUsage(DynamicDrawUsage)
    this.pedestrians.count = 0
    this.pedestrians.frustumCulled = false
    this.root.add(this.pedestrians)
    if (facadeKit) this.facades = new SfFacades(facadeKit, map, point => this.chunk(point).root, skipped)
    this.finishChunks()
  }

  private chunk([x, z]: Point) {
    const key = `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`
    let chunk = this.chunks.get(key)
    if (!chunk) {
      const root = new Group()
      root.name = 'City chunk ' + key
      chunk = { root, surfaces: new Map(), hardware: [], bounds: new Box3() }
      this.chunks.set(key, chunk)
      this.root.add(root)
    }
    return chunk
  }

  private add(kind: Surface, point: Point, geometry: BufferGeometry) {
    if (geometry.index) {
      const indexed = geometry
      geometry = geometry.toNonIndexed()
      indexed.dispose()
    }
    geometry.deleteAttribute('uv')
    const chunk = this.chunk(point)
    const list = chunk.surfaces.get(kind) ?? []
    list.push(geometry)
    chunk.surfaces.set(kind, list)
  }

  private nearest(point: Point, roadId?: number | string): RoadPosition | undefined {
    let result: RoadPosition | undefined
    const requested = roadId === undefined ? undefined : String(roadId)
    const matching = requested === undefined ? [] : this.map.roads.filter(road => String(road.id).split('/')[0] === requested)
    for (const road of matching.length ? matching : this.map.roads) {
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1], b = road.points[i]
        const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz)
        if (!length) continue
        const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (length * length)))
        const projected: Point = [a[0] + dx * t, a[1] + dz * t]
        const distance = Math.hypot(point[0] - projected[0], point[1] - projected[1])
        if (!result || distance < result.distance) result = { point: projected, direction: [dx / length, dz / length], road, distance }
      }
    }
    return result
  }

  private routePosition(station: number): RoadPosition | undefined {
    const segment = this.map.segments.find(segment => station <= segment.start + segment.length + 0.01)
    if (!segment) return undefined
    let remaining = station - segment.start
    for (let i = 1; i < segment.points.length; i++) {
      const a = segment.points[i - 1], b = segment.points[i]
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (remaining <= length || i === segment.points.length - 1) {
        return { point: along(a, [(b[0] - a[0]) / length, (b[1] - a[1]) / length], remaining),
          direction: [(b[0] - a[0]) / length, (b[1] - a[1]) / length],
          road: { ...segment, id: segment.way, kind: 'route' }, distance: 0 }
      }
      remaining -= length
    }
    return undefined
  }

  private road(road: SfRoad) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i]
      const length = Math.hypot(b[0] - a[0], b[1] - a[1])
      if (length < 0.02) continue
      const middle: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
      const direction: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
      this.add('roads', middle, ribbon(a, b, -road.width / 2, road.width / 2, 0.014))
      const edgeWidth = pavedWidth(road)
      for (const side of [-1, 1]) {
        if (edgeWidth > road.width) this.add('roads', middle,
          ribbon(a, b, side * road.width / 2, side * edgeWidth / 2, 0.014))
        if (road.kind === 'service') continue
        // Leave junction mouths open instead of carrying raised kerbs through
        // the intersecting road. Short spans also leave flat crosswalk ramps.
        for (let from = 0; from < length; from += 3) {
          const to = Math.min(length, from + 3)
          const p = along(a, direction, from), q = along(a, direction, to)
          const center = along(a, direction, (from + to) / 2)
          const edge = along(center, direction, 0, side * (edgeWidth / 2 + 0.9))
          if (this.intersection(edge, direction, road)) continue
          this.add('sidewalks', center, ribbon(p, q, side * (edgeWidth / 2 + 0.12), side * (edgeWidth / 2 + 2.65), 0.145))
          const curb = along(center, direction, 0, side * (edgeWidth / 2 + 0.10))
          this.chunk(center).hardware.push({ pos: [curb[0], 0.072, curb[1]],
            size: [to - from, 0.145, 0.20], yaw: Math.atan2(-direction[1], direction[0]), color: '#7a8085' })
        }
      }
      if (road.lanes > 1 && !road.oneway) {
        for (const offset of [-0.12, 0.12]) this.add('paint', middle, ribbon(a, b, offset - 0.045, offset + 0.045, 0.025))
      }
    }
  }

  private intersection(point: Point, direction: Point, ownRoad: SfRoad) {
    for (const road of this.map.roads) {
      if (road === ownRoad) continue
      for (let i = 1; i < road.points.length; i++) {
        const a = road.points[i - 1], b = road.points[i]
        const dx = b[0] - a[0], dz = b[1] - a[1]
        const squared = dx * dx + dz * dz
        if (!squared || Math.abs(direction[0] * dz - direction[1] * dx) / Math.sqrt(squared) < 0.3) continue
        const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / squared))
        const distance = Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz)
        if (distance < pavedWidth(road) / 2 + 1) return true
      }
    }
    return false
  }

  private crosswalk(point: Point, direction: Point, width: number) {
    for (let lateral = -width / 2 + 0.4; lateral < width / 2 - 0.2; lateral += 0.9) {
      this.add('paint', point, stroke(along(point, direction, -1.45, lateral), along(point, direction, 1.45, lateral), 0.43, 0.029))
    }
  }

  private arrival(lot: Lot) {
    this.add('roads', centre(this.map.lotPolygon), polygon(this.map.lotPolygon, 0, 0.017))
    this.add('roads', centre(lot.route), loopSurface(lot.route, 3.5, 0.018))
    const seen = new Set<string>()
    for (const bay of lot.bays) {
      const corners = bayRectangle(bay)
      this.add('roads', bay.center, polygon(corners, 0, 0.019))
      for (const [a, b] of [[corners[0], corners[1]], [corners[2], corners[3]], [corners[3], corners[0]]]) {
        const key = [a, b].map(point => point.map(value => value.toFixed(2)).join(',')).sort().join('/')
        if (seen.has(key)) continue
        seen.add(key)
        this.add('paint', bay.center, stroke(a, b, 0.075, 0.033))
      }
    }
    for (const kerb of lot.kerbs) this.add('sidewalks', centre(kerb.outline), polygon(kerb.outline, 0.14))
  }

  private stopSigns(stops: { point: Point; direction: Point }[]) {
    const texture = canvasTexture(128, 128, ctx => {
      ctx.beginPath()
      for (let i = 0; i < 8; i++) {
        const angle = Math.PI / 8 + i * Math.PI / 4
        const x = 64 + Math.cos(angle) * 61, y = 64 + Math.sin(angle) * 61
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.fillStyle = '#ba322b'
      ctx.fill()
      ctx.lineWidth = 4
      ctx.strokeStyle = '#e6e7e4'
      ctx.stroke()
      ctx.fillStyle = '#ffffff'
      ctx.font = 'bold 34px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('STOP', 64, 66)
    })
    const signs = new InstancedMesh(new PlaneGeometry(0.8, 0.8),
      new MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.5, side: DoubleSide }), stops.length)
    for (const [index, stop] of stops.entries()) {
      this.matrix.compose(this.position.set(stop.point[0], 2.1, stop.point[1]),
        this.rotation.setFromAxisAngle(this.up, Math.atan2(-stop.direction[0], -stop.direction[1])), this.scale.setScalar(1))
      signs.setMatrixAt(index, this.matrix)
    }
    signs.computeBoundingSphere()
    this.root.add(signs)
  }

  private finishChunks() {
    const materials: Record<Surface, MeshBasicMaterial> = {
      buildings: this.facadeKit?.material ?? new MeshBasicMaterial({ vertexColors: true }),
      roads: new MeshBasicMaterial({ color: '#3c4249' }),
      sidewalks: new MeshBasicMaterial({ color: '#777e84', side: DoubleSide }),
      paint: new MeshBasicMaterial({ color: '#c9cbd0', side: DoubleSide }),
      parks: new MeshBasicMaterial({ color: '#414e48' }),
      water: new MeshBasicMaterial({ color: '#30434e' }),
    }
    const hardware = new MeshBasicMaterial({ color: '#ffffff' })
    for (const chunk of this.chunks.values()) {
      for (const [kind, pieces] of chunk.surfaces) {
        const geometry = mergeGeometries(pieces, false)
        for (const piece of pieces) piece.dispose()
        if (!geometry) throw new Error('Could not batch San Francisco ' + kind)
        geometry.computeBoundingSphere()
        const mesh = new Mesh(geometry, materials[kind])
        mesh.name = kind
        chunk.root.add(mesh)
      }
      batch(chunk.root, hardware, chunk.hardware)
      chunk.bounds.setFromObject(chunk.root)
      chunk.surfaces.clear()
      chunk.hardware.length = 0
    }
  }

  prepare(camera: PerspectiveCamera) {
    this.facades?.prepare(camera)
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.frustum.setFromProjectionMatrix(this.projection)
    for (const chunk of this.chunks.values()) chunk.root.visible = this.frustum.intersectsBox(chunk.bounds)
  }

  update(trip: SfTrip) {
    for (const signal of this.signals) {
      const phase = trip.signal(signal.id)
      for (const [index, name] of ['red', 'yellow', 'green'].entries()) {
        this.color.set(phase === name ? ['#ff361d', '#ffc63f', '#35e57b'][index] : '#211c1b')
        this.signalLamps.setColorAt(signal.first + index, this.color)
      }
    }
    if (this.signalLamps.instanceColor) this.signalLamps.instanceColor.needsUpdate = true
    let instance = 0
    for (const pedestrian of trip.pedestrians) {
      const sway = pedestrian.walking ? Math.sin(trip.time * 6 + instance) * 0.11 : 0
      const pieces = [
        { size: [0.37, 0.65, 0.26], y: 1.10, forward: 0 },
        { size: [0.24, 0.27, 0.24], y: 1.57, forward: 0 },
        { size: [0.14, 0.70, 0.17], y: 0.39, forward: sway },
        { size: [0.14, 0.70, 0.17], y: 0.39, forward: -sway },
      ]
      for (const [part, piece] of pieces.entries()) {
        const lateral = part < 2 ? 0 : part === 2 ? -0.105 : 0.105
        const point = along([pedestrian.x, pedestrian.z], [Math.cos(pedestrian.h), -Math.sin(pedestrian.h)], piece.forward, lateral)
        this.matrix.compose(this.position.set(point[0], piece.y, point[1]),
          this.rotation.setFromAxisAngle(this.up, pedestrian.h), this.scale.fromArray(piece.size))
        this.pedestrians.setMatrixAt(instance++, this.matrix)
      }
    }
    this.pedestrians.count = instance
    this.pedestrians.instanceMatrix.needsUpdate = true
  }
}
