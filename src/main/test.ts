import { net } from 'electron'
import type { TestInput, TestResult } from '../shared/types'

/** 发一个最小请求验证可达性与鉴权。注意会产生极少量 token 消耗。 */
export async function testProvider(input: TestInput): Promise<TestResult> {
  const base = input.baseUrl.replace(/\/+$/, '')
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    let url: string
    let init: { method: string; headers: Record<string, string>; body?: string }
    if (input.tool === 'claude') {
      url = `${base}/v1/messages`
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01'
      }
      if (input.keyType === 'api_key') headers['x-api-key'] = input.apiKey
      else headers['authorization'] = `Bearer ${input.apiKey}`
      init = {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: input.model || 'claude-3-5-haiku-20241022',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }]
        })
      }
    } else {
      url = `${base}/models`
      init = { method: 'GET', headers: { authorization: `Bearer ${input.apiKey}` } }
    }
    const res = await net.fetch(url, { ...init, signal: controller.signal } as RequestInit)
    const latencyMs = Date.now() - started
    if (res.ok) return { ok: true, kind: 'ok', status: res.status, latencyMs }
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        kind: 'auth',
        status: res.status,
        latencyMs,
        message: '接口可达，但鉴权失败（401/403），请检查 API Key 与 Key 类型'
      }
    }
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 200)
    } catch {
      /* 忽略响应体读取失败 */
    }
    return { ok: false, kind: 'http', status: res.status, latencyMs, message: `HTTP ${res.status} ${detail}` }
  } catch (e) {
    const err = e as Error
    const message = err?.name === 'AbortError' ? '请求超时（12 秒）' : err?.message ?? String(e)
    return { ok: false, kind: 'network', message }
  } finally {
    clearTimeout(timer)
  }
}
