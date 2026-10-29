import type { Preset } from '../shared/types'
import { GENERATED_PRESETS } from './presets-data'

/** 精选预设（官方与常用国内厂商，中文名优先展示） */
const CURATED_PRESETS: Preset[] = [
  {
    tool: 'claude',
    name: 'Anthropic 官方（API 计费）',
    baseUrl: 'https://api.anthropic.com',
    keyType: 'api_key',
    notes: '官方 API；Key 类型选 api_key。订阅登录用户无需配置此项'
  },
  {
    tool: 'claude',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    notes: 'Anthropic 兼容端点，见 DeepSeek 官方文档'
  },
  {
    tool: 'claude',
    name: 'Moonshot Kimi',
    baseUrl: 'https://api.moonshot.cn/anthropic',
    model: 'kimi-k2-turbo-preview',
    notes: 'Anthropic 兼容端点，见 Moonshot 官方文档'
  },
  {
    tool: 'claude',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/anthropic',
    model: 'glm-4.6',
    notes: 'Anthropic 兼容端点，见智谱官方文档'
  },
  {
    tool: 'claude',
    name: '阿里云百炼 Qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/api/v2/apps/claude-code/proxy',
    model: 'qwen3-coder-plus',
    notes: 'Claude Code 专用代理端点，见阿里云官方文档'
  },
  {
    tool: 'codex',
    name: 'OpenAI 官方',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-5-codex',
    notes: '官方 API；如用 ChatGPT 订阅登录，请用「恢复官方配置」'
  }
]

function withSearchKey(p: Preset): Preset {
  if (p.searchKey) return p
  const domain = (() => {
    try {
      return new URL(p.baseUrl).hostname
    } catch {
      return ''
    }
  })()
  return { ...p, searchKey: `${p.name} ${domain}`.toLowerCase() }
}

const seen = new Set<string>()
/** 精选在前（同端点不重复收录生成数据） */
export const PRESETS: Preset[] = [...CURATED_PRESETS, ...GENERATED_PRESETS].flatMap((p) => {
  const fixed = withSearchKey(p)
  const key = `${p.tool}|${p.baseUrl.replace(/\/+$/, '').toLowerCase()}`
  if (seen.has(key)) return []
  seen.add(key)
  return [fixed]
})
