import { METHODS, requestMessage } from './protocol.js'
import { applyColumnOperation, buildRowSql, classifyColumnType, formatSql, fuzzyTextScore, highlightSql, quoteSqlIdentifier, rowSqlContext, rowTableClipboard, sqlCompletions, stripSqlComments, tableClipboard } from './sql-utils.js'

const STORAGE_KEY = 'mysql-browser-client-workspace-v1'
const IS_PREVIEW = location.protocol !== 'chrome-extension:'
const TABLE_COLORS = ['#f87171', '#fb923c', '#facc15', '#4ade80', '#2dd4bf', '#60a5fa', '#a78bfa', '#f472b6']
const MUTATING_ROOTS = new Set(['insert', 'update', 'delete', 'replace', 'create', 'alter', 'drop', 'truncate', 'rename'])
const DEFAULT_LAYOUT = Object.freeze({
  sourceOpen: true,
  objectsOpen: true,
  inspectorOpen: true,
  sourceWidth: 238,
  objectWidth: 278,
  inspectorHeight: 230,
  editorHeight: 230,
})
const THEMES = new Set(['emerald', 'ocean', 'amber', 'light'])

const state = {
  nativeReady: false,
  busy: false,
  connections: [],
  connectionId: '',
  databases: [],
  database: '',
  tables: [],
  search: '',
  selectedTable: '',
  detail: null,
  detailLoading: false,
  inspectorTab: 'columns',
  queryTabs: [],
  activeQueryId: '',
  resultTab: 'result',
  audit: [],
  status: null,
  schemaCache: {},
  completions: [],
  completionIndex: 0,
  completionOpen: false,
  productionAllowed: new Set(),
  contextTable: '',
  contextRow: null,
  contextColumn: null,
  resizing: '',
}

let persisted = {
  lastConnectionId: '',
  lastDatabaseByConnection: {},
  contexts: {},
  tablePreferences: {},
  savedQueries: [],
  layout: { ...DEFAULT_LAYOUT },
  theme: 'emerald',
}

let toastTimer = null
let querySequence = 0
let tableDetailSequence = 0
let browserPersistedSnapshot = null
let nativePersistTimer = null
let nativeWorkspaceAvailable = false
const preview = {
  connections: [{
    id: 'preview-local',
    label: 'Vehicle Platform',
    environment: 'test',
    host: '127.0.0.1',
    port: 3306,
    user: 'developer',
    defaultDatabase: 'vehicle_network',
    maxRows: 200,
    queryTimeoutMs: 10000,
    ssl: { mode: 'disabled' },
    credentialConfigured: true,
  }],
  audit: [],
  tables: [
    { name: 'vehicle_base', type: 'BASE TABLE', comment: '车辆基础信息', summary: '车辆基础', rowEstimate: 12842 },
    { name: 'vehicle_mission', type: 'BASE TABLE', comment: '车辆任务主表', summary: '车辆任务', rowEstimate: 98214 },
    { name: 'vehicle_mission_sub', type: 'BASE TABLE', comment: '车辆子任务', summary: '车辆子任务', rowEstimate: 221440 },
    { name: 'vehicle_parking_space', type: 'BASE TABLE', comment: '车辆停车位', summary: '车辆停车位', rowEstimate: 421 },
    { name: 'vehicle_status_view', type: 'VIEW', comment: '车辆状态视图', summary: '车辆状态', rowEstimate: 0 },
    { name: 'user_login_log', type: 'BASE TABLE', comment: '用户登录日志', summary: '用户登录日志', rowEstimate: 361200 },
  ],
}

const $ = (selector) => document.querySelector(selector)
const refs = {
  headerConnection: $('#header-connection'),
  headerDatabase: $('#header-database'),
  themeSelect: $('#theme-select'),
  environmentBadge: $('#environment-badge'),
  connectionSettings: $('#connection-settings'),
  mainGrid: $('#main-grid'),
  sourcePanel: $('#source-panel'),
  objectPanel: $('#object-panel'),
  workspace: $('#workspace'),
  inspector: $('#inspector'),
  editorShell: $('#editor-shell'),
  addConnection: $('#add-connection'),
  collapseSource: $('#collapse-source'),
  expandSource: $('#expand-source'),
  sourceResizer: $('#source-resizer'),
  connectionList: $('#connection-list'),
  collapseObjects: $('#collapse-objects'),
  expandObjects: $('#expand-objects'),
  objectResizer: $('#object-resizer'),
  databaseTitle: $('#database-title'),
  tableCount: $('#table-count'),
  tableSearch: $('#table-search'),
  tableList: $('#table-list'),
  inspectorTabs: $('#inspector-tabs'),
  collapseInspector: $('#collapse-inspector'),
  expandInspector: $('#expand-inspector'),
  inspectorResizer: $('#inspector-resizer'),
  tableMeta: $('#table-meta'),
  inspectorBody: $('#inspector-body'),
  queryTarget: $('#query-target'),
  queryLimit: $('#query-limit'),
  openSavedQueries: $('#open-saved-queries'),
  savedQueryCount: $('#saved-query-count'),
  queryTabs: $('#query-tabs'),
  addQueryTab: $('#add-query-tab'),
  sqlHighlight: $('#sql-highlight'),
  sqlEditor: $('#sql-editor'),
  sqlCompletion: $('#sql-completion'),
  editorLines: $('#editor-lines'),
  editorResizer: $('#editor-resizer'),
  runQuery: $('#run-query'),
  formatSql: $('#format-sql'),
  runExplain: $('#run-explain'),
  resultTabs: $('#result-tabs'),
  saveQuery: $('#save-query'),
  resultQueryMeta: $('#result-query-meta'),
  resultCount: $('#result-count'),
  exportCsv: $('#export-csv'),
  copyTable: $('#copy-table'),
  resultBody: $('#result-body'),
  statusDot: $('#status-dot'),
  statusText: $('#status-text'),
  statusDetail: $('#status-detail'),
  contextMenuRoot: $('#context-menu-root'),
  modalRoot: $('#modal-root'),
  savedQueryDrawerRoot: $('#saved-query-drawer-root'),
  toastRoot: $('#toast-root'),
}

function element(tag, options = {}, children = []) {
  const node = document.createElement(tag)
  if (options.className) node.className = options.className
  if (options.text !== undefined) node.textContent = options.text
  if (options.title) node.title = options.title
  if (options.type) node.type = options.type
  if (options.dataset) Object.assign(node.dataset, options.dataset)
  if (options.style) Object.assign(node.style, options.style)
  if (options.attributes) for (const [key, value] of Object.entries(options.attributes)) node.setAttribute(key, value)
  const list = Array.isArray(children) ? children : [children]
  for (const child of list) {
    if (child === null || child === undefined) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

function emptyState(title, detail) {
  return element('div', { className: 'empty-state' }, element('div', {}, [
    element('strong', { text: title }),
    element('span', { text: detail }),
  ]))
}

function activeConnection() {
  return state.connections.find((connection) => connection.id === state.connectionId) || null
}

function target() {
  const connection = activeConnection()
  if (!connection || !state.database) return null
  return {
    connectionId: connection.id,
    database: state.database,
    productionConfirmed: connection.environment !== 'production' || state.productionAllowed.has(connection.id),
  }
}

function scopeKey() {
  return state.connectionId && state.database ? JSON.stringify([state.connectionId, state.database]) : ''
}

function savedQueriesForScope() {
  return persisted.savedQueries
    .filter((query) => query.connectionId === state.connectionId && query.database === state.database)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
}

function tablePreferences() {
  return persisted.tablePreferences[scopeKey()] || {}
}

function createQueryTab(options = {}) {
  querySequence += 1
  return {
    id: options.id || `query-${Date.now().toString(36)}-${querySequence}`,
    title: options.title || `查询 ${querySequence}`,
    tableName: options.tableName || '',
    sql: typeof options.sql === 'string' ? options.sql : 'SELECT * FROM ',
    results: { result: null, explain: null },
  }
}

function activeQueryTab() {
  return state.queryTabs.find((tab) => tab.id === state.activeQueryId) || state.queryTabs[0] || null
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizePersisted(value) {
  const saved = isRecord(value) ? value : {}
  return {
    ...saved,
    lastConnectionId: typeof saved.lastConnectionId === 'string' ? saved.lastConnectionId : '',
    lastDatabaseByConnection: isRecord(saved.lastDatabaseByConnection) ? saved.lastDatabaseByConnection : {},
    contexts: isRecord(saved.contexts) ? saved.contexts : {},
    tablePreferences: isRecord(saved.tablePreferences) ? saved.tablePreferences : {},
    savedQueries: Array.isArray(saved.savedQueries) ? saved.savedQueries : [],
    layout: { ...DEFAULT_LAYOUT, ...(isRecord(saved.layout) ? saved.layout : {}) },
    theme: THEMES.has(saved.theme) ? saved.theme : 'emerald',
  }
}

function mergeTablePreferences(base, override) {
  const merged = { ...(isRecord(base) ? base : {}) }
  for (const [scope, preferences] of Object.entries(isRecord(override) ? override : {})) {
    merged[scope] = {
      ...(isRecord(merged[scope]) ? merged[scope] : {}),
      ...(isRecord(preferences) ? preferences : {}),
    }
  }
  return merged
}

function mergePersisted(base, override) {
  const nativeValue = normalizePersisted(base)
  const browserValue = isRecord(override) ? override : {}
  return normalizePersisted({
    ...nativeValue,
    ...browserValue,
    lastDatabaseByConnection: {
      ...nativeValue.lastDatabaseByConnection,
      ...(isRecord(browserValue.lastDatabaseByConnection) ? browserValue.lastDatabaseByConnection : {}),
    },
    contexts: {
      ...nativeValue.contexts,
      ...(isRecord(browserValue.contexts) ? browserValue.contexts : {}),
    },
    tablePreferences: mergeTablePreferences(nativeValue.tablePreferences, browserValue.tablePreferences),
    layout: {
      ...nativeValue.layout,
      ...(isRecord(browserValue.layout) ? browserValue.layout : {}),
    },
  })
}

async function loadPersisted() {
  let saved = null
  if (IS_PREVIEW) {
    try {
      saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    } catch {}
    persisted = normalizePersisted(saved)
    return
  }
  try {
    const value = await chrome.storage.local.get(STORAGE_KEY)
    saved = value[STORAGE_KEY]
  } catch {}
  browserPersistedSnapshot = isRecord(saved) ? saved : null
  persisted = normalizePersisted(saved)
}

async function cachePersistedInBrowser() {
  if (IS_PREVIEW) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted)) } catch {}
    return
  }
  try { await chrome.storage.local.set({ [STORAGE_KEY]: persisted }) } catch {}
}

