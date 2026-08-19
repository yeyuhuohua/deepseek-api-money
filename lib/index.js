// deepseek-api-money — host half (persistent web-surface plugin).
// Serves the DeepSeek account balance to the browser at
// GET /deepseek-api-money/status.
// The API key never leaves the host: it is resolved from the credentials
// seam and passed to curl through the environment.
const ROUTE_PREFIX = '/deepseek-api-money'
const STATUS_PATH = '/deepseek-api-money/status'
const CACHE_TTL_MS = 30000
let cache = { at: 0, value: null }

export const name = 'deepseek-api-money'
export const inject = ['webServer']

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-cache',
  })
  res.end(body)
}

async function fetchBalance(ctx) {
  const credentials = ctx.get('credentials')
  const shell = ctx.get('shell')
  if (credentials === undefined || shell === undefined) {
    return { kind: 'error', message: '宿主缺少 credentials/shell 服务' }
  }
  const now = Date.now()
  if (cache.value !== null && now - cache.at < CACHE_TTL_MS) return cache.value
  const resolved = await credentials.resolve('DEEPSEEK_API_KEY')
  if (resolved === undefined) {
    return { kind: 'error', message: '未找到 DEEPSEEK_API_KEY（请配置到 ~/.dsh/.credentials.yaml 或环境变量）' }
  }
  const spec = shell.resolve({
    command: 'curl -sS -m 15 -H "Authorization: Bearer $DS_MONEY_KEY" https://api.deepseek.com/user/balance',
    env: { DS_MONEY_KEY: resolved.value },
    timeoutMs: 20000,
    stdoutMaxBytes: 8192,
  })
  const result = await shell.run(spec)
  if (result.sandbox !== undefined && result.sandbox !== null && result.sandbox.denied) {
    return { kind: 'error', message: '命令被沙箱策略拒绝' }
  }
  if (result.exitCode !== 0) {
    return { kind: 'error', message: 'curl 失败 (exit ' + result.exitCode + ')' }
  }
  const text = result.stdout !== undefined && result.stdout.text !== undefined ? result.stdout.text : ''
  let data
  try {
    data = JSON.parse(text)
  } catch (error) {
    return { kind: 'error', message: '余额响应不是有效 JSON' }
  }
  if (data !== null && typeof data === 'object' && data.is_available === false) {
    return { kind: 'error', message: '账户余额不可用' }
  }
  const infos = data !== null && typeof data === 'object' && Array.isArray(data.balance_infos) ? data.balance_infos : []
  let info = null
  for (const item of infos) {
    if (item !== null && typeof item === 'object' && item.currency === 'CNY') { info = item; break }
  }
  if (info === null && infos.length > 0) info = infos[0]
  if (info === null || typeof info !== 'object') {
    return { kind: 'error', message: '余额响应缺少 balance_infos' }
  }
  const out = {
    kind: 'ok',
    currency: info.currency === 'CNY' ? '¥' : String(info.currency) + ' ',
    total: info.total_balance !== undefined ? String(info.total_balance) : '0',
    granted: info.granted_balance !== undefined ? String(info.granted_balance) : '0',
    topped: info.topped_up_balance !== undefined ? String(info.topped_up_balance) : '0',
  }
  cache = { at: now, value: out }
  return out
}

export function apply(ctx) {
  const dispose = ctx.webServer.register({
    kind: 'prefix',
    path: ROUTE_PREFIX,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { kind: 'error', message: 'method not allowed' })
        return
      }
      const pathname = new URL(req.url ?? '/', 'http://x').pathname
      if (pathname !== STATUS_PATH) {
        sendJson(res, 404, { kind: 'error', message: 'not found' })
        return
      }
      try {
        sendJson(res, 200, await fetchBalance(ctx))
      } catch (error) {
        sendJson(res, 500, { kind: 'error', message: '内部错误' })
      }
    },
  })
  ctx.effect(() => dispose, 'deepseek-api-money: web route')
}
