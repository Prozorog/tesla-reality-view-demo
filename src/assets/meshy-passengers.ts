import { Box3, Color, Float32BufferAttribute, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial } from 'three'
import type { Group } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { carColors } from '../simulation/lot.ts'
import type { CarColor, CarType } from '../simulation/lot.ts'
import { editShader, manifest, model, named, standardMeshes } from './gltf.ts'
import type { StandardMesh } from './gltf.ts'

export type PassengerNodes = {
  body: string; glass: string; lenses: string; wheels: string
  lights_head: string; lights_tail: string; lights_brake: string
}
export type CarParts = {
  fixed: StandardMesh[]
  parked?: StandardMesh[]
  paint: Map<string, StandardMesh>
  nodes?: PassengerNodes
}
export type GeneratedPassenger = {
  full: CarParts
  low?: CarParts
  length: number
  width: number
  height: number
}
type MeshyManifest = {
  vehicles: {
    replaces: CarType
    file: string
    far: string
    nodes: PassengerNodes
  }[]
}

export function passengerPaint(source: MeshStandardMaterial) {
  const material = new MeshPhysicalMaterial()
  MeshStandardMaterial.prototype.copy.call(material, source)
  material.defines = { ...material.defines, PHYSICAL: '' }
  material.roughnessMap = null
  material.metalnessMap = null
  material.roughness = 0.20
  material.metalness = 0.22
  material.clearcoat = 1
  material.clearcoatRoughness = 0.075
  material.envMapIntensity = 1.65
  return material
}

export function passengerGlass(source: MeshStandardMaterial) {
  const material = passengerPaint(source)
  material.color.set('#05080d')
  material.roughness = 0.115
  material.metalness = 0.12
  material.clearcoatRoughness = 0.045
  material.envMapIntensity = 1.8
  return material
}

function plainGeometry(part: StandardMesh, keepColor = false, keepUV = false) {
  const geometry = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone()
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal' && !(keepColor && name === 'color') && !(keepUV && name === 'uv')) geometry.deleteAttribute(name)
  }
  if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals()
  return geometry
}

function passiveParts(parts: StandardMesh[]) {
  const batches = new Map<boolean, ReturnType<typeof plainGeometry>[]>()
  for (const part of parts) {
    const geometry = plainGeometry(part, part.material.vertexColors)
    const sourceColor = geometry.getAttribute('color')
    const color = new Float32BufferAttribute(new Float32Array(geometry.getAttribute('position').count * 3), 3)
    const { r, g, b } = part.material.color
    for (let i = 0; i < color.count; i++) color.setXYZ(i,
      r * (sourceColor?.getX(i) ?? 1), g * (sourceColor?.getY(i) ?? 1), b * (sourceColor?.getZ(i) ?? 1))
    geometry.setAttribute('color', color)
    // Rubber and arch liners share a matte batch. Lens and alloy colours
    // ride in vertex colours on one glossy batch, keeping copies inexpensive.
    const matte = /tyre|tire|rubber|liner/i.test(part.material.name) || part.material.roughness >= 0.5
    let batch = batches.get(matte)
    if (!batch) {
      batch = []
      batches.set(matte, batch)
    }
    batch.push(geometry)
  }
  return Array.from(batches, ([matte, group]) => {
    const geometry = mergeGeometries(group)!
    const material = matte
      ? new MeshStandardMaterial({ roughness: 0.78, metalness: 0.08, vertexColors: true, envMapIntensity: 0.5 })
      : new MeshPhysicalMaterial({ roughness: 0.16, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.055,
        vertexColors: true, envMapIntensity: 1.65 })
    const mesh = new Mesh(geometry, material)
    mesh.name = matte ? 'parked_rubber' : 'parked_glass_and_alloy'
    return mesh
  })
}

