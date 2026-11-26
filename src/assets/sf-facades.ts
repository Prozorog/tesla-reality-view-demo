import {
  Box3, BufferGeometry, Color, Float32BufferAttribute, Group, InstancedBufferAttribute,
  InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3,
} from 'three'
import type { PerspectiveCamera } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Point } from '../simulation/lot.ts'
import type { SfMap, SfRoad } from '../simulation/sf-map.ts'
import { editShader, model, named, standardMeshes } from './gltf.ts'

const MODULES = ['bay_a', 'bay_b', 'sash_a', 'sash_b', 'garage_a', 'entry_a', 'shop_a', 'shop_b',
  'cornice_a', 'cornice_b', 'far_window', 'far_shop', ...Array.from({ length: 8 }, (_, index) => 'sign_' + index)]
const PALETTE = ['#e2d3bc', '#c7d8c7', '#d3c5ba', '#c2d2d9', '#e2c7bd', '#d9d8c2', '#cbcbd8', '#dfdcd3']

export type SfFacadeKit = {
  modules: Map<string, BufferGeometry>
  material: MeshBasicMaterial
  grade: { paint: { value: number }; windows: { value: number }; darkWindows: { value: number } }
}

function hash(value: number | string) {
  let result = 2166136261
  for (const letter of String(value)) result = Math.imul(result ^ letter.charCodeAt(0), 16777619)
  return result >>> 0
}

export function facadeTint(id: number | string) {
  return new Color(PALETTE[hash(id) % PALETTE.length])
}

