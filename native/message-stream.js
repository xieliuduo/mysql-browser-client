import { Transform } from 'node:stream'

const MAX_MESSAGE_BYTES = 16 * 1024 * 1024

export function encodeNativeMessage(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  if (body.length > MAX_MESSAGE_BYTES) throw new Error('native message is too large')
  const header = Buffer.allocUnsafe(4)
  header.writeUInt32LE(body.length, 0)
  return Buffer.concat([header, body])
}

export class NativeMessageDecoder extends Transform {
  constructor(options = {}) {
    super({ ...options, readableObjectMode: true })
    this.buffer = Buffer.alloc(0)
  }

  _transform(chunk, _encoding, callback) {
    try {
      this.buffer = Buffer.concat([this.buffer, chunk])
      while (this.buffer.length >= 4) {
        const size = this.buffer.readUInt32LE(0)
        if (size > MAX_MESSAGE_BYTES) throw new Error('native message is too large')
        if (this.buffer.length < size + 4) break
        const body = this.buffer.subarray(4, size + 4)
        this.buffer = this.buffer.subarray(size + 4)
        this.push(JSON.parse(body.toString('utf8')))
      }
      callback()
    } catch (error) {
      callback(error)
    }
  }
}

