import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const WORKSPACE_STORE_VERSION = 1
const MAX_WORKSPACE_BYTES = 5 * 1024 * 1024

export class WorkspaceStoreError extends Error {
  constructor(message, code = 'INVALID_WORKSPACE') {
    super(message)
    this.name = 'WorkspaceStoreError'
    this.code = code
  }
}

function normalizeWorkspace(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WorkspaceStoreError('workspace must be an object')
  }
  let serialized
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new WorkspaceStoreError('workspace must be JSON serializable')
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_WORKSPACE_BYTES) {
    throw new WorkspaceStoreError('workspace is too large')
  }
  return { workspace: JSON.parse(serialized), serialized }
}

function parseStore(raw) {
  const parsed = JSON.parse(raw)
  if (!parsed || parsed.version !== WORKSPACE_STORE_VERSION) {
    throw new WorkspaceStoreError('unsupported workspace store', 'INVALID_WORKSPACE_STORE')
  }
  return normalizeWorkspace(parsed.workspace).workspace
}

export class WorkspaceStore {
  constructor(path) {
    this.path = path
    this.pending = Promise.resolve()
  }

  async load() {
    try {
      return parseStore(await readFile(this.path, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') return null
      throw error
    }
  }

  save(value) {
    const run = this.pending.then(async () => {
      const { workspace, serialized } = normalizeWorkspace(value)
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      const temp = `${this.path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
      await writeFile(temp, `{"version":${WORKSPACE_STORE_VERSION},"workspace":${serialized}}\n`, { encoding: 'utf8', mode: 0o600 })
      await chmod(temp, 0o600)
      await rename(temp, this.path)
      await chmod(this.path, 0o600)
      return workspace
    })
    this.pending = run.catch(() => {})
    return run
  }
}
