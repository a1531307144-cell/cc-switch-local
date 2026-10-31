import * as claude from './claude'
import * as codex from './codex'
import type { McpListResult, McpServerSpec, ToolId } from '../shared/types'

/**
 * MCP 服务器管理（v0.8.5）编排层：Claude 写 ~/.claude.json 顶层 mcpServers（手术式只改这一个键），
 * Codex 写 config.toml 的 [mcp_servers.NAME] 段。所有入参在主进程校验；写入前自动备份。
 */

const NAME_RE = /^[A-Za-z0-9_-]{1,64}$/
const ENV_KEY_RE = /^[A-Za-z0-9_]{1,128}$/

function assertTool(tool: ToolId): void {
  if (!(tool === 'claude' || tool === 'codex')) throw new Error('非法的工具类型')
}

/** 主进程侧校验（防注入段头/路径/超长值） */
function assertSpec(spec: McpServerSpec): void {
  if (!spec || typeof spec !== 'object') throw new Error('非法的 MCP 配置')
  if (typeof spec.name !== 'string' || !NAME_RE.test(spec.name)) {
    throw new Error('服务器名称仅允许字母/数字/下划线/中划线（1-64 字符）')
  }
  if (typeof spec.command !== 'string' || !spec.command.trim() || spec.command.length > 2000) {
    throw new Error('command 必须为 1-2000 个字符')
  }
  if (!Array.isArray(spec.args) || spec.args.length > 20 || spec.args.some((a) => typeof a !== 'string' || a.length > 2000)) {
    throw new Error('args 须为字符串数组（≤20 项，每项 ≤2000 字符）')
  }
  if (!spec.env || typeof spec.env !== 'object' || Array.isArray(spec.env)) throw new Error('env 非法')
  const envKeys = Object.keys(spec.env)
  if (envKeys.length > 20) throw new Error('env 最多 20 个键')
  for (const k of envKeys) {
    if (!ENV_KEY_RE.test(k)) throw new Error(`env 键名非法：${k}`)
    const v = spec.env[k]
    if (typeof v !== 'string' || v.length > 4000) throw new Error(`env 值非法：${k}`)
  }
}

export async function mcpList(tool: ToolId): Promise<McpListResult> {
  assertTool(tool)
  const servers = tool === 'claude' ? await claude.listMcpClaude() : await codex.listMcpCodex()
  return { tool, file: tool === 'claude' ? '(~/.claude.json)' : '(~/.codex/config.toml)', servers }
}

export async function mcpSave(tool: ToolId, spec: McpServerSpec): Promise<boolean> {
  assertTool(tool)
  assertSpec(spec)
  if (tool === 'claude') await claude.saveMcpClaude(spec)
  else await codex.saveMcpCodex(spec)
  return true
}

export async function mcpDelete(tool: ToolId, name: string): Promise<boolean> {
  assertTool(tool)
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error('非法的服务器名称')
  if (tool === 'claude') await claude.deleteMcpClaude(name)
  else await codex.deleteMcpCodex(name)
  return true
}