async function loadNativePersisted() {
  if (IS_PREVIEW || !state.nativeReady) return
  try {
    const value = await rpc(METHODS.WORKSPACE_GET)
    if (isRecord(value?.workspace)) {
      persisted = browserPersistedSnapshot
        ? mergePersisted(value.workspace, browserPersistedSnapshot)
        : normalizePersisted(value.workspace)
    }
    await cachePersistedInBrowser()
    await rpc(METHODS.WORKSPACE_SET, { workspace: persisted })
    nativeWorkspaceAvailable = true
  } catch {
    nativeWorkspaceAvailable = false
  }
}

function scheduleNativePersist() {
  if (!state.nativeReady || !nativeWorkspaceAvailable) return
  window.clearTimeout(nativePersistTimer)
  nativePersistTimer = window.setTimeout(() => {
    rpc(METHODS.WORKSPACE_SET, { workspace: persisted }).catch(() => {})
  }, 250)
}

async function savePersisted() {
  await cachePersistedInBrowser()
  scheduleNativePersist()
}

function persistContext() {
  const key = scopeKey()
  if (!key) return
  persisted.contexts[key] = {
    activeQueryId: state.activeQueryId,
    resultTab: state.resultTab,
    tabs: state.queryTabs.slice(0, 20).map(({ id, title, tableName, sql }) => ({ id, title, tableName, sql })),
  }
  savePersisted()
}

function restoreContext() {
  const saved = persisted.contexts[scopeKey()]
  const tabs = Array.isArray(saved?.tabs)
    ? saved.tabs.slice(0, 20).map((tab, index) => createQueryTab({
      id: typeof tab.id === 'string' ? tab.id : undefined,
      title: typeof tab.title === 'string' ? tab.title : `查询 ${index + 1}`,
      tableName: typeof tab.tableName === 'string' ? tab.tableName : '',
      sql: typeof tab.sql === 'string' ? tab.sql : 'SELECT * FROM ',
    }))
    : []
  state.queryTabs = tabs.length ? tabs : [createQueryTab({ title: '查询 1' })]
  state.activeQueryId = state.queryTabs.some((tab) => tab.id === saved?.activeQueryId) ? saved.activeQueryId : state.queryTabs[0].id
  state.resultTab = ['result', 'explain', 'audit'].includes(saved?.resultTab) ? saved.resultTab : 'result'
}

async function rpc(method, params = {}) {
  if (IS_PREVIEW) return previewRpc(method, params)
  const response = await chrome.runtime.sendMessage({ type: 'native-request', request: requestMessage(method, params) })
  if (!response?.ok) throw new Error(response?.error?.message || '无法连接本地 MySQL 服务')
  return response.value
}

async function previewRpc(method, params = {}) {
  const delay = method === METHODS.PING ? 80
    : method === METHODS.TABLE_DETAIL ? params.table === 'vehicle_base' ? 320 : 60
      : 130
  await new Promise((resolve) => setTimeout(resolve, delay))
  if (method === METHODS.PING) return { status: 'ready', version: 'preview', platform: 'browser' }
  if (method === METHODS.CONNECTIONS) return { connections: preview.connections }
  if (method === METHODS.DATABASES) return { databases: [{ name: 'vehicle_network', charset: 'utf8mb4' }, { name: 'analytics', charset: 'utf8mb4' }] }
  if (method === METHODS.STATUS) return { status: 'connected', latencyMs: 18, server: { version: '8.0.36', currentUser: 'developer@localhost' } }
  if (method === METHODS.TABLES) return { tables: preview.tables.filter((table) => !params.search || table.name.includes(params.search)) }
  if (method === METHODS.TABLE_DETAIL) {
    const table = preview.tables.find((item) => item.name === params.table) || preview.tables[0]
    return {
      table,
      columns: [
        { name: 'id', type: 'bigint unsigned', nullable: false, key: 'PRI', defaultValue: null, extra: 'auto_increment', comment: '主键' },
        { name: `${table.name}_marker`, type: 'varchar(32)', nullable: true, key: '', defaultValue: null, extra: '', comment: '预览表标记' },
        { name: 'vehicle_id', type: 'varchar(64)', nullable: false, key: 'UNI', defaultValue: null, extra: '', comment: '车辆 ID' },
        { name: 'status', type: 'tinyint', nullable: false, key: 'MUL', defaultValue: '0', extra: '', comment: '车辆状态' },
        { name: 'updated_at', type: 'datetime', nullable: false, key: '', defaultValue: 'CURRENT_TIMESTAMP', extra: '', comment: '更新时间' },
      ],
      indexes: [
        { name: 'PRIMARY', unique: true, type: 'BTREE', columns: ['id'] },
        { name: 'uk_vehicle_id', unique: true, type: 'BTREE', columns: ['vehicle_id'] },
        { name: 'idx_status', unique: false, type: 'BTREE', columns: ['status'] },
      ],
      foreignKeys: [],
    }
  }
  if (method === METHODS.QUERY || method === METHODS.EXPLAIN) {
    const started = Date.now()
    const explain = method === METHODS.EXPLAIN
    const mutating = MUTATING_ROOTS.has(sqlRoot(params.sql))
    const value = mutating
      ? { columns: [], rows: [], statementKind: sqlRoot(params.sql), affectedRows: 1, rowCount: 1, durationMs: 23 }
      : explain
        ? {
          columns: [{ name: 'id' }, { name: 'select_type' }, { name: 'table' }, { name: 'type' }, { name: 'key' }, { name: 'rows' }],
          rows: [[1, 'SIMPLE', 'vehicle_base', 'ref', 'idx_status', 128]],
          durationMs: 12,
        }
        : {
          columns: [{ name: 'id' }, { name: 'vehicle_id' }, { name: 'status' }, { name: 'updated_at' }],
          rows: [
            [1001, 'VH-2026-001', 1, '2026-09-02 11:42:12'],
            [1002, 'VH-2026-002', 2, '2026-09-02 11:40:03'],
            [1003, 'VH-2026-003', 1, '2026-09-02 11:38:55'],
          ],
          totalCount: 12842,
          durationMs: 18,
        }
    preview.audit.unshift({
      id: crypto.randomUUID(),
      time: new Date().toISOString(),
      operation: explain ? 'explain' : 'query',
      status: 'ok',
      durationMs: Date.now() - started + value.durationMs,
      rowCount: value.rows?.length || value.affectedRows || 0,
      sqlPreview: String(params.sql || '').replace(/\b\d+\b/g, '?').slice(0, 120),
    })
    return value
  }
  if (method === METHODS.AUDIT) return { entries: preview.audit }
  if (method === METHODS.CONNECTION_TEST) return { connected: true, latencyMs: 16, server: { version: '8.0.36' } }
  if (method === METHODS.CONNECTION_CREATE) {
    const connection = { ...params.connection, id: `preview-${Date.now()}`, credentialConfigured: true }
    preview.connections.push(connection)
    return connection
  }
  if (method === METHODS.CONNECTION_UPDATE) {
    const index = preview.connections.findIndex((item) => item.id === params.connectionId)
    preview.connections[index] = { ...preview.connections[index], ...params.connection }
    return preview.connections[index]
  }
  if (method === METHODS.CONNECTION_DELETE) {
    preview.connections = preview.connections.filter((item) => item.id !== params.connectionId)
    return { connectionId: params.connectionId, credentialDeleted: true }
  }
  throw new Error(`Preview method is not implemented: ${method}`)
}

function notify(message, error = false) {
  clearTimeout(toastTimer)
  refs.toastRoot.replaceChildren(element('div', { className: `toast ${error ? 'error' : ''}`, text: message }))
  toastTimer = window.setTimeout(() => refs.toastRoot.replaceChildren(), 3600)
}

function setBusy(value) {
  state.busy = value
  refs.runQuery.disabled = value || !target()
  refs.runExplain.disabled = value || !target()
  refs.saveQuery.disabled = value
  refs.addConnection.disabled = value
}

