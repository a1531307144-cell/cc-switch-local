# 代码审核报告（2026-10-31，v0.8.0 阶段总结）

> 审查范围：全部主进程 / 预加载 / 渲染层 / 脚本 / CI / 打包配置（v0.8.0 全量）。
> 方法：逐文件人工审查 + 对照 `docs/code-review-2026-10-28.md` 查回归。
> 结论：**无数据泄露风险，旧缺陷零回归；发现 1 项建议尽快修的安全加固（路由来源校验）、2 项 IPC 边界收紧、9 项低风险记录项。**
> 状态：**报告阶段，未改代码**——等用户拍板哪些修。

## 一、P1：建议尽快修（安全加固）

### 1. 本机路由不校验请求来源，浏览器网页可借用真实 Key 发请求

- **位置**：`src/main/router.ts:127`（handle）— 全函数没有任何 Origin / Host / OPTIONS 特殊处理。
- **问题**：路由监听 `127.0.0.1:15721`，任何本机进程都能访问——这没问题；问题在于**浏览器里的任意网页**也能向 `http://127.0.0.1:15721/claude/v1/messages` 发 fetch（localhost 属于 local network，Chrome 的 PNA 防护只覆盖部分场景，Firefox/Safari 更宽）。路由收到请求后会把**真实 API Key 注入**再转发（`buildUpstreamHeaders`，router.ts:111）。
  - 恶意网页**读不到响应**（路由不发 CORS 头，浏览器会拦截读取），但可以让请求真实发生：消耗你的 Key 额度、伪造对话请求。
  - 连浏览器预检的 `OPTIONS` 请求也会被当作普通请求**透传到上游**（带着真实 Key）。
  - Claude Code / Codex CLI 客户端不发 `Origin` 头，浏览器跨域请求一定带——两者可区分。
- **建议**（三行防御，CLI 用户零感知）：
  1. 带 `Origin` 头的请求直接 403（浏览器跨域必带 Origin，CLI 不带）；
  2. 校验 `Host` 头必须是 `127.0.0.1:{port}`（防 DNS rebinding）；
  3. `OPTIONS` 方法直接 403。
- 并在自测里加一步：带 Origin 的请求 → 403；不带 → 正常转发。

## 二、P2：IPC 边界收紧（自家原则「IPC 是安全边界」的两处缺口）

### 2. `settings:update` 只校验了 2 个字段，其余 patch 原样合并入库

- **位置**：`src/main/index.ts:311-319`。只校验 `language` 与 `sidebarCollapsed`，然后 `store.settings = { ...store.settings, ...patch }`。
- **问题**：被攻破的渲染层可写入任意形状的 `router`（绕过 `router:set` 的「须先选供应商」检查）、把 `autoStart`/`theme` 写成任意值。实际后果有限（`routerPort()` 有类型守卫，applySettings 有 isPackaged 守卫），但违背边界原则。
- **建议**：对 `AppSettings` 全字段做类型校验（theme/language 枚举、autoUpdate/autoStart/sidebarCollapsed boolean、router.claude/codex boolean + port 整数范围），未知键拒绝。

### 3. `provider:switch` 的 tool 参数未严格白名单

- **位置**：`src/main/index.ts:217`。`tool === 'claude' ? ... : codex.switchCodex(...)`——任何非 `'claude'` 字符串都被当 codex 处理；传错值会去写 codex 配置文件（provider 找不到时按「恢复官方」写盘，有备份）。
- **建议**：入口处 `if (!(tool === 'claude' || tool === 'codex')) throw`（与 `router:set` 一致）。

## 三、P3：低风险记录项（按需处理）

| # | 位置 | 问题 | 说明 |
| --- | --- | --- | --- |
| 4 | `src/main/codex.ts:174-183` | `auth.json` 存在但 JSON 解析失败时，用空对象覆盖重写，用户原有其它字段（如官方登录 `tokens`）丢失 | 有自动备份兜底；建议解析失败时中止并报错，让用户先修文件 |
| 5 | `src/main/codex.ts:55,112` | 顶层键定位靠逐行正则，用户 TOML 顶层多行字符串（`"""…"""`）里若恰有 `model = ` 形态的行会被误替换 | 极罕见；写前 TOML 校验只能挡「语法坏」，挡不住「语义变」 |
| 6 | `src/main/router.ts:159-197` | 上游超时只覆盖到响应头到达（`clearTimeout` 在 finally）；响应体阶段若静默挂起，该请求永久占用 | 客户端可主动断开；建议 pipe 阶段加 idle 超时 |
| 7 | `src/main/router.ts:174` | 故障转移对非幂等 POST 重发同一 body：上游已受理但回 5xx 时可能重复计费 | 设计固有权衡；建议设置页文案补一句说明 |
| 8 | `src/main/store.ts:33-63` | `loadStore` 不逐条 sanitize（导入路径有）：手改 providers.json 的坏数据会直接进运行时 | 自伤面；建议 load 时过一遍 `sanitizeProvider` |
| 9 | `src/main/index.ts:288` | `router:set` 开启时先写 settings 再 `startRouter`；端口被占时状态与实际不一致（下次启动自动重试） | 影响有限；可改为先启动成功再写盘 |
| 10 | `.github/workflows/release.yml` | 用 `npm install` 而非 `npm ci` | 锁文件正常时等价；`npm ci` 更严格可复现 |
| 11 | `src/renderer/.../ProviderCard.tsx` | 最后一行卡片的「⋯」菜单可能被主画布滚动容器裁剪或顶出滚动条 | UX 小问题；可按剩余空间向上弹 |
| 12 | 既定决策 | 明文 Key 存 `providers.json` 与工具配置文件 | v0.1.0 用户拍板，主密码加密在路线图 §9 第 5 项；设置页有明示 |

