export const SQL_COMPLETIONS = [
  'SELECT', 'INSERT INTO', 'UPDATE', 'DELETE FROM', 'REPLACE INTO', 'CREATE TABLE',
  'ALTER TABLE', 'DROP TABLE', 'TRUNCATE TABLE', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN',
  'RIGHT JOIN', 'INNER JOIN', 'ON', 'AS', 'SET', 'VALUES', 'AND', 'OR', 'IN',
  'IS NULL', 'IS NOT NULL', 'LIKE', 'BETWEEN', 'GROUP BY', 'ORDER BY', 'ASC', 'DESC',
  'HAVING', 'LIMIT', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'COUNT(*)',
  'SUM()', 'AVG()', 'MIN()', 'MAX()', 'DATE()', 'COALESCE()', 'NOW()',
]

const SQL_ALIAS_STOP = new Set(['where', 'join', 'left', 'right', 'inner', 'on', 'group', 'order', 'having', 'limit', 'union'])
const SQL_KEYWORDS = new Set([
  'ADD', 'ALL', 'ALTER', 'ANALYZE', 'AND', 'AS', 'ASC', 'BETWEEN', 'BY', 'CASE',
  'CREATE', 'CROSS', 'DATABASE', 'DEFAULT', 'DELETE', 'DESC', 'DESCRIBE', 'DISTINCT',
  'DROP', 'ELSE', 'END', 'EXISTS', 'EXPLAIN', 'FALSE', 'FOR', 'FOREIGN', 'FROM',
  'FULL', 'GROUP', 'HAVING', 'IN', 'INDEX', 'INNER', 'INSERT', 'INTO', 'IS', 'JOIN',
  'KEY', 'LEFT', 'LIKE', 'LIMIT', 'LOCK', 'NOT', 'NULL', 'OFFSET', 'ON', 'OR', 'ORDER',
  'OUTER', 'PRIMARY', 'REFERENCES', 'RENAME', 'REPLACE', 'RIGHT', 'SELECT', 'SET',
  'SHOW', 'TABLE', 'THEN', 'TO', 'TRUE', 'TRUNCATE', 'UNION', 'UNIQUE', 'UPDATE',
  'USE', 'USING', 'VALUES', 'VIEW', 'WHEN', 'WHERE', 'WITH',
])
const SQL_TYPES = new Set([
  'BIGINT', 'BINARY', 'BIT', 'BLOB', 'BOOLEAN', 'CHAR', 'DATE', 'DATETIME', 'DECIMAL',
  'DOUBLE', 'ENUM', 'FLOAT', 'INT', 'INTEGER', 'JSON', 'LONGBLOB', 'LONGTEXT',
  'MEDIUMBLOB', 'MEDIUMINT', 'MEDIUMTEXT', 'NUMERIC', 'REAL', 'SET', 'SMALLINT',
  'TEXT', 'TIME', 'TIMESTAMP', 'TINYBLOB', 'TINYINT', 'TINYTEXT', 'VARBINARY',
  'VARCHAR', 'YEAR',
])
const FORMAT_COMPOUNDS = new Map([
  ['GROUP', 'BY'],
  ['ORDER', 'BY'],
  ['LEFT', 'JOIN'],
  ['RIGHT', 'JOIN'],
  ['INNER', 'JOIN'],
  ['CROSS', 'JOIN'],
  ['FULL', 'JOIN'],
  ['INSERT', 'INTO'],
  ['DELETE', 'FROM'],
  ['CREATE', 'TABLE'],
  ['ALTER', 'TABLE'],
  ['DROP', 'TABLE'],
  ['RENAME', 'TABLE'],
  ['UNION', 'ALL'],
])
const FORMAT_MAJOR = new Set([
  'SELECT', 'FROM', 'WHERE', 'GROUP BY', 'ORDER BY', 'HAVING', 'LIMIT', 'OFFSET',
  'SET', 'VALUES', 'RETURNING', 'UNION', 'UNION ALL', 'INSERT INTO', 'UPDATE',
  'DELETE FROM', 'REPLACE', 'CREATE TABLE', 'ALTER TABLE', 'DROP TABLE',
  'TRUNCATE', 'RENAME TABLE',
])
const FORMAT_JOINS = new Set(['JOIN', 'LEFT JOIN', 'RIGHT JOIN', 'INNER JOIN', 'CROSS JOIN', 'FULL JOIN'])

