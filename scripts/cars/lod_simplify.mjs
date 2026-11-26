// Use the meshoptimizer already pinned in package-lock.json. Return indices only:
// every surviving corner still points to an original position and atlas coordinate.
import { readFileSync } from 'node:fs'
import { MeshoptSimplifier } from 'meshoptimizer/simplifier'

const input = JSON.parse(readFileSync(0, 'utf8'))
await MeshoptSimplifier.ready
const [indices] = MeshoptSimplifier.simplifyWithAttributes(
  Uint32Array.from(input.indices), Float32Array.from(input.positions), 3,
  Float32Array.from(input.attributes), 5, [0.65, 0.65, 0.12, 0.12, 0.12],
  Uint8Array.from(input.locks), input.target * 3, 1, [],
)
process.stdout.write(JSON.stringify(Array.from(indices)))