## 四、审查过确认无恙（本次全量复核，与 10-28 报告结论一致或已覆盖新代码）

- **IPC 校验面板齐全**：provider:save/delete/clone/reorder、backup、deeplink:parse、balance:get、app:openPath 全部主进程侧校验；`library.ts`（v0.8.0 新增）的 clone/reorder 校验严密（id 白名单、集合恰好匹配、防重复 id）。
- **路径穿越封死**：claude/codex `restoreBackup` 文件名白名单依然有效。
- **加密备份**：GCM 认证标签校验通过才 JSON.parse；导入逐条 sanitize + 一律 `newId()`（不信任备份内 id）+ 500 条上限；scrypt 参数合理（N=16384）。
- **深链**：永不携带 Key（类型层面 Omit）、协议/命令/枚举/长度全白名单、解析永不抛错。
- **Electron 加固三件套**仍在（sandbox:true / 导航与弹窗全拒 / Web 权限全拒）；渲染层无 eval、无 dangerouslySetInnerHTML、无远程内容（新增厂商图标仍是构建期内置 SVG）。
- **密钥泄露面**：日志/报错/测试结果不含 Key；UI 只显示掩码；`status()` 只回掩码；托盘/路由/用量均不落 Key。
- **用量统计**：解析全容错、2MB 行上限、增量缓存按 (mtime,size)、缓存文件损坏自动重建。
- **导入器**：SQLite 只读 + 表名剥离引号 + `sqlite_` 前缀过滤；只认 `ANTHROPIC_*` + 200 条上限。
- **更新器**：不静默安装（用户触发下载与安装）、90s 停滞看门狗、错误信息不敏感；签名缺失为已知限制（README 已提示 SmartScreen）。
- **发布链**：pre-commit 门禁（白名单+运行时身份扫描）工作正常；CI 权限最小化（`contents: write`）；deleteAppDataOnUninstall 生效。
- **v0.8.0 新 UI**：React 默认转义覆盖全部用户文本（供应商名/备注/模型名），无注入面；拖拽/菜单/搜索均为本地操作。

## 五、验证

本报告为静态人工审查，未运行额外测试。涉及代码修改时，按惯例跑 `npm run typecheck` + 22 步自测 + 打包 CDP 实机验证后再发布。

## 六、处置结果（2026-10-31 用户拍板「全部修」，当日修复完毕）

| 项 | 处置 |
| --- | --- |
| P1 路由来源校验 | ✅ `router.ts`：带 Origin 403、Host 必须回环地址（127.0.0.1/localhost/[::1]:port，防 DNS rebinding）、OPTIONS 403；自测新增来源校验步骤（三类非法请求 403 且不透传 + 正常请求 200） |
| #6 响应体超时 | ✅ 转发阶段空闲 120s（`BODY_IDLE_TIMEOUT_MS`）无新数据即断开 |
| P2 settings:update | ✅ 新增 `library.ts validateSettingsPatch`：全字段类型/枚举校验 + 未知键拒绝；自测覆盖 6 类非法 patch |
| P2 tool 白名单 | ✅ `index.ts assertTool` 应用于 provider:switch 与 tool:importCurrent/status/backups/restoreBackup 五个 IPC |
| #4 auth.json 损坏 | ✅ `codex.ts`：写任何文件**之前**先读 auth.json，非合法 JSON 对象直接中止并报错（config.toml 不会被改写）；自测覆盖 |
| #5 多行字符串 | ✅ `codex.ts multilineMask`：`'''`/`"""` 跨行字符串内的行不参与顶层键/段头识别；夹具加入含伪键 `model = fake` 与伪段头 `[model_providers.evil]` 的多行字符串，自测断言不被误伤 |
| #8 加载防线 | ✅ `store.ts sanitizeProviderRecord`：loadStore 逐条校验坏记录丢弃；备份导入复用同一校验器（仍强制新 id）；自测注入坏记录验证 |
| #9 router:set 时序 | ✅ 先 `startRouter()` 成功再写设置，端口被占时本次零写入 |
| #10 CI | ✅ `npm ci --no-audit --no-fund` |
| #11 菜单裁剪 | ✅ 卡片「⋯」菜单按视口剩余空间上弹（`.menu.up`，阈值 240px）；CDP 断言底部卡片上弹、顶部卡片保持下弹 |
| #7 重发说明 | ✅ 设置页与 README 的本机路由说明补充「转移会在下一家重发同一请求，极端情况下可能重复计费」 |
| #12 明文 Key | 维持既定决策（主密码加密在路线图 §9 第 5 项） |

验证：typecheck 通过；端到端自测 **26/26**（原 22 步 + 新增加载防线/设置校验/auth.json 中止/路由来源校验 4 步）；打包后 CDP 复验 6/6（菜单上弹、非法设置拒绝、卡面无 Key/端点等）。
