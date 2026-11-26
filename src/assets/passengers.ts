import { Color, Group, Mesh } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { carCatalog, carColors, carTypes } from '../simulation/lot.ts'
import type { CarColor, CarType } from '../simulation/lot.ts'
import { shadeVehicle, vehicleProbes } from '../render/vehicle-lighting.ts'
import { colorTexture, editShader, manifest, model, named, standardMeshes } from './gltf.ts'
import type { StandardMesh } from './gltf.ts'
import { passengerBoxes } from './passenger-boxes.ts'
import { loadGeneratedPassengers, passengerGlass, passengerPaint } from './meshy-passengers.ts'
import type { CarParts, GeneratedPassenger } from './meshy-passengers.ts'

const lampParts = { head: 'lights_head', tail: 'lights_tail', brake: 'lights_brake' } as const
type LODManifest = { types: Partial<Record<CarType, { nodes: { root: string; body: string; rest: string } }>> }

function parkedOptics(parts: StandardMesh[], names: string[]) {
  const optics = parts.filter(part => names.includes(part.name || part.parent!.name))
  const source = optics[0]?.material
  // All four apertures of the pack use the same passive lens atlas and finish.
  // Their emissive materials remain separate on moving cars.
  if (!source || optics.length < 2 || !optics.every(({ material }) =>
    material.map === source.map && material.color.equals(source.color) &&
    material.side === source.side && material.roughness === source.roughness && material.metalness === source.metalness)) return parts
  const geometry = mergeGeometries(optics.map(part => {
    part.updateMatrix()
    return part.geometry.clone().applyMatrix4(part.matrix)
  }))
  if (!geometry) return parts
  const material = source.clone()
  material.emissiveMap = null
  material.emissive.set(0)
  const lenses = new Mesh(geometry, material)
  lenses.name = 'parked_optics'
  return [...parts.filter(part => !optics.includes(part)), lenses]
}

export class PassengerPack {
  private readonly cars = new Map<CarType, CarParts>()
  private readonly distant = new Map<CarType, CarParts>()
  private readonly generated = new Map<CarType, GeneratedPassenger[]>()
  private hero?: GeneratedPassenger
  readonly heroBays: Record<string, CarColor> = {}

  constructor(root?: Group) {
    for (const type of carTypes) {
      const { nodes } = carCatalog[type]
      const car = root ? named(root, nodes.root) : passengerBoxes(type)
      const body = named(car, nodes.body) as StandardMesh
      body.material = passengerPaint(body.material)
      for (const glass of standardMeshes(named(car, nodes.glass))) glass.material = passengerGlass(glass.material)
      const fixed = standardMeshes(car).filter(mesh => mesh !== body)
      if (root) {
        for (const wheel of standardMeshes(named(car, nodes.wheels))) {
          wheel.material = wheel.material.clone()
          wheel.material.color.multiply(new Color(0.55, 0.55, 0.55))
          wheel.material.envMapIntensity *= 0.5
        }
      }
      const parked = root && parkedOptics(fixed, [nodes.lenses, ...Object.values(lampParts).map(part => nodes[part])])
      this.cars.set(type, { fixed, parked, paint: new Map([[carCatalog[type].variants[0].color, body]]) })
    }
  }

  async loadPaint(fallback = false) {
    await Promise.all(carTypes.flatMap(type => {
      const { variants } = carCatalog[type]
      const colors = this.cars.get(type)!.paint
      const original = colors.get(variants[0].color)!
      return variants.map(async ({ color, map }, index) => {
        if (index === 0 && !fallback) return
        const paint = original.clone()
        paint.material = original.material.clone()
        if (fallback) paint.material.color.set(carColors[color as CarColor])
        else paint.material.map = await colorTexture(map)
        colors.set(color, paint)
      })
    }))
    return this
  }

  addLOD(root: Group, data: LODManifest) {
    for (const type of carTypes) {
      const entry = data.types?.[type]
      if (!entry) continue
      const { nodes } = entry
      const car = root.getObjectByName(nodes.root)
      const bodyNode = car?.getObjectByName(nodes.body), restNode = car?.getObjectByName(nodes.rest)
      if (!bodyNode || !restNode) continue
      const [body] = standardMeshes(bodyNode)
      const rest = standardMeshes(restNode)
      if (!body?.geometry.hasAttribute('uv') || !rest.some(mesh => mesh.geometry.hasAttribute('color'))) continue
      const paint = new Map<string, StandardMesh>()
      for (const [color, full] of this.cars.get(type)!.paint) {
        const variant = body.clone()
        variant.material = full.material
        paint.set(color, variant)
      }
      this.distant.set(type, { fixed: rest, paint })
    }
  }

  async loadGenerated() {
    const { vehicles, hero, heroBays } = await loadGeneratedPassengers()
    this.hero = hero
    Object.assign(this.heroBays, heroBays)
    for (const { type, model } of vehicles) {
      const variants = this.generated.get(type) ?? []
      variants.push(model)
      this.generated.set(type, variants)
    }
  }

