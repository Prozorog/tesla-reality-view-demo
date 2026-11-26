import { Vector3, Vector4 } from 'three'
import type { Object3D } from 'three'
import { editShader, standardMeshes } from '../assets/gltf.ts'
import type { Exterior } from '../assets/car-models.ts'
import type { Drive } from '../simulation/drive.ts'

import hero from '../../public/models/hero.json' with { type: 'json' }

const [HEAD_ALONG, LAMP_OFFSET] = hero.stations.head_lamp
const [TAIL_ALONG] = hero.stations.tail_lamp
const BUMPER = hero.stations.front_bumper
// Reality View: the cyan-white headlight cloud of clip B. It starts at the
// front bumper as wide as the car and opens into a cone about two car widths
// across at one and a half car lengths, fading out by about two car lengths.
// Seat: the real low beams, two long lobes reaching about 20 m.
export const CLOUD = { halfWidth: 1.2, growth: 0.14, gain: 1.55, floor: 0.13, color: [0.30, 0.76, 1.0] as const }
const REALITY_SHAPE = { growth: CLOUD.growth, base: CLOUD.halfWidth, gain: CLOUD.gain, floor: CLOUD.floor }
const CRUISE_SHAPE = { growth: 0.16, base: 1.75, gain: 1.85, floor: 0.13 }
const SEAT_SHAPE = { growth: 0.05, base: 0.42, gain: 3.0, floor: 4.5 }
const SEAT_REACH = 25
// Where along the throw the pool starts to fade (fraction of the reach).
const REALITY_FADE = 0.55, SEAT_FADE = 0.55

export class PavementLights {
  private readonly front = { value: new Vector4() }
  private readonly rear = { value: new Vector4() }
  private readonly beam = { value: new Vector4() }
  private readonly shape = { value: new Vector4() }
  private readonly fade = { value: REALITY_FADE }
  private readonly cloud = { value: 1 }
  private readonly cloudColor = { value: new Vector3(...CLOUD.color) }
  private readonly groundFill = { value: 0 }
  private readonly lamp = new Vector4()
  private readonly bumper = new Vector4()
  private realityReach = 7
  private seatBeams = 1
  private parking = 0

