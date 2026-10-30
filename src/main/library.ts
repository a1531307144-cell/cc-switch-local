import { loadStore, newId, saveStore } from './store'
import type { Provider, ToolId } from '../shared/types'

/**
 * 供应商库的业务操作（克隆/排序）。IPC 层与自测共用：
 * 自测直接调用这里的函数，绕过 IPC 但覆盖同一份逻辑。
 */

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
