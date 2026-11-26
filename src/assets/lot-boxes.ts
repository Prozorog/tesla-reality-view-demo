import {
  BufferAttribute, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
} from 'three'
import { bayPose, bayRectangle, clamp, localPoint } from '../simulation/geometry.ts'
import { seededRandom } from '../simulation/lot.ts'
import type { Lot, Point } from '../simulation/lot.ts'
import { batch, box, canvasTexture, flat } from './boxes.ts'
import type { BoxSpec } from './boxes.ts'

function extent(points: Point[]) {
  const x = points.map(p => p[0]), z = points.map(p => p[1])
  return { x1: Math.min(...x), x2: Math.max(...x), z1: Math.min(...z), z2: Math.max(...z) }
}

function slab(points: Point[], height: number, color: string, base = 0): BoxSpec {
  const { x1, x2, z1, z2 } = extent(points)
  return { pos: [(x1 + x2) / 2, base + height / 2, (z1 + z2) / 2], size: [x2 - x1, height, z2 - z1], color }
}

function stripe(a: Point, b: Point, width: number, color: string, y = 0.012): BoxSpec {
  return {
    pos: [(a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2],
    size: [Math.hypot(a[0] - b[0], a[1] - b[1]), 0.012, width],
    yaw: Math.atan2(a[1] - b[1], b[0] - a[0]), color,
  }
}

function asphalt(lot: Lot) {
  const geometry = new PlaneGeometry(104, 72, 104, 72).rotateX(-Math.PI / 2).translate(0, 0, -2)
  const vertices = geometry.getAttribute('position')
  const colors = new Float32Array(vertices.count * 3)
  const dark = new Color('#1c1a1c'), warm = new Color('#6b5a48'), color = new Color()
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), z = vertices.getZ(i)
    let light = 0
    for (const lamp of lot.lamps) {
      const dx = lamp.pos[0] - x, dz = lamp.pos[1] - z
      light += Math.exp(-(dx * dx * 0.008 + dz * dz * 0.022)) * 0.64
    }
    const patches = Math.sin(x * 0.27 + z * 1.4) * Math.sin(z * 0.51 - x * 0.37) * 0.044
    const front = Math.exp(-((z + 29) ** 2) * 0.060) * 0.24
    color.copy(dark).lerp(warm, clamp(light + front + patches, 0, 1))
    color.toArray(colors, i * 3)
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true }))
}

