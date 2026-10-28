# HANDOVER —— 项目交接文档

> 本文档写给**下一个接手的 AI agent 或开发者**。读完这一篇，你应该能独立完成本项目的日常迭代、自测与发布。
> 项目所有者（用户）是编程新手：一切结论请写给"人能看懂"，重要决策先征求用户意见。
>
> **动手改代码前先读 `docs/code-review-2026-10-28.md`**（全面安全/正确性审查报告，含已修复缺陷清单与"审查过无需改动"的留档，避免重复排查）。

---

## 1. 这个项目是什么

**CC Switch Local**：本地优先的 AI 编码工具 API 供应商管理与一键切换桌面应用。
- 支持 **Claude Code**（写 `~/.claude/settings.json`）与 **Codex**（写 `~/.codex/config.toml` + `auth.json`）。
- 用户的核心诉求是**安全性**：API Key 全部存本机、代码开源可审计、零遥测零上传。任何"把数据传出去"的功能都与项目定位冲突，不要加。
- 灵感来自 GitHub 上的 farion1231/cc-switch，但只复刻其中"切换供应商"这一核心；刻意不做其本地路由/聚合/用量统计等重功能（见路线图）。

## 2. 当前状态（2026-10-28：v0.1.0 首发，同日完成全面安全审查后发布 v0.1.1）

| 项 | 状态 |
| --- | --- |
| TypeScript 类型检查 | ✅ 通过 |
| 端到端自测（10 项断言） | ✅ 10/10 通过（隔离目录运行，未触碰真实配置） |
| Windows NSIS 安装包 | ✅ 已产出 `release/CC Switch Local Setup 0.1.0.exe` |
| README / LICENSE / release.yml | ✅ 就绪 |
| git 仓库 + 首次提交 | ✅ 已推送到 GitHub |
| GitHub 仓库 | ✅ `a1531307144-cell/cc-switch-local`（公开，2026-10-28 用户确认发布） |

**明确没做的**（用户已认可放进 v2）：主密码加密、托盘常驻、用量统计、本地路由/聚合、更多工具支持（Gemini CLI 等）、MCP 管理、多语言。完整清单见 §9。

## 3. 技术栈与架构

**Electron 38 + React 18 + TypeScript + electron-vite 2 + electron-builder 25**（用户已在两个主力项目用 Electron，经验与踩坑记录都在；原版 cc-switch 用的 Tauri 需要 Rust 工具链，被用户否决）。

```
src/
  shared/types.ts        # 全部跨进程类型 + IPC 接口 Api（唯一事实来源）
  main/                  # 主进程（Node 侧）
    index.ts             # 入口：窗口、IPC 注册、单实例、--selftest 分支
    store.ts             # providers.json 存取（原子写、串行化写队列）
    claude.ts            # Claude 切换/备份/恢复/状态（homeDir 支持 CCS_HOME_OVERRIDE）
    codex.ts             # Codex 切换（@iarna/toml 解析重写 config.toml + auth.json）
    test.ts              # 连接测试（electron net.fetch，12s 超时，区分 ok/auth/http/network）
    importer.ts          # 从 cc-switch 迁移（旧版 JSON + SQLite，递归挖掘，尽力而为不抛错）
    presets.ts           # 内置预设（只收录官方文档明确的端点）
    updater.ts           # electron-updater（打包后启用，失败静默）
    selftest.ts          # 端到端自测脚本
  preload/index.ts       # contextBridge 暴露 window.api（类型 = shared.Api）
  renderer/              # React UI（中文）：App + ProviderCard/ProviderForm/SettingsPanel
```

**数据流**：Renderer ←(contextBridge ipcRenderer.invoke)→ 主进程 ←(fs 原子写)→ 三个数据位置：
1. 供应商库：`%APPDATA%/cc-switch-local/providers.json`（可用 `CCS_DATA_DIR` 覆盖）
2. Claude 配置：`~/.claude/settings.json`（可用 `CCS_HOME_OVERRIDE` 覆盖整个 home）
3. Codex 配置：`~/.codex/config.toml`、`auth.json`（同上覆盖）

