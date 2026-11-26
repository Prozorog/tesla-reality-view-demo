import { BufferAttribute, BufferGeometry, DataTexture, NearestFilter, RGBAFormat, UnsignedByteType, Vector3 } from 'three'
import type { Object3D, Texture } from 'three'
import { standardMeshes } from './gltf.ts'

// Clip B's horizon roofs read as clean dark slabs with a lit edge, a parapet and
// the odd rooftop unit. The baked atlas is sampled without mipmaps (its charts
// would bleed), so at 60–100 m each roof shimmered into a mottled patch. Each
// building now takes one lightmap texel, the area-weighted average of its own
// baked light, and gains a parapet and one or two rooftop units in the same light.

const PARAPET = { height: 0.42, width: 0.24 }
const UNIT = { width: 1.5, depth: 1.0, height: 0.8 }

const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
const toSrgb = (c: number) => c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055

type Builder = { positions: number[]; normals: number[]; colors: number[]; uvs: number[] }

function quad(out: Builder, corners: Vector3[], normal: Vector3, color: number[], uv: number) {
  for (const i of [0, 1, 2, 0, 2, 3]) {
    out.positions.push(corners[i].x, corners[i].y, corners[i].z)
    out.normals.push(normal.x, normal.y, normal.z)
    out.colors.push(...color)
    out.uvs.push(uv, 0.5)
  }
}

/** An oriented box from a base centre, its length axis, half sizes and height range. */
function box(out: Builder, centre: Vector3, axis: Vector3, half: [number, number], bottom: number, top: number, side: number[], cap: number[], uv: number) {
  const across = new Vector3(-axis.z, 0, axis.x)
  const corner = (a: number, b: number, y: number) => centre.clone().addScaledVector(axis, a * half[0]).addScaledVector(across, b * half[1]).setY(y)
  const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const
  quad(out, ring.map(([a, b]) => corner(a, b, top)), new Vector3(0, 1, 0), cap, uv)
  for (let i = 0; i < 4; i++) {
    const [a0, b0] = ring[i], [a1, b1] = ring[(i + 1) % 4]
    const p0 = corner(a0, b0, bottom), p1 = corner(a1, b1, bottom)
    const normal = p1.clone().sub(p0).cross(new Vector3(0, 1, 0)).normalize().negate()
    quad(out, [p0, p1, corner(a1, b1, top), corner(a0, b0, top)], normal, side, uv)
  }
}

