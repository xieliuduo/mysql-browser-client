import test from 'node:test'
import assert from 'node:assert/strict'
import { redactSql, validateExplainTarget, validateSql } from '../native/policy.js'

test('allows bounded reads and confirmed write statement types', () => {
  assert.equal(validateSql('SELECT * FROM users LIMIT 100', { maxRows: 200 }).readOnly, true)
  assert.equal(validateSql("UPDATE users SET name='x' WHERE id=1 LIMIT 1").mutating, true)
  assert.equal(validateSql('ALTER TABLE users ADD COLUMN note VARCHAR(20)').ddl, true)
})

test('rejects multiple statements, comments, locks, and excessive limits', () => {
  for (const sql of ['SELECT 1; SELECT 2', 'SELECT 1 -- comment', 'SELECT * FROM users FOR UPDATE', 'SELECT * FROM users LIMIT 201']) {
    assert.throws(() => validateSql(sql, { maxRows: 200 }))
  }
})

test('EXPLAIN accepts SELECT only and audit preview redacts values', () => {
  assert.equal(validateExplainTarget('SELECT * FROM users LIMIT 10'), 'SELECT * FROM users LIMIT 10')
  assert.throws(() => validateExplainTarget('UPDATE users SET name=1'))
  assert.equal(redactSql("SELECT * FROM users WHERE id=12 AND name='Ada'"), 'SELECT * FROM users WHERE id=? AND name=?')
})

