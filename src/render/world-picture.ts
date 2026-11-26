import {
  AlwaysDepth, DepthTexture, HalfFloatType, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial,
  UnsignedIntType, Vector2, WebGLRenderTarget,
} from 'three'
import type { Texture, WebGLRenderer } from 'three'
import { HUD_HEIGHT, HUD_WIDTH } from './dive.ts'
import type { Frame } from './dive.ts'

// Half float: the world is stored in linear light. In 8 bits the dark sky, fog
// and tree line quantised per channel into purple, red and teal contours.
export function worldTarget(width: number, height: number) {
  return new WebGLRenderTarget(width, height, {
    minFilter: LinearFilter, type: HalfFloatType, depthTexture: new DepthTexture(width, height, UnsignedIntType),
  })
}

const quadVertex = `
  varying vec2 pictureCoord;
  void main() {
    pictureCoord = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`

export class WorldPicture {
  private readonly scene = new Scene()
  private readonly bloomScene = new Scene()
  private readonly bloomTargets = new WeakMap<WebGLRenderTarget, WebGLRenderTarget>()
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 2)
  private readonly bloomMaterial = new ShaderMaterial({
    uniforms: { source: { value: null }, pixel: { value: new Vector2() } },
    depthTest: false,
    depthWrite: false,
    vertexShader: quadVertex,
    fragmentShader: `
      uniform sampler2D source;
      uniform vec2 pixel;
      varying vec2 pictureCoord;

      vec3 emission(vec2 offset) {
        vec4 sampleColor = texture2D(source, pictureCoord + offset * pixel);
        return sampleColor.rgb * (1.0 - sampleColor.a);
      }

      void main() {
        vec3 spread = emission(vec2(4.4, 0.0)) + emission(vec2(-4.4, 0.0))
          + emission(vec2(0.0, 4.4)) + emission(vec2(0.0, -4.4));
        #ifdef HIGH_BLOOM
          vec3 corners = emission(vec2(6.3, 5.1)) + emission(vec2(-6.3, 5.1))
            + emission(vec2(6.3, -5.1)) + emission(vec2(-6.3, -5.1));
          vec3 glow = 0.20 * emission(vec2(0.0)) + 0.135 * spread + 0.065 * corners;
        #else
          vec3 glow = 0.28 * emission(vec2(0.0)) + 0.18 * spread;
        #endif
        gl_FragColor = vec4(glow, 1.0);
      }
    `,
  })
  private readonly material = new ShaderMaterial({
    uniforms: {
      colorPicture: { value: null },
      depthPicture: { value: null },
      bloomPicture: { value: null },
      soften: { value: true },
      frameSize: { value: new Vector2() },
      frameOrigin: { value: new Vector2() },
      tabletSize: { value: new Vector2(HUD_WIDTH, HUD_HEIGHT) },
    },
    depthFunc: AlwaysDepth,
    vertexShader: quadVertex,
    fragmentShader: `
      uniform sampler2D colorPicture;
      uniform sampler2D depthPicture;
      uniform sampler2D bloomPicture;
      uniform bool soften;
      uniform vec2 frameSize;
      uniform vec2 frameOrigin;
      uniform vec2 tabletSize;
      varying vec2 pictureCoord;

      void main() {
        vec2 uv = pictureCoord;
        vec3 color = texture2D(colorPicture, uv).rgb;
        float depth = 1.0;
        if (soften) {
          vec2 stepUV = 0.92 / frameSize;
          color *= 0.52;
          color += texture2D(colorPicture, uv + vec2(stepUV.x, 0.0)).rgb * 0.12;
          color += texture2D(colorPicture, uv - vec2(stepUV.x, 0.0)).rgb * 0.12;
          color += texture2D(colorPicture, uv + vec2(0.0, stepUV.y)).rgb * 0.12;
          color += texture2D(colorPicture, uv - vec2(0.0, stepUV.y)).rgb * 0.12;
          vec2 logical = frameOrigin + uv * frameSize;
          float grain = fract(sin(dot(floor(logical), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
          float vignette = smoothstep(0.23, 0.71, length(logical / tabletSize - 0.5));
          color *= 1.0 - 0.15 * vignette;
          color += grain * 0.008 * sqrt(max(color, vec3(0.0)) + 0.035);
          // Preserve the world's depth for the sharp ground overlays.
          depth = texture2D(depthPicture, uv).r;
        }
        color += 0.52 * texture2D(bloomPicture, uv).rgb;
        gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
        gl_FragDepth = depth;
        #include <colorspace_fragment>
      }
    `,
  })

  constructor(private readonly high: boolean) {
    if (high) this.bloomMaterial.defines.HIGH_BLOOM = 1
    this.camera.position.z = 1
    const geometry = new PlaneGeometry(2, 2)
    const quad = new Mesh(geometry, this.material)
    quad.frustumCulled = false
    this.scene.add(quad)
    const bloomQuad = new Mesh(geometry, this.bloomMaterial)
    bloomQuad.frustumCulled = false
    this.bloomScene.add(bloomQuad)
  }

  bloom(renderer: WebGLRenderer, picture: WebGLRenderTarget, frame: Frame) {
    let target = this.bloomTargets.get(picture)
    if (!target) {
      target = new WebGLRenderTarget(1, 1, { minFilter: LinearFilter, depthBuffer: false })
      this.bloomTargets.set(picture, target)
    }
    const divisor = this.high ? 4 : 8
    target.setSize(Math.max(1, Math.ceil(frame.width / divisor)), Math.max(1, Math.ceil(frame.height / divisor)))
    this.bloomMaterial.uniforms.source.value = picture.texture
    this.bloomMaterial.uniforms.pixel.value.set(1 / frame.width, 1 / frame.height)
    renderer.setRenderTarget(target)
    renderer.render(this.bloomScene, this.camera)
    return target.texture
  }

  draw(renderer: WebGLRenderer, picture: WebGLRenderTarget, bloom: Texture, frame: Frame, soften: boolean) {
    const { uniforms } = this.material
    uniforms.colorPicture.value = picture.texture
    uniforms.depthPicture.value = picture.depthTexture
    uniforms.bloomPicture.value = bloom
    uniforms.soften.value = soften
    uniforms.frameSize.value.set(frame.width, frame.height)
    uniforms.frameOrigin.value.set(frame.x, HUD_HEIGHT - frame.y - frame.height)
    renderer.render(this.scene, this.camera)
  }
}
