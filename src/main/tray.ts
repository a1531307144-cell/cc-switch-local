import { BrowserWindow, Menu, Notification, Tray, app, nativeImage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { loadStore, saveStore } from './store'
import { switchProviderForTool } from './switcher'
import { t, type Lang } from '../shared/i18n'
import type { MenuItemConstructorOptions } from 'electron'
import type { ToolId } from '../shared/types'

/**
 * 系统托盘：快速切换供应商（与主窗口同一套切换逻辑），关窗后驻留托盘。
 * 自测模式不创建托盘。
 */

let tray: Tray | null = null
let showMainWindow: () => void = () => {}

function trayIcon(): Electron.NativeImage | undefined {
  const p = path.join(__dirname, '../../build/icon.png')
  if (!fs.existsSync(p)) return undefined
  return nativeImage.createFromPath(p).resize({ width: 16, height: 16 })
}

function notify(body: string): void {
  try {
    if (Notification.isSupported()) new Notification({ title: 'CC Switch Local', body }).show()
  } catch {
    /* 通知不可用时忽略 */
  }
}

/** 托盘切换走与 IPC 完全相同的切换函数与存储路径 */
async function switchProvider(tool: ToolId, id: string | null): Promise<void> {
  const lang = loadStore().settings.language ?? 'zh'
  const LABEL: Record<ToolId, string> = { claude: 'Claude Code', codex: 'Codex' }
  try {
    const store = loadStore()
    let provider = null
    if (id) {
      provider = store.providers.find((p) => p.id === id && p.tool === tool) ?? null
      if (!provider) return
    }
    // 统一出口：OpenAI 协议供应商自动经路由（协议转换），与 IPC 完全同路径
    await switchProviderForTool(tool, provider)
    store.current[tool] = id
    await saveStore(store)
    refreshTray()
    notify(
      provider
        ? t(lang, 'tray.switched', { tool: LABEL[tool], name: provider.name })
        : t(lang, 'tray.restored')
    )
    // 主窗口若开着，实时刷新列表
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('store:changed')
    }
  } catch (e) {
    notify(t(lang, 'tray.switchFail', { msg: (e as Error).message }))
  }
}

function buildMenu(): Electron.Menu {
  const store = loadStore()
  const lang: Lang = store.settings.language ?? 'zh'
  const LABEL: Record<ToolId, string> = { claude: 'Claude Code', codex: 'Codex' }

  const toolSection = (tool: ToolId): MenuItemConstructorOptions[] => {
    const providers = store.providers.filter((p) => p.tool === tool).slice(0, 30)
    const cur = store.current[tool]
    const curName = cur ? (providers.find((p) => p.id === cur)?.name ?? '—') : null
    const items: MenuItemConstructorOptions[] = [
      {
        label: `${LABEL[tool]}：${curName ? t(lang, 'tray.current', { name: curName }) : t(lang, 'tray.unmanaged')}`,
        enabled: false
      }
    ]
    for (const p of providers) {
      items.push({
        label: p.name,
        type: 'checkbox',
        checked: p.id === cur,
        click: () => void switchProvider(tool, p.id)
      })
    }
    if (providers.length === 0) {
      items.push({ label: t(lang, 'tray.none'), enabled: false })
    }
    items.push({ label: t(lang, 'tray.restore'), click: () => void switchProvider(tool, null) })
    items.push({ type: 'separator' })
    return items
  }

  return Menu.buildFromTemplate([
    ...toolSection('claude'),
    ...toolSection('codex'),
    {
      label: t(lang, 'tray.show'),
      click: () => showMainWindow()
    },
    { type: 'separator' },
    { label: t(lang, 'tray.quit'), click: () => app.quit() }
  ])
}

export function refreshTray(): void {
  try {
    tray?.setContextMenu(buildMenu())
  } catch {
    /* 托盘不存在时忽略 */
  }
}

export function createTray(onShowMainWindow: () => void): void {
  if (tray) return
  showMainWindow = onShowMainWindow
  const icon = trayIcon()
  tray = icon ? new Tray(icon) : new Tray(nativeImage.createEmpty())
  // 主密码锁定态下 loadStore 抛 LOCKED——绝不能让它炸掉 whenReady 后续链路
  // （更新检查/路由拉起/activate 注册都在 createTray 之后）（v0.8.7 审查修复 #2）
  try {
    tray.setToolTip(t(loadStore().settings.language ?? 'zh', 'tray.tooltip'))
    refreshTray()
  } catch {
    tray.setToolTip('CC Switch Local') // 锁定态：解锁后 master:unlock 会再刷一次
  }
  tray.on('click', () => showMainWindow())
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
