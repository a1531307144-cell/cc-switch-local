import { useCallback, useEffect, useState } from 'react'
import type { Lang, ProviderGroup, StoreShape, ToolId } from '../../../shared/types'
import { t } from '../../../shared/i18n'

/** 方案组（v0.8.9）：保存并一键切换「两个工具各用哪个供应商」的组合 */
export default function GroupsView({ lang, notify, onChanged }: { lang: Lang; notify: (text: string, kind?: 'ok' | 'err') => void; onChanged: () => void }) {
  const [groups, setGroups] = useState<ProviderGroup[]>([])
  const [store, setStore] = useState<StoreShape | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [g, s] = await Promise.all([window.api.groupsList(), window.api.storeGet()])
      setGroups(g)
      setStore(s)
    } catch (e) {
      notify((e as Error).message, 'err')
    }
  }, [notify])

  useEffect(() => {
    void load()
  }, [load])

  const memberLabel = (tool: ToolId, id: string | null): string => {
    if (!id) return t(lang, 'group.official')
    const p = store?.providers.find((x) => x.id === id && x.tool === tool)
    return p ? p.name : t(lang, 'group.missing')
  }

  const memberMatchesCurrent = (g: ProviderGroup): number => {
    if (!store) return 0
    let n = 0
    for (const tool of ['claude', 'codex'] as ToolId[]) {
      if ((g.members[tool] ?? null) === (store.current[tool] ?? null)) n++
    }
    return n
  }

  const saveCurrent = async (): Promise<void> => {
    if (!name.trim()) {
      notify(t(lang, 'group.needName'), 'err')
      return
    }
    if (!store) return
    setBusy(true)
    try {
      await window.api.groupsSave({
        name: name.trim(),
        members: { claude: store.current.claude, codex: store.current.codex }
      })
      notify(t(lang, 'group.saved'))
      setName('')
      await load()
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const apply = async (g: ProviderGroup): Promise<void> => {
    setBusy(true)
    try {
      const r = await window.api.groupsApply(g.id)
      if (r.skipped.length > 0) notify(t(lang, 'group.appliedSkip', { skipped: r.skipped.join('；') }), 'err')
      else notify(t(lang, 'group.applied', { n: r.switched.length }))
      await load()
      onChanged()
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const del = async (g: ProviderGroup): Promise<void> => {
    if (!window.confirm(t(lang, 'group.confirmDelete', { name: g.name }))) return
    try {
      await window.api.groupsDelete(g.id)
      notify(t(lang, 'group.deleted'))
      await load()
    } catch (e) {
      notify((e as Error).message, 'err')
    }
  }

  return (
    <div className="groups">
      <div className="usage-head">
        <div>
          <h2>{t(lang, 'group.title')}</h2>
          <p className="muted small">{t(lang, 'group.desc')}</p>
        </div>
      </div>

      <section className="card group-save">
        <div className="btn-row">
          <input className="group-name-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t(lang, 'group.newNamePh')} />
          <button className="btn primary sm" onClick={() => void saveCurrent()} disabled={busy}>
            {t(lang, 'group.saveCurrent')}
          </button>
        </div>
        <p className="muted small">
          {t(lang, 'group.claude')}：{store ? memberLabel('claude', store.current.claude) : '…'}　·　{t(lang, 'group.codex')}：
          {store ? memberLabel('codex', store.current.codex) : '…'}
        </p>
      </section>

      {groups.length === 0 ? (
        <p className="muted">{t(lang, 'group.empty')}</p>
      ) : (
        groups.map((g) => {
          const matched = memberMatchesCurrent(g)
          return (
            <section className="card group-card" key={g.id}>
              <div className="group-head">
                <h3>
                  {g.name}
                  {matched === 2 && <span className="badge-inuse">{t(lang, 'prompt.inUse')}</span>}
                </h3>
                <div className="btn-row">
                  <button className="btn primary sm" onClick={() => void apply(g)} disabled={busy}>
                    {t(lang, 'group.apply')}
                  </button>
                  <button className="btn danger-ghost sm" onClick={() => void del(g)} disabled={busy}>
                    {t(lang, 'group.delete')}
                  </button>
                </div>
              </div>
              <p className="muted small">
                {t(lang, 'group.claude')}：{memberLabel('claude', g.members.claude)}　·　{t(lang, 'group.codex')}：
                {memberLabel('codex', g.members.codex)}
              </p>
            </section>
          )
        })
      )}
    </div>
  )
}
