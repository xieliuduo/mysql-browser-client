export const NATIVE_HOST_NAME = 'com.mysql_browser_client.host'
export const EXTENSION_ID = 'mlnpedajfbpmplknfkdeiedddnjldman'

export const METHODS = Object.freeze({
  PING: 'ping',
  CONNECTIONS: 'connections',
  CONNECTION_CREATE: 'connection-create',
  CONNECTION_UPDATE: 'connection-update',
  CONNECTION_DELETE: 'connection-delete',
  CONNECTION_TEST: 'connection-test',
  DATABASES: 'databases',
  STATUS: 'status',
  TABLES: 'tables',
  TABLE_DETAIL: 'table-detail',
  QUERY: 'query',
  EXPLAIN: 'explain',
  AUDIT: 'audit',
  WORKSPACE_GET: 'workspace-get',
  WORKSPACE_SET: 'workspace-set',
})

export function requestMessage(method, params = {}) {
  return {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    method,
    params,
  }
}
