# Changelog

## [0.2.7] - 2026-09-04

### Added

- Added persistent workspace backup in `~/.mysql-browser-client/workspace.json`.
- Added safe read-only SQL scripts with `SET @user_variable`, `SELECT`, `SHOW`, and `DESCRIBE`.
- Added saved queries, SQL formatting and highlighting, richer completions, and result metadata.
- Added result-row and complete-result table copying with plain-text and HTML clipboard formats.
- Added result-column shortcuts for filters and ordering.

### Changed

- Table clicks now select and query immediately.
- Table metadata loading is no longer truncated by the business-query row limit.
- The result toolbar now provides CSV export and table copying instead of text-file export.

### Security

- Read-only scripts execute statements sequentially without enabling MySQL multiple statements.
- Script execution blocks system/session variables, dynamic SQL, writes, locks, and dangerous functions.
- Every script statement runs inside a read-only transaction with row and timeout limits and separate audit entries.
