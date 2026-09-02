# MySQL Browser Client Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use the coding workflow to implement this plan task-by-task.

**Goal:** Build a Chrome/Edge Manifest V3 extension that provides a local MySQL workbench without AI features.

**Architecture:** A Chromium extension renders the workbench in a side panel or full extension tab. The extension background service worker communicates with a long-running local Node.js native-messaging host, which owns MySQL connections, credentials, SQL validation, and audit records.

**Tech Stack:** Manifest V3, native ES modules, Chrome Extension APIs, Native Messaging, Node.js 20+, `mysql2`, Node test runner.

---

### Task 1: Project skeleton and deterministic extension identity

**Files:**
- Create: `package.json`
- Create: `extension/manifest.json`
- Create: `extension/background.js`
- Create: `shared/protocol.js`
- Create: `.gitignore`

**Steps:**
1. Add npm scripts for checking, testing, native-host installation, and extension packaging.
2. Add a Manifest V3 extension with side-panel, storage, and native-messaging permissions.
3. Give the unpacked extension a stable public key so its extension ID remains deterministic.
4. Implement background request forwarding and full-workbench tab opening.
5. Run syntax checks.

### Task 2: Native messaging transport

**Files:**
- Create: `native/host.js`
- Create: `native/message-stream.js`
- Create: `test/message-stream.test.js`

**Steps:**
1. Write tests for Chrome native-message framing.
2. Implement length-prefixed JSON parsing and encoding.
3. Implement a persistent stdin/stdout request loop.
4. Verify malformed input is rejected without writing logs to stdout.

### Task 3: Connection and credential storage

**Files:**
- Create: `native/store.js`
- Create: `native/credential-store.js`
- Create: `test/store.test.js`

**Steps:**
1. Port bounded connection validation from the DSH plugin.
2. Persist non-secret connection metadata with mode `0600`.
3. Store passwords in macOS Keychain when available and use a mode-`0600` fallback elsewhere.
4. Test create, update, delete, and secret redaction.

### Task 4: MySQL service and SQL policy

**Files:**
- Create: `native/policy.js`
- Create: `native/table-summary.js`
- Create: `native/service.js`
- Create: `test/policy.test.js`
- Create: `test/table-summary.test.js`

**Steps:**
1. Port SQL validation, single-statement enforcement, row bounds, and audit redaction.
2. Implement connection testing, database listing, table listing, table detail, query, EXPLAIN, and audit endpoints.
3. Preserve production confirmation and write confirmation.
4. Run service-independent policy and summary tests.

### Task 5: Workbench UI

**Files:**
- Create: `extension/workbench.html`
- Create: `extension/styles.css`
- Create: `extension/app.js`

**Steps:**
1. Build the connection/database/table navigation.
2. Build table structure tabs for columns, indexes, and foreign keys.
3. Build persistent SQL tabs, execution, EXPLAIN, results, audit, and CSV/text export.
4. Add table context actions for pin, sink, name color, and reset.
5. Add responsive side-panel behavior and a button to open the full workbench.
6. Add connection modal with test/save/delete flows.

### Task 6: Native-host installer and documentation

**Files:**
- Create: `scripts/install-native-host.js`
- Create: `scripts/package-extension.js`
- Modify: `README.md`

**Steps:**
1. Generate executable native-host wrappers and browser host manifests.
2. Support Chrome and Edge paths on macOS, Linux, and Windows where practical.
3. Package the extension directory into `dist/mysql-browser-client.zip`.
4. Document local installation, permissions, security model, and troubleshooting.

### Task 7: Verification

**Steps:**
1. Run `npm test`.
2. Run `npm run check`.
3. Run `npm run package`.
4. Load the extension in headless Chrome for a smoke test.
5. Inspect the final Git diff and report remaining environment-dependent installation steps.
