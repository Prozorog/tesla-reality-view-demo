#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const folder = resolve(root, 'data/osm')
const privateFolder = resolve(root, 'tmp/sf-source')
const endpoint = 'https://ovp.dresel.systems/api-na/interpreter'
const query = `[out:json][timeout:45];
(
  way[highway](37.798,-122.450,37.808,-122.433);
  way[building](37.798,-122.450,37.808,-122.433);
  relation[building](37.798,-122.450,37.808,-122.433);
  node[highway](37.798,-122.450,37.808,-122.433);
  node[natural=tree](37.798,-122.450,37.808,-122.433);
  way[natural](37.798,-122.450,37.808,-122.433);
  way[leisure](37.798,-122.450,37.808,-122.433);
  way[amenity=parking](37.798,-122.450,37.808,-122.433);
  relation[type=restriction](37.798,-122.450,37.808,-122.433);
);
out body;
>;
out skel qt;`
const url = endpoint + '?data=' + encodeURIComponent(query)
const inputIndex = process.argv.indexOf('--input')
const input = inputIndex >= 0 ? resolve(process.argv[inputIndex + 1]) : undefined
const previous = input ? JSON.parse(readFileSync(resolve(privateFolder, 'provenance.json'), 'utf8')) : undefined
const started = previous?.started ?? new Date().toISOString()
let rawBytes
if (input) {
  rawBytes = readFileSync(input)
} else {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'TeslaRealityViewDemo/1.0 (public fan project)', Accept: 'application/json' },
    signal: AbortSignal.timeout(90000),
  })
  if (!response.ok) throw new Error(`Overpass returned ${response.status}`)
  rawBytes = Buffer.from(await response.arrayBuffer())
}
const raw = JSON.parse(rawBytes)
if (!Array.isArray(raw.elements) || !raw.elements.length) throw new Error('Overpass response has no elements')
mkdirSync(folder, { recursive: true })
mkdirSync(privateFolder, { recursive: true })
writeFileSync(resolve(privateFolder, 'overpass-corridor.raw.json'), rawBytes)

const removed = {}
const email = /[\w.%+-]+@[\w.-]+\.[a-z]{2,}\b/i
const secret = /\b(?:gh[pousr]_[\da-z]{30,}|github_pat_[\w]{30,}|sk-(?:proj-)?[\w-]{24,}|AKIA[\dA-Z]{16})\b|-----BEGIN [A-Z ]*PRIVATE KEY-----/i
const privatePath = /[a-z]:[/\\]+(?:Users|Documents and Settings|Ai)[/\\]+/i
function sanitize(document) {
  const removed = {}
  for (const element of document.elements) {
    for (const key of ['user', 'uid', 'changeset', 'timestamp']) delete element[key]
    for (const [key, value] of Object.entries(element.tags ?? {})) {
      if (/^(?:contact:|email$|phone$|fax$|website$|url$)/i.test(key) || email.test(String(value)) || secret.test(String(value)) || privatePath.test(String(value))) {
        removed[key] = (removed[key] ?? 0) + 1
        delete element.tags[key]
      }
    }
  }
  return removed
}
Object.assign(removed, sanitize(raw))
const publicBytes = Buffer.from(JSON.stringify(raw, null, 2) + '\n')
if (email.test(publicBytes.toString('utf8')) || secret.test(publicBytes.toString('utf8')) || privatePath.test(publicBytes.toString('utf8'))) throw new Error('Sanitized extract still contains a private value')
writeFileSync(resolve(folder, 'corridor.overpass.json'), publicBytes)
const provenance = {
  endpoint, url, query, started, fetched: previous?.fetched ?? new Date().toISOString(),
  osmBase: raw.osm3s, bbox: [37.798, -122.450, 37.808, -122.433],
  rawBytes: rawBytes.length, rawSHA256: createHash('sha256').update(rawBytes).digest('hex'),
  publishedBytes: publicBytes.length, publishedSHA256: createHash('sha256').update(publicBytes).digest('hex'),
  elements: raw.elements.length,
  sanitization: { removedTagCounts: removed, removedTags: Object.values(removed).reduce((sum, count) => sum + count, 0), geometryAndRestrictionsPreserved: true, originalResponse: 'Kept in the ignored local working folder' },
  license: 'OpenStreetMap data, © OpenStreetMap contributors, ODbL 1.0',
  licenseURL: 'https://www.openstreetmap.org/copyright',
}
writeFileSync(resolve(folder, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n')
console.log(JSON.stringify({ elements: raw.elements.length, bytes: publicBytes.length, removedTags: provenance.sanitization.removedTags, sha256: provenance.publishedSHA256 }, null, 2))

// The Palace lagoon is a water multipolygon. Keep its smaller request separate
// so the initial corridor response and its provenance remain reproducible.
const waterQuery = `[out:json][timeout:45];(
  nwr[natural=water](37.801,-122.451,37.809,-122.433);
  nwr[water](37.801,-122.451,37.809,-122.433);
  nwr[leisure=marina](37.801,-122.451,37.809,-122.433);
  way[natural=coastline](37.804,-122.451,37.809,-122.433);
);out body;>;out skel qt;`
const waterURL = endpoint + '?data=' + encodeURIComponent(waterQuery)
const waterPrevious = input ? JSON.parse(readFileSync(resolve(privateFolder, 'water.provenance.json'), 'utf8')) : undefined
let waterBytes
if (input) waterBytes = readFileSync(resolve(privateFolder, 'water.raw.json'))
else {
  const response = await fetch(waterURL, { headers: { 'User-Agent': 'TeslaRealityViewDemo/1.0 (public fan project)', Accept: 'application/json' }, signal: AbortSignal.timeout(90000) })
  if (!response.ok) throw new Error(`Water query returned ${response.status}`)
  waterBytes = Buffer.from(await response.arrayBuffer())
}
writeFileSync(resolve(privateFolder, 'water.raw.json'), waterBytes)
const water = JSON.parse(waterBytes)
const waterRemoved = sanitize(water)
const waterPublic = Buffer.from(JSON.stringify(water, null, 2) + '\n')
writeFileSync(resolve(folder, 'water.overpass.json'), waterPublic)
writeFileSync(resolve(folder, 'water.provenance.json'), JSON.stringify({
  endpoint, url: waterURL, query: waterQuery, started: waterPrevious?.started ?? started, fetched: waterPrevious?.fetched ?? new Date().toISOString(),
  osmBase: water.osm3s, rawBytes: waterBytes.length, publishedBytes: waterPublic.length,
  rawSHA256: createHash('sha256').update(waterBytes).digest('hex'), publishedSHA256: createHash('sha256').update(waterPublic).digest('hex'),
  elements: water.elements.length, sanitization: { removedTagCounts: waterRemoved },
  license: 'OpenStreetMap data, © OpenStreetMap contributors, ODbL 1.0', licenseURL: 'https://www.openstreetmap.org/copyright',
}, null, 2) + '\n')
console.log(JSON.stringify({ waterElements: water.elements.length, waterBytes: waterPublic.length }))
