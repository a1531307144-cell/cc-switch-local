import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'
import type { AppSettings, StoreShape } from '../shared/types'

const DEFAULT_SETTINGS: AppSettings = {
  autoUpdate: true,
  autoStart: false,
  theme: 'system',
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
      providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      settings: {
        ...DEFAULT_SETTINGS,
        ...(parsed.settings ?? {}),
        router: {
          claude: parsed.settings?.router?.claude ?? DEFAULT_SETTINGS.router!.claude,
          codex: parsed.settings?.router?.codex ?? DEFAULT_SETTINGS.router!.codex,
          ...(typeof parsed.settings?.router?.port === 'number' ? { port: parsed.settings.router.port } : {})
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
