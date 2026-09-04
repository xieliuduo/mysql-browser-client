import { stripSqlComments } from '../extension/sql-utils.js'

const READ_ROOTS = new Set(['select', 'show', 'describe', 'desc', 'explain'])
const WRITE_ROOTS = new Set(['insert', 'update', 'delete', 'replace'])
const DDL_ROOTS = new Set(['create', 'alter', 'drop', 'truncate', 'rename'])
const ALLOWED_ROOTS = new Set([...READ_ROOTS, ...WRITE_ROOTS, ...DDL_ROOTS])
const DANGEROUS = [
  [/\bfor\s+(?:update|share)\b/i, 'row locking is not allowed'],
  [/\block\s+in\s+share\s+mode\b/i, 'row locking is not allowed'],
  [/\b(?:nowait|skip\s+locked)\b/i, 'locking modifiers are not allowed'],
  [/\bprocedure\b/i, 'PROCEDURE clauses are not allowed'],
  [/\bload_file\s*\(/i, 'LOAD_FILE is not allowed'],
  [/\bsleep\s*\(/i, 'SLEEP is not allowed'],
  [/\bbenchmark\s*\(/i, 'BENCHMARK is not allowed'],
  [/\bget_lock\s*\(/i, 'advisory locks are not allowed'],
  [/\brelease_lock\s*\(/i, 'advisory locks are not allowed'],
  [/:=/, 'variable assignment is not allowed'],
]

export class SqlPolicyError extends Error {
  constructor(message, code = 'SQL_POLICY_DENIED') {
    super(message)
    this.name = 'SqlPolicyError'
    this.code = code
  }
}

function scanSql(sql) {
  let quote = null
  let depth = 0
  let semicolons = 0
  let normalized = ''
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]
    const next = sql[index + 1]
    if (quote) {
      normalized += ' '
      if (character === '\\') {
        normalized += ' '
        index += 1
        continue
      }
      if (character === quote) {
        if (next === quote) {
          normalized += ' '
          index += 1
        } else quote = null
      }
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      normalized += ' '
      continue
    }
    if (character === ';') {
      semicolons += 1
      normalized += ';'
      continue
    }
    if (character === '(') depth += 1
    if (character === ')') depth = Math.max(0, depth - 1)
    normalized += character.toLowerCase()
  }
  if (quote) throw new SqlPolicyError('unterminated quoted value')
  return { normalized, semicolons, depth }
}

function stripTrailingSemicolon(sql) {
  const trimmed = sql.trim()
  return trimmed.endsWith(';') ? trimmed.slice(0, -1).trimEnd() : trimmed
}

function findTopLevelKeyword(sql, keyword) {
  let quote = null
  let depth = 0
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]
    const next = sql[index + 1]
    if (quote) {
      if (character === '\\') {
        index += 1
        continue
      }
      if (character === quote) {
        if (next === quote) index += 1
        else quote = null
      }
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (character === '(') {
      depth += 1
      continue
    }
    if (character === ')') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth === 0 && new RegExp(`^${keyword}\\b`, 'i').test(sql.slice(index)) && !/[A-Za-z0-9_$]/.test(sql[index - 1] || '')) {
      return index
    }
  }
  return -1
}

function stripTopLevelLimit(sql) {
  const limitIndex = findTopLevelKeyword(sql, 'limit')
  return limitIndex >= 0 ? sql.slice(0, limitIndex).trimEnd() : sql
}

function assertLimit(normalized, maxRows) {
  const matches = [...normalized.matchAll(/\blimit\s+(?:(\d+)\s*,\s*(\d+)|(\d+)(?:\s+offset\s+(\d+))?)/gi)]
  if (!matches.length) return
  const match = matches.at(-1)
  const count = Number(match[2] ?? match[3])
  const offset = Number(match[1] ?? match[4] ?? 0)
  if (!Number.isSafeInteger(count) || count > maxRows) throw new SqlPolicyError(`LIMIT must not exceed ${maxRows}`)
  if (!Number.isSafeInteger(offset) || offset > 100000) throw new SqlPolicyError('LIMIT offset must not exceed 100000')
}

export function splitSqlStatements(input, options = {}) {
  if (typeof input !== 'string' || input.trim().length === 0) throw new SqlPolicyError('SQL must be a non-empty string', 'INVALID_SQL')
  if (input.length > (options.maxSqlChars ?? 20000)) throw new SqlPolicyError('SQL is too long', 'INVALID_SQL')
  const sql = stripSqlComments(input)
  const statements = []
  let quote = null
  let depth = 0
  let start = 0
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]
    const next = sql[index + 1]
    if (quote) {
      if (character === '\\') {
        index += 1
        continue
      }
      if (character === quote) {
        if (next === quote) index += 1
        else quote = null
      }
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (character === '(') {
      depth += 1
      continue
    }
    if (character === ')') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (character === ';' && depth === 0) {
      const statement = sql.slice(start, index).trim()
      if (statement) statements.push(statement)
      start = index + 1
    }
  }
  if (quote) throw new SqlPolicyError('unterminated quoted value', 'INVALID_SQL')
  const trailing = sql.slice(start).trim()
  if (trailing) statements.push(trailing)
  if (!statements.length) throw new SqlPolicyError('SQL must contain an executable statement', 'INVALID_SQL')
  const maxStatements = options.maxStatements ?? 20
  if (statements.length > maxStatements) throw new SqlPolicyError(`script must not exceed ${maxStatements} statements`)
  return statements
}

