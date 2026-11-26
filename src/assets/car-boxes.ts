import {
  BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PlaneGeometry,
  TorusGeometry, Vector3,
} from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { CENTER_OFFSET, FRONT, REAR, TRACK, WHEELBASE, WHEEL_RADIUS } from '../simulation/geometry.ts'
import { SCREEN_HEIGHT, SCREEN_WIDTH } from '../render/dive.ts'
import { beam, box, flat } from './boxes.ts'

export function exteriorBoxes() {
  const root = new Group()
  root.name = 'model3'
  const dark = new MeshStandardMaterial({ color: '#1b1d21', roughness: 0.47, metalness: 0.14 })
  const top = new MeshStandardMaterial({ color: '#353843', roughness: 0.39, metalness: 0.26 })
  const glass = new MeshStandardMaterial({ color: '#080c17', roughness: 0.26, metalness: 0.23 })
  const trim = new MeshStandardMaterial({ color: '#14151c', roughness: 0.7 })
  box(root, dark, [FRONT - REAR, 0.45, 1.85], [CENTER_OFFSET, 0.57, 0], 'body')
  box(root, top, [4.48, 0.16, 1.73], [CENTER_OFFSET, 0.836, 0])
  box(root, trim, [4.57, 0.15, 1.79], [CENTER_OFFSET, 0.29, 0], 'trim_black')
  box(root, glass, [2.36, 0.46, 1.48], [1.13, 1.119, 0], 'glass')
  box(root, top, [1.64, 0.077, 1.425], [1.07, 1.398, 0])
  box(root, new MeshStandardMaterial({ color: '#050608', roughness: 0.26, metalness: 0.23 }),
    [1.46, 0.036, 1.29], [1.07, 1.444, 0])
  box(root, flat('#a2a4b0'), [0.025, 0.022, 0.22], [REAR - 0.012, 0.83, 0], 'wordmark')
  for (const [side, name] of [[-1, 'L'], [1, 'R']] as const) {
    box(root, top, [0.21, 0.087, 0.16], [2.31, 1.03, side * 0.964], `mirror_${name}`)
  }

  const tire = new CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.235, 14).rotateX(Math.PI / 2)
  const hub = new CylinderGeometry(0.207, 0.207, 0.24, 12).rotateX(Math.PI / 2)
  const alloy = new MeshStandardMaterial({ color: '#62626b', roughness: 0.68 })
  const wheels = []
  for (const [name, x, z] of [['FL', WHEELBASE, -TRACK / 2], ['FR', WHEELBASE, TRACK / 2], ['RL', 0, -TRACK / 2], ['RR', 0, TRACK / 2]] as const) {
    const wheel = new Mesh(tire, trim)
    wheel.position.set(x, WHEEL_RADIUS, z)
    wheel.name = `wheel_${name}`
    wheel.add(new Mesh(hub, alloy))
    root.add(wheel)
    wheels.push(wheel)
  }

  const paired = (x: number, y: number, side: number, width: number) => [[x, y, -side, width], [x, y, side, width]]
  function light(name: string, color: string, entries: number[][]) {
    const parts = entries.map(([x, y, z, width]) => new BoxGeometry(0.045, 0.041, width).translate(x, y, z))
    const node = new Mesh(mergeGeometries(parts), new MeshStandardMaterial({
      color: '#1e2028', emissive: color, emissiveIntensity: 0, roughness: 0.42,
    }))
    for (const part of parts) part.dispose()
    node.name = name
    root.add(node)
    return node
  }
  const lights = {
    head: light('lights_head', '#dceeff', paired(FRONT + 0.012, 0.785, 0.67, 0.38)),
    tail: light('lights_tail', '#ff253b', paired(REAR - 0.015, 0.787, 0.65, 0.44)),
    brake: light('lights_brake', '#ff2636', paired(REAR - 0.016, 0.837, 0.65, 0.41)),
    reverse: light('lights_reverse', '#e6efff', paired(REAR - 0.016, 0.697, 0.61, 0.23)),
    left: light('indicators_left', '#ffac2a', [[REAR - 0.018, 0.743, -0.75, 0.24]]),
    right: light('indicators_right', '#ffac2a', [[REAR - 0.018, 0.743, 0.75, 0.24]]),
  }
  const rearCameraMount = new Object3D()
  rearCameraMount.position.set(REAR - 0.045, 0.99, 0)
  root.add(rearCameraMount)

  return { root, wheels, lights, rearCameraMount, footprint: { front: FRONT, rear: REAR, width: 1.85, height: 1.44 } }
}

