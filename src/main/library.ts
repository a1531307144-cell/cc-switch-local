import { loadStore, newId, saveStore } from './store'
import type { AppSettings, Provider, ToolId } from '../shared/types'

/**
 * 供应商库的业务操作（克隆/排序）与设置校验。IPC 层与自测共用：
 * 自测直接调用这里的函数，绕过 IPC 但覆盖同一份逻辑。
 */

const THEMES = ['system', 'light', 'dark']

/** settings:update 的入参校验：全字段类型/枚举检查，未知键拒绝（2026-10-31 审计 P2） */
export function validateSettingsPatch(patch: Partial<AppSettings>): void {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('非法的设置内容')
  for (const k of Object.keys(patch)) {
    if (!['autoUpdate', 'autoStart', 'theme', 'language', 'sidebarCollapsed', 'router'].includes(k)) {
      throw new Error(`非法的设置项：${k}`)
    }
  }
  if (patch.autoUpdate !== undefined && typeof patch.autoUpdate !== 'boolean') throw new Error('非法的自动更新开关')
  if (patch.autoStart !== undefined && typeof patch.autoStart !== 'boolean') throw new Error('非法的自启开关')
  if (patch.sidebarCollapsed !== undefined && typeof patch.sidebarCollapsed !== 'boolean') throw new Error('非法的侧栏折叠状态')
  if (patch.theme !== undefined && !THEMES.includes(patch.theme)) throw new Error('非法的主题')
  if (patch.language !== undefined && patch.language !== 'zh' && patch.language !== 'en') throw new Error('非法的语言')
  if (patch.router !== undefined) {
    const r = patch.router as { claude?: unknown; codex?: unknown; port?: unknown; aggregate?: unknown }
    if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('非法的路由设置')
    if (typeof r.claude !== 'boolean' || typeof r.codex !== 'boolean') throw new Error('非法的路由开关')
    if (r.aggregate !== undefined && typeof r.aggregate !== 'boolean') throw new Error('非法的聚合开关')
    if (
      r.port !== undefined &&
      (typeof r.port !== 'number' || !Number.isInteger(r.port) || r.port <= 0 || r.port > 65535)
    ) {
      throw new Error('非法的路由端口')
    }
  }
}

/** 克隆供应商：复制全部字段，新 id，名称加「副本」后缀，插在原条目之后 */
export async function cloneProvider(id: string): Promise<Provider> {
  if (typeof id !== 'string' || !id || id.length > 64) throw new Error('非法的 id')
  const store = loadStore()
  const idx = store.providers.findIndex((p) => p.id === id)
  if (idx < 0) throw new Error('供应商不存在')
  const src = store.providers[idx]
  const now = Date.now()
  const copy: Provider = { ...src, id: newId(), name: `${src.name} 副本`, createdAt: now, updatedAt: now }
  store.providers.splice(idx + 1, 0, copy)
  await saveStore(store)
  return copy
}

/**
 * 重排某工具的供应商顺序（拖拽排序）。orderedIds 必须恰好等于该工具全部供应商的 id
 * （无重复、无遗漏）；其它工具的条目保持原相对位置。
 */
export async function reorderProviders(tool: ToolId, orderedIds: string[]): Promise<void> {
  if (!(tool === 'claude' || tool === 'codex')) throw new Error('非法的工具类型')
  if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== 'string' || x.length > 64)) {
    throw new Error('非法的排序参数')
  }
  const store = loadStore()
  const mine = store.providers.filter((p) => p.tool === tool)
  if (
    orderedIds.length !== mine.length ||
    new Set(orderedIds).size !== orderedIds.length ||
    new Set(mine.map((p) => p.id)).size !== mine.length ||
    orderedIds.some((id) => !mine.some((p) => p.id === id))
  ) {
    throw new Error('排序参数与供应商列表不一致')
  }
  const byId = new Map(mine.map((p) => [p.id, p]))
  const next = orderedIds.map((id) => byId.get(id)!)
  let k = 0
  store.providers = store.providers.map((p) => (p.tool === tool ? next[k++] : p))
  await saveStore(store)
}
