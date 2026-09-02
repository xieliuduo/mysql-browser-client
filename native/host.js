#!/usr/bin/env node
import { NativeMessageDecoder, encodeNativeMessage } from './message-stream.js'
import { MysqlBrowserService } from './service.js'

const service = new MysqlBrowserService()
const decoder = new NativeMessageDecoder()
let output = Promise.resolve()

function send(message) {
  output = output.then(() => new Promise((resolve, reject) => {
    process.stdout.write(encodeNativeMessage(message), (error) => error ? reject(error) : resolve())
  }))
  return output
}

decoder.on('data', async (request) => {
  const id = typeof request?.id === 'string' ? request.id : `${Date.now()}`
  try {
    if (!request || typeof request.method !== 'string') throw new Error('invalid native request')
    const response = await service.handle(request.method, request.params)
    await send({ id, ...response })
  } catch (error) {
    await send({ id, ok: false, error: { code: error?.code || 'HOST_ERROR', message: String(error?.message || error).slice(0, 500) } })
  }
})

decoder.on('error', (error) => {
  process.stderr.write(`[mysql-browser-client] native protocol error: ${error.message}\n`)
  process.exitCode = 1
})

process.stdin.pipe(decoder)

