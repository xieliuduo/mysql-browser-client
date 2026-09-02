import test from 'node:test'
import assert from 'node:assert/strict'
import { compactTableSummary, inferTableSummary, tableSummary } from '../native/table-summary.js'

test('normalizes table comments into an eight-character summary', () => {
  assert.equal(compactTableSummary('  车辆基础\n信息表  '), '车辆基础 信息表')
  assert.equal(compactTableSummary('车辆实时定位与状态信息记录表'), '车辆实时定位与…')
  assert.equal(Array.from(compactTableSummary('车辆实时定位与状态信息记录表')).length, 8)
})

test('returns an empty summary when a table has no comment', () => {
  assert.equal(compactTableSummary(''), '')
  assert.equal(compactTableSummary(null), '')
})

test('infers vehicle-network summaries from table names when comments are empty', () => {
  assert.equal(tableSummary('vehicle_base', ''), '车辆基础')
  assert.equal(tableSummary('vehicle_mission_sub', ''), '车辆子任务')
  assert.equal(tableSummary('vehicle_parking_space', ''), '车辆停车位')
  assert.equal(tableSummary('vehicle_battery_health', ''), '车辆电池健康')
  assert.equal(tableSummary('user_login_log', ''), '用户登录日志')
  assert.equal(inferTableSummary('unknown_archive_blob'), '业务数据')
})

test('prefers database comments over inferred table-name summaries', () => {
  assert.equal(tableSummary('vehicle_base', '车辆主数据'), '车辆主数据')
  assert.equal(tableSummary('vehicle_base', '车辆基础信息与运行数据'), '车辆基础信息与…')
})
