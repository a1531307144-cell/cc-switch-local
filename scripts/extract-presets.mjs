/**
 * 从 farion1231/cc-switch（MIT License）的预设数据中提取端点配置，
 * 生成本项目的 src/main/presets-data.ts。
 *
 * 用法：node scripts/extract-presets.mjs <claudePresets.ts> <codexPresets.ts>
 * 仅收录公开端点 URL（本就是公开信息），不包含任何密钥。
 * 上游数据会持续更新，需要刷新预设时重跑本脚本即可。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { transformSync } from 'esbuild'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const TOML = require('@iarna/toml')

const [claudeFile, codexFile] = process.argv.slice(2)
if (!claudeFile || !codexFile) {
  console.error('用法：node scripts/extract-presets.mjs <claudePresets.ts> <codexPresets.ts>')
  process.exit(1)
}

/** 去掉 import 语句（含跨多行）后用 esbuild 转 CJS，再 require 拿到数组 */
function loadPresets(file, exportName) {
  const raw = readFileSync(file, 'utf8')
  const lines = []
  let inImport = false
  for (const line of raw.split('\n')) {
    if (inImport) {
      if (/\bfrom\s*["']/.test(line)) inImport = false
      continue
    }
    if (/^\s*import\b/.test(line)) {
      if (!/\bfrom\s*["']/.test(line)) inImport = true
      continue
    }
    lines.push(line)
  }
  const js = transformSync(lines.join('\n'), { loader: 'ts', format: 'cjs', target: 'node20' }).code
  const mod = { exports: {} }
  new Function('module', 'exports', js)(mod, mod.exports)
  const arr = mod.exports[exportName]
  if (!Array.isArray(arr)) throw new Error(`${file} 中未找到导出 ${exportName}`)
  return arr
}

const okUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u) && !u.includes('{{')

/** 名字去重后缀：同一 baseUrl 多家套餐只保留首个 */
const seen = new Set()
function push(list, p) {
  const key = `${p.tool}|${p.baseUrl.replace(/\/+$/, '')}`
  if (seen.has(key)) return
  seen.add(key)
  list.push(p)
}

// ---------- Claude ----------
const claudeRaw = loadPresets(claudeFile, 'providerPresets')
const claudeOut = []
let claudeSkipped = 0
for (const p of claudeRaw) {
  if (p.hidden || p.requiresOAuth) {
    claudeSkipped++
    continue
  }
  const env = p.settingsConfig?.env ?? {}
  let baseUrl = env.ANTHROPIC_BASE_URL
  if (!okUrl(baseUrl) && Array.isArray(p.endpointCandidates)) baseUrl = p.endpointCandidates.find(okUrl)
  if (!okUrl(baseUrl)) {
    claudeSkipped++
    continue
  }
  const keyType = env.ANTHROPIC_API_KEY !== undefined ? 'api_key' : 'auth_token'
  push(claudeOut, {
    tool: 'claude',
    name: String(p.name),
    baseUrl,
    keyType,
    website: typeof p.websiteUrl === 'string' ? p.websiteUrl : undefined
  })
}

// ---------- Codex（config 是 TOML 字符串）----------
const codexRaw = loadPresets(codexFile, 'codexProviderPresets')
const codexOut = []
let codexSkipped = 0
for (const p of codexRaw) {
  if (p.hidden || p.requiresOAuth) {
    codexSkipped++
    continue
  }
  let baseUrl
  let model
  let wireApi
  try {
    const cfg = TOML.parse(String(p.config ?? ''))
    model = typeof cfg.model === 'string' ? cfg.model : undefined
    const mps = cfg.model_providers ?? {}
    for (const k of Object.keys(mps)) {
      const sec = mps[k]
      if (sec && typeof sec.base_url === 'string') {
        baseUrl = sec.base_url
        wireApi = typeof sec.wire_api === 'string' ? sec.wire_api : undefined
        break
      }
    }
  } catch {
    codexSkipped++
    continue
  }
  if (!okUrl(baseUrl)) {
    codexSkipped++
    continue
  }
  push(codexOut, {
    tool: 'codex',
    name: String(p.name),
    baseUrl,
    model,
    wireApi: wireApi === 'chat' ? 'chat' : 'responses',
    website: typeof p.websiteUrl === 'string' ? p.websiteUrl : undefined
  })
}

// ---------- 生成 ----------
const fmt = (list) =>
  list
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => {
      const domain = (() => {
        try {
          return new URL(p.baseUrl).hostname
        } catch {
          return ''
        }
      })()
      const props = [`tool: '${p.tool}'`, `name: ${JSON.stringify(p.name)}`, `baseUrl: ${JSON.stringify(p.baseUrl)}`]
      if (p.keyType) props.push(`keyType: '${p.keyType}'`)
      if (p.wireApi) props.push(`wireApi: '${p.wireApi}'`)
      if (p.model) props.push(`model: ${JSON.stringify(p.model)}`)
      props.push(`searchKey: ${JSON.stringify(`${p.name} ${domain}`.toLowerCase())}`)
      return `  { ${props.join(', ')} }`
    })
    .join(',\n')

const header = `// 本文件由 scripts/extract-presets.mjs 自动生成，请勿手改。
// 数据改编自 farion1231/cc-switch（MIT License，https://github.com/farion1231/cc-switch），
// 仅收录公开端点配置；端点与模型以各服务商官方文档为准。
import type { Preset } from '../shared/types'

export const GENERATED_PRESETS: Preset[] = [
`

const tail = `
]
`

writeFileSync(
  new URL('../src/main/presets-data.ts', import.meta.url),
  header + fmt([...claudeOut, ...codexOut]) + tail
)

console.log(
  `claude: ${claudeOut.length} 条（跳过 ${claudeSkipped}），codex: ${codexOut.length} 条（跳过 ${codexSkipped}），共 ${claudeOut.length + codexOut.length} 条`
)