function isSqlLineCommentStart(sql, index) {
  return sql[index] === '#'
    || sql[index] === '-' && sql[index + 1] === '-' && /[\s\u0000-\u001f]/.test(sql[index + 2] ?? '\n')
}

function tokenizeSql(sql) {
  const source = String(sql ?? '')
  const tokens = []
  let index = 0
  const push = (type, start, end) => tokens.push({ type, value: source.slice(start, end) })
  while (index < source.length) {
    const start = index
    const character = source[index]
    const next = source[index + 1]
    if (/\s/.test(character)) {
      while (index < source.length && /\s/.test(source[index])) index += 1
      push('whitespace', start, index)
      continue
    }
    if (isSqlLineCommentStart(source, index)) {
      while (index < source.length && source[index] !== '\n' && source[index] !== '\r') index += 1
      push('comment', start, index)
      continue
    }
    if (character === '/' && next === '*') {
      index += 2
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1
      if (index < source.length) index += 2
      push('comment', start, index)
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      const quote = character
      index += 1
      while (index < source.length) {
        if (source[index] === '\\') {
          index = Math.min(source.length, index + 2)
          continue
        }
        if (source[index] === quote) {
          if (source[index + 1] === quote) {
            index += 2
            continue
          }
          index += 1
          break
        }
        index += 1
      }
      push(quote === '`' ? 'identifier' : 'string', start, index)
      continue
    }
    if (/[A-Za-z_$]/.test(character)) {
      index += 1
      while (index < source.length && /[A-Za-z0-9_$]/.test(source[index])) index += 1
      push('word', start, index)
      continue
    }
    if (/\d/.test(character)) {
      index += 1
      while (index < source.length && /[A-Fa-f0-9_xXbB.eE+-]/.test(source[index])) {
        if ((source[index] === '+' || source[index] === '-') && !/[eE]/.test(source[index - 1])) break
        index += 1
      }
      push('number', start, index)
      continue
    }
    if ('(),.;'.includes(character)) {
      index += 1
      push('punctuation', start, index)
      continue
    }
    if ('=<>!+-*/%|&^~:'.includes(character)) {
      index += 1
      while (index < source.length && '=<>!|&:'.includes(source[index])) index += 1
      push('operator', start, index)
      continue
    }
    index += 1
    push('plain', start, index)
  }
  return tokens
}

export function stripSqlComments(sql) {
  return tokenizeSql(sql).map((token) => token.type === 'comment'
    ? token.value.replace(/[^\r\n]/g, ' ')
    : token.value).join('')
}

export function highlightSql(sql) {
  const tokens = tokenizeSql(sql)
  return tokens.map((token, index) => {
    let kind = token.type
    if (token.type === 'word') {
      const upper = token.value.toUpperCase()
      const next = tokens.slice(index + 1).find((item) => item.type !== 'whitespace')
      if (SQL_KEYWORDS.has(upper) || SQL_TYPES.has(upper)) kind = 'keyword'
      else if (next?.value === '(') kind = 'function'
      else kind = 'name'
    }
    const escaped = escapeHtml(token.value)
    return ['whitespace', 'punctuation', 'plain', 'name'].includes(kind)
      ? escaped
      : `<span class="sql-token-${kind}">${escaped}</span>`
  }).join('')
}

function compactFormatTokens(sql) {
  const raw = tokenizeSql(sql).filter((token) => token.type !== 'whitespace')
  const tokens = []
  for (let index = 0; index < raw.length; index += 1) {
    const token = raw[index]
    const upper = token.type === 'word' ? token.value.toUpperCase() : ''
    const expected = FORMAT_COMPOUNDS.get(upper)
    const following = raw[index + 1]
    if (expected && following?.type === 'word' && following.value.toUpperCase() === expected) {
      tokens.push({ type: 'word', value: `${upper} ${expected}`, upper: `${upper} ${expected}` })
      index += 1
    } else {
      tokens.push({ ...token, upper })
    }
  }
  return tokens
}

