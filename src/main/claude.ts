import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { atomicWrite } from './store'
import { routerPort } from './router'
import type { BackupInfo, Provider, SwitchResult, ToolStatus } from '../shared/types'

const MAX_BACKUPS = 10
const BACKUP_PREFIX = 'settings.json.bak-'

/** 自测时用 CCS_HOME_OVERRIDE 隔离，绝不碰真实用户目录 */
export function homeDir(): string {
  return process.env.CCS_HOME_OVERRIDE || os.homedir()
}

export function claudeDir(): string {
  return path.join(homeDir(), '.claude')
}

export function claudeSettingsPath(): string {
  return path.join(claudeDir(), 'settings.json')
}

export function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

async function readSettings(): Promise<Record<string, unknown>> {
  const p = claudeSettingsPath()
  try {
    let raw = await fsp.readFile(p, 'utf8')
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1)
    return JSON.parse(raw) as Record<string, unknown>
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err?.code === 'ENOENT') return {}
    throw new Error(`读取 settings.json 失败：${err?.message ?? e}（已中止，不会写入）`)
  }
}

/** 主进程侧输入校验：IPC 是安全边界，不信任渲染层 */
function assertValidProvider(provider: Provider): void {
  if (!/^https?:\/\//i.test(provider.baseUrl)) {
    throw new Error(`非法的 Base URL（仅允许 http/https）：${provider.baseUrl}`)
  }
  if (!provider.apiKey) throw new Error('API Key 不能为空')
}

async function backupSettings(): Promise<string | null> {
  const p = claudeSettingsPath()
  if (!fs.existsSync(p)) return null
  let bak = path.join(claudeDir(), `${BACKUP_PREFIX}${stamp()}`)
  let i = 1
  while (fs.existsSync(bak)) {
    bak = path.join(claudeDir(), `${BACKUP_PREFIX}${stamp()}-${i}`)
    i += 1
  }
  await fsp.copyFile(p, bak)
  await pruneBackups()
  return bak
}

async function pruneBackups(): Promise<void> {
  const entries = await fsp.readdir(claudeDir())
  const baks = entries.filter((f) => f.startsWith(BACKUP_PREFIX)).sort()
  for (const f of baks.slice(0, Math.max(0, baks.length - MAX_BACKUPS))) {
    await fsp.rm(path.join(claudeDir(), f), { force: true })
  }
}

/**
 * provider 为 null 表示「恢复官方登录」：清掉本工具接管的 env 键。
 * viaRouter=true 时配置指向本机路由（真实 Key 不落盘到工具配置，只留占位符）。
 */
export async function switchClaude(provider: Provider | null, viaRouter = false): Promise<SwitchResult> {
  if (provider) assertValidProvider(provider)
  const data = await readSettings()
  const backup = await backupSettings()
  const env = { ...((data.env as Record<string, unknown>) ?? {}) }
  if (provider) {
    if (viaRouter) {
      env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${routerPort()}/claude`
      env.ANTHROPIC_AUTH_TOKEN = 'ccsl-local-router'
      delete env.ANTHROPIC_API_KEY
    } else {
      env.ANTHROPIC_BASE_URL = provider.baseUrl
      if (provider.keyType === 'api_key') {
        env.ANTHROPIC_API_KEY = provider.apiKey
        delete env.ANTHROPIC_AUTH_TOKEN
      } else {
        env.ANTHROPIC_AUTH_TOKEN = provider.apiKey
        delete env.ANTHROPIC_API_KEY
      }
    }
  } else {
    delete env.ANTHROPIC_BASE_URL
    delete env.ANTHROPIC_AUTH_TOKEN
    delete env.ANTHROPIC_API_KEY
  }
  await atomicWrite(claudeSettingsPath(), JSON.stringify({ ...data, env }, null, 2))
  return { ok: true, files: [claudeSettingsPath()], backup: backup ?? undefined }
}

export async function importCurrentClaude(): Promise<Provider | null> {
  const data = await readSettings()
  const env = (data.env as Record<string, unknown>) ?? {}
  const baseUrl = env.ANTHROPIC_BASE_URL
  const authToken = env.ANTHROPIC_AUTH_TOKEN
  const apiKey = env.ANTHROPIC_API_KEY
  if (typeof baseUrl !== 'string' && typeof authToken !== 'string' && typeof apiKey !== 'string') {
    return null
  }
  return {
    id: '',
    tool: 'claude',
    name: '导入的当前配置',
    baseUrl: typeof baseUrl === 'string' ? baseUrl : '',
    apiKey: typeof authToken === 'string' ? authToken : typeof apiKey === 'string' ? apiKey : '',
    keyType: typeof apiKey === 'string' && typeof authToken !== 'string' ? 'api_key' : 'auth_token',
    createdAt: 0,
    updatedAt: 0
  }
}

export async function status(): Promise<ToolStatus> {
  const p = claudeSettingsPath()
  try {
    const data = JSON.parse(await fsp.readFile(p, 'utf8')) as Record<string, unknown>
    const env = (data.env as Record<string, unknown>) ?? {}
    const key = (env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY) as string | undefined
    return {
      configPath: p,
      exists: true,
      currentBaseUrl: typeof env.ANTHROPIC_BASE_URL === 'string' ? env.ANTHROPIC_BASE_URL : undefined,
      currentKeyMasked: typeof key === 'string' && key ? maskKey(key) : undefined
    }
  } catch {
    return { configPath: p, exists: false }
  }
}

export function maskKey(key: string): string {
  if (key.length <= 8) return '****'
  return `${key.slice(0, 4)}****${key.slice(-4)}`
}

export async function listBackups(): Promise<BackupInfo[]> {
  try {
    const entries = await fsp.readdir(claudeDir())
    const infos: BackupInfo[] = []
    for (const f of entries.filter((e) => e.startsWith(BACKUP_PREFIX)).sort().reverse()) {
      const full = path.join(claudeDir(), f)
      const st = await fsp.stat(full)
      infos.push({ file: f, created: st.mtimeMs, size: st.size })
    }
    return infos
  } catch {
    return []
  }
}

/** 只接受本工具自己生成的备份文件名，拒绝任意路径 */
export async function restoreBackup(file: string): Promise<SwitchResult> {
  if (!file.startsWith(BACKUP_PREFIX) || file.includes('/') || file.includes('\\') || file.includes('..')) {
    throw new Error('非法的备份文件名')
  }
  const src = path.join(claudeDir(), file)
  // 先把源内容读进内存：恢复前的新备份会触发 prune（保留最近 10 份），
  // 源文件恰好是最旧一份时会先被删掉（2026-10-30 自测抓到）
  const content = await fsp.readFile(src)
  const backup = await backupSettings()
  await fsp.writeFile(claudeSettingsPath(), content)
  return { ok: true, files: [claudeSettingsPath()], backup: backup ?? undefined }
}
