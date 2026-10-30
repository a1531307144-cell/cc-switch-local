import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { dataDir } from './store'

/**
 * 「一键清空全部数据」（v0.7.0，用户需求）：
 * 只删除本应用自己创建的数据文件（providers.json / usage-cache.json / 残留 tmp），
 * 绝不递归删除整个目录——userData 里还有 Electron 自身的缓存文件，不能连坐。
 * 工具配置文件的恢复（移除我们写入的键）由调用方在删库之前完成。
 */
export async function clearAppData(): Promise<{ removed: string[] }> {
  const dir = dataDir()
  const targets = ['providers.json', 'usage-cache.json']
  const removed: string[] = []
  for (const name of targets) {
    const full = path.join(dir, name)
    try {
      await fsp.rm(full, { force: true })
      removed.push(name)
    } catch {
      /* 文件不存在或删除失败都不中断 */
    }
  }
  // 原子写的 tmp 残留
  try {
    for (const f of await fsp.readdir(dir)) {
      if (f.startsWith('providers.json.tmp-') || f.startsWith('usage-cache.json.tmp-')) {
        await fsp.rm(path.join(dir, f), { force: true })
      }
    }
  } catch {
    /* 目录不存在则无需清理 */
  }
  return { removed }
}

/** 备份文件数量（设置页展示用，可省） */
export function dataFileExists(name: string): boolean {
  try {
    return fs.existsSync(path.join(dataDir(), name))
  } catch {
    return false
  }
}
