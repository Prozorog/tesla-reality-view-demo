import { Matrix4, Object3D, Vector3 } from 'three'
import type { BufferGeometry, Mesh, MeshBasicMaterial } from 'three'

export type ScreenCorner = { position_gltf: number[]; uv: number[] }
type Surface = Mesh<BufferGeometry, MeshBasicMaterial>
export type Tablet = { surface: Surface; anchor: Object3D; width: number; height: number }

// The shader, ray hit and dive all share the same bottom-up UVs and physical quad.
export function prepareTablet(root: Object3D, surface: Surface, contract?: ScreenCorner[]): Tablet {
  root.updateMatrixWorld(true)
  const uv = surface.geometry.getAttribute('uv')
  const positions = surface.geometry.getAttribute('position')
  const toRoot = root.matrixWorld.clone().invert().multiply(surface.matrixWorld)
  const vertices = Array.from({ length: positions.count }, (_, i) =>
    new Vector3().fromBufferAttribute(positions, i).applyMatrix4(toRoot),
  )
  const orderedUVs = [[0, 0], [1, 0], [1, 1], [0, 1]]
  const indices = orderedUVs.map(([u, v]) => {
    if (!contract) return vertices.findIndex((_, i) => uv.getX(i) === u && uv.getY(i) === v)
    const corner = contract.find(entry => entry.uv[0] === u && entry.uv[1] === v)
    if (!corner) throw new Error(`Missing screen corner ${u}, ${v} in cabin.json`)
    const expected = new Vector3().fromArray(corner.position_gltf)
    return vertices.findIndex(vertex => vertex.distanceToSquared(expected) < 1e-8)
  })
  if (vertices.length !== 4 || new Set(indices).size !== 4 || indices.includes(-1)) {
    throw new Error('screen_surface does not match the four cabin quad corners')
  }
  const matches = (flipV: boolean) => indices.every((i, corner) => {
    const [u, v] = orderedUVs[corner]
    return uv.getX(i) === u && uv.getY(i) === (flipV ? 1 - v : v)
  })
  if (!matches(false)) {
    if (!matches(true)) throw new Error('screen_surface has unexpected UV orientation')
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i))
    uv.needsUpdate = true
  }

  const [bottomLeft, bottomRight, topRight, topLeft] = indices.map(i => vertices[i])
  const right = bottomRight.clone().sub(bottomLeft)
  const up = topLeft.clone().sub(bottomLeft)
  const width = right.length(), height = up.length()
  right.normalize()
  up.normalize()
  const anchor = new Object3D()
  anchor.position.copy(bottomLeft).lerp(topRight, 0.5)
  anchor.quaternion.setFromRotationMatrix(new Matrix4().makeBasis(right, up, right.clone().cross(up)))
  root.add(anchor)
  return { surface, anchor, width, height }
}

export function tabletPoint(tablet: Tablet, u: number, v: number) {
  return tablet.anchor.localToWorld(new Vector3((u - 0.5) * tablet.width, (v - 0.5) * tablet.height, 0))
}
