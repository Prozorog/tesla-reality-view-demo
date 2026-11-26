import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const folder = resolve(root, 'data/osm')
const input = resolve(process.argv[2] ?? `${folder}/corridor.overpass.json`)
const output = resolve(process.argv[3] ?? `${root}/public/data/sf/world.json`)
const bytes = readFileSync(input)
const raw = JSON.parse(bytes)
const waterBytes = readFileSync(resolve(folder, 'water.overpass.json'))
const rawWater = JSON.parse(waterBytes)
const origin = [37.80418, -122.44849]
const metreLatitude = 111319.49079327358
const metreLongitude = metreLatitude * Math.cos(origin[0] * Math.PI / 180)
const round = value => Math.round(value * 100) / 100
const project = node => [round((node.lon - origin[1]) * metreLongitude), round((origin[0] - node.lat) * metreLatitude)]
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

// Repeated skeleton records must retain the tags of their earlier body record.
const items = new Map()
for (const item of [...raw.elements, ...rawWater.elements]) {
  const key = `${item.type}/${item.id}`, previous = items.get(key)
  items.set(key, { ...previous, ...item, tags: { ...previous?.tags, ...item.tags } })
}
const all = [...items.values()]
const nodes = new Map(all.filter(item => item.type === 'node').map(item => [item.id, item]))
const ways = new Map(all.filter(item => item.type === 'way').map(item => [item.id, item]))
const relations = all.filter(item => item.type === 'relation')
const restrictions = relations.filter(item => item.tags.type === 'restriction')
const roadKinds = new Set(['residential', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'primary', 'primary_link', 'unclassified', 'service', 'living_street'])
const roads = [...ways.values()].filter(way => roadKinds.has(way.tags.highway))
const safeStreet = name => /(?:Street|Boulevard|Road|Drive|Avenue|Lane|Alley|Court|Way|Highway)$/.test(name ?? '') ? name : 'Access road'
const defaults = { widths: 0, heights: 0, levels: 0, inferredControls: 0 }

