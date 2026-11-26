import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { sfStreetLamps } from '../src/assets/sf-furniture.ts'
import { createSfLot } from '../src/simulation/sf-lot.ts'

const map = JSON.parse(await readFile(new URL('../public/data/sf/world.json', import.meta.url), 'utf8'))
const directory = new URL('../tmp/sf-bake/', import.meta.url)
await mkdir(directory, { recursive: true })
const lamps = sfStreetLamps(map, createSfLot(map))
await writeFile(new URL('lamps.json', directory), `${JSON.stringify(lamps, null, 2)}\n`)
console.log(`Wrote ${lamps.length} San Francisco light positions.`)
