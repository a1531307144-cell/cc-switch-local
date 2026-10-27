import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'
import type { AppSettings, StoreShape } from '../shared/types'

const DEFAULT_SETTINGS: AppSettings = {
  autoUpdate: true,
  autoStart: false,
  theme: 'system'
}

/** 数据目录可用 CCS_DATA_DIR 覆盖（自测用），默认走 Electron userData */
export function dataDir(): string {
  return process.env.CCS_DATA_DIR || app.getPath('userData')
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
      settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) }
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

/** 串行化写入，避免并发覆盖 */
export function saveStore(store: StoreShape): Promise<void> {
  writeChain = writeChain.then(() => atomicWrite(storeFile(), JSON.stringify(store, null, 2)))
  return writeChain
}

export async function atomicWrite(file: string, content: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  await fsp.writeFile(tmp, content, 'utf8')
  await fsp.rename(tmp, file)
}

export function newId(): string {
  return crypto.randomUUID()
}
