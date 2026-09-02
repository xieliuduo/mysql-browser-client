export const SQL_COMPLETIONS = [
  'SELECT', 'INSERT INTO', 'UPDATE', 'DELETE FROM', 'REPLACE INTO', 'CREATE TABLE',
  'ALTER TABLE', 'DROP TABLE', 'TRUNCATE TABLE', 'FROM', 'WHERE', 'JOIN', 'LEFT JOIN',
  'RIGHT JOIN', 'INNER JOIN', 'ON', 'AS', 'SET', 'VALUES', 'AND', 'OR', 'IN',
  'IS NULL', 'IS NOT NULL', 'LIKE', 'BETWEEN', 'GROUP BY', 'ORDER BY', 'ASC', 'DESC',
  'HAVING', 'LIMIT', 'DISTINCT', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'COUNT(*)',
  'SUM()', 'AVG()', 'MIN()', 'MAX()', 'DATE()', 'COALESCE()', 'NOW()',
]

const SQL_ALIAS_STOP = new Set(['where', 'join', 'left', 'right', 'inner', 'on', 'group', 'order', 'having', 'limit', 'union'])

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

export function sqlCompletions(value, caret, tables, schemaCache) {
  const before = value.slice(0, caret)
  const tokenMatch = before.match(/([A-Za-z0-9_$]*)$/)
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
  } else if (/\b(?:FROM|JOIN|UPDATE|INTO)\s+`?[A-Za-z0-9_$-]*$/i.test(before)) {
    candidates = tables
      .filter((table) => table.name.toLowerCase().includes(lowerPrefix))
      .slice(0, 80)
      .map((table) => ({
        label: table.name,
        insert: table.name,
        kind: table.type === 'VIEW' ? '视图' : '表',
        detail: table.comment || table.summary || '',
        start,
      }))
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
    const tableCandidates = tables.map((table) => ({
      label: table.name,
      insert: table.name,
      kind: table.type === 'VIEW' ? '视图' : '表',
      detail: table.comment || table.summary || '',
      start,
    }))
    candidates = [...columnCandidates, ...aliasCandidates, ...tableCandidates, ...keywordCandidates]
      .filter((item) => !lowerPrefix || item.label.toLowerCase().startsWith(lowerPrefix))
  }

  const seen = new Set()
  return candidates.filter((item) => {
    const key = `${item.kind}:${item.label}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 14)
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