export function formatSql(sql) {
  const tokens = compactFormatTokens(sql)
  if (!tokens.length) return ''
  const lines = []
  let line = ''
  let parenthesisDepth = 0
  let clause = ''
  const trimLine = () => { line = line.replace(/[ \t]+$/g, '') }
  const newline = (indent = 0) => {
    trimLine()
    if (line.trim()) lines.push(line)
    line = ' '.repeat(Math.max(0, indent))
  }
  const append = (value, options = {}) => {
    const noSpaceBefore = options.noSpaceBefore || !line.trim() || /[\s.(]$/.test(line)
    if (!noSpaceBefore) line += ' '
    line += value
  }
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    const upper = token.upper || ''
    const previous = tokens[index - 1]
    const next = tokens[index + 1]
    if (token.type === 'comment') {
      if (line.trim()) newline()
      line += token.value.trimEnd()
      newline()
      continue
    }
    if (token.type === 'word' && parenthesisDepth === 0 && (FORMAT_MAJOR.has(upper) || FORMAT_JOINS.has(upper))) {
      if (line.trim()) newline()
      clause = upper
      line += upper
      if (next) line += ' '
      continue
    }
    if (token.type === 'word' && parenthesisDepth === 0 && (upper === 'AND' || upper === 'OR')) {
      newline(2)
      line += `${upper} `
      continue
    }
    if (token.value === '(') {
      const functionLike = previous?.type === 'word' && !SQL_KEYWORDS.has(previous.upper)
      append('(', { noSpaceBefore: functionLike || previous?.type === 'identifier' })
      parenthesisDepth += 1
      continue
    }
    if (token.value === ')') {
      trimLine()
      line += ')'
      parenthesisDepth = Math.max(0, parenthesisDepth - 1)
      continue
    }
    if (token.value === ',') {
      trimLine()
      line += ','
      if (parenthesisDepth === 0 && ['SELECT', 'SET', 'VALUES', 'GROUP BY', 'ORDER BY'].includes(clause)) newline(2)
      else line += ' '
      continue
    }
    if (token.value === '.') {
      trimLine()
      line += '.'
      continue
    }
    if (token.value === ';') {
      trimLine()
      line += ';'
      if (next) newline()
      clause = ''
      continue
    }
    if (token.type === 'operator') {
      append(token.value)
      line += ' '
      continue
    }
    const value = token.type === 'word' && (SQL_KEYWORDS.has(upper) || SQL_TYPES.has(upper)) ? upper : token.value
    append(value, { noSpaceBefore: previous?.value === '.' })
  }
  trimLine()
  if (line.trim()) lines.push(line)
  return lines.join('\n').replace(/[ \t]+\n/g, '\n').trim()
}

export function quoteSqlIdentifier(value) {
  return `\`${String(value ?? '').replace(/`/g, '``')}\``
}

export function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return `'${text.replace(/\\/g, '\\\\').replace(/\0/g, '\\0').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\u001a/g, '\\Z').replace(/'/g, "''")}'`
}