function environmentLabel(value) {
  return ({ local: 'LOCAL', development: 'DEV', test: 'TEST', staging: 'STAGING', production: 'PRODUCTION' })[value] || value || 'OFFLINE'
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function renderLayout() {
  const layout = persisted.layout || DEFAULT_LAYOUT
  refs.sourcePanel.classList.toggle('collapsed', !layout.sourceOpen)
  refs.objectPanel.classList.toggle('collapsed', !layout.objectsOpen)
  refs.inspector.classList.toggle('collapsed', !layout.inspectorOpen)
  refs.mainGrid.style.setProperty('--source-width', layout.sourceOpen ? `${clamp(Number(layout.sourceWidth) || DEFAULT_LAYOUT.sourceWidth, 160, 420)}px` : '42px')
  refs.mainGrid.style.setProperty('--object-width', layout.objectsOpen ? `${clamp(Number(layout.objectWidth) || DEFAULT_LAYOUT.objectWidth, 180, 520)}px` : '42px')
  refs.workspace.style.setProperty('--inspector-height', layout.inspectorOpen ? `${clamp(Number(layout.inspectorHeight) || DEFAULT_LAYOUT.inspectorHeight, 120, 520)}px` : '42px')
  refs.editorShell.style.setProperty('--editor-height', `${clamp(Number(layout.editorHeight) || DEFAULT_LAYOUT.editorHeight, 150, 620)}px`)
}

function renderTheme() {
  const theme = THEMES.has(persisted.theme) ? persisted.theme : 'emerald'
  document.documentElement.dataset.theme = theme
  refs.themeSelect.value = theme
}

function setTheme(theme) {
  persisted.theme = THEMES.has(theme) ? theme : 'emerald'
  renderTheme()
  savePersisted()
}

function setPanelOpen(panel, open) {
  persisted.layout[`${panel}Open`] = open
  renderLayout()
  savePersisted()
}

function beginResize(kind, event) {
  if (event.button !== 0) return
  const layout = persisted.layout
  if ((kind === 'source' && !layout.sourceOpen) || (kind === 'objects' && !layout.objectsOpen) || (kind === 'inspector' && !layout.inspectorOpen)) return
  event.preventDefault()
  closeContextMenu()
  closeSqlCompletion()
  const row = kind === 'inspector' || kind === 'editor'
  state.resizing = row ? 'row' : 'column'
  refs.mainGrid.classList.add('resizing', row ? 'resizing-row' : 'resizing-column')
  const startX = event.clientX
  const startY = event.clientY
  const startValue = kind === 'source' ? layout.sourceWidth
    : kind === 'objects' ? layout.objectWidth
      : kind === 'inspector' ? layout.inspectorHeight
        : layout.editorHeight
  const move = (moveEvent) => {
    if (kind === 'source') layout.sourceWidth = clamp(startValue + moveEvent.clientX - startX, 160, 420)
    else if (kind === 'objects') layout.objectWidth = clamp(startValue + moveEvent.clientX - startX, 180, 520)
    else if (kind === 'inspector') layout.inspectorHeight = clamp(startValue + moveEvent.clientY - startY, 120, Math.min(520, window.innerHeight - 310))
    else layout.editorHeight = clamp(startValue + moveEvent.clientY - startY, 150, Math.min(620, window.innerHeight - 250))
    renderLayout()
  }
  const stop = () => {
    state.resizing = ''
    refs.mainGrid.classList.remove('resizing', 'resizing-row', 'resizing-column')
    document.removeEventListener('pointermove', move)
    document.removeEventListener('pointerup', stop)
    document.removeEventListener('pointercancel', stop)
    savePersisted()
  }
  document.addEventListener('pointermove', move)
  document.addEventListener('pointerup', stop)
  document.addEventListener('pointercancel', stop)
}

function renderHeader() {
  const connection = activeConnection()
  refs.headerConnection.replaceChildren()
  if (!state.connections.length) refs.headerConnection.append(element('option', { text: '无连接', attributes: { value: '' } }))
  for (const item of state.connections) {
    const option = element('option', { text: item.label, attributes: { value: item.id } })
    option.selected = item.id === state.connectionId
    refs.headerConnection.append(option)
  }
  refs.headerDatabase.replaceChildren()
  if (!state.databases.length) refs.headerDatabase.append(element('option', { text: '无数据库', attributes: { value: '' } }))
  for (const database of state.databases) {
    const option = element('option', { text: database.name, attributes: { value: database.name } })
    option.selected = database.name === state.database
    refs.headerDatabase.append(option)
  }
  refs.headerConnection.disabled = !state.connections.length
  refs.headerDatabase.disabled = !state.databases.length
  refs.connectionSettings.disabled = !connection
  refs.environmentBadge.textContent = environmentLabel(connection?.environment)
  refs.environmentBadge.className = `environment-badge ${connection?.environment || ''}`
}

function renderConnections() {
  refs.connectionList.replaceChildren()
  if (!state.connections.length) {
    refs.connectionList.append(emptyState('没有数据源', '点击右上角 ＋ 添加 MySQL 连接'))
    return
  }
  for (const connection of state.connections) {
    const card = element('div', { className: `connection-card ${connection.id === state.connectionId ? 'active' : ''} ${connection.environment === 'production' ? 'production' : ''}` })
    const main = element('button', { className: 'connection-main', type: 'button' }, [
      element('div', { className: 'connection-name' }, [
        element('span', { text: connection.label }),
        element('span', { className: 'mini-env', text: environmentLabel(connection.environment) }),
      ]),
      element('div', { className: 'connection-host', text: `${connection.user}@${connection.host}:${connection.port}` }),
    ])
    main.addEventListener('click', () => chooseConnection(connection.id))
    const edit = element('button', { className: 'connection-edit', text: '•••', type: 'button', title: `编辑 ${connection.label}` })
    edit.addEventListener('click', () => openConnectionModal(connection))
    card.append(main, edit)
    refs.connectionList.append(card)
  }
}

function sortedFilteredTables() {
  const term = state.search.trim().toLowerCase()
  const preferences = tablePreferences()
  const rank = (table) => preferences[table.name]?.position === 'top' ? 0 : preferences[table.name]?.position === 'bottom' ? 2 : 1
  return state.tables
    .filter((table) => !term || `${table.name} ${table.summary || ''} ${table.comment || ''}`.toLowerCase().includes(term))
    .map((table, index) => ({ table, index }))
    .sort((left, right) => rank(left.table) - rank(right.table) || left.index - right.index)
    .map(({ table }) => table)
}

function renderTables() {
  const tables = sortedFilteredTables()
  refs.databaseTitle.textContent = state.database || '库表'
  refs.tableCount.textContent = String(tables.length)
  refs.tableList.replaceChildren()
  if (!state.database) {
    refs.tableList.append(emptyState('尚未选择数据库', '先选择一个连接和数据库'))
    return
  }
  if (!tables.length) {
    refs.tableList.append(emptyState('没有匹配对象', state.search ? '尝试其他关键词' : '当前数据库没有表或视图'))
    return
  }
  const preferences = tablePreferences()
  for (const table of tables) {
    const preference = preferences[table.name] || {}
    const row = element('button', {
      className: `table-row ${state.selectedTable === table.name ? 'active' : ''} ${state.contextTable === table.name ? 'context-open' : ''}`,
      type: 'button',
      title: `${table.name}\n${table.comment || table.summary || ''}\n单击选择并运行 SELECT 查询`,
      dataset: { tableName: table.name },
    })
    if (preference.position) row.append(element('span', { className: 'table-position', text: preference.position === 'top' ? '↑' : '↓' }))
    row.append(
      element('span', { className: 'table-icon', text: table.type === 'VIEW' ? '◇' : '▦' }),
      element('span', { className: 'table-name', text: table.name, style: preference.color ? { color: preference.color } : {} }),
      element('span', { className: 'table-summary', text: table.summary || table.comment || '数据表' }),
    )
    row.addEventListener('click', () => {
      chooseTable(table)
      fillTableQuery(table)
      executeQuery(METHODS.QUERY)
    })
    row.addEventListener('contextmenu', (event) => openTableMenu(event, table))
    refs.tableList.append(row)
  }
}

function renderInspector() {
  for (const button of refs.inspectorTabs.querySelectorAll('[data-inspector-tab]')) {
    button.classList.toggle('active', button.dataset.inspectorTab === state.inspectorTab)
  }
  refs.inspectorBody.replaceChildren()
  if (!state.detail) {
    refs.tableMeta.textContent = state.detailLoading && state.selectedTable ? `${state.selectedTable} · 正在读取结构…` : '请选择一张表'
    refs.inspectorBody.append(state.detailLoading
      ? emptyState('正在加载表结构', state.selectedTable)
      : emptyState('选择一张表', '字段、索引和外键会显示在这里'))
    return
  }
  refs.tableMeta.textContent = `${state.detail.table.name} · 约 ${state.detail.table.rowEstimate || 0} 行 · ${state.detail.table.comment || '无表注释'}`
  const rows = state.detail[state.inspectorTab] || []
  const columns = state.inspectorTab === 'columns'
    ? ['name', 'type', 'nullable', 'key', 'defaultValue', 'extra', 'comment']
    : state.inspectorTab === 'indexes'
      ? ['name', 'unique', 'type', 'columns']
      : ['name', 'columnName', 'referencedSchema', 'referencedTable', 'referencedColumn']
  refs.inspectorBody.append(renderDataTable(columns.map((name) => ({ name })), rows.map((row) => columns.map((column) => row[column]))))
}

function renderQueryTabs() {
  refs.queryTabs.replaceChildren()
  for (const tab of state.queryTabs) {
    const node = element('div', { className: `query-tab ${tab.id === state.activeQueryId ? 'active' : ''}`, attributes: { role: 'tab', tabindex: '0' } })
    const label = element('span', { className: 'query-tab-label', text: tab.title })
    const close = element('button', { className: 'query-tab-close', text: '×', type: 'button', title: `关闭 ${tab.title}` })
    node.addEventListener('click', () => activateQueryTab(tab.id))
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') activateQueryTab(tab.id)
    })
    close.addEventListener('click', (event) => {
      event.stopPropagation()
      closeQueryTab(tab.id)
    })
    node.append(label, close)
    refs.queryTabs.append(node)
  }
  const tab = activeQueryTab()
  refs.sqlEditor.value = tab?.sql || ''
  updateEditorPresentation()
  refs.queryTarget.textContent = target() ? `${activeConnection().label} / ${state.database}` : '未选择数据库'
  refs.queryLimit.textContent = activeConnection() ? `${activeConnection().environment === 'production' ? Math.min(100, activeConnection().maxRows) : activeConnection().maxRows} rows max` : '—'
  refs.savedQueryCount.textContent = String(savedQueriesForScope().length)
  refs.openSavedQueries.disabled = !target()
  closeSqlCompletion()
  if (tab) prefetchSqlSchemas(tab.sql)
}

function updateEditorPresentation() {
  const sql = refs.sqlEditor.value
  refs.editorLines.textContent = String(sql.split('\n').length)
  refs.sqlHighlight.innerHTML = `${highlightSql(sql)}${sql.endsWith('\n') ? ' ' : ''}`
  syncEditorScroll()
}

function syncEditorScroll() {
  refs.sqlHighlight.scrollTop = refs.sqlEditor.scrollTop
  refs.sqlHighlight.scrollLeft = refs.sqlEditor.scrollLeft
}

async function prefetchSqlSchemas(sql) {
  const requestTarget = target()
  if (!requestTarget) return
  const names = [...String(sql || '').matchAll(/\b(?:FROM|JOIN|UPDATE|INTO)\s+`?([A-Za-z0-9_$-]+)`?/gi)].map((match) => match[1])
  for (const requested of [...new Set(names)]) {
    const table = state.tables.find((item) => item.name.toLowerCase() === requested.toLowerCase())
    if (!table || state.schemaCache[table.name]?.columns || state.schemaCache[table.name]?.loading) continue
    state.schemaCache[table.name] = { loading: true, columns: [] }
    rpc(METHODS.TABLE_DETAIL, { ...requestTarget, table: table.name })
      .then((detail) => {
        state.schemaCache[table.name] = detail
        if (state.completionOpen) updateSqlCompletion(true)
      })
      .catch(() => { delete state.schemaCache[table.name] })
  }
}

function closeSqlCompletion() {
  state.completions = []
  state.completionIndex = 0
  state.completionOpen = false
  refs.sqlCompletion.hidden = true
  refs.sqlCompletion.replaceChildren()
}

