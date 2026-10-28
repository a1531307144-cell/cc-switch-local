#!/usr/bin/env node
/**
 * 从 simple-icons（CC0）拷贝厂商图标到渲染层资产目录，并注入品牌色。
 * 只拷贝 src/shared/vendors.ts 里声明了 icon 的厂商；新增厂商时在下面 VENDORS 里加一行。
 * 运行：node scripts/copy-vendor-icons.mjs（需先 npm i -D simple-icons）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'node_modules', 'simple-icons', 'icons')
const outDir = path.join(root, 'src', 'renderer', 'src', 'assets', 'vendors')

// slug（simple-icons 文件名）→ 输出文件名 + 品牌色（选在浅/深背景下都可辨的色值）
const VENDORS = [
  { slug: 'deepseek', out: 'deepseek', fill: '#5786FE' },
  { slug: 'anthropic', out: 'anthropic', fill: '#D97757' },
  { slug: 'moonshotai', out: 'moonshotai', fill: '#6B7280' },
  { slug: 'qwen', out: 'qwen', fill: '#6950EF' },
  { slug: 'openrouter', out: 'openrouter', fill: '#94A3B8' },
  { slug: 'ollama', out: 'ollama', fill: '#94A3B8' }
]

fs.mkdirSync(outDir, { recursive: true })
let copied = 0
for (const v of VENDORS) {
  const src = path.join(srcDir, `${v.slug}.svg`)
  if (!fs.existsSync(src)) {
    console.error(`✗ simple-icons 中不存在 ${v.slug}.svg（simple-icons 版本变化？）`)
    process.exit(1)
  }
  let svg = fs.readFileSync(src, 'utf8')
  if (!svg.includes('<svg ')) {
    console.error(`✗ ${v.slug}.svg 格式异常（无 <svg> 标签）`)
    process.exit(1)
  }
  svg = svg.replace('<svg ', `<svg fill="${v.fill}" `)
  fs.writeFileSync(path.join(outDir, `${v.out}.svg`), svg)
  copied += 1
  console.log(`✓ ${v.slug}.svg → assets/vendors/${v.out}.svg (fill ${v.fill})`)
}
console.log(`完成：${copied} 个厂商图标。`)
