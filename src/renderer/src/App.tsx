import { useCallback, useEffect, useRef, useState } from 'react'
import type { Provider, RouterStatus, StoreShape, ToolId, ToolStatus } from '../../shared/types'
import ProviderCard from './components/ProviderCard'
import ProviderForm, { emptyDraft, type FormDraft } from './components/ProviderForm'
import SettingsPanel from './components/SettingsPanel'
import UsageDashboard from './components/UsageDashboard'
import logoUrl from './assets/logo.png'

type View = ToolId | 'usage' | 'settings'

const TOOLS: { id: ToolId; label: string }[] = [
  { id: 'claude', label: 'Claude Code' },
  { id: 'codex', label: 'Codex' }
]
const TOOL_LABEL: Record<ToolId, string> = { claude: 'Claude Code', codex: 'Codex' }

export default function App() {
  const [store, setStore] = useState<StoreShape | null>(null)
  const [view, setView] = useState<View>('claude')
  const [status, setStatus] = useState<Record<ToolId, ToolStatus>>({
    claude: { configPath: '', exists: false },
    codex: { configPath: '', exists: false }
  })
  const [routerState, setRouterState] = useState<RouterStatus | null>(null)
  const [draft, setDraft] = useState<FormDraft | null>(null)
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  const [busyTool, setBusyTool] = useState<ToolId | null>(null)
  const [importing, setImporting] = useState(false)
  const [updateState, setUpdateState] = useState<'idle' | 'checking' | 'available' | 'downloading' | 'downloaded'>('idle')
  const [updateVersion, setUpdateVersion] = useState('')
  const [updatePercent, setUpdatePercent] = useState(0)
  const [updateBytes, setUpdateBytes] = useState<{ transferred: number; total: number; bps: number } | null>(null)
  const [updateError, setUpdateError] = useState('')

  const fmtMB = (n: number): string => `${(n / 1048576).toFixed(1)} MB`

  const toastTimer = useRef<number | undefined>(undefined)
  const notify = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ text, kind })
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3600)
  }, [])

  const refresh = useCallback(async () => {
    const [s, cs, xs, rs] = await Promise.all([
      window.api.storeGet(),
      window.api.toolStatus('claude'),
      window.api.toolStatus('codex'),
      window.api.routerStatus().catch(() => null)
    ])
    setStore(s)
    setStatus({ claude: cs, codex: xs })
    setRouterState(rs)
  }, [])

  useEffect(() => {
    refresh().catch(() => notify('初始化失败', 'err'))
  }, [refresh, notify])

  // 更新事件（启动静默检查发现新版 / 下载进度 / 下载完成）
  useEffect(() => {
    const un1 = window.api.onUpdateAvailable((p) => {
      setUpdateVersion(p.version)
      setUpdateError('')
      setUpdateState('available')
    })
    const un2 = window.api.onUpdateProgress((p) => {
      setUpdatePercent(p.percent)
      if (p.total) setUpdateBytes({ transferred: p.transferred ?? 0, total: p.total, bps: p.bytesPerSecond ?? 0 })
    })
    const un3 = window.api.onUpdateDownloaded(() => setUpdateState('downloaded'))
    const un4 = window.api.onStoreChanged(() => {
      void refresh()
    })
    return () => {
      un1()
      un2()
      un3()
      un4()
    }
  }, [refresh])

  const runCheck = useCallback(async () => {
    setUpdateState('checking')
    const r = await window.api.updateCheck()
    if (r.error) {
      setUpdateError(r.error)
      setUpdateState('idle')
      notify(r.error, 'err')
      return
    }
    if (r.version && r.version !== r.current) {
      setUpdateVersion(r.version)
      setUpdateError('')
      setUpdateState('available')
      notify(`发现新版本 v${r.version}`)
    } else {
      setUpdateState('idle')
      notify('已是最新版本')
    }
  }, [notify])

  const startDownload = useCallback(async () => {
    setUpdateState('downloading')
    setUpdatePercent(0)
    setUpdateBytes(null)
    setUpdateError('')
    const r = await window.api.updateDownload()
    if (r.error) {
      setUpdateError(r.error)
      setUpdateState('idle')
      notify(r.error, 'err')
    }
  }, [])

  const cancelDownload = useCallback(async () => {
    await window.api.updateCancel()
    setUpdateState('idle')
    setUpdateBytes(null)
  }, [])

  const theme = store?.settings.theme
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme === 'dark' || ((theme === undefined || theme === 'system') && mq.matches)
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  if (!store) return <div className="loading">加载中…</div>

  const toolView = view === 'claude' || view === 'codex'
  const activeTool = toolView ? (view as ToolId) : 'claude'
  const currentId = toolView ? store.current[activeTool] : null
  const providers = toolView ? store.providers.filter((p) => p.tool === activeTool) : []
  const currentProvider = providers.find((p) => p.id === currentId) ?? null

  const switchTo = async (p: Provider | null) => {
    const tool = p ? p.tool : activeTool
    setBusyTool(tool)
    try {
      await window.api.providerSwitch(tool, p ? p.id : null)
      notify(p ? `已切换到「${p.name}」。重启 ${TOOL_LABEL[tool]} 会话后生效。` : '已恢复官方登录配置（清除代理键）。')
      await refresh()
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setBusyTool(null)
    }
  }

  const toggleRouter = async () => {
    const enabling = !(routerState?.[activeTool]?.enabled)
    try {
      const r = await window.api.routerSet(activeTool, enabling)
      setRouterState(r)
      notify(
        enabling
          ? '已开启本机路由：重启工具会话后生效；路由模式下切换供应商即时生效，上游故障自动转移'
          : '已切回直连模式：重启工具会话后生效'
      )
      await refresh()
    } catch (e) {
      notify((e as Error).message, 'err')
    }
  }

  const del = async (p: Provider) => {
    try {
      await window.api.providerDelete(p.id)
      notify(`已删除「${p.name}」`)
      await refresh()
    } catch (e) {
      notify((e as Error).message, 'err')
    }
  }

  const save = async (d: FormDraft) => {
    await window.api.providerSave({
      id: d.id,
      tool: d.tool,
      name: d.name.trim(),
      baseUrl: d.baseUrl.trim(),
      apiKey: d.apiKey.trim(),
      keyType: d.keyType,
      model: d.model.trim(),
      wireApi: d.wireApi,
      notes: d.notes.trim()
    })
    notify(d.id ? '已保存' : '已添加')
    setDraft(null)
    await refresh()
  }

  const importCurrent = async (tool: ToolId) => {
    try {
      const cur = await window.api.toolImportCurrent(tool)
      if (!cur) {
        notify(`未在 ${TOOL_LABEL[tool]} 配置中找到可导入的 API 配置`, 'err')
        return
      }
      setDraft({
        ...emptyDraft(tool),
        name: '导入的当前配置',
        baseUrl: cur.baseUrl,
        apiKey: cur.apiKey,
        keyType: cur.keyType,
        model: cur.model ?? '',
        wireApi: cur.wireApi ?? 'responses',
        notes: '由「导入当前配置」生成'
      })
    } catch (e) {
      notify((e as Error).message, 'err')
    }
  }

  const importCcSwitch = async () => {
    setImporting(true)
    try {
      const rep = await window.api.ccswitchImport()
      if (rep.imported === 0) {
        notify(`没有需要导入的新供应商。${rep.details.join('；')}`, 'err')
        return
      }
      let i = 0
      for (const p of rep.providers) {
        i += 1
        await window.api.providerSave({
          tool: 'claude',
          name: p.name || `cc-switch 导入 ${i}`,
          baseUrl: p.baseUrl,
          apiKey: p.apiKey,
          keyType: p.keyType,
          notes: `迁移自 cc-switch（${p.source}）`
        })
      }
      notify(`成功从 cc-switch 导入 ${rep.imported} 条供应商`)
      await refresh()
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <div className="titlebar">
        <img src={logoUrl} alt="" draggable={false} />
        <span className="titlebar-title">CC Switch Local</span>
      </div>
      <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <img className="logo-img" src={logoUrl} alt="" draggable={false} />
          <div>
            <div className="brand-name">CC Switch Local</div>
            <div className="brand-sub">本地 API 供应商管理</div>
          </div>
        </div>
        {TOOLS.map((t) => (
          <button key={t.id} className={`nav ${view === t.id ? 'active' : ''}`} onClick={() => setView(t.id)}>
            <span>{t.label}</span>
            <span className="count">{store.providers.filter((p) => p.tool === t.id).length}</span>
          </button>
        ))}
        <button className={`nav ${view === 'usage' ? 'active' : ''}`} onClick={() => setView('usage')}>
          <span>用量统计</span>
        </button>
        <button className={`nav ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
          <span>设置</span>
        </button>
        <div className="sidebar-foot">
          <p className="muted small">数据仅存本机 · 无遥测</p>
          <p className="muted small">每次写入前自动备份</p>
        </div>
      </aside>

      <main className="main">
        {updateState === 'available' && (
          <div className="update-banner">
            <span>发现新版本 v{updateVersion}</span>
            <div className="btn-row">
              <button className="btn primary sm" onClick={startDownload}>
                立即下载
              </button>
              <button className="btn ghost sm" onClick={() => setUpdateState('idle')}>
                稍后
              </button>
            </div>
          </div>
        )}
        {updateState === 'downloading' && (
          <div className="update-banner">
            <span>
              正在下载 v{updateVersion}…
              {updateBytes ? (
                <>
                  {' '}
                  {fmtMB(updateBytes.transferred)} / {fmtMB(updateBytes.total)}
                  {updateBytes.bps > 0 ? `（${fmtMB(updateBytes.bps)}/s）` : ''}
                </>
              ) : (
                ` ${updatePercent}%`
              )}
            </span>
            <div className="update-download-row">
              <div className="update-bar">
                <div className="update-bar-fill" style={{ width: `${updatePercent}%` }} />
              </div>
              <button className="btn ghost sm" onClick={cancelDownload}>
                取消
              </button>
            </div>
          </div>
        )}
        {updateState === 'downloaded' && (
          <div className="update-banner">
            <span>更新已就绪，点击后重启并自动安装</span>
            <button className="btn primary sm" onClick={() => void window.api.updateInstall()}>
              重启并安装
            </button>
          </div>
        )}
        {updateError && (
          <div className="update-banner err">
            <span>{updateError}</span>
            <div className="btn-row">
              <button className="btn sm" onClick={() => void window.api.openReleases()}>
                打开发布页
              </button>
              <button className="btn ghost sm" onClick={() => setUpdateError('')}>
                关闭
              </button>
            </div>
          </div>
        )}
        {toolView && (
          <>
            <div className="toolbar">
              <div>
                <h2>{TOOL_LABEL[activeTool]}</h2>
                <p className="muted small">
                  切换会改写 {activeTool === 'claude' ? '~/.claude/settings.json' : '~/.codex/config.toml 与 auth.json'}
                  ，其余配置原样保留；重启对应工具会话后生效
                </p>
              </div>
              <div className="btn-row">
                <button
                  className={`btn sm ${routerState?.[activeTool]?.enabled ? 'primary' : ''}`}
                  onClick={toggleRouter}
                  title={
                    routerState?.running
                      ? `本机路由运行中（127.0.0.1:${routerState.port}）；${activeTool === 'claude' ? 'Claude' : 'Codex'} 已转发 ${routerState[activeTool].requests} 次，故障转移 ${routerState[activeTool].errors} 次`
                      : '开启后请求经本机代理转发，支持自动故障转移'
                  }
                >
                  {routerState?.[activeTool]?.enabled ? '本机路由：开' : '本机路由：关'}
                </button>
                <button className="btn sm" onClick={() => importCurrent(activeTool)}>
                  导入当前配置
                </button>
                {activeTool === 'claude' && (
                  <button className="btn sm" onClick={importCcSwitch} disabled={importing}>
                    {importing ? '导入中…' : '从 cc-switch 导入'}
                  </button>
                )}
                <button className="btn primary sm" onClick={() => setDraft(emptyDraft(activeTool))}>
                  + 新建供应商
                </button>
              </div>
            </div>

            <div className={`status-bar ${currentId ? 'managed' : ''}`}>
              <span>
                {currentId && currentProvider ? (
                  <>
                    当前生效：<strong>{currentProvider.name}</strong>（本工具管理）
                  </>
                ) : status[activeTool].currentBaseUrl ? (
                  <>检测到外部配置：{status[activeTool].currentBaseUrl}</>
                ) : (
                  <>未接管配置（官方登录或尚未设置）</>
                )}
              </span>
              <button className="btn ghost sm" onClick={() => switchTo(null)} disabled={busyTool !== null}>
                恢复官方配置
              </button>
            </div>

            <div
              className="path-line muted small"
              onClick={() => window.api.openPath(activeTool === 'claude' ? 'claudeConfig' : 'codexConfig')}
              title="点击打开配置目录"
            >
              配置目录：{status[activeTool].configPath || '…'}（点击打开）
            </div>

            <div className="list">
              {providers.length === 0 ? (
                <div className="empty">
                  <p>还没有 {TOOL_LABEL[activeTool]} 的供应商。</p>
                  <p className="muted small">
                    点右上角「+ 新建供应商」添加；已有配置可点「导入当前配置」一键带入；用过原版 cc-switch
                    的话，「从 cc-switch 导入」可以自动迁移。
                  </p>
                </div>
              ) : (
                providers.map((p) => (
                  <ProviderCard
                    key={p.id}
                    provider={p}
                    isCurrent={p.id === currentId}
                    busy={busyTool === p.tool}
                    onSwitch={switchTo}
                    onEdit={(x) =>
                      setDraft({
                        ...emptyDraft(x.tool),
                        id: x.id,
                        name: x.name,
                        baseUrl: x.baseUrl,
                        apiKey: x.apiKey,
                        keyType: x.keyType,
                        model: x.model ?? '',
                        wireApi: x.wireApi ?? 'responses',
                        notes: x.notes ?? ''
                      })
                    }
                    onDelete={del}
                  />
                ))
              )}
            </div>
          </>
        )}
        {view === 'usage' && <UsageDashboard notify={notify} />}
        {view === 'settings' && (
          <SettingsPanel store={store} onChanged={refresh} notify={notify} onCheckUpdate={runCheck} updateChecking={updateState === 'checking'} />
        )}
      </main>

      {draft && <ProviderForm draft={draft} onClose={() => setDraft(null)} onSave={save} />}
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
      </div>
    </>
  )
}
