import { net } from 'electron'
import { detectVendor } from '../shared/vendors'
import type { BalanceResult } from '../shared/types'

/**
 * 供应商余额查询（v0.7.0）：只支持有官方公开余额接口的三家，
 * 触发条件是端点域名被识别为对应厂商——中转站一律不查（接口不统一，也不该把 Key 发给它以外的域名）。
 * 这是继连接测试、本机路由之后的第三个主动网络出口：仅当用户点击「余额」时发起，
 * 目标是用户自己配置端点的官方域名，只带该端点的 Key。
 * endpoints 参数仅自测用（把请求指向本地 mock），IPC 路径不会传它。
 */

export function balanceSupported(baseUrl: string): boolean {
  const v = detectVendor(baseUrl)
  return v?.id === 'deepseek' || v?.id === 'moonshot' || v?.id === 'openrouter' || v?.id === 'siliconflow'
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : null
}

async function fetchJson(url: string, key: string, timeoutMs = 10000): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await net.fetch(url, {
      headers: { authorization: `Bearer ${key}` },
      signal: controller.signal
    } as RequestInit)
    if (res.status === 401 || res.status === 403) throw new Error('AUTH')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

interface EndpointOverride {
  deepseek?: string
  moonshot?: string
  openrouter?: string
  siliconflow?: string
}

export async function fetchBalance(baseUrl: string, apiKey: string, endpoints?: EndpointOverride): Promise<BalanceResult> {
  if (!apiKey) return { ok: false, message: 'API Key 为空' }
  const v = detectVendor(baseUrl)
  try {
    if (v?.id === 'deepseek') {
      // GET /user/balance → balance_infos[0]: { currency, total_balance }
      const j = (await fetchJson(endpoints?.deepseek ?? 'https://api.deepseek.com/user/balance', apiKey)) as {
        balance_infos?: { currency?: unknown; total_balance?: unknown }[]
      }
      const info = j.balance_infos?.[0]
      const balance = num(info?.total_balance)
      if (balance === null) return { ok: false, message: '响应格式不符合预期' }
      return { ok: true, balance, currency: typeof info?.currency === 'string' ? info.currency : 'CNY' }
    }
    if (v?.id === 'moonshot') {
      // GET /v1/users/me/balance → data.available_balance（人民币）
      const host = new URL(baseUrl).hostname.endsWith('moonshot.ai') ? 'https://api.moonshot.ai' : 'https://api.moonshot.cn'
      const j = (await fetchJson(`${endpoints?.moonshot ?? host}/v1/users/me/balance`, apiKey)) as {
        data?: { available_balance?: unknown }
      }
      const balance = num(j.data?.available_balance)
      if (balance === null) return { ok: false, message: '响应格式不符合预期' }
      return { ok: true, balance, currency: 'CNY' }
    }
    if (v?.id === 'openrouter') {
      // GET /api/v1/credits → data: { total_credits, total_usage }（USD）
      const j = (await fetchJson(endpoints?.openrouter ?? 'https://openrouter.ai/api/v1/credits', apiKey)) as {
        data?: { total_credits?: unknown; total_usage?: unknown }
      }
      const total = num(j.data?.total_credits)
      const usage = num(j.data?.total_usage) ?? 0
      if (total === null) return { ok: false, message: '响应格式不符合预期' }
      return { ok: true, balance: Math.round((total - usage) * 100) / 100, currency: 'USD' }
    }
    if (v?.id === 'siliconflow') {
      // GET /v1/user/info（官方文档 siliconflow.readme.io/reference/user-info）
      // → data: { balance, chargeBalance, totalBalance, ... } 均为字符串金额（CNY）
      // totalBalance 含赠送额度，比 balance 更接近实际可用（官方字段语义分歧，见 v0.8.9 实测备注）
      const j = (await fetchJson(endpoints?.siliconflow ?? 'https://api.siliconflow.cn/v1/user/info', apiKey)) as {
        data?: { balance?: unknown; totalBalance?: unknown }
      }
      const balance = num(j.data?.totalBalance) ?? num(j.data?.balance)
      if (balance === null) return { ok: false, message: '响应格式不符合预期' }
      return { ok: true, balance, currency: 'CNY' }
    }
    return { ok: false, message: '该供应商暂不支持余额查询' }
  } catch (e) {
    const msg = (e as Error).message
    if (msg === 'AUTH') return { ok: false, message: '鉴权失败（401/403），请检查 API Key' }
    if (msg === 'AbortError' || (e as Error).name === 'AbortError') return { ok: false, message: '查询超时（10 秒）' }
    return { ok: false, message: `查询失败：${msg}` }
  }
}
