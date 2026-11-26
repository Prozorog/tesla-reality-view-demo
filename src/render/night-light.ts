import { DataTexture, EquirectangularReflectionMapping, FloatType, LinearFilter } from 'three'
import type { MeshStandardMaterial } from 'three'
import { editShader } from '../assets/gltf.ts'

export const NIGHT_FOG_NEAR = 70
export const NIGHT_FOG_FAR = 235

// A shared display shoulder for the physical scene in both offscreen targets
// and the seat framebuffer. Keep linear shadow detail and roll off lamp peaks.
export function finishNight(material: MeshStandardMaterial, bakedDiffuse = false) {
  editShader(material, bakedDiffuse ? 'baked-night' : 'night', shader => {
    if (bakedDiffuse) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `
        iblIrradiance = vec3(0.0);
        #include <lights_fragment_end>
      `)
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>', `
      vec3 exposed = 1.19 * gl_FragColor.rgb;
      float peak = max(max(exposed.r, exposed.g), max(exposed.b, 0.0001));
      float excess = max(peak - 0.58, 0.0);
      gl_FragColor.rgb = exposed * (1.0 - excess * excess / ((excess + 0.42) * peak));
      #ifdef OPAQUE
        // The world target's spare alpha channel marks visible emitters.
        // The unlit tablet and the overlays never enter the bloom signal.
        float emission = max(totalEmissiveRadiance.r, max(totalEmissiveRadiance.g, totalEmissiveRadiance.b));
        gl_FragColor.a = 1.0 - smoothstep(0.12, 1.7, emission);
      #endif
    `)
  })
}

// One static night environment. Broad cool horizon and small neutral LED sources
// give paint and glass something to reflect at their authored roughness.
export function nightEnvironment() {
  const width = 256, height = 128
  const pixels = new Float32Array(width * height * 4)
  for (let j = 0; j < height; j++) {
    const latitude = ((j + 0.5) / height - 0.5) * Math.PI
    const sky = Math.max(0, Math.sin(latitude))
    const horizon = Math.exp(-Math.abs(latitude) * 5)
    const zenith = sky ** 6
    for (let i = 0; i < width; i++) {
      const yaw = ((i + 0.5) / width - 0.5) * 2 * Math.PI
      const storefront = Math.pow(Math.max(0, Math.cos(yaw - Math.PI / 2)), 10) * horizon
      const overhead = Math.exp(-(((latitude - 1.25) / 0.13) ** 2)) * Math.pow(Math.max(0, Math.cos(yaw + 1.15)), 14)
      const opposite = Math.exp(-(((latitude - 0.82) / 0.13) ** 2)) * Math.pow(Math.max(0, Math.cos(yaw - 1.72)), 18)
      const p = (j * width + i) * 4
      pixels[p] = 0.009 + 0.035 * sky + 0.050 * zenith + 0.52 * storefront + 16.0 * overhead + 7.1 * opposite
      pixels[p + 1] = 0.012 + 0.047 * sky + 0.065 * zenith + 0.39 * storefront + 14.9 * overhead + 6.7 * opposite
      pixels[p + 2] = 0.020 + 0.072 * sky + 0.108 * zenith + 0.28 * storefront + 13.6 * overhead + 6.2 * opposite
      pixels[p + 3] = 1
    }
  }
  const texture = new DataTexture(pixels, width, height, undefined, FloatType)
  texture.mapping = EquirectangularReflectionMapping
  texture.minFilter = texture.magFilter = LinearFilter
  texture.needsUpdate = true
  return texture
}
