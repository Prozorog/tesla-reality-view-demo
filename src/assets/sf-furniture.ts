import {
  BoxGeometry, Color, ConeGeometry, CylinderGeometry, Group, IcosahedronGeometry, InstancedMesh,
  LOD, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SphereGeometry, Vector3,
} from 'three'
import type { BufferGeometry } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Lot, Point } from '../simulation/lot.ts'
import type { SfMap, SfRoad } from '../simulation/sf-map.ts'
import { canvasTexture } from './boxes.ts'

const CHUNK = 128
const CURB_STREETS = new Set(['Chestnut Street', 'Divisadero Street', 'Marina Boulevard', 'Baker Street', 'Bay Street'])
type Street = Pick<SfRoad, 'name' | 'width' | 'points'>
type Sample = { point: Point; direction: Point }
type RoadEdge = { a: Point; b: Point; dx: number; dz: number; length: number; road: SfRoad; halfWidth: number }
export type SfStreetLamp = {
  id: string
  kind: 'cobra' | 'acorn'
  pos: Point
  head: [x: number, y: number, z: number]
  height: number
  yaw: number
}

function hash(text: string) {
  let result = 2166136261
  for (const character of text) result = Math.imul(result ^ character.charCodeAt(0), 16777619)
  return result >>> 0
}

function pavedHalfWidth(road: Street) { return road.width / 2 + (CURB_STREETS.has(road.name) ? 2.9 : 0) }

function shifted(point: Point, direction: Point, sideways: number, along = 0): Point {
  return [point[0] + direction[0] * along - direction[1] * sideways,
    point[1] + direction[1] * along + direction[0] * sideways]
}

function samples(road: Street, spacing: number, first: number): Sample[] {
  const result: Sample[] = []
  let offset = first
  for (let index = 1; index < road.points.length; index++) {
    const a = road.points[index - 1], b = road.points[index]
    const length = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (length < 0.001) continue
    const direction: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
    while (offset <= length) {
      result.push({ point: shifted(a, direction, 0, offset), direction })
      offset += spacing
    }
    offset -= length
  }
  return result
}

function clearDomeView(point: Point, map: SfMap, lot: Lot, margin = 0) {
  const start = lot.entrance.pos, end = map.rotunda
  const dx = end[0] - start[0], dz = end[1] - start[1], length = Math.hypot(dx, dz)
  const along = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / length
  const across = Math.abs((point[0] - start[0]) * dz - (point[1] - start[1]) * dx) / length
  return along > -4 && along < length + 8 && across < 4.5 + along / length * 10 + margin
}

/** Shared by the visible fixtures and the night bake. Coordinates are world metres. */
export function sfStreetLamps(map: SfMap, lot: Lot): SfStreetLamp[] {
  const result: SfStreetLamp[] = []
  for (const road of map.roads) {
    if (road.kind === 'service' || road.name === 'Access road' || road.name === 'Lyon Street' && road.width < 6) continue
    const spacing = road.name === 'Palace Drive' ? 28 : 34
    const phase = 8 + hash(String(road.id)) % 11
    for (const [index, sample] of samples(road, spacing, phase).entries()) {
      for (const side of [-1, 1]) {
        const pos = shifted(sample.point, sample.direction, side * (pavedHalfWidth(road) + 0.55), side > 0 ? 0 : 13)
        if (result.some(lamp => Math.hypot(lamp.pos[0] - pos[0], lamp.pos[1] - pos[1]) < 7)) continue
        if (clearDomeView(pos, map, lot, 0.3)) continue
        const waterfront = road.name === 'Marina Boulevard' && pos[1] < sample.point[1]
        const kind = waterfront || road.name === 'Palace Drive' || road.name === 'Mason Street' ? 'acorn' : 'cobra'
        const height = kind === 'acorn' ? 4.9 : 8.45
        const inward: Point = [sample.direction[1] * side, -sample.direction[0] * side]
        result.push({ id: `${road.id}-${index}-${side}`, kind, pos, height,
          yaw: Math.atan2(-inward[1], inward[0]),
          head: [pos[0] + (kind === 'cobra' ? inward[0] * 1.8 : 0), height, pos[1] + (kind === 'cobra' ? inward[1] * 1.8 : 0)] })
      }
    }
  }
  for (const [index, lamp] of lot.lamps.entries()) result.push({ id: `lagoon-lot-${index}`, kind: 'acorn',
    pos: [...lamp.pos], head: [lamp.pos[0], lamp.height, lamp.pos[1]], height: lamp.height, yaw: 0 })
  return result
}