**切换语义（重要，改动前必读）**：
- 切到供应商 = 写 `env.ANTHROPIC_BASE_URL` + 按 keyType 写 `AUTH_TOKEN` 或 `API_KEY` 并**删除另一个**；`env` 其余键与文件其余部分原样保留。
- 「恢复官方配置」= 删除这三个键。
- **每次写入前自动备份**，文件名 `settings.json.bak-时间戳`，同秒冲突会追加 `-1` 后缀（这里踩过坑，见 §8），保留最近 10 份。
- Codex：`model_provider = "ccsl"` + `[model_providers.ccsl]`（`requires_openai_auth = true`，Key 进 auth.json）。TOML 是"解析→重写"，**注释会丢**（已有备份兜底，UI/README 已注明）。

## 4. 常用命令

```bash
npm install          # 国内网络慢：Electron 下载可设 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run dev          # 开发模式
npm run typecheck    # tsc --noEmit（改完必跑）
npm run selftest     # 自测（见下）
npm run dist         # 打包 NSIS 安装包（见下）
```

**自测**（改主进程逻辑后必跑）：
```bash
rm -rf tmp-selftest/home tmp-selftest/data   # 重置夹具（.claude/.codex 夹具在 git 里？否——见下注）
# 夹具重建：tmp-selftest/home/.claude/settings.json 等三个文件内容见仓库历史或下方 §7
CCS_HOME_OVERRIDE=.../tmp-selftest/home CCS_DATA_DIR=.../tmp-selftest/data \
CCS_SELFTEST_OUT=.../tmp-selftest/report.json npx electron . --selftest
```
> 注：`tmp-selftest/` 在 .gitignore 里。若夹具丢失，按 §7 的内容重建（三份：settings.json / config.toml / auth.json）。自测**没有隔离变量会直接拒绝运行**，这是防止误写真实 `~/.claude` 的保险丝，别拆。

**打包**（国内网络必须带镜像，否则从 GitHub 下载 Electron zip 会超时）：
```bash
ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ \
ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/ \
npx electron-builder --win --publish never
```

## 5. 关键设计决策（为什么是这样）

1. **Electron 而非 Tauri**：用户机器已有 Electron 工程经验；打包链稳定；electron-updater 天然对接 GitHub Releases。
2. **Key 明文本地存**（用户拍板）：与原版一致；换取零依赖与可人工审计。主密码加密列 v2。
3. **只 patch 目标键、其余保留 + 删除冲突键**：切换语义的最小侵入原则；备份兜底。
4. **cc-switch 导入用"递归挖掘"而非固定 schema**：原版数据结构（尤其新版 SQLite）没有稳定公开 schema，容错优先，挖不到就报告 skipped，绝不抛错。
5. **`node:sqlite`（实验特性）读 cc-switch.db**：避免引入 better-sqlite3 等原生模块（Windows 下 ABI 重建是坑）。Electron 38 内置 Node 22，支持。
6. **本地打包时 electron-builder.yml 不带 publish 块**（见 §6 步骤 0 的原因）。
7. **预设只收录官方公开文档明确给出端点的服务商**，并在 UI/README 标注"以官方文档为准"——不要随手往里加道听途说的端点。

## 6. 发布流程（逐步执行；第 0 步是硬前提）

> ⚠️ 用户规则：**对外发布前必须逐项隐私扫描；未经用户明确同意不得 push**。发布前先读用户的全局 AGENTS.md。

> **提交/发布统一走门禁（2026-10-29 起强制）**：pre-commit 钩子（`scripts/githooks/`，经 `git config core.hooksPath` 激活）自动运行 `scripts/check-release.mjs`——暂存文件白名单 + 运行时隐私扫描（本机用户名/GitHub 账号运行时读取，仓库内零敏感词）。被拦截时读懂输出再处理；**不要用 --force 绕过**。教训来源：2026-10-28 `.zcode/plans` 会话文件曾被 `git add -A` 带进提交，靠白名单层才防住"陌生文件混入"这类 grep 扫不到的问题。

