import { distance } from './geometry.ts'
import type { Bay, Lot, ParkedCar } from './lot.ts'
import { pickPassenger, seededRandom } from './lot.ts'
import type { CruiseRoute } from './route.ts'

export const MARKER_RANGE = 25

export function addRuntimeCars(lot: Lot, route: CruiseRoute, seed: number, reservedId?: string) {
  const random = seededRandom(seed)
  const free = lot.bays.filter(bay => !bay.taken)
  const candidates = free.filter(bay => bay.id !== reservedId)
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }
  const coverage: Bay[][] = []
  for (let s = 0; s < route.length; s += 0.5) {
    const { x, z } = route.pose(s)
    coverage.push(free.filter(bay => distance(bay.center, [x, z]) <= MARKER_RANGE - 0.25))
  }
  const count = 6 + Math.floor(random() * 3)
  const cars = new Map<string, ParkedCar>()
  for (const bay of candidates) {
    if (cars.size === count) break
    if (coverage.some(group => group.includes(bay) && group.filter(other => !cars.has(other.id)).length <= 5)) continue
    cars.set(bay.id, {
      ...pickPassenger(random), noseIn: random() < (bay.kind === 'angled' ? 0.2 : 0.65),
    })
  }
  return cars
}
