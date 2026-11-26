import {
  ClampToEdgeWrapping, DataTexture, DoubleSide, Group, Matrix4, Mesh,
  NearestFilter, PlaneGeometry, RedFormat, ShaderMaterial, UnsignedByteType, Vector2,
} from 'three'
import type { SfMap } from '../simulation/sf-map.ts'
import type { Point } from '../simulation/lot.ts'
import { editShader, model, standardMeshes } from './gltf.ts'
import { finishNight } from '../render/night-light.ts'

// Part names also define the independent surfaces available to the night pass.
const EMISSION: Record<string, number> = {
  Palace_Illuminated_Stone: 0.76,
  Palace_Cornices_And_Arch_Light: 0.92,
  Palace_Capitals_And_Reliefs: 0.68,
  Palace_Copper_Dome: 0.44,
  Palace_Uplight_Emitters: 3.8,
  Golden_Gate_International_Orange: 0.23,
  Golden_Gate_Cables_And_Suspenders: 0.20,
  Golden_Gate_Deck_And_Lanes: 0.075,
  Golden_Gate_Deck_Lights: 3.4,
  Marin_Headlands_And_Pacific_Heights: 0.19,
  San_Francisco_Bay: 0.30,
  Yacht_Harbor_Docks: 0.25,
  Yacht_Harbor_Hulls_And_Masts: 0.27,
  Pacific_Heights_House_Lights: 1.25,
  Marina_Green_Lawn: 0.23,
}

function contains([x, z]: Point, outline: Point[]) {
  let inside = false
  for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
    const [ax, az] = outline[i], [bx, bz] = outline[j]
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside
  }
  return inside
}

function lagoonMask(outline: Point[]) {
  const min = new Vector2(Math.min(...outline.map(p => p[0])), Math.min(...outline.map(p => p[1])))
  const span = new Vector2(Math.max(...outline.map(p => p[0])) - min.x, Math.max(...outline.map(p => p[1])) - min.y)
  const width = 256, height = 512, pixels = new Uint8Array(width * height)
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++) {
      const point: Point = [min.x + (x + 0.5) / width * span.x, min.y + (z + 0.5) / height * span.y]
      if (contains(point, outline)) pixels[z * width + x] = 255
    }
  }
  const texture = new DataTexture(pixels, width, height, RedFormat, UnsignedByteType)
  texture.minFilter = texture.magFilter = NearestFilter
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping
  texture.needsUpdate = true
  return { texture, min, span }
}

