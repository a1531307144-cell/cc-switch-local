import { useMemo, useState } from 'react'
import type { FormDraft, } from './ProviderForm'
import { emptyDraft } from './ProviderForm'
import type { Lang, Preset, ToolId } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { detectVendor } from '../../../shared/vendors'
import { VendorLogo } from './ui'

/**
 * 添加供应商整页视图（v0.8.13，对标原版 cc-switch 的添加页）：
 * 左侧分类（含计数）+ 顶部搜索（支持中文别名）+ 右侧预设卡片网格；
 * 点「自定义配置」或某张预设卡后进入原有表单弹窗补全 Key 等字段。
 */

const CATEGORIES: { key: Preset['category'] | 'all'; labelKey: string }[] = [
  { key: 'all', labelKey: 'add.cat.all' },
  { key: 'cn_official', labelKey: 'add.cat.vendor' },
  { key: 'aggregator', labelKey: 'add.cat.agg' },
  { key: 'third_party', labelKey: 'add.cat.third' },
  { key: 'cloud_provider', labelKey: 'add.cat.cloud' },
  { key: 'local', labelKey: 'add.cat.local' },
  { key: 'official', labelKey: 'add.cat.official' }
]

const LABELS: Record<ToolId, string> = { claude: 'Claude Code', codex: 'Codex' }

export default function AddProviderView({
  lang,
  presets,
  tool,
  onBack,
  onPick
}: {
  lang: Lang
  presets: Preset[]
  tool: ToolId
  onBack: () => void
  /** 选中某个预设（或 null=自定义配置），父层打开表单弹窗 */
  onPick: (draft: FormDraft) => void
}) {
  const [cat, setCat] = useState<Preset['category'] | 'all'>('all')
  const [q, setQ] = useState('')

  const mine = useMemo(() => presets.filter((p) => p.tool === tool), [presets, tool])
  const qq = q.trim().toLowerCase()
  const filtered = useMemo(() => {
    const byCat = cat === 'all' ? mine : mine.filter((p) => p.category === cat)
    if (qq === '') return byCat
    return byCat.filter((p) => p.searchKey?.includes(qq) || p.name.toLowerCase().includes(qq))
  }, [mine, cat, qq])

  /** 按 family||name 聚合成卡片（同族多端点 = N 个版本） */
  const cards = useMemo(() => {
    const groups = new Map<string, Preset[]>()
    for (const p of filtered) {
      const key = p.family ?? p.name
      const list = groups.get(key) ?? []
      list.push(p)
      groups.set(key, list)
    }
    return [...groups.values()].map((list) => ({
      key: list[0].family ?? list[0].name,
      name: list[0].name,
      preset: list.find((p) => p.tool === tool) ?? list[0],
      count: list.length
    }))
  }, [filtered, tool])

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of mine) {
      const k = p.category ?? 'all'
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }, [mine])

  const openPreset = (p: Preset): void => {
    onPick({
      ...emptyDraft(p.tool),
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: '',
      keyType: p.keyType ?? 'auth_token',
      protocol: p.protocol ?? 'anthropic',
      model: p.model ?? '',
      wireApi: p.wireApi ?? (p.tool === 'codex' ? 'responses' : 'chat'),
      notes: t(lang, 'form.presetApplied', { name: p.name }),
      icon: p.icon ?? ''
    })
  }

  return (
    <div className="add-page">
      <div className="add-head">
        <button type="button" className="btn sm" onClick={onBack} aria-label={t(lang, 'add.back')}>
          ‹
        </button>
        <h2>
          {t(lang, 'add.title')} <span className="muted">{LABELS[tool]}</span>
        </h2>
      </div>

      <div className="search add-search">
        <span aria-hidden>⌕</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(lang, 'add.searchPh')} autoFocus />
      </div>

      <div className="add-body">
        <aside className="add-cats">
          {CATEGORIES.map((c) => {
            const n = c.key === 'all' ? mine.length : counts.get(c.key as string) ?? 0
            if (c.key !== 'all' && n === 0) return null
            return (
              <button
                key={c.key}
                type="button"
                className={`add-cat${cat === c.key ? ' active' : ''}`}
                onClick={() => setCat(c.key)}
              >
                <span>{t(lang, c.labelKey as never)}</span>
                <span className="count">{n}</span>
              </button>
            )
          })}
        </aside>
        <div className="add-grid-wrap">
          <button type="button" className="preset-card add-custom" onClick={() => onPick(emptyDraft(tool))}>
            <span className="add-custom-icon">⚙</span>
            <span className="add-custom-text">
              <strong>{t(lang, 'add.custom')}</strong>
              <span className="muted small">{t(lang, 'add.customHint')}</span>
            </span>
          </button>
          <div className="add-grid">
            {cards.map((c) => {
              const vendor = detectVendor(c.preset.baseUrl)
              const domain = (() => {
                try {
                  return new URL(c.preset.baseUrl).hostname
                } catch {
                  return ''
                }
              })()
              return (
                <button key={c.key} type="button" className="preset-card" onClick={() => openPreset(c.preset)} title={c.preset.baseUrl}>
                  <VendorLogo vendor={vendor} fallbackText={c.name} iconSlug={c.preset.icon} />
                  <span className="preset-card-text">
                    <strong>
                      {c.name}
                      {c.count > 1 && <span className="badge-variants">{t(lang, 'add.versions', { n: c.count })}</span>}
                    </strong>
                    <span className="muted small">{domain}</span>
                  </span>
                </button>
              )
            })}
          </div>
          {cards.length === 0 && (
            <p className="muted">{t(lang, 'add.none')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