function lightmapPixels(texture: Texture) {
  const image = texture.image as CanvasImageSource & { width: number; height: number }
  const canvas = new OffscreenCanvas(image.width, image.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(image, 0, 0)
  return { data: context.getImageData(0, 0, image.width, image.height).data, width: image.width, height: image.height }
}

export function dressHorizonRoofs(world: Object3D) {
  const root = world.getObjectByName('Horizon_roofs')
  if (!root) return
  for (const mesh of standardMeshes(root)) {
    const material = mesh.material
    const lightMap = material.lightMap
    const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()
    const position = geometry.getAttribute('position')
    const uv1 = geometry.getAttribute(`uv${lightMap?.channel ?? 1}`)
    if (!lightMap || !uv1) continue
    const color = geometry.getAttribute('color')
    const triangles = position.count / 3

    // Buildings: triangles joined through shared corner positions.
    const parent = Array.from({ length: triangles }, (_, i) => i)
    const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]))
    const owner = new Map<string, number>()
    for (let t = 0; t < triangles; t++) {
      for (let k = 0; k < 3; k++) {
        const v = 3 * t + k
        const key = `${position.getX(v).toFixed(2)},${position.getY(v).toFixed(2)},${position.getZ(v).toFixed(2)}`
        const other = owner.get(key)
        if (other === undefined) owner.set(key, t)
        else parent[find(t)] = find(other)
      }
    }
    const groups = new Map<number, number>()
    const building = new Int32Array(triangles)
    for (let t = 0; t < triangles; t++) {
      const r = find(t)
      if (!groups.has(r)) groups.set(r, groups.size)
      building[t] = groups.get(r)!
    }
    const count = groups.size

    // Area-weighted average of each building's baked light, in linear values.
    const pixels = lightmapPixels(lightMap)
    const sums = new Float64Array(count * 4)
    const a = new Vector3(), b = new Vector3(), c = new Vector3()
    for (let t = 0; t < triangles; t++) {
      a.fromBufferAttribute(position, 3 * t); b.fromBufferAttribute(position, 3 * t + 1); c.fromBufferAttribute(position, 3 * t + 2)
      const area = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2
      if (area < 1e-6) continue
      for (const [wa, wb, wc] of [[1 / 3, 1 / 3, 1 / 3], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6]]) {
        const u = wa * uv1.getX(3 * t) + wb * uv1.getX(3 * t + 1) + wc * uv1.getX(3 * t + 2)
        const v = wa * uv1.getY(3 * t) + wb * uv1.getY(3 * t + 1) + wc * uv1.getY(3 * t + 2)
        const x = Math.min(pixels.width - 1, Math.max(0, Math.floor(u * pixels.width)))
        const yRow = lightMap.flipY ? (1 - v) * pixels.height : v * pixels.height
        const y = Math.min(pixels.height - 1, Math.max(0, Math.floor(yRow)))
        const i = 4 * (y * pixels.width + x), g = building[t] * 4
        for (let ch = 0; ch < 3; ch++) sums[g + ch] += area * toLinear(pixels.data[i + ch] / 255)
        sums[g + 3] += area
      }
    }
    const texels = new Uint8Array(count * 4)
    for (let g = 0; g < count; g++) {
      for (let ch = 0; ch < 3; ch++) texels[4 * g + ch] = Math.round(255 * toSrgb(sums[4 * g + ch] / Math.max(1e-9, sums[4 * g + 3])))
      texels[4 * g + 3] = 255
    }
    const flat = new DataTexture(texels, count, 1, RGBAFormat, UnsignedByteType)
    flat.colorSpace = lightMap.colorSpace
    flat.channel = lightMap.channel
    flat.flipY = false
    flat.magFilter = flat.minFilter = NearestFilter
    flat.generateMipmaps = false
    flat.needsUpdate = true
    const texel = (g: number) => (g + 0.5) / count

    // Every vertex of a building reads its building's texel.
    for (let t = 0; t < triangles; t++) for (let k = 0; k < 3; k++) uv1.setXY(3 * t + k, texel(building[t]), 0.5)
    uv1.needsUpdate = true

    // Parapets on flat tops; one or two units on larger roofs.
    const extra: Builder = { positions: [], normals: [], colors: [], uvs: [] }
    const tops = new Map<number, { y: number; points: Vector3[]; vertex: number }>()
    const normal = new Vector3()
    for (let t = 0; t < triangles; t++) {
      a.fromBufferAttribute(position, 3 * t); b.fromBufferAttribute(position, 3 * t + 1); c.fromBufferAttribute(position, 3 * t + 2)
      normal.copy(b).sub(a).cross(c.clone().sub(a)).normalize()
      if (Math.abs(normal.y) < 0.98 || a.y < 1.5) continue
      const g = building[t]
      const top = tops.get(g)
      if (top && top.y > a.y + 0.01) continue
      if (!top || a.y > top.y + 0.01) tops.set(g, { y: a.y, points: [], vertex: 3 * t })
      tops.get(g)!.points.push(a.clone(), b.clone(), c.clone())
    }
    const colorSize = color?.itemSize ?? 3
    const roofTone = (v: number) => color ? [color.getX(v), color.getY(v), color.getZ(v)] : [0.11, 0.11, 0.105]
    const withAlpha = (rgb: number[]) => colorSize === 4 ? [...rgb, 1] : rgb
    for (const [g, top] of tops) {
      // Rectangle from the unique corners of the flat top.
      const unique: Vector3[] = []
      for (const p of top.points) if (!unique.some(q => q.distanceToSquared(p) < 1e-4)) unique.push(p)
      if (unique.length !== 4) continue
      const centre = unique.reduce((sum, p) => sum.add(p), new Vector3()).multiplyScalar(0.25)
      unique.sort((p, q) => Math.atan2(p.z - centre.z, p.x - centre.x) - Math.atan2(q.z - centre.z, q.x - centre.x))
      const base = roofTone(top.vertex)
      const edge = withAlpha(base.map(v => v * 1.55 + 0.012))
      const side = withAlpha(base.map(v => v * 0.9))
      const uv = texel(g)
      for (let i = 0; i < 4; i++) {
        const p0 = unique[i], p1 = unique[(i + 1) % 4]
        const axis = p1.clone().sub(p0).setY(0)
        const length = axis.length()
        axis.normalize()
        const inward = centre.clone().sub(p0).setY(0)
        const across = new Vector3(-axis.z, 0, axis.x)
        const offset = Math.sign(inward.dot(across)) * PARAPET.width / 2
        const middle = p0.clone().add(p1).multiplyScalar(0.5).addScaledVector(across, offset)
        box(extra, middle, axis, [length / 2, PARAPET.width / 2], top.y - 0.02, top.y + PARAPET.height, side, edge, uv)
      }
      const long = unique[1].clone().sub(unique[0]).setY(0), short = unique[2].clone().sub(unique[1]).setY(0)
      const area = long.length() * short.length()
      const hash = Math.abs(Math.sin(centre.x * 12.9898 + centre.z * 78.233) * 43758.5453) % 1
      const units = area > 90 ? 2 : area > 45 ? 1 : 0
      const axis = (long.length() > short.length() ? long : short).normalize()
      for (let k = 0; k < units; k++) {
        const shift = (k - (units - 1) / 2) * 3.2 + (hash - 0.5) * 2
        const spot = centre.clone().addScaledVector(axis, shift)
        box(extra, spot, axis, [UNIT.width / 2, UNIT.depth / 2], top.y, top.y + UNIT.height * (0.8 + 0.4 * hash), side, edge, uv)
      }
    }
    if (extra.positions.length) {
      const additions = new BufferGeometry()
      additions.setAttribute('position', new BufferAttribute(new Float32Array(extra.positions), 3))
      additions.setAttribute('normal', new BufferAttribute(new Float32Array(extra.normals), 3))
      if (color) additions.setAttribute('color', new BufferAttribute(new Float32Array(extra.colors), colorSize))
      additions.setAttribute(`uv${flat.channel}`, new BufferAttribute(new Float32Array(extra.uvs), 2))
      appendGeometry(geometry, additions, flat.channel)
    }
    mesh.geometry = geometry
    mesh.material = material.clone()
    mesh.material.lightMap = flat
  }
}

// Append `extra` (positions, normals, colours, lightmap UVs) to a non-indexed geometry.
function appendGeometry(target: BufferGeometry, extra: BufferGeometry, channel: number) {
  const added = extra.getAttribute('position').count
  for (const name of Object.keys(target.attributes)) {
    const attribute = target.getAttribute(name) as BufferAttribute
    const source = extra.getAttribute(name) as BufferAttribute | undefined
    const size = attribute.itemSize
    const array = new Float32Array((attribute.count + added) * size)
    for (let i = 0; i < attribute.count; i++) for (let k = 0; k < size; k++) array[i * size + k] = attribute.getComponent(i, k)
    if (source) array.set(source.array as Float32Array, attribute.count * size)
    else if (name === `uv${channel}`) array.fill(0.5, attribute.count * size)
    target.setAttribute(name, new BufferAttribute(array, size, false))
  }
  target.computeBoundingSphere()
  target.computeBoundingBox()
}
