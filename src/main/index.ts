import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { dataDir, loadStore, newId, saveStore } from './store'
import * as claude from './claude'
import * as codex from './codex'
import { testProvider } from './test'
import { importFromCcSwitch } from './importer'
import { backupExport, backupImport } from './backup'
import { usageStats } from './usage'
import { routerEnabled, routerStatus, startRouter, stopRouter } from './router'
import { fetchBalance } from './balance'
import { cloneProvider, reorderProviders } from './library'
import { clearAppData } from './cleardata'
import { findDeeplinkInArgv, parseProviderDeeplink } from './deeplink'
import { PRESETS } from './presets'
import { registerUpdateIpc, startupCheck } from './updater'
import { createTray, refreshTray } from './tray'
import { runSelfTest } from './selftest'
import { RELEASES_URL } from '../shared/constants'
import type { AppSettings, Provider, ProviderInput, TestInput, ToolId } from '../shared/types'

const SELFTEST = process.argv.includes('--selftest')

let win: BrowserWindow | null = null

/** dev 模式下窗口/任务栏也显示品牌图标；打包后 Windows 自动取 exe 内嵌 ico */
function iconPath(): string | undefined {
  const p = path.join(__dirname, '../../build/icon.png')
  return fs.existsSync(p) ? p : undefined
}

type ThemeMode = 'system' | 'light' | 'dark'

function effectiveDark(theme: ThemeMode): boolean {
  return theme === 'dark' || (theme === 'system' && nativeTheme.shouldUseDarkColors)
}

/** 原生窗口控件（最小化/最大化/关闭）与顶栏颜色跟随应用主题，避免系统标题栏与应用内配色割裂 */
function overlayFor(dark: boolean): Electron.TitleBarOverlayOptions {
  return dark
    ? { color: '#121317', symbolColor: '#f0f1f3', height: 40 }
    : { color: '#fbfbfd', symbolColor: '#1d1d1f', height: 40 }
}

function syncTitleBar(theme: ThemeMode): void {
  if (process.platform !== 'win32' || !win) return
  try {
    win.setTitleBarOverlay(overlayFor(effectiveDark(theme)))
  } catch {
    /* overlay 未启用或平台不支持时忽略 */
  }
}

function createWindow(theme: ThemeMode = 'system'): void {
  const dark = effectiveDark(theme)
  win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 900,
    minHeight: 600,
    show: !SELFTEST,
    autoHideMenuBar: true,
    title: 'CC Switch Local',
    icon: iconPath(),
    backgroundColor: dark ? '#0d0e11' : '#f5f5f7',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayFor(dark),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  // Electron 官方安全清单：渲染层被攻破时不给导航/弹窗/任何 Web 权限
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  win.on('closed', () => {
    win = null
  })
  win.on('close', (e) => {
    if (!quitting && !SELFTEST) {
      e.preventDefault()
      win?.hide()
    }
  })
}

// 关窗 = 驻留托盘；只有托盘菜单「退出」或系统关机才真正退出
let quitting = false

/** 把深链发给渲染层（窗口未就绪时等加载完成再发一次） */
function deliverDeeplink(raw: string): void {
  const parsed = parseProviderDeeplink(raw)
  const send = () => win?.webContents.send('deeplink:provider', parsed)
  if (win) {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
    else send()
  }
}

