import {
  ACESFilmicToneMapping, BackSide, Color, DirectionalLight, Float32BufferAttribute, Mesh, MeshBasicMaterial,
  MeshNormalMaterial, MeshStandardMaterial, PCFSoftShadowMap, PerspectiveCamera, PlaneGeometry, PMREMGenerator, Scene, SphereGeometry,
  Vector3, WebGLRenderer,
} from 'three'
import { loadExterior } from '../assets/car-models.ts'
import cameras from '../../scripts/modelx/cameras.json'

type Angle = keyof typeof cameras
const toWorld = ([x, y, z]: number[]) => new Vector3(x, z, -y)

// A grey photo studio like the reference set: dim concrete floor, light walls
// and one broad overhead softbox. Shoulders facing up catch the softbox, the
// lower doors turning under see the floor and fall off, as in the photos.
const tune = (key: string, value: number) => Number(new URLSearchParams(location.search).get(key) ?? value)

function photoStudio() {
  const room = new Scene()
  const floor = tune('floor', 0.035), wall = tune('wall', 0.6), box = tune('box', 4.2), side = tune('strip', 1.5)
  const sphere = new SphereGeometry(40, 64, 32)
  const position = sphere.getAttribute('position')
  const colors = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) {
    const h = position.getY(i) / 40
    const value = h < -0.02 ? floor + 0.05 * Math.max(0, 1 + h * 4)
      : h < 0.45 ? wall - 0.18 * h : wall - 0.08 - 0.25 * (h - 0.45)
    colors.set([value, value, value * 1.015], i * 3)
  }
  sphere.setAttribute('color', new Float32BufferAttribute(colors, 3))
  room.add(new Mesh(sphere, new MeshBasicMaterial({ side: BackSide, vertexColors: true })))
  const softbox = new Mesh(new PlaneGeometry(16, 7), new MeshBasicMaterial({ color: new Color(1, 1, 1).multiplyScalar(box) }))
  softbox.rotation.x = Math.PI / 2
  softbox.position.set(1.4, 9, 0)
  room.add(softbox)
  // Two long side strips draw the shoulder highlight along the doors.
  for (const z of [-9, 9]) {
    const strip = new Mesh(new PlaneGeometry(18, 1.1), new MeshBasicMaterial({ color: new Color(1, 1, 1).multiplyScalar(side), side: BackSide }))
    strip.position.set(1.4, 5.2, z)
    strip.lookAt(1.4, 0.6, 0)
    room.add(strip)
  }
  return room
}

export async function showModelXStudio(container: HTMLElement, angle: string) {
  const fit = cameras[Object.hasOwn(cameras, angle) ? angle as Angle : 'side']
  const renderer = new WebGLRenderer({ antialias: true })
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.toneMappingExposure = tune('exposure', 0.92)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = PCFSoftShadowMap
  container.append(renderer.domElement)
  const studio = new Scene()
  studio.background = new Color(0xb9babb)
  const pmrem = new PMREMGenerator(renderer)
  const room = photoStudio()
  const env = pmrem.fromScene(room, 0.02)
  studio.environment = env.texture
  studio.environmentIntensity = 1
  pmrem.dispose()
  const car = await loadExterior(true)
  car.root.traverse(node => { if (node instanceof Mesh) node.castShadow = true })
  studio.add(car.root)
  const light = new DirectionalLight(0xffffff, tune('sun', 0.55))
  light.position.set(1.5, 9, 0.6)
  light.castShadow = true
  light.shadow.mapSize.set(2048, 2048)
  light.shadow.radius = 6
  light.shadow.normalBias = 0.012
  studio.add(light)
  const floor = new Mesh(new PlaneGeometry(100, 100), new MeshStandardMaterial({ color: 0x5c5c5c, roughness: 0.9 }))
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -0.002
  floor.receiveShadow = true
  studio.add(floor)
  // ?studio=side&normals=1 shows the exported shading normals.
  if (new URLSearchParams(location.search).has('normals')) studio.overrideMaterial = new MeshNormalMaterial()
  const cam = new PerspectiveCamera()
  cam.position.copy(toWorld(fit.location))
  cam.up.copy(toWorld(fit.up))
  cam.lookAt(cam.position.clone().sub(toWorld(fit.back)))
  function draw() {
    renderer.setSize(innerWidth, innerHeight)
    const scale = Math.min(innerWidth / 1376, innerHeight / 768)
    const ox = (innerWidth - 1376 * scale) / 2 + fit.cx * scale
    const oy = (innerHeight - 768 * scale) / 2 + fit.cy * scale
    const near = 0.05, dx = near / (fit.focal_px * scale), dy = dx / fit.aspect
    cam.projectionMatrix.makePerspective(-ox * dx, (innerWidth - ox) * dx, oy * dy, -(innerHeight - oy) * dy, near, 110)
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert()
    renderer.render(studio, cam)
  }
  window.addEventListener('resize', draw)
  draw()
  container.dataset.ready = 'true'
}
