# CC Switch Local

本地优先的 AI 编码工具 **API 供应商管理与一键切换**桌面应用，目前支持 **Claude Code** 与 **Codex**。

它做的事情很简单：把你散落在各处的 API 中转站 / 官方端点集中管理起来，点一下就能完成切换——不用再手动去改 `settings.json` 或 `config.toml`。

> 为什么自己写一个？市面上现成工具功能很重，而 API Key 是敏感凭据。这个项目的答案是：
> **数据 100% 存本机、代码全开源可审计、零遥测零上传**。你的 Key 除了写入本机配置文件，不去任何地方。

## 功能

- **供应商管理**：新增 / 编辑 / 删除 API 供应商（名称、Base URL、API Key、Key 类型、模型、备注）；官方余额接口的三家查询后**余额常显在卡片上**（DeepSeek / Kimi / OpenRouter）
- **CLI 工具版本管理**（v0.8.8）：设置页一键检测 Claude Code / Codex 的已装版本与 npm 最新版，npm 全局安装的可一键升级（纯本机操作，不涉及任何供应商数据；原生安装的会提示用自带方式升级）
- **图标优先的卡片界面**（v0.8.0 重设计）：卡面只保留**大号厂商图标 + 名称**，API Key、端点、备注等细节收进「⋯」菜单与编辑对话框，一眼认出是哪家的供应商；**拖拽卡片即可排序**，把最常用的放最前面；支持供应商**克隆**与**搜索过滤**；左侧工具栏可**折叠**，把视觉焦点留给供应商；列表视图可在**方块网格**与**横向长条**两种样式间切换（v0.8.6，选择会被记住）
- **一键切换**：写 `~/.claude/settings.json`（Claude Code）或 `~/.codex/config.toml` + `auth.json`（Codex），**只改 API 相关的键，其余配置原样保留**（含注释、键顺序与自定义段）
- **250+ 内置预设**：按名称或域名搜索填入，覆盖官方端点与主流中转站（数据改编自 [farion1231/cc-switch](https://github.com/farion1231/cc-switch)，MIT）
- **用量统计**：自动扫描本机会话日志，按天 / 模型统计请求数、Token、缓存命中率与估算花费，全年热力图 + 30 天趋势 + 逐条请求日志，**不需要开路由也能统计**
- **本机路由**：开启后请求经 `127.0.0.1` 代理转发——路由模式下切换供应商即时生效，上游故障（5xx / 429 / 连接失败）时按列表顺序自动故障转移（会在下一家重发同一请求，极端情况下可能重复计费），**连续失败的上游会自动熔断冷却**，不再反复撞死掉的家；只接受本机 CLI 客户端直连（拒绝浏览器跨域请求与 DNS rebinding），客户端配置里只落占位 Key，真实 Key 只在本机
- **协议转换**（v0.8.3）：Claude 供应商的接口协议可选 **OpenAI 兼容**——路由自动完成 Anthropic↔OpenAI 双向转换（含流式 SSE 与工具调用），Claude Code 从此能直接用 DeepSeek Chat / 智谱 GLM / Qwen / Kimi 等 OpenAI 格式端点；启用此类供应商时路由自动开启，`count_tokens` 本地估算不打上游
- **聚合模式**（v0.8.4）：开启后**一个配置用遍所有供应商**——在 Claude Code 里用「别名/模型」选模型（如 `ds/deepseek-chat`、`glm/glm-4.6`），路由按前缀分发到对应供应商（自动完成协议转换），无前缀的请求走当前供应商；英文名称自动推导别名，也可在表单里显式设置；上游故障照旧自动转移
- **主密码加密**（v0.8.5）：可选为供应商库整文件加密（AES-256-GCM），每次启动需输入主密码解锁；主密码不存储、不可找回，忘记只能清空数据。Claude Code / Codex 配置文件里的 Key 不受影响（那是工具本身的明文要求）
- **会话阅读器**（v0.8.5）：只读浏览本机 Claude Code / Codex 会话日志——按项目/时间列出，正文、工具调用摘要逐条展示；**会话内搜索、导出 Markdown、复制恢复命令**（v0.8.8）；数据不出本机
- **MCP 服务器管理**（v0.8.5）：统一面板管理 Claude Code（~/.claude.json）与 Codex（config.toml）的 MCP 服务器——添加/删除 stdio 服务器（command/args/env），手术式只改 MCP 相键，其余配置原样保留，写入前自动备份
- **系统托盘**：关窗驻留托盘，菜单里一键切换供应商 / 恢复官方配置
- **加密备份**：把供应商库导出为 AES-256-GCM 加密文件（.ccslbak），跨设备迁移时 Key 不经过任何云端，手动拷文件即可
- **自动备份**：每次写配置前自动备份，保留最近 10 份，可在「设置」里一键恢复
- **恢复官方配置**：一键清除本工具写入的代理键，回到官方登录状态
- **厂商识别与图标**：内置 DeepSeek / Anthropic / Moonshot Kimi / Qwen / OpenRouter / MiniMax / Google Gemini / 百度千帆 / 火山方舟（豆包）/ ModelScope 魔搭 / Mistral / Perplexity / 腾讯混元 / Ollama / LM Studio 等 15 家图标与官方名称，按端点自动识别（本地端口 11434 / 1234 也会识别）；识别不出的中转站显示彩色字母徽章。图标在构建时打包进应用，**运行时不联网请求任何图标**
- **连接测试**：向供应商发一个最小请求，验证可达性与鉴权（注意会产生极少量 token 消耗）
- **导入当前配置**：把已存在于工具配置里的 API 设置一键带入管理
- **从 cc-switch 迁移**：自动从原版 cc-switch 的旧版 `config.json` 或新版数据库里挖出供应商列表
- **余额查询**：DeepSeek / Moonshot Kimi / OpenRouter 三家官方余额接口，卡片「⋯」菜单里点「余额」即查（仅限识别为对应厂商的端点，不把 Key 发给第三方）
- **导入链接（ccsl://）**：网页上一键预填供应商（端点/模型）；**链接永不携带 API Key**，Key 需手动填写。格式：`ccsl://provider/add?tool=claude&name=...&url=https://...&model=...&keyType=auth_token&wire=responses`
- **一键清空全部数据**：设置页「数据危险区」，双重确认后清空供应商库与用量缓存，并恢复工具官方配置
- **中英双语**：设置页可切换 中文 / English（含托盘菜单）
- **暗色主题 / 开机自启 / 启动时检查更新**（仅提示，不静默安装）

## 下载安装

到 [Releases](../../releases) 下载 `CC Switch Local Setup x.x.x.exe`，双击安装。

- 安装包**未做代码签名**，Windows SmartScreen 可能提示「已保护你的电脑」——点「更多信息 → 仍要运行」即可（开源软件没买签名证书的正常现象）。
- 也可以从源码构建（见下文「开发」）。

## 快速上手

1. 打开软件，左侧选 **Claude Code**；
2. 点页头「**导入 ▾**」把你正在用的 API 设置带入（或「+ 新建供应商」从预设/手动添加）；
3. 添加多个供应商后，点卡片上的「**启用**」即完成切换；**拖动卡片**把最常用的排到最前面；
4. **重启 Claude Code 会话**后生效（本工具改写的是配置文件，正在运行的会话不会热更新）。

## 切换原理与安全

对 Claude Code，本工具只改写 `~/.claude/settings.json` 中 `env` 下的三个键：

| 键 | 说明 |
| --- | --- |
| `ANTHROPIC_BASE_URL` | 供应商端点 |
| `ANTHROPIC_AUTH_TOKEN` | 绝大多数中转站使用（Key 类型选 AUTH_TOKEN） |
| `ANTHROPIC_API_KEY` | 官方 API 计费使用（Key 类型选 API_KEY） |

切换到某供应商时写入对应的键并**清除另一个**（避免残留配置互相干扰）；`env` 里的其它键和文件其余部分**一律不动**。每次写入前先备份到同目录 `settings.json.bak-时间戳`。

对 Codex，写入 `~/.codex/config.toml`（`model_provider` 指向 `ccsl` 自定义段，`wire_api` 默认 `responses`）与 `~/.codex/auth.json` 的 `OPENAI_API_KEY`。TOML 采用**行级手术式编辑**：只替换 / 追加本工具拥有的键，你的注释、键顺序和 `[profile.*]` 等自定义段原样保留；每次写入前用完整 TOML 解析校验结果，解析失败立即中止绝不落盘，并有自动备份兜底。

**数据存放**：供应商列表（含明文 Key）保存在本机应用数据目录的 `providers.json`（设置页可一键打开）。明文存储与原版 cc-switch 一致，换来的是零依赖、可人工检查、换机器直接拷文件。请勿把该目录分享给他人。

> 提示：如果你在系统环境变量里也设置过 `ANTHROPIC_*`，可能与配置文件的值相互干扰，建议只用一种方式。

## 从原版 cc-switch 迁移

点「从 cc-switch 导入」，本工具会尽力读取：

- 旧版 `~/.cc-switch/config.json`
- 新版 `~/.cc-switch/cc-switch.db`（SQLite，只读打开）

挖出所有包含 Anthropic 端点 + Key 的条目去重后导入，完成后每条都会标注来源。结构识别不出来时不会报错中断，只会提示跳过了多少条。

## 开发

环境要求：Node.js ≥ 20，npm。

```bash
npm install        # 安装依赖（国内网络慢可换 npmmirror 镜像）
npm run dev        # 开发模式（热更新）
npm run typecheck  # TypeScript 类型检查
npm run selftest   # 端到端自测（自动在临时隔离目录运行，不碰真实配置）
npm run dist       # 打包 Windows NSIS 安装包到 release/
```

自测脚本（`src/main/selftest.ts`）覆盖：供应商存储、Claude 双类型 Key 切换、官方配置恢复、备份唯一性与恢复、Codex TOML/auth 写入与还原、cc-switch 迁移导入、删除供应商。它通过环境变量 `CCS_HOME_OVERRIDE` / `CCS_DATA_DIR` 指向临时目录，**未设置隔离变量时自测直接拒绝运行**。

## 发布

推送到 GitHub 后，打 tag 即可自动发布：

```bash
git tag v0.1.1 && git push origin v0.1.1
```

GitHub Actions（`.github/workflows/release.yml`）会在 Windows 环境构建并发布安装包到 Releases。首次发布前需按 `HANDOVER.md` 补两处配置（`electron-builder.yml` 的 publish 块与 `package.json` 的 repository 字段）。

## 路线图

- [ ] 余额查询扩面（需逐家核实官方接口文档后添加）
- [ ] 主进程报错信息双语化
- [ ] 更多工具：与「保持两个做精」的既定决策冲突，除非用户重新拍板
- [x] ~~托盘常驻与快捷切换~~（v0.6.0）
- [x] ~~用量统计（扫描本地会话日志）~~（v0.6.0）
- [x] ~~本机路由最简版 / 余额查询 / 深链导入 / 一键清空 / 多语言~~（v0.6.0 / v0.7.0）
- [x] ~~本机路由协议转换（Anthropic↔OpenAI 含流式与工具调用）~~（v0.8.3）
- [x] ~~聚合模式（别名/模型前缀分发）~~（v0.8.4）
- [x] ~~主密码加密存储 / 会话阅读器 / MCP 服务器管理~~（v0.8.5）

## License

[MIT](./LICENSE)

厂商图标来自 [simple-icons](https://simpleicons.org)（CC0 协议），相关品牌商标归各厂商所有，仅用于端点识别用途。

## 致谢

- [farion1231/cc-switch](https://github.com/farion1231/cc-switch)（MIT）——本项目的灵感来源与迁移对象；内置预设数据改编自其公开预设（仅收录端点 URL 等公开信息）。
- [simple-icons](https://simpleicons.org)——厂商图标。

## 免责声明

内置预设中的第三方服务端点来自其官方公开文档，仅作参考，可用性以服务商实际情况为准。使用任何第三方中转服务意味着你的请求（含对话内容）将经由该服务商，请自行评估其可靠性。