function renderSqlCompletion() {
  refs.sqlCompletion.replaceChildren()
  refs.sqlCompletion.hidden = !state.completionOpen || !state.completions.length
  if (refs.sqlCompletion.hidden) return
  const fragment = document.createDocumentFragment()
  state.completions.forEach((item, index) => {
    const button = element('button', {
      className: `completion-item ${index === state.completionIndex ? 'active' : ''}`,
      type: 'button',
      attributes: { role: 'option', 'aria-selected': String(index === state.completionIndex) },
    }, [
      element('span', { className: 'completion-kind', text: item.kind }),
      element('span', { className: 'completion-label', text: item.label }),
      element('span', { className: 'completion-detail', text: item.detail || '' }),
    ])
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      applySqlCompletion(item)
    })
    fragment.append(button)
  })
  refs.sqlCompletion.append(fragment)
  refs.sqlCompletion.querySelector('.completion-item.active')?.scrollIntoView({ block: 'nearest' })
}

function updateSqlCompletion(force = false) {
  const caret = refs.sqlEditor.selectionStart
  const before = refs.sqlEditor.value.slice(0, caret)
  const prefix = before.match(/([\p{L}\p{N}_$-]*)$/u)?.[1] || ''
  const contextual = /\.[\p{L}\p{N}_$]*$|\b(?:FROM|JOIN|UPDATE|INTO|TABLE)\s+`?[\p{L}\p{N}_$-]*$/iu.test(before)
  const candidates = sqlCompletions(refs.sqlEditor.value, caret, state.tables, state.schemaCache)
  state.completions = candidates
  state.completionIndex = clamp(state.completionIndex, 0, Math.max(0, candidates.length - 1))
  state.completionOpen = candidates.length > 0 && (force || prefix.length > 0 || contextual)
  renderSqlCompletion()
}

function applySqlCompletion(item) {
  if (!item) return
  const value = refs.sqlEditor.value
  const caret = refs.sqlEditor.selectionStart
  const next = `${value.slice(0, item.start)}${item.insert}${value.slice(caret)}`
  const nextCaret = item.start + item.insert.length
  refs.sqlEditor.value = next
  refs.sqlEditor.setSelectionRange(nextCaret, nextCaret)
  refs.sqlEditor.dispatchEvent(new Event('input', { bubbles: true }))
  closeSqlCompletion()
  refs.sqlEditor.focus()
}

function renderResultTabs() {
  for (const button of refs.resultTabs.querySelectorAll('[data-result-tab]')) {
    button.classList.toggle('active', button.dataset.resultTab === state.resultTab)
  }
  renderResult()
}

function renderDataTable(columns, rows, options = {}) {
  const table = element('table', { className: 'data-table' })
  const head = element('thead')
  head.append(element('tr', {}, columns.map((column, columnIndex) => {
    const header = element('th', {
      className: `${options.headerContextMenu ? 'result-column-header' : ''} ${state.contextColumn?.key === options.contextKey && state.contextColumn?.columnIndex === columnIndex ? 'context-open' : ''}`,
      text: column.name,
      title: options.headerContextMenu ? `${column.name} · 右键添加 SQL 条件或排序` : column.name,
    })
    if (options.headerContextMenu) header.addEventListener('contextmenu', (event) => options.headerContextMenu(event, column, columnIndex))
    return header
  })))
  const body = element('tbody')
  rows.forEach((row, rowIndex) => {
    const values = Array.isArray(row) ? row : columns.map((column) => row[column.name])
    const tableRow = element('tr', {
      className: `${options.contextMenu ? 'result-row' : ''} ${state.contextRow?.key === options.contextKey && state.contextRow?.rowIndex === rowIndex ? 'context-open' : ''}`,
    }, values.map((value) => {
      const text = value === null || value === undefined ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value)
      return element('td', { text, className: value === null || value === undefined ? 'null' : '', title: text })
    }))
    if (options.contextMenu) tableRow.addEventListener('contextmenu', (event) => options.contextMenu(event, row, rowIndex))
    body.append(tableRow)
  })
  table.append(head, body)
  return table
}

function currentResult() {
  if (state.resultTab === 'audit') return null
  return activeQueryTab()?.results?.[state.resultTab] || null
}

function formatQueryTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

function formatQueryDuration(value) {
  const duration = Number(value)
  if (!Number.isFinite(duration)) return ''
  if (duration < 1000) return `${Math.max(0, Math.round(duration))} ms`
  const seconds = (duration / 1000).toFixed(duration < 10000 ? 2 : 1).replace(/\.?0+$/, '')
  return `${seconds} s`
}

function formatResultCount(value) {
  if (value === null || value === undefined || value === '') return ''
  try {
    return new Intl.NumberFormat('zh-CN').format(typeof value === 'string' ? BigInt(value) : value)
  } catch {
    return String(value)
  }
}

function renderResultQueryMeta(result) {
  const queryTime = formatQueryTime(result?.queriedAt)
  const duration = formatQueryDuration(result?.durationMs)
  const parts = []
  if (queryTime) parts.push(`查询时间 ${queryTime}`)
  if (duration) parts.push(`耗时 ${duration}`)
  refs.resultQueryMeta.textContent = parts.join(' · ')
  refs.resultQueryMeta.hidden = state.resultTab !== 'result' || !parts.length
}

function canSaveActiveQuery() {
  const tab = activeQueryTab()
  const result = tab?.results?.result
  return state.resultTab === 'result'
    && Boolean(result?.queriedAt)
    && result.sourceSql === tab.sql
}

function renderScriptResults(result) {
  const container = element('div', { className: 'script-results' })
  const resultSets = Array.isArray(result.resultSets) ? result.resultSets : []
  resultSets.forEach((resultSet, index) => {
    const returnedCount = resultSet.rows?.length || 0
    const totalCount = formatResultCount(resultSet.totalCount)
    const summary = totalCount
      ? `返回 ${formatResultCount(returnedCount)} 行 · 符合条件 ${totalCount} 条`
      : `${formatResultCount(returnedCount)} 行`
    const section = element('section', { className: 'script-result' }, [
      element('div', { className: 'script-result-header' }, [
        element('strong', { text: `结果 ${index + 1}` }),
        element('span', { className: 'counter', text: String(resultSet.statementKind || 'query').toUpperCase() }),
        element('span', { className: 'script-result-summary', text: `${summary} · ${formatQueryDuration(resultSet.durationMs)}` }),
      ]),
    ])
    if (resultSet.columns?.length) {
      section.append(renderDataTable(resultSet.columns, resultSet.rows || [], {
        contextKey: `script-${index}`,
        headerContextMenu: (event, column, columnIndex) => openResultColumnMenu(event, resultSet, column, columnIndex),
        contextMenu: (event, row, rowIndex) => openResultRowMenu(event, resultSet, row, rowIndex, true),
      }))
    } else {
      section.append(emptyState('执行完成', '当前语句没有返回结果集'))
    }
    container.append(section)
  })
  return container
}

function renderResult() {
  refs.resultBody.replaceChildren()
  refs.saveQuery.hidden = !canSaveActiveQuery()
  if (state.resultTab === 'audit') {
    renderResultQueryMeta(null)
    const columns = ['time', 'operation', 'status', 'duration', 'rows', 'sql']
    const rows = state.audit.map((entry) => [
      entry.time, entry.operation, entry.status, `${entry.durationMs || 0}ms`, entry.rowCount ?? '—', entry.sqlPreview || entry.sqlHash || '',
    ])
    refs.resultBody.append(rows.length ? renderDataTable(columns.map((name) => ({ name })), rows, {
      contextKey: 'audit',
      contextMenu: (event, row, rowIndex) => openResultRowMenu(event, { columns: columns.map((name) => ({ name })), rows }, row, rowIndex, false),
    }) : emptyState('暂无审计记录', '执行 SQL 后会记录脱敏摘要'))
    refs.resultCount.textContent = `${rows.length} 条`
    refs.exportCsv.disabled = true
    refs.copyTable.disabled = true
    return
  }
  const result = currentResult()
  renderResultQueryMeta(result)
  if (!result) {
    refs.resultBody.append(emptyState(state.resultTab === 'explain' ? '暂无执行计划' : '暂无查询结果', '运行 SQL 后结果会显示在这里'))
    refs.resultCount.textContent = '0 行'
    refs.exportCsv.disabled = true
    refs.copyTable.disabled = true
    return
  }
  if (result.script && result.resultSets?.length) {
    refs.resultBody.append(renderScriptResults(result))
  } else if (result.statementKind && !result.columns?.length) {
    const card = element('div', { className: 'statement-result' }, [
      element('strong', { text: `${String(result.statementKind).toUpperCase()} 执行成功` }),
      element('div', { className: 'statement-meta' }, [
        element('span', { className: 'counter', text: `影响 ${result.affectedRows || 0} 行` }),
        element('span', { className: 'counter', text: `${result.durationMs || 0}ms` }),
      ]),
    ])
    refs.resultBody.append(card)
  } else if (result.columns?.length) {
    refs.resultBody.append(renderDataTable(result.columns, result.rows || [], {
      contextKey: state.resultTab,
      headerContextMenu: state.resultTab === 'result'
        ? (event, column, columnIndex) => openResultColumnMenu(event, result, column, columnIndex)
        : null,
      contextMenu: (event, row, rowIndex) => openResultRowMenu(event, result, row, rowIndex, state.resultTab === 'result'),
    }))
  } else {
    refs.resultBody.append(emptyState('执行完成', '当前语句没有返回结果集'))
  }
  const returnedCount = result.rows?.length || result.affectedRows || 0
  const totalCount = formatResultCount(result.totalCount)
  refs.resultCount.textContent = result.script
    ? `${result.resultSets?.length || 0} 个结果集 · ${formatResultCount((result.resultSets || []).reduce((sum, item) => sum + (item.rows?.length || 0), 0))} 行`
    : result.columns?.length && totalCount
    ? `返回 ${formatResultCount(returnedCount)} 行 · 符合条件 ${totalCount} 条`
    : `${formatResultCount(returnedCount)} 行`
  refs.exportCsv.disabled = !result.columns?.length
  refs.copyTable.disabled = !result.columns?.length
}

function renderStatus() {
  const status = state.status
  refs.statusDot.className = `status-dot ${!state.nativeReady || status?.status === 'error' ? 'error' : status?.status === 'connected' ? 'ok' : ''}`
  if (!state.nativeReady) {
    refs.statusText.textContent = '本地 Native Host 未连接'
    refs.statusDetail.textContent = 'HOST OFFLINE'
  } else if (status?.status === 'connected') {
    refs.statusText.textContent = `CONNECTED ${status.latencyMs}ms · MySQL ${status.server?.version || ''}`
    refs.statusDetail.textContent = `${activeConnection()?.label || ''} / ${state.database}`
  } else if (status?.status === 'error') {
    refs.statusText.textContent = status.error?.message || '连接失败'
    refs.statusDetail.textContent = 'MYSQL ERROR'
  } else {
    refs.statusText.textContent = '本地服务已就绪'
    refs.statusDetail.textContent = 'NATIVE HOST READY'
  }
}

function renderAll() {
  renderTheme()
  renderLayout()
  renderHeader()
  renderConnections()
  renderTables()
  renderInspector()
  renderQueryTabs()
  renderResultTabs()
  renderStatus()
  setBusy(state.busy)
}

async function loadConnections(preferId = '') {
  const value = await rpc(METHODS.CONNECTIONS)
  state.connections = value.connections || []
  const wanted = preferId || state.connectionId || persisted.lastConnectionId
  state.connectionId = state.connections.some((connection) => connection.id === wanted) ? wanted : state.connections[0]?.id || ''
  persisted.lastConnectionId = state.connectionId
  await savePersisted()
  renderHeader()
  renderConnections()
  if (state.connectionId) await chooseConnection(state.connectionId)
  else {
    state.databases = []
    state.database = ''
    state.tables = []
    restoreContext()
    renderAll()
  }
}

async function chooseConnection(connectionId) {
  const connection = state.connections.find((item) => item.id === connectionId)
  if (!connection) return
  if (connection.environment === 'production' && !state.productionAllowed.has(connection.id)) {
    if (!window.confirm(`即将进入生产连接「${connection.label}」。\n\n查询可直接执行，写操作仍会再次确认。是否继续？`)) return
    state.productionAllowed.add(connection.id)
  }
  state.connectionId = connection.id
  persisted.lastConnectionId = connection.id
  state.database = ''
  state.databases = []
  state.tables = []
  state.selectedTable = ''
  state.detail = null
  state.detailLoading = false
  tableDetailSequence += 1
  state.schemaCache = {}
  state.status = null
  renderAll()
  setBusy(true)
  try {
    const value = await rpc(METHODS.DATABASES, {
      connectionId: connection.id,
      productionConfirmed: connection.environment !== 'production' || state.productionAllowed.has(connection.id),
    })
    state.databases = value.databases || []
    const saved = persisted.lastDatabaseByConnection[connection.id]
    state.database = state.databases.some((database) => database.name === saved)
      ? saved
      : state.databases.some((database) => database.name === connection.defaultDatabase)
        ? connection.defaultDatabase
        : state.databases[0]?.name || ''
    persisted.lastDatabaseByConnection[connection.id] = state.database
    await savePersisted()
    if (state.database) await loadDatabase()
  } catch (error) {
    notify(error.message, true)
    state.status = { status: 'error', error: { message: error.message } }
  } finally {
    setBusy(false)
    renderAll()
  }
}

async function chooseDatabase(database) {
  if (!database || database === state.database) return
  state.database = database
  persisted.lastDatabaseByConnection[state.connectionId] = database
  await savePersisted()
  await loadDatabase()
}

async function loadDatabase() {
  const requestTarget = target()
  if (!requestTarget) return
  state.tables = []
  state.selectedTable = ''
  state.detail = null
  state.detailLoading = false
  tableDetailSequence += 1
  state.schemaCache = {}
  state.status = null
  restoreContext()
  renderAll()
  setBusy(true)
  try {
    const [tables, status, audit] = await Promise.all([
      rpc(METHODS.TABLES, requestTarget),
      rpc(METHODS.STATUS, requestTarget),
      rpc(METHODS.AUDIT, { connectionId: requestTarget.connectionId, database: requestTarget.database, limit: 80 }),
    ])
    state.tables = tables.tables || []
    state.status = status
    state.audit = audit.entries || []
  } catch (error) {
    state.status = { status: 'error', error: { message: error.message } }
    notify(error.message, true)
  } finally {
    setBusy(false)
    renderAll()
  }
}

async function chooseTable(table) {
  const requestTarget = target()
  if (!requestTarget) return
  const requestId = ++tableDetailSequence
  const requestScope = scopeKey()
  state.selectedTable = table.name
  state.inspectorTab = 'columns'
  const cached = state.schemaCache[table.name]
  state.detail = cached?.table?.name === table.name ? cached : null
  state.detailLoading = !state.detail
  for (const row of refs.tableList.querySelectorAll('.table-row')) {
    row.classList.toggle('active', row.dataset.tableName === table.name)
  }
  renderInspector()
  if (state.detail) return state.detail
  try {
    const detail = await rpc(METHODS.TABLE_DETAIL, { ...requestTarget, table: table.name })
    if (requestId !== tableDetailSequence || state.selectedTable !== table.name || scopeKey() !== requestScope) return null
    state.detail = detail
    state.schemaCache[table.name] = detail
    return detail
  } catch (error) {
    if (requestId === tableDetailSequence) notify(error.message, true)
    return null
  } finally {
    if (requestId === tableDetailSequence) {
      state.detailLoading = false
      renderInspector()
    }
  }
}

function fillTableQuery(table, run = false) {
  const sql = `SELECT * FROM \`${table.name.replace(/`/g, '``')}\` LIMIT 20`
  let tab = state.queryTabs.find((item) => item.tableName === table.name)
  if (!tab) {
    tab = createQueryTab({ title: table.name, tableName: table.name, sql })
    state.queryTabs.push(tab)
  } else tab.sql = sql
  state.activeQueryId = tab.id
  state.resultTab = 'result'
  persistContext()
  renderQueryTabs()
  renderResultTabs()
  refs.sqlEditor.focus()
  if (run) executeQuery(METHODS.QUERY)
}

