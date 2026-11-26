const paths = {
  lock: 'M7 10h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z M8.5 10V7a3.5 3.5 0 0 1 7 0v3 M12 14v3',
  camera: 'M3 6h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z M17 10l5-3v10l-5-3',
  moon: 'M19.8 15.7A8.4 8.4 0 0 1 8.3 4.2a8.4 8.4 0 1 0 11.5 11.5Z M17.5 3.5v5 M15 6h5',
  map: 'M17 8c0 3.6-5 7.2-5 7.2S7 11.6 7 8a5 5 0 0 1 10 0Z M13.4 8a1.4 1.4 0 1 1-2.8 0 1.4 1.4 0 0 1 2.8 0Z M6.3 13.8 2 16.5 12 22l10-5.5-4.3-2.7',
  pin: 'M14.5 9c0 3.6-5.4 8-5.4 8S4 12.6 4 9a5.25 5.25 0 1 1 10.5 0Z M10.6 9a1.45 1.45 0 1 1-2.9 0 1.45 1.45 0 0 1 2.9 0Z M18.5 12.5v6 M15.5 15.5h6',
  previous: 'M5 6v12 M19 6l-10 6 10 6Z',
  next: 'M19 6v12 M5 6l10 6-10 6Z',
  play: 'M8 5l11 7-11 7Z',
  pause: 'M8.5 5.5v13 M15.5 5.5v13',
  shuffle: 'M3 6h2c4 0 5.5 4 7 6s3.5 6 7 6h2 M18 15l3 3-3 3 M3 18h2c2.5 0 4-1.6 5.3-3.5 M14 9c1.4-1.8 2.9-3 5-3h2 M18 3l3 3-3 3',
  sliders: 'M5 3v5m0 4v9 M3 8h4v4H3Z M12 3v10m0 4v4 M10 13h4v4h-4Z M19 3v3m0 4v11 M17 6h4v4h-4Z',
  search: 'M16.5 10a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z M15 15l5 5',
  more: 'M4 12h1 M11.5 12h1 M19 12h1',
  car: 'M3 10 5.5 5.5h13L21 10v7H3Z M3 10h18 M6 13.5h2 M16 13.5h2 M5 17v3 M19 17v3',
  topCar: 'M6.5 19V11c0-3 2-4.5 5.5-4.5s5.5 1.5 5.5 4.5v8c0 2-1.5 3-5.5 3s-5.5-1-5.5-3Z M7 12.5q5-2 10 0 M7 17q5 2 10 0 M12 5V1.5 M9.5 3.8 12 1.5l2.5 2.3',
  seat: 'M5 7v6.8c0 3 1.5 5 4.8 5H20 M5 13.5h5.5c2.2 0 3.4 1 4 3h4.5 M9 10q2-2 0-4t0-4 M14 10q2-2 0-4t0-4 M19 10q2-2 0-4t0-4',
  wheel: 'M20 14a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z M4 13h16 M9 13l3 5 3-5 M12 18v4 M9 4q2-2 0-3 M14 4q2-2 0-3',
  music: 'M9 17.5V5l11-2v12 M9 9l11-2 M9 17.5c0 1.5-1.4 2.5-3.2 2.5S3 19 3 18s1.4-2.4 3.2-2.4S9 16.3 9 17.5Z M20 15.3c0 1.5-1.4 2.7-3.2 2.7s-2.8-.8-2.8-2.1 1.4-2.6 3.2-2.6 2.8.8 2.8 2Z',
  apps: 'M4 4h6v6H4Z M14 4h6v6h-6Z M4 14h6v6H4Z M14 14h6v6h-6Z',
  volume: 'M3 10h4l5-4v12l-5-4H3Z M15 9a4 4 0 0 1 0 6 M18 6a8 8 0 0 1 0 12',
  headlight: 'M11 6h3a6 6 0 1 1 0 12h-3q-1.5-6 0-12Z M2 9l6-2 M2 13l6-2 M2 17l6-2 M2 21l6-2',
  fog: 'M11 6h3a6 6 0 1 1 0 12h-3q-1.5-6 0-12Z M2 8h6 M2 12h6 M2 16h6 M5 6q2.5 3 0 7t0 6',
  battery: 'M2 7h17v10H2Z M22 10v4',
  chevron: 'M9 5l6 7-6 7',
} as const

export type Icon = keyof typeof paths
const icons = Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, new Path2D(path)])) as Record<Icon, Path2D>

export function drawIcon(ctx: CanvasRenderingContext2D, name: Icon, x: number, y: number, size: number, color = '#fff') {
  ctx.save()
  ctx.translate(x - size / 2, y - size / 2)
  ctx.scale(size / 24, size / 24)
  ctx.strokeStyle = color
  ctx.lineWidth = 1.75 * 24 / size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke(icons[name])
  ctx.restore()
}
