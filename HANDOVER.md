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
- 对标 farion1231/cc-switch（v4.0.21 起为功能参照物）。2026-10-30 用户拍板「功能实现完全相似」为目标分多版走：v0.6.0 交付预设库 / 关键字段写入 / 用量统计 / 本机路由最简版 / 托盘 / 加密备份；**协议转换与聚合模式、MCP、多工具支持、云同步（决定不做，用加密备份文件替代）见 §9**。

## 2. 当前状态（2026-10-31：v0.8.7 路由熔断 + 阶段审查修复包）

| 项 | 状态 |
| --- | --- |
| TypeScript 类型检查 | ✅ 通过 |
| 端到端自测（39 步断言） | ✅ 39/39 通过（新增熔断器、损坏隔离两步） |
| CDP 实机验证 | ✅ v0.8.7 共 9/9：冷启动深链预填（take 兜底）、CSP 注入且页面正常、聚合开启联动路由开关并持久化、重启后路由自动拉起（含 aggregate 条件） |
| 审查修复（2026-10-31 第二轮审查） | ✅ P1 聚合/路由重启断连（routerSetAggregate 同步置 claude=true + 启动判断含 aggregate + 解锁后补拉路由）；P2 主密码锁定态 createTray 中断 whenReady（try/catch 兜底）；P3 nativeTheme 锁定态未捕获异常（try/catch）；P4 损坏 providers.json 静默重置（改名隔离 .corrupt-*）；P5 渲染层 CSP（构建期 meta 注入，dev 跳过）；P6 codex MCP 写入 CRLF→LF（保留原 EOL）；P7 解除主密码顺序（先明文库后删 master.json，saveStorePlain 走同一写队列）；P8 master.json 原子写；P9 provider:delete 验参；P10 provider:test 入参校验；P11 冷启动深链竞态（deeplink:take 5 分钟 TTL 兜底） |
| 新功能（v0.8.7） | ✅ **路由熔断器**：连续 3 次失败（连接错误/5xx/429）冷却 5 分钟，故障转移跳过冷却中的家；全部冷却时 fail-open 保留原链；resetBreakerForTest 供自测 |
| GitHub 仓库 | ✅ `a1531307144-cell/cc-switch-local`（公开） |

**对标 cc-switch 仍未做的**：余额查询扩面（需核实文档）、主进程报错双语化、更多工具（与「保持两个做精」拍板冲突）；进行中：Agent 版本管理 v1、余额上卡面、会话阅读器增强（搜索/导出/resume）→ v0.8.8。

## 3. 技术栈与架构

**Electron 38 + React 18 + TypeScript + electron-vite 2 + electron-builder 25**（用户已在两个主力项目用 Electron，经验与踩坑记录都在；原版 cc-switch 用的 Tauri 需要 Rust 工具链，被用户否决）。

