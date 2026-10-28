# 代码审查报告（2026-10-28，v0.1.0 → v0.1.1）

> 审查范围：全部主进程 / 预加载 / 渲染层代码、打包与 CI 配置。
> 重点：安全（Electron 攻击面、IPC 边界、密钥泄露面）与正确性（文件写入、竞态、边界条件）。
> 结论：**10 项处置（4 修复 + 4 加固 + 2 文档化），全部验证通过后发布 v0.1.1。**

## 一、已修复的缺陷

| # | 位置 | 严重度 | 问题 | 处置 |
| --- | --- | --- | --- | --- |
| 1 | `store.ts` saveStore | **P1 正确性** | 串行写队列用 `writeChain = writeChain.then(...)` 链式拼接，**一次写盘失败会让队列永久处于 rejected 状态，之后所有保存静默失效**（自测全是成功路径，未暴露） | 失败与队列解耦：`writeChain = next.catch(() => {})`；另给 atomicWrite 加了临时文件失败清理 |
| 2 | `claude.ts` / `codex.ts` / `test.ts` | **P1 安全** | IPC 是安全边界，但切换/测试只依赖渲染层校验；被攻破的渲染层可写入任意协议的 URL 或空 Key | 主进程侧统一校验：Base URL 仅允许 `http/https`、Key 非空且 ≤4000 字符 |
| 3 | `index.ts` IPC 全面板 | **P1 安全** | `provider:save` 入参无类型/长度/枚举校验；`app:openPath` 的 kind 未做白名单 | 新增 `validateProviderInput`（枚举白名单 claude/codex、auth_token/api_key、responses/chat + 长度上限）；openPath 白名单命中才执行 |
| 4 | `ProviderCard.tsx` | P2 隐私 | 掩码用 `slice(0,4)+slice(-4)`，**Key 长度 ≤8 时前后切片重叠，等于完整明文显示** | ≤8 字符显示 `****` |

## 二、安全加固（Electron 官方安全清单对齐）

| # | 项 | 处置 |
| --- | --- | --- |
| 5 | `sandbox: false → true` | preload 仅使用 contextBridge/ipcRenderer，完全兼容沙箱；收紧后渲染层即使被攻破也拿不到 Node 能力。**已通过打包实机验证（CDP 调用 `window.api` 正常）** |
| 6 | 窗口导航与弹窗 | `setWindowOpenHandler` 一律拒绝、`will-navigate` 一律阻止、`setPermissionRequestHandler` 拒绝所有 Web 权限请求 |
| 7 | 开机自启 | `applySettings` 加 `app.isPackaged` 守卫，避免开发模式误写系统注册表 |
| 8 | CI | Node 20 → 24（消除 actions 弃用警告） |

## 三、正确性收紧

| # | 项 | 处置 |
| --- | --- | --- |
| 9 | `importer.ts` 迁移导入 | 原"凡有 base_url 就收"会把 cc-switch 数据库里 **Codex/Gemini 条目误导入成 Claude 供应商**（写入错误的 env 键）。收紧为只认 `ANTHROPIC_*` 键 + 上限 200 条防病态数据 |
| 10 | `App.tsx` toast | 连续提示时旧计时器会提前隐藏新提示；改用 ref 管理单一计时器 |

另：`claude.ts` 读取 settings.json 时兼容 UTF-8 BOM（某些编辑器会加，会导致 JSON.parse 失败而无法切换）。

## 四、审查过但无需改动的项（留档，后续迭代别重复排查）

- **TOML 注入不可行**：`config.toml` 通过 `@iarna/toml` 解析→重写，字符串会被正确转义，model/notes 里的引号换行不会破坏结构。
- **路径穿越已封死**：`restoreBackup` 主进程侧校验文件名格式（`settings.json.bak-时间戳` 模式，拒绝 `/ \ ..`）。
- **SQL 注入面**：importer 的 SQLite 只读查询，表名来自 `sqlite_master` 且过滤 `sqlite_` 前缀、剥离双引号；只读打开。
- **密钥泄露面**：错误信息与测试结果不含 Key；UI 显示掩码；日志不打 Key；数据文件在用户级 AppData（Windows 按用户 ACL 隔离）。
- **无 `eval` / `dangerouslySetInnerHTML` / `shell.openExternal`**；渲染层不直接发起网络请求（测试走主进程）。
- **CSP 暂不启用**：渲染层只加载本地打包代码、无远程内容，威胁模型下收益有限；且 dev 模式 HMR 需要 inline script，贸然加会破坏开发体验。列入 v2（可按 dev/prod 条件注入）。
- **SSRF（测试请求）**：本工具是本地单人应用，测试目标即用户自己配置的端点，不构成攻击面。
- **npm audit**：生产依赖 0 漏洞；dev 依赖（electron-builder 构建链的 tar/glob 旧版本）存在已知通告，不进安装包产物，接受。
- **Codex 回退官方时不清理 auth.json 的 OPENAI_API_KEY**：无法区分该键属于本工具还是用户原有配置，贸然删除可能破坏 API 计费用户；已有备份兜底，用户可在设置页恢复。

## 五、验证记录

- `tsc --noEmit` 通过
- 端到端自测 **10/10 通过**（隔离目录，含切换/备份/恢复/TOML/导入/删除全链路）
- 重新打包成功；打包产物实机启动，CDP 验证 `window.api` 桥在 `sandbox: true` 下工作正常
- npm audit：生产依赖 0 漏洞
