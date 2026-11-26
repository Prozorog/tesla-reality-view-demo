import { mkdir, writeFile } from 'node:fs/promises'
import { carCatalog, carTypes, seededRandom } from '../src/simulation/lot.ts'

const seed = 7
const random = seededRandom(seed)
const angle = 52 * Math.PI / 180
const aisleZ = [-17.65, -0.1, 17.25, 28.95]
const [north, middle, south, apron] = aisleZ
const west = -41.4
const east = 43.0
const innerEast = 37.4
// Two joined aisle loops keep the cruise between bay rows. The middle aisle
// is visited once by each loop, with the short end connectors beside the bays.
// Every corner retains the eased curvature ramps of phase 1.6.
const env = (key, value) => process.env[key] ? Number(process.env[key]) : value
const lane = { north: north - env('OFF1', 0), middle: middle + env('OFF2', 0), south: south - env('OFF3', 0), apron }
const eastX = env('EASTX', 42.3), innerEastX = env('INNERX', 37.0), westX = west
const entrance = { pos: [30, apron], heading: 0 }
const RAMP = env('RAMP', 2.6), STEP = 0.18
const jog = env('JOG', 0)
// A left turn through `theta` in a local frame (u ahead, v to the left).
function easedTurn(theta, radius, ramp) {
  const k = 1 / radius
  const hold = Math.max(0, theta / k - ramp)
  const total = 2 * ramp + hold
  const n = Math.ceil(total / 0.01)
  const points = [[0, 0]]
  let u = 0, v = 0, h = 0
  for (let i = 1; i <= n; i++) {
    const s = total * (i - 0.5) / n
    const curvature = s < ramp ? k * s / ramp : s > ramp + hold ? k * (total - s) / ramp : k
    const ds = total / n
    h += curvature * ds / 2
    u += Math.cos(h) * ds
    v += Math.sin(h) * ds
    h += curvature * ds / 2
    points.push([u, v])
  }
  return { points, total }
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]]
const unit = ([x, z]) => [x / Math.hypot(x, z), z / Math.hypot(x, z)]
const leftOf = ([x, z]) => [z, -x]
// Corners in driving order: [x, z, radius]; a pair marked `u` forms one 180° turn.
const corners = [
  { at: [eastX, lane.middle], radius: 6.4 }, { at: [eastX, lane.north], radius: 6.4 },
  { at: [westX, lane.north], radius: 6.4 }, { at: [westX, lane.middle], radius: 6.4 },
  // Swing a little wide (north) before the tight right turn between bay B089 and island K5.
  ...(jog ? [{ at: [env('JOGA', 21), lane.middle], radius: 14 }, { at: [env('JOGB', 28), lane.middle - jog], radius: 14 }] : []),
  { at: [innerEastX, lane.middle - jog], radius: env('RIN', 5.8), ramp: env('RAMPIN', 1.2) }, { at: [innerEastX, lane.south], radius: env('RIN', 5.8), ramp: env('RAMPIN', 1.2) },
  { at: [westX, lane.south], radius: 6.4 }, { at: [westX, lane.middle], radius: 6.4 },
]
const routeStart = [entrance.pos[0], lane.middle]
const route = [routeStart]
const straights = []
let previous = routeStart
for (let i = 0; i < corners.length; i++) {
  const corner = corners[i]
  const next = corners[i + 1]?.at ?? routeStart
  const dIn = unit(sub(corner.at, previous))
  let start, curve, sign, theta, radius
  if (corner.uTurnTo) {
    const across = sub(corner.uTurnTo, corner.at)
    sign = Math.sign(across[0] * leftOf(dIn)[0] + across[1] * leftOf(dIn)[1])
    const width = Math.hypot(...across)
    // Solve the radius that lands the 180° eased turn exactly on the opposite lane.
    let low = 4, high = width / 2
    for (let j = 0; j < 50; j++) {
      const r = (low + high) / 2
      const end = easedTurn(Math.PI, r, RAMP).points.at(-1)
      if (end[1] > width) high = r
      else low = r
    }
    radius = (low + high) / 2
    curve = easedTurn(Math.PI, radius, RAMP).points
    const reach = Math.max(...curve.map(p => p[0]))
    start = [corner.at[0] - dIn[0] * reach, corner.at[1] - dIn[1] * reach]
  } else {
    const dOut = unit(sub(next, corner.at))
    sign = Math.sign(dOut[0] * leftOf(dIn)[0] + dOut[1] * leftOf(dIn)[1])
    theta = Math.acos(Math.max(-1, Math.min(1, dIn[0] * dOut[0] + dIn[1] * dOut[1])))
    radius = corner.radius
    curve = easedTurn(theta, radius, corner.ramp ?? RAMP).points
    const [u, v] = curve.at(-1)
    const tangent = u - v / Math.tan(theta)
    start = [corner.at[0] - dIn[0] * tangent, corner.at[1] - dIn[1] * tangent]
  }
  straights.push([previous, start])
  const lft = leftOf(dIn)
  let last = route.at(-1)
  for (const [u, v] of curve) {
    const point = [start[0] + dIn[0] * u + sign * lft[0] * v, start[1] + dIn[1] * u + sign * lft[1] * v]
    if (Math.hypot(point[0] - last[0], point[1] - last[1]) >= STEP || u === curve.at(-1)[0]) {
      route.push(point)
      last = point
    }
  }
  previous = route.at(-1)
  corner.radiusUsed = radius
}
straights.push([previous, routeStart])
route.push(routeStart)
// Aisles are the straight lane segments the parking planner launches from.
const straightOn = z => {
  const spans = straights.filter(([a, b]) => Math.abs(a[1] - z) < 1e-6 && Math.abs(b[1] - z) < 1e-6)
  const xs = spans.flatMap(([a, b]) => [a[0], b[0]])
  const ends = [Math.min(...xs), Math.max(...xs)]
  if (spans[0][1][0] < spans[0][0][0]) ends.reverse()
  return ends.map(x => [x, z])
}
const aisleFrom = (id, z) => ({ id, points: straightOn(z), oneWay: true })
const aisles = [aisleFrom('A1', lane.north), aisleFrom('A2', lane.middle), aisleFrom('A3', lane.south)]

