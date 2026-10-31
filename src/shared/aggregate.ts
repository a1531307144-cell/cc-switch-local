import type { Provider } from './types'

/**
 * 聚合模式的别名规则（主进程路由分发与渲染层提示共用）：
 * 显式 alias 优先（不区分大小写）；否则由名称自动推导（小写化，仅保留 [a-z0-9_-]），
 * 推导结果为空（如纯中文名）则该供应商不可用前缀寻址，只能作为兜底链的一员。
 */

export function aggregateAliasOf(p: Provider): string | null {
  const explicit = typeof p.alias === 'string' ? p.alias.trim().toLowerCase() : ''
  if (explicit) return explicit
  const derived = p.name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return derived || null
}

/** 请求模型名「别名/模型」→ 命中的供应商与剥离前缀后的模型名；未命中返回 null */
export function resolveAggregatePrefix(
  providers: Provider[],
  model: string
): { provider: Provider; model: string } | null {
  const slash = model.indexOf('/')
  if (slash <= 0) return null
  const prefix = model.slice(0, slash).trim().toLowerCase()
  if (!prefix) return null
  const rest = model.slice(slash + 1).trim()
  if (!rest) return null
  const hit = providers.find((p) => aggregateAliasOf(p) === prefix)
  return hit ? { provider: hit, model: rest } : null
}

/** 列出可前缀寻址的供应商（tooltip 展示用）：[{ alias, model }] */
export function aggregateEntries(providers: Provider[]): { alias: string; model: string; protocol: string }[] {
  return providers
    .map((p) => ({ p, alias: aggregateAliasOf(p) }))
    .filter((x): x is { p: Provider; alias: string } => !!x.alias)
    .map(({ p, alias }) => ({ alias, model: p.model ?? '', protocol: p.protocol ?? 'anthropic' }))
}
