import manifest from '../../public/models/cars.json' with { type: 'json' }

export type Point = [x: number, z: number]
export type Pose = { x: number; z: number; h: number }
export type CarType = 'sedan' | 'wagon' | 'hatchback' | 'compact' | 'coupe' | 'minivan' | 'pickup' | 'suv' | 'offroad'
export type CarColor = 'white' | 'silver' | 'black' | 'darkgrey' | 'darkblue' | 'red'
export type ParkedCar = { type: CarType; color: CarColor; dx: number; dz: number; dh: number; noseIn: boolean }
export type Bay = {
  id: string
  center: Point
  heading: number
  width: number
  depth: number
  kind: 'angled' | 'straight' | 'accessible' | 'corral'
  row: string
  taken: boolean
  car?: ParkedCar
}
export type Lot = {
  seed: number
  size: Point
  aisles: { id: string; points: Point[]; oneWay: boolean }[]
  route: Point[]
  entrance: { pos: Point; heading: number }
  start?: Pose
  bays: Bay[]
  lamps: { pos: Point; height: number; arms: number }[]
  kerbs: { id: string; outline: Point[]; kind: 'island' | 'sidewalk' | 'hedge' }[]
  hatches: { outline: Point[] }[]
  arrows: { pos: Point; heading: number }[]
  trees: Point[]
  bollards: Point[]
  corrals: string[]
  building: { outline: Point[]; height: number; canopyDepth: number; sign: string; doors: Point[] }
  street: { z: number; from: number; to: number }
}

export const carTypes = Object.keys(manifest.types) as CarType[]
export const carCatalog = manifest.types
export const carColors = manifest.palette
const carFootprints = carTypes.map(type => {
  const { length, width } = carCatalog[type]
  return { length, width }
})

export function seededRandom(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 2 ** 32
  }
}

export function parkedPose(bay: Bay, car: ParkedCar): Pose {
  return { x: bay.center[0] + car.dx, z: bay.center[1] + car.dz, h: bay.heading + car.dh + (car.noseIn ? Math.PI : 0) }
}

export function pickPassenger(random: () => number): ParkedCar {
  const type = carTypes[Math.floor(random() * carTypes.length)]
  const variants = carCatalog[type].variants
  return { type, color: variants[Math.floor(random() * variants.length)].color as CarColor, dx: 0, dz: 0, dh: 0, noseIn: true }
}

// Centred runtime cars can have any of these rectangles. Stacked together
// they cover the longest and widest types without adding fictitious corners.
export const runtimeCarEnvelope = carFootprints.filter(shape => !carFootprints.some(other =>
  other !== shape && other.length >= shape.length && other.width >= shape.width,
))