function activateQueryTab(id) {
  if (!state.queryTabs.some((tab) => tab.id === id)) return
  state.activeQueryId = id
  persistContext()
  renderQueryTabs()
  renderResult()
}

function addQueryTab() {
  if (state.queryTabs.length >= 20) return notify('最多同时打开 20 个查询页签', true)
  const tab = createQueryTab()
  state.queryTabs.push(tab)
  state.activeQueryId = tab.id
  persistContext()
  renderQueryTabs()
  refs.sqlEditor.focus()
}

function closeQueryTab(id) {
  const index = state.queryTabs.findIndex((tab) => tab.id === id)
  if (index < 0) return
  state.queryTabs.splice(index, 1)
  if (!state.queryTabs.length) state.queryTabs.push(createQueryTab())
  if (state.activeQueryId === id) state.activeQueryId = state.queryTabs[Math.min(index, state.queryTabs.length - 1)].id
  persistContext()
  renderQueryTabs()
  renderResult()
}

function sqlRoot(sql) {
  return String(sql || '').trimStart().match(/^([A-Za-z]+)/)?.[1]?.toLowerCase() || ''
}

async function executeQuery(method) {
  const requestTarget = target()
  const tab = activeQueryTab()
  const sourceSql = tab?.sql || ''
  const sql = stripSqlComments(sourceSql).trim()
  if (!requestTarget || state.busy) return
  if (!sql) return notify(sourceSql.trim() ? 'SQL 注释已过滤，没有可执行语句' : '请输入要执行的 SQL', true)
  const mutating = method === METHODS.QUERY && MUTATING_ROOTS.has(sqlRoot(sql))
  if (mutating && !window.confirm(`确认执行 ${sqlRoot(sql).toUpperCase()} 写操作？\n\n${activeConnection().label} / ${state.database}\n\n${sql.slice(0, 600)}`)) return
  if (mutating && activeConnection().environment === 'production' && !window.confirm(`再次确认在生产库执行写操作？\n\n${sql.slice(0, 600)}`)) return
  const queriedAt = new Date().toISOString()
  setBusy(true)
  try {
    const value = await rpc(method, {
      ...requestTarget,
      sql,
      writeConfirmed: mutating,
      limit: activeConnection().environment === 'production' ? 100 : activeConnection().maxRows,
    })
    const resultKey = method === METHODS.EXPLAIN ? 'explain' : 'result'
    tab.results[resultKey] = { ...value, queriedAt, sourceSql }
    state.resultTab = resultKey
    const audit = await rpc(METHODS.AUDIT, { connectionId: requestTarget.connectionId, database: requestTarget.database, limit: 80 })
    state.audit = audit.entries || []
    persistContext()
    notify(value.script
      ? `只读脚本执行完成 · ${value.statementCount} 条语句 · ${value.resultSets?.length || 0} 个结果集 · ${value.durationMs || 0}ms`
      : `${method === METHODS.EXPLAIN ? 'EXPLAIN' : 'SQL'} 执行完成 · ${value.durationMs || 0}ms`)
  } catch (error) {
    notify(error.message, true)
  } finally {
    setBusy(false)
    renderResultTabs()
  }
}

function beautifySql() {
  const tab = activeQueryTab()
  if (!tab) return
  const start = refs.sqlEditor.selectionStart
  const end = refs.sqlEditor.selectionEnd
  const selected = end > start
  const source = selected ? refs.sqlEditor.value.slice(start, end) : refs.sqlEditor.value
  const formatted = formatSql(source)
  if (!formatted) return notify('没有可美化的 SQL', true)
  if (selected) {
    refs.sqlEditor.setRangeText(formatted, start, end, 'select')
  } else {
    refs.sqlEditor.value = formatted
    refs.sqlEditor.setSelectionRange(formatted.length, formatted.length)
  }
  refs.sqlEditor.dispatchEvent(new Event('input', { bubbles: true }))
  refs.sqlEditor.focus()
  notify(selected ? '已美化选中的 SQL' : 'SQL 已美化')
}