```
src/
  shared/types.ts        # 全部跨进程类型 + IPC 接口 Api（唯一事实来源）
  main/                  # 主进程（Node 侧）
    index.ts             # 入口：窗口、IPC 注册、单实例（CCS_DATA_DIR 实例豁免）、--selftest 分支
    store.ts             # providers.json 存取（原子写、串行化写队列）
    claude.ts            # Claude 切换/备份/恢复/状态（homeDir 支持 CCS_HOME_OVERRIDE；switchClaude 第二参 viaRouter）
    codex.ts             # Codex 切换（行级手术式编辑 config.toml，保留注释/顺序；switchCodex 第二参 viaRouter）
    router.ts            # 本机路由：127.0.0.1 代理 + 故障转移 + 协议转换分发（/claude/*、/codex/*；Anthropic 透传、OpenAI 兼容走 convert）
    convert.ts           # 协议转换核心（v0.8.3）：Anthropic↔OpenAI 请求/响应/SSE 流式/count_tokens 估算
    switcher.ts          # 统一切换出口（v0.8.3）：IPC 与托盘共用；OpenAI 协议的 Claude 供应商自动开路由
    usage.ts             # 用量统计：扫描会话日志（Claude projects / Codex sessions），增量缓存按 mtime+size，成本按单价表估算
    sessions.ts          # 会话阅读器（v0.8.5）：列出/解析会话日志为只读条目；file 参数必须位于会话根内（防穿越）
    mcp.ts               # MCP 管理（v0.8.5）编排：入参校验后分别写 claude.json 顶层 mcpServers / codex [mcp_servers.NAME] 段
    master（在 store.ts）# 主密码加密（v0.8.5）：master.json 存 salt+verifier，库整文件 AES-256-GCM；锁定态 loadStore 抛 LOCKED
    backup.ts            # 加密备份：AES-256-GCM（scrypt 派生），导出/导入 .ccslbak，Key 不出机
    tray.ts              # 系统托盘：快切菜单 + 关窗驻留（close→hide，before-quit 才真退）
    test.ts              # 连接测试（electron net.fetch，12s 超时，区分 ok/auth/http/network）
    balance.ts           # 余额查询（v0.7.0）：DeepSeek/Moonshot/OpenRouter 官方接口，仅限厂商域名，endpoints 参数供自测 mock
    cleardata.ts         # 一键清空（v0.7.0）：只删 providers.json/usage-cache.json，绝不递归删 userData
    deeplink.ts          # ccsl:// 深链（v0.7.0）：解析 provider/add，永不携带 Key，解析永不抛错
    library.ts           # 供应商库业务操作（v0.8.0）：cloneProvider（副本紧跟原条目）/ reorderProviders（拖拽排序，校验 id 集合恰好匹配）；IPC 与自测共用
    importer.ts          # 从 cc-switch 迁移（旧版 JSON + SQLite，递归挖掘，尽力而为不抛错）
    i18n（shared/i18n.ts）# v0.7.0 双语字典：渲染层全部字符串 + 托盘菜单；主进程报错仍中文
    presets.ts           # 预设合并层：精选中文官方条目 + presets-data.ts（256 条生成数据，去重）
    presets-data.ts      # scripts/extract-presets.mjs 从 cc-switch（MIT）自动生成，勿手改
    updater.ts           # electron-updater（打包后启用，失败静默）
    selftest.ts          # 端到端自测脚本（37 步）
  preload/index.ts       # contextBridge 暴露 window.api（类型 = shared.Api）
  renderer/              # React UI：App + ProviderCard（v0.8.0 图标优先网格卡片，可拖拽）/ ProviderForm / SettingsPanel / UsageDashboard / SessionsView（v0.8.5 会话阅读器）/ McpView（v0.8.5 MCP 管理）/ Icons / ui（VendorChip/VendorLogo/Modal/Dropdown）
  shared/aggregate.ts    # 聚合别名推导与前缀解析（主进程路由与渲染层 tooltip 共用）
```

**数据流**：Renderer ←(contextBridge ipcRenderer.invoke)→ 主进程 ←(fs 原子写)→ 三个数据位置：
1. 供应商库：`%APPDATA%/cc-switch-local/providers.json`（可用 `CCS_DATA_DIR` 覆盖）
2. Claude 配置：`~/.claude/settings.json`（可用 `CCS_HOME_OVERRIDE` 覆盖整个 home）
3. Codex 配置：`~/.codex/config.toml`、`auth.json`（同上覆盖）

**切换语义（重要，改动前必读）**：
- 切到供应商 = 写 `env.ANTHROPIC_BASE_URL` + 按 keyType 写 `AUTH_TOKEN` 或 `API_KEY` 并**删除另一个**；`env` 其余键与文件其余部分原样保留。
- 「恢复官方配置」= 删除这三个键。
- **每次写入前自动备份**，文件名 `settings.json.bak-时间戳`，同秒冲突会追加 `-1` 后缀（这里踩过坑，见 §8），保留最近 10 份。
- Codex：`model_provider = "ccsl"` + `[model_providers.ccsl]`（`requires_openai_auth = true`，Key 进 auth.json）。**v0.6.0 起是行级手术式编辑**：只替换/追加我们拥有的键（顶层 `model_provider`/`model` 与 ccsl 段），注释、键顺序、`[profile.*]` 等原样保留；写盘前用完整 TOML 解析校验，解析失败即中止（绝不写坏用户文件）。

**本机路由（v0.6.0 最简版语义）**：
- 每工具独立开关（`settings.router.claude/codex`）。开启后配置文件里只落**占位 Key**（`ccsl-local-router`）和 `http://127.0.0.1:15731/{claude|codex}`；真实 Key 只在 store 与代理内存里。
- 代理只**透传** Anthropic/OpenAI 兼容端点（不做协议转换），故障转移 = 当前供应商失败（连接错误/5xx/429）后按列表顺序试下一家（上限 4 家）。路由模式下切换供应商即时生效（代理每请求重读 store）。
- 端口：`CCS_ROUTER_PORT` 环境变量（测试）> `settings.router.port` > 默认 15731（**v0.8.3 起**；旧默认 15721 与原版 cc-switch 的代理端口冲突，两应用并存时路由起不来——2026-10-31 用户机器实测）。上次退出时若开着路由，启动时自动拉起代理。

