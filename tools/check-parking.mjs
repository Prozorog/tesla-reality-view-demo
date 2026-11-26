import { readFile } from 'node:fs/promises'
import { bayPose, carRectangle, CLEARANCE, distance, lotObstacles, obstacle, polygonClearance, rectangle } from '../src/simulation/geometry.ts'
import { carCatalog, runtimeCarEnvelope } from '../src/simulation/lot.ts'
import { checkPlan, planParking } from '../src/simulation/parking.ts'
import { CruiseRoute } from '../src/simulation/route.ts'

const lot = JSON.parse(await readFile(new URL('../public/models/lot.json', import.meta.url), 'utf8'))
const invalidVariants = lot.bays.filter(({ car }) => car && !carCatalog[car.type]?.variants.some(variant => variant.color === car.color))
for (const bay of invalidVariants) console.error(`${bay.id}: ${bay.car.color} is unavailable for ${bay.car.type}`)
const route = new CruiseRoute(lot.route, lot.aisles)
const obstacles = lotObstacles(lot)
const free = lot.bays.filter(bay => !bay.taken)
const envelopes = free.flatMap(bay => runtimeCarEnvelope.map(({ length, width }) =>
  obstacle(bay.id, rectangle(bayPose(bay), -length / 2, length / 2, width / 2)),
))
let worstClearance = Infinity, worstMetres = 0, worstDegrees = 0, passed = 0, tightest = ''
for (const bay of free) {
  // Every other free bay gets the union of the measured runtime footprints.
  const occupied = obstacles.concat(envelopes.filter(box => box.id !== bay.id))
  const plan = planParking(lot, route, bay, occupied)
  if (!plan) {
    console.error(`${bay.id} (${bay.row} at ${bay.center}): no path with ${CLEARANCE.toFixed(2)} m swept clearance`)
    continue
  }
  const actual = checkPlan(plan, route, occupied)
  if (actual.clearance < worstClearance) {
    worstClearance = actual.clearance
    tightest = bay.id
  }
  worstMetres = Math.max(worstMetres, actual.metres)
  worstDegrees = Math.max(worstDegrees, actual.degrees)
  if (actual.clearance >= CLEARANCE && actual.metres <= 0.15 && actual.degrees <= 3) passed++
}

const full = obstacles.concat(envelopes)
let overlapping = false
for (const [i, box] of full.entries()) {
  if (box.id.startsWith('B') && polygonClearance(box.polygon, full.slice(0, i).filter(other => other.id !== box.id)) === 0) {
    console.error(`${box.id}: parked footprint overlaps a kerb or another bay's car`)
    overlapping = true
  }
}

let routeGap = Infinity, routeAt = 0, nearby = Infinity, nearbyAt = 0
// The Model X footprint (mesh, mirrors, 5 cm) along the cruising lane and along
// the aisle line it returns to for a pull-past.
for (let s = 0; s < route.length; s += 0.08) {
  const pose = route.pose(s)
  for (const lane of [route.lanePose(s), pose]) {
    const gap = polygonClearance(carRectangle(lane), full, routeGap)
    if (gap < routeGap) {
      routeGap = gap
      routeAt = s
    }
  }
  const count = free.filter(bay => distance(bay.center, [pose.x, pose.z]) <= 25).length
  if (count < nearby) {
    nearby = count
    nearbyAt = s
  }
}
console.log(`Parking: ${passed}/${free.length} free bays, worst swept clearance ${worstClearance.toFixed(3)} m (${tightest}), worst end error ${worstMetres.toFixed(3)} m / ${worstDegrees.toFixed(3)}°`)
console.log(`Cruise: ${route.length.toFixed(1)} m loop, ${routeGap.toFixed(3)} m closest clearance at s=${routeAt.toFixed(2)}, at least ${nearby} free bays within 25 m`)
if (routeGap < 0.3) console.error('Closest cruise pose', route.pose(routeAt))
if (nearby < 2) console.error('Fewest free bays near', route.pose(nearbyAt))
if (passed !== free.length || routeGap < 0.3 || nearby < 2 || overlapping || invalidVariants.length) process.exitCode = 1

// Optional: pass the demo URL to also check the Reality View framing of a ?bot=1 park.
const demo = process.argv[2]
if (demo) {
  const { checkFraming, printFraming } = await import('./check-framing.mjs')
  printFraming(await checkFraming(demo))
} else {
  console.log('Framing: skipped (pass the demo URL, e.g. npm run check:parking -- http://localhost:4106/)')
}
