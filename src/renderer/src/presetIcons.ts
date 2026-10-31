/**
 * 预设图标解析（v0.8.14）：图标来自 farion1231/cc-switch（MIT）的图标库，
 * 构建时打包进应用（见 scripts/fetch-preset-icons.mjs），运行时不联网。
 * 多数文件名 = <slug>.<ext>；少数上游文件名特殊（a6api → a6-icon.png 等），用 ALIAS 映射。
 * 注意：vite glob 的键前缀不保证一致（小文件还会内联成 data URI），所以按 basename 匹配。
 */
const files = import.meta.glob('./assets/vendors/*.{svg,png,jpg}', {
  eager: true,
  query: '?url',
  import: 'default'
}) as Record<string, string>

const ALIAS: Record<string, string> = {
  a6api: 'a6-icon.png',
  apinebula: 'apinebula_icon.png',
  atlascloud: 'atlascloud_icon.png',
  claudeapi: 'ClaudeApi.png',
  fenno: 'fenno-icon.png',
  grooroute: 'grooroute.jpg',
  ikuncode: 'ikuncode.jpg',
  modelflare: 'modelflare.jpg',
  nekocode: 'nekocode-icon.png',
  openmodel: 'openmodel.jpg',
  pateway: 'pateway.jpg',
  runapi: 'runapi.jpg',
  runtoken: 'runtoken.jpg',
  soruxgpt: 'soruxgpt.jpg',
  teamorouter: 'TeamoRouter-icon-dark.png',
  tokenflux: 'tokenflux.jpg',
  xycai: 'xycai-icon.png'
}

const basenameOf = (k: string): string => k.split('/')[k.split('/').length - 1] ?? ''

function fileUrl(name: string): string | undefined {
  for (const [k, url] of Object.entries(files)) {
    if (basenameOf(k).toLowerCase() === name.toLowerCase()) return url
  }
  return undefined
}

/** 按 slug 找图标 URL；找不到返回 undefined（调用方走字母徽章兜底） */
export function presetIconUrl(slug: string | undefined): string | undefined {
  if (!slug) return undefined
  const s = slug.toLowerCase()
  for (const ext of ['svg', 'png', 'jpg']) {
    const url = fileUrl(`${s}.${ext}`)
    if (url) return url
  }
  const alias = ALIAS[s]
  if (alias) return fileUrl(alias)
  return undefined
}