**聚合模式（v0.8.4 语义）**：
- 仅 claude 路由。`settings.router.aggregate` 开启后（页头「聚合」开关 / `router:setAggregate`），客户端配置指向本机路由；请求模型名含「别名/模型」前缀时按 `shared/aggregate.ts` 的别名规则分发（显式 alias 优先，否则英文名自动推导，纯中文名不可寻址），剥离前缀后的模型名透传（anthropic 重写 body.model）/转换（openai 走 convert 的 modelOverride）。
- 无前缀请求走「当前供应商」；未知前缀 400（错误信息列可用别名）；前缀家失败按兜底链继续（与普通故障转移同语义）。
- `loadStore` 对 settings.router 是白名单式重建——**新增 router 子字段时必须同步补 loadStore 的重建逻辑**（v0.8.4 曾因漏 aggregate 踩坑）。
- 自测的故障转移步骤用本地 mock 上游（500 家 + 200 家），不依赖外网。

**用量统计语义**：
- 扫描 `~/.claude/projects/**/*.jsonl`（assistant 行 `message.usage`，按 `message.id` 去重）与 `~/.codex/sessions/**/*.jsonl`（`token_count` 事件累计值取最后、请求次数按累计值变化次数）。所有解析容错，坏行跳过。
- 增量缓存 `usage-cache.json` 按 (mtime, size) 复用；**改单价表或口径必须递增 usage.ts 里的 CACHE_VERSION**，否则旧缓存不失效。
- 花费是估算：PRICING 表按模型名前缀匹配（USD/1M tokens），未命中走兜底价——UI 已标注「估算」。

**加密备份语义**：导出 = 对话框选路径 → `CCSLBAK1|salt|iv|gcm-tag|密文`；口令 8-200 字符、不存储。导入按 `tool|baseUrl|apiKey` 去重合并，主进程逐条 sanitize（备份文件被篡改也不会注入非法数据）。

## 4. 常用命令

```bash
npm install          # 国内网络慢：Electron 下载可设 ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm run dev          # 开发模式
npm run typecheck    # tsc --noEmit（改完必跑）
npm run selftest     # 自测（见下）
npm run dist         # 打包 NSIS 安装包（见下）
```

**自测**（改主进程逻辑后必跑，17 步全过才算过）：
```bash
rm -rf tmp-selftest/home tmp-selftest/data   # 重置夹具（.claude/.codex 夹具在 git 里？否——见下注）
# 夹具重建：tmp-selftest/home/.claude/settings.json 等三个文件内容见仓库历史或下方 §7
CCS_HOME_OVERRIDE=.../tmp-selftest/home CCS_DATA_DIR=.../tmp-selftest/data \
CCS_SELFTEST_OUT=.../tmp-selftest/report.json CCS_ROUTER_PORT=15999 npx electron . --selftest
```
> 注：`tmp-selftest/` 在 .gitignore 里。若夹具丢失，按 §7 的内容重建（三份：settings.json / config.toml / auth.json）。自测**没有隔离变量会直接拒绝运行**，这是防止误写真实 `~/.claude` 的保险丝，别拆。`CCS_ROUTER_PORT` 给路由自测步骤用（避开可能被占的 15721）。

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
7. **预设数据来源要合规**：v0.6.0 起 256 条预设改编自 cc-switch（MIT），生成文件头部带归属声明，README 加了致谢；**只收录端点 URL 等公开信息**（提取时已剔除 OAuth/隐藏预设），不要往里加带密钥的内容。

## 6. 发布流程（逐步执行；第 0 步是硬前提）

> ⚠️ 用户规则：**对外发布前必须逐项隐私扫描；未经用户明确同意不得 push**。发布前先读用户的全局 AGENTS.md。

