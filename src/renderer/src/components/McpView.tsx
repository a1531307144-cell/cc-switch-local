import { useCallback, useEffect, useState } from 'react'
import type { Lang, McpListResult, McpServerSpec, ToolId } from '../../../shared/types'
import { t } from '../../../shared/i18n'

/** MCP 服务器管理（v0.8.5）：Claude（~/.claude.json）与 Codex（config.toml）统一面板 */
export default function McpView({ lang, notify }: { lang: Lang; notify: (text: string, kind?: 'ok' | 'err') => void }) {
  const [data, setData] = useState<Record<ToolId, McpListResult>>({
    claude: { tool: 'claude', file: '', servers: [] },
    codex: { tool: 'codex', file: '', servers: [] }
  })
  const [form, setForm] = useState<McpServerSpec | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    try {
      const [c, x] = await Promise.all([window.api.mcpList('claude'), window.api.mcpList('codex')])
      setData({ claude: c, codex: x })
    } catch (e) {
      notify((e as Error).message, 'err')
    }
  }, [notify])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (): Promise<void> => {
    if (!form) return
    if (!form.name.trim() || !form.command.trim()) {
      setErr(t(lang, 'form.err.name'))
      return
    }
    // args/env 从多行文本解析（main 侧再做完整校验）
    const args = form.args.filter((a) => a.trim() !== '')
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(form.env)) {
      if (k.trim() !== '') env[k.trim()] = v
    }
    setSaving(true)
    setErr('')
    try {
      await window.api.mcpSave((form as McpServerSpec & { __tool?: ToolId }).__tool ?? 'claude', {
        name: form.name.trim(),
        command: form.command.trim(),
        args,
        env
      })
      notify(t(lang, 'mcp.saved', { name: form.name.trim() }))
      setForm(null)
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const del = async (tool: ToolId, name: string): Promise<void> => {
    if (!window.confirm(t(lang, 'mcp.confirmDelete', { name }))) return
    try {
      await window.api.mcpDelete(tool, name)
      notify(t(lang, 'mcp.deleted', { name }))
      await load()
    } catch (e) {
      notify(t(lang, 'mcp.deleteFail', { msg: (e as Error).message }), 'err')
    }
  }

  const openAdd = (tool: ToolId): void => {
    setForm({ __tool: tool, name: '', command: '', args: [], env: {} } as McpServerSpec & { __tool?: ToolId })
    setErr('')
  }

  const renderTool = (tool: ToolId) => {
    const d = data[tool]
    return (
      <section className="card">
        <h3>{tool === 'claude' ? 'Claude Code' : 'Codex'}</h3>
        {d.servers.length === 0 ? (
          <p className="muted small">{t(lang, 'mcp.none')}</p>
        ) : (
          <table className="backup-table">
            <thead>
              <tr>
                <th>{t(lang, 'mcp.name')}</th>
                <th>{t(lang, 'mcp.command')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {d.servers.map((s) => (
                <tr key={s.name}>
                  <td>
                    <code className="small">{s.name}</code>
                    {Object.keys(s.env).length > 0 && <span className="badge-muted"> env×{Object.keys(s.env).length}</span>}
                  </td>
                  <td className="muted small">
                    {s.command} {s.args.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}
                  </td>
                  <td>
                    <button type="button" className="btn sm danger-ghost" onClick={() => void del(tool, s.name)}>
                      {t(lang, 'card.delete')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="btn-row">
          <button type="button" className="btn sm" onClick={() => openAdd(tool)}>
            {t(lang, 'mcp.add')}
          </button>
        </div>
      </section>
    )
  }

  return (
    <div className="settings">
      <section className="card">
        <h3>{t(lang, 'mcp.title')}</h3>
        <p className="muted small">{t(lang, 'mcp.desc')}</p>
      </section>
      {renderTool('claude')}
      {renderTool('codex')}

      {form && (
        <div className="modal-overlay" onClick={() => (saving ? undefined : setForm(null))}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>
                {t(lang, 'mcp.add')}
                <span className="muted small"> · {t(lang, 'mcp.editTitle')}</span>
              </h3>
              <button type="button" className="btn ghost sm" onClick={() => setForm(null)} aria-label="关闭">
                ✕
              </button>
            </div>
            <div className="form">
              <label>
                {t(lang, 'mcp.name')}
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t(lang, 'mcp.namePh')}
                  autoFocus
                />
              </label>
              <label>
                {t(lang, 'mcp.command')}
                <input value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} placeholder={t(lang, 'mcp.commandPh')} />
              </label>
              <label>
                {t(lang, 'mcp.args')}
                <textarea
                  rows={3}
                  value={form.args.join('\n')}
                  onChange={(e) => setForm({ ...form, args: e.target.value.split('\n') })}
                  placeholder={t(lang, 'mcp.argsPh')}
                />
              </label>
              <label>
                {t(lang, 'mcp.env')}
                <textarea
                  rows={3}
                  value={Object.entries(form.env)
                    .map(([k, v]) => `${k}=${v}`)
                    .join('\n')}
                  onChange={(e) => {
                    const env: Record<string, string> = {}
                    for (const line of e.target.value.split('\n')) {
                      const i = line.indexOf('=')
                      if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1)
                    }
                    setForm({ ...form, env })
                  }}
                  placeholder={t(lang, 'mcp.envPh')}
                />
              </label>
              {err && <div className="form-error">{err}</div>}
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setForm(null)} disabled={saving}>
                  {t(lang, 'btn.cancel')}
                </button>
                <button type="button" className="btn primary" onClick={() => void save()} disabled={saving}>
                  {saving ? t(lang, 'btn.saving') : t(lang, 'btn.save')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
