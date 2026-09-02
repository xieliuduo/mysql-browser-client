import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const STORE_VERSION = 1
export const ENVIRONMENTS = new Set(['local', 'development', 'test', 'staging', 'production'])
const SSL_MODES = new Set(['disabled', 'preferred', 'required'])

export class ConnectionStoreError extends Error {
  constructor(message, code = 'INVALID_CONNECTION') {
    super(message)
    this.name = 'ConnectionStoreError'
    this.code = code
  }
}

function text(value, field, max = 200) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ConnectionStoreError(`${field} is required`)
  const result = value.trim()
  if (result.length > max) throw new ConnectionStoreError(`${field} is too long`)
  return result
}

function integer(value, field, fallback, min, max) {
  const candidate = value === undefined ? fallback : Number(value)
  if (!Number.isSafeInteger(candidate) || candidate < min || candidate > max) throw new ConnectionStoreError(`${field} is invalid`)
  return candidate
}

export function createConnectionId(label = 'mysql') {
  const slug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'mysql'
  return `${slug}-${randomBytes(3).toString('hex')}`
}

export function normalizeConnection(input, existing) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ConnectionStoreError('connection must be an object')
  const id = existing?.id ?? text(input.id ?? createConnectionId(input.label), 'id', 80)
  if (!/^[a-z0-9][a-z0-9_-]{2,79}$/i.test(id)) throw new ConnectionStoreError('id is invalid')
  const environment = text(input.environment ?? existing?.environment ?? 'test', 'environment', 32)
  if (!ENVIRONMENTS.has(environment)) throw new ConnectionStoreError('environment is invalid')
  const sslMode = input.ssl?.mode ?? existing?.ssl?.mode ?? 'disabled'
  if (!SSL_MODES.has(sslMode)) throw new ConnectionStoreError('ssl mode is invalid')
  const caPath = input.ssl?.caPath ?? existing?.ssl?.caPath
  return {
    id,
    label: text(input.label ?? existing?.label, 'label'),
    environment,
    host: text(input.host ?? existing?.host, 'host', 253),
    port: integer(input.port ?? existing?.port, 'port', 3306, 1, 65535),
    user: text(input.user ?? existing?.user, 'user'),
    defaultDatabase: text(input.defaultDatabase ?? input.database ?? existing?.defaultDatabase, 'defaultDatabase'),
    maxRows: integer(input.maxRows ?? existing?.maxRows, 'maxRows', environment === 'production' ? 100 : 200, 1, 1000),
    queryTimeoutMs: integer(input.queryTimeoutMs ?? existing?.queryTimeoutMs, 'queryTimeoutMs', environment === 'production' ? 8000 : 10000, 100, 120000),
    ssl: {
      mode: sslMode,
      ...(caPath ? { caPath: text(caPath, 'ssl caPath', 2000) } : {}),
    },
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

export function publicConnection(connection, credentialConfigured = false) {
  return {
    ...connection,
    ssl: { ...connection.ssl },
    credentialConfigured,
    accountPrivilegeWarning: /admin|root/i.test(connection.user),
  }
}

function parseStore(raw) {
  const parsed = JSON.parse(raw)
  if (!parsed || parsed.version !== STORE_VERSION || !Array.isArray(parsed.connections)) {
    throw new ConnectionStoreError('unsupported connection store', 'INVALID_STORE')
  }
  const ids = new Set()
  const connections = parsed.connections.map((connection) => {
    const normalized = normalizeConnection(connection, connection)
    if (ids.has(normalized.id)) throw new ConnectionStoreError(`duplicate connection id: ${normalized.id}`, 'INVALID_STORE')
    ids.add(normalized.id)
    return normalized
  })
  return { version: STORE_VERSION, connections }
}

export class ConnectionStore {
  constructor(path) {
    this.path = path
    this.pending = Promise.resolve()
  }

  async load() {
    try {
      return parseStore(await readFile(this.path, 'utf8'))
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const initial = { version: STORE_VERSION, connections: [] }
      await this.write(initial)
      return initial
    }
  }

  async write(store) {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
    const temp = `${this.path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
    await writeFile(temp, `${JSON.stringify(store, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await chmod(temp, 0o600)
    await rename(temp, this.path)
    await chmod(this.path, 0o600)
  }

  mutate(operation) {
    const run = this.pending.then(async () => {
      const store = await this.load()
      const result = await operation(store)
      await this.write(store)
      return result
    })
    this.pending = run.catch(() => {})
    return run
  }

  async list() {
    return (await this.load()).connections.map((connection) => ({ ...connection, ssl: { ...connection.ssl } }))
  }

  async get(id) {
    const connection = (await this.load()).connections.find((item) => item.id === id)
    if (!connection) throw new ConnectionStoreError('connection not found', 'CONNECTION_NOT_FOUND')
    return { ...connection, ssl: { ...connection.ssl } }
  }

  create(input) {
    return this.mutate((store) => {
      const connection = normalizeConnection(input)
      if (store.connections.some((item) => item.id === connection.id)) throw new ConnectionStoreError('connection id already exists', 'CONNECTION_EXISTS')
      store.connections.push(connection)
      return { ...connection, ssl: { ...connection.ssl } }
    })
  }

  update(id, patch) {
    return this.mutate((store) => {
      const index = store.connections.findIndex((item) => item.id === id)
      if (index < 0) throw new ConnectionStoreError('connection not found', 'CONNECTION_NOT_FOUND')
      const connection = normalizeConnection(patch, store.connections[index])
      store.connections[index] = connection
      return { ...connection, ssl: { ...connection.ssl } }
    })
  }

  remove(id) {
    return this.mutate((store) => {
      const index = store.connections.findIndex((item) => item.id === id)
      if (index < 0) throw new ConnectionStoreError('connection not found', 'CONNECTION_NOT_FOUND')
      return store.connections.splice(index, 1)[0]
    })
  }
}

