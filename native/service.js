import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import mysql from 'mysql2/promise'
import { METHODS } from '../shared/protocol.js'
import { CredentialStore } from './credential-store.js'
import { buildCountSql, redactSql, splitSqlStatements, SqlPolicyError, validateExplainTarget, validateReadOnlyScript, validateSql } from './policy.js'
import { ConnectionStore, ConnectionStoreError, normalizeConnection, publicConnection } from './store.js'
import { tableSummary } from './table-summary.js'
import { WorkspaceStore, WorkspaceStoreError } from './workspace-store.js'

const DEFAULT_AUDIT_LIMIT = 200
const PRODUCTION_MAX_ROWS = 100
const PRODUCTION_TIMEOUT_MS = 8000

function asInteger(value, fallback, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback
}

function jsonValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value)) return `0x${value.subarray(0, 256).toString('hex')}${value.length > 256 ? '…' : ''}`
  if (Array.isArray(value)) return value.map(jsonValue)
  if (typeof value === 'object') {
    const output = {}
    for (const [key, child] of Object.entries(value)) output[key] = jsonValue(child)
    return output
  }
  return String(value)
}

function safeError(error) {
  if (error instanceof SqlPolicyError || error instanceof ConnectionStoreError || error instanceof WorkspaceStoreError) {
    return { code: error.code || 'bad-request', message: error.message }
  }
  const sourceCode = typeof error?.code === 'string' ? error.code : 'REQUEST_FAILED'
  const messages = {
    MYSQL_CREDENTIAL_MISSING: '未配置 MySQL 密码',
    PRODUCTION_CONFIRMATION_REQUIRED: '进入生产连接需要明确确认',
    WRITE_CONFIRMATION_REQUIRED: '写操作或 DDL 需要明确确认',
    ER_ACCESS_DENIED_ERROR: 'MySQL 登录或访问被拒绝，请检查账号和密码',
    ER_TABLEACCESS_DENIED_ERROR: '当前账号没有该表所需权限',
    ER_DBACCESS_DENIED_ERROR: '当前账号没有该数据库所需权限',
    ER_BAD_DB_ERROR: '数据库不存在或不可访问',
    ER_NO_SUCH_TABLE: '表不存在',
    ER_BAD_FIELD_ERROR: '字段不存在',
    ER_PARSE_ERROR: 'MySQL 无法解析 SQL',
    ECONNREFUSED: 'MySQL 连接被拒绝，请检查地址、端口和网络',
    ETIMEDOUT: 'MySQL 连接超时，请检查网络或 VPN',
    ENOTFOUND: '无法解析 MySQL 主机地址',
    EHOSTUNREACH: 'MySQL 主机不可达',
    ENETUNREACH: '当前网络无法访问 MySQL',
    PROTOCOL_CONNECTION_LOST: 'MySQL 连接被服务器断开',
  }
  return {
    code: sourceCode,
    message: messages[sourceCode] || String(error?.message || '本地 MySQL 请求失败').replace(/(?:password|pwd)=\S+/gi, 'password=[redacted]').slice(0, 500),
  }
}

function ok(value) { return { ok: true, value } }
function fail(error) { return { ok: false, error: safeError(error) } }

function assertPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ConnectionStoreError('request payload must be an object', 'INVALID_REQUEST')
  return payload
}

function assertPassword(password, required = false) {
  if (password === undefined || password === '') {
    if (required) throw new ConnectionStoreError('password is required', 'PASSWORD_REQUIRED')
    return undefined
  }
  if (typeof password !== 'string' || password.length > 4096) throw new ConnectionStoreError('password is invalid', 'INVALID_PASSWORD')
  return password
}

function assertProduction(connection, confirmed) {
  if (connection.environment === 'production' && confirmed !== true) {
    throw Object.assign(new Error('production confirmation required'), { code: 'PRODUCTION_CONFIRMATION_REQUIRED' })
  }
}

function databaseName(value, fallback) {
  const name = value === undefined || value === '' ? fallback : value
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 64 || name.includes('\0')) {
    throw new ConnectionStoreError('database is invalid', 'INVALID_DATABASE')
  }
  return name.trim()
}

