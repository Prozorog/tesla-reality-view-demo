import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, Points, ShaderMaterial } from 'three'

export function fixtureStars(heads: ReadonlyArray<{ position: number[] }>) {
  const geometry = new BufferGeometry()
  // The points sit just under each actual lens to retain normal occlusion.
  geometry.setAttribute('position', new Float32BufferAttribute(heads.flatMap(({ position: [x, y, z] }) => [x, y - 0.024, z]), 3))
  const material = new ShaderMaterial({
    transparent: true, depthWrite: false, blending: AdditiveBlending,
    vertexShader: `
      varying float distanceFade;
      void main() {
        vec4 view = modelViewMatrix * vec4(position, 1.0);
        distanceFade = 1.0 - smoothstep(98.0, 205.0, -view.z);
        gl_PointSize = clamp(810.0 / max(1.0, -view.z), 11.0, 64.0);
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: `
      varying float distanceFade;
      void main() {
        vec2 p = 2.0 * gl_PointCoord - 1.0;
        float radius = length(p);
        float edge = 1.0 - smoothstep(0.03, 1.0, radius);
        float core = 0.81 * exp(-radius * radius * 170.0);
        float halo = 0.17 * exp(-radius * radius * 28.0);
        vec2 distance = abs(p);
        float axial = exp(-distance.x * 35.0) + 0.72 * exp(-distance.y * 37.0);
        vec2 diagonal = abs(vec2(p.x - p.y, p.x + p.y));
        float rays = 0.21 * axial + 0.056 * (exp(-diagonal.x * 32.0) + exp(-diagonal.y * 32.0));
        gl_FragColor = vec4(vec3(1.0, 0.94, 0.87), (core + halo + rays) * edge * distanceFade);
        #include <colorspace_fragment>
      }
    `,
  })
  const points = new Points(geometry, material)
  points.name = 'Lamp glare stars'
  points.renderOrder = 1
  return points
}
