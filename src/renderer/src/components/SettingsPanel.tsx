import { useEffect, useState } from 'react'
import type { AppSettings, BackupInfo, StoreShape, ToolId } from '../../../shared/types'

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function SettingsPanel({
  store,
  onChanged,
  notify
}: {
  store: StoreShape
  onChanged: () => Promise<void>
  notify: (text: string, kind?: 'ok' | 'err') => void
}) {
  const [backups, setBackups] = useState<Record<ToolId, BackupInfo[]>>({ claude: [], codex: [] })
  const [version, setVersion] = useState('')
  const [checking, setChecking] = useState(false)

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
  }, [])

  const updateSetting = async (patch: Partial<AppSettings>) => {
    await window.api.settingsUpdate(patch)
    await onChanged()
  }

  const checkUpdate = async () => {
    setChecking(true)
    try {
      const r = await window.api.updateCheck()
      if (r.error) notify(r.error, 'err')
      else if (r.version && r.version !== version) notify(`发现新版本 v${r.version}，请到 GitHub Releases 下载`)
      else notify('已是最新版本')
    } finally {
      setChecking(false)
    }
  }

  const restore = async (tool: ToolId, file: string) => {
    if (!window.confirm(`确定恢复备份 ${file} 吗？\n当前配置会先再自动备份一份。`)) return
    try {
      await window.api.toolRestoreBackup(tool, file)
      notify('已恢复备份，重启对应工具的会话后生效')
      await loadBackups()
      await onChanged()
    } catch (e) {
      notify((e as Error).message, 'err')
    }
  }

  const s = store.settings

  return (
    <div className="settings">
      <section className="card">
        <h3>外观</h3>
        <label className="field-row">
          主题
          <select value={s.theme} onChange={(e) => updateSetting({ theme: e.target.value as AppSettings['theme'] })}>
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
      </section>

      <section className="card">
        <h3>通用</h3>
        <label className="check">
          <input type="checkbox" checked={s.autoUpdate} onChange={(e) => updateSetting({ autoUpdate: e.target.checked })} />
          启动时自动检查更新（仅提示，不静默安装）
        </label>
        <label className="check">
          <input type="checkbox" checked={s.autoStart} onChange={(e) => updateSetting({ autoStart: e.target.checked })} />
          开机自启
        </label>
        <div className="field-row">
          <button className="btn sm" onClick={checkUpdate} disabled={checking || !version}>
            {checking ? '检查中…' : '检查更新'}
          </button>
          <span className="muted">当前版本 v{version || '…'}</span>
        </div>
      </section>

      <section className="card">
        <h3>数据与配置目录</h3>
        <p className="muted small">
          供应商数据（含明文 API Key）只保存在本机数据目录，不上传任何服务器。API Key 存储于
          providers.json，请注意不要把该目录分享给他人。
        </p>
        <div className="btn-row">
          <button className="btn sm" onClick={() => window.api.openPath('data')}>
            打开数据目录
          </button>
          <button className="btn sm" onClick={() => window.api.openPath('claudeConfig')}>
            打开 Claude 配置目录
          </button>
          <button className="btn sm" onClick={() => window.api.openPath('codexConfig')}>
            打开 Codex 配置目录
          </button>
        </div>
      </section>

      {(['claude', 'codex'] as ToolId[]).map((tool) => (
        <section className="card" key={tool}>
          <h3>{tool === 'claude' ? 'Claude Code' : 'Codex'} 配置备份（最近 {backups[tool].length} 份，自动保留 10 份）</h3>
          {backups[tool].length === 0 ? (
            <p className="muted small">暂无备份。每次切换/恢复前都会自动备份。</p>
          ) : (
            <table className="backup-table">
              <thead>
                <tr>
                  <th>文件</th>
                  <th>时间</th>
                  <th>大小</th>
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
                        恢复
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
        <h3>关于</h3>
        <p className="muted small">
          CC Switch Local v{version || '…'} —— 本地优先的 API 供应商管理与切换工具。所有数据仅存本机，无遥测、无上传；
          切换只改动目标工具配置文件中的少量键，其余内容原样保留，并在每次写入前自动备份。
        </p>
      </section>
    </div>
  )
}