> ⚠️ **版本号规则（2026-10-31 用户拍板）**：所有更新默认一律**小版本号**（`npm version patch`，如 0.8.2/0.8.3）——用户嫌大版本涨得太快；只有用户明确强调时才用 minor/major。

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
`tmp-selftest/home/.codex/config.toml`（注释与 `[profile.fast]` 是断言对象，别删）：
```toml
# 用户手工维护的注释：切换后必须原样保留
model = "gpt-5"
approval_policy = "on-request"

[profile.fast]
# profile 内注释
model = "gpt-5-mini"
model_reasoning_effort = "low"
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
11. **electron-updater 动态导入的 ESM-CJS 互操作**（v0.5.0 用户实测踩坑）：`const { autoUpdater } = await import('electron-updater')` 在某些 Node/打包形态下命名导出探测失败 → autoUpdater 为 undefined。必须兼容两种形态：`mod.autoUpdater ?? mod.default?.autoUpdater`，加载失败时报出 `Object.keys(mod)` 便于定位（修复见 `updater.ts getAutoUpdater`）。
12. **自测不参与单实例锁**：`--selftest` 模式跳过 `requestSingleInstanceLock`（用户开着已安装应用时，自测曾被锁静默退出——exit 0 但什么都没跑）。同理：**杀测试实例必须按命令行路径精确匹配**（PowerShell 过滤 `CommandLine -like '*win-unpacked*'`），全局 taskkill 会误杀用户正在运行的应用。
13. **恢复备份前先读源内容再生成新备份**：restoreBackup 里的「恢复前再备份一份」会触发 prune（保留 10 份），源文件恰好是最旧一份时会被先删掉 → ENOENT（2026-10-30 自测抓到）。claude.ts / codex.ts 都已改为先 `readFile(src)` 再 backup。
14. **HTTP 响应头值不能含非 ASCII**：路由的 `x-ccsl-provider` 带中文供应商名会直接抛 `Invalid character in header content`，必须 `encodeURIComponent`（2026-10-30 自测抓到）。
15. **CCP/CDP 模拟暗色主题对「显式主题」无效**：应用主题由 store.settings.theme 决定（light 时 matchMedia 模拟被忽略），可视化测试想拍暗色直接用 CDP 把设置页 select 切到 dark，别依赖 `Emulation.setEmulatedMedia`。
16. **预设数据是生成的**：`src/main/presets-data.ts` 由 `scripts/extract-presets.mjs` 从 cc-switch 仓库（MIT）生成；刷新预设 = 重新下载上游两个 preset 文件后重跑该脚本，**不要手改生成文件**。上游数据是 TS 对象：剥离 import（含多行）→ esbuild 转 CJS → require。
17. **单实例锁对显式 `CCS_DATA_DIR` 实例豁免**（v0.6.0 起）：测试实例与用户实例数据目录不同，锁会误杀测试启动；与 `--selftest` 豁免同理，都是环境变量门控。
18. **本地模拟更新服务器验证更新链路**（发布新版本前的推荐验证法）：构建新版安装包 → 把 `latest.yml` + 连字符命名的安装包/blockmap 放进一个静态目录（**注意 latest.yml 里的文件名是连字符形态，本地构建产物是空格形态，文件名必须对齐**）→ `node http` 起静态服务 → 把测试用 win-unpacked 的 `resources/app-update.yml` 改为 `provider: generic; url: http://localhost:<port>` → CDP 自动点击 检查→下载→安装 → 注册表确认版本真实升级。模拟器脚本模式参考会话历史（update-server.mjs + e2e-update.mjs）。
19. **out/ 没构建就跑 `npx electron . --selftest` 会静默挂死**（2026-10-31 实测）：Electron 找不到 main 后弹系统错误对话框且进程不退出，管道里看不到任何输出。自测前必须先 `npm run build`（`npm run selftest` 自带 build），并用 `taskkill //PID <pid> //F`（Git Bash 双斜杠）清理挂死进程。
20. **克隆功能与备份导入去重的相互作用**：备份导入按 `tool|baseUrl|apiKey` 去重，而克隆体与原条目三元组完全相同——删掉原条目再导入备份会被它的克隆挡住（跳过而不是找回）。这是设计行为，不是 bug；自测的备份导入步骤因此选一条**没有克隆体**的供应商做受删对象（2026-10-31 自测抓到）。
21. **CDP 直调 `window.api.settingsUpdate` 不会刷新 React 状态**：主题等由 App 从 store 派生的界面必须 reload 后才生效（真实 UI 走 select→onChanged→refresh 所以没事）。CDP 验证这类设置一律「settingsUpdate + Page.reload + 断言」。
22. **自测夹具重置顺序**：先 `rm -rf home data` 再按 §7 重建全部三个文件——先建后删会静默丢夹具，Codex 步骤会以「空 config.toml」起步并报「顶层注释丢失」（2026-10-31 实测）。

