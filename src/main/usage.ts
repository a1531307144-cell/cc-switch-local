import readline from 'node:readline'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { homeDir } from './claude'
import { dataDir, atomicWrite } from './store'
import type { ToolId, UsageDay, UsageEntry, UsageStats } from '../shared/types'

/**
 * 用量统计（对齐原版 cc-switch 的「不开路由也能统计」）：
 * 扫描各工具的本地会话日志，按天/模型聚合请求数、Token、缓存与估算花费。
 * 会话日志格式可能随工具版本变化——所有解析都容错，坏行跳过，绝不抛出。
 *
 * 成本在扫描时按当时的单价表计算；单价表变更时须递增 CACHE_VERSION 强制全量重扫。
 */

// ─── 模型单价表（USD / 1M tokens）。会话日志不含价格，只能按模型名估算 ───
// 前缀匹配取第一个命中；未命中用兜底价。缓存计价：Anthropic 写 1.25×/读 0.1×，OpenAI cached ≈0.1×。
const PRICING: { prefix: string; input: number; output: number }[] = [
  { prefix: 'claude-opus', input: 15, output: 75 },
  { prefix: 'claude-sonnet', input: 3, output: 15 },
  { prefix: 'claude-haiku', input: 1, output: 5 },
  { prefix: 'gpt-5', input: 1.25, output: 10 },
  { prefix: 'gpt-4.1', input: 2, output: 8 },
  { prefix: 'o3', input: 2, output: 8 },
  { prefix: 'o4-mini', input: 1.1, output: 4.4 },
  { prefix: 'deepseek', input: 0.27, output: 1.1 },
  { prefix: 'glm-', input: 0.6, output: 2.2 },
  { prefix: 'kimi-k', input: 2.5, output: 5 },
  { prefix: 'qwen3-coder', input: 1.5, output: 6 }
]
const FALLBACK_PRICE = { input: 3, output: 15 }

function priceOf(model: string): { input: number; output: number } {
  const m = model.toLowerCase()
  return PRICING.find((p) => m.startsWith(p.prefix)) ?? FALLBACK_PRICE
}

/** 估算单条请求成本（USD）。tool 决定缓存计价口径 */
export function estimateCost(tool: ToolId, model: string, input: number, output: number, cacheRead: number, cacheWrite: number): number {
  const p = priceOf(model)
  if (tool === 'claude') {
    // Anthropic：input/cache 互斥计价；cache 写 1.25×，读 0.1×
    return (input * p.input + cacheWrite * p.input * 1.25 + cacheRead * p.input * 0.1 + output * p.output) / 1e6
  }
  // OpenAI 口径：input 已包含 cached 部分，cached 按约 0.1× 计
  return ((input - cacheRead) * p.input + cacheRead * p.input * 0.1 + output * p.output) / 1e6
}

function localDate(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

// ─── 每文件聚合（缓存持久化的最小单元；cost 已按扫描时单价算好） ───

interface FileAgg {
  days: Record<string, { requests: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }>
  models: Record<string, { requests: number; input: number; output: number; cost: number }>
  recent: UsageEntry[]
}

interface CacheEntry {
  mtime: number
  size: number
  agg: FileAgg
}

interface CacheShape {
  version: 2
  files: Record<string, CacheEntry>
}

const CACHE_VERSION = 2
const RECENT_PER_FILE = 80
const RECENT_TOTAL = 500

function emptyAgg(): FileAgg {
  return { days: {}, models: {}, recent: [] }
}

function addEntry(agg: FileAgg, e: UsageEntry): void {
  const d = localDate(e.ts)
  const day = (agg.days[d] ??= { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 })
  day.requests++
  day.input += e.input
  day.output += e.output
  day.cacheRead += e.cacheRead
  day.cacheWrite += e.cacheWrite
  day.cost = round4(day.cost + e.cost)
  const m = (agg.models[e.model] ??= { requests: 0, input: 0, output: 0, cost: 0 })
  m.requests++
  m.input += e.input
  m.output += e.output
  m.cost = round4(m.cost + e.cost)
  agg.recent.push(e)
  if (agg.recent.length > RECENT_PER_FILE) agg.recent.splice(0, agg.recent.length - RECENT_PER_FILE)
}

async function statMtime(file: string): Promise<number> {
  try {
    return (await fsp.stat(file)).mtimeMs
  } catch {
    return Date.now()
  }
}

// ─── Claude Code：~/.claude/projects/<project>/<sessionId>.jsonl ───
// assistant 行带 message.usage；同一 message.id 可能重复落盘（resume/重写），按 id 去重。

async function scanClaudeFile(file: string): Promise<FileAgg> {
  const agg = emptyAgg()
  const seen = new Set<string>()
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line || line.length > 2_000_000) continue
    let j: Record<string, unknown>
    try {
      j = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    if (j.type !== 'assistant') continue
    const msg = j.message as Record<string, unknown> | undefined
    if (!msg) continue
    const id = typeof msg.id === 'string' ? msg.id : ''
    if (id && seen.has(id)) continue
    const usage = msg.usage as Record<string, unknown> | undefined
    if (!usage) continue
    const input = Number(usage.input_tokens ?? 0)
    const output = Number(usage.output_tokens ?? 0)
    const cacheRead = Number(usage.cache_read_input_tokens ?? 0)
    const cacheWrite = Number(usage.cache_creation_input_tokens ?? 0)
    if (!Number.isFinite(input) || !Number.isFinite(output)) continue
    const model = typeof msg.model === 'string' ? msg.model : 'unknown'
    const ts = Date.parse(typeof j.timestamp === 'string' ? j.timestamp : '') || (await statMtime(file))
    if (id) seen.add(id)
    addEntry(agg, {
      ts,
      tool: 'claude',
      model,
      input,
      output,
      cacheRead: Number.isFinite(cacheRead) ? cacheRead : 0,
      cacheWrite: Number.isFinite(cacheWrite) ? cacheWrite : 0,
      cost: round4(estimateCost('claude', model, input, output, Number.isFinite(cacheRead) ? cacheRead : 0, Number.isFinite(cacheWrite) ? cacheWrite : 0))
    })
  }
  return agg
}