0. **发布配置已就位**（2026-10-28 已完成）：`package.json` 已加 `repository` 字段，`electron-builder.yml` 已启用 `publish: {provider: github, releaseType: release}`。以后发布**跳过本步**，直接从第 1 步开始。
1. **隐私扫描**（逐条跑，全部无输出才算过）：
   ```bash
   git add -A          # 血泪教训：必须先 add 再扫，否则新文件漏扫
   git grep --cached -n "<本机Windows用户名>"        # Windows 用户名/机器痕迹
   git grep --cached -n -i "users.<用户名片段>"       # 绝对路径残留
   git grep --cached -n -E "sk-[A-Za-z0-9_-]{18,}"   # 疑似真实 API Key（selftest 里的合成测试 key 属预期命中）
   git grep --cached -n -i "<用户真实姓名>"           # 用用户真实姓名查
   ```
   命中任何一条：**停下来问用户**，不要自作主张删改。
2. git 身份：本仓库已设置 repo 级 `user.name/user.email`（GitHub noreply 形式），不要改成含真实姓名的全局配置。
3. 创建仓库并推送（**先征得用户同意**）：
   ```bash
   gh repo create cc-switch-local --public --source . --push
   ```
4. 恢复 publish 块 + repository 字段（第 0 步），提交并打 tag：
   ```bash
   npm version patch   # 或用户指定版本
   git push origin main --tags
   ```
   GitHub Actions（release.yml）会在 windows-latest 上构建并发布到 Releases（`GITHUB_TOKEN` 自动注入，无需额外 secret）。
5. **自动更新从第二个发布版本开始生效**：v0.1.0 的安装包不含 app-update.yml（无 publish 块），发布过一次后，后续版本启动即可收到更新提示。

## 7. 自测夹具内容（丢失时按此重建）

`tmp-selftest/home/.claude/settings.json`：
```json
{
  "permissions": { "allow": ["Bash"] },
  "env": {
    "CUSTOM": "keep",
    "ANTHROPIC_BASE_URL": "https://old.example.com",
    "ANTHROPIC_AUTH_TOKEN": "sk-old-token-9999"
  }
}
```
`tmp-selftest/home/.codex/config.toml`：
```toml
model = "gpt-5"
approval_policy = "on-request"
```
`tmp-selftest/home/.codex/auth.json`：
```json
{ "OPENAI_API_KEY": "sk-old-codex-key", "tokens": { "account_id": "fixture" } }
```

## 8. 已踩过的坑（别再踩）

1. **备份文件名秒级冲突**：同一秒内连续切换会互相覆盖备份 → 已加 `-1` 唯一后缀（2026-10-28 自测抓到）。
2. **electron-builder 直连 GitHub 下载 Electron zip 超时**（国内网络）→ 必须设 `ELECTRON_MIRROR` + `ELECTRON_BUILDER_BINARIES_MIRROR`。
3. **Bash 管道 `| tail` 会吃掉真实退出码**：判断命令成败要看日志内容，别只看 `$?`（本次打包失败但管道退出码为 0）。
4. **Electron 隐藏窗口自测失真**（用户全局 AGENTS.md 也有记录）：`visibilityState='hidden'` 时原生 scroll 事件不派发、setTimeout 节流；断言用轮询；测试数据不走界面创建时要 `location.reload()`。
5. **npm 安装 483 包耗时 23 分钟**：国内网络，别按"卡死了"处理，先看日志尾部是否在缓慢推进。
6. **TOML 重写丢注释**；**`node:sqlite` 是实验特性**（有 ExperimentalWarning，正常）。
7. 用户是新手：交付物要"双击就能用"；每装一个包都要按 AGENTS.md 报备；生成文件要列冗余清单问用户删不删。
8. **一次写盘失败会毒化串行写队列**：saveStore 曾用 `chain = chain.then(...)` 链式写法，失败后所有保存静默失效——已修复（失败与队列解耦）。新增 IPC 入口时**必须在主进程侧校验入参**（参考 `validateProviderInput`），渲染层校验只是 UX 不是安全边界。
9. **preload 沙箱**：`sandbox: true` 与 electron-vite 打包的 preload（只 require electron）兼容，已实机验证通过；不要为省事改回 `false`。窗口的 `setWindowOpenHandler` / `will-navigate` / `setPermissionRequestHandler` 三道加固同理，别拆。
10. **CDP 触发页面刷新用 `Page.reload` 命令**，不要用 `Runtime.evaluate('location.reload()')`——后者可能被静默吞掉（表现为"改了设置但截图没变"，2026-10-29 实测）。另外 `await` 一个 reload 的 evaluate 会因上下文销毁永久挂死；测试脚本里所有 CDP send 都要带超时。

