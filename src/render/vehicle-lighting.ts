import { Color, Vector2 } from 'three'
import type { MeshStandardMaterial } from 'three'
import { editShader } from '../assets/gltf.ts'
import type { SfStreetLamp } from '../assets/sf-furniture.ts'
import type { Lot, Pose } from '../simulation/lot.ts'
import { finishNight } from './night-light.ts'

export const probeSides = ['roof', 'nose', 'tail', 'left', 'right'] as const
export type ProbeSide = typeof probeSides[number]
export type Probes = Record<ProbeSide, Color>
type VehicleProbes = Probes & { heading: Vector2 }

export function vehicleProbes() {
  const probes = Object.fromEntries(probeSides.map(side => [side, new Color(0, 0, 0)])) as Probes
  return Object.assign(probes, { heading: new Vector2(1, 0) })
}

export function shadeVehicle(material: MeshStandardMaterial, probes?: VehicleProbes, diffuseGain = 1) {
  finishNight(material, true)
  editShader(material, probes ? 'vehicle-probe-uniforms' : 'vehicle-probe-instances', shader => {
    shader.uniforms.vehicleDiffuseGain = { value: diffuseGain }
    const fields = probeSides.map(side => `vec3 diffuse_${side};`)
    if (probes) {
      for (const side of probeSides) shader.uniforms[`diffuse_${side}`] = { value: probes[side] }
    } else {
      shader.vertexShader = probeSides.map(side => `attribute vec3 probe_${side};`).join('\n') + '\n' +
        fields.map(field => `varying ${field}`).join('\n') + '\n' + shader.vertexShader
    }
    shader.vertexShader = 'varying vec3 vehicleNormal;\n' + shader.vertexShader.replace('#include <beginnormal_vertex>', `
      #include <beginnormal_vertex>
      vehicleNormal = objectNormal;
      ${probes ? '' : probeSides.map(side => `diffuse_${side} = probe_${side};`).join('\n')}
    `)
    shader.fragmentShader = 'varying vec3 vehicleNormal;\nuniform float vehicleDiffuseGain;\n' +
      fields.map(field => `${probes ? 'uniform' : 'varying'} ${field}`).join('\n') + '\n' +
      shader.fragmentShader.replace('#include <lights_fragment_end>', `
        #include <lights_fragment_end>
        vec3 n = normalize(vehicleNormal);
        vec3 sampleX = n.x >= 0.0 ? diffuse_nose : diffuse_tail;
        vec3 sampleY = n.y >= 0.0 ? diffuse_roof : vec3(0.022, 0.025, 0.035);
        vec3 sampleZ = n.z < 0.0 ? diffuse_left : diffuse_right;
        vec3 sampledLight = sampleX * n.x * n.x + sampleY * n.y * n.y + sampleZ * n.z * n.z;
        // Keep the direct lamp tint. The extra neutral fill follows the surface:
        // light from the overhead lamps falls off as a panel turns under, so the
        // shoulders stay bright and the lower doors and sills darken toward the ground.
        float luminance = dot(sampledLight, vec3(0.2126, 0.7152, 0.0722));
        float facing = clamp(0.5 + 0.5 * n.y, 0.0, 1.0);
        float overhead = dot(diffuse_roof, vec3(0.2126, 0.7152, 0.0722)) * (0.03 + 0.66 * pow(facing, 3.2));
        vec3 diffuseFill = sampledLight + vec3((0.62 * luminance + overhead) * (vehicleDiffuseGain - 1.0));
        reflectedLight.indirectDiffuse += diffuseColor.rgb * diffuseFill;
      `)
    // Steerable wheel primitives use their rotated normals. A car instance
    // already supplies local normals before its instance matrix is applied.
    if (probes) {
      shader.vertexShader = 'uniform vec2 vehicleHeading;\n' + shader.vertexShader.replace(
        'vehicleNormal = objectNormal;', `
        vec3 worldNormal = mat3(modelMatrix) * objectNormal;
        vec2 heading = vehicleHeading;
        vehicleNormal = vec3(dot(worldNormal.xz, vec2(heading.x, -heading.y)),
          worldNormal.y, dot(worldNormal.xz, heading.yx));
      `)
      shader.uniforms.vehicleHeading = { value: probes.heading }
    }
  })
}

const lampColor = new Color('#ffe9d9')
const skyColor = new Color(0.014, 0.019, 0.031)
const streetSkyColor = new Color(0.018, 0.028, 0.052)
const STREET_BIN_SIZE = 32
const STREET_BIN_REACH = 64
type StreetProbeLamp = Lot['lamps'][number] & { color: Color; range: number; gain: number }

export class LotLighting {
  private readonly streetLamps?: StreetProbeLamp[]
  private readonly streetBins = new Map<string, StreetProbeLamp[]>()
  private readonly streetColor = new Color()

