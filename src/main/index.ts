import { app, BrowserWindow, clipboard, ipcMain, nativeTheme, shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { dataDir, loadStore, masterState, newId, saveStore, setMasterPassword, clearMasterPassword, unlockMaster } from './store'
import * as claude from './claude'
import * as codex from './codex'
import { testProvider } from './test'
import { importFromCcSwitch } from './importer'
import { backupExport, backupImport } from './backup'
import { usageStats } from './usage'
import { routerStatus, startRouter, stopRouter } from './router'
import { fetchBalance } from './balance'
import { cloneProvider, reorderProviders, validateSettingsPatch, recordBalance } from './library'
import { listSessions, readSession, exportSessionMd } from './sessions'
import { getAgentVersions, upgradeAgent, cancelUpgrade } from './agentVersion'
import { listPrompts, savePrompt, deletePrompt, applyPrompt, importCurrentPrompt, currentPromptFiles } from './prompts'
import { listGroups, saveGroup, deleteGroup, applyGroup } from './groups'
import { mcpDelete, mcpList, mcpSave } from './mcp'
import { clearAppData } from './cleardata'
import { findDeeplinkInArgv, parseProviderDeeplink } from './deeplink'
import { PRESETS } from './presets'
import { registerUpdateIpc, startupCheck } from './updater'
import { switchProviderForTool } from './switcher'
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

/** 最近一条深链（冷启动竞态兜底：did-finish-load 时渲染层可能还没注册监听，靠渲染层主动拉取补投） */
let pendingDeeplink: { parsed: ReturnType<typeof parseProviderDeeplink>; at: number } | null = null
const DEEPLINK_TTL_MS = 5 * 60_000

/** 把深链发给渲染层（窗口未就绪时等加载完成再发一次） */
function deliverDeeplink(raw: string): void {
  const parsed = parseProviderDeeplink(raw)
  if (parsed.ok) pendingDeeplink = { parsed, at: Date.now() }
  const send = () => win?.webContents.send('deeplink:provider', parsed)
  if (win) {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send)
    else send()
  }
}

