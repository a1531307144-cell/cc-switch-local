import { net } from 'electron'
import type { KeyType, ModelsResult } from '../shared/types'

/**
 * 拉取上游可用模型列表（v0.8.18，对齐原版 cc-switch 的 model_fetch）：
 * OpenAI 兼容的 GET /v1/models；baseURL 已以 /v{N} 结尾时先试 {base}/models 再兜底 {base}/v1/models。
 * 鉴权与 provider:test 同一信任级别：keyType=api_key 用 x-api-key（补 anthropic-version），否则 Bearer。
 * 出错信息绝不回显 API Key。
 */
export async function fetchModels(input: {
  baseUrl: string
  apiKey: string
  keyType?: KeyType
  protocol?: 'anthropic' | 'openai'
}): Promise<ModelsResult> {
  if (!/^https?:\/\//i.test(input.baseUrl)) {
    return { ok: false, message: 'Base URL 非法（仅允许 http/https）' }
  }
  if (!input.apiKey || input.apiKey.length > 4000) {
    return { ok: false, message: 'API Key 非法' }
  }
  const base = input.baseUrl.trim().replace(/\/+$/, '')
  // 候选地址（对齐原版 cc-switch）：正常拼 /v1/models；已以 /v{N} 版本段结尾改拼 /models，
  // 版本段非 /v1 时再追加「剥掉版本段」+ /v1/models 兜底
  const versionTail = base.match(/\/v(\d+)$/)
  const candidates = versionTail
    ? versionTail[1] === '1'
      ? [`${base}/models`]
      : [`${base}/models`, `${base.slice(0, -versionTail[0].length)}/v1/models`]
    : [`${base}/v1/models`]

  let lastHttp = 0
  let lastDetail = ''
  for (const url of candidates) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    try {
      const headers: Record<string, string> = { accept: 'application/json' }
      if (input.keyType === 'api_key') {
        headers['x-api-key'] = input.apiKey
        headers['anthropic-version'] = '2023-06-01'
      } else {
        headers.authorization = `Bearer ${input.apiKey}`
      }
      const res = await net.fetch(url, { method: 'GET', headers, signal: controller.signal } as RequestInit)
      if (res.ok) {
        const ids = parseModelIds(await res.text().catch(() => ''))
        if (ids.length) return { ok: true, models: ids }
        lastHttp = res.status
        lastDetail = '响应里没有模型列表'
        continue
      }
      lastHttp = res.status
      lastDetail = (await res.text().catch(() => '')).slice(0, 200)
    } catch (e) {
      const err = e as Error
      if (err?.name === 'AbortError') return { ok: false, message: '请求超时（12 秒）' }
      lastDetail = err?.message ?? String(e)
    } finally {
      clearTimeout(timer)
    }
  }
  if (lastHttp === 401 || lastHttp === 403) {
    return { ok: false, message: '接口可达，但鉴权失败（401/403），请检查 API Key 与 Key 类型' }
  }
  return { ok: false, message: lastHttp ? `HTTP ${lastHttp} ${lastDetail}`.trim() : lastDetail || '无法获取模型列表' }
}

/** 从 /v1/models 响应里取模型 id：兼容 {data:[{id}]} 与 {models:[{id}]} 两种形状 */
function parseModelIds(raw: string): string[] {
  let j: unknown
  try {
    j = JSON.parse(raw)
  } catch {
    return []
  }
  const arr =
    j && typeof j === 'object' && Array.isArray((j as Record<string, unknown>).data)
      ? ((j as Record<string, unknown>).data as unknown[])
      : j && typeof j === 'object' && Array.isArray((j as Record<string, unknown>).models)
        ? ((j as Record<string, unknown>).models as unknown[])
        : []
  const ids = new Set<string>()
  for (const item of arr) {
    if (typeof item === 'string' && item.trim()) ids.add(item.trim())
    else if (item && typeof item === 'object') {
      const id = (item as Record<string, unknown>).id
      if (typeof id === 'string' && id.trim()) ids.add(id.trim())
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b))
}
