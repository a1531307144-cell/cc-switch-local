import crypto from 'node:crypto'
import type { ServerResponse } from 'node:http'
import type { Provider } from '../shared/types'

/**
 * 协议转换（v0.8.3）：Anthropic Messages ↔ OpenAI Chat Completions。
 * 方向：Claude Code 客户端 → 本机路由 → 协议 = openai 的 claude 供应商。
 * 覆盖：system/messages/tools/tool_choice 映射、文本与图片块、工具调用互转、
 * JSON 与 SSE 流式两种响应。count_tokens 不打上游，本地粗估。
 * 参考 cc-switch src-tauri/src/proxy/ 的语义。
 */

// ─── Anthropic 请求 → OpenAI 请求 ───

interface AnthropicBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  source?: { type?: string; media_type?: string; data?: string }
  [k: string]: unknown
}

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: unknown
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

interface OpenAIBody {
  model: string
  messages: OpenAIMessage[]
  max_tokens?: number
  temperature?: number
  top_p?: number
  stop?: string[]
  stream?: boolean
  stream_options?: { include_usage: boolean }
  tools?: unknown
  tool_choice?: unknown
}

function blocksOf(content: unknown): AnthropicBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return Array.isArray(content) ? (content as AnthropicBlock[]) : []
}

function textPartsOf(content: unknown): string {
  return blocksOf(content)
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('')
}

/** 用户消息内容 → OpenAI content：纯文本用 string，含图片用 parts（vision 格式） */
function userContentOf(blocks: AnthropicBlock[]): string | { type: string; text?: string; image_url?: { url: string } }[] {
  const parts: { type: string; text?: string; image_url?: { url: string } }[] = []
  for (const b of blocks) {
    if (b.type === 'text' && typeof b.text === 'string') parts.push({ type: 'text', text: b.text })
    else if (b.type === 'image' && b.source?.type === 'base64' && typeof b.source.data === 'string') {
      parts.push({ type: 'image_url', image_url: { url: `data:${b.source.media_type ?? 'image/png'};base64,${b.source.data}` } })
    }
  }
  if (parts.length === 0) return ''
  if (parts.every((p) => p.type === 'text')) return parts.map((p) => p.text).join('')
  return parts
}

