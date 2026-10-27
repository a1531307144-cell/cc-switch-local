import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import TOML from '@iarna/toml'
import { atomicWrite } from './store'
import { homeDir, maskKey, stamp } from './claude'
import type { BackupInfo, Provider, SwitchResult, ToolStatus } from '../shared/types'

const SECTION = 'ccsl'
const MAX_BACKUPS = 10

export function codexDir(): string {
  return path.join(homeDir(), '.codex')
}

export function codexConfigPath(): string {
  return path.join(codexDir(), 'config.toml')
}

export function codexAuthPath(): string {
  return path.join(codexDir(), 'auth.json')
}

async function backupFile(dir: string, name: string): Promise<string | null> {
  const full = path.join(dir, name)
  if (!fs.existsSync(full)) return null
  let bak = path.join(dir, `${name}.bak-${stamp()}`)
  let i = 1
  while (fs.existsSync(bak)) {
    bak = path.join(dir, `${name}.bak-${stamp()}-${i}`)
    i += 1
  }
  await fsp.copyFile(full, bak)
  const entries = await fsp.readdir(dir)
  const prefix = `${name}.bak-`
  const baks = entries.filter((f) => f.startsWith(prefix)).sort()
  for (const f of baks.slice(0, Math.max(0, baks.length - MAX_BACKUPS))) {
    await fsp.rm(path.join(dir, f), { force: true })
  }
  return bak
}

/**
 * provider 为 null 表示「恢复官方配置」：移除我们写入的 model_provider 段。
 * 注意：TOML 解析-重写会丢失注释，写入前自动备份。
 */
export async function switchCodex(provider: Provider | null): Promise<SwitchResult> {
  await fsp.mkdir(codexDir(), { recursive: true })
  const backups: string[] = []
  for (const name of ['config.toml', 'auth.json']) {
    const bak = await backupFile(codexDir(), name)
    if (bak) backups.push(bak)
  }

  let cfg: Record<string, unknown> = {}
  try {
    cfg = TOML.parse(await fsp.readFile(codexConfigPath(), 'utf8')) as Record<string, unknown>
  } catch (e) {
    if (fs.existsSync(codexConfigPath())) {
      throw new Error(`config.toml 解析失败：${(e as Error).message}（已中止，不会写入）`)
    }
  }

  if (provider) {
    cfg.model_provider = SECTION
    if (provider.model) cfg.model = provider.model
    const mps = { ...((cfg.model_providers as Record<string, unknown>) ?? {}) }
    mps[SECTION] = {
      name: provider.name,
      base_url: provider.baseUrl,
      wire_api: provider.wireApi ?? 'responses',
      requires_openai_auth: true
    }
    cfg.model_providers = mps
  } else {
    delete cfg.model_provider
    const mps = { ...((cfg.model_providers as Record<string, unknown>) ?? {}) }
    delete mps[SECTION]
    if (Object.keys(mps).length) cfg.model_providers = mps
    else delete cfg.model_providers
  }
  await atomicWrite(codexConfigPath(), TOML.stringify(cfg as TOML.JsonMap))

  const files = [codexConfigPath()]
  if (provider) {
    let auth: Record<string, unknown> = {}
    try {
      auth = JSON.parse(await fsp.readFile(codexAuthPath(), 'utf8')) as Record<string, unknown>
    } catch {
      auth = {}
    }
    auth.OPENAI_API_KEY = provider.apiKey
    await atomicWrite(codexAuthPath(), JSON.stringify(auth, null, 2))
    files.push(codexAuthPath())
  }
  return { ok: true, files, backup: backups[0] }
}

export async function importCurrentCodex(): Promise<Provider | null> {
  let cfg: Record<string, unknown> = {}
  try {
    cfg = TOML.parse(await fsp.readFile(codexConfigPath(), 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
  const section = (cfg.model_providers as Record<string, unknown> | undefined)?.[SECTION] as
    | Record<string, unknown>
    | undefined
  const baseUrl = section?.base_url as string | undefined
  let key = ''
  try {
    const auth = JSON.parse(await fsp.readFile(codexAuthPath(), 'utf8')) as Record<string, unknown>
    if (typeof auth.OPENAI_API_KEY === 'string') key = auth.OPENAI_API_KEY
  } catch {
    /* 无 auth.json */
  }
  if (!baseUrl && !key) return null
  return {
    id: '',
    tool: 'codex',
    name: '导入的当前配置',
    baseUrl: baseUrl ?? '',
    apiKey: key,
    keyType: 'auth_token',
    model: typeof cfg.model === 'string' ? cfg.model : undefined,
    wireApi: (section?.wire_api as 'responses' | 'chat' | undefined) ?? 'responses',
    createdAt: 0,
    updatedAt: 0
  }
}

export async function status(): Promise<ToolStatus> {
  const p = codexConfigPath()
  try {
    const cfg = TOML.parse(await fsp.readFile(p, 'utf8')) as Record<string, unknown>
    const section = (cfg.model_providers as Record<string, unknown> | undefined)?.[SECTION] as
      | Record<string, unknown>
      | undefined
    let keyMasked: string | undefined
    try {
      const auth = JSON.parse(await fsp.readFile(codexAuthPath(), 'utf8')) as Record<string, unknown>
      if (typeof auth.OPENAI_API_KEY === 'string' && auth.OPENAI_API_KEY) {
        keyMasked = maskKey(auth.OPENAI_API_KEY)
      }
    } catch {
      /* 无 auth.json */
    }
    return {
      configPath: p,
      exists: true,
      currentBaseUrl: typeof section?.base_url === 'string' ? section.base_url : undefined,
      currentKeyMasked: keyMasked
    }
  } catch {
    return { configPath: p, exists: false }
  }
}

export async function listBackups(): Promise<BackupInfo[]> {
  try {
    const entries = await fsp.readdir(codexDir())
    const infos: BackupInfo[] = []
    for (const f of entries.filter((e) => /\.bak-\d{8}-\d{6}(-\d+)?$/.test(e)).sort().reverse()) {
      const full = path.join(codexDir(), f)
      const st = await fsp.stat(full)
      infos.push({ file: f, created: st.mtimeMs, size: st.size })
    }
    return infos
  } catch {
    return []
  }
}

export async function restoreBackup(file: string): Promise<SwitchResult> {
  if (file.includes('/') || file.includes('\\') || file.includes('..')) {
    throw new Error('非法的备份文件名')
  }
  if (!/^[\w.-]+\.bak-\d{8}-\d{6}(?:-\d+)?$/.test(file)) {
    throw new Error('非法的备份文件名')
  }
  const src = path.join(codexDir(), file)
  if (!fs.existsSync(src)) throw new Error('备份文件不存在')
  const target = file.replace(/\.bak-\d{8}-\d{6}(?:-\d+)?$/, '')
  const backup = await backupFile(codexDir(), target)
  await fsp.copyFile(src, path.join(codexDir(), target))
  return { ok: true, files: [path.join(codexDir(), target)], backup: backup ?? undefined }
}
