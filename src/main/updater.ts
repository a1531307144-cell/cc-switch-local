import { app, dialog } from 'electron'

/**
 * 打包后才启用自动更新（GitHub Releases）。
 * 未配置 owner/repo 时 electron-updater 会抛错——全部吞掉，绝不能影响主功能。
 */
export function initUpdater(isEnabled: () => boolean): void {
  if (!app.isPackaged) return
  app.whenReady().then(async () => {
    if (!isEnabled()) return
    try {
      const { autoUpdater } = await import('electron-updater')
      autoUpdater.autoDownload = false
      autoUpdater.on('update-available', (info) => {
        dialog
          .showMessageBox({
            type: 'info',
            title: '发现新版本',
            message: `发现新版本 v${String(info.version)}`,
            detail: '请在「设置 → 检查更新」中下载安装。'
          })
          .catch(() => {})
      })
      await autoUpdater.checkForUpdates()
    } catch {
      /* 未配置发布源或无网络：静默跳过 */
    }
  })
}
