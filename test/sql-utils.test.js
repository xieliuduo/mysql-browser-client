import test from 'node:test'
import assert from 'node:assert/strict'
import { applyColumnOperation, buildRowSql, classifyColumnType, formatSql, fuzzyTextScore, highlightSql, rowSqlContext, rowTableClipboard, sqlCompletions, stripSqlComments, tableClipboard } from '../extension/sql-utils.js'

test('completes table names and alias-qualified fields', () => {
  const tables = [{ name: 'vehicle_base', type: 'BASE TABLE', comment: '车辆基础' }]
  const schema = { vehicle_base: { columns: [{ name: 'vehicle_id', type: 'varchar(64)' }, { name: 'status', type: 'tinyint' }] } }
  assert.equal(sqlCompletions('SELECT * FROM veh', 17, tables, schema)[0].label, 'vehicle_base')
  const aliased = 'SELECT * FROM vehicle_base vb WHERE vb.veh'
  assert.equal(sqlCompletions(aliased, aliased.length, tables, schema)[0].label, 'vehicle_id')
})

test('returns every table from the current database in table-name context', () => {
  const tables = Array.from({ length: 120 }, (_, index) => ({
    name: `archive_table_${String(index + 1).padStart(3, '0')}`,
    type: 'BASE TABLE',
    comment: `归档表 ${index + 1}`,
  }))
  const all = sqlCompletions('SELECT * FROM ', 14, tables, {})
  assert.equal(all.length, 120)
  assert.equal(all[0].label, 'archive_table_001')
  assert.equal(all.at(-1).label, 'archive_table_120')
})

test('ranks table completion by exact, prefix, segment, description, and fuzzy matches', () => {
  const tables = [
    { name: 'archived_vehicle_events', type: 'BASE TABLE', comment: '' },
    { name: 'vehicle', type: 'BASE TABLE', comment: '' },
    { name: 'vehicle_base', type: 'BASE TABLE', comment: '' },
    { name: 'base_vehicle_log', type: 'BASE TABLE', comment: '' },
    { name: 'fleet_records', type: 'BASE TABLE', comment: '车辆历史' },
  ]
  const sql = 'SELECT * FROM vehicle'
  assert.deepEqual(
    sqlCompletions(sql, sql.length, tables, {}).map((item) => item.label),
    ['vehicle', 'vehicle_base', 'base_vehicle_log', 'archived_vehicle_events'],
  )
  const descriptionSql = 'SELECT * FROM 历史'
  assert.equal(sqlCompletions(descriptionSql, descriptionSql.length, tables, {})[0]?.label, 'fleet_records')
})

test('scores saved-query names with fuzzy matching', () => {
  assert.equal(fuzzyTextScore('车辆基础查询', '车辆基础查询'), 0)
  assert.equal(fuzzyTextScore('车辆基础查询', '车辆'), 1)
  assert.equal(fuzzyTextScore('daily_vehicle_report', 'vehicle'), 2)
  assert.equal(fuzzyTextScore('订单车辆统计', '车辆'), 3)
  assert.equal(fuzzyTextScore('vehicle mission report', 'vmr'), 4)
  assert.equal(fuzzyTextScore('用户登录记录', '库存'), Number.POSITIVE_INFINITY)
})

test('builds row SQL using primary key metadata', () => {
  const result = {
    columns: [
      { name: 'id', originalName: 'id', originalTable: 'vehicle_base' },
      { name: 'status', originalName: 'status', originalTable: 'vehicle_base' },
    ],
  }
  const detail = {
    table: { name: 'vehicle_base' },
    columns: [{ name: 'id', key: 'PRI' }, { name: 'status', key: '' }],
    indexes: [],
  }
  const context = rowSqlContext(result, [7, 2], 'vehicle_base', detail)
  assert.deepEqual(context.keyNames, ['id'])
  assert.match(buildRowSql('update', context), /WHERE `id` = 7/)
  assert.match(buildRowSql('delete', context), /DELETE FROM `vehicle_base`/)
  assert.match(buildRowSql('insert', context), /INSERT INTO `vehicle_base`/)
})

