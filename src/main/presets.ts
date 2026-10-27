import type { Preset } from '../shared/types'

/**
 * 内置预设仅收录官方公开文档明确给出 Anthropic 兼容端点的服务商，仅供参考，
 * 以各服务商官方文档为准；不在列表里的服务商走「自定义」。
 */
export const PRESETS: Preset[] = [
  {
    tool: 'claude',
    name: 'Anthropic 官方（API 计费）',
    baseUrl: 'https://api.anthropic.com',
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