## 9. 路线图（用户已认可的优先级）

1. 主密码加密存储 API Key（用户关心安全，此为最痛需求）
2. 用量统计（扫描 `~/.claude/projects` 会话日志；格式会变，要做容错）
3. 本地路由/故障转移（原版聚合模式；工程量大，单独规划）
4. Gemini CLI / OpenCode 等更多工具；MCP 管理；多语言
5. 发布后事项：README 补 Release 下载链接与真实开源地址；考虑让用户申请代码签名证书

## 9.5 视觉规范（v0.2.0 定稿，改样式前必读）

设计语言对齐用户的另一款软件 LexBench（Apple 式：大 R 角 + squircle + 极轻多层阴影 + 单强调色纪律）。

- **令牌唯一事实来源**：`src/renderer/src/styles/tokens.css`。组件样式一律引用令牌变量，**禁止硬编码色值/圆角**。
- **强调色 = 品牌幼苗绿**（取自 `build/icon.png` 的鼠尾草绿）：浅色 `--accent: #6b8f77`（按钮底、白字），文字/图标态用 `--accent-ink: #52735e`；暗色 `#9dbba3`。语义成功色 `--ok` 是饱和正绿，靠饱和度与用途区分，不要混用。
- **圆角阶梯**：4（微角）/ 8（小按钮）/ 12（按钮输入）/ 18（卡片浮层）/ 26（侧栏·对话框·主画布）/ 999（胶囊徽标）。R≥18 的表面同时声明 `corner-shape: squircle`（Chromium 140+ 生效，旧环境自动回退普通圆角）。
- **布局骨架**：窗口底 `--bg` + 悬浮侧栏（8px 间距、radius 26、`--chrome` 底、shadow-2）+ 主画布（radius 26、四周呼吸缝）。分割线用 `.fade-line` 渐隐线，不用通栏直线。
- **阴影三档** shadow-1/2/3（低透明度多层），分层优先靠底色差和描边，别堆阴影。
- **字体 MiSans**：`misans` 包的 VF 版（`import 'misans/lib/Normal/MiSansVF.min.css'`，unicode-range 分包按需加载）。不要引入普通 TTF 全量版。
- **品牌图标再生成**：源图（用户提供的幼苗图）+ `tmp-visual/make-icon.js`（offscreen canvas：底色检测 → squircle 遮罩内缩 5px 防白边 → 边缘带染底板米白）输出 `build/icon.png`（electron-builder 取用，自动转 ico）与 `src/renderer/src/assets/logo.png`（侧栏 logo）。tmp-visual 在 .gitignore，脚本内容见仓库历史。

## 10. 给接手 agent 的硬性规则（与用户全局 AGENTS.md 一致）

- 安装任何包/工具/脚本后，**单独一行报备**：装了什么/方式/位置/版本。
- 对外发布（push/tag/Release）前**逐项隐私扫描**（§6 步骤 1），且必须用户点头。
- 生成输出文件后**列冗余清单问用户删不删**，不静默删除。
- 反复尝试 2-3 次打不通的交互，立即停下来交给用户操作，别耗轮次。