test('formats one result row as spreadsheet text and HTML table', () => {
  const copied = rowTableClipboard(
    [{ name: 'id' }, { name: 'vehicle_name' }, { name: 'meta' }],
    [7, '配送车\nA', { online: true }],
  )
  assert.equal(copied.text, 'id\tvehicle_name\tmeta\n7\t配送车\\nA\t{"online":true}')
  assert.match(copied.html, /<th>vehicle_name<\/th>/)
  assert.match(copied.html, /<td>配送车\\nA<\/td>/)
})

test('formats a complete result set for spreadsheet clipboard paste', () => {
  const copied = tableClipboard(
    [{ name: 'id' }, { name: 'email' }],
    [[1, 'a@example.com'], [2, 'b@example.com']],
  )
  assert.equal(copied.text, 'id\temail\n1\ta@example.com\n2\tb@example.com')
  assert.match(copied.html, /<tbody><tr><td>1<\/td><td>a@example\.com<\/td><\/tr><tr><td>2<\/td><td>b@example\.com<\/td><\/tr><\/tbody>/)
})

test('classifies result columns using schema types and values', () => {
  const detail = { columns: [{ name: 'created_at', type: 'datetime' }, { name: 'amount', type: 'decimal(10,2)' }, { name: 'remark', type: 'longtext' }] }
  assert.equal(classifyColumnType({ name: 'created_at' }, detail), 'datetime')
  assert.equal(classifyColumnType({ name: 'amount' }, detail), 'number')
  assert.equal(classifyColumnType({ name: 'remark' }, detail), 'longtext')
  assert.equal(classifyColumnType({ name: 'unknown' }, null, 8), 'number')
})

test('merges field shortcuts before ORDER BY and LIMIT', () => {
  const filtered = applyColumnOperation('SELECT * FROM vehicle_base ORDER BY id DESC LIMIT 20', 'status', 'number-eq')
  assert.equal(filtered.sql, 'SELECT * FROM vehicle_base\nWHERE `status` = 0\nORDER BY id DESC LIMIT 20')
  assert.equal(filtered.sql.slice(filtered.selectionStart, filtered.selectionEnd), '0')
  const ordered = applyColumnOperation('SELECT * FROM vehicle_base LIMIT 20', 'created_at', 'order-desc')
  assert.equal(ordered.sql, 'SELECT * FROM vehicle_base\nORDER BY `created_at` DESC\nLIMIT 20')
})

test('strips SQL comments without changing quoted comment markers', () => {
  const sql = "-- heading\nSELECT '# kept', '-- kept' FROM users /* hidden */\nWHERE note = 'a/*b*/' # tail"
  const stripped = stripSqlComments(sql)
  assert.doesNotMatch(stripped, /heading|hidden|tail/)
  assert.match(stripped, /'# kept'/)
  assert.match(stripped, /'-- kept'/)
  assert.match(stripped, /'a\/\*b\*\/'/)
  assert.equal(stripped.split('\n').length, sql.split('\n').length)
})

test('formats common SQL clauses and preserves comments', () => {
  const formatted = formatSql("select id,name from users where active=1 and name like 'A%' order by id desc limit 20; -- keep")
  assert.equal(formatted, [
    'SELECT id,',
    '  name',
    'FROM users',
    'WHERE active = 1',
    "  AND name LIKE 'A%'",
    'ORDER BY id DESC',
    'LIMIT 20;',
    '-- keep',
  ].join('\n'))
})

test('highlights SQL keywords, strings, numbers, identifiers, and comments', () => {
  const highlighted = highlightSql("SELECT `name`, 'Ada', 12 -- note")
  assert.match(highlighted, /sql-token-keyword">SELECT/)
  assert.match(highlighted, /sql-token-identifier">`name`/)
  assert.match(highlighted, /sql-token-string">&#39;Ada&#39;/)
  assert.match(highlighted, /sql-token-number">12/)
  assert.match(highlighted, /sql-token-comment">-- note/)
})
