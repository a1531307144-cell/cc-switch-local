import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import type { AgentVersionInfo, ToolId } from '../shared/types'

/**
 * CLI 工具版本管理（v0.8.8）：检测 Claude Code / Codex 的已装版本与 npm 最新版，
 * npm 全局安装的可一键升级。纯本机操作，不涉及任何供应商数据。
 *
 * 关键约束：打包后的 GUI 进程 PATH 可能缺 node 相关目录——npm 逐个候选位置探测并缓存；
 * Windows 上 spawn .cmd 需要 shell（Node ≥18.20 的 EINVAL 限制），所有命令串均为
 * 常量拼接（不含任何用户输入），无注入面。
 */

const PACKAGES: Record<ToolId, string> = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex'
}
const BINS: Record<ToolId, string> = { claude: 'claude', codex: 'codex' }
const RUN_TIMEOUT_MS = 20_000
const UPGRADE_TIMEOUT_MS = 15 * 60_000

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
}

function runCmd(command: string, timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let settled = false
    const done = (r: RunResult): void => {
      if (!settled) {
        settled = true
        resolve(r)
      }
    }
    try {
      // cwd 固定为中性目录：避免 shell 解析 `npm` 时命中项目内 node_modules 的坏 shim
      const child = spawn(command, { shell: true, windowsHide: true, cwd: os.tmpdir() })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill()
        done({ code: null, stdout, stderr: stderr || 'timeout' })
      }, timeoutMs)
      child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
      child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
      child.on('error', (e) => {
        clearTimeout(timer)
        done({ code: null, stdout, stderr: stderr || String((e as Error).message) })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        done({ code, stdout, stderr })
      })
    } catch (e) {
      done({ code: null, stdout: '', stderr: String((e as Error).message) })
    }
  })
}

let npmCmdCache: { cmd: string | null; probed: boolean } = { cmd: null, probed: false }

/** 逐个候选位置探测 npm：官方安装位置优先（免疫 PATH 里的坏 shim），PATH 次之 */
export async function resolveNpmCmd(): Promise<string | null> {
  if (npmCmdCache.probed) return npmCmdCache.cmd
  const candidates: string[] = []
  if (process.platform === 'win32') {
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files'
    candidates.push(path.join(pf, 'nodejs', 'npm.cmd'))
    candidates.push('npm')
    const appData = process.env.APPDATA
    if (appData) candidates.push(path.join(appData, 'npm', 'npm.cmd'))
  } else {
    candidates.push('npm')
  }
  for (const c of candidates) {
    const r = await runCmd(/^[\w-]+$/.test(c) ? `${c} --version` : `"${c}" --version`, 10_000)
    if (r.code === 0 && /^\d/.test(r.stdout.trim())) {
      npmCmdCache = { cmd: c, probed: true }
      return c
    }
  }
  npmCmdCache = { cmd: null, probed: true }
  return null
}

export function resetNpmCacheForTest(): void {
  npmCmdCache = { cmd: null, probed: false }
}

function firstVersion(text: string): string | null {
  const m = text.match(/(\d+\.\d+(?:\.\d+)?(?:[-+][\w.]+)?)/)
  return m ? m[1] : null
}

/** PATH 上找 CLI 的可执行文件路径（判断 npm 全局安装 vs 原生安装） */
async function resolveBinPath(tool: ToolId): Promise<string | null> {
  const cmd = process.platform === 'win32' ? `where ${BINS[tool]}` : `which ${BINS[tool]}`
  const r = await runCmd(cmd, 10_000)
  if (r.code !== 0) return null
  const first = r.stdout.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
  return first ?? null
}

/** npm 全局目录特征：Windows 的 npm shim 目录 / unix 的 node_modules 全局路径 */
function isNpmManaged(binPath: string | null): boolean {
  if (!binPath) return false
  const p = binPath.toLowerCase()
  if (p.includes('node_modules') || p.includes('\\npm\\') || p.includes('/npm/')) return true
  if (process.platform === 'win32' && p.endsWith('.cmd') && p.includes('npm')) return true
  return false
}

