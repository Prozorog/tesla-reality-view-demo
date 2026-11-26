import {
  BoxGeometry, CanvasTexture, Color, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Quaternion, SRGBColorSpace, Vector3,
} from 'three'
import type { Material, Object3D } from 'three'

const unitBox = new BoxGeometry(1, 1, 1)

export function box(parent: Object3D, material: Material, size: number[], pos: number[], name = '') {
  const mesh = new Mesh(unitBox, material)
  mesh.name = name
  mesh.position.fromArray(pos)
  mesh.scale.fromArray(size)
  parent.add(mesh)
  return mesh
}

export type BoxSpec = { size: number[]; pos: number[]; color?: string | Color; yaw?: number }

export function batch(parent: Object3D, material: Material, boxes: BoxSpec[]) {
  if (!boxes.length) return
  const mesh = new InstancedMesh(unitBox, material, boxes.length)
  const matrix = new Matrix4(), rotation = new Quaternion()
  const position = new Vector3(), scale = new Vector3(), y = new Vector3(0, 1, 0)
  for (const [i, entry] of boxes.entries()) {
    const color = entry.color ? new Color(entry.color) : new Color('white')
    matrix.compose(position.fromArray(entry.pos), rotation.setFromAxisAngle(y, entry.yaw ?? 0), scale.fromArray(entry.size))
    mesh.setMatrixAt(i, matrix)
    mesh.setColorAt(i, color)
  }
  parent.add(mesh)
  return mesh
}

export function beam(parent: Object3D, material: Material, a: Vector3, b: Vector3, width: number, depth = width) {
  const middle = a.clone().lerp(b, 0.5)
  const mesh = box(parent, material, [width, a.distanceTo(b), depth], middle.toArray())
  mesh.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize())
  return mesh
}

export function flat(color: string) {
  return new MeshBasicMaterial({ color })
}

export function canvasTexture(width: number, height: number, paint: (ctx: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  paint(canvas.getContext('2d')!)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  return texture
}

export function radialTexture() {
  return canvasTexture(64, 64, ctx => {
    const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 32)
    gradient.addColorStop(0, 'rgba(255,255,255,1)')
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.75)')
    gradient.addColorStop(0.8, 'rgba(255,255,255,0.2)')
    gradient.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, 64, 64)
  })
}
