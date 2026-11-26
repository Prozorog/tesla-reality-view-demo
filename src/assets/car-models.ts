import { FrontSide, MeshBasicMaterial, MeshPhysicalMaterial, Mesh, Object3D, Vector3 } from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { MeshStandardMaterial, Texture } from 'three'
import { finishNight } from '../render/night-light.ts'
import { shadeVehicle, vehicleProbes } from '../render/vehicle-lighting.ts'
import { colorTexture, manifest, model, named, standardMeshes, useLightMap } from './gltf.ts'
import type { StandardMesh } from './gltf.ts'
import { prepareTablet } from './tablet.ts'
import type { ScreenCorner, Tablet } from './tablet.ts'

const lampNodes = {
  head: 'lights_head', tail: 'lights_tail', brake: 'lights_brake', reverse: 'lights_reverse',
  left: 'indicators_left', right: 'indicators_right',
} as const
type Lamp = keyof typeof lampNodes
export type Exterior = {
  root: Object3D
  glass?: Object3D
  wheels: Object3D[]
  /** Brake calipers at the wheel hubs, in wheel order: steered with the wheel, never rolled. */
  calipers?: Object3D[]
  lights: Record<Lamp, StandardMesh>
  rearCameraMount: Object3D
  footprint: { front: number; rear: number; width: number; height: number }
  probes?: ReturnType<typeof vehicleProbes>
  reflectors?: MeshStandardMaterial[]
}

type BodyManifest = {
  bounding_box: { body_width: number; size: number[] }
  stations: { front_bumper: number; rear_bumper: number; rear_camera: number[] }
}

// Keep the named panel meshes in the Blender export. At night the fixed opaque
// surfaces sharing a finish can use one submission per material.
function batchFixedPanels(root: Object3D, separate: Set<Object3D>) {
  root.updateMatrixWorld(true)
  const inverse = root.matrixWorld.clone().invert()
  const batches = new Map<MeshStandardMaterial, StandardMesh[]>()
  for (const mesh of standardMeshes(root)) {
    let part: Object3D | null = mesh
    while (part && !separate.has(part)) part = part.parent
    // Text and UV-mapped surfaces retain their individual geometry layouts.
    if (part || mesh.material.transparent || mesh.geometry.hasAttribute('uv')) continue
    const batch = batches.get(mesh.material) ?? []
    batch.push(mesh)
    batches.set(mesh.material, batch)
  }
  for (const [material, meshes] of batches) {
    if (meshes.length < 2) continue
    const geometries = meshes.map(mesh => mesh.geometry.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)))
    const geometry = mergeGeometries(geometries)
    for (const temporary of geometries) temporary.dispose()
    if (!geometry) continue
    const combined = new Mesh(geometry, material)
    combined.name = material.name + '_fixed'
    root.add(combined)
    for (const mesh of meshes) mesh.removeFromParent()
  }
}

export async function loadExterior(studio = false): Promise<Exterior> {
  const [root, data] = await Promise.all([model('hero.glb'), manifest<BodyManifest>('hero.json')])
  const glass = named(root, 'glass')
  const wheels = ['FL', 'FR', 'RL', 'RR'].map(wheel => named(root, `wheel_${wheel}`))
  const calipers = ['FL', 'FR', 'RL', 'RR'].map(wheel => named(root, `caliper_${wheel}`))
  const lights = Object.fromEntries(Object.entries(lampNodes).map(([lamp, name]) => {
    const [mesh] = standardMeshes(named(root, name))
    mesh.material = mesh.material.clone()
    // The inactive exported lamps bake darkness into their emissive factors.
    // Normalize the factor while keeping the authored tint for runtime intensity.
    const { r, g, b } = mesh.material.emissive
    const peak = Math.max(r, g, b)
    if (!studio && peak > 0) mesh.material.emissive.multiplyScalar(1 / peak)
    return [lamp, mesh]
  })) as Exterior['lights']
  const materials = new Set(standardMeshes(root).map(mesh => mesh.material))
  const paint = [...materials].filter(material => /paint/i.test(material.name))
  const glazing = [...materials].filter(material => /glass|windscreen/.test(material.name))
  const metal = [...materials].filter(material => /^(chrome|alloy|mirror)$/.test(material.name))
  for (const material of paint) {
    material.side = FrontSide
    material.envMapIntensity = studio ? 1 : 0.65
  }
  for (const material of glazing) {
    material.envMapIntensity = studio ? 1 : 0.8
    // Soft, curvature-following reflections: a lamp on the roof glass is a
    // blurred glint, never a hard-edged patch from the small reflection cube.
    material.roughness = Math.max(material.roughness, studio ? 0.09 : 0.15)
    if (material instanceof MeshPhysicalMaterial) material.clearcoatRoughness = Math.max(material.clearcoatRoughness, studio ? 0.1 : 0.17)
    if (material.transparent) {
      material.depthWrite = true
      material.forceSinglePass = true
    }
  }
  const probes = vehicleProbes()
  if (!studio) {
    // The compressed night view needs more diffuse lamp response to read as white paint.
    for (const material of materials) shadeVehicle(material, probes, paint.includes(material) ? 3.4 : 1)
    batchFixedPanels(root, new Set([glass, named(root, 'Bonnet'), ...wheels, ...calipers, ...Object.values(lights)]))
  }
  const [along, left, up] = data.stations.rear_camera
  const rearCameraMount = new Object3D()
  rearCameraMount.position.set(along, up, -left)
  root.add(rearCameraMount)
  return {
    root, glass, wheels, calipers, lights, rearCameraMount, probes, reflectors: [...paint, ...glazing, ...metal],
    footprint: {
      front: data.stations.front_bumper, rear: data.stations.rear_bumper,
      width: data.bounding_box.body_width, height: data.bounding_box.size[2],
    },
  }
}