export async function getAgentVersion(tool: ToolId): Promise<AgentVersionInfo> {
  const pkg = PACKAGES[tool]
  const base: AgentVersionInfo = { tool, pkg, installed: null, latest: null, npmFound: false, binPath: null, managed: false }
  const [binPath, npm] = await Promise.all([resolveBinPath(tool), resolveNpmCmd()])
  base.binPath = binPath
  base.managed = isNpmManaged(binPath)
  if (!npm) {
    base.error = 'npm 不可用（未安装 Node.js 或不在 PATH 中）'
    // npm 缺失时仍尝试读已装版本（CLI 自身 --version 不依赖 npm）
    const ver = await runCmd(`${BINS[tool]} --version`, RUN_TIMEOUT_MS)
    base.installed = firstVersion(ver.stdout)
    return base
  }
  base.npmFound = true
  const [ver, latest] = await Promise.all([
    runCmd(`${BINS[tool]} --version`, RUN_TIMEOUT_MS),
    runCmd(`"${npm}" view ${pkg} version`, RUN_TIMEOUT_MS)
  ])
  base.installed = firstVersion(ver.stdout)
  base.latest = firstVersion(latest.stdout)
  if (base.latest === null && latest.code !== 0) {
    base.error = (latest.stderr || '查询 npm registry 失败').slice(0, 300)
  }
  return base
}

export async function getAgentVersions(): Promise<{ claude: AgentVersionInfo; codex: AgentVersionInfo }> {
  const [claude, codex] = await Promise.all([getAgentVersion('claude'), getAgentVersion('codex')])
  return { claude, codex }
}

// ─── 一键升级（npm install -g <pkg>@latest，流式回传输出） ───

const upgrading = new Map<ToolId, { child: ReturnType<typeof spawn>; done: boolean }>()

export function isUpgrading(tool: ToolId): boolean {
  const u = upgrading.get(tool)
  return !!u && !u.done
}

export function cancelUpgrade(tool: ToolId): boolean {
  const u = upgrading.get(tool)
  if (u && !u.done) {
    u.child.kill()
    return true
  }
  return false
}

export async function upgradeAgent(
  tool: ToolId,
  onLine: (line: string) => void
): Promise<{ ok: boolean; message: string }> {
  if (!(tool === 'claude' || tool === 'codex')) return { ok: false, message: '非法的工具类型' }
  if (isUpgrading(tool)) return { ok: false, message: '该工具正在升级中' }
  const npm = await resolveNpmCmd()
  if (!npm) return { ok: false, message: 'npm 不可用（未安装 Node.js 或不在 PATH 中），无法自动升级' }
  const pkg = PACKAGES[tool]
  const quoted = /^[\w-]+$/.test(npm) ? npm : `"${npm}"`
  let stdoutBuf = ''
  let stderrBuf = ''

  try {
    const child = await new Promise<ReturnType<typeof spawn>>((resolve, reject) => {
      let c: ReturnType<typeof spawn>
      try {
        c = spawn(`${quoted} install -g ${pkg}@latest`, { shell: true, windowsHide: true, cwd: os.tmpdir() })
      } catch (e) {
        reject(e)
        return
      }
      upgrading.set(tool, { child: c, done: false })
      resolve(c)
    })

    const result = await new Promise<{ ok: boolean; message: string }>((resolve) => {
      const timer = setTimeout(() => {
        child.kill()
        resolve({ ok: false, message: '升级超时（15 分钟），已中止。请到终端手动执行 npm install -g' })
      }, UPGRADE_TIMEOUT_MS)
      child.stdout?.on('data', (d: Buffer) => {
        stdoutBuf += d.toString()
        for (const line of stdoutBuf.split(/\r?\n/).slice(0, -1)) onLine(line)
        stdoutBuf = stdoutBuf.slice(stdoutBuf.lastIndexOf('\n') + 1)
      })
      child.stderr?.on('data', (d: Buffer) => {
        stderrBuf += d.toString()
        for (const line of stderrBuf.split(/\r?\n/).slice(0, -1)) onLine(line)
        stderrBuf = stderrBuf.slice(stderrBuf.lastIndexOf('\n') + 1)
      })
      child.on('error', (e) => {
        clearTimeout(timer)
        resolve({ ok: false, message: `升级进程启动失败：${(e as Error).message}` })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve({ ok: true, message: '升级完成' })
        else resolve({ ok: false, message: `升级失败（退出码 ${code}）：${(stderrBuf || stdoutBuf).slice(-400)}` })
      })
    })
    const u = upgrading.get(tool)
    if (u) u.done = true
    upgrading.delete(tool)
    return result
  } catch (e) {
    upgrading.delete(tool)
    return { ok: false, message: `升级进程启动失败：${(e as Error).message}` }
  }
}
