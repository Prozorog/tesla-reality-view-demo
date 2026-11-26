import { BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Mesh, ShaderMaterial } from 'three'
import { RIBBON_LAYER } from '../assets/index.ts'
import type { Drive } from '../simulation/drive.ts'
import { clamp, dot, FRONT, HALF_WIDTH, integrate, left, localPoint, REAR } from '../simulation/geometry.ts'
import type { Pose } from '../simulation/lot.ts'
import { pathPoint } from '../simulation/parking.ts'

const SEGMENTS = 40
// Clip B: one band about two thirds of the car's width at the bumper,
// tapering to a short wedge; about one car length while there is room.
const HALF_BAND = (2 * HALF_WIDTH) / 3
const TAPER = 0.62
const FEATHER = 0.1
const CAR_LENGTH = FRONT - REAR
const MAX_LENGTH = CAR_LENGTH
// Within this distance of the stop the stripe shrinks back to the bumper.
const SHRINK = 1.0
// Past the pull-past stop the stripe follows the next planned move: a curve toward the bay (clip B b12/b13).
const NEXT_RADIUS = 6.5

export class Ribbon {
  private readonly geometry = new BufferGeometry()
  private readonly positions = new Float32Array((SEGMENTS + 1) * 6)
  private readonly lateral = new Float32Array((SEGMENTS + 1) * 4)
  private readonly material = new ShaderMaterial({
    transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true,
    uniforms: { blue: { value: new Color('#1f7bff') }, length: { value: 1 }, city: { value: 0 } },
    vertexShader: `
      attribute vec2 band;
      varying float along;
      varying vec2 across;
      void main() {
        along = uv.x;
        across = band;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying float along;
      varying vec2 across;
      uniform vec3 blue;
      uniform float length;
      uniform float city;
      void main() {
        // across.x: signed metres from the centre line, across.y: half-width here.
        float metres = along * length;
        float side = across.x / across.y;
        // Soft 10 cm edges, crisp at the bumper, fading over the last third.
        float edge = smoothstep(-${FEATHER.toFixed(2)}, 0.0, across.y - abs(across.x));
        float start = smoothstep(0.0, 0.06, metres);
        float tail = 1.0 - smoothstep(0.66, 1.0, along);
        // Four broad lengthwise streaks with slow drift along the band.
        float streak = sin(side * 5.6 + 0.9 + 0.35 * sin(metres * 1.3));
        float shade = 0.84 + 0.20 * streak + 0.10 * (1.0 - abs(side));
        vec3 colour = blue * shade + vec3(0.05, 0.09, 0.16) * max(streak, 0.0) * (1.0 - along);
        colour = mix(colour, blue * (1.0 + 0.05 * cos(side * 4.0)), city);
        gl_FragColor = vec4(colour, mix(0.93, 0.97, city) * edge * start * tail);
        #include <colorspace_fragment>
      }
    `,
  })
  readonly mesh = new Mesh(this.geometry, this.material)
  private length = 0

