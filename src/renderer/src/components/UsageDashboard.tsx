import { useCallback, useEffect, useState } from 'react'
import type { Lang, UsageDay, UsageStats } from '../../../shared/types'
import { t } from '../../../shared/i18n'

function fmtTokens(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

function fmtCost(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n > 0) return `$${n.toFixed(4)}`
  return '$0'
}

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

const TOOL_LABEL: Record<string, string> = { claude: 'Claude', codex: 'Codex' }

/** GitHub 风格 53 周热力图：颜色档位按当日请求数 */
function Heatmap({ days, lang }: { days: UsageDay[]; lang: Lang }) {
  const byDate = new Map(days.map((d) => [d.date, d]))
  const cells: { date: string; requests: number; cost: number }[] = []
  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - 52 * 7 - today.getDay())
  for (let i = 0; i <= 53 * 7; i++) {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    if (d > today) break
    const p = (n: number) => String(n).padStart(2, '0')
    const key = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    const hit = byDate.get(key)
    cells.push({ date: key, requests: hit?.requests ?? 0, cost: hit?.cost ?? 0 })
  }
  const max = Math.max(1, ...cells.map((c) => c.requests))
  const level = (n: number): number => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)))
  // 按周分列：每列 7 天（周日起）
  const weeks: typeof cells[] = []
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7))

  return (
    <div className="heatmap-scroll">
      <div className="heatmap">
        {weeks.map((w, wi) => (
          <div className="heatmap-col" key={wi}>
            {w.map((c) => (
              <div
                key={c.date}
                className={`heatmap-cell lv${level(c.requests)}`}
                title={`${c.date}: ${c.requests}, ${fmtCost(c.cost)}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="heatmap-legend muted small">
        <span>{t(lang, 'usage.less')}</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className={`heatmap-cell lv${l}`} />
        ))}
        <span>{t(lang, 'usage.more')}</span>
      </div>
    </div>
  )
}

/** 最近 30 天请求柱状图（纯 SVG，无第三方依赖） */
function Trend({ days }: { days: UsageDay[] }) {
  const slice = days.slice(-30)
  if (slice.length === 0) return null
  const max = Math.max(1, ...slice.map((d) => d.requests))
  const W = 600
  const H = 120
  const bw = W / slice.length
  return (
    <svg className="trend" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="trend">
      {slice.map((d, i) => {
        const h = (d.requests / max) * (H - 18)
        return (
          <g key={d.date}>
            <title>{`${d.date}: ${d.requests}, ${fmtCost(d.cost)}`}</title>
            <rect x={i * bw + bw * 0.15} y={H - h} width={bw * 0.7} height={h} rx={2} className="trend-bar" />
          </g>
        )
      })}
    </svg>
  )
}

export default function UsageDashboard({ lang, notify }: { lang: Lang; notify: (text: string, kind?: 'ok' | 'err') => void }) {
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [scanning, setScanning] = useState(false)

  const scan = useCallback(async () => {
    setScanning(true)
    try {
      setStats(await window.api.usageGet())
    } catch (e) {
      notify(t(lang, 'usage.scanFail', { msg: (e as Error).message }), 'err')
    } finally {
      setScanning(false)
    }
  }, [lang, notify])

  useEffect(() => {
    void scan()
  }, [scan])

  if (!stats) {
    return (
      <div className="usage">
        <p className="muted">{scanning ? t(lang, 'usage.scanning') : t(lang, 'usage.none')}</p>
      </div>
    )
  }

  const total = stats.totals
  const cacheHitRate = total.input + total.cacheRead > 0 ? Math.round((total.cacheRead / (total.input + total.cacheRead)) * 100) : 0

  return (
    <div className="usage">
      <div className="usage-head">
        <div>
          <h2>{t(lang, 'usage.title')}</h2>
          <p className="muted small">{t(lang, 'usage.desc', { files: stats.scannedFiles, ms: stats.scanMs })}</p>
        </div>
        <button className="btn sm" onClick={() => void scan()} disabled={scanning}>
          {scanning ? t(lang, 'usage.scanning') : t(lang, 'usage.rescan')}
        </button>
      </div>

      <div className="usage-cards">
        <div className="stat-card">
          <div className="stat-num">{total.requests.toLocaleString()}</div>
          <div className="stat-label">{t(lang, 'usage.requests')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{fmtTokens(total.input + total.cacheRead)}</div>
          <div className="stat-label">{t(lang, 'usage.input', { n: fmtTokens(total.cacheRead) })}</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{fmtTokens(total.output)}</div>
          <div className="stat-label">{t(lang, 'usage.output')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{fmtCost(total.cost)}</div>
          <div className="stat-label">{t(lang, 'usage.cost')}</div>
        </div>
        <div className="stat-card">
          <div className="stat-num">{cacheHitRate}%</div>
          <div className="stat-label">{t(lang, 'usage.cacheRate')}</div>
        </div>
      </div>

      <section className="card">
        <h3>{t(lang, 'usage.heatmap')}</h3>
        <Heatmap days={stats.days} lang={lang} />
      </section>

      <section className="card">
        <h3>{t(lang, 'usage.trend')}</h3>
        <Trend days={stats.days} />
      </section>

      <section className="card">
        <h3>{t(lang, 'usage.byModel')}</h3>
        {stats.models.length === 0 ? (
          <p className="muted small">{t(lang, 'usage.noRecords')}</p>
        ) : (
          <table className="backup-table">
            <thead>
              <tr>
                <th>{t(lang, 'th.model')}</th>
                <th>{t(lang, 'th.tool')}</th>
                <th>{t(lang, 'th.requests')}</th>
                <th>{t(lang, 'th.input')}</th>
                <th>{t(lang, 'th.output')}</th>
                <th>{t(lang, 'th.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {stats.models.slice(0, 20).map((m) => (
                <tr key={`${m.tool}|${m.model}`}>
                  <td>
                    <code className="small">{m.model}</code>
                  </td>
                  <td className="muted small">{TOOL_LABEL[m.tool] ?? m.tool}</td>
                  <td>{m.requests.toLocaleString()}</td>
                  <td>{fmtTokens(m.input)}</td>
                  <td>{fmtTokens(m.output)}</td>
                  <td>{fmtCost(m.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="card">
        <h3>{t(lang, 'usage.recent')}</h3>
        {stats.recent.length === 0 ? (
          <p className="muted small">{t(lang, 'usage.noRecords')}</p>
        ) : (
          <table className="backup-table">
            <thead>
              <tr>
                <th>{t(lang, 'th.time')}</th>
                <th>{t(lang, 'th.tool')}</th>
                <th>{t(lang, 'th.model')}</th>
                <th>{t(lang, 'th.input')}</th>
                <th>{t(lang, 'th.output')}</th>
                <th>{t(lang, 'th.cacheRead')}</th>
                <th>{t(lang, 'th.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {stats.recent.slice(0, 100).map((e, i) => (
                <tr key={`${e.ts}-${i}`}>
                  <td className="muted small">{fmtTime(e.ts)}</td>
                  <td className="muted small">{TOOL_LABEL[e.tool] ?? e.tool}</td>
                  <td>
                    <code className="small">{e.model}</code>
                  </td>
                  <td className="small">{fmtTokens(e.input)}</td>
                  <td className="small">{fmtTokens(e.output)}</td>
                  <td className="small">{fmtTokens(e.cacheRead)}</td>
                  <td className="small">{fmtCost(e.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