function metres(value) {
  const number = Number.parseFloat(value)
  if (!Number.isFinite(number)) return undefined
  return /(?:ft|feet|')/.test(value) ? number * 0.3048 : number
}

function roadProperties(way) {
  const tags = way.tags
  const oneway = tags.oneway === '-1' ? -1 : ['yes', '1', 'true'].includes(tags.oneway) ? 1 : 0
  const lanes = Number.parseInt(tags.lanes, 10) || (oneway || tags.highway === 'service' ? 1 : 2)
  const taggedWidth = metres(tags.width) ?? metres(tags['width:carriageway']) ?? metres(tags.est_width)
  const both = tags['parking:both'] === 'lane' ? 2 : 0
  const parking = both || Number(tags['parking:left'] === 'lane') + Number(tags['parking:right'] === 'lane')
  const width = taggedWidth ?? Math.max(tags.highway === 'service' ? 5.6 : 5.8, lanes * 3.2 + parking * 2.2)
  return { width: round(width), lanes, oneway, taggedWidth: taggedWidth !== undefined }
}

function access(way) {
  const tags = way.tags
  const tag = ['motorcar', 'motor_vehicle', 'vehicle', 'access'].find(key => tags[key])
  const value = tag ? tags[tag] : 'yes'
  return { tag: tag ?? 'default', value, allowed: !['no', 'private', 'agricultural', 'forestry'].includes(value) }
}

// Every way is explicitly oriented in the direction the car traverses it.
// The final approach follows legal two-way Palace Drive around the lagoon.
const recipe = [
  [1381227464, false], [254984059, false], [498532512, false], [254984058, false],
  [619535677, true], [721044169, true], [721044168, true],
  [254971062, true], [254297755, true], [91187852, true],
  [945294683, false], [945294682, false],
  [91187856, false], [1241894252, false], [8916441, false],
  [1418637351, false], [8919167, false], [1418637352, false],
  [161631001, false], [1418637349, false], [161631002, false],
  [562765651, false],
]
const traversal = recipe.map(([id, reverse]) => {
  const way = ways.get(id)
  if (!way) throw new Error(`Missing route way ${id}`)
  const ids = reverse ? way.nodes.toReversed() : [...way.nodes]
  return { way, reverse, ids }
})

// Stop Palace Drive at its public parking access, then take that access.
const palace = traversal.find(item => item.way.id === 161631002)
palace.ids = palace.ids.slice(0, palace.ids.indexOf(312104185) + 1)
for (let i = 1; i < traversal.length; i++) {
  if (traversal[i - 1].ids.at(-1) !== traversal[i].ids[0]) {
    throw new Error(`Disconnected route ways ${traversal[i - 1].way.id} and ${traversal[i].way.id}`)
  }
}

const traversalAudit = traversal.map(({ way, reverse }) => {
  const properties = roadProperties(way), permission = access(way)
  const legalDirection = properties.oneway === 0 || (reverse ? properties.oneway === -1 : properties.oneway === 1)
  if (!permission.allowed || !legalDirection) throw new Error(`Route violates direction or access on ${way.id}`)
  return { way: way.id, street: safeStreet(way.tags.name), reversed: reverse, oneway: way.tags.oneway ?? 'no', access: permission, maxspeed: way.tags.maxspeed ?? null }
})

let station = 0
const routePoints = []
const routeNodes = []
const segments = traversal.map(({ way, ids }, index) => {
  const properties = roadProperties(way)
  const points = ids.map(id => project(nodes.get(id)))
  // Parallel parking starts 30 m east of Fillmore, so the trip passes the
  // intersection's actual OSM traffic signal while heading west on Chestnut.
  if (index === 0) {
    let trim = points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0) - 30
    while (points.length > 1 && distance(points[0], points[1]) < trim) {
      trim -= distance(points[0], points[1]); points.shift(); ids.shift()
    }
    const span = distance(points[0], points[1]), mix = trim / span
    points[0] = [round(points[0][0] + (points[1][0] - points[0][0]) * mix), round(points[0][1] + (points[1][1] - points[0][1]) * mix)]
    ids[0] = undefined
  }
  const start = station
  for (let i = 0; i < points.length; i++) {
    if (routePoints.length) station += distance(routePoints.at(-1), points[i])
    if (!routePoints.length || distance(routePoints.at(-1), points[i]) > 0.01) routePoints.push(points[i])
    if (ids[i] !== undefined) routeNodes.push({ id: ids[i], point: points[i], station, way: way.id, index, reverse: traversal[index].reverse })
  }
  return { way: way.id, name: safeStreet(way.tags.name), points, width: properties.width, lanes: properties.lanes, oneway: properties.oneway, start: round(start), length: round(station - start) }
})
const routeLength = round(station)
const routeLines = routePoints.slice(1).map((point, i) => ({ a: routePoints[i], b: point }))

function pointSegmentGap(point, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / Math.max(1e-8, dx * dx + dz * dz)))
  return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz)
}
const routeGap = point => Math.min(...routeLines.map(({ a, b }) => pointSegmentGap(point, a, b)))
const inCorridor = points => points.some(point => routeGap(point) <= 150)

function clipRoad(points) {
  const parts = []
  let current = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], steps = Math.max(1, Math.ceil(distance(a, b) / 8))
    for (let k = i === 1 ? 0 : 1; k <= steps; k++) {
      const point = [round(a[0] + (b[0] - a[0]) * k / steps), round(a[1] + (b[1] - a[1]) * k / steps)]
      if (routeGap(point) <= 150) current.push(point)
      else if (current.length) { if (current.length >= 2) parts.push(current); current = [] }
    }
  }
  if (current.length >= 2) parts.push(current)
  return parts
}

const compiledRoads = roads.flatMap(way => {
  const points = way.nodes.map(id => nodes.get(id)).filter(Boolean).map(project)
  const properties = roadProperties(way)
  const parts = clipRoad(points)
  if (parts.length && !properties.taggedWidth) defaults.widths++
  return parts.map((part, index) => ({ id: `${way.id}/${index}`, name: safeStreet(way.tags.name), points: part, width: properties.width, lanes: properties.lanes, oneway: properties.oneway, kind: way.tags.highway }))
})

