import {
  Color, DoubleSide, DynamicDrawUsage, ExtrudeGeometry, InstancedBufferAttribute, InstancedMesh, Mesh,
  MeshBasicMaterial, Object3D, PlaneGeometry, ShaderMaterial, Shape, Vector3, Group,
} from 'three'
import type { PerspectiveCamera } from 'three'
import { canvasTexture } from '../assets/boxes.ts'
import type { Drive } from '../simulation/drive.ts'
import { ease } from './dive.ts'
import { MARKER_RANGE } from '../simulation/occupancy.ts'
import { CENTER_OFFSET, lerp, localPoint } from '../simulation/geometry.ts'
import type { Bay, Lot } from '../simulation/lot.ts'

export const CHEVRON_RANGE = 35
export const MARKER_GROUND = 0.054
export type VisibleBayMarker = { id: string; x: number; y: number; radius: number; chevron: boolean }

function entrance(bay: Bay) {
  return localPoint({ x: bay.center[0], z: bay.center[1], h: bay.heading }, bay.depth * 0.5 - 0.38, 0)
}

export function markerAnchor(bay: Bay, blend: number) {
  const [x, z] = entrance(bay)
  return blend >= 0.5 ? [bay.center[0], MARKER_GROUND, bay.center[1]] as const :
    [lerp(x, bay.center[0], blend), lerp(0.59, MARKER_GROUND, blend), lerp(z, bay.center[1], blend)] as const
}

function chevronFinish(top: string, edge: string) {
  return [top, edge].map(color => {
    const material = new MeshBasicMaterial({ color, transparent: true, depthWrite: false })
    // Per-instance fade: near the camera and at the picture edge.
    material.onBeforeCompile = shader => {
      shader.vertexShader = 'attribute float chevronFade;\nvarying float vChevronFade;\n' +
        shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvChevronFade = chevronFade;')
      shader.fragmentShader = 'varying float vChevronFade;\n' +
        shader.fragmentShader.replace('#include <opaque_fragment>', 'diffuseColor.a *= vChevronFade;\n#include <opaque_fragment>')
    }
    material.customProgramCacheKey = () => 'chevron-fade'
    return material
  })
}

// Clip B's chosen-bay stack: three thin V strokes, pale core, soft blue glow.
// Plane units are metres; the stack is 0.9 m wide and about 1 m tall.
const STACK_WIDTH = 1.5, STACK_HEIGHT = 1.6
function stackMaterial() {
  return new ShaderMaterial({
    transparent: true, depthWrite: false, side: DoubleSide,
    uniforms: { opacity: { value: 1 }, core: { value: new Color('#e6f7ff') }, halo: { value: new Color('#2f8cff') } },
    vertexShader: `
      varying vec2 local;
      void main() {
        local = (uv - 0.5) * vec2(${STACK_WIDTH.toFixed(2)}, ${STACK_HEIGHT.toFixed(2)});
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 local;
      uniform float opacity;
      uniform vec3 core;
      uniform vec3 halo;
      float segment(vec2 p, vec2 a, vec2 b) {
        vec2 pa = p - a, ba = b - a;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        return length(pa - ba * h);
      }
      void main() {
        // Stroke 0.12 m (13 % of the 0.9 m width), gap about one stroke.
        const float HALF = 0.06, ARM = 0.42, DROP = 0.36, PITCH = 0.27;
        float d = 1e3;
        for (int i = 0; i < 3; i++) {
          vec2 tip = vec2(0.0, -0.47 + PITCH * float(i));
          d = min(d, segment(local, tip, tip + vec2(-ARM, DROP)));
          d = min(d, segment(local, tip, tip + vec2(ARM, DROP)));
        }
        float aa = fwidth(d) * 0.9;
        float stroke = 1.0 - smoothstep(HALF - aa, HALF + aa, d);
        float glow = exp(-max(d - HALF, 0.0) / 0.075);
        float hot = 1.0 - smoothstep(0.0, HALF, d);
        vec3 colour = mix(halo, core, stroke) + 0.25 * hot * core;
        gl_FragColor = vec4(colour, opacity * max(stroke, 0.62 * glow));
        #include <colorspace_fragment>
      }
    `,
  })
}

function chevronGeometry() {
  const chevron = new Shape()
  chevron.moveTo(-0.58, 0.28)
  chevron.lineTo(0, -0.09)
  chevron.lineTo(0.58, 0.28)
  chevron.lineTo(0.58, 0.05)
  chevron.lineTo(0, -0.34)
  chevron.lineTo(-0.58, 0.05)
  chevron.closePath()
  return new ExtrudeGeometry(chevron, { depth: 0.079, bevelEnabled: true, bevelThickness: 0.019, bevelSize: 0.019, bevelSegments: 1 })
}

