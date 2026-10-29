import crypto from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { dialog, app } from 'electron'
import { loadStore, newId, saveStore } from './store'
import type { AppSettings, KeyType, Provider, ToolId } from '../shared/types'

/**
 * 加密备份（云同步的替代方案）：把供应商库导出为 AES-256-GCM 加密文件。
 * 口令只在用户内存里，Key 永不出机；跨设备迁移靠手动拷贝该文件。
 *
 * 文件格式：CCSLBAK1 | salt(16) | iv(12) | gcm-tag(16) | ciphertext(JSON)
 */

const MAGIC = Buffer.from('CCSLBAK1', 'ascii')

export interface BackupPayload {
  kind: 'ccsl-backup'
  version: 1
  exportedAt: number
  providers: Provider[]
  settings: AppSettings
}

interface BackupResult {
  added: number
  skipped: number
}

function assertPassphrase(pass: string): void {
  if (typeof pass !== 'string' || pass.length < 8 || pass.length > 200) {
    throw new Error('口令须为 8-200 个字符')
  }
}

function deriveKey(pass: string, salt: Buffer): Buffer {
  return crypto.scryptSync(pass, salt, 32, { N: 16384, r: 8, p: 1 })
}

export function encryptBackup(payload: BackupPayload, passphrase: string): Buffer {
  assertPassphrase(passphrase)
  const salt = crypto.randomBytes(16)
  const iv = crypto.randomBytes(12)
  const key = deriveKey(passphrase, salt)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), enc])
}

export function decryptBackup(buf: Buffer, passphrase: string): BackupPayload {
  const head = MAGIC.length + 16 + 12 + 16
  if (buf.length < head || !buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('不是本应用导出的备份文件')
  }
  assertPassphrase(passphrase)
  const salt = buf.subarray(MAGIC.length, MAGIC.length + 16)
  const iv = buf.subarray(MAGIC.length + 16, MAGIC.length + 28)
  const tag = buf.subarray(MAGIC.length + 28, head)
  const key = deriveKey(passphrase, salt)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  let text: string
  try {
    text = Buffer.concat([decipher.update(buf.subarray(head)), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('解密失败：口令错误或文件已损坏')
  }
  const payload = JSON.parse(text) as BackupPayload
  if (payload?.kind !== 'ccsl-backup' || payload?.version !== 1 || !Array.isArray(payload.providers)) {
    throw new Error('备份文件内容不合法')
  }
  return payload
}

const TOOL_IDS: ToolId[] = ['claude', 'codex']
const KEY_TYPES: KeyType[] = ['auth_token', 'api_key']

/** 主进程侧逐条校验，防止备份文件被篡改后注入非法数据 */
function sanitizeProvider(raw: unknown, idx: number): Provider | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const tool = p.tool
  const name = p.name
  const baseUrl = p.baseUrl
  const apiKey = p.apiKey
  if (typeof tool !== 'string' || !TOOL_IDS.includes(tool as ToolId)) return null
  if (typeof name !== 'string' || !name.trim() || name.length > 200) return null
  if (typeof baseUrl !== 'string' || !/^https?:\/\//i.test(baseUrl) || baseUrl.length > 2000) return null
  if (typeof apiKey !== 'string' || !apiKey || apiKey.length > 4000) return null
  const keyType = p.keyType === 'api_key' ? 'api_key' : 'auth_token'
  if (p.keyType !== undefined && !KEY_TYPES.includes(p.keyType as KeyType)) return null
  const model = typeof p.model === 'string' && p.model.length <= 200 ? p.model : undefined
  const wireApi = p.wireApi === 'chat' ? 'chat' : p.wireApi === 'responses' ? 'responses' : undefined
  const notes = typeof p.notes === 'string' && p.notes.length <= 2000 ? p.notes : undefined
  void idx
  return {
    id: newId(),
    tool: tool as ToolId,
    name: name.trim(),
    baseUrl,
    apiKey,
    keyType,
    model,
    wireApi,
    notes,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
}

function defaultBackupPath(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const name = `ccsl-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.ccslbak`
  try {
    return path.join(app.getPath('documents'), name)
  } catch {
    return path.join(app.getPath('home'), name)
  }
}

/** 打开保存对话框并导出（渲染层只传口令，路径由主进程对话框决定） */
export async function backupExport(passphrase: string): Promise<{ savedTo?: string; canceled?: boolean }> {
  assertPassphrase(passphrase)
  const r = await dialog.showSaveDialog({
    title: '导出加密备份',
    defaultPath: defaultBackupPath(),
    filters: [{ name: 'CC Switch Local 加密备份', extensions: ['ccslbak'] }],
    properties: ['showOverwriteConfirmation']
  })
  if (r.canceled || !r.filePath) return { canceled: true }
  const store = loadStore()
  const payload: BackupPayload = {
    kind: 'ccsl-backup',
    version: 1,
    exportedAt: Date.now(),
    providers: store.providers,
    settings: store.settings
  }
  await fsp.writeFile(r.filePath, encryptBackup(payload, passphrase))
  return { savedTo: r.filePath }
}

/** 打开选择对话框并导入；按 tool|baseUrl|apiKey 去重后合并入库 */
export async function backupImport(passphrase: string): Promise<BackupResult & { canceled?: boolean }> {
  const r = await dialog.showOpenDialog({
    title: '导入加密备份',
    filters: [{ name: 'CC Switch Local 加密备份', extensions: ['ccslbak'] }],
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths[0]) return { added: 0, skipped: 0, canceled: true }
  return importBackupFromFile(r.filePaths[0], passphrase)
}

/** 核心导入逻辑（自测直接调用，不走对话框） */
export async function importBackupFromFile(file: string, passphrase: string): Promise<BackupResult> {
  assertPassphrase(passphrase)
  if (!fs.existsSync(file)) throw new Error('备份文件不存在')
  const buf = await fsp.readFile(file)
  const payload = decryptBackup(buf, passphrase)
  if (payload.providers.length > 500) throw new Error('备份包含的供应商数量超出限制（>500）')

  const store = loadStore()
  const existing = new Set(store.providers.map((p) => `${p.tool}|${p.baseUrl}|${p.apiKey}`))
  let added = 0
  let skipped = 0
  for (let i = 0; i < payload.providers.length; i++) {
    const clean = sanitizeProvider(payload.providers[i], i)
    if (!clean) {
      skipped++
      continue
    }
    const key = `${clean.tool}|${clean.baseUrl}|${clean.apiKey}`
    if (existing.has(key)) {
      skipped++
      continue
    }
    existing.add(key)
    store.providers.push(clean)
    added++
  }
  if (added > 0) await saveStore(store)
  return { added, skipped }
}

/** 核心导出逻辑（自测直接调用，不走对话框） */
export async function exportBackupToFile(file: string, passphrase: string): Promise<void> {
  const store = loadStore()
  const payload: BackupPayload = {
    kind: 'ccsl-backup',
    version: 1,
    exportedAt: Date.now(),
    providers: store.providers,
    settings: store.settings
  }
  await fsp.writeFile(file, encryptBackup(payload, passphrase))
}
