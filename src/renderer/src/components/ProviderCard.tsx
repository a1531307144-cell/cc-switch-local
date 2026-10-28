import { useState } from 'react'
import type { Provider, TestResult } from '../../../shared/types'

function testBadge(r: TestResult): { text: string; cls: string } {
  if (r.kind === 'ok') return { text: `✓ 连通正常 · ${r.latencyMs}ms`, cls: 'ok' }
  if (r.kind === 'auth') return { text: `✗ 鉴权失败（${r.status}）`, cls: 'err' }
  if (r.kind === 'http') return { text: `✗ HTTP ${r.status}`, cls: 'err' }
  return { text: `✗ ${r.message ?? '网络错误'}`, cls: 'err' }
}

export default function ProviderCard({
  provider,
  isCurrent,
  busy,
  onSwitch,
  onEdit,
  onDelete
}: {
  provider: Provider
  isCurrent: boolean
  busy: boolean
  onSwitch: (p: Provider) => void
  onEdit: (p: Provider) => void
  onDelete: (p: Provider) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)
  const maskedKey = provider.apiKey.length <= 8 ? '****' : `${provider.apiKey.slice(0, 4)}****${provider.apiKey.slice(-4)}`

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

  return (
    <div className={`card provider ${isCurrent ? 'current' : ''}`}>
      <div className="row">
        <div className="title">
          <strong>{provider.name}</strong>
          {isCurrent && <span className="badge accent">使用中</span>}
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
              使用中
            </button>
          ) : (
            <button className="btn primary sm" disabled={busy} onClick={() => onSwitch(provider)}>
              {busy ? '切换中…' : '启用'}
            </button>
          )}
          <button className="btn sm" disabled={testing} onClick={runTest}>
            {testing ? '测试中…' : '测试'}
          </button>
          <button className="btn sm" onClick={() => onEdit(provider)}>
            编辑
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
                确认删除
              </button>
              <button className="btn sm" onClick={() => setConfirming(false)}>
                取消
              </button>
            </>
          ) : (
            <button className="btn sm" onClick={() => setConfirming(true)}>
              删除
            </button>
          )}
        </div>
      </div>
      <div className="meta">
        <code className="url">{provider.baseUrl}</code>
        <span className="key">Key：{maskedKey}</span>
      </div>
      {provider.notes && <div className="notes">{provider.notes}</div>}
      {result && (
        <div className={`test-result ${testBadge(result).cls}`}>{testBadge(result).text}</div>
      )}
    </div>
  )
}
