import { useState } from 'react'
import type { BalanceResult, Lang, Provider, TestResult } from '../../../shared/types'
import { t } from '../../../shared/i18n'
import { detectVendor } from '../../../shared/vendors'
import { buildProviderDeeplink } from '../../../main/deeplink'
import { VendorChip } from './ui'

function testBadge(r: TestResult, lang: Lang): { text: string; cls: string } {
  if (r.kind === 'ok') return { text: t(lang, 'test.ok', { ms: r.latencyMs ?? 0 }), cls: 'ok' }
  if (r.kind === 'auth') return { text: t(lang, 'test.auth', { status: r.status ?? '' }), cls: 'err' }
  if (r.kind === 'http') return { text: t(lang, 'test.http', { status: r.status ?? '' }), cls: 'err' }
  return { text: t(lang, 'test.network', { msg: r.message ?? '' }), cls: 'err' }
}

export default function ProviderCard({
  provider,
  lang,
  isCurrent,
  busy,
  onSwitch,
  onEdit,
  onDelete
}: {
  provider: Provider
  lang: Lang
  isCurrent: boolean
  busy: boolean
  onSwitch: (p: Provider) => void
  onEdit: (p: Provider) => void
  onDelete: (p: Provider) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const [balance, setBalance] = useState<BalanceResult | null>(null)
  const [checking, setChecking] = useState(false)
  const maskedKey = provider.apiKey.length <= 8 ? '****' : `${provider.apiKey.slice(0, 4)}****${provider.apiKey.slice(-4)}`
  const vendor = detectVendor(provider.baseUrl)
  // 余额查询只对有官方余额接口的三家显示按钮（不把 Key 发给第三方）
  const balanceAvailable = vendor?.id === 'deepseek' || vendor?.id === 'moonshot' || vendor?.id === 'openrouter'

  const runTest = async () => {
    setTesting(true)
    setResult(null)
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
    setBalance(null)
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
      alert(t(lang, 'card.linkCopied'))
    } catch {
      /* 剪贴板不可用时静默 */
    }
  }

  return (
    <div className={`card provider ${isCurrent ? 'current' : ''}`}>
      <div className="row">
        <div className="title">
          <strong>{provider.name}</strong>
          {vendor && <VendorChip vendor={vendor} />}
          {isCurrent && <span className="badge accent">{t(lang, 'card.inUse')}</span>}
          {provider.tool === 'claude' ? (
            <span className="badge">{provider.keyType === 'api_key' ? 'ANTHROPIC_API_KEY' : 'ANTHROPIC_AUTH_TOKEN'}</span>
          ) : (
            <span className="badge">wire_api: {provider.wireApi ?? 'responses'}</span>
          )}
          {provider.model && <span className="badge">model: {provider.model}</span>}
        </div>
        <div className="actions">
          {isCurrent ? (
            <button className="btn primary sm" disabled>
              {t(lang, 'card.inUse')}
            </button>
          ) : (
            <button className="btn primary sm" disabled={busy} onClick={() => onSwitch(provider)}>
              {busy ? t(lang, 'card.switching') : t(lang, 'card.enable')}
            </button>
          )}
          <button className="btn sm" disabled={testing} onClick={runTest}>
            {testing ? t(lang, 'card.testing') : t(lang, 'card.test')}
          </button>
          {balanceAvailable && (
            <button className="btn sm" disabled={checking} onClick={runBalance}>
              {checking ? t(lang, 'card.balanceChecking') : t(lang, 'card.balance')}
            </button>
          )}
          <button className="btn sm" onClick={() => onEdit(provider)}>
            {t(lang, 'card.edit')}
          </button>
          {confirming ? (
            <>
              <button
                className="btn danger sm"
                onClick={() => {
                  setConfirming(false)
                  onDelete(provider)
                }}
              >
                {t(lang, 'card.confirmDelete')}
              </button>
              <button className="btn sm" onClick={() => setConfirming(false)}>
                {t(lang, 'btn.cancel')}
              </button>
            </>
          ) : (
            <button className="btn sm" onClick={() => setConfirming(true)}>
              {t(lang, 'card.delete')}
            </button>
          )}
        </div>
      </div>
      <div className="meta">
        <code className="url">{provider.baseUrl}</code>
        <span className="key">
          {t(lang, 'card.keyLabel')}
          {maskedKey}
        </span>
        <button className="btn ghost sm copy-link" onClick={() => void copyLink()} title={t(lang, 'card.copyLink')}>
          {t(lang, 'card.copyLink')}
        </button>
      </div>
      {provider.notes && <div className="notes">{provider.notes}</div>}
      {result && <div className={`test-result ${testBadge(result, lang).cls}`}>{testBadge(result, lang).text}</div>}
      {balance &&
        (balance.ok ? (
          <div className="test-result ok">
            {t(lang, 'card.balanceShow', { balance: balance.balance ?? 0, currency: balance.currency ?? '' })}
          </div>
        ) : (
          <div className="test-result err">{balance.message}</div>
        ))}
    </div>
  )
}