## 9. 路线图（2026-10-31 更新）

目标：功能实现上与 cc-switch v4.0.21 完全相似（分多版），设计延续现有 LexBench 风格。

1. ~~路由协议转换~~ ✅（v0.8.3：Anthropic↔OpenAI 双向含 SSE 流式与工具调用；count_tokens 本地估算；默认端口改 15731 避开原版 cc-switch 冲突）。
2. ~~聚合模式~~ ✅（v0.8.4：模型名前缀「别名/模型」分发；无前缀走当前供应商；未知前缀 400；前缀家故障走兜底链。后续增强：Codex/Responses 侧聚合、模型列表拉取）。
3. ~~会话阅读器~~ ✅（v0.8.5：Claude 全量解析，Codex MVP 只读文本消息；后续增强：Codex 工具调用解析、按项目分组）。
4. ~~MCP 管理~~ ✅（v0.8.5：stdio 服务器增删；后续增强：编辑（当前=重存覆盖）、HTTP/SSE 类型服务器、Skills/提示词面板）。
5. ~~主密码加密~~ ✅（v0.8.5：整文件加密+启动解锁屏；后续增强：口令修改、自动锁定）。
6. 余额查询扩面（需逐家核实官方文档）。
7. 主进程报错信息双语化。
8. 更多工具支持：与「保持两个做精」拍板冲突，除非用户重新拍板。
9. **不做**：WebDAV/S3 云同步（2026-10-30 用户拍板——原版把含 Key 配置明文传网盘，与"Key 绝不上传"铁律冲突；已用加密备份文件替代）。
10. 发布后事项：考虑让用户申请代码签名证书。

## 9.5 视觉规范（v0.2.0 定稿，改样式前必读）

设计语言对齐用户的另一款软件 LexBench（Apple 式：大 R 角 + squircle + 极轻多层阴影 + 单强调色纪律）。

- **令牌唯一事实来源**：`src/renderer/src/styles/tokens.css`。组件样式一律引用令牌变量，**禁止硬编码色值/圆角**。
- **强调色 = 品牌幼苗绿**（取自 `build/icon.png` 的鼠尾草绿）：浅色 `--accent: #6b8f77`（按钮底、白字），文字/图标态用 `--accent-ink: #52735e`；暗色 `#9dbba3`。语义成功色 `--ok` 是饱和正绿，靠饱和度与用途区分，不要混用。
- **圆角阶梯**：4（微角）/ 8（小按钮）/ 12（按钮输入）/ 18（卡片浮层）/ 26（侧栏·对话框·主画布）/ 999（胶囊徽标）。R≥18 的表面同时声明 `corner-shape: squircle`（Chromium 140+ 生效，旧环境自动回退普通圆角）。
- **布局骨架**：窗口底 `--bg` + 悬浮侧栏（8px 间距、radius 26、`--chrome` 底、shadow-2）+ 主画布（radius 26、四周呼吸缝）。分割线用 `.fade-line` 渐隐线，不用通栏直线。
- **供应商区（v0.8.0 定稿，动卡片前必读）**：
  - **图标优先**：卡片（`.pcard`，网格 `repeat(auto-fill, minmax(158px,1fr))`）卡面只放**大号厂商图标（44px `.vendor-logo`）或彩色字母方块（`.vendor-tile`）+ 名称**；厂商名作 11px 副标题。**禁止往卡面加回 Key/端点/备注等细节**——细节只进「⋯」菜单与编辑对话框（2026-10-31 用户明确要求，图标可识别度第一）。
  - 功能区划分：页头（`.page-head`）= 状态行 + 路由开关 + 导入下拉 + 搜索 + 新建；卡片网格只放供应商。设置/用量/导入等辅助功能进侧栏或下拉，不与卡片混排。
  - 侧栏可折叠：`settings.sidebarCollapsed` 持久化；折叠宽 64px（图标/CC·CX 徽章），展开 218px。
  - 悬浮操作条 `.pcard-actions` 默认 opacity:0，hover/focus-within 显示——新加卡片操作先进「⋯」菜单，别把按钮平铺回卡面。
  - 图标扩面流程：`src/shared/vendors.ts` 加规则 + `scripts/copy-vendor-icons.mjs` 的 VENDORS 加一行 + 重跑该脚本。注意 simple-icons 16.x 已移除 openai 等 slug，新增前先确认文件存在。