function defaultSavedQueryName(tab) {
  if (tab?.tableName) return `${tab.tableName} 查询`
  if (tab?.title && !/^查询\s+\d+$/.test(tab.title)) return tab.title
  const now = new Date()
  const pad = (value) => String(value).padStart(2, '0')
  return `查询 ${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

function openSaveQueryModal() {
  const tab = activeQueryTab()
  const result = tab?.results?.result
  if (!canSaveActiveQuery() || !result?.sourceSql) return notify('请先成功运行当前 SQL', true)
  refs.modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <section class="modal" role="dialog" aria-modal="true" aria-label="保存查询">
        <div class="modal-header"><strong>保存本次查询</strong><button class="icon-button" type="button" data-close>×</button></div>
        <form>
          <div class="modal-body">
            <label class="field wide"><span>查询名称</span><input name="queryName" maxlength="80" required autocomplete="off"></label>
            <div class="field wide"><span>SQL 预览</span><pre class="saved-query-modal-sql"></pre></div>
          </div>
          <div class="modal-footer">
            <span class="field-hint">${activeConnection().label} / ${state.database}</span>
            <div class="button-row"><button class="button ghost" type="button" data-close>取消</button><button class="button primary" type="submit">保存</button></div>
          </div>
        </form>
      </section>
    </div>`
  const backdrop = refs.modalRoot.querySelector('.modal-backdrop')
  const form = refs.modalRoot.querySelector('form')
  const input = form.elements.queryName
  input.value = defaultSavedQueryName(tab)
  refs.modalRoot.querySelector('.saved-query-modal-sql').textContent = result.sourceSql
  for (const button of refs.modalRoot.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => refs.modalRoot.replaceChildren())
  }
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) refs.modalRoot.replaceChildren()
  })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    const name = input.value.trim()
    if (!name) return
    persisted.savedQueries.unshift({
      id: crypto.randomUUID(),
      name,
      connectionId: state.connectionId,
      database: state.database,
      sql: result.sourceSql,
      createdAt: new Date().toISOString(),
    })
    persisted.savedQueries = persisted.savedQueries.slice(0, 200)
    await savePersisted()
    refs.modalRoot.replaceChildren()
    renderQueryTabs()
    notify(`已保存查询 · ${name}`)
  })
  input.focus()
  input.select()
}

function closeSavedQueryDrawer() {
  refs.savedQueryDrawerRoot.replaceChildren()
}

function runSavedQuery(query) {
  let tab = activeQueryTab()
  const reusable = tab
    && tab.sql.trim() === 'SELECT * FROM'
    && !tab.results.result
    && !tab.results.explain
  if (!reusable) {
    if (state.queryTabs.length >= 20) return notify('最多同时打开 20 个查询页签', true)
    tab = createQueryTab({ title: query.name, sql: query.sql })
    state.queryTabs.push(tab)
  } else {
    tab.title = query.name
    tab.sql = query.sql
    tab.tableName = ''
    tab.results = { result: null, explain: null }
  }
  state.activeQueryId = tab.id
  state.resultTab = 'result'
  persistContext()
  closeSavedQueryDrawer()
  renderQueryTabs()
  renderResultTabs()
  refs.sqlEditor.focus()
  executeQuery(METHODS.QUERY)
}

function openSavedQueryDrawer() {
  const queries = savedQueriesForScope()
  const backdrop = element('div', { className: 'saved-query-drawer-backdrop' })
  const drawer = element('aside', { className: 'saved-query-drawer', attributes: { 'aria-label': '已保存查询' } })
  const close = element('button', { className: 'icon-button', type: 'button', text: '×', title: '关闭已保存查询' })
  const summary = element('span')
  const header = element('div', { className: 'saved-query-drawer-header' }, [
    element('div', {}, [
      element('strong', { text: '已保存查询' }),
      summary,
    ]),
    close,
  ])
  const search = element('input', {
    type: 'search',
    attributes: {
      placeholder: '按查询名称模糊搜索',
      autocomplete: 'off',
      'aria-label': '搜索已保存查询',
    },
  })
  const searchWrap = element('label', { className: 'search-wrap saved-query-search' }, [
    element('span', { text: '⌕', attributes: { 'aria-hidden': 'true' } }),
    search,
  ])
  const list = element('div', { className: 'saved-query-list' })
  const renderList = () => {
    const keyword = search.value.trim()
    const matched = queries
      .map((query, index) => ({ query, index, score: fuzzyTextScore(query.name, keyword) }))
      .filter((item) => Number.isFinite(item.score))
      .sort((left, right) =>
        left.score - right.score
        || String(left.query.name).length - String(right.query.name).length
        || left.index - right.index)
      .map((item) => item.query)
    summary.textContent = keyword
      ? `${activeConnection()?.label || ''} / ${state.database} · 匹配 ${matched.length}/${queries.length} 条`
      : `${activeConnection()?.label || ''} / ${state.database} · ${queries.length} 条`
    list.replaceChildren()
    if (!matched.length) {
      list.append(emptyState(
        queries.length ? '没有匹配的查询' : '暂无已保存查询',
        queries.length ? '尝试输入其他查询名称' : '成功运行 SQL 后，点击“保存查询”添加',
      ))
      return
    }
    for (const query of matched) {
      const item = element('button', {
        className: 'saved-query-item',
        type: 'button',
        title: `载入并运行 ${query.name}`,
      }, [
        element('div', { className: 'saved-query-item-header' }, [
          element('span', { className: 'saved-query-item-name', text: query.name }),
          element('span', { className: 'saved-query-item-time', text: formatQueryTime(query.createdAt) }),
        ]),
        element('code', { className: 'saved-query-item-sql', text: query.sql }),
        element('span', { className: 'saved-query-item-action', text: '点击查看并运行 →' }),
      ])
      item.addEventListener('click', () => runSavedQuery(query))
      list.append(item)
    }
  }
  search.addEventListener('input', renderList)
  close.addEventListener('click', closeSavedQueryDrawer)
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) closeSavedQueryDrawer()
  })
  drawer.append(header, searchWrap, list)
  backdrop.append(drawer)
  refs.savedQueryDrawerRoot.replaceChildren(backdrop)
  renderList()
  search.focus()
}

async function copyText(text, message) {
  if (!text) return notify('无法生成可复制内容', true)
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.append(textarea)
    textarea.select()
    const copied = document.execCommand('copy')
    textarea.remove()
    if (!copied) return notify('复制失败，请检查剪贴板权限', true)
  }
  closeContextMenu()
  notify(message)
}

function applyColumnCommand(column, operation) {
  const tab = activeQueryTab()
  if (!tab) return
  const tableName = activeQueryTab()?.tableName || state.selectedTable
  const baseSql = tab.sql.trim() && tab.sql.trim() !== 'SELECT * FROM'
    ? tab.sql
    : tableName ? `SELECT * FROM ${quoteSqlIdentifier(tableName)} LIMIT 20` : tab.sql
  const change = applyColumnOperation(baseSql, column.originalName || column.name, operation)
  tab.sql = change.sql
  persistContext()
  closeContextMenu()
  renderQueryTabs()
  window.requestAnimationFrame(() => {
    refs.sqlEditor.focus()
    refs.sqlEditor.setSelectionRange(change.selectionStart, change.selectionEnd)
  })
  notify(`已写入字段条件 · ${column.name}`)
}

function openResultColumnMenu(event, result, column, columnIndex) {
  event.preventDefault()
  event.stopPropagation()
  state.contextColumn = { key: state.resultTab, columnIndex }
  state.contextRow = null
  state.contextTable = ''
  renderResult()

  const tableName = column.originalTable || column.table || activeQueryTab()?.tableName || state.selectedTable
  const detail = state.schemaCache[tableName] || (state.detail?.table?.name === tableName ? state.detail : null)
  const sampleValue = (result.rows || []).find((row) => row[columnIndex] !== null && row[columnIndex] !== undefined)?.[columnIndex]
  const type = classifyColumnType(column, detail, sampleValue)
  const typeLabels = { datetime: '时间字段', number: '数值字段', longtext: '长文本字段', text: '文本字段', unknown: '通用字段' }
  const menu = element('div', { className: 'context-menu column-context-menu', attributes: { role: 'menu' } })
  const menuButton = (label, icon, operation, options = {}) => {
    const button = element('button', {
      type: 'button',
      attributes: { role: 'menuitem' },
    }, [
      element('span', { className: 'menu-icon', text: icon }),
      element('span', { text: label }),
    ])
    button.addEventListener('click', () => operation ? applyColumnCommand(column, operation) : copyText(quoteSqlIdentifier(column.originalName || column.name), '已复制字段名'))
    if (options.title) button.title = options.title
    return button
  }

  menu.append(
    element('div', { className: 'menu-label', text: `${typeLabels[type]} · ${column.name}` }),
    menuButton('复制字段名', '⧉', null),
    menuButton('ORDER BY 字段 DESC', '↓', 'order-desc'),
    menuButton('ORDER BY 字段 ASC', '↑', 'order-asc'),
    element('div', { className: 'menu-separator' }),
  )

  if (type === 'datetime') {
    menu.append(
      menuButton('WHERE 字段 >= 时间', '≥', 'date-after'),
      menuButton('WHERE 字段 <= 时间', '≤', 'date-before'),
      menuButton('WHERE 时间范围 BETWEEN', '↔', 'date-between'),
    )
  } else if (type === 'number') {
    menu.append(
      menuButton('WHERE 字段 = 数值', '=', 'number-eq'),
      menuButton('WHERE 字段 > 数值', '>', 'number-gt'),
      menuButton('WHERE 字段 < 数值', '<', 'number-lt'),
      menuButton('WHERE 字段 >= 数值', '≥', 'number-gte'),
      menuButton('WHERE 字段 <= 数值', '≤', 'number-lte'),
      menuButton('WHERE 数值范围 BETWEEN', '↔', 'number-between'),
      menuButton('WHERE 字段 IN (...)', '∈', 'number-in'),
    )
  } else if (type === 'longtext') {
    menu.append(
      menuButton("WHERE 字段 LIKE '%关键词%'", '≈', 'text-like'),
      menuButton("WHERE 字段 LIKE '前缀%'", '↦', 'text-prefix'),
    )
  } else {
    menu.append(
      menuButton("WHERE 字段 = '值'", '=', 'text-eq'),
      menuButton("WHERE 字段 LIKE '%关键词%'", '≈', 'text-like'),
      menuButton("WHERE 字段 LIKE '前缀%'", '↦', 'text-prefix'),
      menuButton("WHERE 字段 IN ('值1', '值2')", '∈', 'text-in'),
    )
  }

  menu.append(
    element('div', { className: 'menu-separator' }),
    menuButton('WHERE 字段 IS NULL', '∅', 'is-null'),
    menuButton('WHERE 字段 IS NOT NULL', '!', 'is-not-null'),
    element('div', { className: 'menu-footer', text: `${column.name} · ${String(detail?.columns?.find((item) => item.name === (column.originalName || column.name))?.type || column.type || type)}` }),
  )
  refs.contextMenuRoot.replaceChildren(menu)
  const width = 258
  const itemCount = menu.querySelectorAll('button').length
  const height = 58 + itemCount * 31
  const gap = 8
  menu.style.width = `${width}px`
  menu.style.left = `${Math.max(gap, Math.min(event.clientX, window.innerWidth - width - gap))}px`
  menu.style.top = `${Math.max(gap, Math.min(event.clientY, window.innerHeight - height - gap))}px`
}