export function lotBoxes(lot: Lot) {
  const world = new Group()
  world.name = 'lot'
  const basic = flat('#ffffff')
  const matte = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 })
  world.add(asphalt(lot))
  box(world, flat('#1e1e28'), [258, 0.12, 230], [0, -0.14, 0])
  box(world, flat('#2b2931'), [lot.street.to - lot.street.from, 0.06, 9], [(lot.street.to + lot.street.from) / 2, 0.02, lot.street.z])

  const paint: BoxSpec[] = []
  const kerbs: BoxSpec[] = []
  const fence: BoxSpec[] = []
  for (const kerb of lot.kerbs) {
    if (kerb.kind === 'hedge') {
      const bounds = extent(kerb.outline)
      kerbs.push(slab(kerb.outline, 0.94, '#303b31'))
      const horizontal = bounds.x2 - bounds.x1 > bounds.z2 - bounds.z1
      const edge = horizontal ? bounds.z2 : (bounds.x1 > 0 ? bounds.x2 : bounds.x1)
      const from = horizontal ? bounds.x1 : bounds.z1
      const to = horizontal ? bounds.x2 : bounds.z2
      for (let s = from; s < to; s += 2.8) {
        fence.push({ size: [0.08, 1.16, 0.08], pos: horizontal ? [s, 0.59, edge] : [edge, 0.59, s], color: '#505054' })
      }
      fence.push({ size: horizontal ? [to - from, 0.045, 0.05] : [0.05, 0.045, to - from],
        pos: horizontal ? [(from + to) / 2, 0.98, edge] : [edge, 0.98, (from + to) / 2], color: '#505054' })
    } else {
      kerbs.push(slab(kerb.outline, 0.15, kerb.kind === 'sidewalk' ? '#a39381' : '#9a8b76'))
      if (kerb.kind === 'island') kerbs.push(slab(kerb.outline, 0.045, '#4c4836', 0.15))
    }
  }
  batch(world, matte, kerbs.concat(fence))

  const random = seededRandom(lot.seed)
  const lineColors = ['#c7bead', '#d9d2c4', '#b0a698', '#cfc4af']
  const lines = new Set<string>()
  for (const bay of lot.bays) {
    const corners = bayRectangle(bay)
    for (const [a, b] of [[corners[0], corners[1]], [corners[2], corners[3]], [corners[3], corners[0]]]) {
      const key = [a, b].map(point => point.map(v => v.toFixed(2)).join(',')).sort().join(':')
      if (lines.has(key)) continue
      lines.add(key)
      paint.push(stripe(a, b, 0.075, bay.kind === 'accessible' ? '#6595c8' : lineColors[Math.floor(random() * lineColors.length)]))
    }
  }
  for (const { outline } of lot.hatches) {
    const { x1, x2, z1, z2 } = extent(outline)
    for (let i = 0; i < 4; i++) paint.push(stripe(outline[i], outline[(i + 1) % 4], 0.065, '#c9bca7'))
    for (let start = x1 - (z2 - z1); start < x2; start += 0.53) {
      const x = Math.max(start, x1), end = Math.min(start + z2 - z1, x2)
      if (end > x) paint.push(stripe([x, z1 + x - start], [end, z1 + end - start], 0.062, '#bdae99'))
    }
  }
  for (const { pos: [x, z], heading: h } of lot.arrows) {
    const pose = { x, z, h }
    const tip = localPoint(pose, 0.93, 0)
    paint.push(stripe(localPoint(pose, -0.9, 0), tip, 0.12, '#d3c3a6'))
    for (const side of [-1, 1]) paint.push(stripe(localPoint(pose, 0.32, side * 0.48), tip, 0.12, '#d3c3a6'))
  }
  for (let x = -77; x < 78; x += 4) paint.push(stripe([x, lot.street.z], [x + 2, lot.street.z], 0.12, '#756a54', 0.059))
  batch(world, basic, paint)

  const accessibility = canvasTexture(128, 128, ctx => {
    ctx.fillStyle = '#31597f'
    ctx.fillRect(7, 7, 114, 114)
    ctx.lineWidth = 7
    ctx.lineCap = 'round'
    ctx.strokeStyle = ctx.fillStyle = '#d7dfdf'
    ctx.beginPath()
    ctx.arc(58, 84, 23, 0.1, Math.PI * 1.55)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(59, 37, 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(59, 51)
    ctx.lineTo(63, 74)
    ctx.lineTo(86, 74)
    ctx.lineTo(97, 94)
    ctx.stroke()
  })
  const symbol = new MeshBasicMaterial({ map: accessibility, transparent: true })
  for (const bay of lot.bays.filter(bay => bay.kind === 'accessible')) {
    const mesh = new Mesh(new PlaneGeometry(1.55, 1.55).rotateX(-Math.PI / 2), symbol)
    mesh.position.set(bay.center[0], 0.02, bay.center[1])
    mesh.rotation.y = bay.heading - Math.PI / 2
    world.add(mesh)
  }

  const hardware: BoxSpec[] = []
  const bulbs: BoxSpec[] = []
  for (const { pos: [x, z], height, arms } of lot.lamps) {
    hardware.push({ size: [0.32, 0.48, 0.32], pos: [x, 0.24, z], color: '#7a7062' },
      { size: [0.105, height, 0.105], pos: [x, height / 2, z], color: '#77736b' },
      { size: [0.09, 0.12, arms === 2 ? 1.7 : 0.88], pos: [x, height - 0.07, z + (arms === 1 ? 0.39 : 0)], color: '#79786f' })
    for (const side of (arms === 2 ? [-1, 1] : [1])) {
      bulbs.push({ size: [0.29, 0.12, 0.38], pos: [x, height - 0.12, z + side * 0.81], color: '#ffe2b4' })
    }
  }
  for (const [x, z] of lot.bollards) {
    hardware.push({ size: [0.13, 0.91, 0.13], pos: [x, 0.60, z], color: '#a38d65' })
  }
  for (const [x, z] of lot.trees) {
    const height = 2.65 + random() * 0.75
    hardware.push({ size: [0.14, height, 0.14], pos: [x, height / 2, z], color: '#6b5240' },
      { size: [1.35, 1.37, 1.54], pos: [x + 0.09, height - 0.19, z], color: '#455044', yaw: random() },
      { size: [0.94, 1.02, 1.01], pos: [x - 0.12, height + 0.53, z + 0.1], color: '#505440', yaw: random() })
  }
  for (const bay of lot.bays.filter(bay => lot.corrals.includes(bay.id))) {
    const pose = bayPose(bay)
    for (const side of [-1, 1]) {
      const [x, z] = localPoint(pose, 0, side * 1.1)
      hardware.push({ size: [4.3, 0.1, 0.08], pos: [x, 0.93, z], yaw: bay.heading, color: '#b0a99b' })
      for (const along of [-2, 0, 2]) {
        const [x, z] = localPoint(pose, along, side * 1.1)
        hardware.push({ size: [0.08, 0.96, 0.08], pos: [x, 0.48, z], color: '#b0a99b' })
      }
    }
  }
  batch(world, matte, hardware)
  batch(world, basic, bulbs)
  addStorefront(world, lot)
  return world
}

