import { AdditiveBlending, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three'
import type { Object3D, Texture } from 'three'
import { canvasTexture } from '../assets/boxes.ts'
import { clamp, localPoint } from '../simulation/geometry.ts'
import type { Lot, Pose } from '../simulation/lot.ts'

const plane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2)
const CAR_DECAL_Y = 0.015
const POOL_Y = 0.009
const THROW = 9
const BEAM_WIDTH = 4.6
type Footprint = { front: number; rear: number; width: number; height: number }

function smooth(from: number, to: number, value: number) {
  const t = clamp((value - from) / (to - from), 0, 1)
  return t * t * (3 - 2 * t)
}

function poolTexture(sample: (u: number, v: number) => number) {
  return canvasTexture(128, 64, ctx => {
    const image = ctx.createImageData(128, 64)
    image.data.fill(255)
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        image.data[(y * image.width + x) * 4 + 3] =
          Math.round(255 * clamp(sample(x / (image.width - 1), y / (image.height - 1)), 0, 1))
      }
    }
    ctx.putImageData(image, 0, 0)
  })
}

function contactTexture() {
  return canvasTexture(64, 64, ctx => {
    const image = ctx.createImageData(64, 64)
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const distance = Math.hypot((x - 31.5) / 31.5, (y - 31.5) / 31.5)
        const edge = Math.min(1, Math.max(0, (distance - 0.43) / 0.57))
        image.data[(y * image.width + x) * 4 + 3] = Math.round(255 * (1 - edge * edge * (3 - 2 * edge)))
      }
    }
    ctx.putImageData(image, 0, 0)
  })
}

export class VehicleDecals {
  private readonly contact = contactTexture()
  private readonly beams = poolTexture((u, v) => {
    const distance = THROW * u
    const side = BEAM_WIDTH * (v - 0.5)
    const centre = 0.47 + 0.06 * distance
    const spread = 0.27 + 0.16 * distance
    const lobes = Math.exp(-(((side - centre) / spread) ** 2)) +
      Math.exp(-(((side + centre) / spread) ** 2))
    return 0.75 * lobes * smooth(0, 1.5, distance) * (1 - smooth(2.4, THROW, distance)) *
      (1 - smooth(1.3, BEAM_WIDTH / 2, Math.abs(side)))
  })
  private readonly spill = poolTexture((u, v) => {
    const side = Math.abs(2 * v - 1)
    return smooth(0, 0.13, u) * (1 - smooth(0.19, 1, u)) *
      (1 - smooth(0.23 + u * 0.16, 1, side))
  })

  private shadow(opacity: number) {
    return new MeshBasicMaterial({ map: this.contact, color: '#03040a', transparent: true, depthWrite: false, opacity })
  }

  parkedShadows(count: number) {
    const batch = new InstancedMesh(plane, this.shadow(0.86), count)
    batch.frustumCulled = false
    batch.renderOrder = 0
    batch.name = 'parked_contact_shadows'
    return batch
  }

  parkedMatrix(pose: Pose, length: number, width: number, lamp?: Lot['lamps'][number]) {
    const dx = pose.x - (lamp?.pos[0] ?? pose.x), dz = pose.z - (lamp?.pos[1] ?? pose.z)
    const offset = Math.min(0.44, 0.29 / (lamp?.height ?? 1) * Math.hypot(dx, dz))
    const away = Math.atan2(dz, dx)
    return new Matrix4().makeRotationY(pose.h)
      .scale(new Vector3(length * 1.23, 1, width * 1.52))
      .setPosition(pose.x + offset * Math.cos(away), CAR_DECAL_Y, pose.z + offset * Math.sin(away))
  }

  private add(root: Object3D, material: MeshBasicMaterial, x: number, y: number, length: number, width: number) {
    const mesh = new Mesh(plane, material)
    mesh.position.set(x, y, 0)
    mesh.scale.set(length, 1, width)
    root.add(mesh)
    return mesh
  }

  private pool(root: Object3D, bumper: number, length: number, width: number, color: string, opacity: number, forward = false) {
    const material = new MeshBasicMaterial({
      map: forward ? this.beams : this.spill, color, opacity, transparent: true, depthWrite: false, blending: AdditiveBlending,
    })
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', `
        #ifdef USE_FOG
          gl_FragColor.a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
        #endif
      `)
    }
    const mesh = this.add(root, material, bumper + (forward ? 0.5 : -0.5) * length, POOL_Y, length, width)
    if (!forward) mesh.rotation.y = Math.PI
    mesh.renderOrder = 1
    return mesh
  }

  moving(root: Object3D, length: number, width: number, front = length / 2, rear = -length / 2) {
    const shadow = this.add(root, this.shadow(0.77), (front + rear) / 2, CAR_DECAL_Y, length * 1.19, width * 1.44)
    const head = this.pool(root, front, THROW, BEAM_WIDTH, '#ffc895', 0.064, true)
    const brake = this.pool(root, rear, 2, width * 1.32, '#ff2645', 0.22)
    return { shadow, head, brake }
  }

  player(root: Object3D, world: Object3D, footprint: Footprint) {
    const { front, rear, width, height } = footprint
    const length = front - rear, center = (front + rear) / 2
    this.add(root, this.shadow(0.77), center, CAR_DECAL_Y, length * 1.19, width * 1.44)
    const cast = this.add(world, this.shadow(0.36), 0, CAR_DECAL_Y - 0.001, 1, 1)
    const updateShadow = (pose: Pose, lamps: Lot['lamps']) => {
      const [x, z] = localPoint(pose, center, 0)
      let dx = 0, dz = 0, total = 0
      for (const lamp of lamps) {
        const awayX = x - lamp.pos[0], awayZ = z - lamp.pos[1]
        const weight = 1 / (1 + (awayX * awayX + awayZ * awayZ) / (lamp.height * lamp.height)) ** 4
        dx += weight * awayX * height * 1.32 / lamp.height
        dz += weight * awayZ * height * 1.32 / lamp.height
        total += weight
      }
      if (total > 0) { dx /= total; dz /= total }
      const stretch = Math.min(3.8, Math.hypot(dx, dz))
      const heading = Math.atan2(-dz, dx)
      cast.position.set(x + Math.cos(heading) * stretch * 0.68, CAR_DECAL_Y - 0.001, z - Math.sin(heading) * stretch * 0.68)
      cast.rotation.y = heading
      cast.scale.set(width * 1.18 + stretch * 2.32, 1, width * 1.32)
      cast.material.opacity = Math.min(0.49, total * 0.73) * Math.min(1, stretch / 0.58)
    }
    return { updateShadow }
  }
}

export function disposeDecals(decals: Record<string, Mesh<PlaneGeometry, MeshBasicMaterial>>) {
  for (const { material } of Object.values(decals)) material.dispose()
}
