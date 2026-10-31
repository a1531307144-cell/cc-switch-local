import { useEffect, useState } from 'react'
import type { AppSettings, BackupInfo, RouterStatus, StoreShape, ToolId } from '../../../shared/types'
import { t, type Lang } from '../../../shared/i18n'
import { Dropdown, Modal } from './ui'

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 加密备份的口令输入对话框（导出/导入共用） */
function PassphraseModal({
  mode,
  lang,
  onClose,
  onConfirm
}: {
  mode: 'export' | 'import'
  lang: Lang
  onClose: () => void
  onConfirm: (pass: string) => void
}) {
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [err, setErr] = useState('')
  const exporting = mode === 'export'
  const submit = () => {
    if (pass.length < 8) return setErr(t(lang, 'set.pp.errLen'))
    if (exporting && pass !== pass2) return setErr(t(lang, 'set.pp.errMismatch'))
    setErr('')
    onConfirm(pass)
  }
  return (
    <Modal title={exporting ? t(lang, 'set.pp.exportTitle') : t(lang, 'set.pp.importTitle')} onClose={onClose}>
      <div className="form">
        <p className="muted small">{exporting ? t(lang, 'set.pp.exportHint') : t(lang, 'set.pp.importHint')}</p>
        <label>
          {exporting ? t(lang, 'set.pp.passExport') : t(lang, 'set.pp.passImport')}
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder={exporting ? t(lang, 'set.pp.ph.export') : t(lang, 'set.pp.ph.import')}
            autoFocus
          />
        </label>
        {exporting && (
          <label>
            {t(lang, 'set.pp.pass2')}
            <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} placeholder={t(lang, 'set.pp.ph2')} />
          </label>
        )}
        {err && <div className="form-error">{err}</div>}
        <div className="form-actions">
          <button className="btn" onClick={onClose}>
            {t(lang, 'btn.cancel')}
          </button>
          <button className="btn primary" onClick={submit}>
            {exporting ? t(lang, 'set.pp.pick') : t(lang, 'set.pp.pickImport')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default function SettingsPanel({
  store,
  lang,
  onChanged,
  notify,
  onCheckUpdate,
  updateChecking
}: {
  store: StoreShape
  lang: Lang
  onChanged: () => Promise<void>
  notify: (text: string, kind?: 'ok' | 'err') => void
  onCheckUpdate: () => Promise<void>
  updateChecking: boolean
}) {
  const [backups, setBackups] = useState<Record<ToolId, BackupInfo[]>>({ claude: [], codex: [] })
  const [version, setVersion] = useState('')
  const [bakModal, setBakModal] = useState<'export' | 'import' | null>(null)
  const [bakBusy, setBakBusy] = useState(false)
  const [router, setRouter] = useState<RouterStatus | null>(null)
  const [clearing, setClearing] = useState(false)

  const loadBackups = async () => {
    setBackups({
      claude: await window.api.toolBackups('claude'),
      codex: await window.api.toolBackups('codex')
    })
  }

  useEffect(() => {
    loadBackups().catch(() => {})
    window.api
      .appVersion()
      .then(setVersion)
      .catch(() => {})
    window.api
      .routerStatus()
      .then(setRouter)
      .catch(() => {})
  }, [])

  const updateSetting = async (patch: Partial<AppSettings>) => {
    await window.api.settingsUpdate(patch)
    await onChanged()
  }

  const restore = async (tool: ToolId, file: string) => {
    if (!window.confirm(t(lang, 'set.confirmRestore', { file }))) return
    try {
      await window.api.toolRestoreBackup(tool, file)
      notify(t(lang, 'set.toastRestored'))
      await loadBackups()
      await onChanged()
    } catch (e) {
      notify((e as Error).message, 'err')
    }
  }

  const runBackup = async (mode: 'export' | 'import', pass: string) => {
    setBakBusy(true)
    try {
      if (mode === 'export') {
        const r = await window.api.backupExport(pass)
        if (r.canceled) return
        notify(t(lang, 'set.toastExported'))
      } else {
        const r = await window.api.backupImport(pass)
        if (r.canceled) return
        notify(t(lang, 'set.toastImported', { a: r.added, s: r.skipped }))
        await onChanged()
      }
      setBakModal(null)
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setBakBusy(false)
    }
  }

  const clearAll = async () => {
    if (!window.confirm(t(lang, 'set.confirmClear1'))) return
    if (!window.confirm(t(lang, 'set.confirmClear2'))) return
    setClearing(true)
    try {
      const r = await window.api.clearAllData()
      notify(t(lang, 'set.toastCleared', { n: r.removed.length }))
      await onChanged()
      await loadBackups()
    } catch (e) {
      notify(t(lang, 'set.clearFail', { msg: (e as Error).message }), 'err')
    } finally {
      setClearing(false)
    }
  }

  const s = store.settings

  return (
    <div className="settings">
      <section className="card">
        <h3>{t(lang, 'set.appearance')}</h3>
        <div className="field-row">
          {t(lang, 'set.theme')}
          <Dropdown
            ariaLabel={t(lang, 'set.theme')}
            value={s.theme}
            options={[
              { value: 'system', label: t(lang, 'set.theme.system') },
              { value: 'light', label: t(lang, 'set.theme.light') },
              { value: 'dark', label: t(lang, 'set.theme.dark') }
            ]}
            onChange={(v) => void updateSetting({ theme: v as AppSettings['theme'] })}
          />
        </div>
        <div className="field-row">
          {t(lang, 'set.language')}
          <Dropdown
            ariaLabel={t(lang, 'set.language')}
            value={lang}
            options={[
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'English' }
            ]}
            onChange={(v) => void updateSetting({ language: v as AppSettings['language'] })}
          />
        </div>
      </section>

      <section className="card">
        <h3>{t(lang, 'set.general')}</h3>
        <label className="check">
          <input type="checkbox" checked={s.autoUpdate} onChange={(e) => updateSetting({ autoUpdate: e.target.checked })} />
          {t(lang, 'set.autoUpdate')}
        </label>
        <label className="check">
          <input type="checkbox" checked={s.autoStart} onChange={(e) => updateSetting({ autoStart: e.target.checked })} />
          {t(lang, 'set.autoStart')}
        </label>
        <div className="field-row">
          <button className="btn sm" onClick={onCheckUpdate} disabled={updateChecking}>
            {updateChecking ? t(lang, 'set.checking') : t(lang, 'set.checkUpdate')}
          </button>
          <span className="muted">{t(lang, 'set.currentVersion', { v: version || '…' })}</span>
        </div>
        <p className="muted small">{t(lang, 'set.updateHint')}</p>
      </section>

      <section className="card">
        <h3>{t(lang, 'set.router')}</h3>
        <p className="muted small">{t(lang, 'set.routerDesc')}</p>
        <p className="muted small">
          {router?.running
            ? t(lang, 'set.routerRunning', {
                port: router.port,
                c: router.claude.requests,
                cf: router.claude.errors,
                x: router.codex.requests,
                xf: router.codex.errors
              })
            : t(lang, 'set.routerIdle')}
          {router?.error ? t(lang, 'set.routerError', { err: router.error }) : ''}
        </p>
      </section>

      <section className="card">
        <h3>{t(lang, 'set.backup')}</h3>
        <p className="muted small">{t(lang, 'set.backupDesc')}</p>
        <div className="btn-row">
          <button className="btn sm" onClick={() => setBakModal('export')}>
            {t(lang, 'set.export')}
          </button>
          <button className="btn sm" onClick={() => setBakModal('import')}>
            {t(lang, 'set.import')}
          </button>
        </div>
      </section>

      <section className="card">
        <h3>{t(lang, 'set.deeplink')}</h3>
        <p className="muted small">{t(lang, 'set.deeplinkDesc')}</p>
      </section>

      <section className="card">
        <h3>{t(lang, 'set.dataDir')}</h3>
        <p className="muted small">{t(lang, 'set.dataDesc')}</p>
        <div className="btn-row">
          <button className="btn sm" onClick={() => window.api.openPath('data')}>
            {t(lang, 'set.openData')}
          </button>
          <button className="btn sm" onClick={() => window.api.openPath('claudeConfig')}>
            {t(lang, 'set.openClaude')}
          </button>
          <button className="btn sm" onClick={() => window.api.openPath('codexConfig')}>
            {t(lang, 'set.openCodex')}
          </button>
        </div>
      </section>

      <section className="card danger-zone">
        <h3>{t(lang, 'set.danger')}</h3>
        <p className="muted small">{t(lang, 'set.dangerDesc')}</p>
        <button className="btn danger" onClick={() => void clearAll()} disabled={clearing}>
          {clearing ? t(lang, 'set.clearAll.busy') : t(lang, 'set.clearAll')}
        </button>
      </section>

      {(['claude', 'codex'] as ToolId[]).map((tool) => (
        <section className="card" key={tool}>
          <h3>{t(lang, 'set.backupsTitle', { tool: tool === 'claude' ? 'Claude Code' : 'Codex', n: backups[tool].length })}</h3>
          {backups[tool].length === 0 ? (
            <p className="muted small">{t(lang, 'set.noBackups')}</p>
          ) : (
            <table className="backup-table">
              <thead>
                <tr>
                  <th>{t(lang, 'th.file')}</th>
                  <th>{t(lang, 'th.time')}</th>
                  <th>{t(lang, 'th.size')}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {backups[tool].map((b) => (
                  <tr key={b.file}>
                    <td>
                      <code className="small">{b.file}</code>
                    </td>
                    <td className="muted small">{fmtDate(b.created)}</td>
                    <td className="muted small">{(b.size / 1024).toFixed(1)} KB</td>
                    <td>
                      <button className="btn sm" onClick={() => restore(tool, b.file)}>
                        {t(lang, 'set.restore')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ))}

      <section className="card">
        <h3>{t(lang, 'set.about')}</h3>
        <p className="muted small">{t(lang, 'set.aboutText', { v: version || '…' })}</p>
      </section>

      {bakModal && (
        <PassphraseModal
          mode={bakModal}
          lang={lang}
          onClose={() => (bakBusy ? undefined : setBakModal(null))}
          onConfirm={(pass) => void runBackup(bakModal, pass)}
        />
      )}
    </div>
  )
}