export class MysqlBrowserService {
  constructor(options = {}) {
    const home = options.home || process.env.MYSQL_BROWSER_CLIENT_HOME || join(homedir(), '.mysql-browser-client')
    this.store = options.store || new ConnectionStore(join(home, 'connections.json'))
    this.credentials = options.credentials || new CredentialStore(join(home, 'credentials.json'))
    this.workspace = options.workspace || new WorkspaceStore(join(home, 'workspace.json'))
    this.createMysqlConnection = options.createMysqlConnection || mysql.createConnection
    this.auditLimit = asInteger(options.auditLimit, DEFAULT_AUDIT_LIMIT, 10, 1000)
    this.audit = []
  }

  async credentialConfigured(connection) {
    return this.credentials.has(connection.id)
  }

  async listConnections() {
    const connections = await this.store.list()
    return { connections: await Promise.all(connections.map(async (connection) => publicConnection(connection, await this.credentialConfigured(connection)))) }
  }

  async getConnection(id) {
    if (typeof id !== 'string' || !id) throw new ConnectionStoreError('connectionId is required', 'CONNECTION_REQUIRED')
    return this.store.get(id)
  }

  async resolveTarget({ connectionId, database, productionConfirmed = false } = {}) {
    const connection = await this.getConnection(connectionId)
    assertProduction(connection, productionConfirmed)
    return { connection, database: databaseName(database, connection.defaultDatabase) }
  }

  async resolvePassword(connection) {
    const password = await this.credentials.get(connection.id)
    if (password === null) throw Object.assign(new Error('credential missing'), { code: 'MYSQL_CREDENTIAL_MISSING' })
    return password
  }

  connectionLimits(connection) {
    return connection.environment === 'production'
      ? { maxRows: Math.min(connection.maxRows, PRODUCTION_MAX_ROWS), timeoutMs: Math.min(connection.queryTimeoutMs, PRODUCTION_TIMEOUT_MS) }
      : { maxRows: connection.maxRows, timeoutMs: connection.queryTimeoutMs }
  }

  async sslOptions(connection) {
    if (connection.ssl?.mode === 'disabled') return undefined
    const ssl = { rejectUnauthorized: connection.ssl.mode === 'required' }
    if (connection.ssl.caPath) ssl.ca = await readFile(connection.ssl.caPath, 'utf8')
    return ssl
  }

  async withConnection(connection, database, operation, passwordOverride) {
    const limits = this.connectionLimits(connection)
    const password = passwordOverride ?? await this.resolvePassword(connection)
    const client = await this.createMysqlConnection({
      host: connection.host,
      port: connection.port,
      user: connection.user,
      password,
      ...(database ? { database } : {}),
      charset: 'utf8mb4',
      multipleStatements: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
      connectTimeout: limits.timeoutMs,
      enableKeepAlive: true,
      ...(connection.ssl?.mode !== 'disabled' ? { ssl: await this.sslOptions(connection) } : {}),
    })
    try {
      await client.query(`SET SESSION MAX_EXECUTION_TIME = ${limits.timeoutMs}`)
      return await operation(client, limits)
    } finally {
      await client.end().catch(() => {})
    }
  }

