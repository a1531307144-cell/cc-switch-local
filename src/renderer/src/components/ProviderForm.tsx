import { useState } from 'react'
import type { KeyType, Lang, ModelRole, ToolId } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { detectVendor } from '../../../shared/vendors'
import { Dropdown, VendorLogo } from './ui'

/** 模型映射档位与顺序（v0.8.18，与原版 cc-switch 一致；subagent 无 _NAME 显示名） */
export const MAPPING_ROLES: ModelRole[] = ['sonnet', 'opus', 'fable', 'haiku', 'subagent']

export interface MappingDraft {
  model: string
  display: string
  ctx1m: boolean
}

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
  /** 模型映射（v0.8.18，仅 claude）：写入 ANTHROPIC_DEFAULT_*_MODEL 等 env */
  modelMapping: Record<ModelRole, MappingDraft>
  /** 默认兜底模型声明 1M（ANTHROPIC_MODEL 值带「 [1m]」后缀） */
  model1m: boolean
  /** 完整 URL（仅 claude）：本机路由原样使用 baseUrl，不拼 /v1/* */
  fullUrl: boolean
  customUserAgent: string
  /** JSON 文本，保存时解析（空串 = 未设置） */
  headerOverrides: string
  bodyOverrides: string
}

export function emptyMapping(): Record<ModelRole, MappingDraft> {
  return {
    sonnet: { model: '', display: '', ctx1m: false },
    opus: { model: '', display: '', ctx1m: false },
    fable: { model: '', display: '', ctx1m: false },
    haiku: { model: '', display: '', ctx1m: false },
    subagent: { model: '', display: '', ctx1m: false }
  }
}

/** 供应商库里的映射 → 表单草稿（编辑/导入回填用） */
export function mappingToDraft(
  mm?: { [K in ModelRole]?: { model: string; display?: string; ctx1m?: boolean } }
): Record<ModelRole, MappingDraft> {
  const out = emptyMapping()
  if (mm) {
    for (const role of MAPPING_ROLES) {
      const e = mm[role]
      if (e) out[role] = { model: e.model, display: e.display ?? '', ctx1m: e.ctx1m === true }
    }
  }
  return out
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
    icon: '',
    modelMapping: emptyMapping(),
    model1m: false,
    fullUrl: false,
    customUserAgent: '',
    headerOverrides: '',
    bodyOverrides: ''
  }
}

/** 自定义 User-Agent 的快捷预设（v0.8.18） */
const UA_PRESETS = [
  'claude-cli/2.0.28 (external, cli)',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
]

