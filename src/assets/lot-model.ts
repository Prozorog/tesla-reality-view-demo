import { Box3, InstancedBufferAttribute, InstancedMesh, LinearFilter, Matrix4, NoColorSpace, Quaternion, RepeatWrapping, Vector2, Vector3 } from 'three'
import type { MeshStandardMaterial, Texture } from 'three'
import type { CarColor, CarType } from '../simulation/lot.ts'
import { fixtureStars } from '../render/fixture-stars.ts'
import { finishNight } from '../render/night-light.ts'
import { LotOcclusion } from '../render/lot-occlusion.ts'
import type { ObstacleKind } from '../render/lot-occlusion.ts'
import type { ProbeSide } from '../render/vehicle-lighting.ts'
import { colorTexture, editShader, manifest, model, named, standardMeshes, useLightMap } from './gltf.ts'
import { dressHorizonRoofs } from './horizon-roofs.ts'
import type { StandardMesh } from './gltf.ts'

type Placement = { position: number[]; heading: number; scale: number[]; lightmapScale?: number[]; lightmapOffset?: number[] }
export type ParkedBake = {
  type: CarType
  color: CarColor
  position: number[]
  heading: number
  probes: Record<ProbeSide, { rgb: number[] }>
}
type LotManifest = {
  meshes: Record<string, { file: string; channel: number; flipY: boolean; threeStandardLightMapIntensity: number }>
  emissive: Record<string, { color: string; intensity: number; map?: string; vertexTint?: boolean }>
  instances: Record<string, Placement[]>
  parkedCars: Record<string, ParkedBake>
  lamps: { heads: { position: number[] }[] }[]
  glints?: number[][]
  alphaMasks?: Record<string, string>
}

// Foliage cards: the mask's coverage is raised with the mip level so crowns and
// the tree line stay solid at distance, then resolved by alpha-to-coverage.
function foliageCoverage(material: MeshStandardMaterial) {
  const image = material.alphaMap!.image as { width: number; height: number }
  const size = new Vector2(image.width, image.height)
  // Close crowns: the cluster mask is cut along two card borders, and cards seen
  // edge-on drew thin straight lines, so both fade out (leaf cards only).
  const leaf = material.name === 'Leaf cards'
  editShader(material, leaf ? 'foliage-coverage-leaf' : 'foliage-coverage', shader => {
    shader.uniforms.alphaMapSize = { value: size }
    shader.fragmentShader = 'uniform vec2 alphaMapSize;\n' + shader.fragmentShader.replace('#include <alphamap_fragment>', `
      vec2 leafTexel = vAlphaMapUv * alphaMapSize;
      float leafLod = max(0.0, 0.5 * log2(max(dot(dFdx(leafTexel), dFdx(leafTexel)), dot(dFdy(leafTexel), dFdy(leafTexel)))));
      diffuseColor.a *= clamp(texture2D(alphaMap, vAlphaMapUv).g * (1.0 + 0.3 * leafLod), 0.0, 1.0);
      ${leaf ? `
      vec2 leafCard = fract(vAlphaMapUv);
      diffuseColor.a *= smoothstep(0.025, 0.16, min(min(leafCard.x, 1.0 - leafCard.x), min(leafCard.y, 1.0 - leafCard.y)));
      #ifndef FLAT_SHADED
        diffuseColor.a *= smoothstep(0.20, 0.46, abs(dot(normalize(vNormal), normalize(vViewPosition))));
      #endif` : ''}
    `)
  })
}

// Scattered horizon lights emit their own vertex colour.
function tintedEmission(material: MeshStandardMaterial) {
  editShader(material, 'tinted-emission', shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
      #include <emissivemap_fragment>
      #ifdef USE_COLOR
        totalEmissiveRadiance *= vColor.rgb;
      #endif
    `)
  })
}

function obstacleKind(name: string): ObstacleKind | undefined {
  if (/^Serviceberry_/.test(name)) return 'tree'
  if (/^Lamp_column_|^Street_columns$/.test(name)) return 'pole'
  if (/^Lamp_LED_|^Street_lenses$/.test(name)) return 'lens'
}

function lampRim(mesh: StandardMesh, lens: StandardMesh) {
  lens.geometry.computeBoundingBox()
  const { min, max } = lens.geometry.boundingBox!
  const limits = new Vector3(Math.max(Math.abs(min.x), Math.abs(max.x)), min.y, Math.max(Math.abs(min.z), Math.abs(max.z)))
  editShader(mesh.material, 'lamp-lens-rim', shader => {
    shader.uniforms.fixtureLens = { value: limits }
    shader.vertexShader = 'varying vec3 fixtureLocal;\n' + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      fixtureLocal = position;
    `)
    shader.fragmentShader = 'uniform vec3 fixtureLens; varying vec3 fixtureLocal;\n' +
      shader.fragmentShader.replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        vec2 edge = abs(fixtureLocal.xz) / fixtureLens.xz;
        float head = smoothstep(0.54, 0.77, edge.y) * smoothstep(fixtureLens.y - 0.035, fixtureLens.y + 0.08, fixtureLocal.y);
        float rim = smoothstep(0.83, 1.13, max(edge.x, edge.y));
        totalEmissiveRadiance += head * rim * vec3(0.86, 0.80, 0.72);
      `)
  })
}