  recordAudit(entry) {
    this.audit.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      time: new Date().toISOString(),
      ...entry,
    })
    if (this.audit.length > this.auditLimit) this.audit.length = this.auditLimit
  }

  async connectionStatus(target) {
    const { connection, database } = await this.resolveTarget(target)
    const started = Date.now()
    try {
      const server = await this.withConnection(connection, database, async (client) => {
        const [rows] = await client.query('SELECT VERSION() AS version, DATABASE() AS databaseName, CURRENT_USER() AS currentUser, @@global.read_only AS serverReadOnly')
        return jsonValue(rows[0] ?? {})
      })
      return { status: 'connected', database, server, latencyMs: Date.now() - started, checkedAt: new Date().toISOString() }
    } catch (error) {
      return { status: 'error', database, error: safeError(error), latencyMs: Date.now() - started, checkedAt: new Date().toISOString() }
    }
  }

  async listDatabases({ connectionId, productionConfirmed = false } = {}) {
    const connection = await this.getConnection(connectionId)
    assertProduction(connection, productionConfirmed)
    return this.withConnection(connection, undefined, async (client) => {
      const [rows] = await client.query(`SELECT SCHEMA_NAME AS name, DEFAULT_CHARACTER_SET_NAME AS charset,
        DEFAULT_COLLATION_NAME AS collationName FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME`)
      return {
        connectionId,
        defaultDatabase: connection.defaultDatabase,
        databases: rows.map((row) => ({ ...jsonValue(row), system: ['information_schema', 'mysql', 'performance_schema', 'sys'].includes(row.name) })),
      }
    })
  }

  async listTables({ connectionId, database, search = '', productionConfirmed = false } = {}) {
    const target = await this.resolveTarget({ connectionId, database, productionConfirmed })
    const term = typeof search === 'string' ? search.trim().slice(0, 100) : ''
    return this.withConnection(target.connection, target.database, async (client) => {
      const [rows] = await client.execute(`SELECT t.TABLE_SCHEMA AS \`schema\`, t.TABLE_NAME AS name, t.TABLE_TYPE AS type,
        COALESCE(t.TABLE_COMMENT, '') AS comment, COALESCE(t.TABLE_ROWS, 0) AS rowEstimate,
        COALESCE(t.DATA_LENGTH, 0) + COALESCE(t.INDEX_LENGTH, 0) AS dataBytes,
        (SELECT COUNT(DISTINCT s.INDEX_NAME) FROM information_schema.STATISTICS s
          WHERE s.TABLE_SCHEMA=t.TABLE_SCHEMA AND s.TABLE_NAME=t.TABLE_NAME) AS indexCount
        FROM information_schema.TABLES t
        WHERE t.TABLE_SCHEMA=? AND (?='' OR t.TABLE_NAME LIKE CONCAT('%', ?, '%'))
        ORDER BY t.TABLE_NAME`, [target.database, term, term])
      return {
        connectionId,
        database: target.database,
        tables: rows.map((row) => {
          const table = jsonValue(row)
          return { ...table, summary: tableSummary(table.name, table.comment), summarySource: table.comment ? 'comment' : 'name' }
        }),
      }
    })
  }

  async describeTable({ connectionId, database, table, productionConfirmed = false } = {}) {
    if (typeof table !== 'string' || !/^[A-Za-z0-9_$]+$/.test(table)) throw new SqlPolicyError('invalid table name', 'INVALID_REQUEST')
    const target = await this.resolveTarget({ connectionId, database, productionConfirmed })
    return this.withConnection(target.connection, target.database, async (client) => {
      const [[tableRows], [columns], [indexRows], [foreignKeys]] = await Promise.all([
        client.execute(`SELECT TABLE_SCHEMA AS \`schema\`, TABLE_NAME AS name, COALESCE(TABLE_COMMENT, '') AS comment,
          COALESCE(TABLE_ROWS, 0) AS rowEstimate FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?`, [target.database, table]),
        client.execute(`SELECT COLUMN_NAME AS name, COLUMN_TYPE AS type, IS_NULLABLE='YES' AS nullable,
          COLUMN_KEY AS \`key\`, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra, COALESCE(COLUMN_COMMENT, '') AS comment
          FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION`, [target.database, table]),
        client.execute(`SELECT INDEX_NAME AS name, NON_UNIQUE=0 AS \`unique\`, INDEX_TYPE AS type,
          GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS columnList
          FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?
          GROUP BY INDEX_NAME, NON_UNIQUE, INDEX_TYPE ORDER BY INDEX_NAME`, [target.database, table]),
        client.execute(`SELECT CONSTRAINT_NAME AS name, COLUMN_NAME AS columnName,
          REFERENCED_TABLE_SCHEMA AS referencedSchema, REFERENCED_TABLE_NAME AS referencedTable,
          REFERENCED_COLUMN_NAME AS referencedColumn FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL
          ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`, [target.database, table]),
      ])
      if (!tableRows[0]) throw Object.assign(new Error('table not found'), { code: 'ER_NO_SUCH_TABLE' })
      return {
        connectionId,
        database: target.database,
        table: jsonValue(tableRows[0]),
        columns: columns.map(jsonValue),
        indexes: indexRows.map((row) => {
          const safe = jsonValue(row)
          const { columnList, ...rest } = safe
          return { ...rest, columns: String(columnList ?? '').split(',').filter(Boolean) }
        }),
        foreignKeys: foreignKeys.map(jsonValue),
      }
    })
  }

  async executeSql(sql, targetInput, { limit, operation = 'query' } = {}) {
    const target = await this.resolveTarget(targetInput)
    const limits = this.connectionLimits(target.connection)
    const rowLimit = asInteger(limit, limits.maxRows, 1, limits.maxRows)
    const started = Date.now()
    const rawSql = typeof sql === 'string' ? sql : ''
    const targetAudit = { connectionId: target.connection.id, database: target.database, environment: target.connection.environment }
    let checked
    try {
      checked = validateSql(sql, { maxRows: rowLimit })
      if (checked.mutating && targetInput.writeConfirmed !== true) {
        throw Object.assign(new Error('write confirmation required'), { code: 'WRITE_CONFIRMATION_REQUIRED' })
      }
    } catch (error) {
      this.recordAudit({
        ...targetAudit,
        operation,
        kind: 'denied',
        sqlHash: createHash('sha256').update(rawSql).digest('hex').slice(0, 16),
        sqlPreview: redactSql(rawSql),
        status: 'denied',
        durationMs: Date.now() - started,
        errorCode: safeError(error).code,
      })
      throw error
    }
    const auditBase = {
      ...targetAudit,
      operation,
      kind: checked.kind,
      sqlHash: createHash('sha256').update(checked.sql).digest('hex').slice(0, 16),
      sqlPreview: redactSql(checked.sql),
    }
    try {
      const result = await this.withConnection(target.connection, target.database, async (client) => {
        const runStatement = async () => {
          const [rows, fields] = await client.query({ sql: checked.sql, rowsAsArray: true })
          if (!Array.isArray(rows)) {
            const header = jsonValue(rows ?? {})
            const affectedRows = Number(header.affectedRows ?? 0)
            return {
              columns: [],
              rows: [],
              rowCount: affectedRows,
              affectedRows,
              changedRows: Number(header.changedRows ?? 0),
              insertId: header.insertId ?? 0,
              warningStatus: Number(header.warningStatus ?? 0),
              info: String(header.info ?? header.message ?? ''),
              statementKind: checked.kind,
              durationMs: Date.now() - started,
              target: targetAudit,
            }
          }
          const safeRows = rows.slice(0, rowLimit).map((row) => jsonValue(row))
          let totalCount = null
          if (checked.kind === 'select') {
            try {
              const [countRows] = await client.query({ sql: buildCountSql(checked.sql, { maxRows: rowLimit }), rowsAsArray: true })
              totalCount = Array.isArray(countRows) && countRows.length ? jsonValue(countRows[0]?.[0]) : null
            } catch {}
          }
          return {
            columns: Array.isArray(fields) ? fields.map((field) => ({
              name: field.name,
              originalName: field.orgName || '',
              table: field.table || '',
              originalTable: field.orgTable || field.table || '',
              schema: field.schema || '',
              type: field.typeName ?? String(field.columnType ?? ''),
            })) : [],
            rows: safeRows,
            rowCount: safeRows.length,
            totalCount,
            truncated: rows.length >= rowLimit,
            durationMs: Date.now() - started,
            target: targetAudit,
          }
        }
        if (checked.readOnly) {
          await client.query(`SET SESSION sql_select_limit = ${rowLimit}`)
          await client.query('START TRANSACTION READ ONLY')
          try { return await runStatement() }
          finally { await client.query('ROLLBACK').catch(() => {}) }
        }
        if (checked.ddl) return runStatement()
        await client.query('START TRANSACTION')
        try {
          const value = await runStatement()
          await client.query('COMMIT')
          return value
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {})
          throw error
        }
      })
      this.recordAudit({ ...auditBase, status: 'ok', durationMs: result.durationMs, rowCount: result.rowCount })
      return result
    } catch (error) {
      this.recordAudit({ ...auditBase, status: 'error', durationMs: Date.now() - started, errorCode: safeError(error).code })
      throw error
    }
  }

  async executeReadOnlyScript(sql, targetInput, { limit } = {}) {
    const target = await this.resolveTarget(targetInput)
    const limits = this.connectionLimits(target.connection)
    const rowLimit = asInteger(limit, limits.maxRows, 1, limits.maxRows)
    const started = Date.now()
    const rawSql = typeof sql === 'string' ? sql : ''
    const targetAudit = { connectionId: target.connection.id, database: target.database, environment: target.connection.environment }
    let checked
    try {
      checked = validateReadOnlyScript(rawSql, { maxRows: rowLimit })
    } catch (error) {
      this.recordAudit({
        ...targetAudit,
        operation: 'script',
        kind: 'denied',
        sqlHash: createHash('sha256').update(rawSql).digest('hex').slice(0, 16),
        sqlPreview: redactSql(rawSql),
        status: 'denied',
        durationMs: Date.now() - started,
        errorCode: safeError(error).code,
      })
      throw error
    }
    return this.withConnection(target.connection, target.database, async (client) => {
      await client.query(`SET SESSION sql_select_limit = ${rowLimit}`)
      await client.query('START TRANSACTION READ ONLY')
      const resultSets = []
      try {
        for (let index = 0; index < checked.statements.length; index += 1) {
          const statement = checked.statements[index]
          const statementStarted = Date.now()
          const auditBase = {
            ...targetAudit,
            operation: 'script',
            kind: statement.kind,
            statementIndex: index + 1,
            statementCount: checked.statements.length,
            sqlHash: createHash('sha256').update(statement.sql).digest('hex').slice(0, 16),
            sqlPreview: redactSql(statement.sql),
          }
          try {
            if (!statement.visible) {
              await client.query(statement.sql)
              this.recordAudit({ ...auditBase, status: 'ok', durationMs: Date.now() - statementStarted, rowCount: 0 })
              continue
            }
            const [rows, fields] = await client.query({ sql: statement.sql, rowsAsArray: true })
            if (!Array.isArray(rows)) throw new SqlPolicyError('read-only statement did not return a result set')
            const safeRows = rows.slice(0, rowLimit).map((row) => jsonValue(row))
            let totalCount = null
            if (statement.kind === 'select') {
              try {
                const countSql = buildCountSql(statement.sql, { maxRows: rowLimit })
                const [countRows] = await client.query({ sql: countSql, rowsAsArray: true })
                totalCount = Array.isArray(countRows) && countRows.length ? jsonValue(countRows[0]?.[0]) : null
              } catch {}
            }
            const result = {
              statementIndex: index + 1,
              statementKind: statement.kind,
              sqlPreview: redactSql(statement.sql),
              columns: Array.isArray(fields) ? fields.map((field) => ({
                name: field.name,
                originalName: field.orgName || '',
                table: field.table || '',
                originalTable: field.orgTable || field.table || '',
                schema: field.schema || '',
                type: field.typeName ?? String(field.columnType ?? ''),
              })) : [],
              rows: safeRows,
              rowCount: safeRows.length,
              totalCount,
              truncated: rows.length >= rowLimit,
              durationMs: Date.now() - statementStarted,
              target: targetAudit,
            }
            resultSets.push(result)
            this.recordAudit({ ...auditBase, status: 'ok', durationMs: result.durationMs, rowCount: result.rowCount })
          } catch (error) {
            const detail = safeError(error)
            this.recordAudit({
              ...auditBase,
              status: 'error',
              durationMs: Date.now() - statementStarted,
              errorCode: detail.code,
            })
            throw Object.assign(new Error(`第 ${index + 1} 条只读语句执行失败：${detail.message}`), { code: 'SCRIPT_STATEMENT_FAILED' })
          }
        }
        const finalResult = resultSets.at(-1) || { columns: [], rows: [], rowCount: 0, totalCount: null }
        return {
          ...finalResult,
          script: true,
          statementCount: checked.statements.length,
          resultSets,
          durationMs: Date.now() - started,
        }
      } finally {
        await client.query('ROLLBACK').catch(() => {})
      }
    })
  }

  query(input = {}) {
    let statements
    try {
      statements = splitSqlStatements(input.sql)
    } catch {
      return this.executeReadOnlyScript(input.sql, input, { limit: input.limit })
    }
    if (statements.length > 1 || /^\s*set\b/i.test(statements[0])) {
      return this.executeReadOnlyScript(input.sql, input, { limit: input.limit })
    }
    return this.executeSql(input.sql, input, { limit: input.limit, operation: 'query' })
  }

  async explain(input = {}) {
    const target = await this.resolveTarget(input)
    const select = validateExplainTarget(input.sql, { maxRows: this.connectionLimits(target.connection).maxRows })
    return this.executeSql(`EXPLAIN ${select}`, input, { limit: this.connectionLimits(target.connection).maxRows, operation: 'explain' })
  }

  listAudit({ connectionId, database, limit = 50 } = {}) {
    const safeLimit = asInteger(limit, 50, 1, this.auditLimit)
    return {
      entries: this.audit
        .filter((entry) => (!connectionId || entry.connectionId === connectionId) && (!database || entry.database === database))
        .slice(0, safeLimit)
        .map((entry) => ({ ...entry })),
    }
  }

  async createConnection({ connection: input, password, productionConfirmed = false } = {}) {
    const normalized = normalizeConnection(input)
    assertProduction(normalized, productionConfirmed)
    const value = assertPassword(password, true)
    const connection = await this.store.create(normalized)
    try {
      const credential = await this.credentials.set(connection.id, value)
      return publicConnection(connection, true, credential.backend)
    } catch (error) {
      await this.store.remove(connection.id).catch(() => {})
      throw error
    }
  }

  async updateConnection({ connectionId, connection: patch, password, productionConfirmed = false } = {}) {
    const existing = await this.getConnection(connectionId)
    const normalized = normalizeConnection(patch, existing)
    assertProduction(normalized, productionConfirmed)
    const value = assertPassword(password)
    const connection = await this.store.update(connectionId, normalized)
    if (value !== undefined) await this.credentials.set(existing.id, value)
    return publicConnection(connection, await this.credentialConfigured(connection))
  }

  async deleteConnection({ connectionId, confirmation } = {}) {
    if (confirmation !== connectionId) throw new ConnectionStoreError('connection deletion confirmation is invalid', 'DELETE_CONFIRMATION_REQUIRED')
    const removed = await this.store.remove(connectionId)
    const credentialDeleted = await this.credentials.delete(removed.id)
    return { connectionId: removed.id, credentialDeleted }
  }

  async testConnection({ connectionId, connection: input, password, productionConfirmed = false } = {}) {
    const connection = connectionId ? normalizeConnection(input ?? {}, await this.getConnection(connectionId)) : normalizeConnection(input)
    assertProduction(connection, productionConfirmed)
    const value = assertPassword(password, !connectionId)
    const started = Date.now()
    const server = await this.withConnection(connection, connection.defaultDatabase, async (client) => {
      const [rows] = await client.query('SELECT VERSION() AS version, DATABASE() AS databaseName, CURRENT_USER() AS currentUser')
      return jsonValue(rows[0] ?? {})
    }, value)
    return { connected: true, latencyMs: Date.now() - started, server }
  }

  async handle(method, rawParams = {}) {
    try {
      const params = assertPayload(rawParams)
      if (method === METHODS.PING) return ok({ status: 'ready', version: '0.2.7', platform: process.platform })
      if (method === METHODS.CONNECTIONS) return ok(await this.listConnections())
      if (method === METHODS.CONNECTION_CREATE) return ok(await this.createConnection(params))
      if (method === METHODS.CONNECTION_UPDATE) return ok(await this.updateConnection(params))
      if (method === METHODS.CONNECTION_DELETE) return ok(await this.deleteConnection(params))
      if (method === METHODS.CONNECTION_TEST) return ok(await this.testConnection(params))
      if (method === METHODS.DATABASES) return ok(await this.listDatabases(params))
      if (method === METHODS.STATUS) return ok(await this.connectionStatus(params))
      if (method === METHODS.TABLES) return ok(await this.listTables(params))
      if (method === METHODS.TABLE_DETAIL) return ok(await this.describeTable(params))
      if (method === METHODS.QUERY) return ok(await this.query(params))
      if (method === METHODS.EXPLAIN) return ok(await this.explain(params))
      if (method === METHODS.AUDIT) return ok(this.listAudit(params))
      if (method === METHODS.WORKSPACE_GET) return ok({ workspace: await this.workspace.load() })
      if (method === METHODS.WORKSPACE_SET) return ok({ workspace: await this.workspace.save(params.workspace) })
      return fail(new ConnectionStoreError(`unknown method: ${method}`, 'UNKNOWN_METHOD'))
    } catch (error) {
      return fail(error)
    }
  }
}
