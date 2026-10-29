import { app, BrowserWindow, ipcMain } from 'electron'

type AutoUpdater = import('electron-updater').AppUpdater

let cached: AutoUpdater | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

async function getAutoUpdater(): Promise<AutoUpdater> {
  if (!cached) {
    const { autoUpdater } = await import('electron-updater')
    autoUpdater.autoDownload = false // 下载由用户在界面触发
    autoUpdater.on('download-progress', (p) => {
      broadcast('update:progress', { percent: Math.min(100, Math.round(p.percent)) })
    })
    autoUpdater.on('update-downloaded', () => broadcast('update:downloaded', {}))
    cached = autoUpdater
  }
  return cached
}

function friendlyError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e)
  if (/net::|ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|timeout|getaddrinfo|Invalid URL/i.test(msg)) {
    return '无法连接 GitHub（当前网络可能访问不畅），可点「打开发布页」手动下载'
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
      const au = await getAutoUpdater()
      await au.downloadUpdate()
      return { ok: true }
    } catch (e) {
      return { error: friendlyError(e) }
    }
  })

  ipcMain.handle('update:install', () => {
    if (!cached) return { error: '请先检查更新' }
    try {
      cached.quitAndInstall(false, true)
      return { ok: true }
    } catch (e) {
      return { error: friendlyError(e) }
    }
  })
}