async function writeTableClipboard(value, message) {
  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('rich clipboard unavailable')
    await navigator.clipboard.write([new ClipboardItem({
      'text/plain': new Blob([value.text], { type: 'text/plain' }),
      'text/html': new Blob([value.html], { type: 'text/html' }),
    })])
    closeContextMenu()
    notify(message)
  } catch {
    await copyText(value.text, message)
  }
}

async function copyRowTable(columns, row) {
  await writeTableClipboard(rowTableClipboard(columns, row), '已复制此行表格（字段行 + 数据行）')
}

async function copyResultTable() {
  const result = currentResult()
  if (!result?.columns?.length) return notify('当前没有可复制的表格结果', true)
  await writeTableClipboard(
    tableClipboard(result.columns, result.rows || []),
    `已复制表格 · ${result.rows?.length || 0} 行`,
  )
}

function rowRecord(columns, row) {
  const record = {}
  columns.forEach((column, index) => {
    const base = String(column.name || `column_${index + 1}`)
    let key = base
    let suffix = 2
    while (Object.prototype.hasOwnProperty.call(record, key)) key = `${base}_${suffix++}`
    record[key] = row[index]
  })
  return record
}

function openResultRowMenu(event, result, row, rowIndex, allowSqlActions) {
  event.preventDefault()
  event.stopPropagation()
  state.contextRow = { key: state.resultTab, rowIndex }
  state.contextTable = ''
  renderResult()

  const selectedTable = activeQueryTab()?.tableName || state.selectedTable
  const detail = state.schemaCache[selectedTable] || state.detail
  const sqlContext = allowSqlActions ? rowSqlContext(result, row, selectedTable, detail) : null
  const menu = element('div', { className: 'context-menu row-context-menu', attributes: { role: 'menu' } })
  const menuButton = (label, icon, action, options = {}) => {
    const button = element('button', {
      className: options.danger ? 'danger' : '',
      type: 'button',
      attributes: { role: 'menuitem' },
    }, [
      element('span', { className: 'menu-icon', text: icon }),
      element('span', { text: label }),
    ])
    button.disabled = options.disabled === true
    button.addEventListener('click', action)
    return button
  }

  menu.append(
    menuButton('复制此行表格', '▦', () => copyRowTable(result.columns, row)),
    menuButton('复制此行 JSON', '⧉', () => copyText(JSON.stringify(rowRecord(result.columns, row), null, 2), '已复制整行 JSON')),
  )
  if (allowSqlActions) {
    menu.append(element('div', { className: 'menu-separator' }))
    menu.append(
      menuButton('复制 INSERT SQL', '+', () => copyText(buildRowSql('insert', sqlContext), '已复制 INSERT SQL'), { disabled: !sqlContext }),
      menuButton('复制 UPDATE SQL', '↻', () => copyText(buildRowSql('update', sqlContext), '已复制 UPDATE SQL'), { disabled: !sqlContext }),
      menuButton('复制 DELETE SQL', '×', () => copyText(buildRowSql('delete', sqlContext), '已复制 DELETE SQL'), { disabled: !sqlContext, danger: true }),
    )
  }
  menu.append(element('div', { className: 'menu-footer', text: `第 ${rowIndex + 1} 行 · ${result.columns.length} 列${sqlContext ? ` · ${sqlContext.targetTable}` : ''}` }))
  refs.contextMenuRoot.replaceChildren(menu)
  const width = 224
  const height = allowSqlActions ? 212 : 110
  const gap = 8
  menu.style.left = `${Math.max(gap, Math.min(event.clientX, window.innerWidth - width - gap))}px`
  menu.style.top = `${Math.max(gap, Math.min(event.clientY, window.innerHeight - height - gap))}px`
}

function updateTablePreference(tableName, patch) {
  const key = scopeKey()
  if (!key) return
  const scope = { ...(persisted.tablePreferences[key] || {}) }
  const next = { ...(scope[tableName] || {}), ...patch }
  if (!['top', 'bottom'].includes(next.position)) delete next.position
  if (!/^#[0-9a-f]{6}$/i.test(next.color || '')) delete next.color
  if (Object.keys(next).length) scope[tableName] = next
  else delete scope[tableName]
  if (Object.keys(scope).length) persisted.tablePreferences[key] = scope
  else delete persisted.tablePreferences[key]
  savePersisted()
  closeContextMenu()
  renderTables()
}

function closeContextMenu() {
  const hadTableContext = Boolean(state.contextTable)
  const hadRowContext = Boolean(state.contextRow)
  const hadColumnContext = Boolean(state.contextColumn)
  const hadMenu = refs.contextMenuRoot.childElementCount > 0
  if (!hadTableContext && !hadRowContext && !hadColumnContext && !hadMenu) return
  state.contextTable = ''
  state.contextRow = null
  state.contextColumn = null
  refs.contextMenuRoot.replaceChildren()
  if (hadTableContext) renderTables()
  if (hadRowContext || hadColumnContext) renderResult()
}

function openTableMenu(event, table) {
  event.preventDefault()
  event.stopPropagation()
  state.contextTable = table.name
  renderTables()
  const preference = tablePreferences()[table.name] || {}
  const menu = element('div', { className: 'context-menu', attributes: { role: 'menu' } })
  const selectButton = element('button', { type: 'button', attributes: { role: 'menuitem' } }, [
    element('span', { className: 'menu-icon', text: '✓' }),
    element('span', { text: '选择此表' }),
  ])
  selectButton.addEventListener('click', () => {
    closeContextMenu()
    chooseTable(table)
  })
  const positionButton = (position, icon, label) => {
    const button = element('button', { type: 'button' }, [
      element('span', { className: 'menu-icon', text: icon }),
      element('span', { text: preference.position === position ? `取消${label}` : `表${label}` }),
    ])
    button.addEventListener('click', () => updateTablePreference(table.name, { position: preference.position === position ? '' : position }))
    return button
  }
  menu.append(selectButton, element('div', { className: 'menu-separator' }), positionButton('top', '↑', '置顶'), positionButton('bottom', '↓', '下沉'))
  menu.append(element('div', { className: 'menu-separator' }), element('div', { className: 'menu-label', text: '表名颜色' }))
  const colors = element('div', { className: 'color-grid' })
  for (const color of TABLE_COLORS) {
    const swatch = element('button', {
      className: `color-swatch ${preference.color?.toLowerCase() === color ? 'selected' : ''}`,
      type: 'button',
      title: color,
      style: { background: color },
    })
    swatch.addEventListener('click', () => updateTablePreference(table.name, { color }))
    colors.append(swatch)
  }
  const custom = element('label', { className: 'color-custom', title: '自定义颜色' }, [
    element('span', { text: '+' }),
    element('input', { type: 'color', attributes: { 'aria-label': '自定义表名颜色' } }),
  ])
  const colorInput = custom.querySelector('input')
  colorInput.value = preference.color || '#49d3aa'
  colorInput.addEventListener('change', () => updateTablePreference(table.name, { color: colorInput.value }))
  colors.append(custom)
  menu.append(colors)
  if (preference.color) {
    const reset = element('button', { type: 'button' }, [
      element('span', { className: 'menu-icon', text: '×' }),
      element('span', { text: '恢复默认颜色' }),
    ])
    reset.addEventListener('click', () => updateTablePreference(table.name, { color: '' }))
    menu.append(reset)
  }
  menu.append(element('div', { className: 'menu-footer', text: `当前表 · ${table.name}` }))
  refs.contextMenuRoot.replaceChildren(menu)
  const width = 224
  const height = preference.color ? 267 : 237
  const gap = 8
  menu.style.left = `${Math.max(gap, Math.min(event.clientX, window.innerWidth - width - gap))}px`
  menu.style.top = `${Math.max(gap, Math.min(event.clientY, window.innerHeight - height - gap))}px`
}

function connectionPayload(form, existing) {
  return {
    ...(existing?.id ? { id: existing.id } : {}),
    label: form.elements.label.value,
    environment: form.elements.environment.value,
    host: form.elements.host.value,
    port: Number(form.elements.port.value),
    user: form.elements.user.value,
    defaultDatabase: form.elements.defaultDatabase.value,
    maxRows: Number(form.elements.maxRows.value),
    queryTimeoutMs: Number(form.elements.queryTimeoutMs.value),
    ssl: {
      mode: form.elements.sslMode.value,
      ...(form.elements.caPath.value.trim() ? { caPath: form.elements.caPath.value.trim() } : {}),
    },
  }
}

function openConnectionModal(connection = null) {
  refs.modalRoot.innerHTML = `
    <div class="modal-backdrop">
      <section class="modal" role="dialog" aria-modal="true" aria-label="${connection ? '编辑连接' : '新增连接'}">
        <div class="modal-header"><strong>${connection ? '编辑 MySQL 连接' : '新增 MySQL 连接'}</strong><button class="icon-button" type="button" data-close>×</button></div>
        <form>
          <div class="modal-body">
            <div class="form-grid">
              <label class="field"><span>连接名称</span><input name="label" required></label>
              <label class="field"><span>环境</span><select name="environment"><option value="local">本地</option><option value="development">开发</option><option value="test">测试</option><option value="staging">预发布</option><option value="production">生产</option></select></label>
              <label class="field"><span>Host</span><input name="host" required></label>
              <label class="field"><span>端口</span><input name="port" type="number" min="1" max="65535" required></label>
              <label class="field"><span>用户名</span><input name="user" required></label>
              <label class="field"><span>默认数据库</span><input name="defaultDatabase" required></label>
              <label class="field wide"><span>${connection ? '新密码（留空保持不变）' : '密码'}</span><input name="password" type="password" ${connection ? '' : 'required'} autocomplete="new-password"><small class="field-hint">macOS 优先保存到系统钥匙串。</small></label>
              <label class="field"><span>最大返回行数</span><input name="maxRows" type="number" min="1" max="1000"></label>
              <label class="field"><span>查询超时（毫秒）</span><input name="queryTimeoutMs" type="number" min="100" max="120000"></label>
              <label class="field"><span>SSL 模式</span><select name="sslMode"><option value="disabled">关闭</option><option value="preferred">启用，不校验证书</option><option value="required">启用并校验证书</option></select></label>
              <label class="field"><span>CA 文件路径</span><input name="caPath"></label>
              <label class="field wide" data-production-confirm hidden><span><input name="productionConfirmed" type="checkbox"> 我确认这是生产连接，并知晓写操作风险</span></label>
            </div>
            <div class="modal-message" hidden></div>
          </div>
          <div class="modal-footer">
            <div>${connection ? '<button class="button ghost" type="button" data-delete>删除连接</button>' : ''}</div>
            <div class="button-row"><button class="button ghost" type="button" data-test>测试连接</button><button class="button primary" type="submit">保存</button></div>
          </div>
        </form>
      </section>
    </div>`
  const backdrop = refs.modalRoot.querySelector('.modal-backdrop')
  const form = refs.modalRoot.querySelector('form')
  const message = refs.modalRoot.querySelector('.modal-message')
  const confirmField = refs.modalRoot.querySelector('[data-production-confirm]')
  const setMessage = (text, ok = false) => {
    message.hidden = !text
    message.textContent = text
    message.className = `modal-message ${ok ? 'ok' : ''}`
  }
  const setDefaults = () => {
    form.elements.label.value = connection?.label || ''
    form.elements.environment.value = connection?.environment || 'test'
    form.elements.host.value = connection?.host || '127.0.0.1'
    form.elements.port.value = connection?.port || 3306
    form.elements.user.value = connection?.user || ''
    form.elements.defaultDatabase.value = connection?.defaultDatabase || ''
    form.elements.maxRows.value = connection?.maxRows || 200
    form.elements.queryTimeoutMs.value = connection?.queryTimeoutMs || 10000
    form.elements.sslMode.value = connection?.ssl?.mode || 'disabled'
    form.elements.caPath.value = connection?.ssl?.caPath || ''
  }
  const syncProduction = () => { confirmField.hidden = form.elements.environment.value !== 'production' }
  setDefaults()
  syncProduction()
  form.elements.environment.addEventListener('change', syncProduction)
  refs.modalRoot.querySelector('[data-close]').addEventListener('click', () => refs.modalRoot.replaceChildren())
  backdrop.addEventListener('pointerdown', (event) => {
    if (event.target === backdrop) refs.modalRoot.replaceChildren()
  })
  const act = async (method) => {
    const payload = {
      ...(connection ? { connectionId: connection.id } : {}),
      connection: connectionPayload(form, connection),
      password: form.elements.password.value,
      productionConfirmed: form.elements.environment.value !== 'production' || form.elements.productionConfirmed.checked,
    }
    if (form.elements.environment.value === 'production' && !payload.productionConfirmed) throw new Error('请先确认生产连接风险')
    return rpc(method, payload)
  }
  refs.modalRoot.querySelector('[data-test]').addEventListener('click', async () => {
    setMessage('')
    try {
      const result = await act(METHODS.CONNECTION_TEST)
      setMessage(`连接成功 · ${result.latencyMs}ms · MySQL ${result.server?.version || ''}`, true)
    } catch (error) { setMessage(error.message) }
  })
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    setMessage('')
    try {
      const saved = await act(connection ? METHODS.CONNECTION_UPDATE : METHODS.CONNECTION_CREATE)
      refs.modalRoot.replaceChildren()
      await loadConnections(saved.id)
      notify('连接已保存')
    } catch (error) { setMessage(error.message) }
  })
  refs.modalRoot.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!window.confirm(`确认删除连接「${connection.label}」及其本地密码？`)) return
    try {
      await rpc(METHODS.CONNECTION_DELETE, { connectionId: connection.id, confirmation: connection.id })
      refs.modalRoot.replaceChildren()
      state.connectionId = ''
      await loadConnections()
      notify('连接已删除')
    } catch (error) { setMessage(error.message) }
  })
  form.elements.label.focus()
}