  constructor(private readonly lot: Lot, streetLamps?: SfStreetLamp[]) {
    if (!streetLamps) return
    this.streetLamps = streetLamps.map(lamp => ({
      pos: [lamp.head[0], lamp.head[2]], height: lamp.head[1], arms: 1,
      color: new Color(lamp.kind === 'acorn' ? '#ffdab0' : '#ffe5c3'),
      range: lamp.kind === 'acorn' ? 25 : 36,
      gain: lamp.kind === 'acorn' ? 0.115 : 0.165,
    }))
    // Populate overlapping cells once, so each moving vehicle does one lookup.
    for (const lamp of this.streetLamps) {
      const fromX = Math.floor((lamp.pos[0] - STREET_BIN_REACH) / STREET_BIN_SIZE)
      const toX = Math.floor((lamp.pos[0] + STREET_BIN_REACH) / STREET_BIN_SIZE)
      const fromZ = Math.floor((lamp.pos[1] - STREET_BIN_REACH) / STREET_BIN_SIZE)
      const toZ = Math.floor((lamp.pos[1] + STREET_BIN_REACH) / STREET_BIN_SIZE)
      for (let x = fromX; x <= toX; x++) {
        for (let z = fromZ; z <= toZ; z++) {
          const key = `${x},${z}`, lamps = this.streetBins.get(key) ?? []
          lamps.push(lamp)
          this.streetBins.set(key, lamps)
        }
      }
    }
  }

  nearestLamp(x: number, z: number) {
    let distance = Infinity
    let nearest: Lot['lamps'][number] | undefined
    const candidates = this.streetLamps
      ? this.streetBins.get(`${Math.floor(x / STREET_BIN_SIZE)},${Math.floor(z / STREET_BIN_SIZE)}`) ?? this.streetLamps
      : this.lot.lamps
    for (const lamp of candidates) {
      const d = (lamp.pos[0] - x) ** 2 + (lamp.pos[1] - z) ** 2
      if (d < distance) {
        nearest = lamp
        distance = d
      }
    }
    // Parked-shadow requests outside the lit corridor still get the nearest
    // fixture. Ordinary street requests find it in the precomputed cell.
    if (this.streetLamps && candidates !== this.streetLamps && distance > STREET_BIN_REACH ** 2) {
      for (const lamp of this.streetLamps) {
        const d = (lamp.pos[0] - x) ** 2 + (lamp.pos[1] - z) ** 2
        if (d < distance) { nearest = lamp; distance = d }
      }
    }
    return nearest
  }

  sample(pose: Pose, probes: VehicleProbes) {
    if (this.streetLamps) return this.sampleStreet(pose, probes)
    probes.roof.copy(skyColor)
    for (const side of ['nose', 'tail', 'left', 'right'] as const) probes[side].copy(skyColor).multiplyScalar(0.55)
    const cos = Math.cos(pose.h), sin = Math.sin(pose.h)
    probes.heading.set(cos, sin)
    const color = new Color()
    for (const { pos, height } of this.lot.lamps) {
      const dx = pos[0] - pose.x, dz = pos[1] - pose.z
      const vertical = height - 0.8
      const horizontal = dx * dx + dz * dz
      const distance = Math.sqrt(horizontal + vertical * vertical)
      // Broad batwing optics, fitted to the baked parked-car probes: wide pools that overlap.
      const strength = 0.232 / (1 + 0.3 * horizontal / (height * height))
      if (strength < 0.009) continue
      const x = (cos * dx - sin * dz) / distance, z = (sin * dx + cos * dz) / distance
      probes.roof.add(color.copy(lampColor).multiplyScalar(strength * vertical / distance))
      probes[x >= 0 ? 'nose' : 'tail'].add(color.copy(lampColor).multiplyScalar(strength * Math.abs(x)))
      probes[z >= 0 ? 'right' : 'left'].add(color.copy(lampColor).multiplyScalar(strength * Math.abs(z)))
    }
    return probes
  }

  private sampleStreet(pose: Pose, probes: VehicleProbes) {
    probes.roof.copy(streetSkyColor)
    for (const side of ['nose', 'tail', 'left', 'right'] as const) probes[side].copy(streetSkyColor).multiplyScalar(0.6)
    const cos = Math.cos(pose.h), sin = Math.sin(pose.h)
    probes.heading.set(cos, sin)
    const lamps = this.streetBins.get(`${Math.floor(pose.x / STREET_BIN_SIZE)},${Math.floor(pose.z / STREET_BIN_SIZE)}`)
    if (!lamps) return probes
    for (const lamp of lamps) {
      const dx = lamp.pos[0] - pose.x, dz = lamp.pos[1] - pose.z
      const horizontal = dx * dx + dz * dz
      if (horizontal >= lamp.range * lamp.range) continue
      const vertical = Math.max(0.5, lamp.height - 0.8)
      const distance = Math.sqrt(horizontal + vertical * vertical)
      const edge = 1 - horizontal / (lamp.range * lamp.range)
      const strength = lamp.gain * edge * edge / (1 + 0.85 * horizontal / (lamp.height * lamp.height))
      const x = (cos * dx - sin * dz) / distance, z = (sin * dx + cos * dz) / distance
      probes.roof.add(this.streetColor.copy(lamp.color).multiplyScalar(strength * vertical / distance))
      probes[x >= 0 ? 'nose' : 'tail'].add(this.streetColor.copy(lamp.color).multiplyScalar(strength * Math.abs(x)))
      probes[z >= 0 ? 'right' : 'left'].add(this.streetColor.copy(lamp.color).multiplyScalar(strength * Math.abs(z)))
    }
    return probes
  }
}