const nodeWays = new Map()
for (const way of roads) for (const id of way.nodes) {
  if (!nodeWays.has(id)) nodeWays.set(id, [])
  nodeWays.get(id).push(way)
}
const controls = []
const controlProof = []
const seenControls = new Set()
for (const entry of routeNodes) {
  if (seenControls.has(entry.id)) continue
  const node = nodes.get(entry.id), tags = node.tags
  const kind = tags.highway === 'traffic_signals' ? 'signal' : tags.highway === 'stop' ? 'stop' : undefined
  const direction = tags['traffic_signals:direction'] ?? tags.direction
  if (!kind || direction === (entry.reverse ? 'forward' : 'backward')) continue
  seenControls.add(entry.id)
  const crossing = routeNodes.some(other => Math.abs(other.station - entry.station) < 12 && nodes.get(other.id).tags.highway === 'crossing')
  controls.push({ id: entry.id, pos: entry.point, kind, crossing, street: safeStreet(ways.get(entry.way).tags.name), station: round(entry.station) })
  controlProof.push({ id: entry.id, source: 'OSM', highway: tags.highway, stop: tags.stop ?? null, direction: direction ?? 'both', station: round(entry.station) })
}

for (const entry of routeNodes) {
  const adjoining = nodeWays.get(entry.id) ?? []
  const street = safeStreet(ways.get(entry.way).tags.name)
  const other = adjoining.filter(way => way.tags.highway !== 'service' && safeStreet(way.tags.name) !== street)
  if (!other.length || controls.some(control => Math.abs(control.station - entry.station) < 22)) continue
  const id = `fallback/${entry.id}`
  if (seenControls.has(id)) continue
  seenControls.add(id)
  defaults.inferredControls++
  const crossing = routeNodes.some(candidate => Math.abs(candidate.station - entry.station) < 12 && nodes.get(candidate.id).tags.highway === 'crossing')
  controls.push({ id, pos: entry.point, kind: 'stop', crossing, street, station: round(entry.station) })
  controlProof.push({ id, source: 'Unmapped junction, all-way stop by project brief', junction: entry.id, station: round(entry.station) })
}
controls.sort((a, b) => a.station - b.station)
controlProof.sort((a, b) => a.station - b.station)

const crossingProof = []
const crosswalks = all.filter(item => item.type === 'node' && item.tags.highway === 'crossing').flatMap(node => {
  const pos = project(node)
  if (routeGap(pos) > 150) return []
  const connected = nodeWays.get(node.id)
  let best = connected?.[0], gap = Infinity
  for (const road of roads) {
    for (let i = 1; i < road.nodes.length; i++) {
      const a = nodes.get(road.nodes[i - 1]), b = nodes.get(road.nodes[i])
      if (!a || !b) continue
      const next = pointSegmentGap(pos, project(a), project(b))
      if (next < gap) { gap = next; best = road }
    }
  }
  if (!best || gap > 15) return []
  crossingProof.push({ node: node.id, road: best.id, markings: node.tags['crossing:markings'] ?? null, crossing: node.tags.crossing ?? null })
  return [{ pos, road: best.id }]
})

function outline(way) {
  const points = way.nodes.map(id => nodes.get(id)).filter(Boolean).map(project)
  if (points.length > 2 && distance(points[0], points.at(-1)) < 0.1) points.pop()
  return points
}
const chestnutLines = segments.filter(segment => segment.name === 'Chestnut Street').flatMap(segment => segment.points.slice(1).map((point, i) => ({ a: segment.points[i], b: point })))
const buildings = []
function addBuilding(id, points, tags) {
  if (points.length < 3 || !inCorridor(points)) return
  const centre = points.reduce((total, point) => [total[0] + point[0] / points.length, total[1] + point[1] / points.length], [0, 0])
  const nearChestnut = Math.min(...chestnutLines.map(({ a, b }) => pointSegmentGap(centre, a, b))) < 35
  const commercial = ['retail', 'commercial', 'restaurant', 'supermarket', 'theatre'].includes(tags.building) || nearChestnut
  const levelsTag = Number.parseFloat(tags['building:levels'])
  const heightTag = metres(tags.height)
  const levels = levelsTag || Math.max(1, Math.round((heightTag ?? (nearChestnut ? 9.6 : 6.4)) / 3.2))
  const height = heightTag ?? levels * 3.2
  if (!levelsTag) defaults.levels++
  if (!heightTag) defaults.heights++
  buildings.push({ id, outline: points, height: round(height), levels, commercial })
}
const relationBuildingMembers = new Set()
for (const relation of relations.filter(item => item.tags.building)) {
  const chains = relation.members.filter(member => member.type === 'way' && member.role !== 'inner').map(member => ways.get(member.ref)?.nodes.slice()).filter(Boolean)
  for (const member of relation.members) if (member.type === 'way') relationBuildingMembers.add(member.ref)
  while (chains.length) {
    const chain = chains.shift()
    let joined = true
    while (joined && chain[0] !== chain.at(-1)) {
      joined = false
      for (let i = 0; i < chains.length; i++) {
        const next = chains[i]
        if (chain.at(-1) === next.at(-1)) next.reverse()
        if (chain.at(-1) !== next[0]) continue
        chain.push(...next.slice(1)); chains.splice(i, 1); joined = true; break
      }
    }
    if (chain[0] === chain.at(-1)) addBuilding(`relation/${relation.id}`, outline({ nodes: chain }), relation.tags)
  }
}
for (const way of ways.values()) if (way.tags.building && !relationBuildingMembers.has(way.id)) addBuilding(way.id, outline(way), way.tags)

