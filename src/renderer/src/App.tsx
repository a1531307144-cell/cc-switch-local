import { useCallback, useEffect, useRef, useState } from 'react'
import type { Provider, StoreShape, ToolId, ToolStatus } from '../../shared/types'
import ProviderCard from './components/ProviderCard'
import ProviderForm, { emptyDraft, type FormDraft } from './components/ProviderForm'
import SettingsPanel from './components/SettingsPanel'
import logoUrl from './assets/logo.png'

type View = ToolId | 'settings'

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
  const [draft, setDraft] = useState<FormDraft | null>(null)
  const [toast, setToast] = useState<{ text: string; kind: 'ok' | 'err' } | null>(null)
  const [busyTool, setBusyTool] = useState<ToolId | null>(null)
  const [importing, setImporting] = useState(false)

  const toastTimer = useRef<number | undefined>(undefined)
  const notify = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ text, kind })
    if (toastTimer.current !== undefined) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 3600)
  }, [])

  const refresh = useCallback(async () => {
    const [s, cs, xs] = await Promise.all([
      window.api.storeGet(),
      window.api.toolStatus('claude'),
      window.api.toolStatus('codex')
    ])
    setStore(s)
    setStatus({ claude: cs, codex: xs })
  }, [])

  useEffect(() => {
    refresh().catch(() => notify('初始化失败', 'err'))
  }, [refresh, notify])

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

  const toolView = view !== 'settings'
  const activeTool = view as ToolId
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
        <button className={`nav ${view === 'settings' ? 'active' : ''}`} onClick={() => setView('settings')}>
          <span>设置</span>
        </button>
        <div className="sidebar-foot">
          <p className="muted small">数据仅存本机 · 无遥测</p>
          <p className="muted small">每次写入前自动备份</p>
        </div>
      </aside>

      <main className="main">
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
        {view === 'settings' && <SettingsPanel store={store} onChanged={refresh} notify={notify} />}
      </main>

      {draft && <ProviderForm draft={draft} onClose={() => setDraft(null)} onSave={save} />}
      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}
      </div>
    </>
  )
}