function tileTexture() {
  return canvasTexture(128, 128, ctx => {
    ctx.beginPath()
    ctx.roundRect(1, 1, 126, 126, 24)
    ctx.fillStyle = '#9fb4c8'
    ctx.fill()
    ctx.strokeStyle = '#f7fbff'
    ctx.lineWidth = 3.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.arc(64, 64, 22, 0, 2 * Math.PI)
    ctx.moveTo(43, 59)
    ctx.lineTo(55, 65)
    ctx.quadraticCurveTo(64, 70, 73, 65)
    ctx.lineTo(85, 59)
    ctx.moveTo(64, 69)
    ctx.lineTo(64, 85)
    ctx.stroke()
  })
}

export class BayMarkers {
  readonly root = new Group()
  readonly visible: VisibleBayMarker[] = []
  private readonly tiles: Map<string, Mesh<PlaneGeometry, MeshBasicMaterial>>
  private readonly chevrons: InstancedMesh<ExtrudeGeometry, MeshBasicMaterial[]>
  private readonly transform = new Object3D()
  private readonly white = new Color('#ffffff')
  private readonly shaded = new Color('#edf4ff')
  private readonly stack = new Mesh(new PlaneGeometry(STACK_WIDTH, STACK_HEIGHT), stackMaterial())
  private readonly fades: InstancedBufferAttribute
  private readonly probe = new Vector3()
  private readonly probeTop = new Vector3()

