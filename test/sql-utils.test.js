import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRowSql, rowSqlContext, sqlCompletions } from '../extension/sql-utils.js'

test('completes table names and alias-qualified fields', () => {
  const tables = [{ name: 'vehicle_base', type: 'BASE TABLE', comment: '车辆基础' }]
  const schema = { vehicle_base: { columns: [{ name: 'vehicle_id', type: 'varchar(64)' }, { name: 'status', type: 'tinyint' }] } }
  assert.equal(sqlCompletions('SELECT * FROM veh', 17, tables, schema)[0].label, 'vehicle_base')
  const aliased = 'SELECT * FROM vehicle_base vb WHERE vb.veh'
  assert.equal(sqlCompletions(aliased, aliased.length, tables, schema)[0].label, 'vehicle_id')
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