const landmarkNames = new Set(['Marina Green', 'Little Marina Green', 'Palace of Fine Arts', 'Palace of Fine Arts Lagoon', 'San Francisco Bay'])
const parks = [], water = []
for (const way of ways.values()) {
  const points = outline(way)
  const harbor = [453930841, 453933178].includes(way.id)
  if (points.length < 3 || (!harbor && !inCorridor(points))) continue
  if (['park', 'garden', 'nature_reserve'].includes(way.tags.leisure)) parks.push({ name: landmarkNames.has(way.tags.name) ? way.tags.name : 'Neighbourhood green', outline: points })
  if (harbor) water.push({ id: `way/${way.id}`, name: way.id === 453930841 ? 'Yacht Harbor' : 'East Harbor', outline: points, kind: 'marina' })
}
const lagoon = relations.find(relation => relation.id === 7471537)
if (!lagoon) throw new Error('Missing Palace lagoon relation')
const lagoonChains = lagoon.members.filter(member => member.type === 'way' && member.role !== 'inner').map(member => ways.get(member.ref)?.nodes.slice()).filter(Boolean)
while (lagoonChains.length) {
  const chain = lagoonChains.shift()
  let joined = true
  while (joined && chain[0] !== chain.at(-1)) {
    joined = false
    for (let i = 0; i < lagoonChains.length; i++) {
      const next = lagoonChains[i]
      if (chain.at(-1) === next.at(-1)) next.reverse()
      if (chain.at(-1) !== next[0]) continue
      chain.push(...next.slice(1))
      lagoonChains.splice(i, 1)
      joined = true
      break
    }
  }
  if (chain[0] !== chain.at(-1)) throw new Error('Palace lagoon ring is incomplete')
  water.push({ id: 'relation/7471537', name: 'Palace of Fine Arts Lagoon', outline: outline({ nodes: chain }), kind: 'lagoon' })
}
const trees = all.filter(item => item.type === 'node' && item.tags.natural === 'tree').map(project).filter(point => routeGap(point) <= 150)
const lotPolygon = outline(ways.get(68914570))
const rotundaOutline = outline(ways.get(288371295))
const rotunda = rotundaOutline.reduce((sum, point) => [sum[0] + point[0] / rotundaOutline.length, sum[1] + point[1] / rotundaOutline.length], [0, 0]).map(round)

const viaWayProof = restrictions.filter(relation => relation.members.some(member => member.role === 'via' && member.type === 'way')).map(relation => {
  const sequence = [relation.members.find(member => member.role === 'from')?.ref, ...relation.members.filter(member => member.role === 'via').map(member => member.ref), relation.members.find(member => member.role === 'to')?.ref]
  const routeSequence = traversal.map(item => item.way.id)
  const entered = routeSequence.some((id, i) => id === sequence[0] && sequence.slice(0, -1).every((way, k) => routeSequence[i + k] === way))
  const matched = routeSequence.some((id, i) => id === sequence[0] && sequence.every((way, k) => routeSequence[i + k] === way))
  const rule = relation.tags.restriction ?? relation.tags['restriction:conditional']
  if (entered && (rule.startsWith('only_') ? !matched : matched)) throw new Error(`Via-way restriction needs resolution: ${relation.id}`)
  return { relation: relation.id, rule, sequence, entered, matched, result: entered ? 'Allowed route' : 'Outside chosen traversal' }
})
const turns = []
for (let i = 1; i < traversal.length; i++) {
  const before = traversal[i - 1], next = traversal[i]
  const via = before.ids.at(-1), from = before.way.id, to = next.way.id
  const applicable = restrictions.filter(relation => relation.members.some(member => member.role === 'via' && member.type === 'node' && member.ref === via) && relation.members.some(member => member.role === 'from' && member.ref === from))
  const audit = applicable.map(relation => {
    const matched = relation.members.some(member => member.role === 'to' && member.ref === to)
    const rule = relation.tags.restriction ?? relation.tags['restriction:conditional']
    const allowed = rule.startsWith('only_') ? matched : !matched
    if (!allowed) throw new Error(`Route restriction needs resolution: ${relation.id}`)
    return { relation: relation.id, rule, matched, allowed }
  })
  const incoming = segments[i - 1].points, outgoing = segments[i].points
  const a = incoming.at(-2), b = incoming.at(-1), c = outgoing[1]
  const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1]
  const angle = Math.atan2(-(ux * vz - uz * vx), ux * vx + uz * vz) * 180 / Math.PI
  if (segments[i - 1].name !== segments[i].name || Math.abs(angle) > 35) turns.push({ from, to, via, pos: b, fromStreet: segments[i - 1].name, toStreet: segments[i].name, turn: angle > 20 ? 'left' : angle < -20 ? 'right' : 'continue', degrees: round(angle), restrictionAudit: audit, legalDirectionAndAccess: true })
}