function unwrapParenthesizedExpression(expression) {
  if (!expression.startsWith('(') || !expression.endsWith(')')) return null
  let quote = null
  let depth = 0
  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index]
    const next = expression[index + 1]
    if (quote) {
      if (character === '\\') {
        index += 1
        continue
      }
      if (character === quote) {
        if (next === quote) index += 1
        else quote = null
      }
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (character === '(') depth += 1
    else if (character === ')') {
      depth -= 1
      if (depth === 0 && index !== expression.length - 1) return null
      if (depth < 0) return null
    }
  }
  return !quote && depth === 0 ? expression.slice(1, -1).trim() : null
}

function isSafeVariableValue(expression) {
  if (/^(?:null|true|false)$/i.test(expression)) return true
  if (/^-?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i.test(expression)) return true
  if (/^@[A-Za-z_][A-Za-z0-9_$]*$/.test(expression)) return true
  if (!expression.startsWith("'") || !expression.endsWith("'")) return false
  for (let index = 1; index < expression.length - 1; index += 1) {
    if (expression[index] === '\\') {
      index += 1
      continue
    }
    if (expression[index] === "'") {
      if (expression[index + 1] === "'") index += 1
      else return false
    }
  }
  return true
}

function validateVariableStatement(sql, options) {
  if (/@@/.test(sql) || /^\s*set\s+(?:session|global|local)\b/i.test(sql)) {
    throw new SqlPolicyError('system and session variables are not allowed in read-only scripts')
  }
  const match = sql.match(/^\s*set\s+(@[A-Za-z_][A-Za-z0-9_$]*)\s*(?::=|=)\s*([\s\S]+?)\s*$/i)
  if (!match) throw new SqlPolicyError('SET may only assign one @user_variable')
  const expression = match[2].trim()
  if (isSafeVariableValue(expression)) {
    return { sql, kind: 'set-variable', variable: match[1], readOnly: true, visible: false }
  }
  const select = unwrapParenthesizedExpression(expression)
  if (!select) throw new SqlPolicyError('user variables may only use a literal, another user variable, or a parenthesized SELECT')
  if (/@@/.test(select)) throw new SqlPolicyError('system variables are not allowed in read-only scripts')
  const checked = validateSql(select, options)
  if (checked.kind !== 'select') throw new SqlPolicyError('user variable subqueries must be SELECT statements')
  return { sql, kind: 'set-variable', variable: match[1], readOnly: true, visible: false }
}

export function validateReadOnlyScript(input, options = {}) {
  const statements = splitSqlStatements(input, options).map((sql, index) => {
    try {
      if (/^\s*set\b/i.test(sql)) return validateVariableStatement(sql, options)
      if (/@@/.test(sql)) throw new SqlPolicyError('system variables are not allowed in read-only scripts')
      const checked = validateSql(sql, options)
      if (!['select', 'show', 'describe'].includes(checked.kind)) {
        throw new SqlPolicyError('read-only scripts only allow SELECT, SHOW, DESCRIBE, and SET @user_variable')
      }
      return { ...checked, visible: true }
    } catch (error) {
      if (error instanceof SqlPolicyError) throw new SqlPolicyError(`statement ${index + 1}: ${error.message}`, error.code)
      throw error
    }
  })
  const resultCount = statements.filter((statement) => statement.visible).length
  if (!resultCount) throw new SqlPolicyError('read-only scripts must include at least one query')
  return { statements, resultCount }
}