function exportCsv() {
  const result = currentResult()
  if (!result?.columns?.length) return notify('当前没有可导出的结果', true)
  const clean = (value) => value === null || value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  const cell = (value) => {
    let text = clean(value)
    if (/^[=+\-@]/.test(text)) text = `\t${text}`
    return `"${text.replace(/"/g, '""')}"`
  }
  const content = `\uFEFF${[result.columns.map((column) => cell(column.name)).join(','), ...(result.rows || []).map((row) => row.map(cell).join(','))].join('\r\n')}`
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${state.database || 'mysql'}-${activeQueryTab()?.tableName || 'query'}-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  notify('CSV 已导出')
}

function bindEvents() {
  refs.headerConnection.addEventListener('change', () => chooseConnection(refs.headerConnection.value))
  refs.headerDatabase.addEventListener('change', () => chooseDatabase(refs.headerDatabase.value))
  refs.themeSelect.addEventListener('change', () => setTheme(refs.themeSelect.value))
  refs.connectionSettings.addEventListener('click', () => openConnectionModal(activeConnection()))
  refs.addConnection.addEventListener('click', () => openConnectionModal())
  refs.collapseSource.addEventListener('click', () => setPanelOpen('source', false))
  refs.expandSource.addEventListener('click', () => setPanelOpen('source', true))
  refs.collapseObjects.addEventListener('click', () => setPanelOpen('objects', false))
  refs.expandObjects.addEventListener('click', () => setPanelOpen('objects', true))
  refs.collapseInspector.addEventListener('click', () => setPanelOpen('inspector', false))
  refs.expandInspector.addEventListener('click', () => setPanelOpen('inspector', true))
  refs.sourceResizer.addEventListener('pointerdown', (event) => beginResize('source', event))
  refs.objectResizer.addEventListener('pointerdown', (event) => beginResize('objects', event))
  refs.inspectorResizer.addEventListener('pointerdown', (event) => beginResize('inspector', event))
  refs.editorResizer.addEventListener('pointerdown', (event) => beginResize('editor', event))
  refs.sourceResizer.addEventListener('dblclick', () => { persisted.layout.sourceWidth = DEFAULT_LAYOUT.sourceWidth; renderLayout(); savePersisted() })
  refs.objectResizer.addEventListener('dblclick', () => { persisted.layout.objectWidth = DEFAULT_LAYOUT.objectWidth; renderLayout(); savePersisted() })
  refs.inspectorResizer.addEventListener('dblclick', () => { persisted.layout.inspectorHeight = DEFAULT_LAYOUT.inspectorHeight; renderLayout(); savePersisted() })
  refs.editorResizer.addEventListener('dblclick', () => { persisted.layout.editorHeight = DEFAULT_LAYOUT.editorHeight; renderLayout(); savePersisted() })
  refs.tableSearch.addEventListener('input', () => {
    state.search = refs.tableSearch.value
    renderTables()
  })
  refs.inspectorTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-inspector-tab]')
    if (!button) return
    state.inspectorTab = button.dataset.inspectorTab
    renderInspector()
  })
  refs.addQueryTab.addEventListener('click', addQueryTab)
  refs.sqlEditor.addEventListener('input', () => {
    const tab = activeQueryTab()
    if (!tab) return
    tab.sql = refs.sqlEditor.value
    updateEditorPresentation()
    persistContext()
    prefetchSqlSchemas(tab.sql)
    state.completionIndex = 0
    updateSqlCompletion()
    refs.saveQuery.hidden = !canSaveActiveQuery()
  })
  refs.sqlEditor.addEventListener('scroll', syncEditorScroll)
  refs.sqlEditor.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.code === 'Space') {
      event.preventDefault()
      updateSqlCompletion(true)
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      executeQuery(METHODS.QUERY)
      return
    }
    if (state.completionOpen && state.completions.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        state.completionIndex = (state.completionIndex + 1) % state.completions.length
        renderSqlCompletion()
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        state.completionIndex = (state.completionIndex - 1 + state.completions.length) % state.completions.length
        renderSqlCompletion()
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        applySqlCompletion(state.completions[state.completionIndex])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        closeSqlCompletion()
        return
      }
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const start = refs.sqlEditor.selectionStart
      refs.sqlEditor.setRangeText('  ', start, refs.sqlEditor.selectionEnd, 'end')
      refs.sqlEditor.dispatchEvent(new Event('input'))
    }
  })
  refs.sqlEditor.addEventListener('click', () => updateSqlCompletion())
  refs.sqlEditor.addEventListener('keyup', (event) => {
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)) updateSqlCompletion()
  })
  refs.sqlEditor.addEventListener('blur', () => window.setTimeout(() => closeSqlCompletion(), 120))
  refs.runQuery.addEventListener('click', () => executeQuery(METHODS.QUERY))
  refs.formatSql.addEventListener('click', beautifySql)
  refs.runExplain.addEventListener('click', () => executeQuery(METHODS.EXPLAIN))
  refs.saveQuery.addEventListener('click', openSaveQueryModal)
  refs.openSavedQueries.addEventListener('click', openSavedQueryDrawer)
  refs.resultTabs.addEventListener('click', (event) => {
    const button = event.target.closest('[data-result-tab]')
    if (!button) return
    state.resultTab = button.dataset.resultTab
    persistContext()
    renderResultTabs()
  })
  refs.exportCsv.addEventListener('click', exportCsv)
  refs.copyTable.addEventListener('click', copyResultTable)
  window.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.context-menu')) closeContextMenu()
    if (!event.target.closest('.sql-completion') && event.target !== refs.sqlEditor) closeSqlCompletion()
  })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeContextMenu()
      refs.modalRoot.replaceChildren()
      closeSavedQueryDrawer()
    }
  })
  window.addEventListener('resize', closeContextMenu)
  window.addEventListener('scroll', closeContextMenu, true)
}

async function initialize() {
  if (IS_PREVIEW) document.body.dataset.preview = 'true'
  bindEvents()
  restoreContext()
  renderAll()
  await loadPersisted()
  renderTheme()
  renderLayout()
  try {
    const ping = await rpc(METHODS.PING)
    state.nativeReady = true
    refs.statusDetail.textContent = `HOST ${ping.version}`
    await loadNativePersisted()
    renderTheme()
    renderLayout()
    await loadConnections()
  } catch (error) {
    state.nativeReady = false
    state.status = { status: 'error', error: { message: error.message } }
    refs.inspectorBody.replaceChildren(element('div', { className: 'native-error' }, [
      element('strong', { text: '本地 MySQL 服务尚未安装' }),
      element('p', { text: '先在项目目录安装依赖并注册 Native Messaging Host，然后重新打开扩展。' }),
      element('code', { text: 'npm install\nnpm run native:install' }),
    ]))
    notify(error.message, true)
    renderStatus()
  }
}

initialize()
