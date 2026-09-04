import test from 'node:test'
import assert from 'node:assert/strict'
import { MysqlBrowserService } from '../native/service.js'

const connection = {
  id: 'local-test',
  label: 'Local test',
  environment: 'test',
  host: '127.0.0.1',
  port: 3306,
  user: 'tester',
  defaultDatabase: 'demo',
  maxRows: 200,
  queryTimeoutMs: 10000,
  ssl: { mode: 'disabled' },
}

function serviceWithClient(client) {
  return new MysqlBrowserService({
    store: {
      async get(id) {
        assert.equal(id, connection.id)
        return connection
      },
    },
    credentials: {
      async get() { return 'secret' },
      async has() { return true },
    },
    createMysqlConnection: async () => client,
  })
}

test('executes safe diagnostic scripts sequentially in one read-only transaction', async () => {
  const calls = []
  const fields = [
    { name: 'account_flag', orgName: '', table: '', orgTable: '', schema: '', columnType: 253 },
    { name: 'user_ids', orgName: '', table: '', orgTable: '', schema: '', columnType: 253 },
  ]
  const client = {
    async query(input) {
      const sql = typeof input === 'string' ? input : input.sql
      calls.push(sql)
      if (/^SELECT COUNT\(\*\)/i.test(sql)) return [[[2]], [{ name: 'totalCount' }]]
      if (/^SELECT\s+CASE/i.test(sql)) return [[['账户A', '1'], ['账户B', '2']], fields]
      return [{ affectedRows: 0 }, []]
    },
    async end() { calls.push('END') },
  }
  const service = serviceWithClient(client)
  const result = await service.query({
    connectionId: connection.id,
    database: 'demo',
    sql: `
      SET @phone_a := '17766123747';
      SET @phone_b := '19233213477';
      SELECT CASE WHEN @phone_a IS NOT NULL THEN '账户A' ELSE '账户B' END AS account_flag,
        CONCAT(@phone_a, @phone_b) AS user_ids;
    `,
    limit: 100,
  })

  assert.equal(result.script, true)
  assert.equal(result.statementCount, 3)
  assert.equal(result.resultSets.length, 1)
  assert.equal(result.resultSets[0].rowCount, 2)
  assert.equal(result.resultSets[0].totalCount, 2)
  assert.ok(calls.includes('START TRANSACTION READ ONLY'))
  assert.ok(calls.some((sql) => /^SET @phone_a/i.test(sql)))
  assert.ok(calls.some((sql) => /^SELECT\s+CASE/i.test(sql)))
  assert.ok(calls.includes('ROLLBACK'))
  assert.equal(calls.at(-1), 'END')
})

test('rejects writes in scripts before opening a database connection', async () => {
  let opened = false
  const service = new MysqlBrowserService({
    store: { async get() { return connection } },
    credentials: { async get() { return 'secret' } },
    createMysqlConnection: async () => {
      opened = true
      throw new Error('must not connect')
    },
  })
  await assert.rejects(() => service.query({
    connectionId: connection.id,
    database: 'demo',
    sql: 'SET @id := 1; DELETE FROM user WHERE id=@id',
  }), /read-only scripts/)
  assert.equal(opened, false)
})
