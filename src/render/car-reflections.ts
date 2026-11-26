import {
  BackSide, Color, CubeCamera, HalfFloatType, InstancedMesh, LinearFilter, Matrix4, Mesh, MeshBasicMaterial, Scene,
  SphereGeometry, Vector3, WebGLCubeRenderTarget,
} from 'three'
import type { MeshStandardMaterial, Object3D, WebGLRenderer } from 'three'
import { standardMeshes } from '../assets/gltf.ts'
import { CENTER_OFFSET, localPoint } from '../simulation/geometry.ts'
import type { Lot, Pose } from '../simulation/lot.ts'

const PROBE_STRIDE = 6
const PROBE_HEIGHT = 1.28

export class CarReflections {
  private readonly scene = new Scene()
  private readonly target = new WebGLCubeRenderTarget(64, { type: HalfFloatType, minFilter: LinearFilter })
  private readonly camera = new CubeCamera(0.15, 110, this.target)
  private readonly position = new Vector3()
  private ready = false

  constructor(lot: Lot, world: Object3D, reflectors: MeshStandardMaterial[], private readonly live: boolean) {
    this.scene.background = new Color(0.051, 0.065, 0.090)
    // Capture the lit storefront and lamp positions without submitting six
    // views of the baked ground, vehicles and landscaping per refresh.
    for (const mesh of standardMeshes(world)) {
      if (!/^(Shop_display_glass|Canopy_luminaires|Sign_)/.test(mesh.name)) continue
      const material = new MeshBasicMaterial({
        color: mesh.material.emissive.clone().multiplyScalar(mesh.material.emissiveIntensity * 0.72),
        map: mesh.material.emissiveMap, side: mesh.material.side, toneMapped: false,
      })
      const emitter = new Mesh(mesh.geometry, material)
      emitter.matrixAutoUpdate = false
      emitter.matrix.copy(mesh.matrixWorld)
      this.scene.add(emitter)
    }
    // The hot optic and its softer halo survive filtering at different roughnesses.
    const count = lot.lamps.reduce((sum, lamp) => sum + lamp.arms, 0)
    const optic = new SphereGeometry(1, 10, 6)
    const heads = new InstancedMesh(optic, new MeshBasicMaterial({
      color: new Color('#fff1e6').multiplyScalar(195), toneMapped: false,
    }), count)
    const halos = new InstancedMesh(optic, new MeshBasicMaterial({
      color: new Color('#ffe9d9').multiplyScalar(23), side: BackSide, toneMapped: false,
    }), count)
    const matrix = new Matrix4()
    const position = new Vector3()
    let instance = 0
    for (const { pos: [x, z], height, arms } of lot.lamps) {
      for (let arm = 0; arm < arms; arm++) {
        const angle = arm * 2 * Math.PI / arms
        position.set(x + Math.sin(angle) * 0.94, height - 0.15, z + Math.cos(angle) * 0.94)
        matrix.makeScale(0.35, 0.15, 0.53).setPosition(position)
        heads.setMatrixAt(instance, matrix)
        // A back-facing shell adds the halo around the core without obscuring it.
        matrix.makeScale(0.95, 0.46, 1.16).setPosition(position)
        halos.setMatrixAt(instance++, matrix)
      }
    }
    this.scene.add(heads, halos)
    for (const material of reflectors) material.envMap = this.target.texture
  }

  needsUpdate(pose: Pose, frame: number) {
    if (this.live) {
      const [x, z] = localPoint(pose, CENTER_OFFSET, 0)
      this.position.set(x, PROBE_HEIGHT, z)
    } else {
      this.position.set(0, PROBE_HEIGHT, 0)
    }
    const moved = this.camera.position.distanceToSquared(this.position)
    return !this.ready || this.live && (moved > 0.64 || moved > 0.0025 && frame % PROBE_STRIDE === 0)
  }

  capture(renderer: WebGLRenderer) {
    this.camera.position.copy(this.position)
    this.camera.update(renderer, this.scene)
    this.ready = true
  }
}