  private showMarker(camera: PerspectiveCamera, id: string, x: number, y: number, z: number, width: number, chevron: boolean) {
    const centre = this.probe.set(x, y, z).project(camera)
    if (centre.z < -1 || centre.z >= 1 || Math.abs(centre.x) > 1 || Math.abs(centre.y) > 1) return
    const matrix = camera.matrixWorld.elements
    const edge = this.probeTop.set(x + matrix[0] * width, y + matrix[1] * width, z + matrix[2] * width).project(camera)
    this.visible.push({ id, x: centre.x, y: centre.y, radius: Math.abs(edge.x - centre.x), chevron })
  }
  private readonly outline = new Mesh(new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { width: { value: 1 }, depth: { value: 1 }, tint: { value: new Color('#3e8bff') } },
    vertexShader: `
      varying vec2 coord;
      void main() {
        coord = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 coord;
      uniform float width;
      uniform float depth;
      uniform vec3 tint;
      void main() {
        vec2 edge = (abs(coord - 0.5) - 0.5) * vec2(depth, width) + 0.19;
        float distance = length(max(edge, 0.0)) + min(max(edge.x, edge.y), 0.0);
        float core = 1.0 - smoothstep(0.019, 0.031, abs(distance));
        float halo = 1.0 - smoothstep(0.01, 0.17, abs(distance));
        gl_FragColor = vec4(tint, 0.76 * core + 0.21 * halo + 0.11 * step(distance, 0.0));
        #include <colorspace_fragment>
      }
    `,
  }))

  constructor(lot: Lot) {
    const bevel = chevronGeometry()
    const plate = new PlaneGeometry(1.6, 1.6).rotateX(-Math.PI / 2).rotateY(Math.PI / 2)
    const tileMap = tileTexture()
    this.tiles = new Map(lot.bays.filter(bay => !bay.taken).map(bay => {
      const tile = new Mesh(plate, new MeshBasicMaterial({ map: tileMap, transparent: true, depthWrite: false }))
      tile.renderOrder = 4
      tile.rotation.y = bay.heading
      this.root.add(tile)
      return [bay.id, tile]
    }))
    this.fades = new InstancedBufferAttribute(new Float32Array(this.tiles.size), 1).setUsage(DynamicDrawUsage)
    bevel.setAttribute('chevronFade', this.fades)
    this.chevrons = new InstancedMesh(bevel, chevronFinish('#ffffff', '#a6b5cc'), this.tiles.size)
    this.chevrons.frustumCulled = false
    this.chevrons.renderOrder = 4
    this.chevrons.count = 0
    this.stack.renderOrder = 6
    this.stack.frustumCulled = false
    this.outline.renderOrder = 3
    this.root.add(this.outline, this.chevrons, this.stack)
  }

  /** Fade for a free-bay chevron: gone within 6 m of the camera and at the picture edge, never above 8 % of its height. */
  private screenFit(camera: PerspectiveCamera, x: number, y: number, z: number) {
    const distance = camera.position.distanceTo(this.probe.set(x, y, z))
    const near = Math.min(1, Math.max(0, (distance - 6) / 3))
    if (near <= 0) return { fade: 0, scale: 0 }
    this.probe.project(camera)
    this.probeTop.set(x, y + 0.62, z).project(camera)
    const height = Math.abs(this.probeTop.y - this.probe.y) / 2
    const scale = Math.min(1, 0.045 / Math.max(height, 1e-4))
    const margin = 0.045 * scale * 2 + 0.06
    const inside = Math.min(1 - Math.abs(this.probe.x), 1 - Math.abs(this.probe.y)) - margin
    const edge = Math.min(1, Math.max(0, inside / 0.06))
    return { fade: this.probe.z < 1 ? near * edge : 0, scale }
  }

  draw(drive: Drive, camera: PerspectiveCamera, parking: number, fade: number, hover?: string) {
    camera.updateMatrixWorld()
    this.visible.length = 0
    const blend = ease(parking)
    const selected = drive.selectedBay
    const chevronOpacity = (1 - blend) * Math.max(0, (fade - 0.41) / 0.59)
    let count = 0
    for (const bay of drive.lot.bays) {
      const tile = this.tiles.get(bay.id)
      if (!tile) continue
      const [x, z] = bay.center
      const distance = Math.hypot(x - drive.pose.x, z - drive.pose.z)
      const available = bay !== selected && drive.traffic.isAvailable(bay.id)
      const bright = hover === bay.id && drive.canChoose
      const scale = bright ? 1.12 : 1
      if (available && distance <= CHEVRON_RANGE && chevronOpacity > 0.007) {
        const [mx, my, mz] = markerAnchor(bay, Math.min(blend, 0.499))
        const fit = this.screenFit(camera, mx, my, mz)
        if (fit.fade > 0.01) {
          this.transform.position.set(mx, my, mz)
          this.transform.rotation.y = Math.atan2(camera.position.x - mx, camera.position.z - mz)
          this.transform.scale.setScalar(scale * fit.scale)
          this.transform.updateMatrix()
          this.chevrons.setMatrixAt(count, this.transform.matrix)
          this.fades.setX(count, fit.fade)
          this.chevrons.setColorAt(count++, bright ? this.white : this.shaded)
          if (fit.fade * chevronOpacity > 0.12) this.showMarker(camera, bay.id, mx, my, mz, 0.65 * scale * fit.scale, true)
        }
      }
      tile.visible = available && distance <= MARKER_RANGE && blend > 0.005
      if (tile.visible) {
        tile.position.set(x, MARKER_GROUND, z)
        tile.scale.setScalar(scale)
        tile.material.opacity = (bright ? 1 : 0.70) * blend * fade
        if (blend >= 0.5) this.showMarker(camera, bay.id, x, MARKER_GROUND, z, 0.86 * scale, false)
      }
    }
    this.chevrons.count = count
    this.chevrons.instanceMatrix.needsUpdate = true
    this.fades.needsUpdate = true
    if (this.chevrons.instanceColor) this.chevrons.instanceColor.needsUpdate = true
    for (const material of this.chevrons.material) material.opacity = chevronOpacity
    this.stack.visible = !!selected && drive.mode !== 'parked' && drive.mode !== 'exiting'
    if (selected && this.stack.visible) {
      const [ex, ez] = entrance(selected)
      const x = lerp(ex, selected.center[0], 0.45), z = lerp(ez, selected.center[1], 0.45)
      this.stack.position.set(x, 1.5 + 0.1 * Math.sin(drive.time * 2.2), z)
      // Face the camera around the vertical axis; lean back a little from steep views so it never goes edge-on.
      const dx = camera.position.x - x, dz = camera.position.z - z
      const elevation = Math.atan2(camera.position.y - this.stack.position.y, Math.hypot(dx, dz))
      this.stack.rotation.set(0, 0, 0)
      this.stack.rotation.order = 'YXZ'
      this.stack.rotation.y = Math.atan2(dx, dz)
      this.stack.rotation.x = -0.55 * Math.max(0, elevation)
      // Gone once the car is arriving in the bay (clip B b17 has no stack).
      const [cx, cz] = localPoint(drive.pose, CENTER_OFFSET, 0)
      const arrival = Math.min(1, Math.max(0, (Math.hypot(cx - x, cz - z) - 5) / 3))
      this.stack.material.uniforms.opacity.value = (1 - 0.3 * blend) * arrival
      this.stack.visible = arrival > 0.01
    }
    this.outline.visible = !!selected
    if (selected) {
      const width = selected.width + 0.38, depth = selected.depth + 0.38
      this.outline.position.set(selected.center[0], MARKER_GROUND - 0.003, selected.center[1])
      this.outline.rotation.y = selected.heading
      this.outline.scale.set(depth, 1, width)
      this.outline.material.uniforms.width.value = width
      this.outline.material.uniforms.depth.value = depth
    }
  }
}
