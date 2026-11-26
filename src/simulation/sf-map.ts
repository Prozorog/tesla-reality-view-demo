import type { Point } from './lot.ts'

export type SfRoad = {
  id: number | string
  name: string
  points: Point[]
  width: number
  lanes: number
  oneway: number
  kind: string
}

export type SfSegment = Omit<SfRoad, 'id' | 'kind'> & {
  way: number
  start: number
  length: number
}

export type SfControl = {
  id: number | string
  pos: Point
  kind: 'signal' | 'stop'
  crossing: boolean
  street: string
  station: number
}

export type SfMap = {
  origin: [latitude: number, longitude: number]
  segments: SfSegment[]
  roads: SfRoad[]
  controls: SfControl[]
  crosswalks: { pos: Point; road: string | number }[]
  buildings: { id: number; outline: Point[]; height: number; levels: number; commercial: boolean }[]
  parks: { name: string; outline: Point[] }[]
  water: { id: string; name: string; outline: Point[]; kind: 'lagoon' | 'marina' }[]
  trees: Point[]
  lotPolygon: Point[]
  rotunda: Point
}
