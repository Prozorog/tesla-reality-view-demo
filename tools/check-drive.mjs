import { readFile } from 'node:fs/promises'
import { Drive } from '../src/simulation/drive.ts'
import { createSfLot } from '../src/simulation/sf-lot.ts'
import { SfTrip } from '../src/simulation/sf-trip.ts'

const map = JSON.parse(await readFile(new URL('../public/data/sf/world.json', import.meta.url), 'utf8'))
const controls = { active: false, throttle: 0, steer: 0 }
const step = 1 / 60
const seeds = [7, 29, 113]

for (const seed of seeds) {
  const lot = createSfLot(map)
  const street = new SfTrip(map, seed, lot.start)
  const drive = new Drive(lot, 'park', seed, undefined, street)
  let peakMph = 0
  for (let frame = 0; frame < 540 / step && drive.mode !== 'parked'; frame++) {
    drive.update(step, controls)
    peakMph = Math.max(peakMph, drive.speed / 0.44704)
  }
  const stats = street.stats
  const outcome = drive.parkingResult()
  const problems = []
  if (drive.mode !== 'parked' || !outcome) problems.push(`ended in ${drive.mode}`)
  if (stats.overlapFrames + drive.overlapFrames) problems.push('vehicle footprints overlapped')
  if (stats.unsafeGapFrames) problems.push('vehicle gap below 0.5 m')
  if (stats.stuckFrames || stats.stuck.length || drive.traffic.stats.stuck.length) problems.push('traffic remained stuck')
  if (stats.controlViolations || stats.redLightViolations || stats.stopSignViolations) problems.push('intersection control violation')
  if (stats.longestUnexplainedStop > 6) problems.push('unexplained stop longer than six seconds')
  if (outcome && (outcome.metres > 0.15 || outcome.degrees > 3)) problems.push('parking endpoint outside tolerance')
  if (peakMph > 25.01) problems.push('street speed exceeded 25 mph')
  console.log(JSON.stringify({ seed, mode: drive.mode, tripSeconds: drive.time, peakMph, ...stats,
    parkingOverlapFrames: drive.overlapFrames, outcome, problems }))
  if (problems.length) process.exitCode = 1
}
