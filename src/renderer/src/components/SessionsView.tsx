import { useCallback, useEffect, useState } from 'react'
import type { Lang, SessionInfo, SessionPage, ToolId } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { IconSearch } from './Icons'

function fmtTime(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function fmtSize(n: number): string {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
}

/** 会话阅读器（v0.8.5）：只读浏览本机会话日志；v0.8.8 增加搜索 / Markdown 导出 / resume 命令 */
export default function SessionsView({ lang, notify }: { lang: Lang; notify: (text: string, kind?: 'ok' | 'err') => void }) {
  const [tool, setTool] = useState<ToolId>('claude')
  const [list, setList] = useState<SessionInfo[]>([])
  const [page, setPage] = useState<SessionPage | null>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [currentInfo, setCurrentInfo] = useState<SessionInfo | null>(null)
  const [q, setQ] = useState('')
  const [exporting, setExporting] = useState(false)

  const loadList = useCallback(async () => {
    try {
      setList(await window.api.sessionsList(tool))
    } catch (e) {
      notify(t(lang, 'sess.loadFail', { msg: (e as Error).message }), 'err')
    }
  }, [tool, lang, notify])

  useEffect(() => {
    void loadList()
    setPage(null)
    setCurrent(null)
    setCurrentInfo(null)
    setQ('')
  }, [loadList])

  const open = async (s: SessionInfo): Promise<void> => {
    setCurrent(s.file)
    setCurrentInfo(s)
    try {
      setPage(await window.api.sessionsRead(tool, s.file))
    } catch (e) {
      notify(t(lang, 'sess.loadFail', { msg: (e as Error).message }), 'err')
      setPage(null)
    }
  }

  const exportMd = async (): Promise<void> => {
    if (!currentInfo) return
    setExporting(true)
    try {
      const r = await window.api.sessionsExportMd(tool, currentInfo.file)
      if (r.canceled) return
      if (r.savedTo) notify(t(lang, 'sess.exported', { path: r.savedTo }))
      else if (r.error) notify(t(lang, 'sess.exportFail', { msg: r.error }), 'err')
    } catch (e) {
      notify(t(lang, 'sess.exportFail', { msg: (e as Error).message }), 'err')
    } finally {
      setExporting(false)
    }
  }

  const resumeCmd = currentInfo ? (tool === 'claude' ? `claude --resume ${currentInfo.id}` : `codex resume ${currentInfo.id}`) : ''

  const copyResume = async (): Promise<void> => {
    try {
      await window.api.copyText(resumeCmd)
      notify(t(lang, 'card.linkCopied'))
    } catch {
      notify(t(lang, 'card.linkCopied'), 'err')
    }
  }

  const qq = q.trim().toLowerCase()
  const shown = page ? (qq === '' ? page.entries : page.entries.filter((e) => e.text.toLowerCase().includes(qq))) : []

  return (
    <div className="sessions">
      <div className="usage-head">
        <div>
          <h2>{t(lang, 'sess.title')}</h2>
          <p className="muted small">{t(lang, 'sess.desc')}</p>
        </div>
        <div className="btn-row">
          {(['claude', 'codex'] as ToolId[]).map((tl) => (
            <button key={tl} type="button" className={`btn sm ${tool === tl ? 'primary' : ''}`} onClick={() => setTool(tl)}>
              {tl === 'claude' ? 'Claude Code' : 'Codex'}
            </button>
          ))}
        </div>
      </div>
      <div className="sessions-body">
        <aside className="session-list">
          {list.length === 0 ? (
            <p className="muted small">{t(lang, 'sess.none')}</p>
          ) : (
            list.map((s) => (
              <button
                key={s.file}
                type="button"
                className={`session-item${current === s.file ? ' active' : ''}`}
                onClick={() => void open(s)}
                title={s.file}
              >
                <span className="session-name">{s.project}</span>
                <span className="muted small">
                  {fmtTime(s.mtime)} · {fmtSize(s.size)}
                </span>
              </button>
            ))
          )}
        </aside>
        <div className="session-page">
          {page === null ? (
            <p className="muted">{t(lang, 'sess.pick')}</p>
          ) : (
            <>
              <div className="sess-toolbar">
                <div className="search">
                  <IconSearch />
                  <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(lang, 'sess.searchPh')} />
                </div>
                <button className="btn sm" onClick={() => void copyResume()} title={t(lang, 'sess.resume')}>
                  <code className="small">{resumeCmd}</code>
                </button>
                <button className="btn sm" onClick={() => void exportMd()} disabled={exporting}>
                  {exporting ? '…' : t(lang, 'sess.export')}
                </button>
              </div>
              {qq !== '' && (
                <p className="muted small">
                  {t(lang, 'sess.filtered', { n: shown.length, total: page.entries.length })}
                </p>
              )}
              {page.truncated && <p className="muted small">{t(lang, 'sess.truncated', { n: page.entries.length })}</p>}
              {shown.length === 0 && <p className="muted">{qq !== '' ? t(lang, 'zone.noneMatch', { q: q.trim() }) : t(lang, 'sess.empty')}</p>}
              {shown.map((e, i) => (
                <div key={i} className={`sess-entry sess-${e.role}`}>
                  <div className="sess-role">
                    {e.role === 'user' ? t(lang, 'sess.you') : e.role === 'assistant' ? t(lang, 'sess.assistant') : e.toolName ?? t(lang, 'sess.toolResult')}
                    {e.role === 'tool' && e.toolName && e.toolName !== '工具结果' ? ` · ${t(lang, 'sess.toolUse')}` : ''}
                  </div>
                  <pre className="sess-text">{e.text}</pre>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
