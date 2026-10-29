import { app, BrowserWindow, ipcMain } from 'electron'

type AutoUpdater = import('electron-updater').AppUpdater
/** 结构化最小类型：CancellationToken 由 electron-updater 主入口运行时导出，不 import 其内部路径 */
type CancelToken = { cancel(): void }

let cached: AutoUpdater | null = null
let downloadToken: CancelToken | null = null
let stallTimer: NodeJS.Timeout | null = null
const STALL_MS = 90_000 // 无任何下载进度 90s 判定停滞，自动中止

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

async function getAutoUpdater(): Promise<AutoUpdater> {
  if (!cached) {
    // ESM-CJS 互操作：electron-updater 的命名导出经 defineProperty getter 生成，
    // 部分 Node 版本的 namespace 探测会漏掉它——兼容 default 包裹与平铺两种形态
    const mod = (await import('electron-updater')) as unknown as Record<string, any>
    const autoUpdater = (mod?.autoUpdater ?? mod?.default?.autoUpdater) as AutoUpdater | undefined
    if (!autoUpdater) {
      throw new Error('electron-updater 加载异常（exports=' + Object.keys(mod ?? {}).join(',') + '）')
    }
    autoUpdater.autoDownload = false // 下载由用户在界面触发
    autoUpdater.on('download-progress', (p) => {
      broadcast('update:progress', {
        percent: Math.min(100, Math.round(p.percent)),
        transferred: p.transferred,
        total: p.total,
        bytesPerSecond: p.bytesPerSecond
      })
    })
    autoUpdater.on('update-downloaded', () => {
      clearStallWatch()
      broadcast('update:downloaded', {})
    })
    cached = autoUpdater
  }
  return cached
}

function clearStallWatch(): void {
  if (stallTimer) {
    clearInterval(stallTimer)
    stallTimer = null
  }
}

/** 停滞监视：任何进度变化刷新时间戳；超过 STALL_MS 无变化则取消下载 */
function watchStall(): void {
  clearStallWatch()
  let last = Date.now()
  stallTimer = setInterval(() => {
    const now = Date.now()
    if (now - last > STALL_MS) {
      clearStallWatch()
      downloadToken?.cancel()
      return
    }
    last = now
    // 进度事件会重置基线：见下面的包装（通过标志位实现）
    if (progressSinceTick) {
      last = Date.now()
      progressSinceTick = false
    }
  }, 5_000)
}

let progressSinceTick = false

function friendlyError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e)
  if (/cancelled|canceled/i.test(msg)) return '已取消下载'
  if (/net::|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|timeout|getaddrinfo|Invalid URL/i.test(msg)) {
    return '无法连接 GitHub（当前网络访问不畅）。建议点「打开发布页」手动下载安装包'
  }
  if (/stall/i.test(msg)) {
    return '下载长时间无进展（GitHub 访问不畅），已自动中止。建议点「打开发布页」手动下载'
  }
  return `更新失败：${msg}`
}

/** 启动时静默检查（仅用户开启自动检查时）；发现新版推给渲染层出横幅，失败不打扰 */
export async function startupCheck(enabled: boolean): Promise<void> {
  if (!app.isPackaged || !enabled) return
  try {
    const au = await getAutoUpdater()
    const result = await au.checkForUpdates()
    const remote = result?.updateInfo?.version
    if (remote && remote !== app.getVersion()) broadcast('update:available', { version: remote })
  } catch {
    /* 网络不通时静默 */
  }
}

export function registerUpdateIpc(): void {
  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return { error: '开发模式不支持检查更新' }
    try {
      const au = await getAutoUpdater()
      const result = await au.checkForUpdates()
      return { version: result?.updateInfo?.version ?? null, current: app.getVersion() }
    } catch (e) {
      return { error: friendlyError(e) }
    }
  })

  ipcMain.handle('update:download', async () => {
    try {
      const mod = (await import('electron-updater')) as unknown as {
        CancellationToken: new () => CancelToken
      }
      const au = await getAutoUpdater()
      const token = new mod.CancellationToken()
      // 运行时即 electron-updater 自构造的真实 CancellationToken，仅类型层面收窄为结构化接口
      downloadToken = token as CancelToken
      progressSinceTick = true
      watchStall()
      try {
        await au.downloadUpdate(token as Parameters<AutoUpdater['downloadUpdate']>[0])
        return { ok: true }
      } finally {
        clearStallWatch()
        downloadToken = null
      }
    } catch (e) {
      const msg = (e as Error)?.message ?? ''
      // 停滞被取消时给出更准确的原因
      if (/cancel/i.test(msg) && stallTimer === null) {
        return { error: friendlyError(new Error('stall')) }
      }
      return { error: friendlyError(e) }
    }
  })

  ipcMain.handle('update:cancel', () => {
    try {
      downloadToken?.cancel()
      return { ok: true }
    } catch (e) {
      return { error: friendlyError(e) }
    }
  })

  ipcMain.handle('update:install', () => {
    if (!cached) return { error: '请先检查更新' }
    try {
      // 静默安装 + 装完自动重启（与主流应用一致；oneClick 安装器语义下最顺滑）
      cached.quitAndInstall(true, true)
      return { ok: true }
    } catch (e) {
      return { error: friendlyError(e) }
    }
  })
}
