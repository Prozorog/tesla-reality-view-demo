// Collision footprints from the rendered meshes (mirrors included) plus a 5 cm
// margin. Catalogue sizes are kept only where they are larger.
// node tools/gen-footprints.mjs  ->  public/models/footprints.json
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { Matrix4, Vector3 } from 'three'

const mat4 = {
  identity: () => new Matrix4(),
  multiply: (a, b) => a.clone().multiply(new Matrix4().fromArray(b)),
  invert: m => new Matrix4().fromArray(m).invert(),
}
const vec3 = { transform: (p, m) => new Vector3(...p).applyMatrix4(m).toArray() }

const MARGIN = 0.05
const models = new URL('../public/models/', import.meta.url)
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
const json = async name => JSON.parse(await readFile(new URL(name, models), 'utf8'))

// Ground-plane bounds of every mesh under `node`, in the frame of `frameNode`
// (glTF: +X forward, +Z right of the car seen from above, so left is −Z).
function bounds(node, frame) {
  const box = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
  const visit = (current, matrix) => {
    const local = current.getMatrix()
    const world = mat4.multiply(matrix, local)
    const mesh = current.getMesh()
    if (mesh) for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION')
      const p = [0, 0, 0]
      for (let i = 0; i < position.getCount(); i++) {
        position.getElement(i, p)
        const [x, , z] = vec3.transform(p, world)
        box.minX = Math.min(box.minX, x); box.maxX = Math.max(box.maxX, x)
        box.minZ = Math.min(box.minZ, z); box.maxZ = Math.max(box.maxZ, z)
      }
    }
    for (const child of current.listChildren()) visit(child, world)
  }
  visit(node, frame)
  return box
}

const sceneRoots = document => document.getRoot().listScenes()[0].listChildren()
const find = (document, name) => document.getRoot().listNodes().find(node => node.getName() === name)
const identity = mat4.identity()
const round = value => Math.round(value * 1000) / 1000
// Rectangle relative to the car's simulation origin: rear/front along +X, half widths.
const rect = ({ minX, maxX, minZ, maxZ }) => ({ rear: round(minX), front: round(maxX), left: round(-minZ), right: round(maxZ) })
const grow = r => ({ rear: r.rear - MARGIN, front: r.front + MARGIN, left: r.left + MARGIN, right: r.right + MARGIN })

const cars = await json('cars.json')
const pack = await io.read(fileURLToPath(new URL('cars.glb', models)))
const types = {}
const table = []
for (const [type, entry] of Object.entries(cars.types)) {
  const node = find(pack, entry.nodes.root)
  const mesh = bounds(node, identity)
  // The pack root carries its own placement in the file; the runtime places it at the pose with scale 1.
  const own = node.getMatrix()
  const local = bounds(node, mat4.invert(own))
  const m = rect(local)
  const half = { length: entry.length / 2, width: entry.width / 2 }
  const used = {
    rear: Math.min(-half.length, m.rear), front: Math.max(half.length, m.front),
    left: Math.max(half.width, m.left), right: Math.max(half.width, m.right),
  }
  types[type] = used
  table.push({ type, catalogue: [entry.length, entry.width], mesh: [round(local.maxX - local.minX), round(local.maxZ - local.minZ)],
    used: [round(grow(used).front - grow(used).rear), round(grow(used).left + grow(used).right)], fileBox: [round(mesh.maxX - mesh.minX), round(mesh.maxZ - mesh.minZ)] })
}

// The player: hero.glb with its origin under the rear axle.
const heroManifest = await json('hero.json')
const hero = await io.read(fileURLToPath(new URL('hero.glb', models)))
let heroBox = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
for (const root of sceneRoots(hero)) {
  const b = bounds(root, identity)
  heroBox = { minX: Math.min(heroBox.minX, b.minX), maxX: Math.max(heroBox.maxX, b.maxX), minZ: Math.min(heroBox.minZ, b.minZ), maxZ: Math.max(heroBox.maxZ, b.maxZ) }
}
const player = rect(heroBox)
table.push({ type: 'Model X (player)', catalogue: [round(heroManifest.stations.front_bumper - heroManifest.stations.rear_bumper), heroManifest.bounding_box.body_width],
  mesh: [round(heroBox.maxX - heroBox.minX), round(heroBox.maxZ - heroBox.minZ)], used: [round(grow(player).front - grow(player).rear), round(grow(player).left + grow(player).right)] })

// Parked Tesla copies: hero_lod.glb, uniformly scaled at runtime to fit the bay car's catalogue rectangle.
const lod = await io.read(fileURLToPath(new URL('hero_lod.glb', models)))
let lodBox = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
for (const root of sceneRoots(lod)) {
  const b = bounds(root, identity)
  lodBox = { minX: Math.min(lodBox.minX, b.minX), maxX: Math.max(lodBox.maxX, b.maxX), minZ: Math.min(lodBox.minZ, b.minZ), maxZ: Math.max(lodBox.maxZ, b.maxZ) }
}
const tesla = { minX: lodBox.minX, maxX: lodBox.maxX, minZ: lodBox.minZ, maxZ: lodBox.maxZ }
const heroBays = await json('parked_hero.json')
const lot = await json('lot.json')
const teslaBays = {}
for (const id of Object.keys(heroBays)) {
  const bay = lot.bays.find(b => b.id === id)
  if (!bay?.car) continue
  const entry = cars.types[bay.car.type]
  const length = tesla.maxX - tesla.minX, width = tesla.maxZ - tesla.minZ
  const scale = Math.min(1, entry.length / length, entry.width / width)
  // The runtime centres the generated body on the bay pose before scaling.
  const cx = (tesla.maxX + tesla.minX) / 2, cz = (tesla.maxZ + tesla.minZ) / 2
  const scaled = { minX: (tesla.minX - cx) * scale, maxX: (tesla.maxX - cx) * scale, minZ: (tesla.minZ - cz) * scale, maxZ: (tesla.maxZ - cz) * scale }
  const m = rect(scaled)
  const half = { length: entry.length / 2, width: entry.width / 2 }
  teslaBays[id] = { rear: Math.min(-half.length, m.rear), front: Math.max(half.length, m.front), left: Math.max(half.width, m.left), right: Math.max(half.width, m.right) }
  table.push({ type: `Tesla copy in ${id} (${bay.car.type})`, catalogue: [entry.length, entry.width],
    mesh: [round(scaled.maxX - scaled.minX), round(scaled.maxZ - scaled.minZ)],
    used: [round(grow(teslaBays[id]).front - grow(teslaBays[id]).rear), round(grow(teslaBays[id]).left + grow(teslaBays[id]).right)] })
}

const out = { margin: MARGIN, note: 'Rendered-mesh rectangles (mirrors included) relative to each car origin: rear/front along the heading, left/right half widths, catalogue sizes where larger. The simulation adds `margin` for collisions. Generated by tools/gen-footprints.mjs.',
  player, types, teslaBays }
await writeFile(new URL('footprints.json', models), JSON.stringify(out, null, 2) + '\n')
console.log('| Type | Catalogue L × W | Mesh L × W | Used L × W |\n| --- | --- | --- | --- |')
for (const row of table) console.log(`| ${row.type} | ${row.catalogue.map(v => v.toFixed(3)).join(' × ')} | ${row.mesh.map(v => v.toFixed(3)).join(' × ')} | ${row.used.map(v => v.toFixed(3)).join(' × ')} |`)