export async function loadLot() {
  const [world, data] = await Promise.all([model('lot.glb'), manifest<LotManifest>('lot.lightmaps.json')])
  await Promise.all(Object.entries(data.meshes).map(async ([name, entry]) => {
    const map = await colorTexture(entry.file, entry.channel, entry.flipY)
    if (/ground/.test(entry.file)) {
      map.anisotropy = 8
    } else {
      // The architecture atlas packs hundreds of small charts. At grazing angles its
      // mip levels averaged neighbouring charts into coloured blocks: the rainbow kerb
      // stripe, the red and green blotches on the parapet and the roof speckle.
      map.generateMipmaps = false
      map.minFilter = LinearFilter
    }
    for (const mesh of standardMeshes(named(world, name))) {
      useLightMap(mesh, map, entry.threeStandardLightMapIntensity)
      // Keep painted lines crisp along the aisle in the low chase view.
      if (mesh.material.map) mesh.material.map.anisotropy = 8
    }
  }))
  const masks = new Map<string, Texture>()
  await Promise.all(Object.entries(data.alphaMasks ?? {}).map(async ([material, file]) => {
    const mask = (await colorTexture(file)).clone()
    mask.colorSpace = NoColorSpace
    if (/treeline/.test(file)) mask.wrapS = RepeatWrapping
    mask.needsUpdate = true
    masks.set(material, mask)
  }))
  for (const mesh of standardMeshes(world)) {
    const mask = masks.get(mesh.material.name)
    if (!mask) continue
    mesh.material.alphaMap = mask
    mesh.material.alphaTest = 0.5
    mesh.material.alphaToCoverage = true
  }
  await Promise.all(Object.entries(data.emissive).map(async ([name, entry]) => {
    const map = entry.map && await colorTexture(entry.map)
    for (const mesh of standardMeshes(named(world, name))) {
      mesh.material = mesh.material.clone()
      mesh.material.emissive.set(entry.color)
      const source = /^(Lamp_LED_|Street_lenses$|Sign_|Distant_sign_)/.test(name)
      mesh.material.emissiveIntensity = entry.intensity * (source ? 1.4 : 1)
      if (map) mesh.material.emissiveMap = map
      if (entry.vertexTint) mesh.material.userData.vertexTint = true
    }
  }))

  // From the roof angle the salmon ORIEL & FIG letters bloomed pink: keep them sign red.
  const oriel = world.getObjectByName('Sign_Oriel')
  if (oriel) for (const mesh of standardMeshes(oriel)) {
    mesh.material.emissive.set('#ff2b1d')
    mesh.material.emissiveIntensity = 3.2
    mesh.material.color.set('#c81e16')
  }
  dressHorizonRoofs(world)

  world.updateMatrixWorld(true)
  const occlusion = new LotOcclusion()
  occlusion.addSolid(new Box3().setFromObject(named(world, 'Northgate_masonry')))
  const up = new Vector3(0, 1, 0), position = new Vector3(), rotation = new Quaternion(), scale = new Vector3()
  const matrix = new Matrix4()
  for (const [name, placements] of Object.entries(data.instances)) {
    const prototype = named(world, name)
    const inverse = prototype.matrixWorld.clone().invert()
    const kind = obstacleKind(name)
    const lensName = name === 'Street_columns' ? 'Street_lenses' : name.replace(/^Lamp_column_/, 'Lamp_LED_')
    const lens = kind === 'pole' ? world.getObjectByName(lensName) : undefined
    for (const mesh of standardMeshes(prototype)) {
      const local = inverse.clone().multiply(mesh.matrixWorld)
      const batch = new InstancedMesh(mesh.geometry, mesh.material, placements.length)
      batch.name = mesh.name
      batch.userData.splatSource = name
      for (const [i, entry] of placements.entries()) {
        matrix.compose(position.fromArray(entry.position), rotation.setFromAxisAngle(up, entry.heading), scale.fromArray(entry.scale))
        batch.setMatrixAt(i, matrix.multiply(local))
      }
      if (mesh.material.lightMap || kind && kind !== 'solid') {
        batch.geometry = mesh.geometry.clone()
        batch.material = mesh.material.clone()
      }
      if (mesh.material.lightMap) {
        const rectangles = placements.flatMap(entry => [...entry.lightmapScale!, ...entry.lightmapOffset!])
        batch.geometry.setAttribute('lightmapRect', new InstancedBufferAttribute(new Float32Array(rectangles), 4))
        editShader(batch.material, 'instance-lightmap-uv', shader => {
          shader.vertexShader = 'attribute vec4 lightmapRect;\n' + shader.vertexShader.replace('#include <uv_vertex>', `
            #include <uv_vertex>
            vLightMapUv = vLightMapUv * lightmapRect.xy + lightmapRect.zw;
          `)
        })
      }
      if (kind) occlusion.addInstances(batch, kind, placements.map(entry => entry.position))
      if (lens) {
        const [optic] = standardMeshes(lens)
        if (optic) lampRim(batch, optic)
      }
      world.add(batch)
    }
    prototype.removeFromParent()
  }
  const distant = /^(Distant_trees|Distant_posts|Horizon_roofs|Outer_verge)$/
  for (const [material, name] of new Map(standardMeshes(world).map(mesh => [mesh.material, mesh.name]))) {
    // The baked lightmap carries the diffuse light. A small environment term keeps
    // satin sheen without the hot spots glinting on thin trim and parapet caps.
    material.envMapIntensity = distant.test(name) ? 0.02 : /^Asphalt_/.test(name) ? 0.32 : 0.14
    if (material.alphaMap) foliageCoverage(material)
    if (material.userData.vertexTint) tintedEmission(material)
    finishNight(material, true)
  }
  const glints = (data.glints ?? []).map(position => ({ position }))
  world.add(fixtureStars([...data.lamps.flatMap(lamp => lamp.heads), ...glints]))
  return { world, parkedCars: data.parkedCars, occlusion }
}