/** Anthropic Messages 请求体 → OpenAI Chat Completions 请求体 */
export function anthropicToOpenAI(body: Record<string, unknown>, provider: Provider): OpenAIBody {
  const out: OpenAIBody = {
    // 上游模型名：优先用供应商配置的 model（客户端发的是 claude-* 名，OpenAI 端点不认）
    model: provider.model || (typeof body.model === 'string' ? body.model : 'gpt-4o-mini'),
    messages: []
  }
  if (typeof body.max_tokens === 'number') out.max_tokens = body.max_tokens
  if (typeof body.temperature === 'number') out.temperature = body.temperature
  if (typeof body.top_p === 'number') out.top_p = body.top_p
  if (Array.isArray(body.stop_sequences) && body.stop_sequences.length) out.stop = body.stop_sequences as string[]
  const stream = body.stream === true
  out.stream = stream
  if (stream) out.stream_options = { include_usage: true }

  if (body.system !== undefined && body.system !== null) {
    const sys = textPartsOf(body.system)
    if (sys) out.messages.push({ role: 'system', content: sys })
  }

  for (const msg of (Array.isArray(body.messages) ? body.messages : []) as { role?: unknown; content?: unknown }[]) {
    const role = msg.role === 'assistant' ? 'assistant' : 'user'
    const blocks = blocksOf(msg.content)
    if (role === 'assistant') {
      const text = textPartsOf(blocks)
      const toolCalls = blocks
        .filter((b) => b.type === 'tool_use' && typeof b.name === 'string')
        .map((b) => ({
          id: typeof b.id === 'string' && b.id ? b.id : `call_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
          type: 'function' as const,
          function: { name: b.name as string, arguments: JSON.stringify(b.input ?? {}) }
        }))
      const m: OpenAIMessage = { role: 'assistant', content: text }
      if (toolCalls.length) m.tool_calls = toolCalls
      out.messages.push(m)
    } else {
      // user 消息：tool_result 块 → 独立的 role:'tool' 消息；其余文本/图片 → user 消息
      const toolResults = blocks.filter((b) => b.type === 'tool_result')
      const rest = blocks.filter((b) => b.type !== 'tool_result')
      for (const tr of toolResults) {
        const inner = textPartsOf(tr.content)
        out.messages.push({
          role: 'tool',
          tool_call_id: typeof tr.tool_use_id === 'string' ? tr.tool_use_id : '',
          content: tr.is_error === true ? `ERROR: ${inner}` : inner
        })
      }
      if (rest.length) {
        const content = userContentOf(rest)
        if (content !== '') out.messages.push({ role: 'user', content })
      }
    }
  }

  if (Array.isArray(body.tools) && body.tools.length) {
    const tools = (body.tools as { name?: unknown; description?: unknown; input_schema?: unknown }[])
      .filter((t) => typeof t.name === 'string')
      .map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name as string,
          description: typeof t.description === 'string' ? t.description : '',
          parameters: (t.input_schema ?? { type: 'object', properties: {} }) as unknown
        }
      }))
    if (tools.length) out.tools = tools
  }

  const tc = body.tool_choice as { type?: unknown; name?: unknown } | undefined
  if (tc && typeof tc === 'object') {
    if (tc.type === 'auto') out.tool_choice = 'auto'
    else if (tc.type === 'any') out.tool_choice = 'required'
    else if (tc.type === 'tool' && typeof tc.name === 'string')
      out.tool_choice = { type: 'function', function: { name: tc.name } }
  }
  return out
}

/** count_tokens 的本地粗估（不打上游）：字符数/4 + 每条消息/tools 的固定开销 */
export function estimateAnthropicTokens(body: Record<string, unknown>): number {
  let chars = 0
  if (typeof body.system === 'string') chars += body.system.length
  else chars += textPartsOf(body.system).length
  for (const msg of (Array.isArray(body.messages) ? body.messages : []) as { content?: unknown }[]) {
    for (const b of blocksOf(msg.content)) {
      if (typeof b.text === 'string') chars += b.text.length
      if (b.type === 'tool_use' || b.type === 'tool_result') chars += JSON.stringify(b.input ?? b.content ?? '').length
      if (b.type === 'image') chars += 1500
    }
  }
  if (Array.isArray(body.tools)) chars += JSON.stringify(body.tools).length
  return Math.max(1, Math.ceil(chars / 4))
}

// ─── OpenAI 响应 → Anthropic 响应 ───

function stopReasonOf(finish: unknown): string {
  if (finish === 'tool_calls') return 'tool_use'
  if (finish === 'length') return 'max_tokens'
  if (finish === 'content_filter') return 'refusal'
  return 'end_turn'
}

/** OpenAI Chat Completions JSON 响应 → Anthropic Messages JSON 响应 */
export function openAIToAnthropicResponse(json: Record<string, unknown>, requestModel: string): Record<string, unknown> {
  const choice = (Array.isArray(json.choices) ? json.choices[0] ?? {} : {}) as {
    message?: { content?: unknown; tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[]; refusal?: unknown }
    finish_reason?: unknown
  }
  const usage = (json.usage ?? {}) as { prompt_tokens?: unknown; completion_tokens?: unknown }
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

  const content: Record<string, unknown>[] = []
  const msg = choice.message ?? {}
  const text =
    typeof msg.content === 'string'
      ? msg.content
      : Array.isArray(msg.content)
        ? (msg.content as { type?: unknown; text?: unknown }[])
            .filter((p) => p.type === 'text' && typeof p.text === 'string')
            .map((p) => p.text)
            .join('')
        : ''
  if (text) content.push({ type: 'text', text })
  if (typeof msg.refusal === 'string' && msg.refusal && !text) content.push({ type: 'text', text: msg.refusal })
  for (const tc of Array.isArray(msg.tool_calls) ? msg.tool_calls : []) {
    const name = tc.function?.name
    if (typeof name !== 'string') continue
    let input: unknown = {}
    try {
      input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}
    } catch {
      input = { _raw: tc.function?.arguments ?? '' }
    }
    content.push({ type: 'tool_use', id: typeof tc.id === 'string' && tc.id ? tc.id : `toolu_${crypto.randomUUID().slice(0, 8)}`, name, input })
  }

  return {
    id: typeof json.id === 'string' ? `msg_${json.id}` : `msg_${crypto.randomUUID()}`,
    type: 'message',
    role: 'assistant',
    model: typeof json.model === 'string' ? json.model : requestModel,
    content,
    stop_reason: stopReasonOf(choice.finish_reason),
    stop_sequence: null,
    usage: { input_tokens: num(usage.prompt_tokens), output_tokens: num(usage.completion_tokens) }
  }
}

/** 上游 4xx 错误 → Anthropic 错误结构（不参与故障转移，直接回给客户端） */
export function openAIErrorToAnthropic(status: number, text: string): Record<string, unknown> {
  let message = text.slice(0, 500)
  try {
    const j = JSON.parse(text) as { error?: { message?: unknown } }
    if (typeof j.error?.message === 'string') message = j.error.message
  } catch {
    /* 保留原文 */
  }
  return {
    type: 'error',
    error: { type: status === 401 || status === 403 ? 'authentication_error' : 'invalid_request_error', message }
  }
}

// ─── OpenAI SSE → Anthropic SSE（流式状态机） ───

interface ToolBlockState {
  outIndex: number
  started: boolean
  name: string
}

/**
 * 把 OpenAI 的 SSE 流实时翻译成 Anthropic 事件流写回客户端。
 * 返回实际写给客户端的 stop_reason（诊断用）。
 */
export async function pumpOpenAIToAnthropic(
  upstream: import('node:stream/web').ReadableStream<Uint8Array>,
  res: ServerResponse,
  fallbackModel: string
): Promise<void> {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  })

  const decoder = new TextDecoder()
  const reader = upstream.getReader()
  let buffer = ''

  let started = false
  let closed = false
  let outIndex = 0
  let textOpen = false
  let outputChars = 0
  let inputTokens = 0
  const tools = new Map<number, ToolBlockState>()

  const sse = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  const closeBlock = (index: number): void => {
    sse('content_block_stop', { type: 'content_block_stop', index })
  }
  const closeOpenBlocks = (): void => {
    if (textOpen) {
      closeBlock(outIndex)
      textOpen = false
    }
    for (const t of tools.values()) if (t.started) closeBlock(t.outIndex)
  }

  // 收尾：守卫重入；sse 只会被 finish 之前/之中的流程调用（后续数据块由 closed 拦截）
  const finish = (stopReason: string, outputTokens: number): void => {
    if (closed) return
    closed = true
    closeOpenBlocks()
    sse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { output_tokens: outputTokens }
    })
    sse('message_stop', { type: 'message_stop' })
    res.end()
  }

  const handleChunkJson = (payload: string): void => {
    if (closed) return
    if (payload === '[DONE]') {
      finish('end_turn', outputChars > 0 ? Math.ceil(outputChars / 4) : 1)
      return
    }
    let j: {
      id?: unknown
      model?: unknown
      usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
      choices?: { delta?: { content?: unknown; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }; finish_reason?: unknown }[]
    }
    try {
      j = JSON.parse(payload)
    } catch {
      return
    }
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    if (!started) {
      started = true
      inputTokens = num(j.usage?.prompt_tokens)
      sse('message_start', {
        type: 'message_start',
        message: {
          id: typeof j.id === 'string' ? `msg_${j.id}` : `msg_${crypto.randomUUID()}`,
          type: 'message',
          role: 'assistant',
          model: typeof j.model === 'string' ? j.model : fallbackModel,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: inputTokens, output_tokens: 0 }
        }
      })
    }
    const choice = j.choices?.[0]
    if (!choice) {
      // 只有 usage 的收尾块（stream_options.include_usage）
      if (j.usage?.completion_tokens !== undefined && !closed) {
        finish('end_turn', num(j.usage.completion_tokens))
      }
      return
    }
    const delta = choice.delta ?? {}
    if (typeof delta.content === 'string' && delta.content.length) {
      outputChars += delta.content.length
      if (!textOpen) {
        sse('content_block_start', { type: 'content_block_start', index: outIndex, content_block: { type: 'text', text: '' } })
        textOpen = true
      }
      sse('content_block_delta', { type: 'content_block_delta', index: outIndex, delta: { type: 'text_delta', text: delta.content } })
    }
    for (const tc of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
      const idx = typeof tc.index === 'number' ? tc.index : 0
      let t = tools.get(idx)
      if (!t) {
        // 新工具块：先收掉打开中的文本块（文本块起始就是当前 outIndex，未自增）
        if (textOpen) {
          closeBlock(outIndex)
          textOpen = false
        }
        outIndex += 1
        t = { outIndex, started: false, name: '' }
        tools.set(idx, t)
      }
      if (!t.started) {
        t.started = true
        t.name = tc.function?.name ?? ''
        sse('content_block_start', {
          type: 'content_block_start',
          index: t.outIndex,
          content_block: { type: 'tool_use', id: tc.id ?? `toolu_${crypto.randomUUID().slice(0, 8)}`, name: t.name || 'unknown_tool' }
        })
      }
      const args = tc.function?.arguments
      if (typeof args === 'string' && args.length) {
        outputChars += args.length
        sse('content_block_delta', { type: 'content_block_delta', index: t.outIndex, delta: { type: 'input_json_delta', partial_json: args } })
      }
    }
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) {
      // 上游可能还有 usage 收尾块，先不定 output_tokens；若无则按估算
      const completion = num(j.usage?.completion_tokens)
      finish(stopReasonOf(choice.finish_reason), completion || (outputChars > 0 ? Math.ceil(outputChars / 4) : 1))
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      for (;;) {
        const nl = buffer.indexOf('\n')
        if (nl < 0) break
        const line = buffer.slice(0, nl).replace(/\r$/, '')
        buffer = buffer.slice(nl + 1)
        if (line.startsWith('data:')) handleChunkJson(line.slice(5).trim())
      }
    }
  } catch {
    /* 上游中断：尽量收尾 */
  }
  if (!closed) finish('end_turn', outputChars > 0 ? Math.ceil(outputChars / 4) : 1)
}