// ─── Codex：~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl ───
// token_count 事件的 total_token_usage 是会话累计值：整个会话取最后一次累计值记 1 条聚合条目，
// 请求次数 = 累计值发生变化的次数；模型名取最近一次 turn_context。

interface CodexTotals {
  input: number
  cached: number
  output: number
}

function readCodexTotals(t: unknown): CodexTotals | null {
  if (!t || typeof t !== 'object') return null
  const o = t as Record<string, unknown>
  const input = Number(o.input_tokens)
  const cached = Number(o.cached_input_tokens ?? 0)
  const output = Number(o.output_tokens)
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null
  return { input, cached: Number.isFinite(cached) ? cached : 0, output }
}

async function scanCodexFile(file: string): Promise<FileAgg> {
  const agg = emptyAgg()
  let model = 'unknown'
  let last: CodexTotals | null = null
  let lastTotalKey = ''
  let requests = 0
  let firstTs = 0
  let lastTs = 0
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line || line.length > 2_000_000) continue
    let j: Record<string, unknown>
    try {
      j = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const ts = Date.parse(typeof j.timestamp === 'string' ? j.timestamp : '')
    if (Number.isFinite(ts)) {
      if (!firstTs) firstTs = ts
      lastTs = ts
    }
    if (j.type === 'turn_context') {
      const p = j.payload as Record<string, unknown> | undefined
      if (p && typeof p.model === 'string') model = p.model
      continue
    }
    if (j.type !== 'event_msg') continue
    const p = j.payload as Record<string, unknown> | undefined
    if (!p || p.type !== 'token_count') continue
    const info = p.info as Record<string, unknown> | undefined
    const totals = readCodexTotals(info?.total_token_usage)
    if (!totals) continue
    const key = `${totals.input}/${totals.cached}/${totals.output}`
    if (key !== lastTotalKey) {
      requests++
      lastTotalKey = key
    }
    last = totals
  }
  if (last && requests > 0) {
    const ts = lastTs || firstTs || (await statMtime(file))
    const cacheRead = last.cached
    addEntry(agg, {
      ts,
      tool: 'codex',
      model,
      input: last.input,
      output: last.output,
      cacheRead,
      cacheWrite: 0,
      cost: round4(estimateCost('codex', model, last.input, last.output, cacheRead, 0))
    })
    // addEntry 已计 1 次请求，这里补上其余的请求次数
    const d = localDate(ts)
    agg.days[d].requests += requests - 1
    if (agg.models[model]) agg.models[model].requests += requests - 1
  }
  return agg
}

// ─── 文件发现与增量缓存 ───

async function listJsonlFiles(root: string, maxDepth: number): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > maxDepth) return
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full, depth + 1)
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full)
    }
  }
  await walk(root, 0)
  return out
}

const cacheFile = (): string => path.join(dataDir(), 'usage-cache.json')

async function loadCache(): Promise<CacheShape> {
  try {
    const j = JSON.parse(await fsp.readFile(cacheFile(), 'utf8')) as CacheShape
    if (j?.version === CACHE_VERSION && j.files && typeof j.files === 'object') return j
  } catch {
    /* 无缓存或损坏 */
  }
  return { version: CACHE_VERSION, files: {} }
}

