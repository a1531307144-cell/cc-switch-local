import http from 'node:http'
import { Readable } from 'node:stream'
import { loadStore } from './store'
import { resolveAggregatePrefix, aggregateAliasOf } from '../shared/aggregate'
import { anthropicToOpenAI, anthropicToResponses, estimateAnthropicTokens, openAIErrorToAnthropic, openAIToAnthropicResponse, pumpOpenAIToAnthropic, pumpResponsesToAnthropic, responsesToAnthropic } from './convert'
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

/** Claude Code 的本地 1M 能力标记（「 [1m]」后缀，大小写不敏感），上游不认识，转发前剥离 */
const ONE_M_SUFFIX_RE = /\s*\[1m\]\s*$/i

function stripOneM(model: string): string {
  return model.replace(ONE_M_SUFFIX_RE, '').trimEnd()
}

/**
 * 按供应商的模型映射改写请求模型名（v0.8.18，对齐原版 cc-switch 的档位规则）：
 * fable 未单独配置时归入 opus 档（与 Claude Code 官方降级方向一致）；
 * 命中子代理精确匹配时保持原样；绝不改写为默认模型——默认模型由 env（ANTHROPIC_MODEL）
 * 负责，这里再兜底会破坏聚合模式下的多模型寻址。
 */
function mappedModelOf(rawModel: string, provider: Provider): string {
  const bare = stripOneM(rawModel)
  const mm = provider.modelMapping
  if (!mm) return bare
  const lower = bare.toLowerCase()
  const sub = mm.subagent?.model ? stripOneM(mm.subagent.model) : ''
  if (sub && bare === sub) return bare
  if (lower.includes('fable')) {
    const target = mm.fable?.model || mm.opus?.model
    if (target) return stripOneM(target)
  }
  if (lower.includes('haiku') && mm.haiku?.model) return stripOneM(mm.haiku.model)
  if (lower.includes('opus') && mm.opus?.model) return stripOneM(mm.opus.model)
  if (lower.includes('sonnet') && mm.sonnet?.model) return stripOneM(mm.sonnet.model)
  return bare
}

/** 请求体改写是否必要（避免无映射时白白 parse/stringify） */
function needsBodyRewrite(provider: Provider, aggregateHit: { model: string } | null): boolean {
  return !!aggregateHit || !!provider.modelMapping || !!provider.bodyOverrides
}

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
  // 自定义 User-Agent 与请求头覆盖（v0.8.18；仅路由模式经过这里）
  if (provider.customUserAgent) headers['user-agent'] = provider.customUserAgent
  const ho = provider.headerOverrides
  if (ho && typeof ho === 'object' && !Array.isArray(ho)) {
    for (const [k, v] of Object.entries(ho)) {
      if (typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(k)) headers[k.toLowerCase()] = v
    }
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
      // 模型映射与 1M 标记剥离（v0.8.18）：聚合前缀优先，其次按档位改写
      if (typeof anthropicBody.model === 'string' && !aggregateHit) {
        const rewritten = mappedModelOf(anthropicBody.model, provider)
        if (rewritten !== anthropicBody.model) anthropicBody.model = rewritten
      }
      const oaBody = anthropicToOpenAI(anthropicBody, provider, aggregateHit?.model)
      // Responses 报文格式（v0.8.10）：wireApi='responses' 的上游打 /responses 端点
      const useResponses = provider.wireApi === 'responses'
      const upstream = provider.baseUrl.replace(/\/+$/, '') + (useResponses ? '/responses' : '/chat/completions')
      const upstreamBody = (
        useResponses ? anthropicToResponses(anthropicBody, aggregateHit?.model) : oaBody
      ) as unknown as Record<string, unknown>
      // Body 覆盖（v0.8.18）：浅合并顶层键，仅本机路由模式生效
      const bo = provider.bodyOverrides
      if (bo && typeof bo === 'object' && !Array.isArray(bo) && Object.keys(bo).length) Object.assign(upstreamBody, bo)
      try {
        const ac = new AbortController()
        const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS)
        let r: Response
        try {
          r = await fetch(upstream, {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${provider.apiKey}` },
            body: JSON.stringify(upstreamBody),
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
        if (upstreamBody.stream && r.body) {
          if (useResponses) {
            await pumpResponsesToAnthropic(
              r.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>,
              res,
              provider.model || 'gpt-4o-mini'
            )
          } else {
            await pumpOpenAIToAnthropic(
              r.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>,
              res,
              provider.model || 'gpt-4o-mini'
            )
          }
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
        const translated = useResponses
          ? responsesToAnthropic(j, typeof anthropicBody.model === 'string' ? anthropicBody.model : '')
          : openAIToAnthropicResponse(j, typeof anthropicBody.model === 'string' ? anthropicBody.model : '')
        res.end(JSON.stringify(translated))
        return
      } catch (e) {
        attempts.push(`${provider.name}: ${(e as Error).message}`)
        recordFailure(provider)
        continue
      }
    }
    // ── Anthropic 协议供应商：原样透传（聚合前缀剥离 / 模型映射 / 1M 标记剥离 / Body 覆盖在此改写） ──
    let upstreamBody: Uint8Array<ArrayBuffer> = new Uint8Array(body)
    if (tool === 'claude' && needsBodyRewrite(provider, aggregateHit)) {
      try {
        const ab = JSON.parse(body.toString('utf8')) as Record<string, unknown>
        if (typeof ab.model === 'string') {
          const rewritten = aggregateHit ? aggregateHit.model : mappedModelOf(ab.model, provider)
          if (rewritten !== ab.model) ab.model = rewritten
        }
        const bo = provider.bodyOverrides
        if (bo && typeof bo === 'object' && !Array.isArray(bo) && Object.keys(bo).length) Object.assign(ab, bo)
        upstreamBody = new Uint8Array(Buffer.from(JSON.stringify(ab), 'utf8'))
      } catch {
        /* 请求体不是 JSON：保持原样透传 */
      }
    }
    // 完整 URL（v0.8.18）：勾选后请求原样打到 baseUrl，不再拼接 /v1/* 路径
    const upstream = provider.fullUrl ? provider.baseUrl : provider.baseUrl.replace(/\/+$/, '') + rest
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
