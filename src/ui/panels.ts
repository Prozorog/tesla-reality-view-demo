import type { NowPlaying } from '../audio/cabin-audio.ts'
import type { Frame } from '../render/dive.ts'
import { HUD_HEIGHT, HUD_WIDTH } from '../render/dive.ts'
import type { Drive } from '../simulation/drive.ts'
import type { ScreenPoint } from './interface.ts'
import { drawIcon } from './icons.ts'
import type { Icon } from './icons.ts'

export type PanelAction = 'start' | 'cancel' | 'end-trip' | 'music-prev' | 'music-toggle' | 'music-next'
export type PanelHit = { kind: PanelAction } | { kind: 'passive'; id: string }
const WHITE = '#fff'
const SECONDARY = '#a8adb5'
const BLUE = '#3e8bff'
const CARD = 'rgba(22,23,26,.86)'
const HOVER = 'rgba(126,163,209,.16)'
const FONT = 'Inter, "Segoe UI", system-ui, sans-serif'
const CLOCK = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
const BATTERY = '78%'

function tripClock(seconds: number) {
  return CLOCK.format(new Date(2026, 0, 1, 22, 3, Math.floor(seconds))).toLowerCase()
}

export function contains(rect: Frame, point: ScreenPoint) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height
}

function timecode(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`
}

function coverArt(dream: boolean) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 144
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const sky = ctx.createLinearGradient(0, 0, 98, 144)
  sky.addColorStop(0, dream ? '#322049' : '#081622')
  sky.addColorStop(0.58, dream ? '#7961a6' : '#204354')
  sky.addColorStop(1, dream ? '#0c3552' : '#070d20')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, 144, 144)
  ctx.fillStyle = dream ? '#e4c1e8' : '#e2cc9c'
  ctx.beginPath()
  ctx.arc(dream ? 100 : 46, 43, dream ? 17 : 13, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = dream ? '#24213e' : '#102331'
  ctx.beginPath()
  ctx.moveTo(0, 95)
  ctx.lineTo(38, 73)
  ctx.lineTo(70, 91)
  ctx.lineTo(105, 78)
  ctx.lineTo(144, 87)
  ctx.lineTo(144, 144)
  ctx.lineTo(0, 144)
  ctx.fill()
  for (let i = 0; i < 11; i++) {
    const y = 95 + i * 3.6, x = (dream ? 99 : 46) + Math.sin(i * 1.9) * (4 + i)
    ctx.strokeStyle = dream ? `rgba(170,208,241,${0.5 - i * 0.036})` : `rgba(233,190,120,${0.49 - i * 0.034})`
    ctx.lineWidth = i % 3 === 1 ? 2.8 : 1.3
    ctx.beginPath()
    ctx.moveTo(x - 6 - i * 1.8, y)
    ctx.quadraticCurveTo(x, y + i % 3, x + 6 + i * 1.8, y)
    ctx.stroke()
  }
  return canvas
}

export class Panels {
  private readonly hitBoxes = new Map<string, { rect: Frame; hit: PanelHit }>()
  private readonly art = [coverArt(false), coverArt(true)]
  private viewport: Frame = { x: 0, y: 0, width: HUD_WIDTH, height: HUD_HEIGHT }
  private scale = 1

  constructor(private readonly ctx: CanvasRenderingContext2D) {}

  draw(drive: Drive, viewport: Frame, music: NowPlaying, notice: boolean, touch?: ScreenPoint) {
    const c = this.ctx
    this.hitBoxes.clear()
    this.viewport = viewport
    const s = this.scale = Math.min(viewport.width / HUD_WIDTH, viewport.height / HUD_HEIGHT)
    const width = viewport.width / s, height = viewport.height / s
    const clock = drive.street ? tripClock(drive.time) : CLOCK.format(new Date()).toLowerCase()
    c.save()
    c.translate(viewport.x, viewport.y)
    c.scale(s, s)
    this.readouts(drive, width, clock, touch)
    this.cards(drive, width, height, clock, music, notice, touch)
    c.restore()
  }

  hit(point: ScreenPoint) {
    for (const { rect, hit } of Array.from(this.hitBoxes.values()).reverse()) {
      if (contains(rect, point)) return hit
    }
  }

  point(id: string): ScreenPoint | undefined {
    const rect = this.hitBoxes.get(id)?.rect
    if (rect) return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  }

  private hotspot(id: string, x: number, y: number, width: number, height: number, touch?: ScreenPoint, action?: PanelAction) {
    const s = this.scale
    const rect = { x: this.viewport.x + x * s, y: this.viewport.y + y * s, width: width * s, height: height * s }
    this.hitBoxes.set(id, { rect, hit: action ? { kind: action } : { kind: 'passive', id } })
    return touch && contains(rect, touch)
  }

  private shape(x: number, y: number, width: number, height: number, radius: number, fill: string) {
    const c = this.ctx
    c.beginPath()
    c.roundRect(x, y, width, height, radius)
    c.fillStyle = fill
    c.fill()
  }

  private text(text: string, x: number, y: number, size: number, weight: number, color = WHITE, align: CanvasTextAlign = 'left') {
    const c = this.ctx
    c.fillStyle = color
    c.font = `${weight} ${size}px ${FONT}`
    c.textAlign = align
    c.textBaseline = 'middle'
    c.fillText(text, x, y)
  }

  private line(x: number, y: number, endX: number, endY: number, color: string) {
    const c = this.ctx
    c.beginPath()
    c.moveTo(x, y)
    c.lineTo(endX, endY)
    c.strokeStyle = color
    c.lineWidth = 1
    c.stroke()
  }

  private button(action: PanelAction, label: string, x: number, y: number, width: number, height: number, touch?: ScreenPoint) {
    const hot = this.hotspot(action, x, y, width, height, touch, action)
    this.shape(x, y, width, height, 10, hot ? '#303744' : CARD)
    this.text(label, x + width / 2, y + height / 2 + 0.5, 17, 600, WHITE, 'center')
  }

  private icon(name: Icon, id: string, x: number, y: number, size: number, touch?: ScreenPoint,
    action?: PanelAction, color = WHITE, targetWidth = 40) {
    if (this.hotspot(id, x - targetWidth / 2, y - 18, targetWidth, 36, touch, action)) {
      this.shape(x - targetWidth / 2, y - 18, targetWidth, 36, 8, HOVER)
    }
    drawIcon(this.ctx, name, x, y, size, color)
  }

  private battery(x: number, y: number, color = WHITE) {
    drawIcon(this.ctx, 'battery', x, y, 22, color)
    this.shape(x - 7.4, y - 2.8, 10.7, 5.6, 1, color)
    this.text(BATTERY, x + 16, y + 0.5, 15, 600, color)
  }

  private readouts(drive: Drive, width: number, clock: string, touch?: ScreenPoint) {
    const c = this.ctx
    const auto = !drive.isManual && drive.gear !== 'P'
    const parked = drive.mode === 'parked'
    const nav = drive.onStreet ? drive.street?.navigation : undefined
    c.save()
    c.shadowColor = 'rgba(0,0,0,.72)'
    c.shadowBlur = 6
    for (const [i, letter] of ['P', 'R', 'N', 'D'].entries()) {
      const active = drive.gear === letter
      const x = 29 + i * 18
      const color = active ? (letter === 'P' ? WHITE : BLUE) : '#797f88'
      if (active) this.shape(x - 7, 33, 14, 1.5, 0.75, color)
      this.text(letter, x, 24, 15, 600, color, 'center')
    }
    this.battery(113, 24)
    if (parked) drawIcon(c, 'topCar', 38, 91, 34, '#c7d7ef')
    const speedX = parked ? 64 : 21
    this.text(String(Math.round(Math.abs(drive.speed) / 0.44704)), speedX, 87, 84, 300)
    this.text('MPH', speedX + 4, 133, 15, 600)
    this.text(auto ? 'Self-Driving' : drive.street && drive.gear === 'P' ? 'Park' : 'Manual', 24, 164, 17, 600, auto ? BLUE : WHITE)
    this.text(nav ? 'San Francisco' : 'Parking Lot', 24, 186, 14, 500, SECONDARY)
    if (!drive.street) this.text('4.3 mi Streak', 24, 205, 14, 500, SECONDARY)
    this.text(clock, width - 114, 25, 15, 600, WHITE, 'right')
    this.text(drive.street ? '58°F' : '47°F', width - 24, 25, 15, 600, WHITE, 'right')
    if (drive.street) this.text('© OpenStreetMap contributors', width - 24, 52, 11, 500, SECONDARY, 'right')
    c.restore()
    const mid = width / 2
    this.icon('lock', 'lock', mid - 22, 25, 19, touch)
    this.icon('camera', 'camera', mid + 22, 25, 19, touch)
    this.icon('moon', 'weather', width - 89, 25, 19, touch, undefined, '#e7d7a8', 30)
    if (drive.status) {
      c.font = `600 19px ${FONT}`
      const w = c.measureText(drive.status).width + 36
      this.shape(mid - w / 2, 50, w, 35, 18, 'rgba(22,23,26,.45)')
      this.text(drive.status, mid, 68, 19, 600, WHITE, 'center')
    }
    if (drive.canCancel && drive.mode !== 'reverse') this.button('cancel', 'Cancel Selection', mid - 87, 93, 174, 39, touch)
    if (nav?.turn) {
      this.shape(20, 199, 252, 38, 8, CARD)
      const arrow = nav.direction > 0 ? '↰' : nav.direction < 0 ? '↱' : '↑'
      const distance = nav.turnDistance >= 100 ? `${(nav.turnDistance / 1609.344).toFixed(1)} mi` : `${Math.round(nav.turnDistance * 3.28084 / 10) * 10} ft`
      this.text(arrow, 41, 218, 23, 700, '#a8cbff', 'center')
      this.text(`${distance}  ${nav.turn}`, 61, 218, 14, 600)
    }
    if (drive.canStart) this.button('start', 'Start Self-Driving', 20, nav ? 248 : 226, 184, 44, touch)
    const signY = nav ? (drive.canStart ? 307 : 252) : (drive.canStart ? 287 : 229)
    this.shape(23, signY, 47, 57, 6, '#f2f4f7')
    this.text('SPEED', 46.5, signY + 11, 8, 700, '#282e39', 'center')
    this.text('LIMIT', 46.5, signY + 20, 8, 700, '#282e39', 'center')
    this.text(nav ? '25' : '15', 46.5, signY + 40, 25, 600, '#1c222c', 'center')
    this.icon('headlight', 'headlight', 38, signY + 78, 23, touch, undefined, '#59ea99', 40)
    this.icon('fog', 'fog', 38, signY + 108, 23, touch, undefined, '#8dd6af', 40)
    if (nav?.reason && auto) this.text(nav.reason, 24, signY + 140, 14, 600, '#c8d9f5')
  }

  private cards(drive: Drive, width: number, height: number, clock: string, music: NowPlaying, notice: boolean, touch?: ScreenPoint) {
    const dockY = height - 56, bottom = dockY - 14
    const x = width / 2 - 246, tripX = x + 514, y = bottom - 150
    const middle = 'rgba(201,214,234,.15)'
    const mapHot = this.hotspot('map', 20, bottom - 48, 101, 48, touch)
    this.shape(20, bottom - 48, 101, 48, 10, mapHot ? '#303744' : CARD)
    drawIcon(this.ctx, 'map', 43, bottom - 24, 23)
    this.text('Map', 64, bottom - 24, 16, 600)
    const moonHot = this.hotspot('night', 130, bottom - 48, 49, 48, touch)
    this.shape(130, bottom - 48, 49, 48, 10, moonHot ? '#303744' : CARD)
    drawIcon(this.ctx, 'moon', 154.5, bottom - 24, 24)

    if (notice) {
      this.hotspot('parking-notice', x, y - 77, 500, 67)
      this.shape(x, y - 77, 500, 67, 10, 'rgba(92,20,23,.89)')
      this.text('Be attentive – Keep your eyes on the road', x + 18, y - 56, 17, 650)
      this.text('Be prepared to take over at any time', x + 18, y - 31, 15, 500, '#ffe0df')
    }
    this.hotspot('music-card', x, y, 500, 150)
    this.shape(x, y, 500, 150, 10, CARD)
    const c = this.ctx
    c.save()
    c.beginPath()
    c.roundRect(x + 13, y + 12, 72, 72, 7)
    c.clip()
    c.drawImage(this.art[music.index], x + 13, y + 12, 72, 72)
    c.restore()
    this.text(music.title, x + 99, y + 28, 19, 600)
    this.text(music.artist, x + 99, y + 54, 15, 500, SECONDARY)
    this.icon('shuffle', 'shuffle', x + 465, y + 34, 21, touch, undefined, SECONDARY)
    const barX = x + 137, barY = y + 79, barWidth = 307
    this.text(timecode(music.time), x + 99, barY + 1, 11, 500, SECONDARY)
    this.text(timecode(music.duration), x + 485, barY + 1, 11, 500, SECONDARY, 'right')
    this.shape(barX, barY - 1, barWidth, 3, 1.5, 'rgba(187,207,241,.24)')
    const progress = Math.min(1, music.time / music.duration) * barWidth
    if (progress > 0) this.shape(barX, barY - 1, progress, 3, 1.5, '#8fbbff')
    this.line(x + 13, y + 97, x + 487, y + 97, middle)
    this.icon('previous', 'music-prev', x + 58, y + 124, 24, touch, 'music-prev', WHITE, 56)
    this.icon(music.playing ? 'pause' : 'play', 'music-toggle', x + 127, y + 124, 26, touch, 'music-toggle', '#d8eaff', 56)
    this.icon('next', 'music-next', x + 196, y + 124, 24, touch, 'music-next', WHITE, 56)
    this.icon('sliders', 'sound-settings', x + 406, y + 124, 20, touch, undefined, SECONDARY, 50)
    this.icon('search', 'music-search', x + 464, y + 124, 21, touch, undefined, SECONDARY, 50)

    this.hotspot('trip-card', tripX, y, 300, 150)
    this.shape(tripX, y, 300, 150, 10, CARD)
    const arrival = drive.street && drive.onStreet ? tripClock(drive.time + drive.street.navigation.eta) : clock
    this.text(arrival, tripX + 17, y + 28, 15, 500, SECONDARY)
    this.text(drive.street ? 'Palace of Fine Arts' : 'Northgate Plaza', tripX + 17, y + 62, 20, 600)
    if (drive.street) {
      const nav = drive.street.navigation
      const eta = drive.onStreet ? `${Math.max(1, Math.ceil(nav.eta / 60))} min · ${(nav.remaining / 1609.344).toFixed(1)} mi` : 'Arrived'
      this.text(eta, tripX + 17, y + 83, 13, 600, SECONDARY)
    }
    this.battery(tripX + 229, y + 28, '#dfe7f2')
    this.line(tripX + 14, y + 97, tripX + 286, y + 97, middle)
    this.icon('pin', 'trip-pin', tripX + 35, y + 124, 22, touch, undefined, SECONDARY, 47)
    const endHot = this.hotspot('end-trip', tripX + 75, y + 106, 150, 36, touch, 'end-trip')
    if (endHot) this.shape(tripX + 75, y + 106, 150, 36, 8, HOVER)
    this.text('End Trip', tripX + 150, y + 124, 16, 600, WHITE, 'center')
    this.icon('more', 'trip-more', tripX + 265, y + 124, 21, touch, undefined, SECONDARY, 47)

    this.hotspot('dock', 0, dockY, width, 56)
    this.shape(0, dockY, width, 56, 0, 'rgba(13,15,19,.94)')
    const dockIcons = ['car', 'climate', 'seat', 'wheel', 'camera', 'music', 'apps', 'volume'] as const
    for (const [i, icon] of dockIcons.entries()) {
      const at = width * (0.10 + i * 0.80 / 7)
      if (icon === 'climate') {
        if (this.hotspot('climate', at - 39, dockY + 10, 78, 36, touch)) this.shape(at - 39, dockY + 10, 78, 36, 8, HOVER)
        this.text('70', at, dockY + 28, 24, 500, WHITE, 'center')
        drawIcon(c, 'chevron', at + 29, dockY + 29, 12, SECONDARY)
      } else this.icon(icon, 'dock-' + icon, at, dockY + 28, 23, touch, undefined, icon === 'music' ? '#a8c7f5' : '#dce4ef', 57)
    }
  }
}
