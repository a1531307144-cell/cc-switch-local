import * as claude from './claude'
import * as codex from './codex'
import { routerEnabled, startRouter } from './router'
import type { Provider, SwitchResult, ToolId } from '../shared/types'

/**
 * 统一的切换出口（IPC 与托盘共用）：
 * OpenAI 协议的 Claude 供应商只能经本机路由使用（协议转换），切换时自动拉起路由进程。
 */
export async function switchProviderForTool(tool: ToolId, provider: Provider | null): Promise<SwitchResult> {
  const forceRouter = tool === 'claude' && provider?.protocol === 'openai'
  const viaRouter = routerEnabled(tool) || forceRouter
  if (viaRouter) {
    await startRouter().catch((e: unknown) => {
      throw new Error(`路由服务启动失败：${(e as Error).message}`)
    })
  }
  return tool === 'claude' ? claude.switchClaude(provider, viaRouter) : codex.switchCodex(provider, viaRouter)
}