type Primitive = 'box' | 'cylinder' | 'sphere' | 'cone' | 'lamp' | 'leaves' | 'farLeaves'
type Placement = { x: number; y: number; z: number; size: [number, number, number]; yaw: number; color: string; rotation?: Quaternion }
type Label = { point: Point; y: number; yaw: number; width: number; height: number; text: string }
type FurnitureChunk = {
  x: number; z: number; near: Map<Primitive, Placement[]>; far: Map<Primitive, Placement[]>; labels: Label[]
}

function roadEdges(map: SfMap): RoadEdge[] {
  return map.roads.flatMap(road => road.points.slice(1).flatMap((b, index) => {
    const a = road.points[index], length = Math.hypot(b[0] - a[0], b[1] - a[1])
    return length < 0.001 ? [] : [{ a, b, dx: (b[0] - a[0]) / length, dz: (b[1] - a[1]) / length,
      length, road, halfWidth: pavedHalfWidth(road) }]
  }))
}

function nearest(point: Point, edges: RoadEdge[], name?: string) {
  let best: { edge: RoadEdge; point: Point; distance: number; side: number } | undefined
  for (const edge of edges) {
    if (name && edge.road.name !== name) continue
    const t = Math.max(0, Math.min(edge.length, (point[0] - edge.a[0]) * edge.dx + (point[1] - edge.a[1]) * edge.dz))
    const projected: Point = [edge.a[0] + edge.dx * t, edge.a[1] + edge.dz * t]
    const distance = Math.hypot(point[0] - projected[0], point[1] - projected[1])
    if (!best || distance < best.distance) best = { edge, point: projected, distance,
      side: Math.sign((point[1] - projected[1]) * edge.dx - (point[0] - projected[0]) * edge.dz) || 1 }
  }
  return best
}

function inside(point: Point, polygon: Point[]) {
  let contains = false
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index], b = polygon[previous]
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] <
      (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) contains = !contains
  }
  return contains
}

function streetLabel(name: string) {
  return name.replace('Boulevard', 'BLVD').replace('Street', 'ST').replace('Drive', 'DR').replace('Avenue', 'AVE').toUpperCase()
}