const pick = array => array[Math.floor(random() * array.length)]
const bays = []
const corrals = []
const rows = [
  { z: -24.65, h: -Math.PI / 2, count: 26, free: [3, 5, 7, 10, 12, 15, 18, 20, 23] },
  { z: -11.85, h: Math.PI - angle, count: 21, free: [3, 5, 8, 10, 13, 15, 17, 19], extraFree: [20], corral: 6 },
  { z: -5.85, h: -angle, count: 21, free: [1, 3, 5, 8, 10, 13, 16], extraFree: [0, 18] },
  { z: 5.6, h: angle, count: 21, free: [0, 2, 5, 7, 10, 12, 14, 16], extraFree: [18], corral: 9 },
  { z: 11.6, h: Math.PI + angle, count: 21, free: [2, 4, 6, 9, 14, 16, 18, 19], unavailable: [2, 20] },
]
for (const [rowIndex, row] of rows.entries()) {
  const straight = rowIndex === 0
  const pitch = straight ? 2.68 : 2.6 / Math.sin(angle)
  for (let i = 0; i < row.count; i++) {
    const id = `B${String(bays.length + 1).padStart(3, '0')}`
    const accessible = straight && [11, 12, 13].includes(i)
    const corral = row.corral === i
    const x = (i - (row.count - 1) / 2) * pitch + (straight ? Math.max(-0.6, Math.min(0.6, (i - 12) * 0.3)) : 0)
    const previouslyFree = row.free.includes(i)
    const unavailable = (row.unavailable ?? []).includes(i)
    const free = !unavailable && (previouslyFree || (row.extraFree ?? []).includes(i))
    const bay = {
      id, center: [x, row.z], heading: row.h, width: accessible ? 2.98 : straight ? 2.68 : 2.6, depth: 5.5,
      kind: corral ? 'corral' : accessible ? 'accessible' : straight ? 'straight' : 'angled',
      row: `R${rowIndex + 1}`, taken: !free,
    }
    if (corral) corrals.push(id)
    // Consume the old occupied-bay random sequence even when thinning a bay,
    // preserving every retained car's type, pose and colour.
    if (!previouslyFree && !corral) {
      const type = pick(carTypes)
      const car = {
        type, color: pick(carCatalog[type].variants).color,
        dx: (random() - 0.5) * 0.16, dz: (random() - 0.5) * 0.18, dh: (random() - 0.5) * 0.075,
        noseIn: random() < (straight ? 0.27 : 0.15),
      }
      if (!free && !unavailable) bay.car = car
    }
    bays.push(bay)
  }
}

