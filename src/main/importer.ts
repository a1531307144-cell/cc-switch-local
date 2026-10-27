import path from 'node:path'
import fsp from 'node:fs/promises'
import { homeDir } from './claude'
import type { ImportReport, KeyType } from '../shared/types'

interface Harvested {
  name?: string
  baseUrl: string
  apiKey: string
  keyType: KeyType
  source: string
}

/**
 * 尽力从原版 cc-switch 的数据里挖出供应商（base_url + key）。
 * 兼容两种形态：旧版 ~/.cc-switch/config.json（JSON），新版 cc-switch.db（SQLite）。
 * 结构对不上时只报 skipped，绝不抛错中断。
 */
export async function importFromCcSwitch(): Promise<ImportReport> {
  const details: string[] = []
  const found: Harvested[] = []

  const legacy = path.join(homeDir(), '.cc-switch', 'config.json')
  try {
    const raw = await fsp.readFile(legacy, 'utf8')
    harvest(JSON.parse(raw), 'config.json', found)
    details.push(`旧版 config.json：识别到 ${found.length} 条候选`)
  } catch {
    details.push('未找到旧版 ~/.cc-switch/config.json（正常，新版用数据库）')
  }

  const dbPath = path.join(homeDir(), '.cc-switch', 'cc-switch.db')
  try {
    const rows = await readSqliteRows(dbPath)
    const before = found.length
    for (const row of rows) harvest(row, 'cc-switch.db', found)
    details.push(`cc-switch.db：读取 ${rows.length} 行，识别到 ${found.length - before} 条候选`)
  } catch (e) {
    details.push(`读取 cc-switch.db 未成功（可忽略）：${(e as Error).message}`)
  }

  const seen = new Set<string>()
  const unique = found.filter((f) => {
    const k = `${f.baseUrl}|${f.apiKey}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  return {
    imported: unique.length,
    skipped: found.length - unique.length,
    details,
    providers: unique.map((u) => ({ name: u.name, baseUrl: u.baseUrl, apiKey: u.apiKey, keyType: u.keyType, source: u.source }))
  }
}

/** 递归遍历 JSON，凡是有 ANTHROPIC_BASE_URL / base_url + key 的对象都算一条供应商 */
function harvest(node: unknown, source: string, out: Harvested[]): void {
  if (Array.isArray(node)) {
    node.forEach((n) => harvest(n, source, out))
    return
  }
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>

  const env = (obj.env && typeof obj.env === 'object' ? obj.env : obj) as Record<string, unknown>
  const baseUrl = env.ANTHROPIC_BASE_URL ?? obj.base_url ?? obj.baseUrl
  const auth = env.ANTHROPIC_AUTH_TOKEN
  const apiKey = env.ANTHROPIC_API_KEY ?? obj.api_key ?? obj.apiKey
  if (typeof baseUrl === 'string' && baseUrl.startsWith('http')) {
    const key = typeof auth === 'string' && auth ? auth : typeof apiKey === 'string' ? apiKey : ''
    if (key) {
      out.push({
        name: typeof obj.name === 'string' ? obj.name : undefined,
        baseUrl,
        apiKey: key,
        keyType: typeof auth === 'string' && auth ? 'auth_token' : 'api_key',
        source
      })
      return
    }
  }

  for (const v of Object.values(obj)) {
    if (typeof v === 'string' && v.includes('ANTHROPIC_BASE_URL')) {
      try {
        harvest(JSON.parse(v), source, out)
        continue
      } catch {
        regexExtract(v, source, out)
        continue
      }
    }
    if (v && typeof v === 'object') harvest(v, source, out)
  }
}

function regexExtract(text: string, source: string, out: Harvested[]): void {
  const url = text.match(/ANTHROPIC_BASE_URL["':\s]+(https?:\/\/[^"'\s,}]+)/)
  const token = text.match(/ANTHROPIC_AUTH_TOKEN["':\s]+([^"'\s,}]+)/)
  const key = text.match(/ANTHROPIC_API_KEY["':\s]+([^"'\s,}]+)/)
  if (url && (token || key)) {
    out.push({
      baseUrl: url[1],
      apiKey: (token ? token[1] : key![1]).trim(),
      keyType: token ? 'auth_token' : 'api_key',
      source
    })
  }
}

async function readSqliteRows(dbPath: string): Promise<Record<string, unknown>[]> {
  const mod = (await import('node:sqlite')) as unknown as {
    DatabaseSync: new (p: string, opts?: { readOnly?: boolean }) => {
      prepare(sql: string): { all(): unknown[] }
      close(): void
    }
  }
  const db = new mod.DatabaseSync(dbPath, { readOnly: true })
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string
    }[]
    const rows: Record<string, unknown>[] = []
    for (const t of tables) {
      if (t.name.startsWith('sqlite_')) continue
      try {
        const r = db.prepare(`SELECT * FROM "${t.name.replace(/"/g, '')}" LIMIT 500`).all()
        rows.push(...(r as Record<string, unknown>[]))
      } catch {
        /* 跳过读不了的表 */
      }
    }
    return rows
  } finally {
    db.close()
  }
}
