import test from 'node:test'
import assert from 'node:assert/strict'
import { buildCountSql, redactSql, splitSqlStatements, SqlPolicyError, validateExplainTarget, validateReadOnlyScript, validateSql } from '../native/policy.js'

test('allows bounded reads and confirmed write statement types', () => {
  assert.equal(validateSql('SELECT * FROM users LIMIT 100', { maxRows: 200 }).readOnly, true)
  assert.equal(validateSql("UPDATE users SET name='x' WHERE id=1 LIMIT 1").mutating, true)
  assert.equal(validateSql('ALTER TABLE users ADD COLUMN note VARCHAR(20)').ddl, true)
})

test('accepts comments after filtering and rejects multiple statements, locks, and excessive limits', () => {
  assert.equal(validateSql('-- heading\nSELECT 1 /* inline */').sql.trim(), 'SELECT 1')
  assert.equal(validateSql("SELECT '-- kept' AS note # removed").sql.trim(), "SELECT '-- kept' AS note")
  assert.throws(() => validateSql('-- comment only'))
  for (const sql of ['SELECT 1; /* hidden */ SELECT 2', 'SELECT * FROM users FOR UPDATE', 'SELECT * FROM users LIMIT 201']) {
    assert.throws(() => validateSql(sql, { maxRows: 200 }))
  }
})

test('EXPLAIN accepts SELECT only and audit preview redacts values', () => {
  assert.equal(validateExplainTarget('SELECT * FROM users LIMIT 10'), 'SELECT * FROM users LIMIT 10')
  assert.throws(() => validateExplainTarget('UPDATE users SET name=1'))
  assert.equal(redactSql("SELECT * FROM users WHERE id=12 AND name='Ada'"), 'SELECT * FROM users WHERE id=? AND name=?')
})

test('builds a total-count query without the outer LIMIT', () => {
  assert.equal(
    buildCountSql('SELECT * FROM users WHERE active=1 ORDER BY id DESC LIMIT 20', { maxRows: 200 }),
    'SELECT COUNT(*) AS totalCount FROM users WHERE active=1',
  )
  assert.equal(
    buildCountSql('SELECT * FROM (SELECT * FROM users LIMIT 5) recent LIMIT 20', { maxRows: 200 }),
    'SELECT COUNT(*) AS totalCount FROM (SELECT * FROM users LIMIT 5) recent',
  )
  assert.equal(
    buildCountSql('SELECT DISTINCT status FROM users ORDER BY status LIMIT 20', { maxRows: 200 }),
    'SELECT COUNT(*) AS totalCount FROM (SELECT DISTINCT status FROM users ORDER BY status) AS `__mysql_browser_count`',
  )
  assert.throws(() => buildCountSql('UPDATE users SET active=1'))
})

test('splits SQL scripts without treating quoted or commented semicolons as separators', () => {
  assert.deepEqual(
    splitSqlStatements("SET @note := 'a;b'; /* ignored ; */ SELECT @note;"),
    ["SET @note := 'a;b'", 'SELECT @note'],
  )
  assert.throws(() => splitSqlStatements('SELECT 1; SELECT 2; SELECT 3', { maxStatements: 2 }))
  assert.throws(() => splitSqlStatements("SELECT 'unterminated"))
})

test('allows user variables and read-only statements in diagnostic scripts', () => {
  const checked = validateReadOnlyScript(`
    SET @phone_a := '13800000000';
    SET @user_id_a := (SELECT MIN(id) FROM user WHERE user_phone=@phone_a);
    SELECT @phone_a, @user_id_a;
    SHOW TABLES;
  `, { maxRows: 100 })
  assert.deepEqual(checked.statements.map((statement) => statement.kind), ['set-variable', 'set-variable', 'select', 'show'])
  assert.equal(checked.resultCount, 2)
})

test('blocks system settings, writes, dynamic SQL, and variable assignment inside reads', () => {
  for (const sql of [
    'SET SESSION sql_select_limit = 0; SELECT 1',
    'SET @@session.max_execution_time = 0; SELECT 1',
    'SET @sql := (DELETE FROM user); SELECT 1',
    'SET @x := 1; UPDATE user SET role=1',
    'SET @x := 1; PREPARE stmt FROM @x',
    'SELECT @x := 1',
  ]) {
    assert.throws(() => validateReadOnlyScript(sql), SqlPolicyError)
  }
})