// A UV-level tint has no dependency on which side of a decimated edge a
// face was assigned to. Keep the dark source glazing and coloured lenses.
export function shadeTeslaPaint(material: MeshStandardMaterial) {
  const tint = material.userData.teslaPaint
  if (typeof tint !== 'string') return
  editShader(material, 'tesla-passenger-paint', shader => {
    shader.uniforms.teslaTint = { value: new Color(tint) }
    shader.fragmentShader = 'uniform vec3 teslaTint;\n' + shader.fragmentShader.replace('#include <map_fragment>', `
      #include <map_fragment>
      vec3 base = diffuseColor.rgb;
      float neutral = max(max(base.r, base.g), base.b) - min(min(base.r, base.g), base.b);
      float lightness = dot(base, vec3(0.2126, 0.7152, 0.0722));
      float painted = smoothstep(0.072, 0.33, lightness) * (1.0 - smoothstep(0.13, 0.39, neutral));
      diffuseColor.rgb = mix(base * 0.64, teslaTint * (0.68 + 0.37 * lightness), painted);
    `)
  })
}

function generatedParts(root: Group, bodyName: string, nodes?: PassengerNodes): GeneratedPassenger {
  root.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(root)
  const centreX = (bounds.min.x + bounds.max.x) / 2
  const centreZ = (bounds.min.z + bounds.max.z) / 2
  const offset = new Matrix4().makeTranslation(-centreX, -bounds.min.y, -centreZ)
  const body = new Set(nodes ? standardMeshes(named(root, bodyName)) :
    standardMeshes(root).filter(mesh => /paint/i.test(mesh.material.name)))
  const bodyMaterials = new Set(Array.from(body, part => part.material))
  const paintGeometry = []
  const fixed: StandardMesh[] = []
  for (const part of standardMeshes(root)) {
    const geometry = part.geometry.clone().applyMatrix4(offset.clone().multiply(part.matrixWorld))
    const painted = nodes ? body.has(part) || bodyMaterials.has(part.material) : !/turbine/i.test(part.material.name)
    if (painted) {
      const mesh = new Mesh(geometry, part.material)
      paintGeometry.push(plainGeometry(mesh, false, !nodes))
      continue
    }
    const mesh = new Mesh(geometry, part.material)
    mesh.name = part.name || part.parent!.name
    fixed.push(mesh)
  }
  const paint = passengerPaint(nodes ? new MeshStandardMaterial({ name: 'Meshy paint' }) : [...bodyMaterials][0])
  const geometry = mergeGeometries(paintGeometry)!
  const variants = new Map<string, StandardMesh>()
  for (const [color, value] of Object.entries(carColors)) {
    const finish = paint.clone()
    if (nodes) finish.color.set(value)
    else finish.userData.teslaPaint = value
    const mesh = new Mesh(geometry, finish)
    mesh.name = bodyName
    variants.set(color, mesh)
  }
  const parked = nodes ? passiveParts(fixed) : [new Mesh(
    mergeGeometries(fixed.map(mesh => plainGeometry(mesh, false, true)))!,
    fixed[0].material.clone(),
  )]
  if (!nodes) parked[0].material.envMapIntensity = 0.78
  return {
    full: { fixed, parked, paint: variants, nodes },
    length: bounds.max.x - bounds.min.x,
    width: bounds.max.z - bounds.min.z,
    height: bounds.max.y - bounds.min.y,
  }
}

async function generated(file: string, far: string, body: string, nodes?: PassengerNodes) {
  const [nearRoot, farRoot] = await Promise.all([model(file), model(far)])
  const near = generatedParts(nearRoot, body, nodes)
  near.low = generatedParts(farRoot, body, nodes).full
  near.low.fixed = near.low.parked!
  return near
}

const HERO_NODES: PassengerNodes = {
  body: 'body', glass: 'glass', lenses: 'lights_head', wheels: 'wheels',
  lights_head: 'lights_head', lights_tail: 'lights_tail', lights_brake: 'lights_tail',
}

export async function loadGeneratedPassengers() {
  const [data, heroBays] = await Promise.all([
    manifest<MeshyManifest>('cars_meshy.json'), manifest<Record<string, CarColor>>('parked_hero.json'),
  ])
  const vehicles = await Promise.all(data.vehicles.map(async entry => ({
    type: entry.replaces,
    model: await generated(entry.file, entry.far, entry.nodes.body, entry.nodes),
  })))
  // The parked Teslas are reduced copies of the player's Model X (scripts/modelx/lod.py):
  // a paint node plus single-material trim, glass, wheel and lamp nodes.
  const hero = await generated('hero_lod.glb', 'hero_far.glb', 'body', HERO_NODES).catch(error => {
    console.warn('Parked Tesla LOD unavailable', error)
    return undefined
  })
  return { vehicles, hero, heroBays }
}