  constructor() {
    const uv: number[] = [], index: number[] = []
    for (let i = 0; i <= SEGMENTS; i++) {
      uv.push(i / SEGMENTS, 0, i / SEGMENTS, 1)
      if (i < SEGMENTS) {
        const a = 2 * i
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
      }
    }
    this.geometry.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage))
    this.geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
    this.geometry.setAttribute('band', new BufferAttribute(this.lateral, 2).setUsage(DynamicDrawUsage))
    this.geometry.setIndex(index)
    this.mesh.layers.set(RIBBON_LAYER)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 2
  }

  /** What is left of the current move in its direction of travel, in metres. */
  private remaining(drive: Drive) {
    switch (drive.mode) {
      case 'pull-past': return drive.approachRemaining
      case 'reverse': return drive.motionLength - drive.pathDistance
      case 'exiting': return drive.pathDistance
      default: return 0
    }
  }

  update(dt: number, drive: Drive) {
    if (drive.street && drive.onStreet && !drive.isManual && drive.gear === 'D') {
      const reach = Math.min(42, Math.max(0, drive.street.navigation.remaining - FRONT))
      this.length = Math.min(reach, this.length + (reach - this.length) * (1 - Math.exp(-dt * 6)))
      this.mesh.visible = this.length > 0.07
      return
    }
    const active = drive.status === 'Parking' || drive.status === 'Reversing'
    const moving = clamp(Math.abs(drive.speed) / 0.35, 0, 1)
    const remaining = Math.max(0, this.remaining(drive))
    // About one car length ahead of the bumper while parking. A forward move
    // shorter than that continues along the next planned path; within SHRINK of
    // the stop it shrinks back to the car.
    const room = drive.mode === 'pull-past' ? MAX_LENGTH : Math.min(MAX_LENGTH, remaining)
    const target = active ? room * clamp(remaining / SHRINK, 0, 1) * moving : 0
    this.length += (target - this.length) * (1 - Math.exp(-dt * 6))
    this.length = Math.min(this.length, MAX_LENGTH * clamp(remaining / SHRINK, 0, 1), drive.mode === 'pull-past' ? MAX_LENGTH : remaining)
    this.mesh.visible = active && this.length > 0.07
  }

  draw(drive: Drive) {
    if (!this.mesh.visible) return
    const street = drive.onStreet ? drive.street : undefined
    const reverse = drive.mode === 'reverse'
    const exiting = drive.mode === 'exiting'
    const path = drive.motionPath
    const length = this.length
    this.mesh.visible = length > 0.07
    if (!this.mesh.visible) return
    // Pulling past the bay: beyond the stop the stripe curves toward the bay.
    const bay = drive.selectedBay
    const pullPast = drive.mode === 'pull-past'
    const stop = pullPast ? drive.approachRemaining : Infinity
    let side = 0
    if (pullPast && bay) {
      const [lx, lz] = left(drive.pose.h)
      side = Math.sign(dot([bay.center[0] - drive.pose.x, bay.center[1] - drive.pose.z], [lx, lz])) || 1
    }
    const stopPose = pullPast ? drive.lanePose(drive.station + stop) : drive.pose
    const beyond = (d: number) => {
      // Curvature eases in over the first 1.5 m past the stop.
      const ramp = Math.min(d, 1.5)
      const eased = integrate(stopPose, ramp, side / NEXT_RADIUS / 2)
      return d > ramp ? integrate(eased, d - ramp, side / NEXT_RADIUS) : eased
    }
    // The stripe starts at the leading bumper.
    const along = reverse ? REAR : FRONT
    for (let i = 0; i <= SEGMENTS; i++) {
      const s = length * i / SEGMENTS
      const pose: Pose = i === 0 ? drive.pose : street ? street.preview(s + FRONT) : reverse && path ? pathPoint(path, drive.pathDistance + s) :
        exiting && path ? pathPoint(path, drive.pathDistance - s) : s > stop ? beyond(s - stop) : drive.lanePose(drive.station + s)
      const half = HALF_BAND * (1 - (street ? 0.12 : TAPER) * i / SEGMENTS)
      const shift = 0
      for (let edge = 0; edge < 2; edge++) {
        const offset = (edge - 0.5) * 2 * (half + FEATHER)
        const [x, z] = localPoint(pose, street && i > 0 ? 0 : along, offset + shift)
        this.positions.set([x, 0.032, z], i * 6 + edge * 3)
        this.lateral.set([offset, half], i * 4 + edge * 2)
      }
    }
    this.material.uniforms.length.value = length
    this.material.uniforms.blue.value.set(street ? '#2872ba' : '#1f7bff')
    this.material.uniforms.city.value = street ? 1 : 0
    this.geometry.getAttribute('position').needsUpdate = true
    this.geometry.getAttribute('band').needsUpdate = true
  }
}
