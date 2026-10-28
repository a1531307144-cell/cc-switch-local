import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'node:path'
import { dataDir, loadStore, newId, saveStore } from './store'
import * as claude from './claude'
import * as codex from './codex'
import { testProvider } from './test'
import { importFromCcSwitch } from './importer'
import { PRESETS } from './presets'
import { initUpdater } from './updater'
import { runSelfTest } from './selftest'
import type { AppSettings, Provider, ProviderInput, TestInput, ToolId } from '../shared/types'

const SELFTEST = process.argv.includes('--selftest')

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 900,
    minHeight: 600,
    show: !SELFTEST,
    autoHideMenuBar: true,
    title: 'CC Switch Local',
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
    return created
  })

  ipcMain.handle('provider:delete', async (_e, id: string) => {
    const store = loadStore()
    store.providers = store.providers.filter((p) => p.id !== id)
    for (const t of ['claude', 'codex'] as ToolId[]) {
      if (store.current[t] === id) store.current[t] = null
    }
    await saveStore(store)
    return true
  })

  ipcMain.handle('provider:switch', async (_e, tool: ToolId, id: string | null) => {
    const store = loadStore()
    let provider: Provider | null = null
    if (id) {
      provider = store.providers.find((p) => p.id === id && p.tool === tool) ?? null
      if (!provider) throw new Error('供应商不存在')
    }
    const result = tool === 'claude' ? await claude.switchClaude(provider) : await codex.switchCodex(provider)
    store.current[tool] = id
    await saveStore(store)
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

  ipcMain.handle('settings:update', async (_e, patch: Partial<AppSettings>) => {
    const store = loadStore()
    store.settings = { ...store.settings, ...patch }
    await saveStore(store)
    applySettings(store.settings)
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

  ipcMain.handle('update:check', async () => {
    if (!app.isPackaged) return { error: '开发模式不支持检查更新' }
    try {
      const { autoUpdater } = await import('electron-updater')
      autoUpdater.autoDownload = false
      const result = await autoUpdater.checkForUpdates()
      return { version: result?.updateInfo?.version ?? null }
    } catch (e) {
      return { error: `检查更新失败：${(e as Error).message}` }
    }
  })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
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
    const store = loadStore()
    applySettings(store.settings)
    initUpdater(() => loadStore().settings.autoUpdate)
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