export function validateSql(input, options = {}) {
  if (typeof input !== 'string' || input.trim().length === 0) throw new SqlPolicyError('SQL must be a non-empty string', 'INVALID_SQL')
  if (input.length > (options.maxSqlChars ?? 20000)) throw new SqlPolicyError('SQL is too long', 'INVALID_SQL')
  const sql = stripTrailingSemicolon(stripSqlComments(input))
  if (!sql.trim()) throw new SqlPolicyError('SQL must contain an executable statement', 'INVALID_SQL')
  const scan = scanSql(sql)
  if (scan.semicolons > 0) throw new SqlPolicyError('only one SQL statement is allowed')
  if (scan.depth !== 0) throw new SqlPolicyError('unbalanced parentheses', 'INVALID_SQL')
  const root = scan.normalized.trimStart().match(/^([a-z]+)/)?.[1]
  if (!root || !ALLOWED_ROOTS.has(root)) throw new SqlPolicyError('unsupported SQL statement type')
  if (/^with\b/i.test(scan.normalized.trimStart())) throw new SqlPolicyError('CTEs are not enabled')
  if (root === 'explain') {
    if (/^\s*explain\s+analyze\b/i.test(scan.normalized)) throw new SqlPolicyError('EXPLAIN ANALYZE is not allowed')
    const rest = scan.normalized.replace(/^\s*explain\s+(?:format\s*=\s*(?:json|tree|traditional)\s+)?/i, '')
    if (!/^select\b/i.test(rest.trimStart())) throw new SqlPolicyError('EXPLAIN may only target SELECT')
  }
  if ((root === 'select' || root === 'explain') && /\binto\b/i.test(scan.normalized)) throw new SqlPolicyError('SELECT INTO is not allowed')
  for (const [pattern, reason] of DANGEROUS) {
    if (pattern.test(scan.normalized)) throw new SqlPolicyError(reason)
  }
  if (READ_ROOTS.has(root)) assertLimit(scan.normalized, options.maxRows ?? 200)
  return {
    sql,
    kind: root === 'desc' ? 'describe' : root,
    readOnly: READ_ROOTS.has(root),
    mutating: WRITE_ROOTS.has(root) || DDL_ROOTS.has(root),
    ddl: DDL_ROOTS.has(root),
  }
}

export function validateExplainTarget(input, options = {}) {
  const checked = validateSql(input, options)
  if (checked.kind !== 'select') throw new SqlPolicyError('EXPLAIN requires a SELECT statement')
  return checked.sql
}

export function buildCountSql(input, options = {}) {
  const checked = validateSql(input, options)
  if (checked.kind !== 'select') throw new SqlPolicyError('row count requires a SELECT statement')
  const source = stripTopLevelLimit(checked.sql)
  const fromIndex = findTopLevelKeyword(source, 'from')
  const orderIndex = findTopLevelKeyword(source, 'order')
  const selectList = fromIndex >= 0 ? source.slice('select'.length, fromIndex) : ''
  const simpleSelect = fromIndex >= 0
    && !/^\s*distinct\b/i.test(selectList)
    && findTopLevelKeyword(source, 'group') < 0
    && findTopLevelKeyword(source, 'having') < 0
    && findTopLevelKeyword(source, 'union') < 0
  if (simpleSelect) {
    const fromClause = source.slice(fromIndex, orderIndex >= 0 ? orderIndex : source.length).trimEnd()
    return `SELECT COUNT(*) AS totalCount ${fromClause}`
  }
  return `SELECT COUNT(*) AS totalCount FROM (${source}) AS \`__mysql_browser_count\``
}

export function redactSql(sql, maxLength = 240) {
  let output = ''
  let quote = null
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index]
    if (quote) {
      if (character === '\\') index += 1
      else if (character === quote) {
        if (sql[index + 1] === quote) index += 1
        else quote = null
      }
      if (!quote) output += '?'
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }
    output += character
  }
  return output.replace(/\b\d+(?:\.\d+)?\b/g, '?').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}
