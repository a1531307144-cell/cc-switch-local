# CC Switch Local

本地优先的 AI 编码工具 **API 供应商管理与一键切换**桌面应用，目前支持 **Claude Code** 与 **Codex**。

它做的事情很简单：把你散落在各处的 API 中转站 / 官方端点集中管理起来，点一下就能完成切换——不用再手动去改 `settings.json` 或 `config.toml`。

> 为什么自己写一个？市面上现成工具功能很重，而 API Key 是敏感凭据。这个项目的答案是：
> **数据 100% 存本机、代码全开源可审计、零遥测零上传**。你的 Key 除了写入本机配置文件，不去任何地方。

## 功能

- **供应商管理**：新增 / 编辑 / 删除 API 供应商（名称、Base URL、API Key、Key 类型、模型、备注）
- **一键切换**：写 `~/.claude/settings.json`（Claude Code）或 `~/.codex/config.toml` + `auth.json`（Codex），**只改 API 相关的键，其余配置原样保留**
- **自动备份**：每次写入前自动备份，保留最近 10 份，可在「设置」里一键恢复
- **恢复官方配置**：一键清除本工具写入的代理键，回到官方登录状态
- **连接测试**：向供应商发一个最小请求，验证可达性与鉴权（注意会产生极少量 token 消耗）
- **导入当前配置**：把已存在于工具配置里的 API 设置一键带入管理
- **从 cc-switch 迁移**：自动从原版 cc-switch 的旧版 `config.json` 或新版数据库里挖出供应商列表
- **内置预设**：收录官方公开文档中提供 Anthropic 兼容端点的服务商（DeepSeek / Kimi / GLM / Qwen 等），仅供参考
- **暗色主题 / 开机自启 / 启动时检查更新**（仅提示，不静默安装）

## 下载安装

到 [Releases](../../releases) 下载 `CC Switch Local Setup x.x.x.exe`，双击安装。

- 安装包**未做代码签名**，Windows SmartScreen 可能提示「已保护你的电脑」——点「更多信息 → 仍要运行」即可（开源软件没买签名证书的正常现象）。
- 也可以从源码构建（见下文「开发」）。

## 快速上手

1. 打开软件，左侧选 **Claude Code**；
2. 点「**导入当前配置**」把你正在用的 API 设置带入（或「+ 新建供应商」从预设/手动添加）；
3. 添加多个供应商后，点任意供应商的「**启用**」即完成切换；
4. **重启 Claude Code 会话**后生效（本工具改写的是配置文件，正在运行的会话不会热更新）。

## 切换原理与安全

对 Claude Code，本工具只改写 `~/.claude/settings.json` 中 `env` 下的三个键：

| 键 | 说明 |
| --- | --- |
| `ANTHROPIC_BASE_URL` | 供应商端点 |
| `ANTHROPIC_AUTH_TOKEN` | 绝大多数中转站使用（Key 类型选 AUTH_TOKEN） |
| `ANTHROPIC_API_KEY` | 官方 API 计费使用（Key 类型选 API_KEY） |

切换到某供应商时写入对应的键并**清除另一个**（避免残留配置互相干扰）；`env` 里的其它键和文件其余部分**一律不动**。每次写入前先备份到同目录 `settings.json.bak-时间戳`。

对 Codex，写入 `~/.codex/config.toml`（`model_provider` 指向 `ccsl` 自定义段，`wire_api` 默认 `responses`）与 `~/.codex/auth.json` 的 `OPENAI_API_KEY`。注意 TOML 重写会丢失注释（写入前有自动备份）。

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

- [ ] 主密码加密存储 API Key
- [ ] 托盘常驻与快捷切换
- [ ] 用量统计（扫描本地会话日志）
- [ ] 本地路由 / 多供应商故障转移（原版 cc-switch 的聚合模式）
- [ ] 更多工具：Gemini CLI、OpenCode 等
- [ ] MCP 服务器管理
- [ ] 多语言

## License

[MIT](./LICENSE)

## 免责声明

内置预设中的第三方服务端点来自其官方公开文档，仅作参考，可用性以服务商实际情况为准。使用任何第三方中转服务意味着你的请求（含对话内容）将经由该服务商，请自行评估其可靠性。
