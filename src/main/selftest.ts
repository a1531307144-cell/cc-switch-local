import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { loadStore, newId, saveStore, storeFile } from './store'
import * as claude from './claude'
import * as codex from './codex'
import { importFromCcSwitch } from './importer'

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

    await step('存储：写入三个供应商并持久化', async () => {
      store.providers.push(pa, pb, pc)
      await saveStore(store)
      const reloaded = loadStore()
      assert(reloaded.providers.length === 3, `应有 3 条，实际 ${reloaded.providers.length}`)
      return `存储文件：${storeFile()}`
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

    await step('Codex 切换 C：config.toml 写入 provider 段，auth.json 写入 Key', async () => {
      const r = await codex.switchCodex(pc)
      assert(r.files.length === 2, `应写 2 个文件，实际 ${r.files.length}`)
      const tomlText = await fsp.readFile(r.files[0], 'utf8')
      assert(tomlText.includes('base_url = "https://c.example.com/v1"'), 'base_url 未写入')
      assert(tomlText.includes('model_provider = "ccsl"'), 'model_provider 未写入')
      assert(tomlText.includes('model = "gpt-test"'), 'model 未写入')
      const auth = await readJson(r.files[1])
      assert(auth.OPENAI_API_KEY === pc.apiKey, 'OPENAI_API_KEY 未写入')
      return `备份：${r.backup}`
    })

    await step('Codex 恢复官方配置：provider 段被移除', async () => {
      await codex.switchCodex(null)
      const tomlText = await fsp.readFile(path.join(home, '.codex', 'config.toml'), 'utf8')
      assert(!tomlText.includes('model_provider = "ccsl"'), 'model_provider 应被移除')
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
    })

    await step('删除供应商：从存储中移除且不影响其它', async () => {
      const s = loadStore()
      s.providers = s.providers.filter((p) => p.id !== pb.id)
      await saveStore(s)
      const reloaded = loadStore()
      assert(reloaded.providers.length === 2, `应剩 2 条，实际 ${reloaded.providers.length}`)
      assert(reloaded.providers.every((p) => p.id !== pb.id), '供应商B 应被删除')
    })
  }

  const report = { ok: allPass(), checks, platform: process.platform, electron: process.versions.electron }
  await fsp.mkdir(path.dirname(out), { recursive: true })
  await fsp.writeFile(out, JSON.stringify(report, null, 2), 'utf8')
  app.exit(allPass() ? 0 : 1)
}