/** All colours and gains are linear. C4 can grade paint and lit glass independently. */
export async function loadSfFacadeKit(): Promise<SfFacadeKit> {
  const source = await model('sf/facades.glb')
  source.updateMatrixWorld(true)
  const modules = new Map<string, BufferGeometry>()
  for (const name of MODULES) {
    const pieces: BufferGeometry[] = []
    for (const mesh of standardMeshes(named(source, name))) {
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
      geometry.applyMatrix4(mesh.matrixWorld)
      const count = geometry.getAttribute('position').count
      for (const attribute of Object.keys(geometry.attributes)) {
        if (!['position', 'normal', 'uv', 'uv1'].includes(attribute)) geometry.deleteAttribute(attribute)
      }
      for (const name of ['uv', 'uv1']) {
        if (!geometry.hasAttribute(name)) geometry.setAttribute(name, new Float32BufferAttribute(new Float32Array(count * 2), 2))
      }
      const colors = new Float32Array(count * 3)
      const lit = new Float32Array(count)
      const normals = geometry.getAttribute('normal')
      const base = mesh.material.color
      const window = /_(window|shop_window|sign_letters)$/.test(mesh.material.name)
      const color = new Color()
      for (let i = 0; i < count; i++) {
        const shade = window ? 1 : 0.76 + 0.18 * Math.max(0, normals.getY(i)) + 0.06 * Math.max(0, normals.getZ(i))
        color.copy(base).multiplyScalar(shade).toArray(colors, i * 3)
        lit[i] = window ? 1 : 0
      }
      geometry.setAttribute('color', new Float32BufferAttribute(colors, 3))
      geometry.setAttribute('facadeWindow', new Float32BufferAttribute(lit, 1))
      pieces.push(geometry)
    }
    const geometry = mergeGeometries(pieces, false)
    for (const piece of pieces) piece.dispose()
    if (!geometry) throw new Error('Could not load SF facade module ' + name)
    geometry.computeBoundingSphere()
    modules.set(name, geometry)
  }
  const grade = { paint: { value: 0.12 }, windows: { value: 0.64 }, darkWindows: { value: 0.012 } }
  const material = new MeshBasicMaterial({ vertexColors: true })
  material.name = 'NightFacadeKit'
  material.userData.nightFacade = grade
  editShader(material, 'sf-facade-night', shader => {
    shader.uniforms.facadePaintGain = grade.paint
    shader.uniforms.facadeWindowGain = grade.windows
    shader.uniforms.facadeDarkWindowGain = grade.darkWindows
    shader.vertexShader = 'attribute float facadeWindow; attribute float instanceWindow; varying vec2 vFacadeLight;\n' + shader.vertexShader
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFacadeLight = vec2(facadeWindow, instanceWindow);')
    shader.fragmentShader = 'uniform float facadePaintGain; uniform float facadeWindowGain; uniform float facadeDarkWindowGain; varying vec2 vFacadeLight;\n' + shader.fragmentShader
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= mix(facadePaintGain, mix(facadeDarkWindowGain, facadeWindowGain, vFacadeLight.y), vFacadeLight.x);`)
  })
  return { modules, material, grade }
}

type Placement = { matrix: Matrix4; tint: Color; light: number }
type FacadeChunk = {
  root: Group
  near: Group
  far: Group
  modules: Map<string, Placement[]>
  point: Vector3
}

function nearestRoad(point: Point, roads: SfRoad[]) {
  let result: { point: Point; distance: number; road: SfRoad } | undefined
  for (const road of roads) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i]
      const dx = b[0] - a[0], dz = b[1] - a[1]
      const squared = dx * dx + dz * dz
      if (!squared) continue
      const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / squared))
      const projected: Point = [a[0] + t * dx, a[1] + t * dz]
      const distance = Math.hypot(point[0] - projected[0], point[1] - projected[1])
      if (!result || distance < result.distance) result = { point: projected, distance, road }
    }
  }
  return result
}

export class SfFacades {
  private readonly chunks = new Map<string, FacadeChunk>()

  constructor(kit: SfFacadeKit, map: SfMap, parent: (point: Point) => Group, skipped: Set<string>) {
    const rotation = new Quaternion(), up = new Vector3(0, 1, 0)
    const position = new Vector3(), scale = new Vector3()
    const chestnutWays = new Set(map.segments.filter(segment => segment.name === 'Chestnut Street').map(segment => String(segment.way)))
    for (const building of map.buildings) {
      if (skipped.has(String(building.id))) continue
      const outline = building.outline
      const signed = outline.reduce((sum, a, index) => {
        const b = outline[(index + 1) % outline.length]
        return sum + a[0] * b[1] - b[0] * a[1]
      }, 0)
      const seed = hash(building.id), tint = facadeTint(building.id)
      const floors = Math.max(1, building.levels || Math.round(building.height / 3.2))
      const floorHeight = building.height / floors
      for (let edge = 0; edge < outline.length; edge++) {
        const a = outline[signed > 0 ? (edge + 1) % outline.length : edge]
        const b = outline[signed > 0 ? edge : (edge + 1) % outline.length]
        const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz)
        if (length < 2.5) continue
        const middle: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        const road = nearestRoad(middle, map.roads)
        if (!road || road.distance > 33 || ((road.point[0] - middle[0]) * -dz + (road.point[1] - middle[1]) * dx) / length < 0.1) continue
        const count = Math.max(1, Math.round(length / 4))
        const width = length / count
        const yaw = Math.atan2(-dz, dx)
        const chestnutFront = road.road.name === 'Chestnut Street' && chestnutWays.has(String(road.road.id).split('/')[0])
        const commercial = chestnutFront && road.distance < road.road.width / 2 + (building.commercial ? 14 : 9)
        const open = hash(seed + '/opening-hours') % 100 >= 18
        for (let tile = 0; tile < count; tile++) {
          const x = a[0] + dx * (tile + 0.5) / count
          const z = a[1] + dz * (tile + 0.5) / count
          const container = parent([x, z])
          let chunk = this.chunks.get(container.uuid)
          if (!chunk) {
            const near = new Group(), far = new Group()
            near.name = 'Facade detail'
            far.name = 'Facade distant'
            chunk = { root: container, near, far, modules: new Map(), point: new Vector3() }
            this.chunks.set(container.uuid, chunk)
            container.add(near, far)
          }
          const target = chunk
          const add = (module: string, y: number, height: number, light: number) => {
            const matrix = new Matrix4().compose(position.set(x, y, z), rotation.setFromAxisAngle(up, yaw), scale.set(width / 4, height, 1))
            const list = target.modules.get(module) ?? []
            list.push({ matrix, tint, light })
            target.modules.set(module, list)
          }
          const shop = commercial && (seed + tile) % 5 !== 0
          const groundModule = shop ? ['shop_a', 'shop_b'][seed % 2]
            : (seed + tile) % 3 === 0 ? 'entry_a' : 'garage_a'
          for (let floor = 0; floor < floors; floor++) {
            const random = hash(`${seed}/${edge}/${tile}/${floor}`)
            const shopLight = open && random % 100 >= 17 ? 0.28 + (random % 51) / 100 : 0
            const light = floor === 0 && shop ? shopLight : random % 100 < 34 ? 0.34 + (random % 47) / 100 : 0
            const module = floor === 0 ? groundModule : ['bay_a', 'bay_b', 'sash_a', 'sash_b'][(seed + Math.floor(tile / 2) + floor) % 4]
            add(module, 0.12 + floor * floorHeight, floorHeight / 3.2, light)
            add(floor === 0 && shop ? 'far_shop' : 'far_window', 0.12 + floor * floorHeight, floorHeight / 3.2, light)
          }
          add(seed % 2 ? 'cornice_a' : 'cornice_b', building.height + 0.12, 1, 0)
          if (shop && tile === Math.floor(count / 2)) add('sign_' + seed % 8,
            0.12 + floorHeight * 0.91, 1, open ? 0.3 + (seed % 43) / 100 : 0.03)
        }
      }
    }
    for (const chunk of this.chunks.values()) {
      for (const [name, placements] of chunk.modules) {
        const source = kit.modules.get(name)
        if (!source) throw new Error('Missing facade module ' + name)
        const geometry = source.clone()
        geometry.setAttribute('instanceWindow', new InstancedBufferAttribute(new Float32Array(placements.map(placement => placement.light)), 1))
        const instances = new InstancedMesh(geometry, kit.material, placements.length)
        instances.name = 'Facade ' + name
        for (const [index, placement] of placements.entries()) {
          instances.setMatrixAt(index, placement.matrix)
          instances.setColorAt(index, placement.tint)
        }
        instances.computeBoundingSphere()
        instances.computeBoundingBox()
        const level = name.startsWith('far_') ? chunk.far : chunk.near
        level.add(instances)
      }
      new Box3().setFromObject(chunk.root).getCenter(chunk.point)
      chunk.modules.clear()
    }
  }

  prepare(camera: PerspectiveCamera) {
    for (const chunk of this.chunks.values()) {
      const near = Math.hypot(camera.position.x - chunk.point.x, camera.position.z - chunk.point.z) < 210
      chunk.near.visible = near
      chunk.far.visible = !near
    }
  }
}
