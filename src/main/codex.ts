import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import TOML from '@iarna/toml'
import { atomicWrite } from './store'
import { routerPort } from './router'
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

/** TOML 基本字符串转义 */
function tomlStr(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function isSectionHeader(line: string): boolean {
  const t = line.trim()
  return t.startsWith('[') && t.endsWith(']')
}

/** 顶层裸键赋值行：key = value（不含点号、不在任何 section 内） */
function topKeyValue(line: string, key: string): boolean {
  return new RegExp(`^\\s*${key}\\s*=`).test(line)
}

/** 找到 [model_providers.ccsl] 块的行区间 [start, end)（end 不含） */
function findSectionBlock(lines: string[], header: string): [number, number] | null {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === header) {
      let end = lines.length
      for (let j = i + 1; j < lines.length; j++) {
        if (isSectionHeader(lines[j])) {
          end = j
          break
        }
      }
      return [i, end]
    }
  }
  return null
}

/**
 * 关键字段替换写入（对齐原版 cc-switch 的做法）：
 * 只替换/追加我们拥有的键（model_provider、model、[model_providers.ccsl]），
 * 其余行——包括注释、顺序、其他供应商段——逐字节保留。
 * 写入前用完整 TOML 解析校验结果，解析失败即中止，绝不写坏用户文件。
 */
function applySurgicalEdit(original: string, provider: Provider | null, viaRouter = false): string {
  const eol = original.includes('\r\n') ? '\r\n' : '\n'
  let lines = original.length ? original.split(/\r?\n/) : []
  if (lines.length && lines[lines.length - 1] === '') lines.pop()

  const HEADER = `[model_providers.${SECTION}]`

  if (provider) {
    // 1) [model_providers.ccsl] 段：存在则整块替换，否则追加到文件末尾
    const baseUrl = viaRouter ? `http://127.0.0.1:${routerPort()}/codex` : provider.baseUrl
    const block = [
      HEADER,
      `name = ${tomlStr(provider.name)}`,
      `base_url = ${tomlStr(baseUrl)}`,
      `wire_api = ${tomlStr(provider.wireApi ?? 'responses')}`,
      'requires_openai_auth = true'
    ]
    const existing = findSectionBlock(lines, HEADER)
    if (existing) {
      lines.splice(existing[0], existing[1] - existing[0], ...block)
    } else {
      if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('')
      lines.push(...block)
    }

    // 2) 顶层 model_provider / model：有则原地替换，无则插到首个 section 之前
    const insertAt = (() => {
      const idx = lines.findIndex((l) => isSectionHeader(l))
      return idx === -1 ? lines.length : idx
    })()
    const upsertTop = (key: string, value: string) => {
      const topIdx = lines.findIndex((l, i) => i < insertAt + 1 && topKeyValue(l, key))
      const line = `${key} = ${tomlStr(value)}`
      if (topIdx >= 0 && topIdx < insertAt + 1) lines[topIdx] = line
      else lines.splice(insertAt, 0, line)
    }
    upsertTop('model_provider', SECTION)
    if (provider.model) upsertTop('model', provider.model)
  } else {
    // 恢复官方：仅移除我们写入的 model_provider 行与 ccsl 段（model 留给用户）
    lines = removeSection(lines, HEADER)
    const mpIdx = lines.findIndex((l) => topKeyValue(l, 'model_provider'))
    if (mpIdx >= 0 && lines[mpIdx].trim() === `model_provider = ${tomlStr(SECTION)}`) {
      lines.splice(mpIdx, 1)
    }
  }
  return lines.join(eol) + (lines.length ? eol : '')
}

/** 删除指定 header 段的块体（header 行已单独移除时也能正确处理剩余行） */
function removeSection(lines: string[], header: string): string[] {
  const block = findSectionBlock(lines, header)
  if (!block) return lines
  const out = [...lines]
  out.splice(block[0], block[1] - block[0])
  return out
}

/**
 * provider 为 null 表示「恢复官方配置」：只移除我们写入的键。
 * 行级手术式编辑：注释、键顺序、其他配置段全部保留；写入前自动备份。
 * viaRouter=true 时 base_url 指向本机路由，auth.json 里只放占位 Key。
 */
export async function switchCodex(provider: Provider | null, viaRouter = false): Promise<SwitchResult> {
  if (provider) {
    if (!viaRouter && !/^https?:\/\//i.test(provider.baseUrl)) {
      throw new Error(`非法的 Base URL（仅允许 http/https）：${provider.baseUrl}`)
    }
    if (!viaRouter && !provider.apiKey) throw new Error('API Key 不能为空')
  }
  await fsp.mkdir(codexDir(), { recursive: true })
  const backups: string[] = []
  for (const name of ['config.toml', 'auth.json']) {
    const bak = await backupFile(codexDir(), name)
    if (bak) backups.push(bak)
  }

  const original = fs.existsSync(codexConfigPath())
    ? await fsp.readFile(codexConfigPath(), 'utf8')
    : ''
  const nextText = applySurgicalEdit(original, provider, viaRouter)

  // 写入前完整解析校验：手术编辑若产生非法 TOML，立即中止，绝不落盘
  try {
    TOML.parse(nextText)
  } catch (e) {
    throw new Error(`写入校验失败（已中止，不会写入）：${(e as Error).message}`)
  }
  await atomicWrite(codexConfigPath(), nextText)

  const files = [codexConfigPath()]
  if (provider) {
    let auth: Record<string, unknown> = {}
    try {
      auth = JSON.parse(await fsp.readFile(codexAuthPath(), 'utf8')) as Record<string, unknown>
    } catch {
      auth = {}
    }
    auth.OPENAI_API_KEY = viaRouter ? 'ccsl-local-router' : provider.apiKey
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
  // 先读源内容再备份：prune 可能在备份过程中删掉最旧的源文件（同 claude.ts）
  const content = await fsp.readFile(src)
  const backup = await backupFile(codexDir(), target)
  await fsp.writeFile(path.join(codexDir(), target), content)
  return { ok: true, files: [path.join(codexDir(), target)], backup: backup ?? undefined }
}