- **阴影三档** shadow-1/2/3（低透明度多层），分层优先靠底色差和描边，别堆阴影。
- **字体 MiSans**：`misans` 包的 VF 版（`import 'misans/lib/Normal/MiSansVF.min.css'`，unicode-range 分包按需加载）。不要引入普通 TTF 全量版。
- **品牌图标再生成**：源图（用户提供的幼苗图）+ `tmp-visual/make-icon.js`（offscreen canvas：底色检测 → squircle 遮罩内缩 5px 防白边 → 边缘带染底板米白）输出 `build/icon.png`（electron-builder 取用，自动转 ico）与 `src/renderer/src/assets/logo.png`（侧栏 logo）。tmp-visual 在 .gitignore，脚本内容见仓库历史。

## 10. 安全与网络行为审计（2026-10-29，用户硬性规则）

> **用户规则：开发环境与用户使用环境必须严格隔离；绝对不允许 API Key 有任何上传的可能性。**
> 此规则已于 2026-10-29 经用户确认**升级为机器级全局规则**（用户全局 AGENTS.md），所有项目生效。
> 额外边界：**读取用户真实数据文件（哪怕只读诊断）也需先经用户明确授权**——本项目的
> `%APPDATA%/cc-switch-local/providers.json` 是用户敏感数据，agent 不得未经授权读取或修改。

- **全库主动网络出口**（仅两处）：
  1. `src/main/test.ts` 的连接测试（用户点击"测试"按钮才发起，目标是用户自己填写的端点——把该供应商的 Key 发给该端点即功能本身）。
  2. `src/main/router.ts` 的本机路由（用户开启路由后才监听 `127.0.0.1`，转发目标是**用户自己配置的供应商端点**；客户端配置里只落占位 Key）。零遥测、零第三方上传的性质不变。
- **electron-updater**：仅访问 GitHub Releases 元数据/安装包（更新功能），不携带任何用户数据。
- **零遥测、零日志**：全库无 console 输出；`dependencies` 仅 3 个（@iarna/toml、electron-updater、misans），无任何分析/上报组件。
- **开发/用户环境结构性隔离**：`store.ts dataDir()` 在未打包模式自动使用 `userData + "-dev"`，`npm run dev` **永远碰不到**已安装应用的数据；测试性启动（跑打包产物做验证）**必须**设置 `CCS_DATA_DIR` + `CCS_HOME_OVERRIDE` 指向临时目录。
- **加密备份不触网**（v0.6.0）：跨设备迁移走 AES-256-GCM 加密文件手动拷贝（用户拍板不做 WebDAV/S3 云同步——原版 cc-switch 的云同步把含 Key 的配置明文传网盘，与本项目铁律冲突）。
- **cc-switch 导入去重**（v0.3.1）：导入前与现有库按 `baseUrl|apiKey` 去重，重复点击不会堆积（此前用户真实数据出现同一批 10 条被导入 8 遍——用户数据文件未动，待用户自行决定是否清理）。
- **更新链路完整化**（v0.5.0）：检查（手动+启动静默）→ 应用内下载（进度事件推给渲染层横幅）→ `quitAndInstall` 一键安装；`autoDownload` 始终 false，下载必须用户触发。GitHub 不可达时报错并提供建议 + 「打开发布页」兜底（Releases 地址在 `src/shared/constants.ts`，属主账号已登记门禁白名单）。
- **卸载即清空数据**（v0.5.0，用户要求）：electron-builder `nsis.deleteAppDataOnUninstall: true`——卸载删除 `%APPDATA%/cc-switch-local`（含全部 Key）。**升级安装不受影响**。README 有显著警示。
- **公开仓库零隐私**：门禁（pre-commit）+ 全量 HEAD 扫描双重保障；跟踪文件中的 sk- 长串仅存在于 selftest.ts（合成数据）。

## 11. 给接手 agent 的硬性规则（与用户全局 AGENTS.md 一致）

- 安装任何包/工具/脚本后，**单独一行报备**：装了什么/方式/位置/版本。
- 对外发布（push/tag/Release）前**逐项隐私扫描**（§6 步骤 1），且必须用户点头。
- 生成输出文件后**列冗余清单问用户删不删**，不静默删除。
- 反复尝试 2-3 次打不通的交互，立即停下来交给用户操作，别耗轮次。
