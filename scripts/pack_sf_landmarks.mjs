// Quantize the authored static meshes without a decoder or a topology change.
// Invoked by build_sf_landmarks.py, or: heavy node scripts/pack_sf_landmarks.mjs
import { readFile, writeFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { KHRMeshQuantization } from '@gltf-transform/extensions'
import { Matrix4 } from 'three'

const target = fileURLToPath(new URL('../public/models/sf/landmarks.glb', import.meta.url))
const metadata = fileURLToPath(new URL('../public/models/sf/landmarks.json', import.meta.url))
const io = new NodeIO().registerExtensions([KHRMeshQuantization])
const document = await io.read(target)
const root = document.getRoot()
const originalBytes = (await stat(target)).size
const errors = {}
const quantizedNodes = []
let changed = false

for (const mesh of root.listMeshes()) {
  const primitive = mesh.listPrimitives()[0]
  if (mesh.listPrimitives().length !== 1) throw new Error(`${mesh.getName()}: expected one material primitive`)
  const position = primitive.getAttribute('POSITION')
  if (!(position.getArray() instanceof Float32Array)) continue
  const points = position.getArray()
  const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < points.length; i++) {
    const k = i % 3
    low[k] = Math.min(low[k], points[i])
    high[k] = Math.max(high[k], points[i])
  }
  const centre = low.map((value, k) => (value + high[k]) / 2)
  const scale = Math.max(...high.map((value, k) => value - low[k])) / 65534 || 1
  const encoded = new Int16Array(points.length)
  let error = 0
  for (let i = 0; i < points.length; i++) {
    encoded[i] = Math.round((points[i] - centre[i % 3]) / scale)
    error = Math.max(error, Math.abs(encoded[i] * scale + centre[i % 3] - points[i]))
  }
  position.setArray(encoded).setNormalized(false)
  const decode = new Matrix4().makeTranslation(...centre).scale({ x: scale, y: scale, z: scale })
  for (const node of root.listNodes().filter(node => node.getMesh() === mesh)) {
    const matrix = new Matrix4().fromArray(node.getMatrix()).multiply(decode)
    node.setMatrix(matrix.toArray())
    quantizedNodes.push(node.getName())
  }
  errors[mesh.getName()] = Number(error.toFixed(6))
  const normal = primitive.getAttribute('NORMAL')
  if (normal) normal.setArray(Int8Array.from(normal.getArray(), n => Math.round(Math.max(-1, Math.min(1, n)) * 127))).setNormalized(true)
  const color = primitive.getAttribute('COLOR_0')
  if (color) color.setArray(Uint8Array.from(color.getArray(), n => Math.round(Math.max(0, Math.min(1, n)) * 255))).setNormalized(true)
  const uv0 = primitive.getAttribute('TEXCOORD_0'), uv1 = primitive.getAttribute('TEXCOORD_1')
  const equalUV = uv0 && uv1 && uv0.getArray().length === uv1.getArray().length && uv0.getArray().every((n, i) => n === uv1.getArray()[i])
  for (const uv of new Set([uv0, uv1].filter(Boolean))) {
    uv.setArray(Uint16Array.from(uv.getArray(), n => Math.round(Math.max(0, Math.min(1, n)) * 65535))).setNormalized(true)
  }
  if (equalUV) primitive.setAttribute('TEXCOORD_0', uv1)
  changed = true
}

if (changed) {
  document.createExtension(KHRMeshQuantization).setRequired(true)
  const used = new Set(root.listMeshes().flatMap(mesh => mesh.listPrimitives().flatMap(p => [...p.listAttributes(), p.getIndices()].filter(Boolean))))
  for (const accessor of root.listAccessors()) if (!used.has(accessor)) accessor.dispose()
  await io.write(target, document)
}
const fileBytes = (await stat(target)).size
try {
  const manifest = JSON.parse(await readFile(metadata, 'utf8'))
  manifest.stats.file_bytes = fileBytes
  if (changed) manifest.quantization = {
    extension: 'KHR_mesh_quantization', decoder: 'Built into three.js GLTFLoader',
    source_bytes: originalBytes, file_bytes: fileBytes, unchanged_topology: true,
    position: 'signed 16-bit with a uniform per-node dequantization transform',
    normals: 'signed normalized 8-bit', colors: 'unsigned normalized 8-bit',
    uv0_and_uv1: 'unsigned normalized 16-bit, deduplicated only when identical',
    largest_coordinate_error_metres_by_part: errors, nodes: quantizedNodes,
  }
  await writeFile(metadata, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}
console.log(JSON.stringify({ changed, source_bytes: originalBytes, file_bytes: fileBytes, nodes: quantizedNodes, largest_coordinate_error_metres_by_part: errors }))