function showMainWindow(): void {
  if (!win) {
    createWindow(loadStore().settings.theme)
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function applySettings(settings: AppSettings): void {
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({ openAtLogin: settings.autoStart })
  } catch {
    /* 未打包或权限不足时忽略 */
  }
}

const TOOL_IDS: ToolId[] = ['claude', 'codex']
const KEY_TYPES: string[] = ['auth_token', 'api_key']
const WIRE_APIS: string[] = ['responses', 'chat']
const isStr = (v: unknown): v is string => typeof v === 'string'

/** IPC 是安全边界：所有来自渲染层的入参都在主进程重新校验 */
function validateProviderInput(input: ProviderInput): void {
  if (!input || !TOOL_IDS.includes(input.tool)) throw new Error('非法的工具类型')
  if (!isStr(input.name) || !input.name.trim() || input.name.length > 200) throw new Error('名称须为 1-200 个字符')
  if (!isStr(input.baseUrl) || !/^https?:\/\//i.test(input.baseUrl.trim()) || input.baseUrl.length > 2000) {
    throw new Error('Base URL 非法（仅允许 http/https，长度 ≤ 2000）')
  }
  if (!isStr(input.apiKey) || input.apiKey.length > 4000) throw new Error('API Key 非法（长度 ≤ 4000）')
  if (input.keyType !== undefined && !KEY_TYPES.includes(input.keyType)) throw new Error('非法的 Key 类型')
  if (input.wireApi !== undefined && !WIRE_APIS.includes(input.wireApi)) throw new Error('非法的 wire_api')
  if (input.model !== undefined && (!isStr(input.model) || input.model.length > 200)) throw new Error('模型名过长')
  if (input.notes !== undefined && (!isStr(input.notes) || input.notes.length > 2000)) throw new Error('备注过长')
  if (input.id !== undefined && (!isStr(input.id) || input.id.length > 64)) throw new Error('非法的 id')
}

function registerIpc(): void {
  ipcMain.handle('store:get', () => loadStore())

  ipcMain.handle('provider:save', async (_e, input: ProviderInput) => {
    validateProviderInput(input)
    const store = loadStore()
    const now = Date.now()
    if (input.id) {
      const idx = store.providers.findIndex((p) => p.id === input.id)
      if (idx < 0) throw new Error('供应商不存在')
      const existing = store.providers[idx]
      const updated: Provider = {
        ...existing,
        name: input.name,
        baseUrl: input.baseUrl,
        apiKey: input.apiKey,
        keyType: input.keyType ?? existing.keyType,
        model: input.model || undefined,
        wireApi: input.wireApi || undefined,
        notes: input.notes || undefined,
        updatedAt: now
      }
      store.providers[idx] = updated
      await saveStore(store)
      refreshTray()
      return updated
    }
    const created: Provider = {
      id: newId(),
      tool: input.tool,
      name: input.name,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      keyType: input.keyType ?? 'auth_token',
      model: input.model || undefined,
      wireApi: input.wireApi || undefined,
      notes: input.notes || undefined,
      createdAt: now,
      updatedAt: now
    }
    store.providers.push(created)
    await saveStore(store)
    refreshTray()
    return created
  })

  ipcMain.handle('provider:delete', async (_e, id: string) => {
    const store = loadStore()
    store.providers = store.providers.filter((p) => p.id !== id)
    for (const t of ['claude', 'codex'] as ToolId[]) {
      if (store.current[t] === id) store.current[t] = null
    }
    await saveStore(store)
    refreshTray()
    return true
  })

  ipcMain.handle('provider:clone', async (_e, id: string) => {
    const copy = await cloneProvider(id)
    refreshTray()
    return copy
  })

  ipcMain.handle('providers:reorder', async (_e, tool: ToolId, ids: string[]) => {
    await reorderProviders(tool, ids)
    refreshTray()
    return true
  })

  ipcMain.handle('provider:switch', async (_e, tool: ToolId, id: string | null) => {
    const store = loadStore()
    let provider: Provider | null = null
    if (id) {
      provider = store.providers.find((p) => p.id === id && p.tool === tool) ?? null
      if (!provider) throw new Error('供应商不存在')
    }
    const result =
      tool === 'claude'
        ? await claude.switchClaude(provider, routerEnabled(tool))
        : await codex.switchCodex(provider, routerEnabled(tool))
    store.current[tool] = id
    await saveStore(store)
    refreshTray()
    return result
  })

  ipcMain.handle('tool:importCurrent', (_e, tool: ToolId) =>
    tool === 'claude' ? claude.importCurrentClaude() : codex.importCurrentCodex()
  )

  ipcMain.handle('tool:status', (_e, tool: ToolId) => (tool === 'claude' ? claude.status() : codex.status()))

  ipcMain.handle('tool:backups', (_e, tool: ToolId) => (tool === 'claude' ? claude.listBackups() : codex.listBackups()))

  ipcMain.handle('tool:restoreBackup', async (_e, tool: ToolId, file: string) =>
    tool === 'claude' ? claude.restoreBackup(file) : codex.restoreBackup(file)
  )

  ipcMain.handle('provider:test', (_e, input: TestInput) => testProvider(input))

  ipcMain.handle('ccswitch:import', () => importFromCcSwitch())

  ipcMain.handle('presets:get', () => PRESETS)

  ipcMain.handle('backup:export', (_e, passphrase: string) => backupExport(passphrase))

  ipcMain.handle('backup:import', (_e, passphrase: string) => backupImport(passphrase))

  ipcMain.handle('usage:get', () => usageStats())

  ipcMain.handle('router:status', () => routerStatus())

  ipcMain.handle('balance:get', (_e, input: { baseUrl: string; apiKey: string }) => {
    if (!input || !isStr(input.baseUrl) || !/^https?:\/\//i.test(input.baseUrl) || input.baseUrl.length > 2000) {
      throw new Error('非法的 Base URL')
    }
    if (!isStr(input.apiKey) || !input.apiKey || input.apiKey.length > 4000) throw new Error('非法的 API Key')
    return fetchBalance(input.baseUrl, input.apiKey)
  })

  ipcMain.handle('data:clearAll', async () => {
    // 1) 两个工具先恢复官方状态（移除我们写入的键；本来没接管就跳过写盘）
    for (const tool of ['claude', 'codex'] as ToolId[]) {
      if (loadStore().current[tool]) {
        if (tool === 'claude') await claude.switchClaude(null)
        else await codex.switchCodex(null)
      }
    }
    // 2) 停路由、清数据、刷托盘
    stopRouter()
    const r = await clearAppData()
    refreshTray()
    return r
  })

  ipcMain.handle('deeplink:parse', (_e, raw: string) => {
    if (!isStr(raw) || raw.length > 4000) return { ok: false, error: '链接非法或过长' }
    return parseProviderDeeplink(raw)
  })

  ipcMain.handle('router:set', async (_e, tool: ToolId, enabled: boolean) => {
    if (!(tool === 'claude' || tool === 'codex')) throw new Error('非法的工具类型')
    if (typeof enabled !== 'boolean') throw new Error('非法的开关值')
    const store = loadStore()
    if (enabled && !store.current[tool]) throw new Error('请先选择一个供应商，再开启本机路由')
    const router = { claude: store.settings.router?.claude ?? false, codex: store.settings.router?.codex ?? false }
    router[tool] = enabled
    store.settings.router = router
    await saveStore(store)
    if (enabled || router.claude || router.codex) {
      await startRouter().catch((e) => {
        throw new Error(`路由服务启动失败：${(e as Error).message}`)
      })
    } else if (!router.claude && !router.codex) {
      stopRouter()
    }
    // 按新模式重写该工具配置（无当前供应商时退回官方配置）
    const provider = store.current[tool] ? store.providers.find((p) => p.id === store.current[tool]) ?? null : null
    if (tool === 'claude') await claude.switchClaude(provider, enabled)
    else await codex.switchCodex(provider, enabled)
    return routerStatus()
  })

  ipcMain.handle('settings:update', async (_e, patch: Partial<AppSettings>) => {
    const store = loadStore()
    if (patch.language !== undefined && patch.language !== 'zh' && patch.language !== 'en') {
      throw new Error('非法的语言')
    }
    if (patch.sidebarCollapsed !== undefined && typeof patch.sidebarCollapsed !== 'boolean') {
      throw new Error('非法的侧栏折叠状态')
    }
    store.settings = { ...store.settings, ...patch }
    await saveStore(store)
    applySettings(store.settings)
    syncTitleBar(store.settings.theme)
    refreshTray()
    return store.settings
  })

  ipcMain.handle('app:openPath', (_e, kind: 'data' | 'claudeConfig' | 'codexConfig') => {
    const map: Record<string, () => string> = {
      data: dataDir,
      claudeConfig: claude.claudeDir,
      codexConfig: codex.codexDir
    }
    if (!(kind in map)) throw new Error('非法的路径类型')
    return shell.openPath(map[kind]())
  })

  ipcMain.handle('app:version', () => app.getVersion())

  ipcMain.handle('app:openReleases', () => shell.openExternal(RELEASES_URL))

  registerUpdateIpc()
}

// 自测是隔离的无头运行，不参与单实例锁——否则用户开着应用时自测会静默退出（2026-10-29 实测）。
// 显式设了 CCS_DATA_DIR 的实例同理：它是带独立数据目录的测试实例，与用户实例互不干扰。
const gotLock = SELFTEST || process.env.CCS_DATA_DIR || app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    // Windows 上点 ccsl:// 链接会启动第二个实例并由这里转交
    const link = findDeeplinkInArgv(argv)
    if (link) deliverDeeplink(link)
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(async () => {
    registerIpc()
    if (SELFTEST) {
      await runSelfTest()
      return
    }
    // 注册 ccsl:// 深链协议（仅打包实例写注册表；dev/测试实例不污染系统）
    if (app.isPackaged) {
      try {
        app.setAsDefaultProtocolClient('ccsl')
      } catch {
        /* 注册失败不影响其他功能 */
      }
    }
    const store = loadStore()
    applySettings(store.settings)
    createWindow(store.settings.theme)
    // 冷启动带深链（Windows 把链接作为 argv 传进来）
    const coldLink = findDeeplinkInArgv(process.argv)
    if (coldLink) deliverDeeplink(coldLink)
    createTray(showMainWindow)
    // 上次会话开启了路由模式 → 直接拉起代理（配置文件仍指向本机路由）
    const rs = loadStore().settings.router
    if (rs?.claude || rs?.codex) {
      startRouter().catch((e) => console.error('[router] 启动失败:', e))
    }
    void startupCheck(store.settings.autoUpdate)
    nativeTheme.on('updated', () => {
      if (loadStore().settings.theme === 'system') syncTitleBar('system')
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('before-quit', () => {
    quitting = true
  })

  // 有托盘常驻：关窗不退出（见 createWindow 的 close 拦截），这里兜底 darwin 语义
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && quitting) app.quit()
  })
}
