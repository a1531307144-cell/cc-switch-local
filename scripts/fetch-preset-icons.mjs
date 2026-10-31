#!/usr/bin/env node
/**
 * 从 farion1231/cc-switch（MIT License）的 src/icons/extracted/ 拉取预设图标，
 * 存到 src/renderer/src/assets/vendors/（<slug>.svg 优先，缺则 <slug>.png）。
 *
 * 用法：node scripts/fetch-preset-icons.mjs [slug1 slug2 ...]
 * 不带参数 = 按 src/main/presets-data.ts 里的 icon 字段抓取全部缺失的。
 * 通过 gh api 下载（对 raw.githubusercontent 更稳），产物提交进仓库，构建不联网。
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'src', 'renderer', 'src', 'assets', 'vendors')
const REPO = 'repos/farion1231/cc-switch/contents/src/icons/extracted'

const gh = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

// 1) 目标 slug 清单
let slugs
if (process.argv.length > 2) {
  slugs = process.argv.slice(2)
} else {
  const data = fs.readFileSync(path.join(root, 'src', 'main', 'presets-data.ts'), 'utf8')
  slugs = [...new Set([...data.matchAll(/icon: '([^']+)'/g)].map((m) => m[1]))]
}

// 2) 远端目录清单（name → base64 可用）
const remote = JSON.parse(gh(`gh api ${REPO} --paginate`))

let ok = 0
let skip = 0
let miss = []
for (const slug of slugs) {
  const candidates = [`${slug}.svg`, `${slug}.png`]
  const existing = candidates.find((f) => fs.existsSync(path.join(outDir, f)))
  if (existing) {
    skip++
    continue
  }
  const hit = remote.find((e) => candidates.includes(e.name))
  if (!hit) {
    miss.push(slug)
    continue
  }
  const buf = Buffer.from(gh(`gh api ${REPO}/${hit.name} --jq .content`), 'base64')
  fs.writeFileSync(path.join(outDir, hit.name), buf)
  ok++
  console.log(`✓ ${hit.name} (${(buf.length / 1024).toFixed(1)} KB)`)
}
console.log(`完成：新拉 ${ok}，已存在跳过 ${skip}，未找到 ${miss.length}${miss.length ? '：' + miss.join(', ') : ''}`)
