import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  BufferGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector3,
} from 'three'
import { prepareTablet, tabletPoint } from '../src/assets/tablet.ts'
import { coverFrame, cropReality, fitTablet, TABLET_ASPECT } from '../src/render/dive.ts'

const asset = file => readFileSync(new URL(`../public/models/${file}`, import.meta.url))
const cabinManifest = JSON.parse(asset('cabin.json'))
const glb = asset('cabin.glb')
const jsonLength = glb.readUInt32LE(12)
const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength))
const binaryStart = 28 + jsonLength
const node = gltf.nodes.find(entry => entry.name === 'screen_surface')
const [quad] = gltf.meshes[node.mesh].primitives
assert.equal(gltf.materials[quad.material].name, cabinManifest.screen_surface.material)

function readAccessor(index, size, type, read) {
  const accessor = gltf.accessors[index]
  const view = gltf.bufferViews[accessor.bufferView]
  assert.equal(accessor.componentType, type)
  const componentBytes = type === 5123 ? 2 : 4
  const stride = view.byteStride ?? size * componentBytes
  const base = binaryStart + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
  return Array.from({ length: accessor.count * size }, (_, i) =>
    glb[read](base + Math.floor(i / size) * stride + (i % size) * componentBytes),
  )
}

const geometry = new BufferGeometry()
geometry.setAttribute('position', new Float32BufferAttribute(readAccessor(quad.attributes.POSITION, 3, 5126, 'readFloatLE'), 3))
geometry.setAttribute('uv', new Float32BufferAttribute(readAccessor(quad.attributes.TEXCOORD_0, 2, 5126, 'readFloatLE'), 2))
geometry.setIndex(readAccessor(quad.indices, 1, 5123, 'readUInt16LE'))
assert.equal(geometry.index.count, 6)
const screenSurface = new Mesh(geometry, new MeshBasicMaterial())
if (node.matrix) screenSurface.applyMatrix4(new Matrix4().fromArray(node.matrix))
if (node.translation) screenSurface.position.fromArray(node.translation)
if (node.rotation) screenSurface.quaternion.fromArray(node.rotation)
if (node.scale) screenSurface.scale.fromArray(node.scale)
const cabin = new Group()
cabin.add(screenSurface)
const tablet = prepareTablet(cabin, screenSurface, cabinManifest.screen_surface.corners)
const car = new Group()
car.add(cabin)
const reality = new PerspectiveCamera(50, TABLET_ASPECT, 0.1, 165)
const sizes = [[1280, 800], [1280, 720], [1920, 1080], [2560, 1080], [800, 1000]]
const framings = [
  { car: [8.3, 0, -4.1, 0.7], camera: [-8, 5, 0], target: [8, 0.7, 0] },
  { car: [-11.2, 0, 11.4, -1.3], camera: [-1.7, 14.2, 2.2], target: [1.3, 0.15, -0.5] },
  { car: [19.2, 0, 6.4, 1.95], camera: [-2.7, 13.0, -4.2], target: [1.2, 0.15, 0.5] },
]
const carPoints = [[1.375, 0.6, 0], [3.735, 0.77, -0.91], [-0.985, 0.77, 0.91]]
const ray = new Raycaster()
let worst = 0, worstUV = 0
for (const pose of framings) {
  car.position.set(...pose.car.slice(0, 3))
  car.rotation.y = pose.car[3]
  car.updateMatrixWorld(true)
  reality.position.copy(car.localToWorld(new Vector3(...pose.camera)))
  reality.lookAt(car.localToWorld(new Vector3(...pose.target)))
  reality.updateMatrixWorld(true)
  for (const [width, height] of sizes) {
    const aspect = width / height
    const seat = new PerspectiveCamera(60, aspect, 0.018, 165)
    seat.fov = fitTablet(tablet, aspect, seat.position, seat.quaternion)
    seat.updateProjectionMatrix()
    seat.updateMatrixWorld(true)
    for (const point of carPoints) {
      const world = car.localToWorld(new Vector3(...point))
      reality.clearViewOffset()
      const tabletNdc = world.clone().project(reality)
      const onQuad = tabletPoint(tablet, (tabletNdc.x + 1) / 2, (tabletNdc.y + 1) / 2)
      const throughTablet = onQuad.project(seat)
      cropReality(reality, coverFrame(aspect))
      const direct = world.project(reality)
      const difference = Math.hypot((throughTablet.x - direct.x) * width / 2, (throughTablet.y - direct.y) * height / 2) / height
      worst = Math.max(worst, difference)
    }
    for (const [u, v] of [[0.1, 0.1], [0.88, 0.19], [0.81, 0.88], [0.2, 0.79], [0.5, 0.5]]) {
      const projected = tabletPoint(tablet, u, v).project(seat)
      ray.setFromCamera(projected, seat)
      const hit = ray.intersectObject(screenSurface, false)[0]
      assert(hit?.uv, `No display hit at ${u}, ${v}`)
      worstUV = Math.max(worstUV, Math.hypot(hit.uv.x - u, hit.uv.y - v))
    }
  }
}
console.log(`Dive: ${framings.length * sizes.length * carPoints.length} projections, worst hand-over difference ${(worst * 100).toFixed(6)}% of window height (limit 1%)`)
console.log(`Cabin GLB: ${framings.length * sizes.length * 5} tablet rays, worst UV error ${worstUV.toExponential(2)}`)
assert(worst < 0.01 && worstUV < 1e-5)