export function createSfFurniture(map: SfMap, lot: Lot): Group {
  const root = new Group()
  root.name = 'San Francisco street furniture'
  const chunks = new Map<string, FurnitureChunk>()
  const edges = roadEdges(map)
  const up = new Vector3(0, 1, 0)
  const lamps = sfStreetLamps(map, lot)
  const chunkAt = ([x, z]: Point) => {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK), key = `${cx},${cz}`
    let chunk = chunks.get(key)
    if (!chunk) {
      chunk = { x: (cx + 0.5) * CHUNK, z: (cz + 0.5) * CHUNK, near: new Map(), far: new Map(), labels: [] }
      chunks.set(key, chunk)
    }
    return chunk
  }
  const add = (kind: Primitive, point: Point, y: number, size: [number, number, number], color: string,
    yaw = 0, distant = false, rotation?: Quaternion) => {
    const chunk = chunkAt(point)
    const placement = { x: point[0], y, z: point[1], size, color, yaw, rotation }
    const list = chunk.near.get(kind) ?? []
    list.push(placement)
    chunk.near.set(kind, list)
    if (distant) {
      const far = chunk.far.get(kind) ?? []
      far.push(placement)
      chunk.far.set(kind, far)
    }
  }
  const beam = (a: [number, number, number], b: [number, number, number], radius: number, color: string, distant = false) => {
    const vector = new Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    add('cylinder', [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2], (a[1] + b[1]) / 2,
      [radius, vector.length(), radius], color, 0, distant, new Quaternion().setFromUnitVectors(up, vector.normalize()))
  }

  for (const lamp of lamps) {
    const [x, z] = lamp.pos, [hx, hy, hz] = lamp.head
    const metal = lamp.kind === 'acorn' ? '#283c39' : '#50585c'
    add('cylinder', lamp.pos, 0.27, [0.21, 0.54, 0.21], metal, 0, true)
    add('cylinder', lamp.pos, lamp.height / 2 - 0.05, [0.075, lamp.height - 0.1, 0.075], metal, 0, true)
    if (lamp.kind === 'cobra') {
      const dx = (hx - x) / 1.8, dz = (hz - z) / 1.8
      beam([x, hy - 0.55, z], [x + dx * 0.55, hy + 0.16, z + dz * 0.55], 0.045, metal, true)
      beam([x + dx * 0.55, hy + 0.16, z + dz * 0.55], [hx, hy, hz], 0.045, metal, true)
      add('sphere', [hx, hz], hy, [0.63, 0.14, 0.26], '#4f5659', lamp.yaw, true)
      add('lamp', [hx, hz], hy - 0.105, [0.49, 0.035, 0.17], '#ffe4b6', lamp.yaw, true)
    } else {
      add('cylinder', lamp.pos, hy - 0.36, [0.18, 0.10, 0.18], metal, 0, true)
      add('lamp', lamp.pos, hy, [0.23, 0.36, 0.23], '#ffe6bd', 0, true)
      add('cone', lamp.pos, hy + 0.42, [0.27, 0.22, 0.27], metal, 0, true)
      add('sphere', lamp.pos, hy + 0.59, [0.045, 0.065, 0.045], metal)
      for (let index = 0; index < 4; index++) {
        const angle = index * Math.PI / 2
        beam([x + Math.cos(angle) * 0.12, hy - 0.27, z + Math.sin(angle) * 0.12],
          [x + Math.cos(angle) * 0.2, hy + 0.26, z + Math.sin(angle) * 0.2], 0.014, metal)
      }
    }
  }

  // Meters stand behind the curb; their heads and coin slots are modelled separately.
  for (const segment of map.segments) {
    if (!CURB_STREETS.has(segment.name)) continue
    for (const sample of samples(segment, 21, 8)) {
      if (map.controls.some(control => Math.hypot(sample.point[0] - control.pos[0], sample.point[1] - control.pos[1]) < 16)) continue
      const yaw = Math.atan2(-sample.direction[1], sample.direction[0])
      for (const side of [-1, 1]) {
        const pos = shifted(sample.point, sample.direction, side * (pavedHalfWidth(segment) + 0.48))
        add('cylinder', pos, 0.61, [0.035, 1.22, 0.035], '#5c6668')
        add('box', pos, 1.31, [0.25, 0.28, 0.16], '#697577', yaw)
        const face = shifted(pos, sample.direction, side * -0.09)
        add('box', face, 1.33, [0.15, 0.075, 0.014], '#607b70', yaw)
        add('box', face, 1.23, [0.065, 0.012, 0.016], '#1b262a', yaw)
      }
    }
  }

  const intersections: Point[] = []
  for (const control of map.controls) {
    if (intersections.some(point => Math.hypot(point[0] - control.pos[0], point[1] - control.pos[1]) < 22)) continue
    const main = nearest(control.pos, edges, control.street) ?? nearest(control.pos, edges)
    if (!main) continue
    intersections.push(control.pos)
    const direction: Point = [main.edge.dx, main.edge.dz]
    const pos = shifted(main.point, direction, main.edge.halfWidth + 0.75, -3.5)
    if (clearDomeView(pos, map, lot)) continue
    add('cylinder', pos, 1.67, [0.042, 3.34, 0.042], '#6d7879')
    const yaw = Math.atan2(-direction[1], direction[0])
    chunkAt(pos).labels.push({ point: pos, y: 3.16, yaw, width: 2.6, height: 0.3, text: streetLabel(main.edge.road.name) })
    const crossing = edges.filter(edge => edge.road.name !== main.edge.road.name &&
      Math.abs(edge.dx * direction[0] + edge.dz * direction[1]) < 0.65)
    const other = nearest(control.pos, crossing)
    if (other && other.distance < 19) chunkAt(pos).labels.push({ point: pos, y: 2.81,
      yaw: yaw + Math.PI / 2, width: 2.6, height: 0.3, text: streetLabel(other.edge.road.name) })
    const hydrant = shifted(pos, direction, 0, 3.5)
    add('cylinder', hydrant, 0.31, [0.14, 0.62, 0.14], '#aaa395')
    add('cylinder', hydrant, 0.07, [0.2, 0.14, 0.2], '#878b85')
    add('cone', hydrant, 0.72, [0.18, 0.19, 0.18], '#8f4939')
    for (const side of [-1, 1]) {
      const outlet = shifted(hydrant, direction, side * 0.2)
      beam([hydrant[0], 0.46, hydrant[1]], [outlet[0], 0.46, outlet[1]], 0.085, '#aaa395')
      add('sphere', outlet, 0.46, [0.09, 0.09, 0.09], '#7c5147')
    }
  }

  const stops: Point[] = []
  for (const segment of map.segments.filter(segment => CURB_STREETS.has(segment.name))) {
    for (const sample of samples(segment, 285, 36)) {
      if (stops.some(point => Math.hypot(point[0] - sample.point[0], point[1] - sample.point[1]) < 240)) continue
      const side = 1, direction = sample.direction, yaw = Math.atan2(-direction[1], direction[0])
      const pos = shifted(sample.point, direction, side * (pavedHalfWidth(segment) + 1.25))
      if (clearDomeView(pos, map, lot)) continue
      stops.push(sample.point)
      add('cylinder', pos, 1.5, [0.04, 3, 0.04], '#72817f')
      chunkAt(pos).labels.push({ point: pos, y: 2.68, yaw, width: 0.7, height: 0.92, text: 'MARINA LOCAL' })
      const bench = shifted(pos, direction, 0.4, 2.3)
      add('box', bench, 0.48, [2.25, 0.095, 0.42], '#645e50', yaw)
      add('box', shifted(bench, direction, 0.19), 0.78, [2.25, 0.4, 0.06], '#5c594c', yaw)
      for (const offset of [-0.8, 0.8]) add('box', shifted(bench, direction, 0, offset), 0.24, [0.065, 0.48, 0.34], '#344543', yaw)
    }
  }

  const footprints = map.buildings.map(building => ({ outline: building.outline,
    minX: Math.min(...building.outline.map(point => point[0])), maxX: Math.max(...building.outline.map(point => point[0])),
    minZ: Math.min(...building.outline.map(point => point[1])), maxZ: Math.max(...building.outline.map(point => point[1])) }))
  const trees: Point[] = []
  const plant = (source: Point) => {
    let point: Point = [...source]
    for (let attempt = 0; attempt < 3; attempt++) {
      const road = nearest(point, edges)
      if (!road || road.distance >= road.edge.halfWidth + 1.05) break
      point = shifted(road.point, [road.edge.dx, road.edge.dz], road.side * (road.edge.halfWidth + 1.35))
    }
    const road = nearest(point, edges)
    if (road && road.distance < road.edge.halfWidth + 0.8) return
    if (clearDomeView(point, map, lot, 2.2)) return
    if (map.controls.some(control => Math.hypot(point[0] - control.pos[0], point[1] - control.pos[1]) < 10)) return
    if (lot.route.some(route => Math.hypot(point[0] - route[0], point[1] - route[1]) < 4.1) ||
      lot.bays.some(bay => Math.hypot(point[0] - bay.center[0], point[1] - bay.center[1]) < 4.5)) return
    if (footprints.some(building => point[0] >= building.minX && point[0] <= building.maxX &&
      point[1] >= building.minZ && point[1] <= building.maxZ && inside(point, building.outline))) return
    if (trees.some(tree => Math.hypot(tree[0] - point[0], tree[1] - point[1]) < 5.8)) return
    trees.push(point)
  }
  for (const point of map.trees) plant(point)
  const mappedTreeCount = trees.length
  for (const segment of map.segments) {
    if (!CURB_STREETS.has(segment.name)) continue
    for (const side of [-1, 1]) {
      for (const sample of samples(segment, 9.4, side < 0 ? 4.7 : 9.4)) {
        const frontage = hash(`${segment.name}:${Math.floor(sample.point[0] / 28)}:${Math.floor(sample.point[1] / 28)}:${side}`)
        const planting = hash(`${sample.point[0].toFixed(1)},${sample.point[1].toFixed(1)}:${side}`)
        // Doorways, deliveries and restaurant frontages leave irregular openings.
        if (frontage % 5 === 0 || planting % 9 === 0) continue
        const point = shifted(sample.point, sample.direction,
          side * (pavedHalfWidth(segment) + 1.15 + planting % 65 / 100), (planting % 201 - 100) / 100)
        const waterfront = segment.name === 'Marina Boulevard' && point[1] < sample.point[1]
        if (waterfront && planting % 4 !== 0) continue
        plant(point)
      }
    }
  }
  for (const [index, point] of trees.entries()) {
    const random = hash(`${point[0].toFixed(2)},${point[1].toFixed(2)}`)
    const mapped = index < mappedTreeCount
    const upright = random % 3 === 0
    const radius = mapped ? 1.7 + random % 80 / 100 : (upright ? 0.95 : 1.2) + random % 60 / 100
    const height = mapped ? 6.3 + random % 230 / 100 : 4.9 + random % 240 / 100
    const crownHeight = upright ? radius * 1.25 : radius * 0.82
    const trunk = height - crownHeight * 0.65
    const trunkRadius = 0.075 + random % 6 / 100
    const color = ['#263b32', '#304133', '#293d38', '#354333', '#293732'][random % 5]
    add('cylinder', point, trunk / 2, [trunkRadius, trunk, trunkRadius], '#51463c', 0, true)
    for (let branch = 0; branch < 3; branch++) {
      const theta = branch * Math.PI * 2 / 3 + random % 20
      const tip: Point = [point[0] + Math.cos(theta) * radius * 0.52, point[1] + Math.sin(theta) * radius * 0.52]
      beam([point[0], trunk * 0.7, point[1]], [tip[0], height - crownHeight * 0.15, tip[1]], 0.038, '#51463c')
    }
    const crownCount = upright ? 3 : 4
    for (let crown = 0; crown < crownCount; crown++) {
      const shape = hash(`${random}:${crown}`)
      const theta = crown * Math.PI * 2 / crownCount + random % 11
      const spread = radius * (upright ? 0.22 : 0.37)
      const pos: Point = [point[0] + Math.cos(theta) * spread, point[1] + Math.sin(theta) * spread]
      add('leaves', pos, height + (shape % 81 - 40) / 100,
        [radius * (0.56 + shape % 18 / 100), crownHeight * (0.66 + shape % 24 / 100), radius * (0.6 + shape % 15 / 100)], color, theta)
    }
    const chunk = chunkAt(point), far = chunk.far.get('farLeaves') ?? []
    far.push({ x: point[0], y: height, z: point[1], size: [radius * 1.03, crownHeight, radius * 1.03], yaw: random % 7, color })
    chunk.far.set('farLeaves', far)
  }

  const labels = [...new Set([...chunks.values()].flatMap(chunk => chunk.labels.map(label => label.text)))]
  const rowHeight = 80
  const texture = canvasTexture(768, Math.max(1, labels.length) * rowHeight, context => {
    for (const [index, text] of labels.entries()) {
      const y = index * rowHeight
      const transit = text === 'MARINA LOCAL'
      context.fillStyle = transit ? '#153c54' : '#1e5142'
      context.fillRect(0, y, 768, rowHeight)
      context.strokeStyle = transit ? '#89bdce' : '#c4d9c9'
      context.lineWidth = 3
      context.strokeRect(5, y + 5, 758, rowHeight - 10)
      context.fillStyle = '#e7ece4'
      context.font = 'bold 39px Arial, sans-serif'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(text, 384, y + rowHeight / 2, 720)
    }
  })
  const signMaterial = new MeshBasicMaterial({ map: texture })
  const hardware = new MeshBasicMaterial({ color: '#ffffff' })
  const foliage = new MeshBasicMaterial({ color: '#ffffff' })
  const glow = new MeshBasicMaterial({ color: '#ffffff', toneMapped: false })
  const geometries: Record<Primitive, BufferGeometry> = {
    box: new BoxGeometry(1, 1, 1), cylinder: new CylinderGeometry(1, 1, 1, 7),
    sphere: new SphereGeometry(1, 10, 7), cone: new ConeGeometry(1, 1, 8),
    lamp: new SphereGeometry(1, 10, 7),
    leaves: new SphereGeometry(1, 9, 6), farLeaves: new IcosahedronGeometry(1, 0),
  }
  const matrix = new Matrix4(), quaternion = new Quaternion(), position = new Vector3(), scale = new Vector3(), color = new Color()
  const instantiate = (group: Group, chunk: FurnitureChunk, kind: Primitive, placements: Placement[]) => {
    const material = kind === 'lamp' ? glow : kind === 'leaves' || kind === 'farLeaves' ? foliage : hardware
    const mesh = new InstancedMesh(geometries[kind], material, placements.length)
    mesh.name = `SF ${kind}`
    for (const [index, placement] of placements.entries()) {
      position.set(placement.x - chunk.x, placement.y, placement.z - chunk.z)
      scale.fromArray(placement.size)
      quaternion.copy(placement.rotation ?? new Quaternion().setFromAxisAngle(up, placement.yaw))
      matrix.compose(position, quaternion, scale)
      mesh.setMatrixAt(index, matrix)
      mesh.setColorAt(index, color.set(placement.color))
    }
    mesh.computeBoundingSphere()
    group.add(mesh)
  }
  for (const [key, chunk] of chunks) {
    const lod = new LOD()
    lod.name = 'SF furniture chunk ' + key
    lod.position.set(chunk.x, 0, chunk.z)
    const near = new Group(), far = new Group()
    for (const [kind, placements] of chunk.near) instantiate(near, chunk, kind, placements)
    for (const [kind, placements] of chunk.far) instantiate(far, chunk, kind, placements)
    const faces: BufferGeometry[] = []
    for (const label of chunk.labels) {
      for (const side of [0, 1]) {
        const face = new PlaneGeometry(label.width, label.height)
        const uv = face.getAttribute('uv')
        const row = labels.indexOf(label.text)
        for (let index = 0; index < uv.count; index++) uv.setY(index, 1 - (row + 1 - uv.getY(index)) / Math.max(1, labels.length))
        face.rotateY(label.yaw + side * Math.PI)
        face.translate(label.point[0] - chunk.x + Math.sin(label.yaw + side * Math.PI) * 0.006,
          label.y, label.point[1] - chunk.z + Math.cos(label.yaw + side * Math.PI) * 0.006)
        faces.push(face)
      }
    }
    if (faces.length) {
      const merged = mergeGeometries(faces)
      faces.forEach(face => face.dispose())
      if (merged) {
        const mesh = new Mesh(merged, signMaterial)
        mesh.name = 'Public street names and Marina Local stops'
        near.add(mesh)
      }
    }
    lod.addLevel(near, 0)
    lod.addLevel(far, 145)
    lod.addLevel(new Group(), 520)
    root.add(lod)
  }
  root.userData.lamps = lamps.length
  root.userData.trees = trees.length
  root.userData.transitStops = stops.length
  root.userData.chunks = chunks.size
  return root
}
