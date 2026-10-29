import { useEffect, useState } from 'react'
import type { AppSettings, BackupInfo, RouterStatus, StoreShape, ToolId } from '../../../shared/types'
import { Modal } from './ui'

function fmtDate(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** 加密备份的口令输入对话框（导出/导入共用） */
function PassphraseModal({
  mode,
  onClose,
  onConfirm
}: {
  mode: 'export' | 'import'
  onClose: () => void
  onConfirm: (pass: string) => void
}) {
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [err, setErr] = useState('')
  const exporting = mode === 'export'
  const submit = () => {
    if (pass.length < 8) return setErr('口令至少 8 个字符')
    if (exporting && pass !== pass2) return setErr('两次输入的口令不一致')
    setErr('')
    onConfirm(pass)
  }
  return (
    <Modal title={exporting ? '导出加密备份' : '导入加密备份'} onClose={onClose}>
      <div className="form">
        <p className="muted small">
          {exporting
            ? '供应商库（含 API Key）会用 AES-256-GCM 加密后保存到你选择的位置；口令不会存储，忘记将无法恢复。'
            : '选择 .ccslbak 备份文件，用导出时设置的口令解密；与现有库相同的供应商会自动跳过。'}
        </p>
        <label>
          {exporting ? '设置口令（至少 8 位）' : '解密口令'}
          <input
            type="password"
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            placeholder={exporting ? '用于加密这份备份' : '导出时设置的口令'}
            autoFocus
          />
        </label>
        {exporting && (
          <label>
            再输一遍口令
            <input type="password" value={pass2} onChange={(e) => setPass2(e.target.value)} placeholder='重复口令' />
          </label>
        )}
        {err && <div className="form-error">{err}</div>}
        <div className="form-actions">
          <button className="btn" onClick={onClose}>
            取消
          </button>
          <button className="btn primary" onClick={submit}>
            {exporting ? '选择保存位置' : '选择备份文件'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export default function SettingsPanel({
  store,
  onChanged,
  notify,
  onCheckUpdate,
  updateChecking
}: {
  store: StoreShape
  onChanged: () => Promise<void>
  notify: (text: string, kind?: 'ok' | 'err') => void
  onCheckUpdate: () => Promise<void>
  updateChecking: boolean
}) {
  const [backups, setBackups] = useState<Record<ToolId, BackupInfo[]>>({ claude: [], codex: [] })
  const [version, setVersion] = useState('')
  const [bakModal, setBakModal] = useState<'export' | 'import' | null>(null)
  const [bakBusy, setBakBusy] = useState(false)
  const [router, setRouter] = useState<RouterStatus | null>(null)

  useEffect(() => {
    window.api
      .routerStatus()
      .then(setRouter)
      .catch(() => {})
  }, [])

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

  const runBackup = async (mode: 'export' | 'import', pass: string) => {
    setBakBusy(true)
    try {
      if (mode === 'export') {
        const r = await window.api.backupExport(pass)
        if (r.canceled) return
        notify('已导出加密备份（口令未存储，请妥善保管文件与口令）')
      } else {
        const r = await window.api.backupImport(pass)
        if (r.canceled) return
        notify(`导入完成：新增 ${r.added} 条，跳过 ${r.skipped} 条（已存在或不合法）`)
        await onChanged()
      }
      setBakModal(null)
    } catch (e) {
      notify((e as Error).message, 'err')
    } finally {
      setBakBusy(false)
    }
  }

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
          <button className="btn sm" onClick={onCheckUpdate} disabled={updateChecking}>
            {updateChecking ? '检查中…' : '检查更新'}
          </button>
          <span className="muted">当前版本 v{version || '…'}</span>
        </div>
        <p className="muted small">
          发现新版本时页面顶部会出现下载横幅，下载完成后一键重启安装；网络不畅时会提供发布页链接手动下载。
        </p>
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

      <section className="card">
        <h3>本机路由</h3>
        <p className="muted small">
          在工具页用「本机路由」开关开启。开启后请求经 127.0.0.1 代理转发：切换供应商即时生效，上游故障时按列表顺序自动转移
          （最简版仅透传 Anthropic/OpenAI 兼容端点，协议转换留待后续版本）。
        </p>
        <p className="muted small">
          {router?.running
            ? `状态：运行中（127.0.0.1:${router.port}）｜Claude 转发 ${router.claude.requests} 次/失败 ${router.claude.errors} 次｜Codex 转发 ${router.codex.requests} 次/失败 ${router.codex.errors} 次`
            : '状态：未运行'}
          {router?.error ? `｜最近错误：${router.error}` : ''}
        </p>
      </section>

      <section className="card">
        <h3>备份与迁移</h3>
        <p className="muted small">
          把供应商库导出为 AES-256-GCM 加密文件，用于跨设备迁移或冷备份。文件用你设置的口令加密，
          Key 永远不会离开本机——需要迁移时手动把文件带到另一台电脑导入即可。
        </p>
        <div className="btn-row">
          <button className="btn sm" onClick={() => setBakModal('export')}>
            导出加密备份
          </button>
          <button className="btn sm" onClick={() => setBakModal('import')}>
            导入加密备份
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

      {bakModal && (
        <PassphraseModal
          mode={bakModal}
          onClose={() => (bakBusy ? undefined : setBakModal(null))}
          onConfirm={(pass) => void runBackup(bakModal, pass)}
        />
      )}
    </div>
  )
}
