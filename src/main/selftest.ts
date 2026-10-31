import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { loadStore, newId, saveStore, storeFile, setMasterPassword, unlockMaster, clearMasterPassword, lockForTest } from './store'
import { compareVersions } from '../shared/version'
import * as claude from './claude'
import * as codex from './codex'
import { importFromCcSwitch } from './importer'
import { decryptBackup, exportBackupToFile, importBackupFromFile } from './backup'
import { usageStats } from './usage'
import { fetchBalance, balanceSupported } from './balance'
import { buildProviderDeeplink, findDeeplinkInArgv, parseProviderDeeplink } from './deeplink'
import { clearAppData } from './cleardata'
import { cloneProvider, reorderProviders, validateSettingsPatch, recordBalance } from './library'
import { switchProviderForTool } from './switcher'
import { routerPort, routerStatus, startRouter, stopRouter, resetBreakerForTest } from './router'
import { detectVendor } from '../shared/vendors'
import { aggregateAliasOf, resolveAggregatePrefix } from '../shared/aggregate'
import { listSessions, readSession, buildSessionMarkdown } from './sessions'
import { listPrompts, savePrompt, applyPrompt, deletePrompt, importCurrentPrompt, currentPromptFiles } from './prompts'
import { listGroups, saveGroup, applyGroup, deleteGroup } from './groups'
import { mcpDelete, mcpList, mcpSave } from './mcp'
import http from 'node:http'

interface Check {
  name: string
  pass: boolean
  detail?: string
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fsp.readFile(file, 'utf8')) as Record<string, unknown>
}

/**
 * 端到端自测。必须在 CCS_HOME_OVERRIDE / CCS_DATA_DIR 指向的隔离目录下运行，
 * 否则直接失败退出——绝不写真实用户配置。
 */