const box = (x1, z1, x2, z2) => [[x1, z1], [x2, z1], [x2, z2], [x1, z2]]
const island = (x, z, width) => box(x - width / 2, z - 1.5, x + width / 2, z + 1.5)
const islandSites = [[-36.65, -8.85], [36.65, -8.85], [-36.65, 8.6], [39.95, 8.6]]
const kerbs = [
  { id: 'K1', kind: 'sidewalk', outline: box(-45, -30, 45, -27.65) },
  ...islandSites.map(([x, z], i) => ({ id: `K${i + 2}`, kind: 'island', outline: island(x, z, i === 3 ? 0.9 : 1.2) })),
  { id: 'K6', kind: 'hedge', outline: box(-46.2, -26.9, -44.7, 30.9) },
  { id: 'K7', kind: 'hedge', outline: box(45.2, -26.9, 46.7, 30.9) },
  { id: 'K8', kind: 'hedge', outline: box(-46.2, 31.5, 24, 33) },
  { id: 'K9', kind: 'hedge', outline: box(39.5, 31.5, 46.7, 33) },
]
const hatches = [box(-37.8, -26.8, -35.2, -22.1), box(35.2, -26.8, 38.5, -22.1),
  box(-37.8, -12.9, -35.75, -10.5), box(35.7, -7.2, 38, -4.5),
  box(-37.8, 10.3, -35.7, 13.2), box(35.8, 10, 37, 13.2)].map(outline => ({ outline }))
const lamps = [
  ...islandSites, ...[-23, 0, 23].flatMap(x => [[x, -8.85], [x, 8.6]]),
  [-28, -28.85], [0, -28.85], [28, -28.85], [13, 31.7],
].map((pos, index) => ({ pos, height: index < 10 ? 8.3 : 7.2, arms: index < 10 ? 2 : 1 }))
// Painted arrows stay on the aisle centre lines of the baked lot.
const arrows = aisles.flatMap(({ points: [[x1], [x2]] }, i) => { const z = aisleZ[i]; return (
  [-22, 0, 22].map(x => ({ pos: [x, z], heading: x2 > x1 ? 0 : Math.PI })).slice(0, i === 3 ? 2 : 3)) })
const trees = islandSites.map(([x, z]) => [x, z + 0.9]).concat([[-44.9, -21], [-45.2, 2], [45.8, -8], [45.8, 19], [-18, 31.7], [7, 31.7]])
const bollards = Array.from({ length: 23 }, (_, i) => [-40.7 + i * 3.7, -28.05])
const lot = {
  seed, size: [90, 60], aisles, route, entrance, bays, lamps, kerbs, hatches, arrows, trees, bollards, corrals,
  start: { x: 18, z: lane.south, h: Math.PI },
  building: { outline: box(-43.5, -42, 43.5, -30), height: 6.5, canopyDepth: 3, sign: 'NORTHGATE', doors: [[-26, -30], [-8, -30], [8, -30], [26, -30]] },
  street: { z: 36, from: -80, to: 80 },
}
const round = (_, value) => typeof value === 'number' ? Math.round(value * 1e6) / 1e6 : value
const directory = new URL('../public/models/', import.meta.url)
await mkdir(directory, { recursive: true })
await writeFile(new URL('lot.json', directory), JSON.stringify(lot, round, 2) + '\n')
console.log(`lot.json: ${bays.length} bays, ${bays.filter(bay => bay.car).length} parked cars, ${corrals.length} corrals, ${bays.filter(bay => !bay.taken).length} free, ${route.length} route points`)
