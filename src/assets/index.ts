import { Group, Vector3 } from 'three'
import type { Object3D } from 'three'
import type { Lot } from '../simulation/lot.ts'
import type { SfMap } from '../simulation/sf-map.ts'
import { LotOcclusion } from '../render/lot-occlusion.ts'
import { cabinBoxes, exteriorBoxes } from './car-boxes.ts'
import { loadCabin, loadExterior } from './car-models.ts'
import type { Cabin, Exterior } from './car-models.ts'
import { lotBoxes } from './lot-boxes.ts'
import { loadLot } from './lot-model.ts'
import type { ParkedBake } from './lot-model.ts'
import { loadPassengers, PassengerPack } from './passengers.ts'
import { prepareTablet } from './tablet.ts'

export const LOT_LAYER = 0
export const EXTERIOR_LAYER = 1
export const CABIN_LAYER = 2
export const RIBBON_LAYER = 3

export function putOnLayer(root: Object3D, layer: number) {
  root.traverse(object => object.layers.set(layer))
}

function fallbackCabin(): Cabin {
  const { root, eye, steeringWheel, screenSurface, rearViewMirror } = cabinBoxes()
  return {
    root, eye, steeringWheel, steeringAxis: new Vector3(0, 0, 1),
    tablet: prepareTablet(root, screenSurface),
    bindMirror: texture => {
      rearViewMirror.material.map = texture
      rearViewMirror.material.color.multiplyScalar(0.45)
    },
  }
}

export async function createAssets(lot: Lot, sfMap?: SfMap) {
  const fallbacks: string[] = []
  function load<T>(file: string, result: Promise<T>, fallback: () => T | Promise<T>) {
    return result.catch(error => {
      fallbacks.push(file)
      console.warn(`Using fallback for ${file}`, error)
      return fallback()
    })
  }
  const cityAssets = sfMap ? (async () => {
    const [{ SfWorld }, { loadSfFacadeKit }, { loadSfLandmarks }, { createSfFurniture }] = await Promise.all([
      import('./sf-world.ts'), import('./sf-facades.ts'), import('./sf-landmarks.ts'), import('./sf-furniture.ts'),
    ])
    const [facades, landmarks] = await Promise.all([
      load('sf/facades.glb', loadSfFacadeKit(), () => undefined),
      load('sf landmarks', loadSfLandmarks(sfMap), () => undefined),
    ])
    const city = new SfWorld(sfMap, lot, facades, landmarks)
    city.root.add(createSfFurniture(sfMap, lot))
    return city
  })() : Promise.resolve(undefined)
  const [city, northgate, exterior, cabin, passengers] = await Promise.all([
    cityAssets,
    sfMap ? undefined : load<{ world: Object3D; parkedCars: Record<string, ParkedBake>; occlusion: LotOcclusion }>(
      'lot.glb', loadLot(), () => ({ world: lotBoxes(lot), parkedCars: {}, occlusion: new LotOcclusion() })),
    load<Exterior>('hero.glb', loadExterior(), exteriorBoxes),
    load('cabin.glb', loadCabin(), fallbackCabin),
    load('cars.glb', loadPassengers(), () => new PassengerPack().loadPaint(true)),
  ])

  putOnLayer(exterior.root, EXTERIOR_LAYER)
  putOnLayer(cabin.root, CABIN_LAYER)
  const car = new Group()
  car.add(exterior.root, cabin.root)
  const { world, parkedCars, occlusion } = city ? { world: city.root, parkedCars: {}, occlusion: new LotOcclusion() } : northgate!
  return { world, city, parkedCars, occlusion, car, exterior, cabin, passengers, fallbacks }
}

export type Assets = Awaited<ReturnType<typeof createAssets>>
