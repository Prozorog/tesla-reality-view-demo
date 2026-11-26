import { SparkRenderer, SplatMesh } from '@sparkjsdev/spark'
import { Matrix4, Mesh, Scene, Vector4 } from 'three'
import type { LotOcclusion } from './lot-occlusion.ts'
import type { Camera, Object3D, WebGLRenderer } from 'three'
import { manifest } from '../assets/gltf.ts'

export type WorldMode = 'mesh' | 'splat' | 'hybrid'
type GroupInfo = { id: string; file: string; nodes: string[] }
type Group = { id: string; splats: SplatMesh; originals: Object3D[] }

// One shared draw mesh, four independent accumulator/sort pairs. Spark.render
// uses the current target, including its existing opaque geometry depth buffer.
export class SplatViews {
  private readonly views = new Map<string, SparkRenderer>()
  private drawable?: SparkRenderer
  private readonly depthScene = new Scene()
  private groups: Group[] = []
  private files?: GroupInfo[]
  private loading?: Promise<void>
  mode: WorldMode = 'mesh'
  status = 'ready'

  constructor(private readonly renderer: WebGLRenderer, private readonly scene: Scene,
    private readonly world: Object3D, private readonly occlusion: LotOcclusion, private readonly invalidate: () => void) {}

  setMode(mode: WorldMode) {
    this.mode = mode
    if (this.drawable) this.drawable.visible = mode !== 'mesh'
    for (const group of this.groups) {
      group.splats.visible = this.wanted(group.id)
      for (const mesh of group.originals) mesh.visible = true
    }
    if (mode !== 'mesh' && !this.loading) {
      this.status = 'loading'
      this.loading = this.load().catch(error => {
        console.error('Could not load splat world', error)
        this.setMode('mesh')
        this.status = 'error'
      }).finally(() => { this.loading = undefined; this.invalidate() })
    }
    this.invalidate()
  }

  presented(pass: string) {
    if (this.mode === 'mesh') return this.status !== 'error'
    const view = this.views.get(pass)
    return this.status === 'ready' && !!view && !!this.files && this.files.filter(info => this.wanted(info.id)).every(info =>
      view.display.mapping.some(entry => entry.count > 0 && this.groups.some(g => g.id === info.id && g.splats === entry.node)))
  }

  private wanted(id: string) { return this.mode !== 'mesh' && (id !== 'parked-cars' || this.mode === 'splat') }

  private async load() {
    this.files ??= (await manifest<{groups: GroupInfo[]}>('splats/manifest.json')).groups
    for (const info of this.files) {
      if (!this.wanted(info.id) || this.groups.some(g => g.id === info.id)) continue
      const splats = new SplatMesh({ url: `${import.meta.env.BASE_URL}models/splats/${info.file}`,
        lod: true, raycastable: false })
      await splats.initialized
      const originals: Object3D[] = []
      this.world.traverse(object => {
        if (info.nodes.includes(object.userData.splatSource ?? object.name)) originals.push(object)
      })
      this.groups.push({ id: info.id, originals, splats })
      splats.visible = this.wanted(info.id)
      this.scene.add(splats)
      this.invalidate()
    }
    this.status = 'ready'
  }

  private readonly fadeMin = Array.from({length: 48}, () => new Vector4())
  private readonly fadeMax = Array.from({length: 48}, () => new Vector4())
  private readonly propIndices = {value: new Vector4()}
  private readonly fadeCount = {value: 0}
  private readonly cameraWorld = {value: new Matrix4()}

