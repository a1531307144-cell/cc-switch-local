import { useEffect, useState } from 'react'
import type { KeyType, Preset, ToolId } from '../../../shared/types'
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

export default function ProviderForm({
  draft,
  onClose,
  onSave
}: {
  draft: FormDraft
  onClose: () => void
  onSave: (d: FormDraft) => Promise<void>
}) {
  const [form, setForm] = useState<FormDraft>(draft)
  const [presets, setPresets] = useState<Preset[]>([])
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

  const applyPreset = (name: string) => {
    const p = presets.find((x) => x.name === name)
    if (!p) return
    set({ name: p.name, baseUrl: p.baseUrl, model: p.model ?? '', notes: p.notes ?? form.notes })
  }

  const submit = async () => {
    if (!form.name.trim()) return setErr('请填写名称')
    if (!/^https?:\/\//.test(form.baseUrl.trim())) return setErr('Base URL 必须以 http:// 或 https:// 开头')
    if (!form.apiKey.trim()) return setErr('请填写 API Key')
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
    <Modal title={form.id ? '编辑供应商' : '新建供应商'} onClose={onClose}>
      <div className="form">
        <label>
          从预设填入（可选）
          <select value="" onChange={(e) => applyPreset(e.target.value)}>
            <option value="">— 选择预设 —</option>
            {presets.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
          <small>预设仅供参考，端点与模型以各服务商官方文档为准</small>
        </label>

        <label>
          名称 *
          <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="例如：我的中转站" />
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
              <span>已按端点自动识别</span>
            </span>
          )}
        </label>

        <label>
          API Key *
          <div className="key-row">
            <input
              type={showKey ? 'text' : 'password'}
              value={form.apiKey}
              onChange={(e) => set({ apiKey: e.target.value })}
              placeholder="sk-…"
            />
            <label className="check inline">
              <input type="checkbox" checked={showKey} onChange={(e) => setShowKey(e.target.checked)} />
              显示
            </label>
          </div>
        </label>

        {form.tool === 'claude' ? (
          <label>
            Key 类型
            <select value={form.keyType} onChange={(e) => set({ keyType: e.target.value as KeyType })}>
              <option value="auth_token">ANTHROPIC_AUTH_TOKEN（绝大多数中转站）</option>
              <option value="api_key">ANTHROPIC_API_KEY（官方 API 计费）</option>
            </select>
          </label>
        ) : (
          <>
            <label>
              模型（写入 config.toml 的 model，可选）
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
            模型（仅用于连接测试，可选）
            <input value={form.model} onChange={(e) => set({ model: e.target.value })} placeholder="claude-sonnet-4-5" />
          </label>
        )}

        <label>
          备注（可选）
          <textarea value={form.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} />
        </label>

        {err && <div className="form-error">{err}</div>}

        <div className="form-actions">
          <button className="btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button className="btn primary" onClick={submit} disabled={saving}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
