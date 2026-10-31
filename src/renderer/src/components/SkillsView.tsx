import { useCallback, useEffect, useState } from 'react'
import type { Lang, SkillInfo, ToolId } from '../../../shared/types'
import { t } from '../../../shared/i18n'

/** Skills 管理（v0.8.10）：安装（GitHub/ZIP）、查看、更新、删除 Claude Code / Codex 的 Agent Skills */
export default function SkillsView({ lang, notify }: { lang: Lang; notify: (text: string, kind?: 'ok' | 'err') => void }) {
  const [tool, setTool] = useState<ToolId>('claude')
  const [skills, setSkills] = useState<SkillInfo[]>([])
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [viewing, setViewing] = useState<{ name: string; content: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setSkills(await window.api.skillsList(tool))
    } catch (e) {
      notify((e as Error).message, 'err')
    }
  }, [tool, notify])

  useEffect(() => {
    void load()
    setViewing(null)
  }, [load])

  const installGithub = async (): Promise<void> => {
    if (!url.trim()) return
    setBusy('install')
    try {
      const r = await window.api.skillsInstallGithub(tool, url.trim())
      if (r.installed.length > 0) notify(t(lang, 'skill.installed', { n: r.installed.join('、') }))
      if (r.skipped.length > 0) notify(t(lang, 'skill.skipped', { list: r.skipped.join('；') }), 'err')
      setUrl('')
      await load()
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setBusy(null)
    }
  }

  const installZip = async (): Promise<void> => {
    setBusy('zip')
    try {
      const r = await window.api.skillsInstallZip(tool)
      if (r.canceled) return
      if (r.installed.length > 0) notify(t(lang, 'skill.installed', { n: r.installed.join('、') }))
      if (r.skipped.length > 0) notify(t(lang, 'skill.skipped', { list: r.skipped.join('；') }), 'err')
      await load()
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setBusy(null)
    }
  }

  const updateAll = async (): Promise<void> => {
    setBusy('updateAll')
    try {
      const r = await window.api.skillsUpdateAll(tool)
      if (r.failed.length > 0) notify(t(lang, 'skill.updateFailed', { list: r.failed.join('；') }), 'err')
      else if (r.installed.length > 0) notify(t(lang, 'skill.updated', { n: r.installed.length }))
      else notify(t(lang, 'skill.noneToUpd'), 'err')
      await load()
    } finally {
      setBusy(null)
    }
  }

  const updateOne = async (s: SkillInfo): Promise<void> => {
    setBusy(s.name)
    try {
      const r = await window.api.skillsUpdate(tool, s.name)
      notify(t(lang, 'skill.installed', { n: r.installed.join('、') }))
      await load()
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setBusy(null)
    }
  }

  const del = async (s: SkillInfo): Promise<void> => {
    if (!window.confirm(t(lang, 'skill.confirmDelete', { name: s.name }))) return
    try {
      await window.api.skillsDelete(tool, s.name)
      notify(t(lang, 'skill.deleted', { name: s.name }))
      if (viewing?.name === s.name) setViewing(null)
      await load()
    } catch (e) {
      notify((e as Error).message, 'err')
    }
  }

  const view = async (s: SkillInfo): Promise<void> => {
    try {
      const r = await window.api.skillsRead(tool, s.name)
      setViewing({ name: s.name, content: r.content })
    } catch (e) {
      notify((e as Error).message, 'err')
    }
  }

  return (
    <div className="skills">
      <div className="usage-head">
        <div>
          <h2>{t(lang, 'skill.title')}</h2>
          <p className="muted small">{t(lang, 'skill.desc')}</p>
        </div>
        <div className="btn-row">
          {(['claude', 'codex'] as ToolId[]).map((tl) => (
            <button key={tl} type="button" className={`btn sm ${tool === tl ? 'primary' : ''}`} onClick={() => setTool(tl)}>
              {tl === 'claude' ? 'Claude Code' : 'Codex'}
            </button>
          ))}
        </div>
      </div>

      <section className="card skill-install">
        <div className="btn-row">
          <input
            className="bar-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t(lang, 'skill.urlPh')}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void installGithub()
            }}
          />
          <button className="btn primary sm" onClick={() => void installGithub()} disabled={busy !== null || !url.trim()}>
            {busy === 'install' ? t(lang, 'skill.installing') : t(lang, 'skill.installGithub')}
          </button>
          <button className="btn sm" onClick={() => void installZip()} disabled={busy !== null}>
            {t(lang, 'skill.installZip')}
          </button>
          <button className="btn sm" onClick={() => void updateAll()} disabled={busy !== null}>
            {busy === 'updateAll' ? t(lang, 'skill.updating') : t(lang, 'skill.updateAll')}
          </button>
        </div>
        <p className="muted small">{t(lang, 'skill.dir', { dir: tool === 'claude' ? '~/.claude/skills' : '~/.codex/skills' })}</p>
      </section>

      <div className="skills-body">
        <aside className="session-list">
          {skills.length === 0 ? (
            <p className="muted small">{t(lang, 'skill.none')}</p>
          ) : (
            skills.map((s) => (
              <button key={s.name} type="button" className={`session-item${viewing?.name === s.name ? ' active' : ''}`} onClick={() => void view(s)} title={s.name}>
                <span className="session-name">
                  {s.name}
                  {s.source && <span className="badge-src" title={`${s.source.repo} (${s.source.ref ?? 'main'})`}>⇩</span>}
                </span>
                <span className="muted small">{s.fileCount} files · {(s.size / 1024).toFixed(0)} KB</span>
              </button>
            ))
          )}
        </aside>
        <div className="session-page">
          {!viewing ? (
            <p className="muted">{t(lang, 'skill.pick')}</p>
          ) : (
            <>
              <div className="group-head">
                <h3>{viewing.name}</h3>
                <div className="btn-row">
                  {skills.find((s) => s.name === viewing.name)?.source && (
                    <button className="btn sm" onClick={() => void updateOne(skills.find((s) => s.name === viewing.name)!)} disabled={busy !== null}>
                      {busy === viewing.name ? t(lang, 'skill.updating') : t(lang, 'skill.update')}
                    </button>
                  )}
                  <button className="btn danger-ghost sm" onClick={() => void del(skills.find((s) => s.name === viewing.name)!)} disabled={busy !== null}>
                    {t(lang, 'skill.delete')}
                  </button>
                </div>
              </div>
              {(() => {
                const info = skills.find((s) => s.name === viewing.name)
                return info?.source ? (
                  <p className="muted small">
                    {info.source.repo} · {info.source.ref ?? 'main'}
                    {info.description ? ` — ${info.description}` : ''}
                  </p>
                ) : info?.description ? (
                  <p className="muted small">{info.description}</p>
                ) : null
              })()}
              <pre className="sess-text skill-md">{viewing.content}</pre>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
