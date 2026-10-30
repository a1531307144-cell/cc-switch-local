import { useEffect, useState } from 'react'
import type { KeyType, Lang, Preset, ToolId } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { detectVendor } from '../../../shared/vendors'
import { Modal, VendorChip } from './ui'

export interface FormDraft {
  id?: string
  tool: ToolId
  name: string
  baseUrl: string
  apiKey: string
  keyType: KeyType
  model: string
  wireApi: 'responses' | 'chat'
  notes: string
}

export function emptyDraft(tool: ToolId): FormDraft {
  return { tool, name: '', baseUrl: '', apiKey: '', keyType: 'auth_token', model: '', wireApi: 'responses', notes: '' }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export default function ProviderForm({
  draft,
  lang,
  onClose,
  onSave
}: {
  draft: FormDraft
  lang: Lang
  onClose: () => void
  onSave: (d: FormDraft) => Promise<void>
}) {
  const [form, setForm] = useState<FormDraft>(draft)
  const [presets, setPresets] = useState<Preset[]>([])
  const [presetQuery, setPresetQuery] = useState('')
  const [presetOpen, setPresetOpen] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api
      .presetsGet()
      .then((ps) => setPresets(ps.filter((p) => p.tool === draft.tool)))
      .catch(() => {})
  }, [draft.tool])

  const set = (patch: Partial<FormDraft>) => setForm((f) => ({ ...f, ...patch }))

  const applyPreset = (p: Preset) => {
    set({
      name: p.name,
      baseUrl: p.baseUrl,
      model: p.model ?? '',
      keyType: p.keyType ?? form.keyType,
      wireApi: p.wireApi ?? form.wireApi,
      notes: p.notes ?? form.notes
    })
  }

  const q = presetQuery.trim().toLowerCase()
  const presetMatches = presets
    .filter((p) => !q || (p.searchKey ?? '').includes(q))
    .slice(0, 8)

  const submit = async () => {
    if (!form.name.trim()) return setErr(t(lang, 'form.err.name'))
    if (!/^https?:\/\//.test(form.baseUrl.trim())) return setErr(t(lang, 'form.err.url'))
    if (!form.apiKey.trim()) return setErr(t(lang, 'form.err.key'))
    setErr('')
    setSaving(true)
    try {
      await onSave(form)
    } catch (e) {
      setErr((e as Error).message)
      setSaving(false)
    }
  }

  return (
    <Modal title={form.id ? t(lang, 'form.editTitle') : t(lang, 'form.newTitle')} onClose={onClose}>
      <div className="form">
        <label>
          {t(lang, 'form.presetLabel', { n: presets.length })}
          <div
            className="preset-picker"
            onBlur={() => {
              window.setTimeout(() => setPresetOpen(false), 120)
            }}
          >
            <input
              value={presetQuery}
              onChange={(e) => {
                setPresetQuery(e.target.value)
                setPresetOpen(true)
              }}
              onFocus={() => setPresetOpen(true)}
              placeholder={t(lang, 'form.presetPh')}
            />
            {presetOpen && presetMatches.length > 0 && (
              <div className="preset-list">
                {presetMatches.map((p) => (
                  <button
                    type="button"
                    key={`${p.tool}|${p.baseUrl}|${p.name}`}
                    className="preset-item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      applyPreset(p)
                      setPresetOpen(false)
                      setPresetQuery('')
                    }}
                  >
                    <span>{p.name}</span>
                    <span className="preset-domain">{safeHost(p.baseUrl)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <small>{t(lang, 'form.presetNote')}</small>
        </label>

        <label>
          {t(lang, 'form.name')}
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={t(lang, 'form.namePh')} />
        </label>

        <label>
          Base URL *
          <input
            value={form.baseUrl}
            onChange={(e) => set({ baseUrl: e.target.value })}
            placeholder="https://api.example.com"
          />
          {detectVendor(form.baseUrl.trim()) && (
            <span className="vendor-hint">
              <VendorChip vendor={detectVendor(form.baseUrl.trim())!} />
            </span>
          )}
        </label>

        <label>
          {t(lang, 'form.apiKey')}
          <div className="key-row">
            <input
              type={showKey ? 'text' : 'password'}
              value={form.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              placeholder="sk-…"
            />
            <label className="check inline">
              <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} />
              {t(lang, 'form.show')}
            </label>
          </div>
        </label>

        {form.tool === 'claude' ? (
          <label>
            {t(lang, 'form.keyType')}
            <select value={form.keyType} onChange={(e) => set({ keyType: e.target.value as KeyType })}>
              <option value="auth_token">{t(lang, 'form.keyType.auth')}</option>
              <option value="api_key">{t(lang, 'form.keyType.api')}</option>
            </select>
          </label>
        ) : (
          <>
            <label>
              {t(lang, 'form.modelCodex')}
              <input value={form.model} onChange={(e) => set({ model: e.target.value })} placeholder="gpt-5-codex" />
            </label>
            <label>
              wire_api
              <select value={form.wireApi} onChange={(e) => set({ wireApi: e.target.value as 'responses' | 'chat' })}>
                <option value="responses">responses</option>
                <option value="chat">chat</option>
              </select>
            </label>
          </>
        )}

        {form.tool === 'claude' && (
          <label>
            {t(lang, 'form.modelClaude')}
            <input value={form.model} onChange={(e) => set({ model: e.target.value })} placeholder="claude-sonnet-4-5" />
          </label>
        )}

        <label>
          {t(lang, 'form.notes')}
          <textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} />
        </label>

        {err && <div className="form-error">{err}</div>}

        <div className="form-actions">
          <button className="btn" onClick={onClose} disabled={saving}>
            {t(lang, 'btn.cancel')}
          </button>
          <button className="btn primary" onClick={submit} disabled={saving}>
            {saving ? t(lang, 'btn.saving') : t(lang, 'btn.save')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
