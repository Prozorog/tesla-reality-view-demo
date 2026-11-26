import { localPoint, wrapAngle } from './geometry.ts'
import type { Bay, Lot, Point, Pose } from './lot.ts'
import type { SfMap } from './sf-map.ts'

/** Lay the parking loop in the approach's local frame. The marks face the lagoon. */
export function createSfLot(map: SfMap): Lot & { start: Pose } {
  const access = map.segments.at(-1)!.points
  const [x, z] = access.at(-1)!, [px, pz] = access.at(-2)!
  const h = Math.atan2(pz - z, x - px)
  const start = { x, z, h }
  const world = (along: number, across: number) => localPoint(start, along, across)
  const north = -9, south = 27, west = -26, east = 0, radius = 6.25
  const corners: [Point, number][] = [
    [[south - radius, east - radius], Math.PI / 2], [[south - radius, west + radius], 0],
    [[north + radius, west + radius], -Math.PI / 2], [[north + radius, east - radius], -Math.PI],
  ]
  const route = [world(0, 0)]
  for (const [[along, across], startAngle] of corners) {
    for (let i = 0; i <= 28; i++) {
      const theta = startAngle - i * Math.PI / 56
      route.push(world(along + radius * Math.cos(theta), across + radius * Math.sin(theta)))
    }
  }
  const aisles = [
    { id: 'lagoon', points: [world(south, east - radius), world(south, west + radius)], oneWay: true },
    { id: 'entrance', points: [world(north + radius, east), world(south - radius, east)], oneWay: true },
    { id: 'return', points: [world(south - radius, west), world(north + radius, west)], oneWay: true },
  ]
  const bays: Bay[] = [-3.25, -6.4, -9.55, -12.7, -15.85, -19.0].map((offset, index) => {
    const center = world(south - 7.5, offset)
    const taken = index >= 4
    return { id: `B${201 + index}`, row: 'Lagoon', center, heading: wrapAngle(h - 0.015), width: 3.15, depth: 5.65,
      kind: 'straight', taken, ...(taken ? { car: {
        type: index === 4 ? 'sedan' : 'hatchback', color: index === 4 ? 'silver' : 'darkblue', dx: 0, dz: 0, dh: 0, noseIn: false,
      } } : {}) }
  })
  const lamps = [world(12, 2.2), world(22, -23), world(-4, -17)].map(pos => ({ pos, height: 5.3, arms: 1 }))
  return {
    seed: 7, start, size: [31, 40], aisles, route, entrance: { pos: [x, z], heading: h }, bays, lamps,
    kerbs: [], hatches: [], arrows: [], trees: [], bollards: [], corrals: [],
    building: { outline: [], height: 0, canopyDepth: 0, sign: '', doors: [] }, street: { z: z - 12, from: x - 26, to: x + 18 },
  }
}