const world = { origin, routeLength, segments, roads: compiledRoads, controls, crosswalks, buildings, parks, water, trees, lotPolygon, rotunda }
const serialized = JSON.stringify(world)
if (/[\w.%+-]+@[\w.-]+\.[a-z]{2,}|(?:phone|website|contact|operator|brand|email|addr:)/i.test(serialized)) throw new Error('Derived data contains a private or business field')
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, serialized + '\n', 'utf8')
const audit = {
  inputSHA256: createHash('sha256').update(bytes).digest('hex'),
  waterInputSHA256: createHash('sha256').update(waterBytes).digest('hex'),
  source: raw.osm3s,
  waterSource: rawWater.osm3s,
  projection: 'Local equirectangular metres, x east, z south, origin latitude/longitude',
  corridor: '150 m from the route, sampled road clipping at intervals no longer than 8 m; whole intersecting building footprints retained',
  timeForRoute: 'Night after 19:00, motorcar access, destination is public parking',
  start: 'Chestnut Street 30 m east of Fillmore, centreline ready for runtime lane and kerb offsets, followed by mapped signal node65317181',
  arrival: 'Marina westbound, left Baker, right Bay, right Palace Drive around lagoon west side, right public parking access',
  directLyonRejected: { way: 8915480, reason: 'One-way northbound exit from Lyon into eastbound Marina, so a southward arrival would use the wrong direction' },
  lot: { polygon: 68914570, accessWay: 562765651, aisle: 68914563 },
  routeLength, traversal: traversalAudit, turns, viaWayRestrictions: viaWayProof, controls: controlProof, crossings: crossingProof,
  defaults: { ...defaults, inferredStoreyHeightMetres: 3.2, carriagewayLaneWidthMetres: 3.2, parkingLaneWidthMetres: 2.2 },
  notes: [
    'Chestnut has an OSM 20 mph segment. The requested demo limit is 25 mph, so the runtime choice needs to be recorded.',
    'Unmapped junctions get all-way stops under the project brief. Existing mapped controls and directional tags take precedence.',
    'Building commercial flags are inferred along Chestnut without copying shop names, contacts, logos or operators.',
    'Inner courtyard holes are omitted from relation building display outlines.',
    'Water and parks preserve whole intersecting polygons. The bay backdrop outside the extract remains a scene-authoring task.',
    'The byte-exact source responses stay private. Published extracts remove mapper metadata and contact fields, preserving geometry and restrictions.',
    'The lagoon comes from multipolygon relation7471537. Yacht Harbor and East Harbor use their OSM marina polygons. The unrelated inland pond is omitted.',
  ],
  counts: Object.fromEntries(['segments', 'roads', 'controls', 'crosswalks', 'buildings', 'parks', 'water', 'trees'].map(key => [key, world[key].length])),
}
writeFileSync(resolve(folder, 'route-audit.json'), JSON.stringify(audit, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({ output, routeLength, bytes: Buffer.byteLength(serialized), counts: audit.counts, defaults: audit.defaults, turns: turns.map(({ fromStreet, toStreet, turn, via }) => ({ fromStreet, toStreet, turn, via })) }, null, 2))
