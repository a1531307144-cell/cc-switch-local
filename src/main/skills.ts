import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { net } from 'electron'
import { homeDir } from './claude'
import type { SkillInfo, ToolId } from '../shared/types'

/**
 * Skills 管理（v0.8.10）：安装/更新/删除 Claude Code（~/.claude/skills）与
 * Codex（~/.codex/skills）的 Agent Skills（目录含 SKILL.md，Anthropic/OpenAI 通用格式）。
 *
 * 安装来源：GitHub 仓库 zip（codeload）或本地 zip 文件（设置页对话框选择）。
 * 解压用系统自带 bsdtar（Windows 10+ 自带，默认拒绝绝对路径与 .. 穿越条目）；
 * 拷贝进 skills 目录时跳过符号链接，杜绝 zip 越界写。
 * skills.sh 市场搜索未提供公开 API，不做（不瞎加端点）。
 */

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const MAX_ZIP_BYTES = 100 * 1024 * 1024
const MAX_SKILL_FILES = 500
const MAX_SKILL_BYTES = 30 * 1024 * 1024
const SCAN_DEPTH = 3

export function skillsRoot(tool: ToolId): string {
  return tool === 'claude' ? path.join(homeDir(), '.claude', 'skills') : path.join(homeDir(), '.codex', 'skills')
}

function assertTool(tool: ToolId): void {
  if (!(tool === 'claude' || tool === 'codex')) throw new Error('非法的工具类型')
}

function assertSkillName(name: string): void {
  if (typeof name !== 'string' || !NAME_RE.test(name)) throw new Error('非法的 skill 名称')
}

function tarExe(): string {
  // 优先 System32 的 bsdtar（支持 zip）；PATH 里的可能是 Git Bash 的 GNU tar（不认 zip，且把 C: 当远程主机）
  if (process.platform === 'win32') {
    const p = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    if (fs.existsSync(p)) return p
  }
  return 'tar'
}

async function runTar(args: string[]): Promise<void> {
  const tar = tarExe()
  await new Promise<void>((resolve, reject) => {
    // 数组式 spawn（无 shell）：路径原样传递，杜绝 zip 文件名中的引号/特殊字符构造命令（v0.8.11 加固）
    const child = spawn(tar, args, { windowsHide: true, cwd: os.tmpdir() })
    let stderr = ''
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('解压超时'))
    }, 60_000)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new Error(`解压进程启动失败：${(e as Error).message}（需要系统自带 tar）`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`解压失败（退出码 ${code}）：${stderr.slice(-200)}`))
    })
  })
}

/** 解析 SKILL.md 头部 frontmatter 的 name/description（容错：无 frontmatter 返回空） */
export function parseFrontmatter(raw: string): { name: string; description: string } {
  if (!raw.startsWith('---')) return { name: '', description: '' }
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return { name: '', description: '' }
  const head = raw.slice(3, end)
  let name = ''
  let description = ''
  for (const line of head.split('\n')) {
    const m = line.match(/^(name|description)\s*:\s*(.*)$/)
    if (!m) continue
    const v = m[2].trim().replace(/^["']|["']$/g, '')
    if (m[1] === 'name') name = v
    else description = v
  }
  return { name, description }
}

async function dirStats(dir: string, depth: number): Promise<{ files: number; bytes: number }> {
  if (depth > 6) return { files: 0, bytes: 0 }
  let files = 0
  let bytes = 0
  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return { files, bytes }
  }
  for (const e of entries) {
    if (e.isSymbolicLink()) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) {
      const sub = await dirStats(full, depth + 1)
      files += sub.files
      bytes += sub.bytes
    } else if (e.isFile()) {
      files++
      try {
        bytes += (await fsp.stat(full)).size
      } catch {
        /* 忽略 */
      }
    }
    if (files > MAX_SKILL_FILES) break
  }
  return { files, bytes }
}