function addStorefront(world: Group, lot: Lot) {
  const { outline, canopyDepth, height, sign, doors } = lot.building
  const { x1, x2, z2 } = extent(outline)
  const facade = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 })
  const details: BoxSpec[] = [
    slab(outline, height, '#5e5049'),
    { size: [x2 - x1 + 0.5, 0.34, canopyDepth], pos: [(x1 + x2) / 2, 3.45, z2 + canopyDepth / 2], color: '#373542' },
    { size: [x2 - x1, 0.22, 0.18], pos: [(x1 + x2) / 2, height - 0.2, z2 + 0.09], color: '#514a47' },
  ]
  const lit: BoxSpec[] = []
  for (let x = x1 + 2; x < x2 - 1; x += 2.15) {
    const doorway = doors.some(([door]) => Math.abs(door - x) < 1.1)
    lit.push({ size: [1.74, doorway ? 2.62 : 1.88, 0.06], pos: [x, doorway ? 1.49 : 1.87, z2 + 0.04], color: doorway ? '#bc9975' : '#a08061' },
      { size: [0.85, 0.045, 0.12], pos: [x, 3.25, z2 + canopyDepth * 0.73], color: '#ffe0aa' })
    details.push({ size: [0.038, 2.64, 0.065], pos: [x, 1.49, z2 + 0.081], color: '#595353' },
      { size: [1.78, 0.055, 0.08], pos: [x, 2.57, z2 + 0.08], color: '#514a48' })
    if (Math.round(x) % 5 === 0) details.push({ size: [0.17, 3.25, 0.17], pos: [x, 1.7, z2 + canopyDepth - 0.16], color: '#776655' })
  }
  for (const [x, z, width, h] of [[-57, -9, 12, 4.2], [56, -11, 14, 5.1], [55, 23, 16, 4.9], [-26, 53, 14, 4.4], [22, 57, 21, 5.6], [-54, 38, 16, 3.9]]) {
    details.push({ size: [width, h, 8], pos: [x, h / 2, z], color: '#393741' })
    lit.push({ size: [width * 0.22, 0.24, 0.06], pos: [x - width * 0.18, h * 0.67, z + (z < 30 ? 4.06 : -4.06)], color: '#85715e' })
  }
  batch(world, facade, details)
  batch(world, flat('#ffffff'), lit)
  const signTexture = canvasTexture(1024, 152, ctx => {
    ctx.fillStyle = '#fde4b7'
    ctx.font = '600 106px Inter, Segoe UI, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.letterSpacing = '10px'
    ctx.fillText(sign, 512, 76)
  })
  const signMesh = new Mesh(new PlaneGeometry(9.6, 1.425), new MeshBasicMaterial({ map: signTexture, transparent: true }))
  signMesh.position.set(0, 4.86, z2 + 0.12)
  world.add(signMesh)
}