  constructor(world: Object3D, private readonly footprint: Exterior['footprint']) {
    const pavement = standardMeshes(world).filter(mesh => /^(Asphalt_|Kerbs_and_paving$|Outer_verge$|Street_beyond$)/.test(mesh.name))
    for (const material of new Set(pavement.map(mesh => mesh.material))) {
      const asphalt = pavement.some(mesh => mesh.material === material && /^Asphalt_/.test(mesh.name))
      editShader(material, asphalt ? 'player-pavement-light-p161-asphalt' : 'player-pavement-light-p161', shader => {
        shader.uniforms.rvHead = this.front
        shader.uniforms.rvTail = this.rear
        shader.uniforms.rvBeam = this.beam
        shader.uniforms.rvShape = this.shape
        shader.uniforms.rvFade = this.fade
        shader.uniforms.rvCloud = this.cloud
        shader.uniforms.rvCloudColor = this.cloudColor
        shader.uniforms.rvGroundFill = this.groundFill
        shader.vertexShader = 'varying vec2 rvPavement;\n' + shader.vertexShader.replace('#include <project_vertex>', `
          rvPavement = (modelMatrix * vec4(transformed, 1.0)).xz;
          #include <project_vertex>
        `)
        shader.fragmentShader = `
          varying vec2 rvPavement;
          uniform vec4 rvHead;
          uniform vec4 rvTail;
          uniform vec4 rvBeam;
          uniform vec4 rvShape;
          uniform float rvFade;
          uniform float rvCloud;
          uniform vec3 rvCloudColor;
          uniform float rvGroundFill;
          vec2 rvAlong(vec4 bumper) {
            vec2 delta = rvPavement - bumper.xy;
            return vec2(dot(delta, bumper.zw), dot(delta, vec2(-bumper.w, bumper.z)));
          }
        ` + shader.fragmentShader.replace('#include <lights_fragment_end>', `
          #include <lights_fragment_end>
          // Light from the player's lamps lands on the asphalt. It scales the
          // light already there (so cracks, patches and lines brighten with it)
          // and adds a small absolute term for dark ground. Both use a low-passed
          // albedo so the pool carries no per-pixel grain of its own.
          vec3 rvAlbedo = diffuseColor.rgb;
          #ifdef USE_MAP
            rvAlbedo = texture2D(map, vMapUv, 2.2).rgb * diffuse;
          #endif
          ${asphalt ? `
          // Clip B keeps the far rows lit between the baked lamp pools. Fill the
          // missing diffuse light before the player's headlights are applied.
          // The parking view keeps its baked contrast with only an 8% lift.
          float rvGroundLuma = dot(reflectedLight.indirectDiffuse, vec3(0.2126, 0.7152, 0.0722));
          float rvDistance = length(rvPavement - rvHead.xy);
          float rvFloor = mix(0.142, 0.156, smoothstep(12.0, 65.0, rvDistance));
          float rvDetail = 0.94 + 0.12 * clamp(rvGroundLuma / 0.10, 0.0, 1.0);
          vec3 rvGroundTint = diffuseColor.rgb / max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.003);
          vec3 rvFilled = max(reflectedLight.indirectDiffuse,
            rvGroundTint * vec3(1.03, 1.0, 0.95) * rvFloor * rvDetail);
          reflectedLight.indirectDiffuse = mix(reflectedLight.indirectDiffuse * 1.08, rvFilled, rvGroundFill);
          ` : ''}
          vec3 rvLit = reflectedLight.indirectDiffuse / max(diffuseColor.rgb, vec3(0.03));
          vec3 rvLight = vec3(0.0);
          vec2 h = rvAlong(rvHead);
          if (rvCloud > 0.5 && rvBeam.y > 0.0 && h.x > -0.3 && h.x < rvBeam.x * 1.05) {
            // Reality View cloud: a soft cone with a bright core and a faint haze around it.
            float rvHalf = rvShape.y + rvShape.x * max(h.x, 0.0);
            float across = abs(h.y) / rvHalf;
            float core = 1.0 - smoothstep(0.62, 1.30, across);
            float haze = exp(-across * across * 0.45);
            float start = smoothstep(-0.1, 1.2, h.x);
            float fall = 1.0 - smoothstep(rvFade * rvBeam.x, rvBeam.x, h.x);
            float cloud = rvBeam.y * start * fall * (0.80 * core + 0.20 * haze);
            rvLight += rvCloudColor * cloud * (rvShape.z * rvLit + rvShape.w);
          } else if (rvCloud < 0.5 && rvBeam.y > 0.0 && h.x > -0.4 && h.x < rvBeam.x * 1.05) {
            float t = clamp(h.x / rvBeam.x, 0.0, 1.0);
            float sigma = rvShape.y + rvShape.x * max(h.x, 0.0);
            float lobeA = exp(-pow((h.y - ${LAMP_OFFSET.toFixed(2)}) / sigma, 2.0));
            float lobeB = exp(-pow((h.y + ${LAMP_OFFSET.toFixed(2)}) / sigma, 2.0));
            float lobes = min(1.0, 0.78 * (lobeA + lobeB) + 0.22 * max(lobeA, lobeB));
            float start = smoothstep(-0.4, 0.7, h.x);
            float fall = 1.0 - smoothstep(rvFade, 1.0, t);
            float pool = rvBeam.y * lobes * start * fall * fall * (3.0 - 2.0 * fall);
            rvLight += vec3(0.80, 0.90, 1.0) * pool * (rvShape.z * rvLit + rvShape.w);
          }
          vec2 r = rvAlong(rvTail);
          if (r.x > -0.24 && r.x < 3.6 && abs(r.y) < 1.86) {
            float start = smoothstep(-0.24, 0.30, r.x);
            float width = 1.05 + r.x * 0.13;
            float edge = 1.0 - smoothstep(0.39, 1.33, abs(r.y) / width);
            float reach = 1.0 - smoothstep(0.64, 3.60, r.x);
            rvLight += vec3(1.0, 0.025, 0.055) * (rvBeam.z * edge * reach * start);
            rvLight += vec3(0.61, 0.78, 1.0) * (rvBeam.w * edge * start * (1.0 - smoothstep(0.20, 1.34, r.x)));
          }
          reflectedLight.indirectDiffuse += rvAlbedo * rvLight;
        `)
      })
    }
  }

  update(drive: Drive, overhead: number, braking: boolean) {
    const { x, z, h } = drive.pose
    const dx = Math.cos(h), dz = -Math.sin(h)
    const { front, rear } = this.footprint
    // Selection starts the parking chase before the camera has risen. Use the
    // established parking light there as well as in the straight-down view.
    this.parking = drive.selectedBay || drive.mode === 'parked' ? 1 : overhead
    // The beams turn with the front wheels.
    const steer = h + drive.steer * 0.42
    this.lamp.set(x + dx * HEAD_ALONG, z + dz * HEAD_ALONG, Math.cos(steer), -Math.sin(steer))
    this.bumper.set(x + dx * BUMPER, z + dz * BUMPER, Math.cos(steer), -Math.sin(steer))
    this.rear.value.set(x + dx * TAIL_ALONG, z + dz * TAIL_ALONG, -dx, -dz)
    // About 1.9 car lengths of throw; the headlights stay on in every gear.
    this.realityReach = (front - rear) * (1.90 + 0.20 * overhead)
    this.seatBeams = drive.gear === 'P' ? 0 : 1
    this.beam.value.set(this.realityReach, 1, braking ? 2.85 : 1.79, drive.gear === 'R' ? 1.05 : 0)
    this.usePass('reality')
  }

  /** The seat sees the real low beams; the Reality View sees the short visual pool. */
  usePass(pass: string) {
    const seat = pass === 'seat'
    if (seat) {
      this.shape.value.set(SEAT_SHAPE.growth, SEAT_SHAPE.base, SEAT_SHAPE.gain, SEAT_SHAPE.floor)
    } else {
      const mix = this.parking
      this.shape.value.set(
        CRUISE_SHAPE.growth + (REALITY_SHAPE.growth - CRUISE_SHAPE.growth) * mix,
        CRUISE_SHAPE.base + (REALITY_SHAPE.base - CRUISE_SHAPE.base) * mix,
        CRUISE_SHAPE.gain + (REALITY_SHAPE.gain - CRUISE_SHAPE.gain) * mix,
        CRUISE_SHAPE.floor + (REALITY_SHAPE.floor - CRUISE_SHAPE.floor) * mix,
      )
    }
    this.beam.value.x = seat ? SEAT_REACH : this.realityReach
    this.beam.value.y = seat ? this.seatBeams : 1
    this.fade.value = seat ? SEAT_FADE : REALITY_FADE
    this.cloud.value = seat ? 0 : 1
    this.groundFill.value = seat ? 0 : 1 - this.parking
    this.front.value.copy(seat ? this.lamp : this.bumper)
  }
}
