import { useState } from 'react'
import type { KeyType, Lang, ToolId } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { detectVendor } from '../../../shared/vendors'
import { Dropdown, VendorLogo } from './ui'

export interface FormDraft {
  id?: string
  tool: ToolId
  name: string
  baseUrl: string
  apiKey: string
  keyType: KeyType
  protocol: 'anthropic' | 'openai'
  alias: string
  model: string
  wireApi: 'responses' | 'chat'
  notes: string
  /** 预设图标 slug（v0.8.14）：随供应商落库 */
  icon?: string
}

export function emptyDraft(tool: ToolId): FormDraft {
  return {
    tool,
    name: '',
    baseUrl: '',
    apiKey: '',
    keyType: 'auth_token',
    protocol: 'anthropic',
    alias: '',
    model: '',
    wireApi: tool === 'codex' ? 'responses' : 'chat',
    notes: '',
    icon: ''
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/**
 * 添加/编辑供应商整页表单（v0.8.15，对标原版 cc-switch 的配置页）：
 * 头部图标卡 + 基本信息卡片 + 高级选项折叠卡片，底部保存/返回。
 * 预设发现由「添加供应商」整页负责，本页专注字段填写。
 */
export default function ProviderFormPage({
  draft,
  lang,
  onBack,
  onSave
}: {
  draft: FormDraft
  lang: Lang
  onBack: () => void
  onSave: (d: FormDraft) => Promise<void>
}) {
  const [form, setForm] = useState<FormDraft>(draft)
  const [showKey, setShowKey] = useState(false)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  // 高级选项默认展开条件：编辑已有配置且高级字段非默认值
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    form.tool === 'claude'
      ? form.keyType !== 'auth_token' || form.protocol === 'openai' || !!form.alias || (!!form.id && !!form.model)
      : false
  )

  const set = (patch: Partial<FormDraft>) => setForm((f) => ({ ...f, ...patch }))
  const vendor = detectVendor(form.baseUrl.trim())

  const submit = async () => {
    if (!form.name.trim()) return setErr(t(lang, 'form.err.name'))
    if (!/^https?:\/\//.test(form.baseUrl.trim())) return setErr(t(lang, 'form.err.url'))
    if (!form.apiKey.trim()) return setErr(t(lang, 'form.err.key'))
    if (form.tool === 'claude' && form.protocol === 'openai' && !form.model.trim()) return setErr(t(lang, 'form.err.model'))
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
    <div className="form-page">
      <div className="add-head">
        <button type="button" className="btn sm" onClick={onBack} aria-label={t(lang, 'add.back')}>
          ‹
        </button>
        <h2>
          {form.id ? t(lang, 'form.editTitle') : t(lang, 'form.newTitle')} <span className="muted">{form.tool === 'claude' ? 'Claude Code' : 'Codex'}</span>
        </h2>
      </div>

      <div className="form-page-body">
        <section className="card form-head-card">
          <VendorLogo vendor={vendor} fallbackText={form.name || form.baseUrl} iconSlug={form.icon} />
          <div className="preset-card-text">
            <strong>{form.name || t(lang, 'form.newTitle')}</strong>
            <span className="muted small">{form.baseUrl ? safeHost(form.baseUrl) : '—'}</span>
          </div>
        </section>

        <section className="card">
          <h3>{t(lang, 'form.section.basic')}</h3>
          <div className="form">
            <label>
              {t(lang, 'form.name')} *
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
                  <VendorChipInline baseUrl={form.baseUrl.trim()} />
                </span>
              )}
            </label>
            <label>
              {t(lang, 'form.apiKey')} *
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
            <label>
              {t(lang, 'form.notes')}
              <textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} />
            </label>
          </div>
        </section>

        {form.tool === 'claude' ? (
          <section className="card">
            <button type="button" className="adv-toggle" onClick={() => setAdvancedOpen((v) => !v)}>
              <span className={`adv-caret${advancedOpen ? ' open' : ''}`} aria-hidden>
                ▸
              </span>
              {t(lang, 'form.section.advanced')}
            </button>
            {advancedOpen && (
              <div className="form">
                <label>
                  {t(lang, 'form.keyType')}
                  <Dropdown
                    value={form.keyType}
                    options={[
                      { value: 'auth_token', label: t(lang, 'form.keyType.auth') },
                      { value: 'api_key', label: t(lang, 'form.keyType.api') }
                    ]}
                    onChange={(v) => set({ keyType: v as KeyType })}
                  />
                </label>
                <label>
                  {t(lang, 'form.protocol')}
                  <Dropdown
                    value={form.protocol}
                    options={[
                      { value: 'anthropic', label: t(lang, 'form.protocol.anthropic') },
                      { value: 'openai', label: t(lang, 'form.protocol.openai') }
                    ]}
                    onChange={(v) => set({ protocol: v as 'anthropic' | 'openai' })}
                  />
                  <small>{t(lang, 'form.protocolHint')}</small>
                </label>
                <label>
                  {t(lang, 'form.modelClaude')}
                  <input value={form.model} onChange={(e) => set({ model: e.target.value })} placeholder="claude-sonnet-4-5" />
                </label>
                {form.protocol === 'openai' && (
                  <label>
                    {t(lang, 'form.wireApi')}
                    <Dropdown
                      value={form.wireApi}
                      options={[
                        { value: 'chat', label: 'Chat Completions' },
                        { value: 'responses', label: 'Responses API' }
                      ]}
                      onChange={(v) => set({ wireApi: v as 'responses' | 'chat' })}
                    />
                    <small>{t(lang, 'form.wireApiHint')}</small>
                  </label>
                )}
                <label>
                  {t(lang, 'form.alias')}
                  <input
                    value={form.alias ?? ''}
                    onChange={(e) => set({ alias: e.target.value })}
                    placeholder="glm、ds、kimi…"
                  />
                  <small>{t(lang, 'form.aliasHint')}</small>
                </label>
              </div>
            )}
          </section>
        ) : (
          <section className="card">
            <h3>{t(lang, 'form.section.advanced')}</h3>
            <div className="form">
              <label>
                {t(lang, 'form.modelCodex')}
                <input value={form.model} onChange={(e) => set({ model: e.target.value })} placeholder="gpt-5-codex" />
              </label>
              <label>
                wire_api
                <Dropdown
                  value={form.wireApi}
                  options={[
                    { value: 'responses', label: 'responses' },
                    { value: 'chat', label: 'chat' }
                  ]}
                  onChange={(v) => set({ wireApi: v as 'responses' | 'chat' })}
                />
              </label>
            </div>
          </section>
        )}

        {err && <div className="form-error">{err}</div>}

        <div className="form-actions form-page-actions">
          <button className="btn" onClick={onBack} disabled={saving}>
            {t(lang, 'btn.cancel')}
          </button>
          <button className="btn primary" onClick={submit} disabled={saving}>
            {saving ? t(lang, 'btn.saving') : t(lang, 'btn.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** 内联厂商徽章（Base URL 识别提示） */
function VendorChipInline({ baseUrl }: { baseUrl: string }) {
  const vendor = detectVendor(baseUrl)
  if (!vendor) return null
  return (
    <span className="vendor-chip" title={`已识别厂商：${vendor.name}`}>
      <span className="vendor-letter" style={{ background: vendor.color }}>
        {vendor.letter}
      </span>
      <span>{vendor.name}</span>
    </span>
  )
}