export async function listSkills(tool: ToolId): Promise<SkillInfo[]> {
  assertTool(tool)
  const root = skillsRoot(tool)
  let entries: fs.Dirent[]
  try {
    entries = await fsp.readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const out: SkillInfo[] = []
  for (const e of entries) {
    if (!e.isDirectory() || e.isSymbolicLink() || e.name.startsWith('.')) continue
    const skillMd = path.join(root, e.name, 'SKILL.md')
    let raw: string
    try {
      raw = await fsp.readFile(skillMd, 'utf8')
    } catch {
      continue // 无 SKILL.md 的目录不是 skill
    }
    const fm = parseFrontmatter(raw)
    const st = await dirStats(path.join(root, e.name), 0)
    let source: SkillInfo['source']
    try {
      const s = JSON.parse(await fsp.readFile(path.join(root, e.name, '.ccsl-source.json'), 'utf8')) as {
        repo?: unknown
        ref?: unknown
        installedAt?: unknown
      }
      if (typeof s.repo === 'string' && s.repo) {
        source = {
          repo: s.repo,
          ...(typeof s.ref === 'string' ? { ref: s.ref } : {}),
          installedAt: typeof s.installedAt === 'number' && Number.isFinite(s.installedAt) ? s.installedAt : Date.now()
        }
      }
    } catch {
      /* 无来源标记：本地手动安装 */
    }
    out.push({
      tool,
      name: e.name,
      description: fm.description,
      path: path.join(root, e.name),
      fileCount: st.files,
      size: st.bytes,
      ...(source ? { source } : {})
    })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export async function readSkill(tool: ToolId, name: string): Promise<{ content: string }> {
  assertTool(tool)
  assertSkillName(name)
  const file = path.join(skillsRoot(tool), name, 'SKILL.md')
  const raw = await fsp.readFile(file, 'utf8')
  return { content: raw.length > 200_000 ? raw.slice(0, 200_000) + '\n…（截断）' : raw }
}

export async function deleteSkill(tool: ToolId, name: string): Promise<boolean> {
  assertTool(tool)
  assertSkillName(name)
  const dir = path.join(skillsRoot(tool), name)
  const resolved = path.resolve(dir)
  if (!resolved.startsWith(path.resolve(skillsRoot(tool)) + path.sep)) throw new Error('非法的 skill 路径')
  if (!fs.existsSync(resolved)) return false
  await fsp.rm(resolved, { recursive: true, force: true })
  return true
}

/** 从解压后的临时目录里找出 skill 目录（根有 SKILL.md 视为单 skill；否则搜 ≤3 层的 SKILL.md） */
async function findSkillDirs(extracted: string): Promise<string[]> {
  const rootMd = path.join(extracted, 'SKILL.md')
  if (fs.existsSync(rootMd)) return [extracted]
  const found: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > SCAN_DEPTH || found.length >= 50) return
    let entries: fs.Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.isSymbolicLink()) continue
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue
      const full = path.join(dir, e.name)
      if (!e.isDirectory()) continue
      if (fs.existsSync(path.join(full, 'SKILL.md'))) found.push(full)
      else await walk(full, depth + 1)
    }
  }
  await walk(extracted, 0)
  return found
}

async function copySkillDir(src: string, root: string, taken: Set<string>, source?: SkillInfo['source']): Promise<string> {
  const st = await dirStats(src, 0)
  if (st.files > MAX_SKILL_FILES || st.bytes > MAX_SKILL_BYTES) {
    throw new Error(`skill 体积超限（文件 ${st.files}/大小 ${st.bytes}）`)
  }
  const fm = parseFrontmatter(await fsp.readFile(path.join(src, 'SKILL.md'), 'utf8'))
  const folder = path.basename(src)
  const base = NAME_RE.test(fm.name) ? fm.name : NAME_RE.test(folder) ? folder : `skill-${Date.now()}`
  let name = base
  let i = 2
  while (taken.has(name)) name = `${base}-${i++}`
  const dest = path.join(root, name)
  await fsp.rm(dest, { recursive: true, force: true })
  await fsp.mkdir(dest, { recursive: true })
  await fsp.cp(src, dest, {
    recursive: true,
    filter: (s) => {
      try {
        return !fs.lstatSync(s).isSymbolicLink()
      } catch {
        return false
      }
    }
  })
  if (source) {
    await fsp.writeFile(path.join(dest, '.ccsl-source.json'), JSON.stringify(source, null, 2), 'utf8')
  }
  return name
}

/** 安装一个 zip（GitHub 下载的临时文件或用户选择的本地文件） */
async function installZip(tool: ToolId, zipPath: string, source?: SkillInfo['source']): Promise<{ installed: string[]; skipped: string[] }> {
  assertTool(tool)
  const root = skillsRoot(tool)
  await fsp.mkdir(root, { recursive: true })
  const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'ccsl-skill-'))
  try {
    await runTar(['-xf', zipPath, '-C', temp])
    const candidates = await findSkillDirs(temp)
    if (candidates.length === 0) {
      throw new Error('压缩包里没有找到 SKILL.md（skill 需为含 SKILL.md 的目录）')
    }
    const installed: string[] = []
    const skipped: string[] = []
    const taken = new Set<string>()
    for (const dir of candidates) {
      try {
        installed.push(await copySkillDir(dir, root, taken, source))
      } catch (e) {
        skipped.push(`${path.basename(dir)}：${(e as Error).message}`)
      }
    }
    return { installed, skipped }
  } finally {
    await fsp.rm(temp, { recursive: true, force: true }).catch(() => {})
  }
}

