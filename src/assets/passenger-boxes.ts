import { Group, MeshStandardMaterial } from 'three'
import { carCatalog } from '../simulation/lot.ts'
import type { CarType } from '../simulation/lot.ts'
import { box } from './boxes.ts'

export function passengerBoxes(type: CarType) {
  const { length, width, height, nodes } = carCatalog[type]
  const root = new Group()
  root.name = nodes.root
  const paint = new MeshStandardMaterial({ roughness: 0.62 })
  const trim = new MeshStandardMaterial({ color: '#202634' })
  box(root, paint, [length, height * 0.48, width], [0, height * 0.42, 0], nodes.body)
  box(root, trim, [length * 0.58, height * 0.41, width * 0.86], [-0.15, height * 0.77, 0], nodes.glass)
  for (const side of [-1, 1]) {
    for (const axle of [-1, 1]) box(root, trim, [0.63, 0.63, width * 0.165], [axle * length * 0.32, 0.33, side * width * 0.41], nodes.wheels)
  }
  const light = (name: string, x: number, y: number, color: string) => {
    const material = new MeshStandardMaterial({ color: '#50505a', emissive: color, emissiveIntensity: 0 })
    const pair = new Group()
    pair.name = name
    for (const side of [-1, 1]) box(pair, material, [0.035, 0.07, width * 0.21], [x, y, side * width * 0.34])
    root.add(pair)
  }
  light(nodes.lights_head, length / 2, 0.72, '#ddecff')
  light(nodes.lights_tail, -length / 2, 0.69, '#ff2840')
  light(nodes.lights_brake, -length / 2, 0.77, '#ff2037')
  return root
}
