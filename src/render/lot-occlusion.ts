import { Box3, DynamicDrawUsage, InstancedBufferAttribute, Matrix4, Ray, Vector3, Vector4 } from 'three'
import type { BufferGeometry, InstancedMesh, MeshStandardMaterial } from 'three'
import { editShader } from '../assets/gltf.ts'
import { bayRectangle, clamp, localPoint } from '../simulation/geometry.ts'
import type { Bay, Pose } from '../simulation/lot.ts'

type Footprint = { front: number; rear: number; height: number; width: number }
export type ObstacleKind = 'tree' | 'pole' | 'lens' | 'solid'
type Prop = {
  bounds: Box3[]
  bindings: { attribute: InstancedBufferAttribute; index: number }[]
  opacity: number
  near: number
}

function splitAtHeight(geometry: BufferGeometry, cut: number) {
  const lower = new Box3(), upper = new Box3(), point = new Vector3()
  const vertices = geometry.getAttribute('position')
  for (let i = 0; i < vertices.count; i++) {
    point.fromBufferAttribute(vertices, i)
    const piece = point.y < cut ? lower : upper
    piece.expandByPoint(point)
  }
  const corners = [new Vector3(), new Vector3(), new Vector3()]
  const count = geometry.index?.count ?? vertices.count
  for (let i = 0; i < count; i += 3) {
    for (let j = 0; j < 3; j++) corners[j].fromBufferAttribute(vertices, geometry.index?.getX(i + j) ?? i + j)
    for (let j = 0; j < 3; j++) {
      const a = corners[j], b = corners[(j + 1) % 3]
      if ((a.y < cut) === (b.y < cut)) continue
      point.copy(a).lerp(b, (cut - a.y) / (b.y - a.y))
      lower.expandByPoint(point)
      upper.expandByPoint(point)
    }
  }
  return [lower, upper]
}

export class LotOcclusion {
  readonly inRealityView = { value: false }
  private readonly props = new Map<string, Prop>()
  private readonly colliders: Box3[] = []
  private readonly sweep = new Ray()
  private readonly sample = new Vector3()
  private readonly hit = new Vector3()
  private readonly rays = Array.from({ length: 10 }, () => ({ ray: new Ray(), length: 0 }))

  addSolid(bounds: Box3) {
    if (!bounds.isEmpty()) this.colliders.push(bounds.clone().expandByScalar(0.22))
  }

  addInstances(batch: InstancedMesh<BufferGeometry, MeshStandardMaterial>, kind: ObstacleKind, positions: number[][]) {
    const { geometry, material } = batch
    geometry.computeBoundingBox()
    const bounds = geometry.boundingBox!
    const cut = bounds.min.y + (bounds.max.y - bounds.min.y) * (kind === 'tree' ? 0.47 : 0.84)
    const pieces = kind === 'tree' || kind === 'pole' ? splitAtHeight(geometry, cut) : [bounds]
    const matrix = new Matrix4()
    const fade = kind === 'solid' ? undefined
      : new InstancedBufferAttribute(new Float32Array(batch.count).fill(1), 1).setUsage(DynamicDrawUsage)
    for (let i = 0; i < batch.count; i++) {
      batch.getMatrixAt(i, matrix)
      const worldBounds = pieces.map(piece => piece.clone().applyMatrix4(matrix)).filter(piece => !piece.isEmpty())
      for (const box of worldBounds) this.addSolid(box)
      if (!fade) continue
      const key = `${kind === 'tree' ? 'tree' : 'lamp'}:${positions[i].join(',')}`
      let prop = this.props.get(key)
      if (!prop) {
        prop = { bounds: [], bindings: [], opacity: 1, near: kind === 'tree' ? 4.2 : 7.7 }
        this.props.set(key, prop)
      }
      prop.bounds.push(...(kind === 'tree' ? worldBounds.slice(-1) : worldBounds))
      prop.bindings.push({ attribute: fade, index: i })
    }
    if (!fade) return
    geometry.setAttribute('propOpacity', fade)
    editShader(material, kind === 'tree' ? 'canopy-dissolve' : 'lamp-dissolve', shader => {
      shader.uniforms.inRealityView = this.inRealityView
      shader.uniforms.canopyBase = { value: cut }
      shader.vertexShader = 'attribute float propOpacity; varying float propVisibility; varying float propHeight;\n' +
        shader.vertexShader.replace('#include <begin_vertex>', `
          #include <begin_vertex>
          propVisibility = propOpacity;
          propHeight = position.y;
        `)
      shader.fragmentShader = 'uniform bool inRealityView; uniform float canopyBase; varying float propVisibility; varying float propHeight;\n' +
        shader.fragmentShader.replace('#include <alphatest_fragment>', `
          #include <alphatest_fragment>
          if (inRealityView && propVisibility < 1.0) {
            float coverage = ${kind === 'tree' ? 'mix(1.0, propVisibility, smoothstep(canopyBase - 0.16, canopyBase, propHeight))' : 'propVisibility'};
            float threshold = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
            if (coverage <= threshold) discard;
          }
        `)
    })
  }