/** GitHub 仓库安装：github.com/owner/repo[/tree/branch[/subpath]]（zipUrlOverride 仅供自测指向本地 mock） */
export async function installFromGithub(
  tool: ToolId,
  url: string,
  opts?: { zipUrlOverride?: string }
): Promise<{ installed: string[]; skipped: string[] }> {
  assertTool(tool)
  if (typeof url !== 'string' || url.length > 500) throw new Error('非法的仓库地址')
  const m = url.trim().replace(/\.git$/, '').match(/^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)(?:\/tree\/([^/\s]+)((?:\/[\w.-]+)*))?$/i)
  if (!m) throw new Error('仅支持 github.com 仓库地址：…/owner/repo 或 …/owner/repo/tree/分支[/子目录]')
  const owner = m[1]
  const repo = m[2]
  const branch = m[3] ?? ''
  const ref = branch || 'main'
  const zipUrl =
    opts?.zipUrlOverride ??
    `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${ref}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)
  let buf: ArrayBuffer
  try {
    const res = await net.fetch(zipUrl, { signal: controller.signal, redirect: 'follow' } as RequestInit)
    if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）：请确认仓库与分支（${ref}）存在`)
    buf = await res.arrayBuffer()
  } catch (e) {
    if (branch === '' && String((e as Error).message).includes('HTTP 404')) {
      // main 不存在时回退 master
      return installFromGithub(tool, `${url}/tree/master`, opts)
    }
    throw new Error(`下载失败：${(e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }
  if (buf.byteLength > MAX_ZIP_BYTES) throw new Error('仓库压缩包超过 100MB 上限')
  const tempZip = path.join(os.tmpdir(), `ccsl-skill-${Date.now()}.zip`)
  await fsp.writeFile(tempZip, Buffer.from(buf))
  try {
    return await installZip(tool, tempZip, { repo: `${owner}/${repo}`, ref, installedAt: Date.now() })
  } finally {
    await fsp.rm(tempZip, { force: true }).catch(() => {})
  }
}

export async function installFromLocalZip(tool: ToolId, filePath: string): Promise<{ installed: string[]; skipped: string[] }> {
  if (typeof filePath !== 'string' || !filePath || filePath.length > 500) throw new Error('非法的文件路径')
  const st = await fsp.stat(filePath).catch(() => null)
  if (!st || !st.isFile()) throw new Error('zip 文件不存在')
  if (st.size > MAX_ZIP_BYTES) throw new Error('zip 超过 100MB 上限')
  return installZip(tool, filePath)
}

/** 更新单个 skill：按记录的来源重新安装 */
export async function updateSkill(tool: ToolId, name: string): Promise<{ installed: string[] }> {
  assertTool(tool)
  assertSkillName(name)
  const list = await listSkills(tool)
  const skill = list.find((s) => s.name === name)
  if (!skill) throw new Error('skill 不存在')
  if (!skill.source) throw new Error('该 skill 没有 GitHub 来源记录（本地手动安装的请重新安装）')
  const r = await installFromGithub(tool, `https://github.com/${skill.source.repo}/tree/${skill.source.ref ?? 'main'}`)
  return { installed: r.installed }
}

export async function updateAllSkills(tool: ToolId): Promise<{ installed: string[]; failed: string[] }> {
  assertTool(tool)
  const list = (await listSkills(tool)).filter((s) => s.source)
  const installed: string[] = []
  const failed: string[] = []
  for (const s of list) {
    try {
      const r = await installFromGithub(tool, `https://github.com/${s.source!.repo}/tree/${s.source!.ref ?? 'main'}`)
      installed.push(...r.installed)
    } catch (e) {
      failed.push(`${s.name}：${(e as Error).message}`)
    }
  }
  return { installed, failed }
}

/** 供 IPC 的本地 ZIP 安装：弹文件对话框 */
export async function installFromZipDialog(tool: ToolId): Promise<{ installed: string[]; skipped: string[]; canceled?: boolean }> {
  const { dialog } = await import('electron')
  const r = await dialog.showOpenDialog({
    title: '安装 Skill（zip）',
    filters: [{ name: 'Skill 压缩包', extensions: ['zip'] }],
    properties: ['openFile']
  })
  if (r.canceled || !r.filePaths[0]) return { installed: [], skipped: [], canceled: true }
  return installFromLocalZip(tool, r.filePaths[0])
}
