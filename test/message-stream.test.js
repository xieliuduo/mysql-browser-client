import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { NativeMessageDecoder, encodeNativeMessage } from '../native/message-stream.js'

test('encodes a little-endian native message', () => {
  const encoded = encodeNativeMessage({ id: '1', ok: true })
  assert.equal(encoded.readUInt32LE(0), encoded.length - 4)
  assert.deepEqual(JSON.parse(encoded.subarray(4).toString('utf8')), { id: '1', ok: true })
})

test('decodes fragmented and combined messages', async () => {
  const decoder = new NativeMessageDecoder()
  const values = []
  decoder.on('data', (value) => values.push(value))
  const bytes = Buffer.concat([encodeNativeMessage({ id: 1 }), encodeNativeMessage({ id: 2 })])
  decoder.write(bytes.subarray(0, 3))
  decoder.write(bytes.subarray(3, 11))
  decoder.end(bytes.subarray(11))
  await once(decoder, 'end')
  assert.deepEqual(values, [{ id: 1 }, { id: 2 }])
})

