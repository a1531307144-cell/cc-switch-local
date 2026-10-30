import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { DeeplinkResult, Lang, Provider, RouterStatus, StoreShape, ToolId, ToolStatus } from '../../shared/types'
import { t } from '../../shared/i18n'
import { detectVendor } from '../../shared/vendors'
import ProviderCard from './components/ProviderCard'
import ProviderForm, { emptyDraft, type FormDraft } from './components/ProviderForm'
import SettingsPanel from './components/SettingsPanel'
import UsageDashboard from './components/UsageDashboard'
import { IconChart, IconChevronLeft, IconChevronRight, IconGear, IconSearch } from './components/Icons'
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
  const [query, setQuery] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const lang: Lang = store?.settings.language === 'en' ? 'en' : 'zh'
  const tr = useCallback((key: Parameters<typeof t>[1], vars?: Record<string, string | number>) => t(lang, key, vars), [lang])
  const collapsed = store?.settings.sidebarCollapsed === true

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
    refresh().catch(() => notify(t('zh', 'app.initFail'), 'err'))
  }, [refresh, notify])

  // 更新事件（启动静默检查发现新版 / 下载进度 / 下载完成）+ 托盘侧数据变更 + 深链
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
    const un5 = window.api.onDeeplinkProvider((r: DeeplinkResult) => {
      if (r.ok && r.input) {
        setDraft({
          ...emptyDraft(r.input.tool),
          name: r.input.name,
          baseUrl: r.input.baseUrl,
          apiKey: '',
          keyType: r.input.keyType ?? 'auth_token',
          model: r.input.model ?? '',
          wireApi: r.input.wireApi ?? 'responses',
          notes: t(store?.settings.language === 'en' ? 'en' : 'zh', 'form.deeplinkNote')
        })
        notify(
          t(store?.settings.language === 'en' ? 'en' : 'zh', 'deeplink.okToast', { name: r.input.name })
        )
      } else {
        notify(t(store?.settings.language === 'en' ? 'en' : 'zh', 'deeplink.errToast', { msg: r.error ?? '' }), 'err')
      }
    })
    return () => {
      un1()
      un2()
      un3()
      un4()
      un5()
    }
  }, [refresh, store?.settings.language])

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
      notify(tr('update.foundToast', { v: r.version }))
    } else {
      setUpdateState('idle')
      notify(tr('update.latestToast'))
    }
  }, [notify, tr])

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
  }, [notify])

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

  if (!store) return <div className="loading">{tr('app.loading')}</div>

  const toolView = view === 'claude' || view === 'codex'
  const activeTool = toolView ? (view as ToolId) : 'claude'
  const currentId = toolView ? store.current[activeTool] : null
  const providers = toolView ? store.providers.filter((p) => p.tool === activeTool) : []
  const currentProvider = providers.find((p) => p.id === currentId) ?? null
  const q = query.trim().toLowerCase()
  const shown =
    q === ''
      ? providers
      : providers.filter(
          (p) => p.name.toLowerCase().includes(q) || (detectVendor(p.baseUrl)?.name ?? '').toLowerCase().includes(q)
        )

  const toggleSidebar = async () => {
    try {
      await window.api.settingsUpdate({ sidebarCollapsed: !collapsed })
      await refresh()
    } catch (e) {
      notify((e as Error).message, 'err')
    }
  }

  const switchTo = async (p: Provider | null) => {
    const tool = p ? p.tool : activeTool
    setBusyTool(tool)
    try {
      await window.api.providerSwitch(tool, p ? p.id : null)
      notify(
        p
          ? tr('toast.switched', { name: p.name, tool: TOOL_LABEL[tool] })
          : tr('toast.restoredOfficial')
      )
      await refresh()
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setBusyTool(null)
    }
  }

  const del = async (p: Provider) => {
    try {
      await window.api.providerDelete(p.id)
      notify(tr('toast.deleted', { name: p.name }))
      await refresh()
    } catch (e) {
      notify((e as Error).message, 'err')
    }
  }

  const clone = async (p: Provider) => {
    try {
      const copy = await window.api.providerClone(p.id)
      notify(tr('toast.cloned', { name: copy.name }))
      await refresh()
    } catch (e) {
      notify((e as Error).message, 'err')
    }
  }

  /** 拖拽排序：乐观更新本地状态，再持久化（失败时 refresh 拉回真实顺序） */
  const reorder = async (fromId: string, toId: string) => {
    const ids = providers.map((p) => p.id)
    const from = ids.indexOf(fromId)
    const to = ids.indexOf(toId)
    if (from < 0 || to < 0 || from === to) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    const next = ids.map((id) => providers.find((p) => p.id === id)!)
    let k = 0
    setStore({ ...store, providers: store.providers.map((p) => (p.tool === activeTool ? next[k++] : p)) })
    try {
      await window.api.providersReorder(activeTool, ids)
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      await refresh()
    }
  }

  const handleDragStart = (id: string, e: DragEvent) => {
    setDragId(id)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  const handleDragOver = (id: string, e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (id !== dragId) setOverId(id)
  }
  const handleDrop = (id: string, e: DragEvent) => {
    e.preventDefault()
    const src = dragId ?? e.dataTransfer.getData('text/plain')
    setOverId(null)
    setDragId(null)
    if (src && src !== id) void reorder(src, id)
  }
  const handleDragEnd = () => {
    setOverId(null)
    setDragId(null)
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
    notify(d.id ? tr('toast.saved') : tr('toast.added'))
    setDraft(null)
    await refresh()
  }

  const importCurrent = async (tool: ToolId) => {
    try {
      const cur = await window.api.toolImportCurrent(tool)
      if (!cur) {
        notify(`${tr('tool.importCurrent')}：${TOOL_LABEL[tool]} — ${tr('tool.unmanaged')}`, 'err')
        return
      }
      setDraft({
        ...emptyDraft(tool),
        name: 'Imported current config',
        baseUrl: cur.baseUrl,
        apiKey: cur.apiKey,
        keyType: cur.keyType,
        model: cur.model ?? '',
        wireApi: cur.wireApi ?? 'responses'
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
        notify(tr('toast.importNone', { detail: rep.details.join('；') }), 'err')
        return
      }
      let i = 0
      for (const p of rep.providers) {
        i += 1
        await window.api.providerSave({
          tool: 'claude',
          name: p.name || `cc-switch import ${i}`,
          baseUrl: p.baseUrl,
          apiKey: p.apiKey,
          keyType: p.keyType,
          notes: `cc-switch (${p.source})`
        })
      }
      notify(tr('toast.imported', { n: rep.imported }))
      await refresh()
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setImporting(false)
    }
  }

  const toggleRouter = async () => {
    const enabling = !(routerState?.[activeTool]?.enabled)
    try {
      const r = await window.api.routerSet(activeTool, enabling)
      setRouterState(r)
      notify(enabling ? tr('router.enabledToast') : tr('router.disabledToast'))
      await refresh()
    } catch (e) {
      notify((e as Error).message, 'err')
    }
  }

  return (
    <>
      <div className="titlebar">
        <img src={logoUrl} alt="" draggable={false} />
        <span className="titlebar-title">CC Switch Local</span>
      </div>
      <div className="app">
        <aside className={`sidebar${collapsed ? ' collapsed' : ''}`}>
          <div className="brand">
            <img className="logo-img" src={logoUrl} alt="" draggable={false} />
            {!collapsed && (
              <div>
                <div className="brand-name">CC Switch Local</div>
                <div className="brand-sub">{tr('app.subtitle')}</div>
              </div>
            )}
          </div>
          {TOOLS.map((tl) => (
            <button
              key={tl.id}
              type="button"
              className={`nav${view === tl.id ? ' active' : ''}`}
              onClick={() => setView(tl.id)}
              title={collapsed ? tl.label : undefined}
            >
              {collapsed ? <span className="nav-chip">{tl.id === 'claude' ? 'CC' : 'CX'}</span> : <span>{tl.label}</span>}
              {!collapsed && <span className="count">{store.providers.filter((p) => p.tool === tl.id).length}</span>}
            </button>
          ))}
          <div className="nav-divider" />
          <button
            type="button"
            className={`nav icon${view === 'usage' ? ' active' : ''}`}
            onClick={() => setView('usage')}
            title={collapsed ? tr('side.usage') : undefined}
          >
            <IconChart />
            {!collapsed && <span>{tr('side.usage')}</span>}
          </button>
          <button
            type="button"
            className={`nav icon${view === 'settings' ? ' active' : ''}`}
            onClick={() => setView('settings')}
            title={collapsed ? tr('side.settings') : undefined}
          >
            <IconGear />
            {!collapsed && <span>{tr('side.settings')}</span>}
          </button>
          <div className="sidebar-foot">
            {!collapsed && (
              <>
                <p className="muted small">{tr('side.privacy1')}</p>
                <p className="muted small">{tr('side.privacy2')}</p>
              </>
            )}
            <button
              type="button"
              className={`nav icon${collapsed ? ' icon-only' : ''}`}
              onClick={() => void toggleSidebar()}
              title={collapsed ? tr('side.expand') : tr('side.collapse')}
            >
              {collapsed ? <IconChevronRight /> : <><IconChevronLeft /><span>{tr('side.collapse')}</span></>}
            </button>
          </div>
        </aside>

        <main className="main">
          {updateState === 'available' && (
            <div className="update-banner">
              <span>{tr('update.available', { v: updateVersion })}</span>
              <div className="btn-row">
                <button className="btn primary sm" onClick={startDownload}>
                  {tr('update.downloadNow')}
                </button>
                <button className="btn ghost sm" onClick={() => setUpdateState('idle')}>
                  {tr('update.later')}
                </button>
              </div>
            </div>
          )}
          {updateState === 'downloading' && (
            <div className="update-banner">
              <span>
                {tr('update.downloading', { v: updateVersion })}
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
                  {tr('update.later')}
                </button>
              </div>
            </div>
          )}
          {updateState === 'downloaded' && (
            <div className="update-banner">
              <span>{tr('update.ready')}</span>
              <button className="btn primary sm" onClick={() => void window.api.updateInstall()}>
                {tr('update.restartInstall')}
              </button>
            </div>
          )}
          {updateError && (
            <div className="update-banner err">
              <span>{updateError}</span>
              <div className="btn-row">
                <button className="btn sm" onClick={() => void window.api.openReleases()}>
                  {tr('update.openReleases')}
                </button>
                <button className="btn ghost sm" onClick={() => setUpdateError('')}>
                  {tr('update.close')}
                </button>
              </div>
            </div>
          )}

          {toolView && (
            <>
              <div className="page-head">
                <div className="page-head-main">
                  <h2 title={activeTool === 'claude' ? tr('tool.hint.claude') : tr('tool.hint.codex')}>
                    {TOOL_LABEL[activeTool]}
                  </h2>
                  <p className="muted small">
                    {currentId && currentProvider ? (
                      <>
                        {tr('tool.statusActive')}
                        <strong>{currentProvider.name}</strong>
                        {tr('tool.managed')}
                        <button className="link-btn" onClick={() => void switchTo(null)} disabled={busyTool !== null}>
                          {tr('tool.restoreOfficial')}
                        </button>
                      </>
                    ) : status[activeTool].currentBaseUrl ? (
                      <>
                        {tr('tool.external')}
                        {status[activeTool].currentBaseUrl}
                      </>
                    ) : (
                      tr('tool.unmanaged')
                    )}
                  </p>
                </div>
                <div className="page-head-actions">
                  <button
                    type="button"
                    className={`btn sm ${routerState?.[activeTool]?.enabled ? 'primary' : ''}`}
                    onClick={toggleRouter}
                    title={
                      routerState?.running
                        ? tr('router.tipOn', { port: routerState.port, req: routerState[activeTool].requests, err: routerState[activeTool].errors })
                        : tr('router.tipOff')
                    }
                  >
                    {routerState?.[activeTool]?.enabled ? tr('router.on') : tr('router.off')}
                  </button>
                  <div
                    className="dd"
                    onBlur={() => {
                      window.setTimeout(() => setImportOpen(false), 120)
                    }}
                  >
                    <button type="button" className="btn sm" onClick={() => setImportOpen((v) => !v)}>
                      {tr('zone.import')} ▾
                    </button>
                    {importOpen && (
                      <div className="menu">
                        <button
                          type="button"
                          className="menu-item"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setImportOpen(false)
                            void importCurrent(activeTool)
                          }}
                        >
                          {tr('tool.importCurrent')}
                        </button>
                        {activeTool === 'claude' && (
                          <button
                            type="button"
                            className="menu-item"
                            onMouseDown={(e) => e.preventDefault()}
                            disabled={importing}
                            onClick={() => {
                              setImportOpen(false)
                              void importCcSwitch()
                            }}
                          >
                            {importing ? tr('tool.importing') : tr('tool.importCcSwitch')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="search">
                    <IconSearch />
                    <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('zone.searchPh')} />
                  </div>
                  <button type="button" className="btn primary sm" onClick={() => setDraft(emptyDraft(activeTool))}>
                    {tr('tool.new')}
                  </button>
                </div>
              </div>

              {providers.length === 0 ? (
                <div className="empty">
                  <p>{tr('tool.emptyTitle', { tool: TOOL_LABEL[activeTool] })}</p>
                  <p className="muted small">{tr('tool.emptyHint')}</p>
                </div>
              ) : shown.length === 0 ? (
                <div className="empty">
                  <p>{tr('zone.noneMatch', { q: query.trim() })}</p>
                </div>
              ) : (
                <>
                  {providers.length > 1 && <div className="drag-hint muted small">{tr('zone.dragHint')}</div>}
                  <div className="provider-grid">
                    {shown.map((p) => (
                      <ProviderCard
                        key={p.id}
                        provider={p}
                        lang={lang}
                        isCurrent={p.id === currentId}
                        busy={busyTool === p.tool}
                        dragging={dragId === p.id}
                        dropTarget={overId === p.id}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                        onDragEnd={handleDragEnd}
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
                        onClone={clone}
                        onDelete={del}
                      />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
          {view === 'usage' && <UsageDashboard lang={lang} notify={notify} />}
          {view === 'settings' && (
            <SettingsPanel store={store} lang={lang} onChanged={refresh} notify={notify} onCheckUpdate={runCheck} updateChecking={updateState === 'checking'} />
          )}
        </main>

        {draft && <ProviderForm draft={draft} lang={lang} onClose={() => setDraft(null)} onSave={save} />}
        {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
      </div>
    </>
  )
}
