import { ease } from '../render/dive.ts'
import type { Drive, Mode } from '../simulation/drive.ts'
import { clamp } from '../simulation/geometry.ts'

const TRACKS = [
  { file: 'night-on-the-docks-piano.mp3', title: 'Night on the Docks - Piano', artist: 'Kevin MacLeod', duration: 174 },
  { file: 'dream-culture.mp3', title: 'Dream Culture', artist: 'Kevin MacLeod', duration: 214 },
] as const

export type NowPlaying = { index: number; title: string; artist: string; time: number; duration: number; playing: boolean }

export class CabinAudio {
  private readonly player = new Audio()
  private index = 0
  private wanted = false
  private context?: AudioContext
  private filter?: BiquadFilterNode
  private humGain?: GainNode
  private hum?: OscillatorNode
  private mode: Mode = 'idle'
  private blink = -1
  private nextBeep = 0

  constructor(private readonly base: string, changed: () => void) {
    this.player.preload = 'metadata'
    this.loadTrack()
    this.player.addEventListener('ended', () => this.changeTrack(1))
    for (const event of ['loadedmetadata', 'play', 'pause', 'timeupdate']) this.player.addEventListener(event, changed)
  }

  get music(): NowPlaying {
    const track = TRACKS[this.index]
    return {
      index: this.index, title: track.title, artist: track.artist, time: this.player.currentTime,
      duration: Number.isFinite(this.player.duration) ? this.player.duration : track.duration, playing: !this.player.paused,
    }
  }

  get started() { return !!this.context }

  unlock(playMusic: boolean, dive: number) {
    if (!this.context) {
      const context = new AudioContext()
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.Q.value = 0.54
      filter.frequency.value = this.cutoff(dive)
      const musicGain = context.createGain()
      musicGain.gain.value = 0.21
      context.createMediaElementSource(this.player).connect(filter).connect(musicGain).connect(context.destination)
      const hum = context.createOscillator()
      const humGain = context.createGain()
      hum.type = 'triangle'
      hum.frequency.value = 49
      humGain.gain.value = 0
      hum.connect(humGain).connect(context.destination)
      hum.start()
      this.context = context
      this.filter = filter
      this.hum = hum
      this.humGain = humGain
      if (playMusic) this.play()
    }
    if (this.context.state === 'suspended') void this.context.resume().catch(() => {})
  }

  toggle() {
    if (this.wanted) {
      this.wanted = false
      this.player.pause()
    } else this.play()
  }

  changeTrack(direction: -1 | 1) {
    this.index = (this.index + TRACKS.length + direction) % TRACKS.length
    this.loadTrack()
    if (this.wanted) this.play()
  }

  private loadTrack() { this.player.src = `${this.base}music/${TRACKS[this.index].file}` }

  private play() {
    this.wanted = true
    const src = this.player.src
    void this.player.play().catch(error => {
      if (error.name !== 'AbortError' && src === this.player.src) this.wanted = false
    })
  }

  tap() { this.note(660, 0.037, 0.021) }

  private cutoff(progress: number) { return 1090 * 17 ** ease(progress) }

  private note(frequency: number, duration: number, volume: number, delay = 0) {
    const context = this.context
    if (!context) return
    const t = context.currentTime + delay
    const tone = context.createOscillator()
    const shape = context.createGain()
    tone.type = 'sine'
    tone.frequency.value = frequency
    shape.gain.setValueAtTime(0, t)
    shape.gain.linearRampToValueAtTime(volume, t + 0.009)
    shape.gain.exponentialRampToValueAtTime(0.0001, t + duration)
    tone.connect(shape).connect(context.destination)
    tone.start(t)
    tone.stop(t + duration + 0.01)
  }

  update(drive: Drive, dive: number, rearProximity: number) {
    const context = this.context
    const was = this.mode
    this.mode = drive.mode
    if (!context) return
    const now = context.currentTime
    this.filter!.frequency.setTargetAtTime(this.cutoff(dive), now, 0.045)
    this.hum!.frequency.setTargetAtTime(47 + Math.abs(drive.speed) * 2.4, now, 0.12)
    this.humGain!.gain.setTargetAtTime(0.018 * (1 - ease(dive)), now, 0.08)
    if (was !== this.mode) {
      if (this.mode === 'parked') {
        this.note(262, 0.31, 0.031)
        this.note(392, 0.32, 0.024, 0.085)
        this.note(523, 0.34, 0.019, 0.15)
      } else if (this.mode === 'manual') {
        this.note(540, 0.18, 0.029)
        this.note(405, 0.22, 0.022, 0.075)
      } else if ((was === 'idle' || was === 'parked' || was === 'manual') && this.mode !== 'idle') {
        this.note(392, 0.18, 0.028)
        this.note(588, 0.24, 0.023, 0.085)
      }
    }
    const blink = drive.indicator ? Math.floor(drive.time * 3.1) : -1
    if (blink !== this.blink && blink >= 0) this.note(blink % 2 ? 345 : 452, 0.049, 0.018)
    this.blink = blink
    if (drive.gear === 'R' && rearProximity > 0 && now >= this.nextBeep) {
      const near = clamp(rearProximity, 0, 1)
      this.note(570 + near * 53, 0.105, 0.020 + near * 0.009)
      this.nextBeep = now + 0.91 - 0.65 * near
    } else if (drive.gear !== 'R' || rearProximity <= 0) this.nextBeep = 0
  }
}