  private shadeWorld(view: SparkRenderer) {
    // Spark stores photographic RGB. Fog is mixed in linear light before the
    // renderer encodes the splat for the half-float world target.
    const material = view.material
    Object.assign(material.uniforms, {fadeMin:{value:this.fadeMin}, fadeMax:{value:this.fadeMax},
      propIndices:this.propIndices, fadeCount:this.fadeCount, cameraWorld:this.cameraWorld})
    material.vertexShader = material.vertexShader.replace('out vec4 vRgba;', `
      uniform vec4 fadeMin[48], fadeMax[48];
      uniform vec4 propIndices;
      uniform int fadeCount;
      uniform mat4 cameraWorld;
      out vec4 vRgba;`).replace('vRgba = rgba;', `
      float fog = smoothstep(70.0, 235.0, -viewCenter.z);
      if (fog > 0.0) {
        vec3 lin = mix(rgba.rgb / 12.92, pow((rgba.rgb+.055)/1.055, vec3(2.4)), step(vec3(.04045), rgba.rgb));
        lin = mix(lin,vec3(.003677,.003347,.004391),fog);
        rgba.rgb = mix(12.92*lin,1.055*pow(lin,vec3(1.0/2.4))-.055,step(vec3(.0031308),lin));
      }
      float id = float(splatIndex);
      if (fadeCount > 0 && ((id >= propIndices.x && id < propIndices.y) || (id >= propIndices.z && id < propIndices.w))) {
        vec3 world = (cameraWorld * vec4(viewCenter,1.0)).xyz;
        for (int i=0;i<fadeCount;i++) {
          if (all(greaterThanEqual(world,fadeMin[i].xyz)) && all(lessThanEqual(world,fadeMax[i].xyz)))
            rgba.a = min(rgba.a,fadeMin[i].w);
        }
        if (rgba.a < minAlpha) return;
      }
      vRgba = rgba;`)
  }

  render(camera: Camera, pass: string, parked: (hidden: boolean) => void) {
    let view = this.views.get(pass)
    if (!view) {
      view = new SparkRenderer({ renderer: this.renderer, sortRadial: true, depthTest: true, depthWrite: false, minAlpha: .012, enable2DGS: true,
        lodSplatCount: pass === 'rear' ? 115000 : pass === 'tablet' ? 270000 : 650000, onDirty: this.invalidate })
      this.views.set(pass, view)
      if (!this.drawable) {
        this.drawable = view
        this.shadeWorld(view)
        view.renderOrder = .5
        this.scene.add(view)
        const depth = new Mesh(view.geometry, view.material)
        depth.frustumCulled = false
        this.depthScene.add(depth)
      }
    }
    this.propIndices.value.set(0,0,0,0)
    let parkedHidden = false
    for (const group of this.groups) {
      const range = view.display.mapping.find(entry => entry.node === group.splats)
      const displayed = group.splats.visible && !!range && range.count > 0
      if (range && (group.id === 'fixtures' || group.id === 'trees')) {
        const axis = group.id === 'fixtures' ? 0 : 2
        this.propIndices.value.setComponent(axis, range.base).setComponent(axis+1, range.base+range.count)
      }
      if (group.id === 'parked-cars') parkedHidden = displayed
      for (const mesh of group.originals) mesh.visible = !displayed
    }
    this.cameraWorld.value.copy(camera.matrixWorld)
    this.fadeCount.value = pass === 'screen' || pass === 'tablet' ? this.occlusion.writeSplatFades(this.fadeMin,this.fadeMax) : 0
    parked(parkedHidden)
    view.render(this.scene, camera)
    const { calls, triangles } = this.renderer.info.render
    if (pass !== 'screen' && pass !== 'tablet') return { calls, triangles }

    // The world compositor copies this depth underneath the HUD markers. A
    // separate depth-only draw keeps low-alpha tails out of the depth buffer
    // while preserving back-to-front blending in the colour pass.
    const draw = this.drawable!
    const alpha = draw.uniforms.minAlpha.value, clear = this.renderer.autoClear
    try {
      draw.uniforms.minAlpha.value = .5
      draw.material.colorWrite = false
      draw.material.depthWrite = true
      this.renderer.autoClear = false
      this.renderer.render(this.depthScene, camera)
      return { calls: calls + this.renderer.info.render.calls, triangles: triangles + this.renderer.info.render.triangles }
    } finally {
      this.renderer.autoClear = clear
      draw.material.colorWrite = true
      draw.material.depthWrite = false
      draw.uniforms.minAlpha.value = alpha
    }
  }
}