export async function runSelfTest(): Promise<void> {
  const checks: Check[] = []
  const step = async (name: string, fn: () => Promise<string | void>): Promise<void> => {
    try {
      const detail = await fn()
      checks.push({ name, pass: true, detail: detail || undefined })
    } catch (e) {
      checks.push({ name, pass: false, detail: (e as Error).message })
    }
  }
  const assert = (cond: boolean, msg: string): void => {
    if (!cond) throw new Error(msg)
  }
  const assertThrows = (fn: () => void, msg: string): void => {
    let threw = false
    try {
      fn()
    } catch {
      threw = true
    }
    assert(threw, msg)
  }

  const out = process.env.CCS_SELFTEST_OUT || path.join(process.cwd(), 'selftest-report.json')
  const home = process.env.CCS_HOME_OVERRIDE
  const allPass = () => checks.every((c) => c.pass)

  if (!home) {
    checks.push({
      name: '环境隔离',
      pass: false,
      detail: '必须设置 CCS_HOME_OVERRIDE 指向测试目录（防止误写真实配置）'
    })
  } else {
    const claudeSettings = path.join(home, '.claude', 'settings.json')

    await step('夹具存在：override 目录下有带 CUSTOM 键的 settings.json', async () => {
      const data = await readJson(claudeSettings)
      const env = data.env as Record<string, unknown>
      assert(env.CUSTOM === 'keep', `CUSTOM 应为 keep，实际 ${String(env.CUSTOM)}`)
      return `配置文件：${claudeSettings}`
    })

    const store = loadStore()
    const pa = {
      id: newId(),
      tool: 'claude' as const,
      name: '供应商A',
      baseUrl: 'https://a.example.com',
      apiKey: 'sk-test-a-1234567890abcd',
      keyType: 'auth_token' as const,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    const pb = {
      id: newId(),
      tool: 'claude' as const,
      name: '供应商B',
      baseUrl: 'https://b.example.com',
      apiKey: 'sk-test-b-76543210abcd',
      keyType: 'api_key' as const,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    const pc = {
      id: newId(),
      tool: 'codex' as const,
      name: '供应商C',
      baseUrl: 'https://c.example.com/v1',
      apiKey: 'sk-test-c-abcdef123456',
      keyType: 'auth_token' as const,
      model: 'gpt-test',
      wireApi: 'responses' as const,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    const pe = {
      id: newId(),
      tool: 'claude' as const,
      name: '协议转换家',
      baseUrl: 'https://openai.example.com',
      apiKey: 'sk-conv-0000000000001',
      keyType: 'auth_token' as const,
      protocol: 'openai' as const,
      model: 'gpt-test',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }

    await step('厂商识别：官方端点/仿冒域名/字母徽章/本地端点', async () => {
      const ds = detectVendor('https://api.deepseek.com')
      assert(ds?.id === 'deepseek' && ds.icon === 'deepseek', 'deepseek 识别失败')
      const fake = detectVendor('https://api.deepseek.com.evil.com')
      assert(fake === null, '仿冒域名不应识别为 deepseek')
      const oa = detectVendor('https://api.openai.com/v1')
      assert(oa?.id === 'openai' && !oa.icon && oa.letter === 'O', 'openai 应使用字母徽章')
      const ol = detectVendor('http://127.0.0.1:11434')
      assert(ol?.id === 'ollama', 'ollama 本地端口识别失败')
      const lms = detectVendor('http://127.0.0.1:1234')
      assert(lms?.id === 'lmstudio' && lms.icon === 'lmstudio', 'lmstudio 本地端口识别失败')
      const gm = detectVendor('https://generativelanguage.googleapis.com')
      assert(gm?.id === 'gemini' && gm.icon === 'google', 'gemini 识别失败')
      const mm = detectVendor('https://api.minimaxi.com/v1')
      assert(mm?.id === 'minimax' && mm.icon === 'minimax', 'minimax 识别失败')
      const local = detectVendor('http://localhost:8080')
      assert(local?.id === 'local', '通用本地端点识别失败')
      const unknown = detectVendor('https://a.example.com')
      assert(unknown === null, '未知端点应返回 null')
    })

    await step('存储：写入三个供应商并持久化', async () => {
      store.providers.push(pa, pb, pc)
      await saveStore(store)
      const reloaded = loadStore()
      assert(reloaded.providers.length === 3, `应有 3 条，实际 ${reloaded.providers.length}`)
      return `存储文件：${storeFile()}`
    })

    await step('加载防线：providers.json 里的坏记录被丢弃（2026-10-31 审计 #8）', async () => {
      const raw = JSON.parse(await fsp.readFile(storeFile(), 'utf8')) as { providers: unknown[] }
      raw.providers.push({ id: 'bad1', tool: 'nope', name: 'x', baseUrl: 'https://x.example.com', apiKey: 'k' })
      raw.providers.push({ id: 'bad2', tool: 'claude', name: '', baseUrl: 'https://x.example.com', apiKey: 'k' })
      await fsp.writeFile(storeFile(), JSON.stringify(raw), 'utf8')
      const reloaded = loadStore()
      assert(reloaded.providers.length === 3, `坏记录应被过滤，应剩 3 条，实际 ${reloaded.providers.length}`)
      assert(reloaded.providers.every((p) => p.id !== 'bad1' && p.id !== 'bad2'), '坏记录 id 不应存在')
    })

    await step('设置校验：非法 patch 全部拒绝，合法 patch 通过（2026-10-31 审计 P2）', async () => {
      assertThrows(() => validateSettingsPatch({ theme: 'hacker' as never }), '非法主题应拒绝')
      assertThrows(() => validateSettingsPatch({ autoStart: 'yes' as never }), '非法自启开关应拒绝')
      assertThrows(() => validateSettingsPatch({ sidebarCollapsed: 1 as never }), '非法侧栏状态应拒绝')
      assertThrows(() => validateSettingsPatch({ providerView: 'table' as never }), '非法视图样式应拒绝')
      assertThrows(() => validateSettingsPatch({ router: { claude: 'yes' } as never }), '非法路由开关应拒绝')
      assertThrows(() => validateSettingsPatch({ router: { claude: true, codex: false, port: 99999 } as never }), '越界端口应拒绝')
      assertThrows(() => validateSettingsPatch({ evil: 1 } as never), '未知键应拒绝')
      validateSettingsPatch({ sidebarCollapsed: true })
      validateSettingsPatch({ providerView: 'list' })
      validateSettingsPatch({ router: { claude: true, codex: false, port: 15731 } })
      validateSettingsPatch({ theme: 'dark', language: 'en' })
    })

    await step('Claude 切换 A：写 AUTH_TOKEN，保留 CUSTOM，删除 API_KEY，产生备份', async () => {
      const r = await claude.switchClaude(pa)
      const data = await readJson(r.files[0])
      const env = data.env as Record<string, unknown>
      assert(env.ANTHROPIC_BASE_URL === pa.baseUrl, 'ANTHROPIC_BASE_URL 未写入')
      assert(env.ANTHROPIC_AUTH_TOKEN === pa.apiKey, 'ANTHROPIC_AUTH_TOKEN 未写入')
      assert(!('ANTHROPIC_API_KEY' in env), 'ANTHROPIC_API_KEY 应被清除')
      assert(env.CUSTOM === 'keep', '原有 env.CUSTOM 应保留')
      assert(!!r.backup, '应产生备份文件')
      return `备份：${r.backup}`
    })

    await step('Claude 切换 B（api_key 型）：写 API_KEY，清除 AUTH_TOKEN', async () => {
      const r = await claude.switchClaude(pb)
      const data = await readJson(r.files[0])
      const env = data.env as Record<string, unknown>
      assert(env.ANTHROPIC_API_KEY === pb.apiKey, 'ANTHROPIC_API_KEY 未写入')
      assert(!('ANTHROPIC_AUTH_TOKEN' in env), 'ANTHROPIC_AUTH_TOKEN 应被清除')
    })

    await step('Claude 恢复官方登录：三个键全部清除，CUSTOM 保留', async () => {
      await claude.switchClaude(null)
      const data = await readJson(claudeSettings)
      const env = data.env as Record<string, unknown>
      assert(!('ANTHROPIC_BASE_URL' in env), 'BASE_URL 应被清除')
      assert(!('ANTHROPIC_AUTH_TOKEN' in env), 'AUTH_TOKEN 应被清除')
      assert(!('ANTHROPIC_API_KEY' in env), 'API_KEY 应被清除')
      assert(env.CUSTOM === 'keep', 'CUSTOM 应保留')
    })

    await step('Claude 备份管理：列出并恢复最早的备份（应为夹具原始值）', async () => {
      const baks = await claude.listBackups()
      assert(baks.length >= 3, `应至少 3 份备份，实际 ${baks.length}`)
      await claude.restoreBackup(baks[baks.length - 1].file)
      const data = await readJson(claudeSettings)
      const env = data.env as Record<string, unknown>
      assert(env.ANTHROPIC_BASE_URL === 'https://old.example.com', '恢复后应为夹具原始 base_url')
      assert(env.ANTHROPIC_AUTH_TOKEN === 'sk-old-token-9999', '恢复后应为夹具原始 AUTH_TOKEN')
    })

    await step('Codex 切换 C：关键字段写入，注释与 profile 段原样保留', async () => {
      const r = await codex.switchCodex(pc)
      assert(r.files.length === 2, `应写 2 个文件，实际 ${r.files.length}`)
      const tomlText = await fsp.readFile(r.files[0], 'utf8')
      assert(tomlText.includes('base_url = "https://c.example.com/v1"'), 'base_url 未写入')
      assert(tomlText.includes('model_provider = "ccsl"'), 'model_provider 未写入')
      assert(tomlText.includes('model = "gpt-test"'), 'model 未写入')
      assert(tomlText.includes('# 用户手工维护的注释'), '顶层注释丢失（不应全量重写）')
      assert(tomlText.includes('# profile 内注释'), '段内注释丢失')
      assert(tomlText.includes('approval_policy = "on-request"'), '用户顶层键丢失')
      assert(tomlText.includes('[profile.fast]'), '用户 profile 段丢失')
      assert(tomlText.includes('model_reasoning_effort = "low"'), 'profile 内容丢失')
      // 多行字符串陷阱：内部伪键/伪段头不得被误当真（2026-10-31 审计 #5）
      assert(tomlText.includes('model = fake'), '顶层多行字符串应原样保留（不被误替换）')
      assert(tomlText.includes('[model_providers.evil]'), '字符串内伪段头应原样保留')
      assert(
        tomlText.indexOf('model_provider = "ccsl"') < tomlText.indexOf('[profile.fast]'),
        'model_provider 应插入到首个真实 section 之前（而非字符串内或之后）'
      )
      const auth = await readJson(r.files[1])
      assert(auth.OPENAI_API_KEY === pc.apiKey, 'OPENAI_API_KEY 未写入')
      return `备份：${r.backup}`
    })

    await step('Codex 恢复官方配置：本工具写入的键被移除，注释与用户段仍在', async () => {
      await codex.switchCodex(null)
      const tomlText = await fsp.readFile(path.join(home, '.codex', 'config.toml'), 'utf8')
      assert(!tomlText.includes('model_provider = "ccsl"'), 'model_provider 应被移除')
      assert(!tomlText.includes('[model_providers.ccsl]'), 'ccsl 段应被移除')
      assert(tomlText.includes('# 用户手工维护的注释'), '恢复后顶层注释丢失')
      assert(tomlText.includes('[profile.fast]'), '恢复后 profile 段丢失')
    })

    await step('Codex：auth.json 损坏时切换中止，config.toml 不被改写（2026-10-31 审计 #4）', async () => {
      await fsp.writeFile(path.join(home, '.codex', 'auth.json'), '{broken json', 'utf8')
      const before = await fsp.readFile(path.join(home, '.codex', 'config.toml'), 'utf8')
      let threw = false
      try {
        await codex.switchCodex(pc)
      } catch {
        threw = true
      }
      assert(threw, 'auth.json 非法 JSON 应中止切换')
      const after = await fsp.readFile(path.join(home, '.codex', 'config.toml'), 'utf8')
      assert(before === after, '中止时 config.toml 不应被改写')
      // 恢复合法 auth.json 供后续步骤使用
      await fsp.writeFile(
        path.join(home, '.codex', 'auth.json'),
        JSON.stringify({ OPENAI_API_KEY: 'sk-old-codex-key', tokens: { account_id: 'fixture' } }),
        'utf8'
      )
    })

    await step('cc-switch 迁移导入：从旧版 config.json 挖出供应商', async () => {
      const ccDir = path.join(home, '.cc-switch')
      await fsp.mkdir(ccDir, { recursive: true })
      const legacy = {
        claude: {
          providers: {
            p1: {
              name: '旧版中转站',
              settingsConfig: {
                env: { ANTHROPIC_BASE_URL: 'https://legacy.example.com', ANTHROPIC_AUTH_TOKEN: 'sk-legacy-000111222333' }
              }
            }
          }
        }
      }
      await fsp.writeFile(path.join(ccDir, 'config.json'), JSON.stringify(legacy), 'utf8')
      const report = await importFromCcSwitch()
      assert(report.imported >= 1, `应至少导入 1 条，实际 ${report.imported}；明细：${report.details.join(' / ')}`)
      const hit = report.providers.find((p) => p.baseUrl === 'https://legacy.example.com')
      assert(!!hit, '未挖到 legacy.example.com')
      assert(hit?.apiKey === 'sk-legacy-000111222333', 'Key 提取不正确')

      // 去重：把挖到的供应商存入库后，再次导入必须排除它
      const s = loadStore()
      s.providers.push({
        id: newId(),
        tool: 'claude',
        name: hit!.name ?? '旧版中转站',
        baseUrl: hit!.baseUrl,
        apiKey: hit!.apiKey,
        keyType: hit!.keyType,
        createdAt: Date.now(),
        updatedAt: Date.now()
      })
      await saveStore(s)
      const again = await importFromCcSwitch()
      assert(
        !again.providers.some((p) => p.baseUrl === 'https://legacy.example.com'),
        '重复导入应排除已存在的供应商'
      )
    })

    await step('用量统计：解析 Claude/Codex 会话日志并聚合（含 message.id 去重）', async () => {
      const proj = path.join(home, '.claude', 'projects', 'proj-x')
      await fsp.mkdir(proj, { recursive: true })
      const claudeLines = [
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-10-29T10:00:00Z',
          message: {
            id: 'msg_1',
            model: 'claude-sonnet-4-5',
            content: [{ type: 'text', text: '好的，我来处理。' }],
            usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 200, cache_creation_input_tokens: 10 }
          }
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-10-29T10:01:00Z',
          message: {
            id: 'msg_1',
            model: 'claude-sonnet-4-5',
            content: [{ type: 'text', text: '好的，我来处理。' }],
            usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 200, cache_creation_input_tokens: 10 }
          }
        }),
        JSON.stringify({
          type: 'assistant',
          timestamp: '2026-10-30T10:00:00Z',
          message: {
            id: 'msg_2',
            model: 'claude-opus-4-6',
            content: [{ type: 'text', text: '第二条回复。' }],
            usage: { input_tokens: 20, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
          }
        }),
        '这不是一行合法 JSON',
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' } })
      ].join('\n')
      await fsp.writeFile(path.join(proj, 'session-1.jsonl'), claudeLines, 'utf8')

      const sdir = path.join(home, '.codex', 'sessions', '2026', '10', '29')
      await fsp.mkdir(sdir, { recursive: true })
      const codexLines = [
        JSON.stringify({ timestamp: '2026-10-29T09:00:00Z', type: 'turn_context', payload: { model: 'gpt-5.1-codex' } }),
        JSON.stringify({ timestamp: '2026-10-29T09:00:01Z', type: 'event_msg', payload: { type: 'user_message', message: '帮我修个 bug' } }),
        JSON.stringify({
          timestamp: '2026-10-29T09:00:05Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: { input_tokens: 500, cached_input_tokens: 100, output_tokens: 200, total_tokens: 700 },
              last_token_usage: { input_tokens: 500, cached_input_tokens: 100, output_tokens: 200 }
            }
          }
        }),
        JSON.stringify({ timestamp: '2026-10-29T09:01:00Z', type: 'event_msg', payload: { type: 'agent_message', message: '已修复，测试通过。' } }),
        JSON.stringify({
          timestamp: '2026-10-29T09:02:00Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              total_token_usage: { input_tokens: 900, cached_input_tokens: 150, output_tokens: 400, total_tokens: 1300 },
              last_token_usage: { input_tokens: 400, cached_input_tokens: 50, output_tokens: 200 }
            }
          }
        })
      ].join('\n')
      await fsp.writeFile(path.join(sdir, 'rollout-test.jsonl'), codexLines, 'utf8')

      const stats = await usageStats()
      assert(stats.scannedFiles === 2, `应扫描 2 个文件，实际 ${stats.scannedFiles}`)
      assert(stats.totals.requests === 4, `总请求应为 4（Claude 2 + Codex 2），实际 ${stats.totals.requests}`)
      assert(stats.totals.input === 1020, `输入 Token 应为 1020，实际 ${stats.totals.input}`)
      assert(stats.totals.output === 530, `输出 Token 应为 530，实际 ${stats.totals.output}`)
      assert(stats.totals.cacheRead === 350, `缓存读应为 350，实际 ${stats.totals.cacheRead}`)
      assert(stats.totals.cost > 0, '估算花费应大于 0')
      const sonnet = stats.models.find((m) => m.model === 'claude-sonnet-4-5')
      assert(sonnet?.requests === 1, `msg_1 去重后 sonnet 应为 1 次请求，实际 ${sonnet?.requests}`)
      const codexModel = stats.models.find((m) => m.model === 'gpt-5.1-codex')
      assert(codexModel?.requests === 2, `Codex 会话应计 2 次请求，实际 ${codexModel?.requests}`)
      assert(stats.recent.length >= 3, `recent 应 ≥ 3 条，实际 ${stats.recent.length}`)
      return `扫描 ${stats.scannedFiles} 文件 ${stats.scanMs}ms`
    })

    await step('删除供应商：从存储中移除且不影响其它', async () => {
      const s = loadStore()
      const before = s.providers.length
      s.providers = s.providers.filter((p) => p.id !== pb.id)
      await saveStore(s)
      const reloaded = loadStore()
      assert(reloaded.providers.length === before - 1, `应剩 ${before - 1} 条，实际 ${reloaded.providers.length}`)
      assert(reloaded.providers.every((p) => p.id !== pb.id), '供应商B 应被删除')
    })

    await step('克隆供应商：新 id、名称加副本、字段一致、紧跟原条目', async () => {
      const copy = await cloneProvider(pa.id)
      assert(copy.id !== pa.id, '克隆应有新 id')
      assert(copy.name === `${pa.name} 副本`, `克隆名称应为「${pa.name} 副本」，实际 ${copy.name}`)
      assert(copy.baseUrl === pa.baseUrl && copy.apiKey === pa.apiKey && copy.keyType === pa.keyType, '克隆字段应与原条目一致')
      const s = loadStore()
      const i = s.providers.findIndex((p) => p.id === pa.id)
      assert(s.providers[i + 1]?.id === copy.id, '克隆应紧跟原条目之后')
      let rejected = false
      try {
        await cloneProvider('no-such-id')
      } catch {
        rejected = true
      }
      assert(rejected, '克隆不存在的 id 应报错')
    })

    await step('拖拽排序：重排 Claude 顺序并持久化，Codex 不受影响，非法参数拒绝', async () => {
      const s = loadStore()
      const claudeIds = s.providers.filter((p) => p.tool === 'claude').map((p) => p.id)
      assert(claudeIds.length >= 3, `排序前 Claude 应 ≥ 3 条，实际 ${claudeIds.length}`)
      const rotated = [claudeIds[claudeIds.length - 1], ...claudeIds.slice(0, -1)]
      await reorderProviders('claude', rotated)
      const after = loadStore().providers.filter((p) => p.tool === 'claude').map((p) => p.id)
      assert(JSON.stringify(after) === JSON.stringify(rotated), '重排后的顺序未持久化')
      const reloaded = loadStore()
      assert(reloaded.providers.some((p) => p.id === pc.id), 'Codex 条目不应丢失')
      assert(reloaded.providers.filter((p) => p.tool === 'claude').length === claudeIds.length, 'Claude 条目数应不变')
      // 非法参数：数量不符 / 重复 id / 混入其它工具的 id
      const bads = [claudeIds.slice(0, 1), [...claudeIds, claudeIds[0]], [...claudeIds.slice(0, -1), pc.id]]
      for (let i = 0; i < bads.length; i++) {
        let rejected = false
        try {
          await reorderProviders('claude', bads[i])
        } catch {
          rejected = true
        }
        assert(rejected, `非法排序参数 #${i + 1} 应被拒绝`)
      }
      await reorderProviders('claude', claudeIds)
    })

    const bakFile = path.join(home, 'selftest-backup.ccslbak')
    await step('加密备份导出：AES-256-GCM 文件生成且不含明文 Key', async () => {
      await exportBackupToFile(bakFile, 'selftest-pass-1234')
      const buf = await fsp.readFile(bakFile)
      assert(buf.subarray(0, 8).toString('ascii') === 'CCSLBAK1', '文件头应为 CCSLBAK1')
      assert(!buf.toString('utf8').includes('sk-test-a-1234567890abcd'), '文件中出现明文 Key')
    })

    await step('加密备份解密：错误口令失败，正确口令还原出供应商库', async () => {
      const buf = await fsp.readFile(bakFile)
      let wrongFailed = false
      try {
        decryptBackup(buf, 'wrong-pass-9999')
      } catch {
        wrongFailed = true
      }
      assert(wrongFailed, '错误口令应解密失败')
      const payload = decryptBackup(buf, 'selftest-pass-1234')
      assert(payload.kind === 'ccsl-backup' && payload.version === 1, '载荷标识不合法')
      const s = loadStore()
      assert(payload.providers.length === s.providers.length, `应含 ${s.providers.length} 条，实际 ${payload.providers.length}`)
    })

    await step('加密备份导入：去重合并（删掉的供应商被找回，未删的跳过）', async () => {
      const s = loadStore()
      const before = s.providers.length
      // 删掉一条再导入：备份里有它，应被找回（added=1），其余全部跳过。
      // 注意选一条没有克隆体的（克隆与原条目 tool|baseUrl|apiKey 相同，会挡住去重）——pc 是 codex，克隆步骤只克隆了 claude 的 pa。
      const victim = s.providers.find((p) => p.id === pc.id)
      if (!victim) throw new Error('pc 应存在')
      s.providers = s.providers.filter((p) => p.id !== victim.id)
      await saveStore(s)
      const r = await importBackupFromFile(bakFile, 'selftest-pass-1234')
      assert(r.added === 1, `应新增 1 条，实际 ${r.added}`)
      const after = loadStore()
      assert(after.providers.length === before, `导入后应恢复为 ${before} 条，实际 ${after.providers.length}`)
      assert(
        after.providers.some((p) => p.tool === victim.tool && p.baseUrl === victim.baseUrl && p.apiKey === victim.apiKey),
        '被删供应商应被找回'
      )
    })

    await step('本机路由：路由模式写入占位 Key 与代理地址（Claude/Codex）', async () => {
      const s = loadStore()
      s.current.claude = pa.id
      await saveStore(s)
      await claude.switchClaude(pa, true)
      const data = await readJson(claudeSettings)
      const env = data.env as Record<string, unknown>
      assert(
        env.ANTHROPIC_BASE_URL === `http://127.0.0.1:${routerPort()}/claude`,
        `BASE_URL 应指向本机路由，实际 ${String(env.ANTHROPIC_BASE_URL)}`
      )
      assert(env.ANTHROPIC_AUTH_TOKEN === 'ccsl-local-router', '路由模式应写占位 Key（真实 Key 不落盘）')
      await codex.switchCodex(pc, true)
      const tomlText = await fsp.readFile(path.join(home, '.codex', 'config.toml'), 'utf8')
      assert(
        tomlText.includes(`base_url = "http://127.0.0.1:${routerPort()}/codex"`),
        'codex base_url 应指向本机路由'
      )
      const auth = await readJson(path.join(home, '.codex', 'auth.json'))
      assert(auth.OPENAI_API_KEY === 'ccsl-local-router', 'codex auth 应写占位 Key')
      await codex.switchCodex(null)
    })

    await step('本机路由：故障转移（第一家 500 → 自动切第二家并注入真实 Key）', async () => {
      const okReceived: { auth: string | null; body: string; url: string }[] = []
      const ok = http.createServer((req, res) => {
        let b = ''
        req.on('data', (c: Buffer) => (b += c))
        req.on('end', () => {
          okReceived.push({
            auth: (req.headers.authorization as string) ?? null,
            body: b,
            url: req.url ?? ''
          })
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, echo: b }))
        })
      })
      const fail = http.createServer((_req, res) => {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'mock down' }))
      })
      await new Promise<void>((r) => ok.listen(0, '127.0.0.1', () => r()))
      await new Promise<void>((r) => fail.listen(0, '127.0.0.1', () => r()))
      const okAddr = ok.address() as { port: number }
      const failAddr = fail.address() as { port: number }

      const s = loadStore()
      const pFail = { id: newId(), tool: 'claude' as const, name: '路由-故障家', baseUrl: `http://127.0.0.1:${failAddr.port}`, apiKey: 'sk-router-fail-000000', keyType: 'auth_token' as const, createdAt: Date.now(), updatedAt: Date.now() }
      const pOk = { id: newId(), tool: 'claude' as const, name: '路由-正常家', baseUrl: `http://127.0.0.1:${okAddr.port}`, apiKey: 'sk-router-ok-1234567890', keyType: 'auth_token' as const, createdAt: Date.now(), updatedAt: Date.now() }
      s.providers.unshift(pOk)
      s.providers.unshift(pFail)
      s.current.claude = pFail.id
      await saveStore(s)

      await startRouter()
      try {
        const r = await fetch(`http://127.0.0.1:${routerPort()}/claude/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
          body: '{"ping":1}'
        })
        assert(r.status === 200, `故障转移后应 200，实际 ${r.status}，响应：${r.status === 200 ? '' : await r.text()}`)
        assert(r.headers.get('x-ccsl-provider') === encodeURIComponent('路由-正常家'), `应由第二家服务，实际 ${r.headers.get('x-ccsl-provider')}`)
        const j = (await r.json()) as { ok: boolean; echo: string }
        assert(j.ok === true && j.echo === '{"ping":1}', '请求体应原样透传')
        assert(okReceived[0]?.auth === `Bearer ${pOk.apiKey}`, '真实 Key 应注入 upstream 头')
        assert(okReceived[0]?.url === '/v1/messages', `子路径应正确拼接，实际 ${okReceived[0]?.url}`)
        const st = routerStatus()
        assert(st.running && st.claude.requests >= 1, '路由状态应记录转发次数')
      } finally {
        stopRouter()
        ok.close()
        fail.close()
      }
    })

    await step('本机路由：熔断器（连续 3 次 5xx 进入冷却，后续请求不再撞故障家）', async () => {
      resetBreakerForTest()
      let failHits = 0
      const ok = http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
      const fail = http.createServer((_req, res) => {
        failHits++
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: 'mock down' }))
      })
      await new Promise<void>((r) => ok.listen(0, '127.0.0.1', () => r()))
      await new Promise<void>((r) => fail.listen(0, '127.0.0.1', () => r()))
      const okAddr = ok.address() as { port: number }
      const failAddr = fail.address() as { port: number }
      const s = loadStore()
      const prevCurrent = s.current.claude
      const pFail = { id: newId(), tool: 'claude' as const, name: '熔断-故障家', baseUrl: `http://127.0.0.1:${failAddr.port}`, apiKey: 'sk-breaker-fail-00001', keyType: 'auth_token' as const, createdAt: Date.now(), updatedAt: Date.now() }
      const pOk = { id: newId(), tool: 'claude' as const, name: '熔断-正常家', baseUrl: `http://127.0.0.1:${okAddr.port}`, apiKey: 'sk-breaker-ok-000001', keyType: 'auth_token' as const, createdAt: Date.now(), updatedAt: Date.now() }
      s.providers.unshift(pOk)
      s.providers.unshift(pFail)
      s.current.claude = pFail.id
      await saveStore(s)
      await startRouter()
      try {
        const hit = async (): Promise<string | null> => {
          const r = await fetch(`http://127.0.0.1:${routerPort()}/claude/v1/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{"ping":1}'
          })
          assert(r.status === 200, `故障转移应 200，实际 ${r.status}`)
          return r.headers.get('x-ccsl-provider')
        }
        for (let i = 0; i < 3; i++) {
          const who = await hit()
          assert(who === encodeURIComponent('熔断-正常家'), `第 ${i + 1} 次请求应由正常家服务，实际 ${who}`)
        }
        assert(failHits === 3, `前 3 次请求每次应撞一次故障家，实际 ${failHits}`)
        const who4 = await hit()
        assert(who4 === encodeURIComponent('熔断-正常家'), '第 4 次请求仍应由正常家服务')
        assert(failHits === 3, `熔断开启后不应再撞故障家，实际撞了 ${failHits} 次`)
      } finally {
        stopRouter()
        ok.close()
        fail.close()
        resetBreakerForTest()
        // 移除本步供应商并恢复 current：已关闭的 mock 留在库里会挤占后续步骤的故障转移窗口
        const s2 = loadStore()
        s2.providers = s2.providers.filter((p) => p.id !== pFail.id && p.id !== pOk.id)
        s2.current.claude = prevCurrent
        await saveStore(s2)
      }
    })

    await step('本机路由：来源校验（Origin / 错误 Host / OPTIONS 全部 403，不透传到上游）', async () => {
      const received: string[] = []
      const up = http.createServer((_req, res) => {
        received.push('hit')
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{}')
      })
      await new Promise<void>((r) => up.listen(0, '127.0.0.1', () => r()))
      const upAddr = up.address() as { port: number }
      const s = loadStore()
      const pOrigin = {
        id: newId(),
        tool: 'claude' as const,
        name: '路由-来源校验',
        baseUrl: `http://127.0.0.1:${upAddr.port}`,
        apiKey: 'sk-origin-test-000000001',
        keyType: 'auth_token' as const,
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      s.providers.push(pOrigin)
      s.current.claude = pOrigin.id
      await saveStore(s)
      await startRouter()
      try {
        const base = `http://127.0.0.1:${routerPort()}/claude/v1/messages`
        // 1) 浏览器跨域请求（带 Origin）→ 403
        const r1 = await fetch(base, {
          method: 'POST',
          headers: { 'content-type': 'application/json', origin: 'https://evil.example.com' },
          body: '{}'
        })
        assert(r1.status === 403, `带 Origin 应 403，实际 ${r1.status}`)
        // 2) OPTIONS 预检 → 403
        const r2 = await fetch(base, { method: 'OPTIONS' })
        assert(r2.status === 403, `OPTIONS 应 403，实际 ${r2.status}`)
        // 3) DNS rebinding（Host 伪造成外部域名）→ 403；fetch 禁改 Host，用原生 http.request
        const bad = await new Promise<number>((resolve, reject) => {
          const req = http.request(
            {
              host: '127.0.0.1',
              port: routerPort(),
              path: '/claude/v1/messages',
              method: 'POST',
              headers: { host: 'evil.example.com:1' }
            },
            (res) => {
              res.resume()
              resolve(res.statusCode ?? 0)
            }
          )
          req.on('error', reject)
          req.end()
        })
        assert(bad === 403, `伪造 Host 应 403，实际 ${bad}`)
        // 4) 正常 CLI 请求（无 Origin、Host 为回环地址）仍透传
        const r4 = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        assert(r4.status === 200, `正常请求应 200，实际 ${r4.status}`)
        assert(received.length === 1, `上游只应收到 1 个请求，实际 ${received.length}（非法请求不得透传）`)
      } finally {
        stopRouter()
        up.close()
      }
    })

    await step('协议转换：Anthropic 请求→OpenAI 上游（system/tools/tool_result 映射 + 响应回转）', async () => {
      const received: { url: string; auth: string | null; body: Record<string, unknown> }[] = []
      const up = http.createServer((req, res) => {
        let b = ''
        req.on('data', (c: Buffer) => (b += c))
        req.on('end', () => {
          received.push({ url: req.url ?? '', auth: (req.headers.authorization as string) ?? null, body: JSON.parse(b) as Record<string, unknown> })
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              id: 'chatcmpl-1',
              model: 'gpt-test',
              choices: [{ index: 0, message: { role: 'assistant', content: '你好，来自 OpenAI 端点' }, finish_reason: 'stop' }],
              usage: { prompt_tokens: 12, completion_tokens: 7 }
            })
          )
        })
      })
      await new Promise<void>((r) => up.listen(0, '127.0.0.1', () => r()))
      const upAddr = up.address() as { port: number }
      const s = loadStore()
      if (!s.providers.some((p) => p.id === pe.id)) s.providers.push(pe)
      const mine = s.providers.find((p) => p.id === pe.id)
      assert(!!mine, 'pe 应存在')
      mine!.baseUrl = `http://127.0.0.1:${upAddr.port}`
      s.current.claude = pe.id
      await saveStore(s)
      await startRouter()
      try {
        const r = await fetch(`http://127.0.0.1:${routerPort()}/claude/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: 100,
            stream: false,
            system: '你是助手',
            tools: [{ name: 'get_weather', description: '查天气', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }],
            messages: [
              { role: 'user', content: '北京天气如何？' },
              { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'get_weather', input: { city: '北京' } }] },
              { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '晴 25 度' }, { type: 'text', text: '谢谢' }] }
            ]
          })
        })
        assert(r.status === 200, `应 200，实际 ${r.status}，响应：${r.status === 200 ? '' : await r.text()}`)
        assert(received.length === 1, `上游应收到 1 个请求，实际 ${received.length}`)
        assert(received[0].url === '/chat/completions', `上游路径应为 /chat/completions，实际 ${received[0].url}`)
        assert(received[0].auth === 'Bearer sk-conv-0000000000001', '真实 Key 应注入上游')
        const oa = received[0].body
        assert(oa.model === 'gpt-test', '模型应映射为供应商 model（客户端的 claude-* 名不上传）')
        assert(oa.stream === false && oa.max_tokens === 100, 'stream/max_tokens 应映射')
        const msgs = oa.messages as { role: string; content: unknown; tool_calls?: unknown[]; tool_call_id?: string }[]
        assert(msgs[0].role === 'system' && msgs[0].content === '你是助手', 'system 应映射为 system 消息')
        assert(msgs[1].role === 'user' && msgs[1].content === '北京天气如何？', '纯文本 user 应为 string')
        const asst = msgs[2] as { role: string; tool_calls?: { function: { name: string; arguments: string } }[] }
        assert(asst.role === 'assistant' && asst.tool_calls?.[0]?.function.name === 'get_weather', 'tool_use 应映射为 tool_calls')
        assert(JSON.parse(asst.tool_calls![0].function.arguments).city === '北京', 'tool input 应序列化进 arguments')
        assert(msgs[3].role === 'tool' && msgs[3].tool_call_id === 'toolu_1' && msgs[3].content === '晴 25 度', 'tool_result 应映射为 role:tool')
        assert(msgs[4].role === 'user' && msgs[4].content === '谢谢', '剩余文本应为 user 消息')
        const tools = oa.tools as { function: { name: string; parameters: unknown } }[]
        assert(Array.isArray(tools) && tools[0].function.name === 'get_weather' && !!tools[0].function.parameters, 'tools 应映射为 function 格式')
        const j = (await r.json()) as { type: string; content: { type: string; text?: string }[]; usage: { input_tokens: number; output_tokens: number }; stop_reason: string }
        assert(j.type === 'message' && j.content[0]?.type === 'text' && j.content[0].text === '你好，来自 OpenAI 端点', '响应应回转为 Anthropic message')
        assert(j.usage.input_tokens === 12 && j.usage.output_tokens === 7, 'usage 应映射')
        assert(j.stop_reason === 'end_turn', 'finish_reason stop 应映射为 end_turn')
      } finally {
        stopRouter()
        up.close()
      }
    })

    await step('协议转换：OpenAI tool_calls → Anthropic tool_use（非流式）', async () => {
      const up = http.createServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            id: 'chatcmpl-2',
            model: 'gpt-test',
            choices: [
              {
                index: 0,
                message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"上海"}' } }] },
                finish_reason: 'tool_calls'
              }
            ],
            usage: { prompt_tokens: 8, completion_tokens: 5 }
          })
        )
      })
      await new Promise<void>((r) => up.listen(0, '127.0.0.1', () => r()))
      const upAddr = up.address() as { port: number }
      const s = loadStore()
      ;(s.providers.find((p) => p.id === pe.id) as { baseUrl: string }).baseUrl = `http://127.0.0.1:${upAddr.port}`
      s.current.claude = pe.id
      await saveStore(s)
      await startRouter()
      try {
        const r = await fetch(`http://127.0.0.1:${routerPort()}/claude/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 50, messages: [{ role: 'user', content: '上海天气' }] })
        })
        assert(r.status === 200, `应 200，实际 ${r.status}`)
        const j = (await r.json()) as { content: { type: string; id?: string; name?: string; input?: unknown }[]; stop_reason: string }
        const tu = j.content.find((c) => c.type === 'tool_use')
        assert(!!tu, '应有 tool_use 块')
        assert(tu!.id === 'call_1' && tu!.name === 'get_weather', `tool_use id/name 应保留：${JSON.stringify(tu)}`)
        assert((tu!.input as { city: string }).city === '上海', 'arguments 应回解析为 input 对象')
        assert(j.stop_reason === 'tool_use', 'finish_reason tool_calls 应映射为 tool_use')
      } finally {
        stopRouter()
        up.close()
      }
    })

    await step('协议转换：SSE 流式（text/tool_calls → Anthropic 事件序列）', async () => {
      const up = http.createServer((req, res) => {
        let b = ''
        req.on('data', (c: Buffer) => (b += c))
        req.on('end', () => {
          const wantStream = (JSON.parse(b) as { stream?: boolean }).stream === true
          if (!wantStream) {
            res.writeHead(400)
            res.end('expect stream')
            return
          }
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          const chunks = [
            'data: {"id":"c1","model":"gpt-test","choices":[{"index":0,"delta":{"role":"assistant","content":"你好"}}]}\n\n',
            'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"，世界"}}]}\n\n',
            'data: {"id":"c1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_9","function":{"name":"get_weather","arguments":""}}]}}]}\n\n',
            'data: {"id":"c1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":"}}]}}]}\n\n',
            'data: {"id":"c1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"杭州\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
            'data: {"id":"c1","choices":[],"usage":{"prompt_tokens":9,"completion_tokens":6}}\n\n',
            'data: [DONE]\n\n'
          ]
          for (const c of chunks) res.write(c)
          res.end()
        })
      })
      await new Promise<void>((r) => up.listen(0, '127.0.0.1', () => r()))
      const upAddr = up.address() as { port: number }
      const s = loadStore()
      ;(s.providers.find((p) => p.id === pe.id) as { baseUrl: string }).baseUrl = `http://127.0.0.1:${upAddr.port}`
      s.current.claude = pe.id
      await saveStore(s)
      await startRouter()
      try {
        const r = await fetch(`http://127.0.0.1:${routerPort()}/claude/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 50, stream: true, messages: [{ role: 'user', content: '杭州天气' }] })
        })
        assert(r.status === 200, `应 200，实际 ${r.status}`)
        const ct = r.headers.get('content-type') ?? ''
        assert(ct.includes('text/event-stream'), `应回 SSE，实际 ${ct}`)
        const text = await r.text()
        let events: { ev: string; data: Record<string, unknown> }[] = []
        try {
          events = text
            .split('\n\n')
            .filter((blk) => blk.startsWith('event:'))
            .map((blk) => {
              const ev = blk.match(/event: (.+)/)?.[1] ?? ''
              const data = blk.match(/data: (.+)/)?.[1] ?? ''
              return { ev, data: JSON.parse(data) as Record<string, unknown> }
            })
        } catch (e) {
          throw new Error(`SSE 解析失败：${(e as Error).message}；原始响应前 600 字符：${text.slice(0, 600)}`)
        }
        assert(events[0].ev === 'message_start', `首事件应为 message_start，实际 ${events[0].ev}`)
        const types = events.map((e) => e.ev)
        assert(types.includes('content_block_delta'), '应有 content_block_delta')
        const textDelta = events
          .filter((e) => e.ev === 'content_block_delta' && (e.data.delta as { type?: string }).type === 'text_delta')
          .map((e) => (e.data.delta as { text?: string }).text)
          .join('')
        assert(textDelta === '你好，世界', `文本增量应拼接为「你好，世界」，实际「${textDelta}」`)
        const toolStart = events.find((e) => e.ev === 'content_block_start' && (e.data.content_block as { type?: string }).type === 'tool_use')
        assert(!!toolStart, '应有 tool_use 的 content_block_start')
        const tb = toolStart!.data.content_block as { id?: string; name?: string }
        assert(tb.id === 'call_9' && tb.name === 'get_weather', `tool_use 头应带 id/name：${JSON.stringify(tb)}`)
        const argsJson = events
          .filter((e) => e.ev === 'content_block_delta' && (e.data.delta as { type?: string }).type === 'input_json_delta')
          .map((e) => (e.data.delta as { partial_json?: string }).partial_json ?? '')
          .join('')
        let argsParsed: { city?: string }
        try {
          argsParsed = JSON.parse(argsJson) as { city?: string }
        } catch {
          throw new Error(`arguments 分片拼接非法：「${argsJson}」；事件序列：${types.join(',')}；原始响应前 800 字符：${text.slice(0, 800)}`)
        }
        assert(argsParsed.city === '杭州', `arguments 应含 city=杭州，实际：${JSON.stringify(argsParsed)}`)
        assert(types[types.length - 1] === 'message_stop', '末事件应为 message_stop')
        const mDelta = events.find((e) => e.ev === 'message_delta')
        assert((mDelta!.data.delta as { stop_reason?: string }).stop_reason === 'tool_use', '流式 stop_reason 应为 tool_use')
        // 块序正确：text 先开先收，tool_use 后开；text 的收口在 tool_use 开启之前
        const starts = events.map((e) => e).filter((x) => x.ev === 'content_block_start')
        assert(starts.length === 2, '应有 2 个块（text + tool_use）')
        assert((starts[0].data.content_block as { type: string }).type === 'text', '第 1 块是 text')
        assert((starts[1].data.content_block as { type: string }).type === 'tool_use', '第 2 块是 tool_use')
        const idxFirstStop = types.indexOf('content_block_stop')
        const idxSecondStart = types.indexOf('content_block_start', types.indexOf('content_block_start') + 1)
        assert(idxFirstStop > -1 && idxSecondStart > -1 && idxFirstStop < idxSecondStart, 'text 块应在 tool_use 开始前收口')
      } finally {
        stopRouter()
        up.close()
      }
    })

    await step('协议转换：count_tokens 本地估算（不打上游）', async () => {
      const s = loadStore()
      ;(s.providers.find((p) => p.id === pe.id) as { baseUrl: string }).baseUrl = 'http://127.0.0.1:1'
      await saveStore(s)
      await startRouter()
      try {
        const r = await fetch(`http://127.0.0.1:${routerPort()}/claude/v1/messages/count_tokens`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-sonnet-4-5', messages: [{ role: 'user', content: 'hello world '.repeat(100) }] })
        })
        assert(r.status === 200, `应 200，实际 ${r.status}`)
        const j = (await r.json()) as { input_tokens: number }
        assert(j.input_tokens > 100, `token 估算应 >100，实际 ${JSON.stringify(j)}`)
      } finally {
        stopRouter()
      }
    })

    await step('切换 OpenAI 协议供应商自动开路由（统一出口），切回直连恢复', async () => {
      stopRouter()
      const s = loadStore()
      if (!s.providers.some((p) => p.id === pe.id)) s.providers.push(pe)
      s.current.claude = null
      await saveStore(s)
      const r = await switchProviderForTool('claude', pe)
      assert(r.ok, '切换应成功')
      const data = await readJson(claudeSettings)
      const env = data.env as Record<string, unknown>
      assert(env.ANTHROPIC_BASE_URL === `http://127.0.0.1:${routerPort()}/claude`, 'OpenAI 协议供应商应写入本机路由地址')
      assert(env.ANTHROPIC_AUTH_TOKEN === 'ccsl-local-router', '应写占位 Key')
      assert(routerStatus().running, '应自动拉起路由进程')
      // 切回 Anthropic 家：直连配置
      const r2 = await switchProviderForTool('claude', pa)
      assert(r2.ok, '切回应成功')
      const data2 = await readJson(claudeSettings)
      const env2 = data2.env as Record<string, unknown>
      assert(env2.ANTHROPIC_BASE_URL === pa.baseUrl && env2.ANTHROPIC_AUTH_TOKEN === pa.apiKey, '切回 Anthropic 家应为直连配置')
      stopRouter()
    })

    await step('聚合：纯函数（别名推导/前缀解析/大小写不敏感）', async () => {
      assert(aggregateAliasOf({ ...pa, name: 'My Relay', alias: undefined }) === 'my-relay', '英文名应自动推导别名')
      assert(aggregateAliasOf({ ...pa, name: '智谱 GLM', alias: undefined }) === 'glm', '中英混合名应保留 ASCII 部分')
      assert(aggregateAliasOf({ ...pa, name: '纯中文名', alias: undefined }) === null, '纯中文名不可前缀寻址')
      assert(aggregateAliasOf({ ...pa, alias: 'DS' }) === 'ds', '显式别名优先且小写化')
      const hit = resolveAggregatePrefix([{ ...pa, alias: 'ds' }], 'DS/deepseek-chat')
      assert(hit?.provider.id === pa.id && hit.model === 'deepseek-chat', '前缀解析应不区分大小写并剥离前缀')
      assert(resolveAggregatePrefix([{ ...pa, alias: 'ds' }], 'claude-sonnet') === null, '无前缀模型应返回 null')
      assert(resolveAggregatePrefix([{ ...pa, alias: 'ds' }], 'ds/') === null, '空模型名应返回 null')
      assert(resolveAggregatePrefix([{ ...pa, alias: 'ds' }], 'zz/m') === null, '未知前缀应返回 null')
    })

    await step('聚合：前缀分发（anthropic 直连 + openai 转换 + 无前缀兜底 + 未知前缀 400）', async () => {
      const hitA: { url: string; model: string }[] = []
      const upA = http.createServer((req, res) => {
        let b = ''
        req.on('data', (c: Buffer) => (b += c))
        req.on('end', () => {
          hitA.push({ url: req.url ?? '', model: (JSON.parse(b) as { model?: string }).model ?? '' })
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ id: 'msg_a', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'ok-a' }], usage: { input_tokens: 1, output_tokens: 1 } }))
        })
      })
      const hitB: { model: string }[] = []
      const upB = http.createServer((req, res) => {
        let b = ''
        req.on('data', (c: Buffer) => (b += c))
        req.on('end', () => {
          hitB.push({ model: (JSON.parse(b) as { model?: string }).model ?? '' })
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ id: 'chatcmpl-b', model: 'x', choices: [{ index: 0, message: { role: 'assistant', content: 'ok-b' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2 } }))
        })
      })
      await new Promise<void>((r) => upA.listen(0, '127.0.0.1', () => r()))
      await new Promise<void>((r) => upB.listen(0, '127.0.0.1', () => r()))
      const aAddr = upA.address() as { port: number }
      const bAddr = upB.address() as { port: number }
      const s = loadStore()
      if (!s.providers.some((p) => p.id === pe.id)) s.providers.push(pe)
      const paS = s.providers.find((p) => p.id === pa.id)
      const peS = s.providers.find((p) => p.id === pe.id)
      assert(!!paS && !!peS, 'pa/pe 应存在')
      paS!.baseUrl = `http://127.0.0.1:${aAddr.port}`
      peS!.baseUrl = `http://127.0.0.1:${bAddr.port}`
      peS!.alias = 'oa'
      // 前缀寻址的 anthropic 家（alias aa，与 pa 共用同一个 mock，靠 model 断言区分）
      if (!s.providers.some((p) => p.alias === 'aa')) {
        s.providers.push({
          id: newId(),
          tool: 'claude',
          name: '聚合家A',
          baseUrl: `http://127.0.0.1:${aAddr.port}`,
          apiKey: 'sk-agg-a-000000001',
          keyType: 'auth_token',
          alias: 'aa',
          model: 'm-a',
          createdAt: Date.now(),
          updatedAt: Date.now()
        })
      }
      s.current.claude = pa.id
      const r0 = s.settings.router ?? { claude: false, codex: false }
      s.settings.router = { ...r0, aggregate: true }
      await saveStore(s)
      await startRouter()
      try {
        const post = (model: string): Promise<Response> =>
          fetch(`http://127.0.0.1:${routerPort()}/claude/v1/messages`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model, max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] })
          })
        // 前缀 aa → anthropic 家直连，model 剥离
        const r1 = await post('aa/m-b')
        assert(r1.status === 200, `aa 前缀应 200，实际 ${r1.status}`)
        assert(hitA[0]?.model === 'm-b', `前缀应剥离，上游收到 m-b，实际 ${hitA[0]?.model}`)
        // 前缀 oa → openai 家转换，model 用剥离结果覆盖 provider.model
        const r2 = await post('oa/m-c')
        assert(r2.status === 200, `oa 前缀应 200，实际 ${r2.status}`)
        assert(hitB[0]?.model === 'm-c', `openai 家应收到剥离后的 m-c，实际 ${hitB[0]?.model}`)
        // 无前缀 → 走当前供应商（pa），model 原样
        const r3 = await post('claude-sonnet-4-5')
        assert(r3.status === 200 && hitA[1]?.model === 'claude-sonnet-4-5', `无前缀应走当前家且 model 原样，实际 ${JSON.stringify(hitA[1])}`)
        // 未知前缀 → 400
        const r4 = await post('zz/m-x')
        assert(r4.status === 400, `未知前缀应 400，实际 ${r4.status}`)
        const j4 = (await r4.json()) as { error?: { message?: string } }
        assert(j4.error?.message?.includes('未知的聚合前缀') === true, `错误信息应说明未知前缀：${JSON.stringify(j4)}`)
      } finally {
        stopRouter()
        const s2 = loadStore()
        if (s2.settings.router) s2.settings.router.aggregate = false
        await saveStore(s2)
        upA.close()
        upB.close()
      }
    })

    await step('聚合：前缀家故障 500 → 兜底链接管且模型已剥离', async () => {
      const dead = http.createServer((_req, res) => {
        res.writeHead(500)
        res.end('{}')
      })
      const hitModel: string[] = []
      const up = http.createServer((req, res) => {
        let b = ''
        req.on('data', (c: Buffer) => (b += c))
        req.on('end', () => {
          hitModel.push((JSON.parse(b) as { model?: string }).model ?? '')
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ id: 'msg_f', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }))
        })
      })
      await new Promise<void>((r) => dead.listen(0, '127.0.0.1', () => r()))
      await new Promise<void>((r) => up.listen(0, '127.0.0.1', () => r()))
      const deadAddr = dead.address() as { port: number }
      const upAddr = up.address() as { port: number }
      const s = loadStore()
      if (!s.providers.some((p) => p.id === pe.id)) s.providers.push(pe)
      const paS = s.providers.find((p) => p.id === pa.id)
      assert(!!paS, 'pa 应存在')
      paS!.baseUrl = `http://127.0.0.1:${upAddr.port}`
      const pf = {
        id: newId(),
        tool: 'claude' as const,
        name: '聚合故障家',
        baseUrl: `http://127.0.0.1:${deadAddr.port}`,
        apiKey: 'sk-agg-dead-00000001',
        keyType: 'auth_token' as const,
        alias: 'dead',
        model: 'm-dead',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
      s.providers.push(pf)
      s.current.claude = pa.id
      const r0 = s.settings.router ?? { claude: false, codex: false }
      s.settings.router = { ...r0, aggregate: true }
      await saveStore(s)
      await startRouter()
      try {
        const r = await fetch(`http://127.0.0.1:${routerPort()}/claude/v1/messages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'dead/m-x', max_tokens: 10, messages: [{ role: 'user', content: 'hi' }] })
        })
        assert(r.status === 200, `前缀家 500 后应由兜底家服务 200，实际 ${r.status}`)
        assert(hitModel[0] === 'm-x', `兜底家应收到剥离后的模型名 m-x，实际 ${hitModel[0]}`)
      } finally {
        stopRouter()
        const s2 = loadStore()
        if (s2.settings.router) s2.settings.router.aggregate = false
        await saveStore(s2)
        dead.close()
        up.close()
      }
    })

    await step('余额查询：mock 上游解析 + 401 报错 + 不支持的厂商拒绝', async () => {
      const ds = http.createServer((req, res) => {
        const auth = req.headers.authorization ?? ''
        if (auth !== 'Bearer sk-balance-ok-12345678') {
          res.writeHead(401)
          res.end('{"error":{"message":"auth"}}')
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            is_available: true,
            balance_infos: [{ currency: 'CNY', total_balance: '110.26', granted_balance: '0.00', topped_up_balance: '110.26' }]
          })
        )
      })
      await new Promise<void>((r) => ds.listen(0, '127.0.0.1', () => r()))
      const dsAddr = ds.address() as { port: number }
      try {
        assert(balanceSupported('https://api.deepseek.com'), 'deepseek 应支持余额查询')
        assert(balanceSupported('https://api.siliconflow.cn'), 'siliconflow 应支持余额查询（v0.8.9）')
        assert(!balanceSupported('https://relay.example-visual.com'), '未知中转站不应支持余额查询')

        const okR = await fetchBalance('https://api.deepseek.com', 'sk-balance-ok-12345678', {
          deepseek: `http://127.0.0.1:${dsAddr.port}/user/balance`
        })
        assert(okR.ok === true && okR.balance === 110.26 && okR.currency === 'CNY', `余额解析错误：${JSON.stringify(okR)}`)

        const authR = await fetchBalance('https://api.deepseek.com', 'sk-wrong-key-999999999', {
          deepseek: `http://127.0.0.1:${dsAddr.port}/user/balance`
        })
        assert(authR.ok === false && !!authR.message?.includes('鉴权'), `401 应报鉴权失败：${JSON.stringify(authR)}`)

        // SiliconFlow：/v1/user/info，取 totalBalance（含赠送额度），balance 为负时仍以 total 为准
        const sf = http.createServer((req, res) => {
          const auth = req.headers.authorization ?? ''
          if (auth !== 'Bearer sk-sf-ok-1234567890') {
            res.writeHead(401)
            res.end('{}')
            return
          }
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ code: 20000, data: { balance: '-5.00', totalBalance: '88.50', chargeBalance: '93.50' } }))
        })
        await new Promise<void>((r) => sf.listen(0, '127.0.0.1', () => r()))
        const sfAddr = sf.address() as { port: number }
        try {
          const sfR = await fetchBalance('https://api.siliconflow.cn', 'sk-sf-ok-1234567890', {
            siliconflow: `http://127.0.0.1:${sfAddr.port}/v1/user/info`
          })
          assert(sfR.ok === true && sfR.balance === 88.5 && sfR.currency === 'CNY', `siliconflow 余额解析错误：${JSON.stringify(sfR)}`)
        } finally {
          sf.close()
        }

        const unsupported = await fetchBalance('https://relay.example-visual.com', 'sk-x-1234567890')
        assert(unsupported.ok === false, '不支持的厂商应返回失败而非发起请求')
      } finally {
        ds.close()
      }
    })

    await step('深链解析：合法链接往返 + 恶意参数拒绝 + 永不携带 Key', async () => {
      const link = buildProviderDeeplink({
        tool: 'claude',
        name: '示例供应商',
        baseUrl: 'https://api.example-link.com',
        model: 'glm-4.6',
        keyType: 'auth_token'
      })
      assert(findDeeplinkInArgv(['x', link, 'y']) === link, 'argv 中应能找到 ccsl:// 链接')
      const parsed = parseProviderDeeplink(link)
      assert(parsed.ok === true && !!parsed.input, `合法链接应解析成功：${parsed.error}`)
      assert(parsed.input!.tool === 'claude' && parsed.input!.baseUrl === 'https://api.example-link.com', '字段应往返一致')
      assert(!('apiKey' in (parsed.input as object)) || (parsed.input as { apiKey?: string }).apiKey === '', '深链输入不得携带 Key')

      const bad1 = parseProviderDeeplink('ccsl://provider/add?tool=claude&name=X&url=javascript:alert(1)')
      assert(!bad1.ok, 'javascript: url 必须拒绝')
      const bad2 = parseProviderDeeplink('ccsl://provider/add?tool=claude&name=X&url=https://ok.com&keyType=weird')
      assert(!bad2.ok, '非法 keyType 必须拒绝')
      const bad3 = parseProviderDeeplink('ccsl://other/cmd?tool=claude')
      assert(!bad3.ok, '未知命令必须拒绝')
      const bad4 = parseProviderDeeplink('https://evil.com/provider/add?tool=claude&name=X&url=https://a.com')
      assert(!bad4.ok, '非 ccsl 协议必须拒绝')
      const longUrl = `https://${'a'.repeat(2100)}.com`
      const bad5 = parseProviderDeeplink(`ccsl://provider/add?tool=claude&name=X&url=${encodeURIComponent(longUrl)}`)
      assert(!bad5.ok, '超长 url 必须拒绝')
    })

    await step('会话阅读器：列出/读取会话 + 路径穿越拒绝', async () => {
      const list = await listSessions('claude')
      assert(list.some((s) => s.file.includes('session-1.jsonl')), '用量夹具的 session-1.jsonl 应被列出')
      const target = list.find((s) => s.file.includes('session-1.jsonl'))
      assert(!!target, '目标会话应存在')
      const page = await readSession('claude', target!.file)
      const user = page.entries.find((e) => e.role === 'user')
      assert(!!user && user.text.includes('hi'), `user 文本应被解析，实际 ${JSON.stringify(page.entries.slice(0, 2))}`)
      const asst = page.entries.find((e) => e.role === 'assistant')
      assert(!!asst, 'assistant 文本应被解析')
      // Codex 会话
      const cx = await listSessions('codex')
      const cxTarget = cx.find((s) => s.file.includes('rollout-test.jsonl'))
      assert(!!cxTarget, 'codex 会话应被列出')
      const cxPage = await readSession('codex', cxTarget!.file)
      assert(cxPage.entries.length >= 2, `codex 消息应被解析，实际 ${cxPage.entries.length}`)
      // 路径穿越拒绝
      let rejected = false
      try {
        await readSession('claude', path.join(home, '.claude', 'settings.json'))
      } catch {
        rejected = true
      }
      assert(rejected, '会话根目录之外的文件必须拒绝')
      let rejected2 = false
      try {
        await readSession('claude', path.join(home, '.claude', 'projects', 'proj-x', '..', '..', '..', 'settings.json'))
      } catch {
        rejected2 = true
      }
      assert(rejected2, '带 .. 的路径必须拒绝')
    })

    await step('会话导出：Markdown 构建包含角色与正文（v0.8.8）', async () => {
      const list = await listSessions('claude')
      const target = list.find((s) => s.file.includes('session-1.jsonl'))
      assert(!!target, '目标会话应存在')
      const page = await readSession('claude', target!.file)
      const md = buildSessionMarkdown({ tool: 'claude', project: target!.project, id: target!.id }, page)
      assert(md.includes('# 会话'), '标题应包含会话 id')
      assert(md.includes('🙋 用户') && md.includes('hi'), '用户条目应在导出中')
      assert(md.includes('🤖 助手'), '助手条目应在导出中')
    })

    await step('余额持久化：合法结果入库、非法结果拒绝、加载时形状校验（v0.8.8）', async () => {
      const s = loadStore()
      const target = s.providers.find((p) => p.tool === 'claude')
      assert(!!target, '应有 claude 供应商')
      await recordBalance(target!.id, { ok: true, balance: 12.34, currency: 'CNY', checkedAt: Date.now() })
      const reloaded = loadStore()
      const withBalance = reloaded.providers.find((p) => p.id === target!.id)
      assert(withBalance?.lastBalance?.ok === true && withBalance.lastBalance.balance === 12.34, '余额应持久化')
      // 非法形状拒绝
      let rejected = false
      try {
        await recordBalance(target!.id, { ok: 'yes' as never, balance: 1, checkedAt: Date.now() })
      } catch {
        rejected = true
      }
      assert(rejected, '非法 ok 类型应拒绝')
      let rejected2 = false
      try {
        await recordBalance('nonexistent-id', { ok: true, balance: 1, checkedAt: Date.now() })
      } catch {
        rejected2 = true
      }
      assert(rejected2, '不存在的供应商应拒绝')
      // 加载防线：手改损坏的 lastBalance 被丢弃
      const raw = JSON.parse(await fsp.readFile(storeFile(), 'utf8')) as { providers: { id: string; lastBalance?: unknown }[] }
      const rec = raw.providers.find((p) => p.id === target!.id)
      rec!.lastBalance = { ok: 'hacked', balance: 'x' }
      await fsp.writeFile(storeFile(), JSON.stringify(raw), 'utf8')
      const reloaded2 = loadStore()
      assert(reloaded2.providers.find((p) => p.id === target!.id)?.lastBalance === undefined, '损坏的 lastBalance 应被丢弃')
    })

    await step('版本比较：compareVersions 语义（v0.8.8）', async () => {
      assert(compareVersions('1.2.3', '1.2.3') === 0, '相等版本应为 0')
      assert(compareVersions('1.2.3', '1.2.10') < 0, '1.2.3 < 1.2.10')
      assert(compareVersions('2.0.0', '1.9.9') > 0, '2.0.0 > 1.9.9')
      assert(compareVersions('1.0.0-beta', '1.0.0') <= 0, '带后缀的串按数字主版本比较')
      assert(compareVersions('not-a-version', '1.0.0') < 0, '解析失败按 0 处理')
    })

    await step('MCP 管理：claude.json 手术编辑 + codex TOML 段 + 删除 + 非法名拒绝', async () => {
      // claude：预置一个带其它键的 ~/.claude.json，验证手术式只改 mcpServers
      const claudeJson = path.join(home, '.claude.json')
      await fsp.writeFile(claudeJson, JSON.stringify({ existing: 'keep', mcpServers: {} }), 'utf8')
      await mcpSave('claude', { name: 'fetch', command: 'npx', args: ['-y', 'mcp-server-fetch'], env: { TOKEN: 'abc' } })
      const after = JSON.parse(await fsp.readFile(claudeJson, 'utf8')) as Record<string, unknown>
      assert(after.existing === 'keep', 'claude.json 其它键必须保留')
      const serversC = (after.mcpServers as Record<string, Record<string, unknown>>).fetch
      const envC = serversC.env as Record<string, string> | undefined
      assert(
        serversC.command === 'npx' &&
          JSON.stringify(serversC.args) === JSON.stringify(['-y', 'mcp-server-fetch']) &&
          !!envC &&
          envC.TOKEN === 'abc',
        'claude MCP 字段应写入'
      )
      const listC = await mcpList('claude')
      assert(listC.servers.some((s) => s.name === 'fetch'), 'claude MCP 列表应含 fetch')
      // codex：TOML 段
      await mcpSave('codex', { name: 'fetch', command: 'uvx', args: ['mcp-server-fetch'], env: {} })
      const tomlText = await fsp.readFile(path.join(home, '.codex', 'config.toml'), 'utf8')
      assert(tomlText.includes('[mcp_servers.fetch]'), 'codex MCP 段应写入')
      assert(tomlText.includes('[profile.fast]'), 'codex 用户段必须保留')
      const listX = await mcpList('codex')
      assert(listX.servers[0]?.command === 'uvx', `codex MCP 列表应读回，实际 ${JSON.stringify(listX.servers)}`)
      // 覆盖保存 + 删除
      await mcpSave('codex', { name: 'fetch', command: 'node', args: [], env: {} })
      const listX2 = await mcpList('codex')
      assert(listX2.servers.length === 1 && listX2.servers[0].command === 'node', '覆盖保存应替换而非重复')
      await mcpDelete('claude', 'fetch')
      await mcpDelete('codex', 'fetch')
      assert((await mcpList('claude')).servers.length === 0, 'claude 删除后应为空')
      assert((await mcpList('codex')).servers.length === 0, 'codex 删除后应为空')
      // 非法名拒绝
      let rejected = false
      try {
        await mcpSave('claude', { name: 'bad name;x', command: 'npx', args: [], env: {} })
      } catch {
        rejected = true
      }
      assert(rejected, '非法 MCP 名称必须拒绝')
    })

    await step('提示词库：保存/应用写 CLAUDE.md（带备份）/导入/删除 + 加载防线（v0.8.9）', async () => {
      const created = await savePrompt({ tool: 'claude', name: '自测提示词', content: '# 规则\n\n始终用中文回复。' })
      assert((await listPrompts()).some((p) => p.id === created.id), '保存后应可列出')
      // 应用 → 写 ~/.claude/CLAUDE.md（夹具 home）
      await applyPrompt(created.id)
      const claudeMd = path.join(home, '.claude', 'CLAUDE.md')
      assert(fs.existsSync(claudeMd), '应用后 CLAUDE.md 应存在')
      const written = await fsp.readFile(claudeMd, 'utf8')
      assert(written.includes('始终用中文回复'), '应用内容应写入文件')
      const baks = (await fsp.readdir(path.join(home, '.claude'))).filter((f) => f.startsWith('CLAUDE.md.bak-'))
      assert(baks.length === 0, '首次应用（此前无文件）不产生备份')
      // 二次应用：旧文件应先备份
      await savePrompt({ tool: 'claude', name: '提示词B', content: '# 规则B' })
      const b = (await listPrompts()).find((p) => p.name === '提示词B')!
      await applyPrompt(b.id)
      const baks2 = (await fsp.readdir(path.join(home, '.claude'))).filter((f) => f.startsWith('CLAUDE.md.bak-'))
      assert(baks2.length === 1, `二次应用应备份旧文件，实际 ${baks2.length}`)
      // 当前文件状态 + 导入
      const cur = await currentPromptFiles()
      assert(cur.claude.exists && cur.claude.content.includes('规则B'), '当前文件状态应反映已应用内容')
      const imported = await importCurrentPrompt('claude')
      assert(imported.content.includes('规则B'), '导入当前文件应得到已应用内容')
      // 加载防线：坏条目被丢弃
      const raw = JSON.parse(await fsp.readFile(storeFile(), 'utf8')) as { prompts?: unknown[] }
      raw.prompts = [...(raw.prompts ?? []), { id: 'badp', tool: 'nope', name: 'x', content: 'y' }]
      await fsp.writeFile(storeFile(), JSON.stringify(raw), 'utf8')
      const reloaded = loadStore()
      assert((reloaded.prompts ?? []).every((p) => p.id !== 'badp'), '非法工具类型的提示词应被丢弃')
      assert((reloaded.prompts ?? []).some((p) => p.id === imported.id), '合法条目应保留')
      // 删除
      await deletePrompt(created.id)
      await deletePrompt(b.id)
      await deletePrompt(imported.id)
      assert((await listPrompts()).length === 0, '全部删除后应为空')
    })

    await step('方案组：保存/应用（写两工具配置）/缺失成员跳过/删除（v0.8.9）', async () => {
      const s = loadStore()
      const paC = s.providers.find((p) => p.tool === 'claude')
      const pcC = s.providers.find((p) => p.tool === 'codex')
      assert(!!paC && !!pcC, '夹具应有 claude 与 codex 供应商')
      const g = await saveGroup({ name: '自测组合', members: { claude: paC!.id, codex: pcC!.id } })
      assert((await listGroups()).some((x) => x.id === g.id), '保存后应可列出')
      // 先把 current 挪开，保证应用会真实切换（重新加载：saveGroup 已写库，旧快照会覆盖掉它）
      const sNow = loadStore()
      sNow.current.claude = null
      sNow.current.codex = null
      await saveStore(sNow)
      const r = await applyGroup(g.id)
      assert(r.switched.includes('claude') && r.switched.includes('codex'), `两个工具都应切换：${JSON.stringify(r)}`)
      assert(r.skipped.length === 0, '成员存在时不应有跳过')
      const s2 = loadStore()
      assert(s2.current.claude === paC!.id && s2.current.codex === pcC!.id, '应用后 current 应指向方案组成员')
      // 缺失成员：指向不存在的 id → 跳过不算错误
      const g2 = await saveGroup({ name: '缺失成员组合', members: { claude: 'ghost-id', codex: null } })
      const r2 = await applyGroup(g2.id)
      assert(!r2.switched.includes('claude') && r2.skipped.length === 1, `缺失成员应跳过：${JSON.stringify(r2)}`)
      assert(r2.switched.includes('codex'), 'null 成员应恢复官方并计入切换')
      // 加载防线 + 删除
      const raw = JSON.parse(await fsp.readFile(storeFile(), 'utf8')) as { groups?: unknown[] }
      raw.groups = [...(raw.groups ?? []), { id: 'badg', name: '', members: null }]
      await fsp.writeFile(storeFile(), JSON.stringify(raw), 'utf8')
      const reloaded = loadStore()
      assert((reloaded.groups ?? []).every((x) => x.id !== 'badg'), '坏方案组应被丢弃')
      await deleteGroup(g.id)
      await deleteGroup(g2.id)
      assert((await listGroups()).length === 0, '全部删除后应为空')
    })

    await step('主密码加密：整文件加密/锁定/解锁/解除', async () => {
      const s = loadStore()
      assert(s.providers.length > 0, '加密前库应有数据')
      await setMasterPassword('selftest-master-123')
      const raw = await fsp.readFile(storeFile(), 'utf8')
      assert(!raw.includes('sk-test-a-1234567890abcd'), '加密文件不得含明文 Key')
      assert(!raw.trimStart().startsWith('{'), '加密文件不应是明文 JSON')
      // 模拟重启（清内存密钥）→ 锁定
      lockForTest()
      let locked = false
      try {
        loadStore()
      } catch (e) {
        locked = (e as Error).message === 'LOCKED'
      }
      assert(locked, '解锁前 loadStore 应抛 LOCKED')
      assert(unlockMaster('wrong-pass-9999') === false, '错误口令应解锁失败')
      assert(unlockMaster('selftest-master-123') === true, '正确口令应解锁成功')
      const s2 = loadStore()
      assert(s2.providers.length === s.providers.length, '解锁后数据应完整')
      assert(s2.providers.some((p) => p.apiKey === 'sk-test-a-1234567890abcd'), '解锁后 Key 应可用')
      // 解除加密
      let wrongClear = false
      try {
        await clearMasterPassword('wrong-pass-9999')
      } catch {
        wrongClear = true
      }
      assert(wrongClear, '解除时错误口令应失败')
      await clearMasterPassword('selftest-master-123')
      const raw2 = await fsp.readFile(storeFile(), 'utf8')
      assert(raw2.trimStart().startsWith('{'), '解除后应恢复明文 JSON')
      assert(raw2.includes('sk-test-a-1234567890abcd'), '解除后明文 Key 应回来')
    })

    await step('一键清空：数据文件被删、库回到空态（配置恢复在各自步骤已覆盖）', async () => {
      // 诊断：记录清空前的现场（主密码步骤应已恢复明文且删除 master.json）
      const diagHead = (await fsp.readFile(storeFile(), 'utf8').catch(() => '(no file)')).slice(0, 20)
      const diagMaster = fs.existsSync(path.join(path.dirname(storeFile()), 'master.json'))
      assert(!diagMaster, `清空前 master.json 应已删除（库文件头：${diagHead}）`)
      const s = loadStore()
      assert(s.providers.length > 0, '清空前库应有数据')
      const r = await clearAppData()
      assert(r.removed.includes('providers.json'), 'providers.json 应被删除')
      const reloaded = loadStore()
      assert(reloaded.providers.length === 0, '清空后库应为空')
      assert(reloaded.current.claude === null && reloaded.current.codex === null, '清空后当前选择应为空')
    })

    await step('损坏隔离：providers.json 非法 JSON 被改名隔离而非静默待覆盖（v0.8.7 审查修复 #4）', async () => {
      await fsp.writeFile(storeFile(), '{corrupted!!', 'utf8')
      const s = loadStore()
      assert(s.providers.length === 0, '损坏库应回退空库')
      const dirEntries = await fsp.readdir(path.dirname(storeFile()))
      const quarantined = dirEntries.filter((f) => f.startsWith('providers.json.corrupt-'))
      assert(quarantined.length === 1, `损坏文件应被隔离保留一份，实际 ${JSON.stringify(quarantined)}`)
      if (quarantined[0]) {
        const kept = await fsp.readFile(path.join(path.dirname(storeFile()), quarantined[0]), 'utf8')
        assert(kept === '{corrupted!!', '隔离文件内容应与损坏原文一致（可人工抢救）')
        await fsp.rm(path.join(path.dirname(storeFile()), quarantined[0]), { force: true })
      }
      assert(!fs.existsSync(storeFile()), '原路径不应再有 providers.json（等下次保存生成干净文件）')
    })
  }

  const report = { ok: allPass(), checks, platform: process.platform, electron: process.versions.electron }
  await fsp.mkdir(path.dirname(out), { recursive: true })
  await fsp.writeFile(out, JSON.stringify(report, null, 2), 'utf8')
  app.exit(allPass() ? 0 : 1)
}
