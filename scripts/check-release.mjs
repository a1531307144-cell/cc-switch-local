#!/usr/bin/env node
/**
 * 发布/提交门禁：暂存内容白名单 + 隐私扫描。
 *
 * 背景（2026-10-28 教训）：git add -A 曾把 ZCode 会话计划文件（.zcode/plans）带进提交，
 * 仅有 grep 敏感词的扫描防不住"陌生文件混入"。本脚本三层防御：
 *   1) 暂存文件白名单——白名单外的文件一律拒绝（工具生成物、会话文件等）
 *   2) 敏感内容扫描——Windows 用户名 / GitHub 账号 / 绝对路径 / 各类 Key
 *   3) 本脚本由 scripts/githooks/pre-commit 钩子自动执行，也可手动运行
 *
 * 设计原则：本脚本会被提交到公开仓库，因此**仓库里不存任何敏感词**——
 * 用户名/GitHub 账号都在运行时从本机读取。
 *
 * 用法：
 *   node scripts/check-release.mjs            # 扫描当前暂存区
 *   node scripts/check-release.mjs --force    # 白名单外文件仅警告不拦截（内容扫描仍然生效）
 */
import { execSync } from 'node:child_process'
import os from 'node:os'
import process from 'node:process'

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' })
const force = process.argv.includes('--force')

// ---------- 1) 暂存文件白名单 ----------
const ALLOW = [
  /^src\//,
  /^docs\//,
  /^scripts\//,
  /^\.github\//,
  /^build\//,
  /^\.gitignore$/,
  /^README\.md$/,
  /^HANDOVER\.md$/,
  /^LICENSE$/,
  /^package\.json$/,
  /^package-lock\.json$/,
  /^electron-builder\.yml$/,
  /^electron\.vite\.config\.ts$/,
  /^tsconfig\.json$/
]

const staged = sh('git diff --cached --name-only')
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean)

const unexpected = staged.filter((f) => !ALLOW.some((re) => re.test(f)))
if (unexpected.length) {
  console.error('✗ 以下暂存文件不在白名单内（疑似工具生成物/会话文件混入）：')
  for (const f of unexpected) console.error('    ' + f)
  if (force) {
    console.error('  --force：已放行白名单检查，内容扫描继续。')
  } else {
    console.error('  若确认应提交，把它加进本脚本 ALLOW 白名单后再提交。')
    process.exit(1)
  }
}

// ---------- 2) 隐私扫描（运行时取本机身份，仓库内零敏感词） ----------
const username = (process.env.USERNAME || os.userInfo().username || '').toLowerCase()
let ghLogin = ''
try {
  ghLogin = sh('gh api user --jq .login').trim().toLowerCase()
} catch {
  /* gh 不可用/离线时跳过账号检查 */
}
// GitHub 账号作为公开仓库属主身份，只允许出现在这几处（package.json repository / HANDOVER 仓库地址 / 应用常量里的 Releases 链接）
const LOGIN_OK_FILES = new Set(['package.json', 'HANDOVER.md', 'src/shared/constants.ts'])
// selftest 里的 Key 是合成测试数据
const KEY_OK_FILES = new Set(['src/main/selftest.ts'])

const PATTERNS = [
  // Unix 风格路径要求前边界（行首/引号/空白/=），避免误报文档里的相对路径如 tmp-selftest/home/.codex（2026-10-30 实测）
  [/(^|["'\s=])\/(Users|home)\/[^\/\s"']+|C:\\\\Users\\\\[^"'\s\\]+/, '本机绝对路径'],
  [/gh[pousr]_[A-Za-z0-9]{10,}/, 'GitHub token'],
  [/AKIA[0-9A-Z]{16}/, 'AWS AccessKey'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '私钥'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token']
]

const problems = []

for (const file of staged) {
  let diff
  try {
    diff = sh(`git diff --cached --unified=0 -- "${file}"`)
  } catch {
    continue
  }
  // 完整账号形态（公开仓库属主身份）先剔除，剩余部分再查用户名子串——
  // 否则账号所在文件会被用户名扫描层永久误报（2026-10-29 constants.ts 实测）
  if (ghLogin && LOGIN_OK_FILES.has(file)) {
    diff = diff.split(ghLogin).join('[GH-LOGIN]')
  }
  const lower = diff.toLowerCase()

  if (username && lower.includes(username)) {
    problems.push(`[用户名] ${file}：包含本机 Windows 用户名 "${username}"`)
  }
  if (ghLogin && lower.includes(ghLogin) && !LOGIN_OK_FILES.has(file)) {
    problems.push(`[GitHub 账号] ${file}：包含账号（仅允许 package.json / HANDOVER.md / constants.ts）`)
  }
  for (const [re, label] of PATTERNS) {
    if (new RegExp(re.source, 'i').test(diff)) {
      problems.push(`[${label}] ${file}`)
    }
  }
  if (file === 'src/main/selftest.ts') continue
  if (/sk-[A-Za-z0-9_-]{18,}/i.test(diff)) {
    problems.push(`[API Key] ${file}：包含 sk- 长串（selftest.ts 内合成 Key 除外）`)
  }
}

if (problems.length) {
  console.error('✗ 隐私扫描未通过：')
  for (const p of problems) console.error('    ' + p)
  console.error('  处理原则：停下确认；确属预期的合成数据/属主身份，在脚本对应白名单中登记。')
  process.exit(1)
}

console.log(`✓ 门禁通过：${staged.length} 个暂存文件，白名单与隐私扫描均无异常。`)
