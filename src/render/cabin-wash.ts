import { Color, Vector3, Vector4 } from 'three'
import type { Object3D, PerspectiveCamera } from 'three'
import { editShader, standardMeshes } from '../assets/gltf.ts'
import { clamp, localPoint } from '../simulation/geometry.ts'
import type { Lot, Pose } from '../simulation/lot.ts'

type Lamp = Lot['lamps'][number]

export class CabinWash {
  private readonly points = [new Vector4(), new Vector4()]
  private readonly sample = new Vector3()

  constructor(root: Object3D, private readonly lamps: Lot['lamps']) {
    const color = new Color('#ffe9d9')
    const materials = new Set(standardMeshes(root).map(mesh => mesh.material))
    for (const material of materials) {
      if (material.name === 'Mirror glass') continue
      // Three lights are shared by every material in the view. Bind these two
      // point sources to the cabin materials to preserve the lot's baked light.
      editShader(material, 'cabin-wash', shader => {
        shader.uniforms.cabinLamps = { value: this.points }
        shader.uniforms.cabinLampColor = { value: color }
        shader.fragmentShader = 'uniform vec4 cabinLamps[2]; uniform vec3 cabinLampColor;\n' +
          shader.fragmentShader.replace('#include <lights_fragment_end>', `
            for (int lampIndex = 0; lampIndex < 2; lampIndex++) {
              vec4 lamp = cabinLamps[lampIndex];
              if (lamp.w > 0.0) {
                vec3 ray = lamp.xyz - geometryPosition;
                float distanceSquared = dot(ray, ray);
                IncidentLight wash;
                wash.direction = ray * inversesqrt(max(distanceSquared, 0.01));
                wash.color = cabinLampColor * lamp.w / (0.85 + 1.6 * distanceSquared);
                wash.visible = true;
                RE_Direct(wash, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
              }
            }
            #include <lights_fragment_end>
          `)
      })
    }
  }

  update(pose: Pose, camera: PerspectiveCamera) {
    const [x, z] = localPoint(pose, 1.85, 0)
    let nearest: Lamp | undefined, next: Lamp | undefined
    let distance = Infinity, nextDistance = Infinity
    for (const lamp of this.lamps) {
      const d = (lamp.pos[0] - x) ** 2 + (lamp.pos[1] - z) ** 2
      if (d < distance) {
        next = nearest
        nextDistance = distance
        nearest = lamp
        distance = d
      } else if (d < nextDistance) {
        next = lamp
        nextDistance = d
      }
    }
    this.place(this.points[0], nearest, distance, x, z, camera)
    this.place(this.points[1], next, nextDistance, x, z, camera)
  }

  private place(point: Vector4, lamp: Lamp | undefined, distance: number, x: number, z: number, camera: PerspectiveCamera) {
    const strength = lamp ? clamp(1 - distance / (1.6 * lamp.height) ** 2, 0, 1) ** 3 : 0
    if (!lamp || strength === 0) {
      point.w = 0
      return
    }
    // The roof and windscreen spread the source. Bringing it closer lets the
    // moving light sweep across the cabin instead of lifting its exposure.
    this.sample.set(x + (lamp.pos[0] - x) * 0.28, 1.93, z + (lamp.pos[1] - z) * 0.28)
      .applyMatrix4(camera.matrixWorldInverse)
    point.set(this.sample.x, this.sample.y, this.sample.z, strength * 3.2)
  }
}