export function addSfLandmarkReflection(city: Group, map: SfMap) {
  const lagoon = map.water.find(water => water.kind === 'lagoon')
  const root = new Group()
  root.name = 'Palace Lagoon Reflection'
  if (!lagoon) return root
  const mask = lagoonMask(lagoon.outline)
  // Match the mapped lagoon at y=.012. The fragment depth is the water-ray
  // intersection, so opaque water and banks correctly occlude the virtual image.
  root.scale.y = -1
  root.position.y = 0.024
  const reflectedParts = new Set([
    'Palace_Illuminated_Stone', 'Palace_Cornices_And_Arch_Light',
    'Palace_Copper_Dome', 'Palace_Uplight_Emitters',
  ])
  for (const original of standardMeshes(city)) {
    if (!reflectedParts.has(original.name)) continue
    const material = new ShaderMaterial({
      name: `Reflection ${original.name}`,
      transparent: true, depthWrite: false, side: DoubleSide, vertexColors: true,
      uniforms: {
        lagoonMask: { value: mask.texture }, maskMin: { value: mask.min }, maskSpan: { value: mask.span },
        waterProjection: { value: new Matrix4() }, time: { value: 0 },
        strength: { value: 0.30 }, gain: { value: EMISSION[original.name] ?? 0.5 },
      },
      vertexShader: `
        varying vec3 reflectedWorld;
        varying vec3 reflectedTint;
        void main() {
          vec4 world = modelMatrix * vec4(position, 1.0);
          reflectedWorld = world.xyz;
          reflectedTint = color.rgb;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: `
        uniform sampler2D lagoonMask;
        uniform vec2 maskMin;
        uniform vec2 maskSpan;
        uniform mat4 waterProjection;
        uniform float time;
        uniform float strength;
        uniform float gain;
        varying vec3 reflectedWorld;
        varying vec3 reflectedTint;
        void main() {
          vec3 ray = reflectedWorld - cameraPosition;
          float t = (0.017 - cameraPosition.y) / ray.y;
          if (t <= 0.0 || t >= 1.0) discard;
          vec3 water = cameraPosition + ray * t;
          vec2 uv = (water.xz - maskMin) / maskSpan;
          if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) discard;
          if (texture2D(lagoonMask, uv).r < 0.5) discard;
          float ripple = 0.72 + 0.18 * sin(water.z * 10.5 + sin(water.x * 0.6 + time) * 1.7);
          ripple *= 0.87 + 0.13 * sin(water.z * 24.0 - time * 1.4);
          float fresnel = clamp(1.0 - abs(normalize(ray).y), 0.15, 1.0);
          gl_FragColor = vec4(reflectedTint * gain * vec3(0.90, 0.95, 1.0), strength * ripple * fresnel);
          vec4 depthPoint = waterProjection * vec4(water, 1.0);
          gl_FragDepth = clamp(depthPoint.z / depthPoint.w * 0.5 + 0.5, 0.0, 1.0);
          #include <colorspace_fragment>
        }
      `,
    })
    const mirror = new Mesh(original.geometry, material)
    mirror.name = `Lagoon image ${original.name}`
    original.updateWorldMatrix(true, false)
    mirror.matrixAutoUpdate = false
    mirror.matrix.copy(original.matrixWorld)
    mirror.renderOrder = 12
    mirror.onBeforeRender = (_renderer, _scene, camera) => {
      material.uniforms.waterProjection.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      material.uniforms.time.value = performance.now() * 0.001
    }
    root.add(mirror)
  }
  // From the actual north parking pad, the tall dome's perfect mirror falls
  // outside the lagoon. These restrained warm streaks represent shore uplight
  // spill on the intervening mapped water, rather than moving the real lagoon.
  const streaks = new ShaderMaterial({
    name: 'Palace warm shore-water streaks', transparent: true, depthWrite: false,
    uniforms: {
      lagoonMask: { value: mask.texture }, maskMin: { value: mask.min }, maskSpan: { value: mask.span },
      rotunda: { value: new Vector2(...map.rotunda) }, strength: { value: 0.22 }, time: { value: 0 },
    },
    vertexShader: `
      varying vec3 waterWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        waterWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform sampler2D lagoonMask;
      uniform vec2 maskMin;
      uniform vec2 maskSpan;
      uniform vec2 rotunda;
      uniform float strength;
      uniform float time;
      varying vec3 waterWorld;
      void main() {
        vec2 uv = (waterWorld.xz - maskMin) / maskSpan;
        if (texture2D(lagoonMask, uv).r < 0.5) discard;
        vec2 p = waterWorld.xz - rotunda;
        float ripple = pow(0.5 + 0.5 * sin(waterWorld.z * 10.0 + sin(waterWorld.x * 1.3 + time) * 1.8), 8.0);
        float north = exp(-pow((p.x - 2.0) / 4.0, 2.0) - pow((p.y + 55.0) / 17.0, 2.0));
        float east = exp(-pow((p.x - 51.0) / 6.0, 2.0) - pow((p.y - 1.0) / 23.0, 2.0));
        float south = exp(-pow((p.x - 18.0) / 5.0, 2.0) - pow((p.y - 55.0) / 20.0, 2.0));
        float alpha = strength * ripple * (north + east + south);
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(0.83, 0.48, 0.17, min(alpha, 0.45));
        #include <colorspace_fragment>
      }
    `,
  })
  const spill = new Mesh(new PlaneGeometry(mask.span.x, mask.span.y).rotateX(-Math.PI / 2), streaks)
  spill.name = 'Palace warm lagoon streaks'
  // Counter the image group's y mirror so this plane faces upward at y=.018.
  spill.position.set(mask.min.x + mask.span.x / 2, 0.006, mask.min.y + mask.span.y / 2)
  spill.scale.y = -1
  spill.renderOrder = 13
  spill.onBeforeRender = () => { streaks.uniforms.time.value = performance.now() * 0.001 }
  root.add(spill)
  city.add(root)
  return root
}

export async function loadSfLandmarks(map: SfMap): Promise<Group> {
  const city = await model('sf/landmarks.glb')
  city.name = 'Mapped San Francisco Landmarks'
  for (const mesh of standardMeshes(city)) {
    const material = mesh.material
    material.color.setScalar(0.15)
    material.emissive.set('#ffffff')
    material.emissiveIntensity = EMISSION[mesh.name] ?? 0.25
    material.roughness = 0.9
    material.envMapIntensity = 0.12
    editShader(material, 'landmark-vertex-emission', shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `
        #include <emissivemap_fragment>
        #ifdef USE_COLOR
          totalEmissiveRadiance *= vColor.rgb;
        #endif
      `)
    })
    finishNight(material)
  }
  const root = new Group()
  root.name = 'San Francisco Landmarks And Waterfront'
  root.add(city)
  root.userData.mapOrigin = [...map.origin]
  return root
}