  private generatedCar(type: CarType, color: CarColor, tesla = false) {
    if (tesla && this.hero) return this.hero
    const variants = this.generated.get(type)
    if (!variants?.length) return undefined
    const index = Object.keys(carColors).indexOf(color)
    return variants[Math.max(0, index) % variants.length]
  }

  get hasTesla() { return !!this.hero }
  hasLOD(type: CarType, color: CarColor, tesla = false) {
    const generated = this.generatedCar(type, color, tesla)
    return generated ? !!generated.low : this.distant.has(type)
  }
  get lodTypes() { return this.distant.size }

  // New meshes fit the collision rectangles already used by the lot planner.
  // Uniform scaling retains their proportions and keeps existing bays valid.
  scale(type: CarType, color: CarColor, tesla = false) {
    const generated = this.generatedCar(type, color, tesla)
    if (!generated) return 1
    const { length, width } = carCatalog[type]
    return Math.min(1, length / generated.length, width / generated.width)
  }

  parts(type: CarType, color: CarColor, detail: 'full' | 'parked' | 'low' = 'full', tesla = false) {
    const generated = this.generatedCar(type, color, tesla)
    const { fixed, parked, paint } = generated
      ? detail === 'low' ? generated.low ?? generated.full : generated.full
      : (detail === 'low' ? this.distant : this.cars).get(type)!
    const body = paint.get(color) ?? paint.get(carCatalog[type].variants[0].color)!
    return [body, ...(detail === 'parked' ? parked ?? fixed : fixed)]
  }

  moving(type: CarType, color: CarColor) {
    const root = new Group(), full = new Group()
    const low = this.hasLOD(type, color) ? new Group() : undefined
    root.add(full)
    if (low) root.add(low)
    const generated = this.generatedCar(type, color)
    const nodes = generated?.full.nodes ?? carCatalog[type].nodes
    root.scale.setScalar(this.scale(type, color))
    const probes = vehicleProbes()
    const signal = { value: 0 }
    const materials = new Map<StandardMesh['material'], StandardMesh['material']>()
    const meshes = new Map<string, StandardMesh[]>()
    const copy = (part: StandardMesh, group: Group) => {
      let material = materials.get(part.material)
      if (!material) {
        material = part.material.clone()
        shadeVehicle(material, probes)
        materials.set(part.material, material)
      }
      const mesh = new Mesh(part.geometry, material)
      mesh.position.copy(part.position)
      mesh.scale.copy(part.scale)
      mesh.quaternion.copy(part.quaternion)
      group.add(mesh)
      return mesh
    }
    const lampNames = Object.values(lampParts).map(part => nodes[part])
    for (const part of this.parts(type, color)) {
      const name = part.name || part.parent!.name
      const lamp = lampNames.includes(name)
      const mesh = copy(part, lamp ? root : full)
      // Keep the emissive faces visible on the simplified shell as well.
      if (lamp && low) {
        mesh.material.polygonOffset = true
        mesh.material.polygonOffsetFactor = -1
        mesh.material.polygonOffsetUnits = -1
      }
      const group = meshes.get(name) ?? []
      group.push(mesh)
      meshes.set(name, group)
    }
    if (low) for (const part of this.parts(type, color, 'low')) copy(part, low)
    for (const lens of meshes.get(nodes.lenses) ?? []) bindSignals(lens, signal)
    const lights = Object.fromEntries(Object.entries(lampParts).map(([key, part]) => [key, meshes.get(nodes[part])![0].material])) as
      Record<keyof typeof lampParts, StandardMesh['material']>

    return {
      root, full, low, probes, signal, lights,
      dispose() {
        root.removeFromParent()
        for (const material of materials.values()) material.dispose()
      },
    }
  }
}

export async function loadPassengers() {
  const lod = manifest<LODManifest>('cars_lod.json')
    .then(async data => ({ data, root: await model('cars_lod.glb') }))
    .catch(() => undefined)
  const [pack, detail] = await Promise.all([
    model('cars.glb').then(root => new PassengerPack(root).loadPaint()), lod,
  ])
  if (detail) pack.addLOD(detail.root, detail.data)
  await pack.loadGenerated()
  return pack
}

// The pack groups passive optics together. Switch only the original amber
// atlas tiles, which are shared by all nine cars, on the requested side.
function bindSignals(lens: StandardMesh, signal: { value: number }) {
  editShader(lens.material, 'passenger-turn-signal', shader => {
    shader.uniforms.turnSignal = signal
    shader.vertexShader = 'varying float lensSide;\n' + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      lensSide = position.z;
    `)
    shader.fragmentShader = 'uniform float turnSignal;\nvarying float lensSide;\n' + shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      vec2 atlas = fract(vMapUv);
      bool amber = (atlas.y < 0.15 && atlas.x > 0.59 && atlas.x <= 0.79)
        || (atlas.y >= 0.345 && atlas.y < 0.55 && atlas.x > 0.634)
        || (atlas.y > 0.775 && atlas.x >= 0.55 && atlas.x < 0.77);
      if (amber && lensSide * turnSignal < 0.0) {
        totalEmissiveRadiance += vec3(1.15, 0.37, 0.025) * (0.55 + diffuseColor.r);
      }
    `)
  })
}
