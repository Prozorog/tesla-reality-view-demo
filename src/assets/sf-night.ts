import { Float32BufferAttribute, MeshStandardMaterial } from 'three'
import type { BufferGeometry, Texture } from 'three'
import { finishNight } from '../render/night-light.ts'
import { colorTexture, editShader, manifest } from './gltf.ts'

type Surface = 'roads' | 'sidewalks'
type Charts = {
  image: string
  size: [number, number]
  tileSize: number
  padding: number
  density: number
  intensity: number
  charts: Record<string, [number, number]>
}

const TILE_METRES = 128

function pavement(color: string, sidewalk: boolean, lightMap: Texture, lightMapIntensity: number) {
  const material = new MeshStandardMaterial({ color, roughness: sidewalk ? 0.91 : 0.86, lightMap, lightMapIntensity })
  finishNight(material, true)
  editShader(material, sidewalk ? 'sf-concrete' : 'sf-asphalt', shader => {
    shader.vertexShader = 'varying vec2 sfSurface;\n' + shader.vertexShader.replace('#include <project_vertex>', `
      sfSurface = uv * 8.0;
      #include <project_vertex>
    `)
    shader.fragmentShader = `
      varying vec2 sfSurface;
      float pavementGrain(vec2 x) {
        vec3 p = fract(vec3(x.xyx) * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }
    ` + shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      vec2 sand = sfSurface * ${sidewalk ? '16.0' : '14.0'};
      float detail = 1.0 - smoothstep(0.35, 1.8, length(fwidth(sand)));
      float fine = pavementGrain(floor(sand));
      float wear = sin(sfSurface.x * 0.76 + sin(sfSurface.y * 0.43)) * cos(sfSurface.y * 0.81);
      diffuseColor.rgb *= 1.0 + (fine - 0.5) * detail * ${sidewalk ? '0.18' : '0.24'} + wear * 0.045;
    `)
  })
  return material
}

export class SfNight {
  private readonly materials: Record<Surface, MeshStandardMaterial>

  constructor(private readonly atlas: Charts, texture: Texture) {
    this.materials = {
      roads: pavement('#b8bfce', false, texture, atlas.intensity * 0.67),
      sidewalks: pavement('#96a2b6', true, texture, atlas.intensity * 0.72),
    }
  }

  surface(kind: string, key: string, geometry: BufferGeometry) {
    if (kind !== 'roads' && kind !== 'sidewalks') return undefined
    const chart = this.atlas.charts[key]
    if (!chart) return undefined
    const [tileX, tileZ] = key.split(',').map(Number)
    const { padding, density, size, tileSize } = this.atlas
    const minX = tileX * TILE_METRES - padding
    const minZ = tileZ * TILE_METRES - padding
    const pixel = (world: number, origin: number) => Math.max(0.5, Math.min(tileSize - 0.5, (world - origin) * density))
    const vertices = geometry.getAttribute('position')
    const surface = new Float32Array(vertices.count * 2)
    const uv = new Float32Array(vertices.count * 2)
    for (let i = 0; i < vertices.count; i++) {
      const x = vertices.getX(i), z = vertices.getZ(i)
      surface[i * 2] = x / 8
      surface[i * 2 + 1] = z / 8
      uv[i * 2] = (chart[0] + pixel(x, minX)) / size[0]
      uv[i * 2 + 1] = (chart[1] + pixel(z, minZ)) / size[1]
    }
    geometry.setAttribute('uv', new Float32BufferAttribute(surface, 2))
    geometry.setAttribute('uv1', new Float32BufferAttribute(uv, 2))
    return this.materials[kind]
  }
}

export async function loadSfNight() {
  const atlas = await manifest<Charts>('sf/pavement-night.json')
  return new SfNight(atlas, await colorTexture(atlas.image, 1))
}
