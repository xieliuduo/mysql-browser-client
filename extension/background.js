import { NATIVE_HOST_NAME } from './protocol.js'

let nativePort = null
const pending = new Map()

function disconnect(error = new Error('本地 MySQL 服务已断开')) {
  nativePort = null
  for (const { reject } of pending.values()) reject(error)
  pending.clear()
}

function connectNativeHost() {
  if (nativePort) return nativePort
  const port = chrome.runtime.connectNative(NATIVE_HOST_NAME)
  nativePort = port
  port.onMessage.addListener((message) => {
    const request = pending.get(message?.id)
    if (!request) return
    pending.delete(message.id)
    if (message.ok) request.resolve(message.value)
    else request.reject(Object.assign(new Error(message?.error?.message || '本地服务请求失败'), { details: message?.error }))
  })
  port.onDisconnect.addListener(() => {
    const message = chrome.runtime.lastError?.message || '本地 MySQL 服务未安装或已退出'
    disconnect(new Error(message))
  })
  return port
}

function nativeRequest(request) {
  return new Promise((resolve, reject) => {
    try {
      const port = connectNativeHost()
      pending.set(request.id, { resolve, reject })
      port.postMessage(request)
    } catch (error) {
      pending.delete(request.id)
      reject(error)
    }
  })
}

async function openWorkbench() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('workbench.html') })
}

chrome.action.onClicked.addListener(() => {
  openWorkbench().catch(() => {})
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'native-request') {
    nativeRequest(message.request)
      .then((value) => sendResponse({ ok: true, value }))
      .catch((error) => sendResponse({ ok: false, error: { message: error.message, ...(error.details || {}) } }))
    return true
  }
  if (message?.type === 'open-workbench') {
    openWorkbench()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: { message: error.message } }))
    return true
  }
  if (message?.type === 'native-reset') {
    nativePort?.disconnect()
    disconnect()
    sendResponse({ ok: true })
  }
  return false
})
