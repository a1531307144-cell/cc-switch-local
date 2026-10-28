/**
 * 厂商识别：按 baseUrl 主机名匹配已知厂商，返回图标/名称/颜色供界面可视化展示。
 * 图标为构建时内置（scripts/copy-vendor-icons.mjs 从 simple-icons 拷贝），
 * **绝不**在运行时向第三方服务请求图标——那会把用户端点地址泄露出去。
 */

export interface VendorInfo {
  id: string
  name: string
  /** 无内置图标时用首字符彩色徽章兜底 */
  letter: string
  /** 徽章/字母底色 */
  color: string
  /** 内置图标文件名（renderer 通过 assets/vendors/<id>.svg 解析）；缺省 = 字母徽章 */
  icon?: string
}

const RULES: { match: string; vendor: VendorInfo }[] = [
  {
    match: 'api.deepseek.com',
    vendor: { id: 'deepseek', name: 'DeepSeek', letter: 'D', color: '#5786FE', icon: 'deepseek' }
  },
  {
    match: 'api.anthropic.com',
    vendor: { id: 'anthropic', name: 'Anthropic', letter: 'A', color: '#D97757', icon: 'anthropic' }
  },
  {
    match: 'api.moonshot.cn',
    vendor: { id: 'moonshot', name: 'Moonshot Kimi', letter: 'K', color: '#6B7280', icon: 'moonshotai' }
  },
  {
    match: 'api.moonshot.ai',
    vendor: { id: 'moonshot', name: 'Moonshot Kimi', letter: 'K', color: '#6B7280', icon: 'moonshotai' }
  },
  {
    match: 'dashscope.aliyuncs.com',
    vendor: { id: 'qwen', name: '阿里云百炼 Qwen', letter: '百', color: '#6950EF', icon: 'qwen' }
  },
  {
    match: 'openrouter.ai',
    vendor: { id: 'openrouter', name: 'OpenRouter', letter: 'R', color: '#94A3B8', icon: 'openrouter' }
  },
  {
    match: 'api.openai.com',
    vendor: { id: 'openai', name: 'OpenAI', letter: 'O', color: '#10A37F' }
  },
  {
    match: 'open.bigmodel.cn',
    vendor: { id: 'glm', name: '智谱 GLM', letter: 'G', color: '#3859FF' }
  }
]

function isLocalHost(host: string): boolean {
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host === '[::1]'
  )
}

/** 识别厂商；识别不出返回 null（界面不显示厂商徽标） */
export function detectVendor(baseUrl: string): VendorInfo | null {
  let host: string
  let port: string
  try {
    const u = new URL(baseUrl)
    host = u.hostname.toLowerCase()
    port = u.port
  } catch {
    return null
  }

  if (isLocalHost(host)) {
    // 11434 是 Ollama 默认端口
    return port === '11434'
      ? { id: 'ollama', name: 'Ollama（本地）', letter: 'O', color: '#94A3B8', icon: 'ollama' }
      : { id: 'local', name: '本地服务', letter: '本', color: '#94A3B8' }
  }

  // 严格后缀匹配，避免 "api.deepseek.com.evil.com" 这类仿冒主机误识别
  const hit = RULES.find((r) => host === r.match || host.endsWith('.' + r.match))
  return hit ? hit.vendor : null
}
