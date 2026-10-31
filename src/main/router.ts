import http from 'node:http'
import { Readable } from 'node:stream'
import { loadStore } from './store'
import { resolveAggregatePrefix, aggregateAliasOf } from '../shared/aggregate'
import { anthropicToOpenAI, estimateAnthropicTokens, openAIErrorToAnthropic, openAIToAnthropicResponse, pumpOpenAIToAnthropic } from './convert'
import type { Provider, RouterStatus, ToolId } from '../shared/types'

/**
 * 本地路由（最简版）：127.0.0.1 上的转发代理，带按供应商列表顺序的故障转移。
 * - /claude/* → 当前 Claude 供应商（Anthropic 兼容端点透传）
 * - /codex/*  → 当前 Codex 供应商（OpenAI 兼容端点透传）
 * 上游失败（连接错误 / 5xx / 429）时按列表顺序换下一家，最多试 4 家。
 * 客户端只拿占位 Key，真实 Key 只存在本机 store 与路由进程内存里。
 * 协议转换（Claude↔OpenAI）不在本版本范围，留待 v0.7。
 */

/** 默认端口避开原版 cc-switch 的代理端口（它也监听 127.0.0.1，两应用并存时不冲突；2026-10-31 实测） */
const DEFAULT_PORT = 15731
const MAX_ATTEMPTS = 4
const MAX_BODY = 64 * 1024 * 1024
const UPSTREAM_TIMEOUT_MS = 600_000
/** 响应体阶段：超过这个时长没有任何新数据就断开（头部阶段超时由 UPSTREAM_TIMEOUT_MS 覆盖） */
const BODY_IDLE_TIMEOUT_MS = 120_000

/** 熔断器（v0.8.7）：连续失败达阈值后冷却一段时间，期间故障转移直接跳过该供应商 */
const BREAKER_THRESHOLD = 3
const BREAKER_COOLDOWN_MS = 5 * 60_000

let server: http.Server | null = null
let lastError = ''
const stats: Record<ToolId, { requests: number; errors: number }> = {
  claude: { requests: 0, errors: 0 },
  codex: { requests: 0, errors: 0 }
}

const breaker = new Map<string, { fails: number; until: number }>()

function breakerKey(p: Provider): string {
  return p.id || p.baseUrl
}

/** 连接失败/5xx/429 记一次失败；达到阈值进入冷却 */
function recordFailure(p: Provider): void {
  const k = breakerKey(p)
  const cur = breaker.get(k) ?? { fails: 0, until: 0 }
  cur.fails += 1
  if (cur.fails >= BREAKER_THRESHOLD) cur.until = Date.now() + BREAKER_COOLDOWN_MS
  breaker.set(k, cur)
}

/** 上游有响应（含 4xx，说明服务活着）即清零 */
function recordSuccess(p: Provider): void {
  breaker.delete(breakerKey(p))
}

function isCooling(p: Provider): boolean {
  const b = breaker.get(breakerKey(p))
  return !!b && b.until > Date.now()
}

/**
 * 从候选链里剔除冷却中的供应商；全被剔除时保留原链（宁可多撞一次也不整体断供）。
 */
function applyBreaker(chain: Provider[]): Provider[] {
  const alive = chain.filter((p) => !isCooling(p))
  return alive.length > 0 ? alive : chain
}

/** 仅供自测：清空熔断状态 */
export function resetBreakerForTest(): void {
  breaker.clear()
}

export function routerPort(): number {
  const env = Number(process.env.CCS_ROUTER_PORT)
  if (Number.isInteger(env) && env > 0 && env < 65536) return env
  const s = loadStore().settings.router?.port
  return typeof s === 'number' && Number.isInteger(s) && s > 0 && s < 65536 ? s : DEFAULT_PORT
}

export function routerEnabled(tool: ToolId): boolean {
  return loadStore().settings.router?.[tool] === true
}

export async function startRouter(): Promise<void> {
  if (server) return
  await new Promise<void>((resolve, reject) => {
    const s = http.createServer((req, res) => {
      handle(req, res).catch(() => {
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: '路由内部错误' } }))
        } else {
          res.destroy()
        }
      })
    })
    s.on('error', (e) => {
      server = null
      lastError = (e as Error).message
      reject(e)
    })
    s.listen(routerPort(), '127.0.0.1', () => {
      server = s
      lastError = ''
      resolve()
    })
  })
}

export function stopRouter(): void {
  server?.close()
  server = null
}

export function routerStatus(): RouterStatus {
  return {
    running: !!server,
    port: routerPort(),
    ...(lastError ? { error: lastError } : {}),
    claude: { enabled: routerEnabled('claude'), ...stats.claude },
    codex: { enabled: routerEnabled('codex'), ...stats.codex }
  }
}

function jsonError(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { type: 'ccsl_router', message } }))
}

