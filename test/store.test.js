import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ConnectionStore, normalizeConnection, publicConnection } from '../native/store.js'
import { CredentialStore } from '../native/credential-store.js'

const sample = {
  id: 'local-test',
  label: 'Local test',
  environment: 'test',
  host: '127.0.0.1',
  port: 3306,
  user: 'tester',
  defaultDatabase: 'demo',
}

test('connection CRUD persists mode 0600 and never exposes a password field', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mysql-browser-client-'))
  const path = join(root, 'connections.json')
  const store = new ConnectionStore(path)
  await store.create(sample)
  await store.update(sample.id, { ...sample, label: 'Updated' })
  const value = publicConnection(await store.get(sample.id), true)
  assert.equal(value.label, 'Updated')
  assert.equal(value.credentialConfigured, true)
  assert.equal('password' in value, false)
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.equal(JSON.parse(await readFile(path, 'utf8')).connections.length, 1)
  await store.remove(sample.id)
  assert.equal((await store.list()).length, 0)
})

test('file credential fallback stores and removes bounded secrets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mysql-browser-credentials-'))
  const path = join(root, 'credentials.json')
  const store = new CredentialStore(path, { forceFile: true })
  await store.set('local-test', 'secret')
  assert.equal(await store.get('local-test'), 'secret')
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.equal(await store.delete('local-test'), true)
  assert.equal(await store.get('local-test'), null)
})

test('normalizes production defaults more strictly', () => {
  const value = normalizeConnection({ ...sample, id: 'prod-db', environment: 'production' })
  assert.equal(value.maxRows, 100)
  assert.equal(value.queryTimeoutMs, 8000)
})

