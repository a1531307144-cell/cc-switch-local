import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'
import type { AppSettings, Provider, StoreShape, ToolId } from '../shared/types'

const TOOL_IDS: ToolId[] = ['claude', 'codex']
const KEY_TYPES = ['auth_token', 'api_key']
const WIRE_APIS = ['responses', 'chat']
const PROTOCOLS = ['anthropic', 'openai']
const ALIAS_RE = /^[A-Za-z0-9_-]{1,40}$/

/**
 * 逐条校验一条供应商记录（2026-10-31 审计 #8）：providers.json 可能被手改/半途损坏，
 * 坏记录在这里被丢弃/修复，而不是带进运行时。加密备份导入也走这条校验。
 * id 合法则保留（保持库内身份稳定），缺失或非法则生成新 id。
 */
export function sanitizeProviderRecord(raw: unknown): Provider | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  if (typeof p.tool !== 'string' || !TOOL_IDS.includes(p.tool as ToolId)) return null
  if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 200) return null
  if (typeof p.baseUrl !== 'string' || !/^https?:\/\//i.test(p.baseUrl) || p.baseUrl.length > 2000) return null
  if (typeof p.apiKey !== 'string' || !p.apiKey || p.apiKey.length > 4000) return null
  if (p.keyType !== undefined && !KEY_TYPES.includes(p.keyType as string)) return null
  if (p.wireApi !== undefined && !WIRE_APIS.includes(p.wireApi as string)) return null
  if (p.protocol !== undefined && !PROTOCOLS.includes(p.protocol as string)) return null
  if (p.alias !== undefined && (typeof p.alias !== 'string' || (p.alias !== '' && !ALIAS_RE.test(p.alias)))) return null
  if (p.model !== undefined && (typeof p.model !== 'string' || p.model.length > 200)) return null
  if (p.notes !== undefined && (typeof p.notes !== 'string' || p.notes.length > 2000)) return null
  const now = Date.now()
  return {
    id: typeof p.id === 'string' && p.id && p.id.length <= 64 ? p.id : crypto.randomUUID(),
    tool: p.tool as ToolId,
    name: p.name.trim(),
    baseUrl: p.baseUrl,
    apiKey: p.apiKey,
    keyType: p.keyType === 'api_key' ? 'api_key' : 'auth_token',
    protocol: p.protocol === 'openai' ? 'openai' : p.protocol === 'anthropic' ? 'anthropic' : undefined,
    alias: typeof p.alias === 'string' && p.alias ? p.alias : undefined,
    model: typeof p.model === 'string' && p.model ? p.model : undefined,
    wireApi: p.wireApi === 'chat' ? 'chat' : p.wireApi === 'responses' ? 'responses' : undefined,
    notes: typeof p.notes === 'string' && p.notes ? p.notes : undefined,
    createdAt: typeof p.createdAt === 'number' && Number.isFinite(p.createdAt) ? p.createdAt : now,
    updatedAt: typeof p.updatedAt === 'number' && Number.isFinite(p.updatedAt) ? p.updatedAt : now
  }
}

const DEFAULT_SETTINGS: AppSettings = {
  autoUpdate: true,
  autoStart: false,
  theme: 'system',
  language: 'zh',
  router: { claude: false, codex: false }
}

/**
 * 数据目录解析顺序：
 *   1. CCS_DATA_DIR 环境变量（自测/隔离用）
 *   2. 未打包（npm run dev / 直接跑 electron .）→ userData + "-dev"：
 *      开发环境与用户已安装应用的数据【结构性隔离】，开发调试永远碰不到真实供应商数据（含 API Key）
 *   3. 已打包 → 正常 userData
 */
export function dataDir(): string {
  if (process.env.CCS_DATA_DIR) return process.env.CCS_DATA_DIR
  const base = app.getPath('userData')
  return app.isPackaged ? base : `${base}-dev`
}

export function storeFile(): string {
  return path.join(dataDir(), 'providers.json')
}

export function loadStore(): StoreShape {
  try {
    const raw = fs.readFileSync(storeFile(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoreShape>
    return {
      version: 1,
      current: {
        claude: parsed.current?.claude ?? null,
        codex: parsed.current?.codex ?? null
      },
      providers: Array.isArray(parsed.providers)
        ? parsed.providers
            .map(sanitizeProviderRecord)
            .filter((p): p is Provider => p !== null)
        : [],
      settings: {
        ...DEFAULT_SETTINGS,
        ...(parsed.settings ?? {}),
        language: parsed.settings?.language === 'en' ? 'en' : 'zh',
        router: {
          claude: parsed.settings?.router?.claude ?? DEFAULT_SETTINGS.router!.claude,
          codex: parsed.settings?.router?.codex ?? DEFAULT_SETTINGS.router!.codex,
          ...(typeof parsed.settings?.router?.port === 'number' ? { port: parsed.settings.router.port } : {}),
          ...(parsed.settings?.router?.aggregate !== undefined ? { aggregate: parsed.settings.router.aggregate === true } : {})
        }
      }
    }
  } catch {
    return {
      version: 1,
      current: { claude: null, codex: null },
      providers: [],
      settings: { ...DEFAULT_SETTINGS }
    }
  }
}

let writeChain: Promise<void> = Promise.resolve()

/**
 * 串行化写入，避免并发覆盖。
 * 注意：失败不能毒化队列——否则一次写盘失败后，后续所有保存都会被静默跳过。
 */
export function saveStore(store: StoreShape): Promise<void> {
  const next = writeChain.then(() => atomicWrite(storeFile(), JSON.stringify(store, null, 2)))
  writeChain = next.catch(() => {})
  return next
}

export async function atomicWrite(file: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  try {
    await fsp.writeFile(tmp, content, 'utf8')
    await fsp.rename(tmp, file)
  } catch (e) {
    await fsp.rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

export function newId(): string {
  return crypto.randomUUID()
}
