# Read-only SQL Scripts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support safe multi-statement diagnostic scripts containing user-variable assignments and read-only SQL.

**Architecture:** Split SQL locally without enabling mysql2 `multipleStatements`, validate every statement, then execute sequentially on one connection inside `START TRANSACTION READ ONLY`. Only `SET @name := literal` or `SET @name := (SELECT ...)` is accepted; system/session variables, writes, prepared statements, and other statement roots remain blocked.

**Tech Stack:** Node.js, mysql2, Chromium extension JavaScript, node:test.

---

### Task 1: Parser and policy

**Files:**
- Modify: `native/policy.js`
- Modify: `test/policy.test.js`

1. Add failing tests for quoted semicolons, comments, statement-count limits, safe `SET @variable`, and blocked system/session variables.
2. Implement `splitSqlStatements` and `validateReadOnlyScript`.
3. Run `node --test test/policy.test.js`.

### Task 2: Sequential read-only execution

**Files:**
- Modify: `native/service.js`
- Modify: `test/store.test.js`

1. Add a service test using a fake MySQL client.
2. Execute validated statements sequentially in one read-only transaction.
3. Apply timeout and row limits to each visible read statement.
4. Roll back on success or failure and audit each statement.

### Task 3: Multiple result rendering

**Files:**
- Modify: `extension/app.js`
- Modify: `extension/styles.css`

1. Return all visible result sets while keeping the final result at the top level for export compatibility.
2. Render multiple result sets as separate sections.
3. Disable EXPLAIN for scripts and keep write confirmations unchanged.

### Task 4: Verification

1. Run `npm run check`.
2. Run `npm test`.
3. Run `git diff --check`.
4. Run `npm run package`.