export function cabinBoxes() {
  const root = new Group()
  root.name = 'cabin'
  const matte = (color: string) => new MeshStandardMaterial({ color, roughness: 0.9 })
  const dash = matte('#1a1c22'), lower = matte('#11141a'), fabric = matte('#555963')
  const floor = matte('#18191e'), seat = matte('#242630')
  const metal = matte('#686b76')
  box(root, floor, [3.23, 0.08, 1.75], [1.04, 0.245, 0], 'cabin_floor')
  box(root, lower, [0.42, 0.29, 1.72], [2.09, 0.594, 0], 'lower_dash')
  box(root, dash, [0.45, 0.11, 1.74], [2.11, 0.791, 0], 'upper_dash')
  box(root, fabric, [0.025, 0.055, 1.72], [1.874, 0.752, 0], 'dash_fabric')
  box(root, lower, [1.18, 0.42, 0.24], [1.33, 0.432, 0], 'console')
  box(root, dash, [0.85, 0.045, 0.25], [1.32, 0.654, 0], 'console_top')
  box(root, dash, [1.0, 0.07, 1.66], [2.83, 0.889, 0], 'hood')
  box(root, lower, [0.75, 0.09, 1.64], [0.93, 1.458, 0], 'roof_header')
  const strip = new MeshStandardMaterial({ color: '#ff301e', emissive: '#ff2a1f', emissiveIntensity: 1.1 })
  const stripRoot = new Group()
  stripRoot.name = 'light_strip'
  root.add(stripRoot)
  box(stripRoot, strip, [0.009, 0.006, 1.73], [1.859, 0.715, 0])
  for (const side of [-1, 1]) {
    const suffix = side === -1 ? 'L' : 'R'
    box(root, lower, [2.43, 0.48, 0.11], [1.10, 0.525, side * 0.85], `door_${suffix}`)
    box(root, dash, [1.4, 0.079, 0.10], [1.22, 0.805, side * 0.84], `sill_${suffix}`)
    box(stripRoot, strip, [1.29, 0.006, 0.009], [1.085, 0.747, side * 0.792])
    const pillar = beam(root, dash, new Vector3(2.26, 0.857, side * 0.84), new Vector3(1.25, 1.468, side * 0.73), 0.079, 0.087)
    pillar.name = `pillar_${suffix}`
    box(root, seat, [0.67, 0.17, 0.48], [0.99, 0.413, side * 0.38])
    const back = box(root, seat, [0.14, 0.67, 0.46], [0.65, 0.734, side * 0.38])
    back.rotation.z = 0.13
  }

  const steeringColumn = new Group()
  steeringColumn.position.set(1.80, 0.90, -0.37)
  steeringColumn.rotation.y = -Math.PI / 2
  steeringColumn.rotateX(-22 * Math.PI / 180)
  const steeringWheel = new Group()
  steeringWheel.name = 'steering_wheel'
  root.add(steeringColumn)
  steeringColumn.add(steeringWheel)
  steeringWheel.add(new Mesh(new TorusGeometry(0.169, 0.018, 10, 40), matte('#292a32')))
  box(steeringWheel, dash, [0.164, 0.106, 0.036], [0, -0.010, 0.016], 'wheel_hub')
  box(steeringWheel, metal, [0.255, 0.026, 0.018], [0, 0.007, -0.003])
  box(steeringWheel, metal, [0.036, 0.141, 0.018], [0, -0.087, -0.003])
  box(steeringWheel, flat('#646671'), [0.033, 0.005, 0.005], [0, -0.008, 0.037])

  const tablet = new Group()
  tablet.position.set(1.93, 0.93, 0)
  tablet.rotation.y = -Math.PI / 2
  tablet.rotateX(-8 * Math.PI / 180)
  root.add(tablet)
  box(root, lower, [0.09, 0.20, 0.059], [2.042, 0.836, 0], 'screen_stalk')
  box(tablet, flat('#08090e'), [SCREEN_WIDTH + 0.017, SCREEN_HEIGHT + 0.017, 0.012], [0, 0, -0.008], 'screen_bezel')
  const screenSurface = new Mesh(new PlaneGeometry(SCREEN_WIDTH, SCREEN_HEIGHT), new MeshBasicMaterial({ color: '#ffffff' }))
  screenSurface.name = 'screen_surface'
  tablet.add(screenSurface)

  const eye = new Object3D()
  eye.name = 'eye_driver'
  eye.position.set(1.38, 1.14, -0.37)
  root.add(eye)
  box(root, lower, [0.032, 0.071, 0.22], [1.83, 1.345, 0], 'rear_view_mirror_housing')
  const mirrorGeometry = new PlaneGeometry(0.203, 0.055).rotateY(-Math.PI / 2)
  const uv = mirrorGeometry.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, 1 - uv.getX(i), 0.48 + 0.45 * uv.getY(i))
  const rearViewMirror = new Mesh(mirrorGeometry, flat('#aeb7c7'))
  rearViewMirror.position.set(1.812, 1.345, 0)
  rearViewMirror.name = 'rear_view_mirror'
  root.add(rearViewMirror)
  return { root, eye, steeringWheel, screenSurface, rearViewMirror }
}
