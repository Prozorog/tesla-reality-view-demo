import { ClampToEdgeWrapping, Mesh, MeshStandardMaterial, SRGBColorSpace, TextureLoader } from 'three'
import type { BufferGeometry, Object3D, Texture, WebGLRenderer } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const gltf = new GLTFLoader()
const textures = new TextureLoader()
const textureCache = new Map<string, Promise<Texture>>()
const url = (file: string) => `${import.meta.env.BASE_URL}models/${file}`

export async function model(file: string) {
  return (await gltf.loadAsync(url(file))).scene
}

export async function manifest<T>(file: string): Promise<T> {
  const response = await fetch(url(file))
  if (!response.ok) throw new Error(`${file} (${response.status})`)
  return response.json()
}

export function colorTexture(file: string, channel = 0, flipY = false) {
  const key = `${file}:${channel}:${flipY}`
  let pending = textureCache.get(key)
  if (!pending) {
    pending = textures.loadAsync(url(file)).then(texture => {
      texture.colorSpace = SRGBColorSpace
      texture.channel = channel
      texture.flipY = flipY
      texture.wrapS = texture.wrapT = ClampToEdgeWrapping
      return texture
    })
    textureCache.set(key, pending)
  }
  return pending
}

export function named(root: Object3D, name: string) {
  const node = root.getObjectByName(name)
  if (!node) throw new Error(`Missing GLB node ${name}`)
  return node
}

export type StandardMesh = Mesh<BufferGeometry, MeshStandardMaterial>

export function standardMeshes(root: Object3D) {
  const meshes: StandardMesh[] = []
  root.traverse(object => {
    if (object instanceof Mesh && object.material instanceof MeshStandardMaterial) meshes.push(object)
  })
  return meshes
}

type Shader = Parameters<MeshStandardMaterial['onBeforeCompile']>[0]

export function editShader(material: MeshStandardMaterial, key: string, edit: (shader: Shader) => void) {
  const before = material.onBeforeCompile.bind(material)
  const previousKey = material.customProgramCacheKey()
  material.onBeforeCompile = (shader: Shader, renderer: WebGLRenderer) => {
    before(shader, renderer)
    edit(shader)
  }
  material.customProgramCacheKey = () => `${previousKey}:${key}`
}

export function useLightMap(mesh: StandardMesh, texture: Texture, intensity: number) {
  if (!mesh.geometry.hasAttribute(`uv${texture.channel}`)) {
    throw new Error(`Missing lightmap UV channel ${texture.channel} on ${mesh.name}`)
  }
  mesh.material = mesh.material.clone()
  mesh.material.lightMap = texture
  mesh.material.lightMapIntensity = intensity
}
