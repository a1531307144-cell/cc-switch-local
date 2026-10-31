import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite, loadStore, newId, saveStore } from './store'
import { backupFile, claudeDir } from './claude'
import { codexDir } from './codex'
import type { CurrentPromptFile, StoredPrompt, ToolId } from '../shared/types'

/**
 * 提示词库（v0.8.9）：管理并一键应用工具的全局提示词文件——
 * Claude Code → ~/.claude/CLAUDE.md；Codex → ~/.codex/AGENTS.md。
 * 应用前自动备份（沿用工具配置的 .bak-时间戳 链），原子写入。
 */

const PROMPT_FILES: Record<ToolId, string> = { claude: 'CLAUDE.md', codex: 'AGENTS.md' }
const NAME_MAX = 100
const CONTENT_MAX = 100_000

function promptDir(tool: ToolId): string {
  return tool === 'claude' ? claudeDir() : codexDir()
}

export function promptFilePath(tool: ToolId): string {
  return path.join(promptDir(tool), PROMPT_FILES[tool])
}

function assertPromptInput(input: { id?: string; tool: ToolId; name: string; content: string }): void {
  if (!input || typeof input !== 'object') throw new Error('非法的提示词内容')
  if (input.tool !== 'claude' && input.tool !== 'codex') throw new Error('非法的工具类型')
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > NAME_MAX) {
    throw new Error(`名称须为 1-${NAME_MAX} 个字符`)
  }
  if (typeof input.content !== 'string' || input.content.length > CONTENT_MAX) {
    throw new Error(`内容过长（上限 ${CONTENT_MAX} 字符）`)
  }
  if (input.id !== undefined && (typeof input.id !== 'string' || input.id.length > 64)) throw new Error('非法的 id')
}

export function listPrompts(): StoredPrompt[] {
  return loadStore().prompts ?? []
}

/** 当前两个工具的提示词文件状态（含「使用中」比对所需的原文） */
export async function currentPromptFiles(): Promise<{ claude: CurrentPromptFile; codex: CurrentPromptFile }> {
  const read = async (tool: ToolId): Promise<CurrentPromptFile> => {
    const p = promptFilePath(tool)
    try {
      const st = await fsp.stat(p)
      const content = await fsp.readFile(p, 'utf8')
      return { path: p, exists: true, content, mtime: st.mtimeMs }
    } catch {
      return { path: p, exists: false, content: '', mtime: 0 }
    }
  }
  return { claude: await read('claude'), codex: await read('codex') }
}

export async function savePrompt(input: { id?: string; tool: ToolId; name: string; content: string }): Promise<StoredPrompt> {
  assertPromptInput(input)
  const store = loadStore()
  const prompts = store.prompts ?? (store.prompts = [])
  const now = Date.now()
  if (input.id) {
    const existing = prompts.find((p) => p.id === input.id)
    if (!existing) throw new Error('提示词不存在')
    existing.name = input.name.trim()
    existing.content = input.content
    existing.tool = input.tool
    existing.updatedAt = now
    await saveStore(store)
    return existing
  }
  const created: StoredPrompt = {
    id: newId(),
    tool: input.tool,
    name: input.name.trim(),
    content: input.content,
    createdAt: now,
    updatedAt: now
  }
  prompts.push(created)
  await saveStore(store)
  return created
}

export async function deletePrompt(id: string): Promise<boolean> {
  if (typeof id !== 'string' || !id || id.length > 64) throw new Error('非法的 id')
  const store = loadStore()
  const before = (store.prompts ?? []).length
  store.prompts = (store.prompts ?? []).filter((p) => p.id !== id)
  if (store.prompts.length === before) return false
  await saveStore(store)
  return true
}

/** 应用到工具的全局提示词文件：先备份旧文件，再原子写入 */
export async function applyPrompt(id: string): Promise<{ claude?: boolean; codex?: boolean }> {
  if (typeof id !== 'string' || !id || id.length > 64) throw new Error('非法的 id')
  const store = loadStore()
  const p = (store.prompts ?? []).find((x) => x.id === id)
  if (!p) throw new Error('提示词不存在')
  const dir = promptDir(p.tool)
  await fsp.mkdir(dir, { recursive: true })
  await backupFile(dir, PROMPT_FILES[p.tool])
  await atomicWrite(promptFilePath(p.tool), p.content.endsWith('\n') ? p.content : p.content + '\n')
  return { [p.tool]: true } as { claude?: boolean; codex?: boolean }
}

/** 把工具当前的全局提示词文件导入为库条目（文件不存在则报错） */
export async function importCurrentPrompt(tool: ToolId): Promise<StoredPrompt> {
  if (tool !== 'claude' && tool !== 'codex') throw new Error('非法的工具类型')
  const p = promptFilePath(tool)
  let content: string
  try {
    content = await fsp.readFile(p, 'utf8')
  } catch {
    throw new Error(`当前没有可导入的 ${PROMPT_FILES[tool]}（${p} 不存在）`)
  }
  return savePrompt({ tool, name: `导入的 ${PROMPT_FILES[tool]}（${new Date().toLocaleString()}）`, content })
}

/** 诊断用：文件是否存在（自测断言用） */
export function promptFileExists(tool: ToolId): boolean {
  return fs.existsSync(promptFilePath(tool))
}
