import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EXTENSION_ID, NATIVE_HOST_NAME } from '../shared/protocol.js'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const projectRoot = resolve(scriptDir, '..')
const hostEntry = join(projectRoot, 'native', 'host.js')
const installRoot = join(homedir(), '.mysql-browser-client', 'native-host')
const wrapperPath = join(installRoot, 'mysql-browser-client-host')

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function browserManifestDirectories() {
  if (process.platform === 'darwin') {
    return [
      ['Google Chrome', join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts')],
      ['Microsoft Edge', join(homedir(), 'Library', 'Application Support', 'Microsoft Edge', 'NativeMessagingHosts')],
      ['Chromium', join(homedir(), 'Library', 'Application Support', 'Chromium', 'NativeMessagingHosts')],
    ]
  }
  if (process.platform === 'linux') {
    return [
      ['Google Chrome', join(homedir(), '.config', 'google-chrome', 'NativeMessagingHosts')],
      ['Microsoft Edge', join(homedir(), '.config', 'microsoft-edge', 'NativeMessagingHosts')],
      ['Chromium', join(homedir(), '.config', 'chromium', 'NativeMessagingHosts')],
    ]
  }
  throw new Error('自动安装当前支持 macOS 和 Linux；Windows 请按 README 手动注册 Native Messaging Host。')
}

await mkdir(installRoot, { recursive: true, mode: 0o700 })
const wrapper = `#!/bin/sh
exec ${shellQuote(process.execPath)} ${shellQuote(hostEntry)}
`
await writeFile(wrapperPath, wrapper, { encoding: 'utf8', mode: 0o755 })
await chmod(wrapperPath, 0o755)

const manifest = {
  name: NATIVE_HOST_NAME,
  description: 'Local MySQL service for MySQL Browser Client',
  path: wrapperPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
}

const installed = []
for (const [browser, directory] of browserManifestDirectories()) {
  await mkdir(directory, { recursive: true })
  const path = join(directory, `${NATIVE_HOST_NAME}.json`)
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  installed.push({ browser, path })
}

console.log(`Native Host installed for extension ${EXTENSION_ID}`)
console.log(`Host wrapper: ${wrapperPath}`)
for (const item of installed) console.log(`${item.browser}: ${item.path}`)
console.log('Reload the unpacked extension after installation.')

