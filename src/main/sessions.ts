import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { homeDir } from './claude'
import type { SessionEntry, SessionInfo, SessionPage, ToolId } from '../shared/types'

/**
 * 会话阅读器（v0.8.5）：把 Claude Code / Codex 的本地会话日志解析成只读阅读页。
 * 所有解析容错，坏行跳过；**file 参数必须是会话根目录内的 .jsonl**（防路径穿越）。
 * 超长会话只保留前 MAX_ENTRIES 条（阅读用途足够，解析完整数据仍看用量统计）。
 */

const MAX_LIST = 60
const MAX_ENTRIES = 400
const MAX_TEXT = 20_000

function rootOf(tool: ToolId): string {
  return tool === 'claude' ? path.join(homeDir(), '.claude', 'projects') : path.join(homeDir(), '.codex', 'sessions')
}

function assertInsideRoot(tool: ToolId, file: string): void {
  const root = path.resolve(rootOf(tool))
  const resolved = path.resolve(file)
  if (!resolved.startsWith(root + path.sep) || !resolved.endsWith('.jsonl')) {
    throw new Error('非法的会话文件路径')
  }
}

export async function listSessions(tool: ToolId): Promise<SessionInfo[]> {
  const root = rootOf(tool)
  const out: SessionInfo[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 5 || out.length >= MAX_LIST * 3) return
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) await walk(full, depth + 1)
      else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try {
          const st = await fsp.stat(full)
          out.push({
            tool,
            file: full,
            project: path.relative(root, path.dirname(full)) || '(root)',
            id: e.name.replace(/\.jsonl$/, ''),
            mtime: st.mtimeMs,
            size: st.size
          })
        } catch {
          /* 略过 stat 失败的文件 */
        }
      }
    }
  }
  await walk(root, 0)
  return out.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_LIST)
}

function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return (content as { type?: unknown; text?: unknown }[])
    .filter((b) => (b.type === 'text' || b.type === 'tool_result') && typeof b.text === 'string')
    .map((b) => String(b.text))
    .join('\n')
    .slice(0, MAX_TEXT)
}

function clip(s: string): string {
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + '…' : s
}

/** Claude Code 会话：assistant 行（文本/工具调用）+ user 行（文本/工具结果） */
async function readClaudeSession(file: string): Promise<SessionPage> {
  const entries: SessionEntry[] = []
  let truncated = false
  let raw = ''
  try {
    raw = await fsp.readFile(file, 'utf8')
  } catch (e) {
    throw new Error(`读取会话失败：${(e as Error).message}`)
  }
  for (const line of raw.split('\n')) {
    if (entries.length >= MAX_ENTRIES) {
      truncated = true
      break
    }
    if (!line || line.length > 2_000_000) continue
    let j: {
      type?: unknown
      timestamp?: unknown
      message?: { role?: unknown; content?: unknown; model?: unknown }
    }
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    const ts = Date.parse(typeof j.timestamp === 'string' ? j.timestamp : '') || 0
    if (j.type === 'summary') continue
    const msg = j.message
    if (!msg || typeof msg !== 'object') continue
    const content = msg.content
    if (msg.role === 'user' || j.type === 'user') {
      const blocks = Array.isArray(content) ? content : []
      for (const b of blocks as { type?: unknown; text?: unknown; content?: unknown }[]) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          entries.push({ role: 'user', text: clip(b.text), ts })
        } else if (b.type === 'tool_result') {
          const inner = textOfContent(b.content)
          if (inner) entries.push({ role: 'tool', toolName: '工具结果', text: clip(inner), ts })
        }
      }
      if (typeof content === 'string' && content.trim()) entries.push({ role: 'user', text: clip(content), ts })
    } else if (msg.role === 'assistant' || j.type === 'assistant') {
      for (const b of (Array.isArray(content) ? content : []) as { type?: unknown; text?: unknown; name?: unknown; input?: unknown }[]) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          entries.push({ role: 'assistant', text: clip(b.text), ts })
        } else if (b.type === 'tool_use' && typeof b.name === 'string') {
          let brief = ''
          try {
            brief = JSON.stringify(b.input ?? {})
          } catch {
            brief = ''
          }
          entries.push({ role: 'tool', toolName: b.name, text: clip(brief.slice(0, 500)), ts })
        }
      }
    }
  }
  return { entries, truncated }
}

/** Codex 会话（MVP）：event_msg 的 user_message / agent_message 文本 */
async function readCodexSession(file: string): Promise<SessionPage> {
  const entries: SessionEntry[] = []
  let truncated = false
  let raw = ''
  try {
    raw = await fsp.readFile(file, 'utf8')
  } catch (e) {
    throw new Error(`读取会话失败：${(e as Error).message}`)
  }
  for (const line of raw.split('\n')) {
    if (entries.length >= MAX_ENTRIES) {
      truncated = true
      break
    }
    if (!line || line.length > 2_000_000) continue
    let j: { timestamp?: unknown; type?: unknown; payload?: { type?: unknown; message?: unknown } }
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    if (j.type !== 'event_msg' || !j.payload || typeof j.payload !== 'object') continue
    const ts = Date.parse(typeof j.timestamp === 'string' ? j.timestamp : '') || 0
    const p = j.payload as { type?: unknown; message?: unknown }
    if (p.type === 'user_message' && typeof p.message === 'string' && p.message.trim()) {
      entries.push({ role: 'user', text: clip(p.message), ts })
    } else if (p.type === 'agent_message' && typeof p.message === 'string' && p.message.trim()) {
      entries.push({ role: 'assistant', text: clip(p.message), ts })
    }
  }
  return { entries, truncated }
}

export async function readSession(tool: ToolId, file: string): Promise<SessionPage> {
  assertInsideRoot(tool, file)
  return tool === 'claude' ? readClaudeSession(file) : readCodexSession(file)
}