function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** 解析覆盖 JSON：合法对象返回之，否则 null（提交前校验用） */
function parseOverrideJson(text: string): Record<string, unknown> | null {
  if (!text.trim()) return {}
  try {
    const j = JSON.parse(text) as unknown
    if (!j || typeof j !== 'object' || Array.isArray(j)) return null
    return j as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * 模型输入框：拿到「获取模型列表」结果后，右侧出现 ▾ 可从列表挑选。
 * 复用 preset-picker 的交互（onMouseDown preventDefault 防止 blur 抢先关闭）。
 */
function ModelInput({
  value,
  onChange,
  models,
  placeholder
}: {
  value: string
  onChange: (v: string) => void
  models: string[] | null
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const hasList = !!models && models.length > 0
  const filtered = hasList && value.trim() ? models!.filter((m) => m.toLowerCase().includes(value.trim().toLowerCase())) : models ?? []
  return (
    <div
      className="model-input"
      onBlur={() => {
        window.setTimeout(() => setOpen(false), 120)
      }}
    >
      <input value={value} onChange={(e) => onChange(e.target.value)} onFocus={() => hasList && setOpen(true)} placeholder={placeholder} />
      {hasList && (
        <button
          type="button"
          className="model-caret"
          aria-label="models"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setOpen((v) => !v)}
        >
          ▾
        </button>
      )}
      {open && hasList && (
        <div className="model-pop">
          {filtered.slice(0, 200).map((m) => (
            <button
              type="button"
              key={m}
              className="preset-item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(m)
                setOpen(false)
              }}
            >
              <span>{m}</span>
            </button>
          ))}
          {filtered.length === 0 && (
            <div className="preset-item muted">
              <span>{value.trim() ? '—' : '—'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 添加/编辑供应商整页表单（v0.8.15，对标原版 cc-switch 的配置页）：
 * 头部图标卡 + 基本信息卡片 + 高级选项折叠卡片，底部保存/返回。
 * v0.8.18 起高级选项含模型映射、获取模型列表、完整 URL、自定义 User-Agent 与请求覆盖。
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
  const [models, setModels] = useState<string[] | null>(null)
  const [modelsMsg, setModelsMsg] = useState('')
  const [modelsOk, setModelsOk] = useState(false)
  const [fetchingModels, setFetchingModels] = useState(false)
  // 高级选项默认展开条件：编辑已有配置且高级字段非默认值
  const [advancedOpen, setAdvancedOpen] = useState(() =>
    form.tool === 'claude'
      ? form.keyType !== 'auth_token' ||
        form.protocol === 'openai' ||
        !!form.alias ||
        form.fullUrl ||
        form.model1m ||
        !!form.customUserAgent ||
        !!form.headerOverrides ||
        !!form.bodyOverrides ||
        MAPPING_ROLES.some((r) => !!form.modelMapping[r].model) ||
        (!!form.id && !!form.model)
      : false
  )

  const set = (patch: Partial<FormDraft>) => setForm((f) => ({ ...f, ...patch }))
  const setRole = (role: ModelRole, patch: Partial<MappingDraft>) =>
    setForm((f) => ({ ...f, modelMapping: { ...f.modelMapping, [role]: { ...f.modelMapping[role], ...patch } } }))
  const vendor = detectVendor(form.baseUrl.trim())

  const doFetchModels = async () => {
    if (!form.baseUrl.trim() || !form.apiKey.trim()) {
      setModelsOk(false)
      setModelsMsg(t(lang, 'form.modelsNeed'))
      return
    }
    setFetchingModels(true)
    setModelsMsg('')
    try {
      const r = await window.api.modelsFetch({
        baseUrl: form.baseUrl.trim(),
        apiKey: form.apiKey.trim(),
        keyType: form.keyType,
        protocol: form.tool === 'claude' ? form.protocol : undefined
      })
      if (r.ok && r.models?.length) {
        setModels(r.models)
        setModelsOk(true)
        setModelsMsg(t(lang, 'form.modelsOk', { n: r.models.length }))
      } else {
        setModelsOk(false)
        setModelsMsg(t(lang, 'form.modelsFail', { msg: r.message ?? '—' }))
      }
    } catch (e) {
      setModelsOk(false)
      setModelsMsg(t(lang, 'form.modelsFail', { msg: (e as Error).message }))
    } finally {
      setFetchingModels(false)
    }
  }

  const fillAllRoles = () => {
    const m = form.model.trim()
    if (!m) {
      setModelsOk(false)
      setModelsMsg(t(lang, 'form.oneKeyNeed'))
      return
    }
    setForm((f) => ({
      ...f,
      modelMapping: Object.fromEntries(MAPPING_ROLES.map((r) => [r, { model: m, display: '', ctx1m: false }])) as Record<ModelRole, MappingDraft>
    }))
  }

  const clearMapping = () => set({ modelMapping: emptyMapping() })

  const submit = async () => {
    if (!form.name.trim()) return setErr(t(lang, 'form.err.name'))
    if (!/^https?:\/\//.test(form.baseUrl.trim())) return setErr(t(lang, 'form.err.url'))
    if (!form.apiKey.trim()) return setErr(t(lang, 'form.err.key'))
    if (form.tool === 'claude' && form.protocol === 'openai' && !form.model.trim()) return setErr(t(lang, 'form.err.model'))
    if (form.tool === 'claude' && form.headerOverrides.trim()) {
      const j = parseOverrideJson(form.headerOverrides)
      if (!j || Object.values(j).some((v) => typeof v !== 'string')) return setErr(t(lang, 'form.err.headerJson'))
    }
    if (form.tool === 'claude' && form.bodyOverrides.trim() && !parseOverrideJson(form.bodyOverrides)) {
      return setErr(t(lang, 'form.err.bodyJson'))
    }
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
                <label className="check">
                  <input type="checkbox" checked={form.fullUrl} onChange={(e) => set({ fullUrl: e.target.checked })} />
                  {t(lang, 'form.fullUrl')}
                </label>
                <small>{t(lang, 'form.fullUrlHint')}</small>

                <div className="map-block">
                  <div className="map-head">
                    <div className="map-title">
                      <strong>{t(lang, 'form.modelMapping')}</strong>
                      <small>{t(lang, 'form.mappingHint')}</small>
                    </div>
                    <div className="map-actions">
                      <button type="button" className="btn sm" onClick={clearMapping}>
                        {t(lang, 'form.mappingClear')}
                      </button>
                      <button type="button" className="btn sm" onClick={fillAllRoles}>
                        {t(lang, 'form.mappingOneKey')}
                      </button>
                      <button type="button" className="btn sm" onClick={doFetchModels} disabled={fetchingModels}>
                        {fetchingModels ? t(lang, 'form.fetching') : t(lang, 'form.fetchModels')}
                      </button>
                    </div>
                  </div>
                  {modelsMsg && <small className={`map-msg${modelsOk ? ' ok' : ' err'}`}>{modelsMsg}</small>}
                  <div className="map-table">
                    <div className="map-row map-row-head">
                      <span>{t(lang, 'form.roleLabel')}</span>
                      <span>{t(lang, 'form.display')}</span>
                      <span>{t(lang, 'form.actual')}</span>
                      <span className="map-1m">1M</span>
                    </div>
                    <div className="map-row">
                      <span className="map-role">Sonnet</span>
                      <ModelInput
                        value={form.modelMapping.sonnet.display}
                        onChange={(v) => setRole('sonnet', { display: v })}
                        models={models}
                        placeholder={t(lang, 'form.displayPh')}
                      />
                      <ModelInput
                        value={form.modelMapping.sonnet.model}
                        onChange={(v) => setRole('sonnet', { model: v })}
                        models={models}
                        placeholder={t(lang, 'form.actualPh')}
                      />
                      <label className="check inline map-1m">
                        <input type="checkbox" checked={form.modelMapping.sonnet.ctx1m} onChange={(e) => setRole('sonnet', { ctx1m: e.target.checked })} />
                        1M
                      </label>
                    </div>
                    <div className="map-row">
                      <span className="map-role">Opus</span>
                      <ModelInput
                        value={form.modelMapping.opus.display}
                        onChange={(v) => setRole('opus', { display: v })}
                        models={models}
                        placeholder={t(lang, 'form.displayPh')}
                      />
                      <ModelInput
                        value={form.modelMapping.opus.model}
                        onChange={(v) => setRole('opus', { model: v })}
                        models={models}
                        placeholder={t(lang, 'form.actualPh')}
                      />
                      <label className="check inline map-1m">
                        <input type="checkbox" checked={form.modelMapping.opus.ctx1m} onChange={(e) => setRole('opus', { ctx1m: e.target.checked })} />
                        1M
                      </label>
                    </div>
                    <div className="map-row">
                      <span className="map-role">Fable</span>
                      <ModelInput
                        value={form.modelMapping.fable.display}
                        onChange={(v) => setRole('fable', { display: v })}
                        models={models}
                        placeholder={t(lang, 'form.displayPh')}
                      />
                      <ModelInput
                        value={form.modelMapping.fable.model}
                        onChange={(v) => setRole('fable', { model: v })}
                        models={models}
                        placeholder={t(lang, 'form.actualPh')}
                      />
                      <label className="check inline map-1m">
                        <input type="checkbox" checked={form.modelMapping.fable.ctx1m} onChange={(e) => setRole('fable', { ctx1m: e.target.checked })} />
                        1M
                      </label>
                    </div>
                    <div className="map-row">
                      <span className="map-role">Haiku</span>
                      <ModelInput
                        value={form.modelMapping.haiku.display}
                        onChange={(v) => setRole('haiku', { display: v })}
                        models={models}
                        placeholder={t(lang, 'form.displayPh')}
                      />
                      <ModelInput
                        value={form.modelMapping.haiku.model}
                        onChange={(v) => setRole('haiku', { model: v })}
                        models={models}
                        placeholder={t(lang, 'form.actualPh')}
                      />
                      <label className="check inline map-1m">
                        <input type="checkbox" checked={form.modelMapping.haiku.ctx1m} onChange={(e) => setRole('haiku', { ctx1m: e.target.checked })} />
                        1M
                      </label>
                    </div>
                    <div className="map-row">
                      <span className="map-role">Subagent</span>
                      <span className="map-nodisp">{t(lang, 'form.subagentNoMenu')}</span>
                      <ModelInput
                        value={form.modelMapping.subagent.model}
                        onChange={(v) => setRole('subagent', { model: v })}
                        models={models}
                        placeholder={t(lang, 'form.actualPh')}
                      />
                      <label className="check inline map-1m">
                        <input type="checkbox" checked={form.modelMapping.subagent.ctx1m} onChange={(e) => setRole('subagent', { ctx1m: e.target.checked })} />
                        1M
                      </label>
                    </div>
                  </div>
                </div>

                <label>
                  {t(lang, 'form.defaultModel')}
                  <div className="key-row">
                    <ModelInput
                      value={form.model}
                      onChange={(v) => set({ model: v })}
                      models={models}
                      placeholder="claude-sonnet-4-5"
                    />
                    <label className="check inline">
                      <input type="checkbox" checked={form.model1m} onChange={(e) => set({ model1m: e.target.checked })} />
                      1M
                    </label>
                  </div>
                  <small>{t(lang, 'form.defaultModelHint')}</small>
                </label>
                <label>
                  {t(lang, 'form.alias')}
                  <input
                    value={form.alias ?? ''}
                    onChange={(e) => set({ alias: e.target.value })}
                    placeholder="glm、ds、kimi…"
                  />
                  <small>{t(lang, 'form.aliasHint')}</small>
                </label>

                <label>
                  {t(lang, 'form.userAgent')}
                  <div className="key-row">
                    <input
                      value={form.customUserAgent}
                      onChange={(e) => set({ customUserAgent: e.target.value })}
                      placeholder={UA_PRESETS[0]}
                    />
                    <Dropdown
                      value=""
                      ariaLabel={t(lang, 'form.uaPreset')}
                      options={[{ value: '', label: t(lang, 'form.uaPreset') }, ...UA_PRESETS.map((u) => ({ value: u, label: u }))]}
                      onChange={(v) => {
                        if (v) set({ customUserAgent: v })
                      }}
                    />
                  </div>
                  <small>{t(lang, 'form.routerOnly')}</small>
                </label>

                <label>
                  {t(lang, 'form.headerOverride')}
                  <textarea
                    className="mono"
                    value={form.headerOverrides}
                    onChange={(e) => set({ headerOverrides: e.target.value })}
                    rows={3}
                    placeholder={'{\n  "X-Provider": "ccsl"\n}'}
                  />
                </label>
                <label>
                  {t(lang, 'form.bodyOverride')}
                  <textarea
                    className="mono"
                    value={form.bodyOverrides}
                    onChange={(e) => set({ bodyOverrides: e.target.value })}
                    rows={3}
                    placeholder={'{\n  "temperature": 0.2\n}'}
                  />
                  <small>{t(lang, 'form.overridesHint')}</small>
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
                <div className="key-row">
                  <ModelInput value={form.model} onChange={(v) => set({ model: v })} models={models} placeholder="gpt-5-codex" />
                  <button type="button" className="btn sm" onClick={doFetchModels} disabled={fetchingModels}>
                    {fetchingModels ? t(lang, 'form.fetching') : t(lang, 'form.fetchModels')}
                  </button>
                </div>
                {modelsMsg && <small className={`map-msg${modelsOk ? ' ok' : ' err'}`}>{modelsMsg}</small>}
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
