// Spark RAD v1. Properties are planar in each independently deflated chunk.
// Coordinate systems, units and quaternion signs match the original Three scene.
import { deflateRawSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { DataUtils } from 'three'

const capacity = 65536
const align = bytes => (bytes + 7) & ~7
function header(magic, value) {
  const json = Buffer.from(JSON.stringify(value))
  const bytes = Buffer.alloc(8 + align(json.length))
  bytes.write(magic)
  bytes.writeUInt32LE(json.length, 4)
  json.copy(bytes, 8)
  return bytes
}

export class RadWriter {
  constructor() {
    this.columns = [new Float32Array(capacity*3), new Uint8Array(capacity), new Uint8Array(capacity*3),
      new Uint16Array(capacity*3), new Uint16Array(capacity*3)]
    this.used = this.count = 0
    this.chunks = []
    this.ranges = []
    this.bytes = 0
  }

  add(p, rgb, opacity, scales, q) {
    const [center, alpha, color, scale, rot] = this.columns
    for (let c = 0; c < 3; c++) {
      const index = this.used + c * capacity
      center[index] = p[c]
      color[index] = Math.round(255 * Math.max(0,Math.min(1,rgb[c])))
      scale[index] = scales[c] === 0 ? 0xfc00 : DataUtils.toHalfFloat(Math.log(scales[c]))
      rot[index] = DataUtils.toHalfFloat(q[c])
    }
    alpha[this.used++] = Math.round(255 * opacity)
    this.count++
    if (this.used === capacity) this.flush()
  }

  flush() {
    if (!this.used) return
    const payload = [], properties = []
    let offset = 0
    for (const [i,property] of ['center','alpha','rgb','scales','orientation'].entries()) {
      const column = this.columns[i], planes = []
      for (let c=0; c<column.length/capacity; c++) {
        const plane = column.subarray(c*capacity,c*capacity+this.used)
        planes.push(Buffer.from(plane.buffer,plane.byteOffset,plane.byteLength))
      }
      const data = deflateRawSync(Buffer.concat(planes),{level:5})
      properties.push({property,encoding:['f32','r8','r8','ln_f16','f16'][i],compression:'gz',offset,bytes:data.length,
        ...(i===1 || i===2 ? {min:0,max:1} : {})})
      payload.push(data,Buffer.alloc(align(data.length)-data.length))
      offset += align(data.length)
    }
    const size = Buffer.alloc(8)
    size.writeBigUInt64LE(BigInt(offset))
    const base = this.count-this.used
    const chunk = Buffer.concat([header('RADC',{version:1,base,count:this.used,payloadBytes:offset,maxSh:0,properties}),size,...payload])
    this.ranges.push({offset:this.bytes,bytes:chunk.length,base,count:this.used})
    this.bytes += chunk.length
    this.chunks.push(chunk)
    this.used = 0
  }

  save(path) {
    this.flush()
    const metadata = {version:1,type:'gsplat',count:this.count,maxSh:0,chunkSize:capacity,allChunkBytes:this.bytes,chunks:this.ranges}
    writeFileSync(path,Buffer.concat([header('RAD0',metadata),...this.chunks]))
  }
}
