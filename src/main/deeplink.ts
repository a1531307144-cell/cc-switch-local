import type { DeeplinkResult, ToolId } from '../shared/types'

/**
 * ccsl:// 深链（v0.7.0）：从网页一键导入供应商配置。
 *
 * 格式：ccsl://provider/add?tool=claude&name=...&url=https://...&model=...&keyType=auth_token&wire=responses
 *
 * 安全设计：链接**不携带 API Key**（链接可能被分享/托管在第三方网站，Key 必须用户手填）；
 * url 只接受 http/https；所有字段限长；未知参数忽略；解析永不抛错（返回错误信息而非异常）。
 */

const TOOL_IDS: ToolId[] = ['claude', 'codex']

export function buildProviderDeeplink(p: {
  tool: ToolId
  name: string
  baseUrl: string
  model?: string
  keyType?: 'auth_token' | 'api_key'
  wireApi?: 'responses' | 'chat'
}): string {
  const q = new URLSearchParams()
  q.set('tool', p.tool)
  q.set('name', p.name)
  q.set('url', p.baseUrl)
  if (p.model) q.set('model', p.model)
  if (p.keyType) q.set('keyType', p.keyType)
  if (p.wireApi) q.set('wire', p.wireApi)
  return `ccsl://provider/add?${q.toString()}`
}

export function parseProviderDeeplink(raw: string): DeeplinkResult {
  try {
    if (!raw.toLowerCase().startsWith('ccsl://')) return { ok: false, error: '不是 ccsl:// 链接' }
    const u = new URL(raw)
    // ccsl://provider/add → host='provider', pathname='/add'（Windows 传参大小写不定，统一小写比较）
    if (u.host.toLowerCase() !== 'provider' || u.pathname.replace(/^\//, '').toLowerCase() !== 'add') {
      return { ok: false, error: '不支持的深链命令（仅支持 provider/add）' }
    }
    const q = u.searchParams
    const tool = (q.get('tool') ?? '').toLowerCase()
    if (!TOOL_IDS.includes(tool as ToolId)) return { ok: false, error: 'tool 必须是 claude 或 codex' }
    const url = q.get('url') ?? ''
    if (!/^https?:\/\//i.test(url) || url.length > 2000) return { ok: false, error: 'url 必须以 http(s):// 开头且不超过 2000 字符' }
    const name = (q.get('name') ?? '').trim()
    if (!name || name.length > 200) return { ok: false, error: 'name 必须为 1-200 个字符' }
    const model = (q.get('model') ?? '').trim()
    if (model.length > 200) return { ok: false, error: 'model 过长' }
    const keyTypeRaw = (q.get('keyType') ?? '').toLowerCase()
    const keyType = keyTypeRaw === 'api_key' ? 'api_key' : keyTypeRaw === 'auth_token' ? 'auth_token' : undefined
    if (keyTypeRaw && !keyType) return { ok: false, error: 'keyType 必须是 auth_token 或 api_key' }
    const wireRaw = (q.get('wire') ?? '').toLowerCase()
    const wireApi = wireRaw === 'chat' ? 'chat' : wireRaw === 'responses' ? 'responses' : undefined
    if (wireRaw && !wireApi) return { ok: false, error: 'wire 必须是 responses 或 chat' }

    return {
      ok: true,
      input: {
        tool: tool as ToolId,
        name,
        baseUrl: url,
        // 深链永不携带 Key，必须手填（类型上就是 Omit<ProviderInput,'apiKey'>）
        keyType,
        model: model || undefined,
        wireApi
      }
    }
  } catch {
    return { ok: false, error: '链接解析失败' }
  }
}

/** 从进程 argv / second-instance argv 里找出 ccsl:// 链接 */
export function findDeeplinkInArgv(argv: string[]): string | null {
  for (const a of argv) {
    if (typeof a === 'string' && a.toLowerCase().startsWith('ccsl://')) return a
  }
  return null
}
