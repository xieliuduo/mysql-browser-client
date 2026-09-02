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
    if (character === '/' && next === '*') throw new SqlPolicyError('SQL comments are not allowed')
    if (character === '-' && next === '-' && /\s/.test(sql[index + 2] ?? '')) throw new SqlPolicyError('SQL comments are not allowed')
    if (character === '#') throw new SqlPolicyError('SQL comments are not allowed')
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

function assertLimit(normalized, maxRows) {
  const matches = [...normalized.matchAll(/\blimit\s+(?:(\d+)\s*,\s*(\d+)|(\d+)(?:\s+offset\s+(\d+))?)/gi)]
  if (!matches.length) return
  const match = matches.at(-1)
  const count = Number(match[2] ?? match[3])
  const offset = Number(match[1] ?? match[4] ?? 0)
  if (!Number.isSafeInteger(count) || count > maxRows) throw new SqlPolicyError(`LIMIT must not exceed ${maxRows}`)
  if (!Number.isSafeInteger(offset) || offset > 100000) throw new SqlPolicyError('LIMIT offset must not exceed 100000')
}

export function validateSql(input, options = {}) {
  if (typeof input !== 'string' || input.trim().length === 0) throw new SqlPolicyError('SQL must be a non-empty string', 'INVALID_SQL')
  if (input.length > (options.maxSqlChars ?? 20000)) throw new SqlPolicyError('SQL is too long', 'INVALID_SQL')
  const sql = stripTrailingSemicolon(input)
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

