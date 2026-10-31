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

function normalizeParsed(parsed: Partial<StoreShape>): StoreShape {
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
}

function defaultsShape(): StoreShape {
  return normalizeParsed({})
}

export function loadStore(): StoreShape {
  let raw: string
  try {
    raw = fs.readFileSync(storeFile(), 'utf8')
  } catch {
    return defaultsShape()
  }
  try {
    return normalizeParsed(JSON.parse(raw) as Partial<StoreShape>)
  } catch {
    // 不是合法 JSON：要么是主密码密文，要么文件损坏
    if (masterEnabled()) {
      if (!masterKey) throw new Error('LOCKED')
      try {
        const buf = Buffer.from(raw, 'base64')
        if (!buf.subarray(0, MASTER_MAGIC.length).equals(MASTER_MAGIC)) throw new Error('bad magic')
        const iv = buf.subarray(MASTER_MAGIC.length, MASTER_MAGIC.length + 12)
        const tag = buf.subarray(MASTER_MAGIC.length + 12, MASTER_MAGIC.length + 28)
        const d = crypto.createDecipheriv('aes-256-gcm', masterKey, iv)
        d.setAuthTag(tag)
        const text = Buffer.concat([d.update(buf.subarray(MASTER_MAGIC.length + 28)), d.final()]).toString('utf8')
        return normalizeParsed(JSON.parse(text) as Partial<StoreShape>)
      } catch {
        throw new Error('供应商库解密失败：master.json 与库文件不匹配或已损坏')
      }
    }
    return defaultsShape()
  }
}

let writeChain: Promise<void> = Promise.resolve()

/**
 * 串行化写入，避免并发覆盖。
 * 注意：失败不能毒化队列——否则一次写盘失败后，后续所有保存都会被静默跳过。
 * 启用主密码后整文件加密（CCSLENC1 | iv | tag | 密文，base64 落盘）；锁定态拒绝写入。
 */
export function saveStore(store: StoreShape): Promise<void> {
  if (masterEnabled() && !masterKey) throw new Error('LOCKED')
  const content = JSON.stringify(store, null, 2)
  const payload = masterKey ? encryptContent(content) : content
  const next = writeChain.then(() => atomicWrite(storeFile(), payload))
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

// ─── 主密码加密（v0.8.5）：providers.json 整文件 AES-256-GCM 加密 ───
// master.json（明文小文件）存 {salt, verifier}；密钥只在本进程内存。
// 锁定态下 loadStore 抛 'LOCKED'，渲染层据此显示解锁屏；所有写操作同样被拦。

const MASTER_MAGIC = Buffer.from('CCSLENC1', 'ascii')
const MASTER_RE = /^[^\s]{8,200}$/

function masterFile(): string {
  return path.join(dataDir(), 'master.json')
}

function deriveKey(pass: string, salt: Buffer): Buffer {
  return crypto.scryptSync(pass, salt, 32, { N: 16384, r: 8, p: 1 })
}

function verifierOf(key: Buffer): string {
  return crypto.createHmac('sha256', key).update('ccsl-verify').digest('hex')
}

let masterKey: Buffer | null = null

export function masterEnabled(): boolean {
  return fs.existsSync(masterFile())
}

/** 主密码状态：enabled=已启用加密；unlocked=已解锁（可读写供应商库） */
export function masterState(): { enabled: boolean; unlocked: boolean } {
  const enabled = masterEnabled()
  return { enabled, unlocked: !enabled || masterKey !== null }
}

/** 解锁；口令错误返回 false（不区分文件缺失等异常，异常直接抛出） */
export function unlockMaster(pass: string): boolean {
  if (!masterEnabled()) throw new Error('未启用主密码加密')
  if (typeof pass !== 'string' || !MASTER_RE.test(pass)) return false
  const j = JSON.parse(fs.readFileSync(masterFile(), 'utf8')) as { salt?: string; verifier?: string }
  const key = deriveKey(pass, Buffer.from(String(j.salt), 'hex'))
  const expect = Buffer.from(String(j.verifier), 'hex')
  const actual = Buffer.from(verifierOf(key), 'hex')
  if (expect.length !== actual.length || !crypto.timingSafeEqual(expect, actual)) return false
  masterKey = key
  return true
}

/** 设置主密码（要求当前处于可读状态）：写入 master.json 并把现有库重加密 */
export async function setMasterPassword(pass: string): Promise<void> {
  if (typeof pass !== 'string' || !MASTER_RE.test(pass)) throw new Error('主密码须为 8-200 个字符且不含空格')
  if (masterEnabled() && masterKey === null) throw new Error('LOCKED')
  const salt = crypto.randomBytes(16)
  const key = deriveKey(pass, salt)
  fs.writeFileSync(
    masterFile(),
    JSON.stringify({ v: 1, salt: salt.toString('hex'), verifier: verifierOf(key) }, null, 2),
    'utf8'
  )
  masterKey = key
  // 把现有库按新密钥重写（当前必须可读，否则上面已抛 LOCKED）
  await saveStore(loadStore())
}

/** 解除主密码（校验口令后恢复明文存储） */
export async function clearMasterPassword(pass: string): Promise<void> {
  if (!masterEnabled()) throw new Error('未启用主密码加密')
  if (masterKey === null) throw new Error('LOCKED')
  const j = JSON.parse(fs.readFileSync(masterFile(), 'utf8')) as { salt?: string; verifier?: string }
  const key = deriveKey(pass, Buffer.from(String(j.salt), 'hex'))
  const expect = Buffer.from(String(j.verifier), 'hex')
  const actual = Buffer.from(verifierOf(key), 'hex')
  if (expect.length !== actual.length || !crypto.timingSafeEqual(expect, actual)) {
    throw new Error('主密码错误')
  }
  const store = loadStore()
  fs.rmSync(masterFile(), { force: true })
  masterKey = null
  await saveStore(store)
}

/** 仅供自测：清空内存密钥模拟锁定态 */
export function lockForTest(): void {
  masterKey = null
}

function encryptContent(content: string): string {
  if (!masterKey) throw new Error('LOCKED')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv)
  const enc = Buffer.concat([cipher.update(content, 'utf8'), cipher.final()])
  return Buffer.concat([MASTER_MAGIC, iv, cipher.getAuthTag(), enc]).toString('base64')
}