export async function usageStats(): Promise<UsageStats> {
  const t0 = Date.now()
  const claudeRoot = path.join(homeDir(), '.claude', 'projects')
  const codexRoot = path.join(homeDir(), '.codex', 'sessions')
  const [claudeFiles, codexFiles] = await Promise.all([listJsonlFiles(claudeRoot, 3), listJsonlFiles(codexRoot, 5)])

  const cache = await loadCache()
  const nextCache: CacheShape = { version: CACHE_VERSION, files: {} }
  const aggs: { tool: ToolId; agg: FileAgg }[] = []
  let dirty = false

  for (const file of claudeFiles) {
    const done = await scanOne(file, cache, nextCache, scanClaudeFile)
    if (done) {
      aggs.push({ tool: 'claude', agg: done.agg })
      if (done.fresh) dirty = true
    }
  }
  for (const file of codexFiles) {
    const done = await scanOne(file, cache, nextCache, scanCodexFile)
    if (done) {
      aggs.push({ tool: 'codex', agg: done.agg })
      if (done.fresh) dirty = true
    }
  }

  if (dirty) atomicWrite(cacheFile(), JSON.stringify(nextCache)).catch(() => {})

  return aggregate(aggs, claudeFiles.length + codexFiles.length, t0)
}

/** 单文件扫描：命中缓存直接复用，否则全量解析。失败返回 null（不影响整体） */
async function scanOne(
  file: string,
  cache: CacheShape,
  nextCache: CacheShape,
  scan: (f: string) => Promise<FileAgg>
): Promise<{ agg: FileAgg; fresh: boolean } | null> {
  let st: fs.Stats
  try {
    st = await fsp.stat(file)
  } catch {
    return null
  }
  const hit = cache.files[file]
  if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) {
    nextCache.files[file] = hit
    return { agg: hit.agg, fresh: false }
  }
  try {
    const agg = await scan(file)
    nextCache.files[file] = { mtime: st.mtimeMs, size: st.size, agg }
    return { agg, fresh: true }
  } catch {
    return null
  }
}

function aggregate(aggs: { tool: ToolId; agg: FileAgg }[], scannedFiles: number, t0: number): UsageStats {
  const totals = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
  const days = new Map<string, UsageDay>()
  const models = new Map<string, { model: string; tool: ToolId; requests: number; input: number; output: number; cost: number }>()
  const recent: UsageEntry[] = []

  for (const { tool, agg } of aggs) {
    for (const [date, d] of Object.entries(agg.days)) {
      let day = days.get(date)
      if (!day) {
        day = { date, requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
        days.set(date, day)
      }
      day.requests += d.requests
      day.input += d.input
      day.output += d.output
      day.cacheRead += d.cacheRead
      day.cacheWrite += d.cacheWrite
      day.cost = round4(day.cost + d.cost)
    }
    for (const [model, m] of Object.entries(agg.models)) {
      const k = `${tool}|${model}`
      let slot = models.get(k)
      if (!slot) {
        slot = { model, tool, requests: 0, input: 0, output: 0, cost: 0 }
        models.set(k, slot)
      }
      slot.requests += m.requests
      slot.input += m.input
      slot.output += m.output
      slot.cost = round4(slot.cost + m.cost)
    }
    for (const e of agg.recent) recent.push(e)
    totals.requests += Object.values(agg.days).reduce((s, d) => s + d.requests, 0)
    totals.input += Object.values(agg.days).reduce((s, d) => s + d.input, 0)
    totals.output += Object.values(agg.days).reduce((s, d) => s + d.output, 0)
    totals.cacheRead += Object.values(agg.days).reduce((s, d) => s + d.cacheRead, 0)
    totals.cacheWrite += Object.values(agg.days).reduce((s, d) => s + d.cacheWrite, 0)
    totals.cost = round4(totals.cost + Object.values(agg.days).reduce((s, d) => s + d.cost, 0))
  }

  recent.sort((a, b) => b.ts - a.ts)
  return {
    totals,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
    models: [...models.values()].sort((a, b) => b.cost - a.cost || b.input + b.output - (a.input + a.output)),
    recent: recent.slice(0, RECENT_TOTAL),
    scannedFiles,
    scanMs: Date.now() - t0,
    lastScanAt: Date.now()
  }
}

/** 清空缓存（调试/格式变更时用） */
export async function clearUsageCache(): Promise<void> {
  await fsp.rm(cacheFile(), { force: true })
}