  // Reuse the same fading prop bounds for the world-space surfel shader.
  writeSplatFades(lower: Vector4[], upper: Vector4[]) {
    let count = 0
    for (const prop of this.props.values()) {
      if (prop.opacity >= 1) continue
      for (const box of prop.bounds) {
        if (count === lower.length) return count
        lower[count].set(box.min.x-.08, box.min.y-.08, box.min.z-.08, prop.opacity)
        upper[count++].set(box.max.x+.08, box.max.y+.08, box.max.z+.08, 0)
      }
    }
    return count
  }

  cameraDistance(camera: Vector3, target: Vector3) {
    this.sweep.origin.copy(target)
    this.sweep.direction.subVectors(camera, target)
    const distance = this.sweep.direction.length()
    if (distance < 0.01) return distance
    this.sweep.direction.multiplyScalar(1 / distance)
    let safe = distance
    for (const box of this.colliders) {
      if (box.containsPoint(target)) continue
      if (!this.sweep.intersectBox(box, this.hit)) continue
      const hitDistance = target.distanceTo(this.hit)
      if (hitDistance < distance) safe = Math.min(safe, Math.max(0.03, hitDistance - 0.12))
    }
    return safe
  }

  fade(dt: number, camera: Vector3, pose: Pose, footprint: Footprint, bay?: Bay) {
    if (dt <= 0 || !this.props.size) return
    const { front, rear, width, height } = footprint
    let count = 0
    const setRay = (x: number, y: number, z: number) => {
      const sample = this.sample.set(x, y, z)
      const entry = this.rays[count++]
      entry.ray.origin.copy(camera)
      entry.ray.direction.subVectors(sample, camera).normalize()
      entry.length = camera.distanceToSquared(sample)
    }
    const [centreX, centreZ] = localPoint(pose, (front + rear) / 2, 0)
    setRay(centreX, height * 0.62, centreZ)
    for (const along of [rear + 0.42, front - 0.42]) {
      for (const side of [-0.42, 0.42]) {
        const [x, z] = localPoint(pose, along, width * side)
        setRay(x, height * 0.55, z)
      }
    }
    if (bay) {
      setRay(bay.center[0], 0.055, bay.center[1])
      for (const [x, z] of bayRectangle(bay)) setRay(x, 0.055, z)
    }
    const step = dt / 0.3
    for (const prop of this.props.values()) {
      const hide = prop.bounds.some(box => {
        if (box.distanceToPoint(camera) <= prop.near) return true
        for (let i = 0; i < count; i++) {
          const { ray, length } = this.rays[i]
          if (ray.intersectBox(box, this.hit) && camera.distanceToSquared(this.hit) < length) return true
        }
        return false
      })
      const alpha = clamp(prop.opacity + (hide ? -step : step), 0, 1)
      if (alpha === prop.opacity) continue
      prop.opacity = alpha
      for (const { attribute, index } of prop.bindings) {
        attribute.setX(index, alpha)
        attribute.needsUpdate = true
      }
    }
  }
}
