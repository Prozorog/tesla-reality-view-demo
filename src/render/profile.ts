type DrawCount = { calls: number; triangles: number }
type Stage = { cpu: number[]; gpu: number[]; calls: number; triangles: number }

export class RenderProfile {
  private readonly timer
  private readonly stages = new Map<string, Stage>()
  private readonly pending: { query: WebGLQuery; stage: Stage }[] = []
  private frameMs: number[] = []
  private cpuMs: number[] = []
  private lastFrame = 0
  private frameStart = 0
  private stageStart = 0
  private stage?: Stage
  private query?: WebGLQuery
  private active = false
  private disjoint = 0

  constructor(private readonly gl: WebGL2RenderingContext) {
    this.timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as
      { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null
  }

  start() {
    for (const { query } of this.pending) this.gl.deleteQuery(query)
    this.pending.length = 0
    this.stages.clear()
    this.frameMs = []
    this.cpuMs = []
    this.lastFrame = 0
    this.disjoint = 0
    this.active = true
  }

  beginFrame(now: number) {
    if (!this.active) return
    this.poll()
    if (this.lastFrame) this.frameMs.push(now - this.lastFrame)
    this.lastFrame = now
    this.frameStart = performance.now()
  }

  endFrame() {
    if (this.active) this.cpuMs.push(performance.now() - this.frameStart)
  }

  begin(name: string, gpu = false) {
    if (!this.active) return
    let stage = this.stages.get(name)
    if (!stage) {
      stage = { cpu: [], gpu: [], calls: 0, triangles: 0 }
      this.stages.set(name, stage)
    }
    this.stage = stage
    if (gpu && this.timer && this.frameMs.length % 5 === 0 && this.pending.length < 24) {
      const query = this.gl.createQuery()
      if (query) {
        this.gl.beginQuery(this.timer.TIME_ELAPSED_EXT, query)
        this.query = query
      }
    }
    this.stageStart = performance.now()
  }

  end(count?: DrawCount) {
    if (!this.stage) return
    const stage = this.stage
    stage.cpu.push(performance.now() - this.stageStart)
    if (count) {
      stage.calls += count.calls
      stage.triangles += count.triangles
    }
    if (this.query && this.timer) {
      this.gl.endQuery(this.timer.TIME_ELAPSED_EXT)
      this.pending.push({ query: this.query, stage })
      this.query = undefined
    }
    this.stage = undefined
  }

  private poll() {
    if (!this.timer || !this.pending.length) return
    const gl = this.gl
    if (gl.getParameter(this.timer.GPU_DISJOINT_EXT)) {
      this.disjoint++
      for (const { query } of this.pending) gl.deleteQuery(query)
      this.pending.length = 0
      return
    }
    while (this.pending.length && gl.getQueryParameter(this.pending[0].query, gl.QUERY_RESULT_AVAILABLE)) {
      const { query, stage } = this.pending.shift()!
      stage.gpu.push((gl.getQueryParameter(query, gl.QUERY_RESULT) as number) / 1e6)
      gl.deleteQuery(query)
    }
  }

  stop() {
    this.active = false
    this.poll()
    const frames = summarize(this.frameMs)
    return {
      fps: frames.mean ? 1000 / frames.mean : 0, frames, cpu: summarize(this.cpuMs),
      gpuTimer: !!this.timer, disjoint: this.disjoint,
      stages: Object.fromEntries([...this.stages].map(([name, stage]) => [name, {
        cpu: summarize(stage.cpu), gpu: summarize(stage.gpu),
        draws: stage.calls / stage.cpu.length, triangles: stage.triangles / stage.cpu.length,
      }])),
    }
  }
}

function summarize(samples: number[]) {
  const n = samples.length
  if (!n) return { n, mean: null, p95: null }
  const sorted = [...samples].sort((a, b) => a - b)
  return { n, mean: samples.reduce((sum, n) => sum + n, 0) / n, p95: sorted[Math.ceil(n * 0.95) - 1] }
}
