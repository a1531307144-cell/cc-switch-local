import { useCallback, useEffect, useState } from 'react'
import type { CurrentPromptFile, Lang, StoredPrompt, ToolId } from '../../../shared/types'
import { t } from '../../../shared/i18n'

const PROMPT_FILES: Record<ToolId, string> = { claude: 'CLAUDE.md', codex: 'AGENTS.md' }

/** 提示词库（v0.8.9）：管理并一键应用 CLAUDE.md / AGENTS.md */
export default function PromptsView({ lang, notify }: { lang: Lang; notify: (text: string, kind?: 'ok' | 'err') => void }) {
  const [tool, setTool] = useState<ToolId>('claude')
  const [prompts, setPrompts] = useState<StoredPrompt[]>([])
  const [current, setCurrent] = useState<{ claude: CurrentPromptFile; codex: CurrentPromptFile } | null>(null)
  const [editing, setEditing] = useState<{ id?: string; tool: ToolId; name: string; content: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await window.api.promptsList()
      setPrompts(r.prompts)
      setCurrent(r.current)
      // 当前编辑中的条目被删掉后清空编辑器
      setEditing((ed) => (ed && ed.id && !r.prompts.some((p) => p.id === ed.id) ? null : ed))
    } catch (e) {
      notify((e as Error).message, 'err')
    }
  }, [notify])

  useEffect(() => {
    void load()
  }, [load])

  const mine = prompts.filter((p) => p.tool === tool)
  const cur = current?.[tool]
  // 应用时文件会补一个结尾换行：比对去掉尾换行，避免「刚应用完却不显示使用中」
  const isInUse = (p: StoredPrompt): boolean => !!cur?.exists && cur.content.replace(/\n+$/, '') === p.content.replace(/\n+$/, '')

  const openEdit = (p: StoredPrompt): void => setEditing({ id: p.id, tool: p.tool, name: p.name, content: p.content })

  const save = async (): Promise<void> => {
    if (!editing || !editing.name.trim()) {
      notify(t(lang, 'prompt.errName'), 'err')
      return
    }
    setBusy(true)
    try {
      const saved = await window.api.promptsSave({
        id: editing.id,
        tool: editing.tool,
        name: editing.name.trim(),
        content: editing.content
      })
      notify(t(lang, 'prompt.saved'))
      if (!editing.id) setEditing({ id: saved.id, tool: saved.tool, name: saved.name, content: saved.content })
      await load()
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const apply = async (): Promise<void> => {
    if (!editing?.id) return
    setBusy(true)
    try {
      await window.api.promptsApply(editing.id)
      notify(t(lang, 'prompt.appliedToast', { path: promptFilePathFor(editing.tool) }))
      await load()
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const del = async (p: StoredPrompt): Promise<void> => {
    if (!window.confirm(t(lang, 'prompt.confirmDelete', { name: p.name }))) return
    try {
      await window.api.promptsDelete(p.id)
      notify(t(lang, 'prompt.deleted'))
      await load()
    } catch (e) {
      notify((e as Error).message, 'err')
    }
  }

  const importCurrent = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.promptsImportCurrent(tool)
      notify(t(lang, 'prompt.saved'))
      await load()
    } catch (e) {
      notify(t(lang, 'prompt.importNone', { file: PROMPT_FILES[tool] }) + ' — ' + (e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="prompts">
      <div className="usage-head">
        <div>
          <h2>{t(lang, 'prompt.title')}</h2>
          <p className="muted small">{t(lang, 'prompt.desc')}</p>
        </div>
        <div className="btn-row">
          {(['claude', 'codex'] as ToolId[]).map((tl) => (
            <button
              key={tl}
              type="button"
              className={`btn sm ${tool === tl ? 'primary' : ''}`}
              onClick={() => {
                setTool(tl)
                setEditing((ed) => (ed && !ed.id ? null : ed)) // 未保存的新建草稿不跨工具保留
              }}
            >
              {tl === 'claude' ? 'Claude Code' : 'Codex'}
            </button>
          ))}
        </div>
      </div>
      <div className="sessions-body">
        <aside className="session-list">
          <div className="prompt-list-actions">
            <button className="btn sm" onClick={() => setEditing({ tool, name: '', content: '' })}>
              {t(lang, 'prompt.new')}
            </button>
            <button className="btn sm" onClick={() => void importCurrent()} disabled={busy} title={promptFilePathFor(tool)}>
              {t(lang, 'prompt.import')}
            </button>
          </div>
          {mine.length === 0 ? (
            <p className="muted small">{t(lang, 'prompt.none')}</p>
          ) : (
            mine.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`session-item${editing?.id === p.id ? ' active' : ''}`}
                onClick={() => openEdit(p)}
                title={p.name}
              >
                <span className="session-name">
                  {p.name}
                  {isInUse(p) && <span className="badge-inuse">{t(lang, 'prompt.inUse')}</span>}
                </span>
                <span className="muted small">{p.content.length.toLocaleString()} chars</span>
              </button>
            ))
          )}
        </aside>
        <div className="session-page">
          {!editing ? (
            <p className="muted">{t(lang, 'sess.pick')}</p>
          ) : (
            <>
              <p className="muted small">
                {t(lang, 'prompt.currentFile', {
                  path: promptFilePathFor(editing.tool),
                  state: cur?.exists ? t(lang, 'prompt.filePresent') : t(lang, 'prompt.fileMissing')
                })}
              </p>
              <input
                className="prompt-name-input"
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder={t(lang, 'prompt.name')}
              />
              <textarea
                className="prompt-content"
                value={editing.content}
                onChange={(e) => setEditing({ ...editing, content: e.target.value })}
                placeholder={t(lang, 'prompt.content')}
                spellCheck={false}
              />
              <div className="btn-row">
                <button className="btn primary sm" onClick={() => void save()} disabled={busy}>
                  {t(lang, 'prompt.save')}
                </button>
                <button className="btn sm" onClick={() => void apply()} disabled={busy || !editing.id} title={editing.id ? undefined : t(lang, 'prompt.save') + ' first'}>
                  {t(lang, 'prompt.apply', { file: PROMPT_FILES[editing.tool] })}
                </button>
                {editing.id && (
                  <button
                    className="btn danger-ghost sm"
                    onClick={() => {
                      const p = prompts.find((x) => x.id === editing.id)
                      if (p) void del(p)
                    }}
                    disabled={busy}
                  >
                    {t(lang, 'prompt.delete')}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function promptFilePathFor(tool: ToolId): string {
  return tool === 'claude' ? '~/.claude/CLAUDE.md' : '~/.codex/AGENTS.md'
}
