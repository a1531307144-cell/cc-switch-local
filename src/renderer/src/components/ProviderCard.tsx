import { useState } from 'react'
import type { DragEvent } from 'react'
import type { BalanceResult, Lang, Provider, TestResult } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { detectVendor } from '../../../shared/vendors'
import { buildProviderDeeplink } from '../../../main/deeplink'
import { VendorLogo } from './ui'

function testBadge(r: TestResult, lang: Lang): { text: string; cls: string } {
  if (r.kind === 'ok') return { text: t(lang, 'test.ok', { ms: r.latencyMs ?? 0 }), cls: 'ok' }
  if (r.kind === 'auth') return { text: t(lang, 'test.auth', { status: r.status ?? '' }), cls: 'err' }
  if (r.kind === 'http') return { text: t(lang, 'test.http', { status: r.status ?? '' }), cls: 'err' }
  return { text: t(lang, 'test.network', { msg: r.message ?? '' }), cls: 'err' }
}

/**
 * 图标优先的紧凑卡片（v0.8.0）：卡面只保留厂商图标 + 名称，
 * Key/端点/备注等细节收进「⋯」菜单和编辑对话框；卡片可拖拽排序。
 */
export default function ProviderCard({
  provider,
  lang,
  isCurrent,
  busy,
  dragging,
  dropTarget,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onSwitch,
  onEdit,
  onClone,
  onDelete
}: {
  provider: Provider
  lang: Lang
  isCurrent: boolean
  busy: boolean
  dragging: boolean
  dropTarget: boolean
  onDragStart: (id: string, e: DragEvent) => void
  onDragOver: (id: string, e: DragEvent) => void
  onDrop: (id: string, e: DragEvent) => void
  onDragEnd: () => void
  onSwitch: (p: Provider) => void
  onEdit: (p: Provider) => void
  onClone: (p: Provider) => void
  onDelete: (p: Provider) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [balance, setBalance] = useState<BalanceResult | null>(null)
  const [checking, setChecking] = useState(false)
  const vendor = detectVendor(provider.baseUrl)
  // 余额查询只对有官方余额接口的三家显示（不把 Key 发给第三方）
  const balanceAvailable = vendor?.id === 'deepseek' || vendor?.id === 'moonshot' || vendor?.id === 'openrouter'

  const runTest = async () => {
    setTesting(true)
    setBalance(null)
    try {
      setResult(
        await window.api.providerTest({
          tool: provider.tool,
          baseUrl: provider.baseUrl,
          apiKey: provider.apiKey,
          keyType: provider.keyType,
          model: provider.model
        })
      )
    } catch (e) {
      setResult({ ok: false, kind: 'network', message: (e as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const runBalance = async () => {
    setChecking(true)
    setResult(null)
    try {
      setBalance(await window.api.balanceGet({ baseUrl: provider.baseUrl, apiKey: provider.apiKey }))
    } catch (e) {
      setBalance({ ok: false, message: (e as Error).message })
    } finally {
      setChecking(false)
    }
  }

  const copyLink = async () => {
    const link = buildProviderDeeplink({
      tool: provider.tool,
      name: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.model,
      keyType: provider.keyType,
      wireApi: provider.wireApi
    })
    try {
      await navigator.clipboard.writeText(link)
      window.alert(t(lang, 'card.linkCopied'))
    } catch {
      /* 剪贴板不可用时静默 */
    }
  }

  let note: { text: string; cls: string } | null = null
  if (result) note = testBadge(result, lang)
  else if (balance) {
    note = balance.ok
      ? { text: t(lang, 'card.balanceShow', { balance: balance.balance ?? 0, currency: balance.currency ?? '' }), cls: 'ok' }
      : { text: balance.message ?? '', cls: 'err' }
  }

  return (
    <div
      className={`pcard${isCurrent ? ' current' : ''}${dragging ? ' dragging' : ''}${dropTarget ? ' drop' : ''}`}
      draggable
      onDragStart={(e) => onDragStart(provider.id, e)}
      onDragOver={(e) => onDragOver(provider.id, e)}
      onDrop={(e) => onDrop(provider.id, e)}
      onDragEnd={onDragEnd}
    >
      {isCurrent && <span className="pcard-inuse">{t(lang, 'card.inUse')}</span>}
      <div className="pcard-logo">
        <VendorLogo vendor={vendor} fallbackText={provider.name} />
      </div>
      <div className="pcard-name" title={provider.name}>
        {provider.name}
      </div>
      {vendor && <div className="pcard-sub">{vendor.name}</div>}
      {note && (
        <button type="button" className={`pcard-note ${note.cls}`} title={note.text} onClick={() => { setResult(null); setBalance(null) }}>
          {note.text}
        </button>
      )}
      <div className="pcard-actions">
        {isCurrent ? (
          <button className="btn primary sm" disabled>
            {t(lang, 'card.inUse')}
          </button>
        ) : (
          <button className="btn primary sm" disabled={busy} onClick={() => onSwitch(provider)}>
            {busy ? t(lang, 'card.switching') : t(lang, 'card.enable')}
          </button>
        )}
        <div
          className="dd"
          onBlur={() => {
            window.setTimeout(() => setMenuOpen(false), 120)
          }}
        >
          <button
            type="button"
            className="btn sm icon-btn"
            title={t(lang, 'card.more')}
            aria-label={t(lang, 'card.more')}
            onClick={() => setMenuOpen((v) => !v)}
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="menu">
              <button
                type="button"
                className="menu-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setMenuOpen(false)
                  onEdit(provider)
                }}
              >
                {t(lang, 'card.edit')}
              </button>
              <button
                type="button"
                className="menu-item"
                onMouseDown={(e) => e.preventDefault()}
                disabled={testing}
                onClick={() => void runTest()}
              >
                {testing ? t(lang, 'card.testing') : t(lang, 'card.test')}
              </button>
              {balanceAvailable && (
                <button
                  type="button"
                  className="menu-item"
                  onMouseDown={(e) => e.preventDefault()}
                  disabled={checking}
                  onClick={() => void runBalance()}
                >
                  {checking ? t(lang, 'card.balanceChecking') : t(lang, 'card.balance')}
                </button>
              )}
              <button
                type="button"
                className="menu-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setMenuOpen(false)
                  void copyLink()
                }}
              >
                {t(lang, 'card.copyLink')}
              </button>
              <button
                type="button"
                className="menu-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setMenuOpen(false)
                  onClone(provider)
                }}
              >
                {t(lang, 'card.clone')}
              </button>
              <div className="menu-sep" />
              <button
                type="button"
                className="menu-item danger"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setMenuOpen(false)
                  if (window.confirm(t(lang, 'card.confirmDeleteMsg', { name: provider.name }))) onDelete(provider)
                }}
              >
                {t(lang, 'card.delete')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