export type Cabin = {
  root: Object3D
  eye: Object3D
  steeringWheel: Object3D
  steeringAxis: Vector3
  tablet: Tablet
  bindMirror: (rear: Texture) => void
}

type CabinManifest = {
  steering_wheel: { axis_gltf_local: number[] }
  screen_surface: { material: string; corners: ScreenCorner[] }
  strip_color: string
  mesh_lightmaps: Record<string, string | null>
  lightmap: { three_channel: number; flipY: boolean; three_lightMapIntensity: number }
}

const NIGHT_TRIM_LIMITS: Record<string, number> = { 'Dash weave': 0.42, 'Door insert': 0.19, Headlining: 0.14 }

export async function loadCabin(): Promise<Cabin> {
  const [root, data] = await Promise.all([model('cabin.glb'), manifest<CabinManifest>('cabin.json')])
  const { three_channel, flipY, three_lightMapIntensity } = data.lightmap
  await Promise.all(Object.entries(data.mesh_lightmaps).map(async ([node, file]) => {
    if (!file) return
    const map = await colorTexture(file, three_channel, flipY)
    for (const mesh of standardMeshes(named(root, node))) useLightMap(mesh, map, three_lightMapIntensity)
  }))
  for (const material of new Set(standardMeshes(root).map(mesh => mesh.material))) {
    material.envMapIntensity = material.lightMap ? 0.18 : 1.12
    const limit = NIGHT_TRIM_LIMITS[material.name]
    if (limit !== undefined) {
      const { r, g, b } = material.color
      material.color.multiplyScalar(Math.min(1, limit / Math.max(r, g, b, 0.001)))
      material.envMapIntensity *= 0.75
    }
    finishNight(material, !!material.lightMap)
  }
  for (const strip of standardMeshes(named(root, 'light_strip'))) strip.material.emissive.set(data.strip_color)
  const [screen] = standardMeshes(named(root, 'screen_surface'))
  if (screen.material.name !== data.screen_surface.material) throw new Error('Cabin display material does not match cabin.json')
  const surface = Object.assign(screen, { material: new MeshBasicMaterial({ name: data.screen_surface.material, fog: false }) })
  const tablet = prepareTablet(root, surface, data.screen_surface.corners)
  const eye = named(root, 'eye_driver')
  const steeringWheel = named(root, 'steering_wheel')
  const steeringAxis = new Vector3().fromArray(data.steering_wheel.axis_gltf_local).normalize()
  const mirror = standardMeshes(named(root, 'mirror_housing')).find(mesh => mesh.material.name === 'Mirror glass')
  if (!mirror) throw new Error('Missing cabin mirror glass')
  return { root, eye, steeringWheel, steeringAxis, tablet, bindMirror: texture => mirrorFeed(mirror, texture) }
}

function mirrorFeed(mirror: StandardMesh, rear: Texture) {
  const { geometry, material } = mirror
  geometry.computeBoundingBox()
  const { min, max } = geometry.boundingBox!
  const uv = geometry.getAttribute('uv')
  const pos = geometry.getAttribute('position')
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (max.z - pos.getZ(i)) / (max.z - min.z), 0.48 + 0.45 * (pos.getY(i) - min.y) / (max.y - min.y))
  }
  uv.needsUpdate = true
  material.emissive.set('#e0ebff')
  material.emissiveMap = rear
  material.emissiveIntensity = 0.45
  material.envMapIntensity = 0.035
}
