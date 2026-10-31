import { loadStore, newId, saveStore } from './store'
import { switchProviderForTool } from './switcher'
import type { ProviderGroup, ToolId } from '../shared/types'

/**
 * 方案组（v0.8.9）：把「两个工具各用哪个供应商」保存为命名组合，一键整体切换。
 * 成员为 null 表示该工具恢复官方配置；应用时与当前状态一致的成员跳过（不多余写盘）。
 */

const NAME_MAX = 100

function assertGroupInput(input: { id?: string; name: string; members: { claude: string | null; codex: string | null } }): void {
  if (!input || typeof input !== 'object') throw new Error('非法的方案组内容')
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > NAME_MAX) {
    throw new Error(`名称须为 1-${NAME_MAX} 个字符`)
  }
  if (!input.members || typeof input.members !== 'object') throw new Error('非法的方案组成员')
  for (const tool of ['claude', 'codex'] as ToolId[]) {
    const v = input.members[tool]
    if (v !== null && v !== undefined && (typeof v !== 'string' || !v || v.length > 64)) {
      throw new Error(`非法的 ${tool} 成员 id`)
    }
  }
  if (input.id !== undefined && (typeof input.id !== 'string' || input.id.length > 64)) throw new Error('非法的 id')
}

/** 保存（无 id 新建 / 有 id 更新名称与成员）；成员 id 只验形状，不要求供应商存在（缺失项应用时跳过） */
export async function saveGroup(input: {
  id?: string
  name: string
  members: { claude: string | null; codex: string | null }
}): Promise<ProviderGroup> {
  assertGroupInput(input)
  const store = loadStore()
  const groups = store.groups ?? (store.groups = [])
  const members = {
    claude: input.members.claude ?? null,
    codex: input.members.codex ?? null
  }
  const now = Date.now()
  if (input.id) {
    const existing = groups.find((g) => g.id === input.id)
    if (!existing) throw new Error('方案组不存在')
    existing.name = input.name.trim()
    existing.members = members
    existing.updatedAt = now
    await saveStore(store)
    return existing
  }
  const created: ProviderGroup = { id: newId(), name: input.name.trim(), members, createdAt: now, updatedAt: now }
  groups.push(created)
  await saveStore(store)
  return created
}

export async function deleteGroup(id: string): Promise<boolean> {
  if (typeof id !== 'string' || !id || id.length > 64) throw new Error('非法的 id')
  const store = loadStore()
  const before = (store.groups ?? []).length
  store.groups = (store.groups ?? []).filter((g) => g.id !== id)
  if (store.groups.length === before) return false
  await saveStore(store)
  return true
}

export function listGroups(): ProviderGroup[] {
  return loadStore().groups ?? []
}

/**
 * 应用方案组：逐工具切换（与托盘/IPC 完全同一套切换逻辑）。
 * 成员指向已删除的供应商时跳过该工具并记入 skipped（不算错误）。
 * 返回实际切换了的工具与跳过原因。
 */
export async function applyGroup(id: string): Promise<{ switched: ToolId[]; skipped: string[] }> {
  if (typeof id !== 'string' || !id || id.length > 64) throw new Error('非法的 id')
  const store = loadStore()
  const g = (store.groups ?? []).find((x) => x.id === id)
  if (!g) throw new Error('方案组不存在')
  const switched: ToolId[] = []
  const skipped: string[] = []
  for (const tool of ['claude', 'codex'] as ToolId[]) {
    const memberId = g.members[tool]
    if ((memberId ?? null) === (store.current[tool] ?? null)) continue // 已是目标状态
    if (memberId === null) {
      await switchProviderForTool(tool, null)
      store.current[tool] = null
      switched.push(tool)
      continue
    }
    const provider = store.providers.find((p) => p.id === memberId && p.tool === tool)
    if (!provider) {
      skipped.push(`${tool === 'claude' ? 'Claude Code' : 'Codex'}：成员供应商已不存在`)
      continue
    }
    await switchProviderForTool(tool, provider)
    store.current[tool] = memberId
    switched.push(tool)
  }
  if (switched.length > 0) await saveStore(store)
  return { switched, skipped }
}
