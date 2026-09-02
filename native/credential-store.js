import { execFile } from 'node:child_process'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const KEYCHAIN_SERVICE = 'com.mysql-browser-client'

export class CredentialStore {
  constructor(path, options = {}) {
    this.path = path
    this.platform = options.platform || process.platform
    this.forceFile = options.forceFile === true
    this.pending = Promise.resolve()
  }

  async readFileStore() {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'))
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch (error) {
      if (error?.code === 'ENOENT') return {}
      throw error
    }
  }

  async writeFileStore(value) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temp = `${this.path}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await chmod(temp, 0o600)
    await rename(temp, this.path)
    await chmod(this.path, 0o600)
  }

  mutateFile(operation) {
    const run = this.pending.then(async () => {
      const store = await this.readFileStore()
      const result = await operation(store)
      await this.writeFileStore(store)
      return result
    })
    this.pending = run.catch(() => {})
    return run
  }

  async keychainGet(id) {
    const { stdout } = await execFileAsync('/usr/bin/security', ['find-generic-password', '-a', id, '-s', KEYCHAIN_SERVICE, '-w'], { encoding: 'utf8' })
    return stdout.replace(/\r?\n$/, '')
  }

  async keychainSet(id, password) {
    await execFileAsync('/usr/bin/security', ['add-generic-password', '-a', id, '-s', KEYCHAIN_SERVICE, '-w', password, '-U'])
  }

  async keychainDelete(id) {
    await execFileAsync('/usr/bin/security', ['delete-generic-password', '-a', id, '-s', KEYCHAIN_SERVICE])
  }

  async get(id) {
    if (this.platform === 'darwin' && !this.forceFile) {
      try { return await this.keychainGet(id) } catch {}
    }
    const store = await this.readFileStore()
    return typeof store[id] === 'string' ? store[id] : null
  }

  async has(id) {
    return (await this.get(id)) !== null
  }

  async set(id, password) {
    if (typeof password !== 'string' || password.length === 0 || password.length > 4096) throw new Error('password is invalid')
    if (this.platform === 'darwin' && !this.forceFile) {
      try {
        await this.keychainSet(id, password)
        await this.mutateFile((store) => { delete store[id] })
        return { backend: 'keychain' }
      } catch {}
    }
    await this.mutateFile((store) => { store[id] = password })
    return { backend: 'file' }
  }

  async delete(id) {
    let keychainDeleted = false
    if (this.platform === 'darwin' && !this.forceFile) {
      try { await this.keychainDelete(id); keychainDeleted = true } catch {}
    }
    let fileDeleted = false
    await this.mutateFile((store) => {
      fileDeleted = Object.prototype.hasOwnProperty.call(store, id)
      delete store[id]
    })
    return keychainDeleted || fileDeleted
  }
}

