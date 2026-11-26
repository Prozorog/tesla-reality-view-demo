import { HUD_HEIGHT, HUD_WIDTH } from './dive.ts'
import type { Frame } from './dive.ts'

/**
 * The part of the Reality View picture not covered by interface, in logical
 * HUD coordinates (the reality camera spans 0..HUD_WIDTH × 0..HUD_HEIGHT).
 * The panel numbers mirror `Panels.readouts`, `Panels.cards` and the rear inset.
 */
export type SafeArea = { left: number; top: number; right: number; bottom: number; inset?: Frame }

export type SafeFlags = { notice: boolean; cancel: boolean; inset: boolean }

const MARGIN = 8

export function safeArea(frame: Frame, flags: SafeFlags): SafeArea {
  const s = Math.min(frame.width / HUD_WIDTH, frame.height / HUD_HEIGHT)
  const height = frame.height / s
  // Status label 50..85, Cancel Selection 93..132.
  const top = frame.y + ((flags.cancel ? 132 : 85) + MARGIN) * s
  // Cards: music and navigation tops at height - 220, the notice 77 above them.
  const bottom = frame.y + (height - 220 - (flags.notice ? 77 : 0) - MARGIN) * s
  // 12 % in from the sides and clear of the speed column (text ends near 150).
  const left = frame.x + Math.max(0.12 * frame.width, 160 * s)
  const right = frame.x + 0.88 * frame.width
  const area: SafeArea = { left, top, right, bottom }
  if (flags.inset) {
    const width = 320 * s, inset = 200 * s
    area.inset = {
      x: frame.x + frame.width - width - 24 * s - MARGIN * s, y: frame.y + 52 * s - MARGIN * s,
      width: width + 2 * MARGIN * s, height: inset + 2 * MARGIN * s,
    }
  }
  return area
}

/** True when the logical point lies in the safe box and outside the inset. */
export function insideSafe(area: SafeArea, x: number, y: number) {
  if (x < area.left || x > area.right || y < area.top || y > area.bottom) return false
  const inset = area.inset
  return !inset || x < inset.x || x > inset.x + inset.width || y < inset.y || y > inset.y + inset.height
}