function showMainWindow(): void {
  if (!win) {
    // 锁定态读不到主题：回退 system（解锁后渲染层会应用真实设置）
    let theme: ThemeMode = 'system'
    try {
      theme = loadStore().settings.theme
    } catch {
      /* LOCKED 或读失败 */
    }
    createWindow(theme)
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** 上次会话开启过路由/聚合 → 拉起代理（配置文件仍指向本机路由）。锁定态下 loadStore 抛错属正常，静默 */
function autoStartRouterIfNeeded(): void {
  try {
    const rs = loadStore().settings.router
    if (rs?.claude || rs?.codex || rs?.aggregate) {
      startRouter().catch((e) => console.error('[router] 启动失败:', e))
    }
  } catch {
    /* 锁定态：解锁后由 master:unlock 再拉一次 */
  }
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
const PROTOCOLS: string[] = ['anthropic', 'openai']
const isStr = (v: unknown): v is string => typeof v === 'string'

/** tool 参数严格白名单：非 claude/codex 一律拒绝，绝不静默归到另一工具（2026-10-31 审计 P2） */
function assertTool(tool: ToolId): void {
  if (!(tool === 'claude' || tool === 'codex')) throw new Error('非法的工具类型')
}

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
  if (input.protocol !== undefined && !PROTOCOLS.includes(input.protocol)) throw new Error('非法的接口协议')
  if (
    input.alias !== undefined &&
    (typeof input.alias !== 'string' || (input.alias !== '' && !/^[A-Za-z0-9_-]{1,40}$/.test(input.alias)))
  ) {
    throw new Error('聚合别名仅允许字母/数字/下划线/中划线（1-40 字符）')
  }
  if (input.model !== undefined && (!isStr(input.model) || input.model.length > 200)) throw new Error('模型名过长')
  if (input.notes !== undefined && (!isStr(input.notes) || input.notes.length > 2000)) throw new Error('备注过长')
  if (input.id !== undefined && (!isStr(input.id) || input.id.length > 64)) throw new Error('非法的 id')
}

function registerIpc(): void {
  ipcMain.handle('store:get', () => {
    try {
      return loadStore()
    } catch (e) {
      if ((e as Error).message === 'LOCKED') {
        // 锁定态：返回带 locked 标记的空库，渲染层据此显示解锁屏
        return { version: 1, current: { claude: null, codex: null }, providers: [], settings: { autoUpdate: true, autoStart: false, theme: 'system' }, locked: true }
      }
      throw e
    }
  })

  ipcMain.handle('master:unlock', (_e, pass: string) => {
    if (typeof pass !== 'string') throw new Error('非法的口令')
    const ok = unlockMaster(pass)
    if (!ok) throw new Error('主密码错误')
    refreshTray()
    // 锁定态下 whenReady 的路由自动拉起被跳过：解锁后补一次（v0.8.7 审查修复 #2）
    void autoStartRouterIfNeeded()
    return true
  })

  ipcMain.handle('master:set', (_e, pass: string) => {
    setMasterPassword(pass)
    refreshTray()
    return true
  })

  ipcMain.handle('master:remove', (_e, pass: string) => {
    clearMasterPassword(pass)
    refreshTray()
    return true
  })

  ipcMain.handle('master:status', () => masterState())

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
        protocol: input.protocol ?? (existing.tool === 'claude' ? existing.protocol : undefined),
        alias: input.alias !== undefined ? input.alias || undefined : existing.alias,
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
      protocol: input.tool === 'claude' ? input.protocol ?? 'anthropic' : undefined,
      alias: input.alias || undefined,
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
    if (typeof id !== 'string' || !id || id.length > 64) throw new Error('非法的 id')
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
    assertTool(tool)
    const store = loadStore()
    let provider: Provider | null = null
    if (id) {
      provider = store.providers.find((p) => p.id === id && p.tool === tool) ?? null
      if (!provider) throw new Error('供应商不存在')
    }
    const result = await switchProviderForTool(tool, provider)
    store.current[tool] = id
    await saveStore(store)
    refreshTray()
    return result
  })

  ipcMain.handle('tool:importCurrent', (_e, tool: ToolId) => {
    assertTool(tool)
    return tool === 'claude' ? claude.importCurrentClaude() : codex.importCurrentCodex()
  })

  ipcMain.handle('tool:status', (_e, tool: ToolId) => {
    assertTool(tool)
    return tool === 'claude' ? claude.status() : codex.status()
  })

  ipcMain.handle('tool:backups', (_e, tool: ToolId) => {
    assertTool(tool)
    return tool === 'claude' ? claude.listBackups() : codex.listBackups()
  })

  ipcMain.handle('tool:restoreBackup', async (_e, tool: ToolId, file: string) => {
    assertTool(tool)
    return tool === 'claude' ? claude.restoreBackup(file) : codex.restoreBackup(file)
  })

  /** 连接测试入参校验（v0.8.7 审查修复 #10）：与其余 IPC 一致，不信任渲染层 */
  function validateTestInput(input: TestInput): void {
    if (!input || typeof input !== 'object') throw new Error('非法的测试参数')
    if (!TOOL_IDS.includes(input.tool)) throw new Error('非法的工具类型')
    if (!isStr(input.baseUrl) || !/^https?:\/\//i.test(input.baseUrl) || input.baseUrl.length > 2000) {
      throw new Error('Base URL 非法（仅允许 http/https，长度 ≤ 2000）')
    }
    if (!isStr(input.apiKey) || input.apiKey.length > 4000) throw new Error('API Key 非法（长度 ≤ 4000）')
    if (input.keyType !== undefined && !KEY_TYPES.includes(input.keyType)) throw new Error('非法的 Key 类型')
    if (input.protocol !== undefined && !PROTOCOLS.includes(input.protocol)) throw new Error('非法的接口协议')
    if (input.model !== undefined && (!isStr(input.model) || input.model.length > 200)) throw new Error('模型名过长')
  }

  ipcMain.handle('provider:test', (_e, input: TestInput) => {
    validateTestInput(input)
    return testProvider(input)
  })

  ipcMain.handle('ccswitch:import', () => importFromCcSwitch())

  ipcMain.handle('presets:get', () => PRESETS)

  ipcMain.handle('backup:export', (_e, passphrase: string) => backupExport(passphrase))

  ipcMain.handle('backup:import', (_e, passphrase: string) => backupImport(passphrase))

  ipcMain.handle('usage:get', () => usageStats())

  ipcMain.handle('sessions:list', (_e, tool: ToolId) => {
    assertTool(tool)
    return listSessions(tool)
  })

  ipcMain.handle('sessions:read', (_e, tool: ToolId, file: string) => {
    assertTool(tool)
    if (typeof file !== 'string' || file.length > 2000) throw new Error('非法的会话文件路径')
    return readSession(tool, file)
  })

  ipcMain.handle('sessions:exportMd', (_e, tool: ToolId, file: string) => {
    assertTool(tool)
    if (typeof file !== 'string' || file.length > 2000) throw new Error('非法的会话文件路径')
    return exportSessionMd(tool, file)
  })

  // ── 提示词库（v0.8.9） ──
  ipcMain.handle('prompts:list', async () => {
    return { prompts: listPrompts(), current: await currentPromptFiles() }
  })

  ipcMain.handle('prompts:save', (_e, input) => savePrompt(input))

  ipcMain.handle('prompts:delete', (_e, id: string) => {
    if (typeof id !== 'string' || id.length > 64) throw new Error('非法的 id')
    return deletePrompt(id)
  })

  ipcMain.handle('prompts:apply', (_e, id: string) => {
    if (typeof id !== 'string' || id.length > 64) throw new Error('非法的 id')
    return applyPrompt(id)
  })

  ipcMain.handle('prompts:importCurrent', (_e, tool: ToolId) => {
    assertTool(tool)
    return importCurrentPrompt(tool)
  })

  // ── 方案组（v0.8.9） ──
  ipcMain.handle('groups:list', () => listGroups())

  ipcMain.handle('groups:save', (_e, input) => saveGroup(input))

  ipcMain.handle('groups:delete', (_e, id: string) => {
    if (typeof id !== 'string' || id.length > 64) throw new Error('非法的 id')
    return deleteGroup(id)
  })

  ipcMain.handle('groups:apply', (_e, id: string) => {
    if (typeof id !== 'string' || id.length > 64) throw new Error('非法的 id')
    return applyGroup(id)
  })

  ipcMain.handle('mcp:list', (_e, tool: ToolId) => mcpList(tool))

  ipcMain.handle('mcp:save', (_e, tool: ToolId, spec) => mcpSave(tool, spec))

  ipcMain.handle('mcp:delete', (_e, tool: ToolId, name: string) => mcpDelete(tool, name))

  ipcMain.handle('router:status', () => routerStatus())

  ipcMain.handle('balance:get', (_e, input: { baseUrl: string; apiKey: string }) => {
    if (!input || !isStr(input.baseUrl) || !/^https?:\/\//i.test(input.baseUrl) || input.baseUrl.length > 2000) {
      throw new Error('非法的 Base URL')
    }
    if (!isStr(input.apiKey) || !input.apiKey || input.apiKey.length > 4000) throw new Error('非法的 API Key')
    return fetchBalance(input.baseUrl, input.apiKey)
  })

  ipcMain.handle('provider:setBalance', (_e, id: string, result) => {
    void recordBalance(id, result)
    return true
  })

  // ── CLI 工具版本管理（v0.8.8） ──
  ipcMain.handle('agentVersion:get', () => getAgentVersions())

  ipcMain.handle('agentVersion:upgrade', async (e, tool: ToolId) => {
    assertTool(tool)
    if (!win || win.isDestroyed()) throw new Error('主窗口不可用')
    const wc = e.sender
    const r = await upgradeAgent(tool, (line) => {
      if (!wc.isDestroyed()) wc.send('agentUpgrade:progress', { tool, line })
    })
    return r
  })

  ipcMain.handle('agentVersion:cancel', (_e, tool: ToolId) => {
    assertTool(tool)
    return { ok: cancelUpgrade(tool) }
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

  // 渲染层挂载时主动拉取一次：推送与监听注册之间存在竞态（v0.8.7 审查修复 #11）
  ipcMain.handle('deeplink:take', () => {
    const p = pendingDeeplink
    pendingDeeplink = null
    if (p && Date.now() - p.at <= DEEPLINK_TTL_MS) return p.parsed
    return null
  })

  ipcMain.handle('router:set', async (_e, tool: ToolId, enabled: boolean) => {
    assertTool(tool)
    if (typeof enabled !== 'boolean') throw new Error('非法的开关值')
    const store = loadStore()
    if (enabled && !store.current[tool]) throw new Error('请先选择一个供应商，再开启本机路由')
    if (!enabled && tool === 'claude' && store.current[tool]) {
      // OpenAI 协议供应商只能经路由使用，不能关（先切换到别的供应商才能关）
      const cur = store.providers.find((p) => p.id === store.current[tool])
      if (cur?.protocol === 'openai') {
        throw new Error('当前供应商是 OpenAI 兼容协议，必须经本机路由使用；请先切换到其它供应商')
      }
    }
    if (!enabled && tool === 'claude' && store.settings.router?.aggregate === true) {
      throw new Error('聚合模式开启中，本机路由不能关闭；请先关闭聚合模式')
    }
    const router = { claude: store.settings.router?.claude ?? false, codex: store.settings.router?.codex ?? false }
    router[tool] = enabled
    const needRouter = router.claude || router.codex
    // 先把路由进程拉起来（端口被占等失败会让本次什么都不写盘），再持久化设置（2026-10-31 审计 #9）
    if (needRouter) {
      await startRouter().catch((e) => {
        throw new Error(`路由服务启动失败：${(e as Error).message}`)
      })
    }
    store.settings.router = router
    await saveStore(store)
    if (!needRouter) stopRouter()
    // 按新模式重写该工具配置（无当前供应商时退回官方配置）
    const provider = store.current[tool] ? store.providers.find((p) => p.id === store.current[tool]) ?? null : null
    if (tool === 'claude') await claude.switchClaude(provider, enabled)
    else await codex.switchCodex(provider, enabled)
    return routerStatus()
  })

  ipcMain.handle('router:setAggregate', async (_e, tool: ToolId, enabled: boolean) => {
    assertTool(tool)
    if (tool !== 'claude') throw new Error('聚合模式目前仅支持 Claude Code 路由')
    if (typeof enabled !== 'boolean') throw new Error('非法的开关值')
    const store = loadStore()
    // 聚合配置同样落在客户端文件里（指向本机路由），需要路由进程在线
    await startRouter().catch((e: unknown) => {
      throw new Error(`路由服务启动失败：${(e as Error).message}`)
    })
    const router = {
      claude: store.settings.router?.claude ?? false,
      codex: store.settings.router?.codex ?? false,
      ...(store.settings.router?.port !== undefined ? { port: store.settings.router.port } : {}),
      ...(store.settings.router?.aggregate !== undefined ? { aggregate: store.settings.router.aggregate } : {})
    }
    router.aggregate = enabled
    // 聚合依赖本机路由：开启时同步打开 claude 路由开关，否则重启后路由不会自动拉起、
    // 而配置文件已指向本机路由 → Claude Code 断连（v0.8.7 审查修复 #1）
    if (enabled) router.claude = true
    store.settings.router = router
    await saveStore(store)
    // 开启聚合：配置指向本机路由（当前供应商继续作为无前缀请求的兜底）；关闭：按当前状态重写
    const provider = store.current.claude ? store.providers.find((p) => p.id === store.current.claude) ?? null : null
    if (enabled || router.claude) await claude.switchClaude(provider, true)
    else await claude.switchClaude(provider, false)
    return routerStatus()
  })

  ipcMain.handle('settings:update', async (_e, patch: Partial<AppSettings>) => {
    // IPC 是安全边界：patch 全字段校验 + 未知键拒绝（2026-10-31 审计）
    validateSettingsPatch(patch)
    const store = loadStore()
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

  ipcMain.handle('app:copyText', (_e, text: string) => {
    // 长度上限防滥用；内容写本机剪贴板，不出网
    if (typeof text !== 'string' || text.length > 10000) throw new Error('非法的剪贴板内容')
    clipboard.writeText(text)
    return true
  })

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
    // Windows 上点 ccsl:// 链接或双击快捷方式会启动第二个实例并由这里转交。
    // 关窗是 hide 不是 close：窗口处于隐藏态时 focus() 不会让它出现，必须先 show()（2026-10-31 用户实测 bug）
    const link = findDeeplinkInArgv(argv)
    if (link) deliverDeeplink(link)
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
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
    let store: ReturnType<typeof loadStore>
    try {
      store = loadStore()
    } catch {
      // 锁定态（主密码未解锁）或库损坏：用默认设置启动，渲染层显示解锁屏
      store = { version: 1, current: { claude: null, codex: null }, providers: [], settings: { autoUpdate: true, autoStart: false, theme: 'system' } }
    }
    applySettings(store.settings)
    createWindow(store.settings.theme)
    // 冷启动带深链（Windows 把链接作为 argv 传进来）
    const coldLink = findDeeplinkInArgv(process.argv)
    if (coldLink) deliverDeeplink(coldLink)
    createTray(showMainWindow)
    // 上次会话开启了路由模式 → 直接拉起代理（配置文件仍指向本机路由；含聚合模式，v0.8.7 审查修复 #1）
    autoStartRouterIfNeeded()
    void startupCheck(store.settings.autoUpdate)
    nativeTheme.on('updated', () => {
      // 锁定态下 loadStore 抛 LOCKED 会变成主进程未捕获异常对话框（v0.8.7 审查修复 #3）
      try {
        if (loadStore().settings.theme === 'system') syncTitleBar('system')
      } catch {
        /* 锁定态或读失败：跳过本次主题栏同步 */
      }
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
