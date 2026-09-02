const DEFAULT_MAX_LENGTH = 8

export function compactTableSummary(comment, maxLength = DEFAULT_MAX_LENGTH) {
  if (!Number.isSafeInteger(maxLength) || maxLength < 1) return ''
  const normalized = String(comment ?? '').replace(/\s+/g, ' ').trim()
  if (!normalized) return ''
  const characters = Array.from(normalized)
  if (characters.length <= maxLength) return normalized
  if (maxLength === 1) return '…'
  return `${characters.slice(0, maxLength - 1).join('')}…`
}

const EXACT_SUMMARIES = {
  user: '用户信息',
  order: '订单信息',
  vehicle: '车辆信息',
  park: '园区信息',
  station: '站点信息',
  company: '企业信息',
  firm: '企业信息',
}

const PHRASE_SUMMARIES = new Map([
  ['parking space', '停车位'],
  ['business info', '业务信息'],
  ['base info', '基础信息'],
  ['callback info', '回调信息'],
  ['address info', '地址信息'],
  ['extra info', '扩展信息'],
  ['service data', '服务数据'],
  ['status check', '状态检查'],
  ['battery health', '电池健康'],
  ['fault type', '故障类型'],
  ['route relation', '路线关联'],
  ['mission sub', '子任务'],
  ['login log', '登录日志'],
  ['operate log', '操作日志'],
  ['apply log', '申请日志'],
  ['failure log', '失败日志'],
])

const TOKEN_SUMMARIES = {
  vehicle: '车辆', mission: '任务', sub: '子', phase: '阶段', order: '订单', user: '用户',
  role: '角色', menu: '菜单', product: '产品', function: '功能', permission: '权限',
  auth: '权限', company: '企业', enterprise: '企业', firm: '企业', customer: '客户',
  supplier: '供应商', business: '业务', base: '基础', info: '信息', detail: '明细',
  data: '数据', service: '服务', status: '状态', state: '状态', type: '类型',
  dict: '字典', config: '配置', setting: '设置', relation: '关联', mapping: '映射',
  record: '记录', records: '记录', log: '日志', logs: '日志', history: '历史',
  statistic: '统计', statistics: '统计', report: '报表', result: '结果', callback: '回调',
  request: '请求', response: '响应', event: '事件', alarm: '告警', warning: '告警',
  fault: '故障', battery: '电池', accessory: '配件', current: '当前', count: '统计',
  park: '园区', parking: '停车', space: '位', station: '站点', region: '区域',
  zone: '区域', route: '路线', routing: '规划', path: '路径', trace: '轨迹',
  point: '点位', map: '地图', position: '位置', dispatch: '调度', schedule: '排期',
  automatic: '自动', remote: '远程', online: '在线', control: '控制', ctrl: '控制',
  device: '设备', app: '应用', version: '版本', model: '车型', license: '牌照',
  image: '图片', picture: '图片', video: '视频', voice: '语音', notice: '通知',
  message: '消息', template: '模板', label: '标签', white: '白名单',
  express: '快递', package: '包裹', packages: '包裹', courier: '快递员',
  delivery: '配送', waybill: '运单', task: '任务', third: '三方', source: '来源',
  src: '来源', center: '中心', organization: '组织', organize: '组织', group: '分组',
  profile: '档案', cert: '证件', quality: '质量', accident: '事故', dashboard: '看板',
  daily: '日报', month: '月报', rank: '排序', sort: '排序', visible: '可见',
  oauth: '授权', client: '客户端', token: '令牌', cache: '缓存', lock: '锁',
  ota: 'OTA', nem: 'NEM', vin: 'VIN', poi: 'POI', ad: '智驾', pilot: '接管',
  sf: '顺丰', jdl: '京东物流', yto: '圆通', ems: 'EMS', aqua: '零售',
  sound: '声音', light: '灯光', power: '能耗', waste: '损耗', clockin: '打卡',
}

export function inferTableSummary(tableName, maxLength = DEFAULT_MAX_LENGTH) {
  const normalized = String(tableName ?? '').replace(/[`'"]/g, '').trim().toLowerCase()
  if (!normalized) return ''
  if (EXACT_SUMMARIES[normalized]) return compactTableSummary(EXACT_SUMMARIES[normalized], maxLength)

  const tokens = normalized.split(/[_\W]+/).filter(Boolean)
  while (tokens.length && ['t', 'tb', 'tbl'].includes(tokens[0])) tokens.shift()

  const translated = []
  for (let index = 0; index < tokens.length;) {
    const pair = `${tokens[index]} ${tokens[index + 1] || ''}`.trim()
    const phrase = PHRASE_SUMMARIES.get(pair)
    if (phrase) {
      translated.push(phrase)
      index += 2
      continue
    }
    const token = TOKEN_SUMMARIES[tokens[index]]
    if (token && translated.at(-1) !== token) translated.push(token)
    index += 1
  }

  const summary = translated.join('') || '业务数据'
  return compactTableSummary(summary, maxLength)
}

export function tableSummary(tableName, comment, maxLength = DEFAULT_MAX_LENGTH) {
  const databaseSummary = compactTableSummary(comment, maxLength)
  return databaseSummary && databaseSummary.toUpperCase() !== 'VIEW'
    ? databaseSummary
    : inferTableSummary(tableName, maxLength)
}