function clipboardCell(value) {
  if (value === null || value === undefined) return 'NULL'
  return (typeof value === 'object' ? JSON.stringify(value) : String(value))
    .replace(/\t/g, '\\t')
    .replace(/\r?\n/g, '\\n')
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function tableClipboard(columns, rows) {
  const headers = columns.map((column, index) => String(column?.name || `column_${index + 1}`))
  const values = (Array.isArray(rows) ? rows : []).map((row) => headers.map((_header, index) => clipboardCell(row?.[index])))
  return {
    text: [headers.join('\t'), ...values.map((row) => row.join('\t'))].join('\n'),
    html: `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${values.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
  }
}

export function rowTableClipboard(columns, row) {
  return tableClipboard(columns, [row])
}

export function classifyColumnType(column, tableDetail, sampleValue) {
  const name = String(column?.originalName || column?.name || '')
  const detail = tableDetail?.columns?.find((item) => item.name === name)
  const rawType = String(detail?.type || column?.typeName || column?.type || '').toLowerCase()
  if (/\b(date|datetime|timestamp|time|year)\b/.test(rawType)) return 'datetime'
  if (/\b(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|bit)\b/.test(rawType)) return 'number'
  if (/\b(tinytext|mediumtext|longtext|text|json|blob)\b/.test(rawType)) return 'longtext'
  if (/\b(char|varchar|enum|set|binary|varbinary)\b/.test(rawType)) return 'text'
  if (typeof sampleValue === 'number' || typeof sampleValue === 'bigint') return 'number'
  if (sampleValue instanceof Date || typeof sampleValue === 'string' && /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?/.test(sampleValue)) return 'datetime'
  if (typeof sampleValue === 'string' && sampleValue.length > 255) return 'longtext'
  return typeof sampleValue === 'string' ? 'text' : 'unknown'
}

function findClauseIndex(sql, pattern) {
  const match = pattern.exec(sql)
  return match ? match.index : -1
}

function splitTrailingSemicolon(sql) {
  const trimmed = String(sql || '').trim()
  return trimmed.endsWith(';')
    ? { sql: trimmed.slice(0, -1).trimEnd(), suffix: ';' }
    : { sql: trimmed, suffix: '' }
}

function withMarker(sql, marker, replacement) {
  const index = sql.indexOf(marker)
  if (index < 0) return { sql, selectionStart: sql.length, selectionEnd: sql.length }
  const next = `${sql.slice(0, index)}${replacement}${sql.slice(index + marker.length)}`
  return { sql: next, selectionStart: index, selectionEnd: index + replacement.length }
}

function addWhereCondition(input, expression, markerReplacement = '') {
  const { sql, suffix } = splitTrailingSemicolon(input)
  const boundaryIndexes = [
    findClauseIndex(sql, /\bGROUP\s+BY\b/i),
    findClauseIndex(sql, /\bHAVING\b/i),
    findClauseIndex(sql, /\bORDER\s+BY\b/i),
    findClauseIndex(sql, /\bLIMIT\b/i),
  ].filter((index) => index >= 0)
  const boundary = boundaryIndexes.length ? Math.min(...boundaryIndexes) : sql.length
  const head = sql.slice(0, boundary).trimEnd()
  const tail = sql.slice(boundary).trimStart()
  const connector = /\bWHERE\b/i.test(head) ? '\n  AND ' : '\nWHERE '
  const next = `${head}${connector}${expression}${tail ? `\n${tail}` : ''}${suffix}`
  return withMarker(next, '__DMC_VALUE__', markerReplacement)
}

function addOrderBy(input, columnName, direction) {
  const { sql, suffix } = splitTrailingSemicolon(input)
  const quoted = quoteSqlIdentifier(columnName)
  const limitIndex = findClauseIndex(sql, /\bLIMIT\b/i)
  const beforeLimit = (limitIndex >= 0 ? sql.slice(0, limitIndex) : sql).trimEnd()
  const limit = limitIndex >= 0 ? sql.slice(limitIndex).trimStart() : ''
  const next = /\bORDER\s+BY\b/i.test(beforeLimit)
    ? `${beforeLimit}, ${quoted} ${direction}${limit ? `\n${limit}` : ''}${suffix}`
    : `${beforeLimit}\nORDER BY ${quoted} ${direction}${limit ? `\n${limit}` : ''}${suffix}`
  return { sql: next, selectionStart: next.length, selectionEnd: next.length }
}

export function applyColumnOperation(input, columnName, operation) {
  const column = quoteSqlIdentifier(columnName)
  const sql = String(input || '').trim() || 'SELECT * FROM '
  if (operation === 'order-desc') return addOrderBy(sql, columnName, 'DESC')
  if (operation === 'order-asc') return addOrderBy(sql, columnName, 'ASC')
  const expressions = {
    'number-eq': [`${column} = __DMC_VALUE__`, '0'],
    'number-gt': [`${column} > __DMC_VALUE__`, '0'],
    'number-lt': [`${column} < __DMC_VALUE__`, '0'],
    'number-gte': [`${column} >= __DMC_VALUE__`, '0'],
    'number-lte': [`${column} <= __DMC_VALUE__`, '0'],
    'number-between': [`${column} BETWEEN __DMC_VALUE__`, '0 AND 100'],
    'number-in': [`${column} IN (__DMC_VALUE__)`, '1, 2'],
    'text-eq': [`${column} = '__DMC_VALUE__'`, '值'],
    'text-like': [`${column} LIKE '%__DMC_VALUE__%'`, '关键词'],
    'text-prefix': [`${column} LIKE '__DMC_VALUE__%'`, '前缀'],
    'text-in': [`${column} IN (__DMC_VALUE__)`, "'值1', '值2'"],
    'date-after': [`${column} >= '__DMC_VALUE__'`, 'YYYY-MM-DD HH:mm:ss'],
    'date-before': [`${column} <= '__DMC_VALUE__'`, 'YYYY-MM-DD HH:mm:ss'],
    'date-between': [`${column} BETWEEN '__DMC_VALUE__'`, "YYYY-MM-DD 00:00:00' AND 'YYYY-MM-DD 23:59:59"],
    'is-null': [`${column} IS NULL`, ''],
    'is-not-null': [`${column} IS NOT NULL`, ''],
  }
  const [expression, replacement] = expressions[operation] || []
  if (!expression) return { sql, selectionStart: sql.length, selectionEnd: sql.length }
  return addWhereCondition(sql, expression, replacement)
}

function fuzzySubsequenceMatch(value, query) {
  let queryIndex = 0
  for (const character of value) {
    if (character === query[queryIndex]) queryIndex += 1
    if (queryIndex === query.length) return true
  }
  return query.length === 0
}

export function fuzzyTextScore(value, query) {
  const text = String(value ?? '').trim().toLowerCase()
  const keyword = String(query ?? '').trim().toLowerCase()
  if (!keyword) return 0
  if (text === keyword) return 0
  if (text.startsWith(keyword)) return 1
  if (text.split(/[\s_$-]+/).some((part) => part.startsWith(keyword))) return 2
  if (text.includes(keyword)) return 3
  if (fuzzySubsequenceMatch(text, keyword)) return 4
  return Number.POSITIVE_INFINITY
}

function tableMatchScore(table, query) {
  if (!query) return 0
  const nameScore = fuzzyTextScore(table.name, query)
  if (Number.isFinite(nameScore)) return nameScore
  const description = `${table.comment || ''} ${table.summary || ''}`.toLowerCase()
  const descriptionScore = fuzzyTextScore(description, query)
  if (Number.isFinite(descriptionScore)) return 5 + descriptionScore
  return Number.POSITIVE_INFINITY
}

function tableCompletionCandidates(tables, prefix, start) {
  const query = prefix.toLowerCase()
  const ranked = tables.map((table, index) => ({ table, index, score: tableMatchScore(table, query) }))
  if (query) {
    ranked.sort((left, right) =>
      left.score - right.score
      || left.table.name.length - right.table.name.length
      || left.table.name.localeCompare(right.table.name)
      || left.index - right.index)
  }
  return ranked
    .filter((item) => Number.isFinite(item.score))
    .map(({ table }) => ({
      label: table.name,
      insert: table.name,
      kind: table.type === 'VIEW' ? '视图' : '表',
      detail: table.comment || table.summary || '当前数据库',
      start,
    }))
}

export function sqlCompletions(value, caret, tables, schemaCache) {
  const before = value.slice(0, caret)
  const tokenMatch = before.match(/([\p{L}\p{N}_$-]*)$/u)
  const prefix = tokenMatch?.[1] || ''
  const start = caret - prefix.length
  const lowerPrefix = prefix.toLowerCase()
  const aliases = new Map()
  const referenced = []

  for (const match of before.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+`?([A-Za-z0-9_$-]+)`?(?:\s+(?:AS\s+)?([A-Za-z0-9_$]+))?/gi)) {
    const table = match[1]
    const alias = match[2] && !SQL_ALIAS_STOP.has(match[2].toLowerCase()) ? match[2] : table
    aliases.set(alias.toLowerCase(), table)
    aliases.set(table.toLowerCase(), table)
    if (!referenced.includes(table)) referenced.push(table)
  }

  const dot = before.match(/([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]*)$/)
  let candidates = []
  if (dot) {
    const table = aliases.get(dot[1].toLowerCase()) || dot[1]
    const columnPrefix = dot[2].toLowerCase()
    const columns = schemaCache[table]?.columns || []
    candidates = columns
      .filter((column) => column.name.toLowerCase().startsWith(columnPrefix))
      .map((column) => ({
        label: column.name,
        insert: column.name,
        kind: '字段',
        detail: `${table} · ${column.type || ''}`,
        start: caret - dot[2].length,
      }))
  } else if (/\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+`?[\p{L}\p{N}_$-]*$/iu.test(before)) {
    return tableCompletionCandidates(tables, prefix, start)
  } else {
    const columnCandidates = referenced.flatMap((table) =>
      (schemaCache[table]?.columns || []).map((column) => ({
        label: column.name,
        insert: column.name,
        kind: '字段',
        detail: `${table} · ${column.type || ''}`,
        start,
      })),
    )
    const aliasCandidates = [...new Set(aliases.keys())].map((alias) => ({
      label: alias,
      insert: alias,
      kind: '别名',
      detail: aliases.get(alias),
      start,
    }))
    const keywordCandidates = SQL_COMPLETIONS.map((keyword) => ({
      label: keyword,
      insert: keyword,
      kind: keyword.includes('(') ? '函数' : '关键字',
      detail: 'MySQL',
      start,
    }))
    const tableCandidates = tableCompletionCandidates(tables, prefix, start)
    candidates = [...columnCandidates, ...aliasCandidates, ...tableCandidates, ...keywordCandidates]
      .filter((item) => !lowerPrefix || item.label.toLowerCase().startsWith(lowerPrefix))
  }

  const seen = new Set()
  return candidates.filter((item) => {
    const key = `${item.kind}:${item.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 80)
}

export function rowSqlContext(result, row, selectedTable, tableDetail) {
  const columns = Array.isArray(result?.columns) ? result.columns : []
  const originTables = [...new Set(columns.map((column) => column.originalTable || column.table || '').filter(Boolean))]
  const targetTable = originTables.length === 1
    ? originTables[0]
    : selectedTable && originTables.includes(selectedTable) ? selectedTable
      : originTables.length === 0 ? selectedTable
        : ''
  if (!targetTable) return null

  const hasOriginMetadata = columns.some((column) => column.originalTable || column.table || column.originalName)
  const seen = new Set()
  const entries = columns.map((column, index) => {
    const originTable = column.originalTable || column.table || ''
    if (hasOriginMetadata && originTable && originTable !== targetTable) return null
    if (hasOriginMetadata && !originTable && !column.originalName) return null
    const name = String(column.originalName || column.name || '').trim()
    if (!name || seen.has(name)) return null
    seen.add(name)
    return { name, value: row[index] }
  }).filter(Boolean)
  if (!entries.length) return null

  const entryNames = new Set(entries.map((entry) => entry.name))
  const matchingDetail = tableDetail?.table?.name === targetTable ? tableDetail : null
  let keyNames = (matchingDetail?.columns || [])
    .filter((column) => column.key === 'PRI' && entryNames.has(column.name))
    .map((column) => column.name)
  if (!keyNames.length) {
    const uniqueIndex = (matchingDetail?.indexes || []).find((index) =>
      index.unique && index.name !== 'PRIMARY' && index.columns?.length
      && index.columns.every((name) => entryNames.has(name) && entries.find((entry) => entry.name === name)?.value !== null),
    )
    keyNames = uniqueIndex?.columns || []
  }
  if (!keyNames.length) keyNames = entries.map((entry) => entry.name)
  return { targetTable, entries, keyNames }
}

export function buildRowSql(kind, context) {
  if (!context) return ''
  const table = quoteSqlIdentifier(context.targetTable)
  const byName = new Map(context.entries.map((entry) => [entry.name, entry]))
  const whereEntries = context.keyNames.map((name) => byName.get(name)).filter(Boolean)
  const predicate = whereEntries.map((entry) => entry.value === null
    ? `${quoteSqlIdentifier(entry.name)} IS NULL`
    : `${quoteSqlIdentifier(entry.name)} = ${sqlLiteral(entry.value)}`).join('\n  AND ')
  if (kind === 'insert') {
    return `INSERT INTO ${table} (\n  ${context.entries.map((entry) => quoteSqlIdentifier(entry.name)).join(',\n  ')}\n) VALUES (\n  ${context.entries.map((entry) => sqlLiteral(entry.value)).join(',\n  ')}\n);`
  }
  if (kind === 'delete') return `DELETE FROM ${table}\nWHERE ${predicate}\nLIMIT 1;`
  const keySet = new Set(context.keyNames)
  let updateEntries = context.entries.filter((entry) => !keySet.has(entry.name))
  if (!updateEntries.length) updateEntries = context.entries
  return `UPDATE ${table}\nSET\n  ${updateEntries.map((entry) => `${quoteSqlIdentifier(entry.name)} = ${sqlLiteral(entry.value)}`).join(',\n  ')}\nWHERE ${predicate}\nLIMIT 1;`
}