/** 从 URL 解析出工具与前缀后的子路径（含查询串） */
function parseRoute(url: string): { tool: ToolId; rest: string } | null {
  if (url === '/claude' || url.startsWith('/claude/')) return { tool: 'claude', rest: url.slice('/claude'.length) || '/' }
  if (url === '/codex' || url.startsWith('/codex/')) return { tool: 'codex', rest: url.slice('/codex'.length) || '/' }
  return null
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

const HOP_HEADERS = new Set(['host', 'content-length', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade'])

function buildUpstreamHeaders(tool: ToolId, provider: Provider, req: http.IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.headers)) {
    if (HOP_HEADERS.has(k) || k === 'authorization' || k === 'x-api-key') continue
    if (typeof v === 'string') headers[k] = v
  }
  // 客户端拿到的只是占位 Key；真实 Key 在这里注入
  if (tool === 'claude') {
    if (provider.keyType === 'api_key') headers['x-api-key'] = provider.apiKey
    else headers['authorization'] = `Bearer ${provider.apiKey}`
  } else {
    headers['authorization'] = `Bearer ${provider.apiKey}`
  }
  return headers
}

/**
 * 来源校验（2026-10-31 审计 P1）：本路由会把真实 API Key 注入后转发，
 * 绝不能让浏览器里的网页借道发请求——浏览器跨域请求必带 Origin（含预检 OPTIONS），
 * 而 Claude Code / Codex CLI 客户端从不带 Origin。Host 校验另防 DNS rebinding。
 */
function loopbackHostOk(host: string | undefined, port: number): boolean {
  if (!host) return false
  const h = host.toLowerCase()
  return h === `127.0.0.1:${port}` || h === `localhost:${port}` || h === `[::1]:${port}`
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const port = routerPort()
  if (req.headers.origin) {
    jsonError(res, 403, '拒绝来自浏览器的请求（本路由只服务本机 CLI 客户端）')
    return
  }
  if (!loopbackHostOk(req.headers.host, port)) {
    jsonError(res, 403, '拒绝：Host 不是本机回环地址（可能的 DNS rebinding）')
    return
  }
  if (req.method === 'OPTIONS') {
    jsonError(res, 403, '本路由不接受 OPTIONS 预检')
    return
  }
  const route = parseRoute(req.url ?? '')
  if (!route) {
    jsonError(res, 404, '未知路径（支持 /claude/* 与 /codex/*）')
    return
  }
  const { tool, rest } = route
  const store = loadStore()
  const current = store.current[tool] ? store.providers.find((p) => p.id === store.current[tool]) ?? null : null
  const aggregateEnabled = tool === 'claude' && store.settings.router?.aggregate === true

  const baseChain: Provider[] = [
    ...(current ? [current] : []),
    ...store.providers.filter((p) => p.tool === tool && p.id !== current?.id)
  ].slice(0, MAX_ATTEMPTS)

  const body = await readBody(req).catch(() => null)
  if (body === null) {
    stats[tool].errors++
    jsonError(res, 413, '请求体过大或读取失败')
    return
  }

  let aggregateHit: { provider: Provider; model: string } | null = null
  if (aggregateEnabled && rest.split('?')[0] === '/v1/messages') {
    try {
      const ab = JSON.parse(body.toString('utf8')) as { model?: unknown }
      const model = typeof ab.model === 'string' ? ab.model : ''
      if (model.includes('/')) {
        aggregateHit = resolveAggregatePrefix(store.providers.filter((p) => p.tool === 'claude'), model)
        if (!aggregateHit) {
          stats[tool].errors++
          const aliases = store.providers
            .filter((p) => p.tool === 'claude')
            .map((p) => aggregateAliasOf(p))
            .filter((a): a is string => !!a)
          jsonError(res, 400, `未知的聚合前缀「${model.split('/')[0]}」。可用前缀：${aliases.join('、') || '（无——请先为供应商设置别名或英文）名称'}`)
          return
        }
      }
    } catch {
      /* 请求体不是 JSON：交给后续流程报错 */
    }
  }

  const chain: Provider[] = aggregateHit
    ? [
        aggregateHit.provider,
        ...store.providers.filter((p) => p.tool === tool && p.id !== aggregateHit!.provider.id)
      ].slice(0, MAX_ATTEMPTS)
    : baseChain
  const effectiveChain = applyBreaker(chain)

  if (chain.length === 0) {
    stats[tool].errors++
    jsonError(res, 502, `本机路由没有可用的 ${tool} 供应商：请先在应用内添加并选择供应商`)
    return
  }

  const attempts: string[] = []
  for (let i = 0; i < effectiveChain.length; i++) {
    const provider = effectiveChain[i]
    // ── OpenAI 协议供应商：走协议转换路径（v0.8.3） ──
    const openaiMode = tool === 'claude' && provider.protocol === 'openai'
    if (openaiMode) {
      const pathOnly = rest.split('?')[0]
      if (pathOnly === '/v1/messages/count_tokens') {
        // 本地粗估，不打上游
        let ab: Record<string, unknown> = {}
        try {
          ab = JSON.parse(body.toString('utf8')) as Record<string, unknown>
        } catch {
          /* 空体按 0 */
        }
        stats[tool].requests++
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ input_tokens: estimateAnthropicTokens(ab) }))
        return
      }
      if (pathOnly !== '/v1/messages') {
        jsonError(res, 404, `OpenAI 协议供应商只支持 /v1/messages 与 /v1/messages/count_tokens（收到 ${pathOnly}）`)
        return
      }
      let anthropicBody: Record<string, unknown>
      try {
        anthropicBody = JSON.parse(body.toString('utf8')) as Record<string, unknown>
      } catch {
        stats[tool].errors++
        jsonError(res, 400, '请求体不是合法 JSON')
        return
      }
      const oaBody = anthropicToOpenAI(anthropicBody, provider, aggregateHit?.model)
      const upstream = provider.baseUrl.replace(/\/+$/, '') + '/chat/completions'
      try {
        const ac = new AbortController()
        const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS)
        let r: Response
        try {
          r = await fetch(upstream, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.apiKey}` },
            body: JSON.stringify(oaBody),
            signal: ac.signal
          })
        } finally {
          clearTimeout(timer)
        }
        // 5xx/429 → 换下一家（响应体丢弃），并给熔断器记一次失败
        if ((r.status >= 500 || r.status === 429) && i < effectiveChain.length - 1) {
          attempts.push(`${provider.name}: HTTP ${r.status}`)
          recordFailure(provider)
          await r.arrayBuffer().catch(() => {})
          continue
        }
        recordSuccess(provider)
        stats[tool].requests++
        if (!r.ok) {
          const errText = await r.text().catch(() => '')
          res.writeHead(r.status, {
            'content-type': 'application/json',
            'x-ccsl-provider': encodeURIComponent(provider.name)
          })
          res.end(JSON.stringify(openAIErrorToAnthropic(r.status, errText)))
          return
        }
        if (oaBody.stream && r.body) {
          await pumpOpenAIToAnthropic(
            r.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>,
            res,
            provider.model || 'gpt-4o-mini'
          )
          return
        }
        const j = (await r.json().catch(() => null)) as Record<string, unknown> | null
        if (!j) {
          jsonError(res, 502, '上游响应不是合法 JSON')
          return
        }
        res.writeHead(200, {
          'content-type': 'application/json',
          'x-ccsl-provider': encodeURIComponent(provider.name)
        })
        res.end(JSON.stringify(openAIToAnthropicResponse(j, typeof anthropicBody.model === 'string' ? anthropicBody.model : '')))
        return
      } catch (e) {
        attempts.push(`${provider.name}: ${(e as Error).message}`)
        recordFailure(provider)
        continue
      }
    }
    // ── Anthropic 协议供应商：原样透传（聚合模式下重写 model 为剥离前缀后的名字） ──
    let upstreamBody: Uint8Array<ArrayBuffer> = new Uint8Array(body)
    if (aggregateHit) {
      try {
        const ab = JSON.parse(body.toString('utf8')) as Record<string, unknown>
        ab.model = aggregateHit.model
        upstreamBody = new Uint8Array(Buffer.from(JSON.stringify(ab), 'utf8'))
      } catch {
        /* 请求体不是 JSON：保持原样透传 */
      }
    }
    const upstream = provider.baseUrl.replace(/\/+$/, '') + rest
    try {
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS)
      let r: Response
      try {
        r = await fetch(upstream, {
          method: req.method,
          headers: buildUpstreamHeaders(tool, provider, req),
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : upstreamBody,
          signal: ac.signal
        })
      } finally {
        clearTimeout(timer)
      }

      // 5xx/429 → 换下一家（响应体丢弃），并给熔断器记一次失败
      if ((r.status >= 500 || r.status === 429) && i < effectiveChain.length - 1) {
        attempts.push(`${provider.name}: HTTP ${r.status}`)
        recordFailure(provider)
        await r.arrayBuffer().catch(() => {})
        continue
      }

      recordSuccess(provider)
      stats[tool].requests++
      const outHeaders: Record<string, string> = {}
      r.headers.forEach((v, k) => {
        if (k === 'content-length' || k === 'content-encoding' || k === 'transfer-encoding' || k === 'connection') return
        outHeaders[k] = v
      })
      outHeaders['x-ccsl-provider'] = encodeURIComponent(provider.name)
      res.writeHead(r.status, outHeaders)
      if (r.body) {
        await new Promise<void>((resolve) => {
          const stream = Readable.fromWeb(r.body as import('node:stream/web').ReadableStream)
          // 响应体阶段同样有超时：空闲 120s 无新数据就断开，不永久占用
          let idle = setTimeout(() => {
            stream.destroy()
            res.destroy()
            resolve()
          }, BODY_IDLE_TIMEOUT_MS)
          stream.on('data', () => idle.refresh())
          stream.on('error', () => {
            clearTimeout(idle)
            res.destroy()
            resolve()
          })
          stream.pipe(res)
          res.on('close', () => {
            clearTimeout(idle)
            resolve()
          })
        })
      } else {
        res.end()
      }
      return
    } catch (e) {
      // 连接失败/超时 → 下一家（记录原因便于诊断），并给熔断器记一次失败
      attempts.push(`${provider.name}: ${(e as Error).message}`)
      recordFailure(provider)
      continue
    }
  }

  stats[tool].errors++
  jsonError(res, 502, `所有候选上游都失败了（共试 ${effectiveChain.length} 家）：${attempts.join('；')}`)
}
