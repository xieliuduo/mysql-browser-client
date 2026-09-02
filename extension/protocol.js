export const NATIVE_HOST_NAME = 'com.mysql_browser_client.host'

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
})

export function requestMessage(method, params = {}) {
  return {
    id: crypto.randomUUID(),
    method,
    params,
  }
}

