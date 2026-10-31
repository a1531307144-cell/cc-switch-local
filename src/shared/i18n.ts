/**
 * 极简 i18n（v0.7.0）：扁平字典 + 变量插值。
 * 范围：渲染层全部界面字符串 + 托盘菜单。主进程报错信息保持中文（下一版再扩）。
 */
export type Lang = 'zh' | 'en'

type Entry = { zh: string; en: string }

export const STRINGS = {
  // ── 应用外壳 ──
  'app.subtitle': { zh: '本地 API 供应商管理', en: 'Local API provider manager' },
  'app.loading': { zh: '加载中…', en: 'Loading…' },
  'app.initFail': { zh: '初始化失败', en: 'Initialization failed' },
  'side.usage': { zh: '用量统计', en: 'Usage' },
  'side.settings': { zh: '设置', en: 'Settings' },
  'side.collapse': { zh: '收起侧栏', en: 'Collapse sidebar' },
  'side.expand': { zh: '展开侧栏', en: 'Expand sidebar' },
  'side.privacy1': { zh: '数据仅存本机 · 无遥测', en: 'Data stays local · no telemetry' },
  'side.privacy2': { zh: '每次写入前自动备份', en: 'Auto backup before every write' },

  // ── 工具页 ──
  'tool.hint.claude': {
    zh: '切换会改写 ~/.claude/settings.json，其余配置原样保留；重启对应工具会话后生效',
    en: 'Switching rewrites ~/.claude/settings.json; everything else is preserved. Restart tool sessions to apply'
  },
  'tool.hint.codex': {
    zh: '切换会改写 ~/.codex/config.toml 与 auth.json，其余配置原样保留；重启对应工具会话后生效',
    en: 'Switching rewrites ~/.codex/config.toml and auth.json; everything else is preserved. Restart tool sessions to apply'
  },
  'tool.importCurrent': { zh: '导入当前配置', en: 'Import current config' },
  'tool.importCcSwitch': { zh: '从 cc-switch 导入', en: 'Import from cc-switch' },
  'tool.importing': { zh: '导入中…', en: 'Importing…' },
  'tool.new': { zh: '+ 新建供应商', en: '+ New provider' },
  'tool.statusActive': { zh: '当前生效：', en: 'Active: ' },
  'tool.managed': { zh: '（本工具管理）', en: ' (managed by this app)' },
  'tool.external': { zh: '检测到外部配置：', en: 'External config detected: ' },
  'tool.unmanaged': { zh: '未接管配置（官方登录或尚未设置）', en: 'Not managed (official login or not set)' },
  'tool.restoreOfficial': { zh: '恢复官方配置', en: 'Restore official config' },
  'tool.configDir': { zh: '配置目录：{path}（点击打开）', en: 'Config dir: {path} (click to open)' },
  'tool.emptyTitle': { zh: '还没有 {tool} 的供应商。', en: 'No providers for {tool} yet.' },
  'tool.emptyHint': {
    zh: '点右上角「+ 新建供应商」添加；已有配置可点「导入当前配置」一键带入；用过原版 cc-switch 的话，「从 cc-switch 导入」可以自动迁移。',
    en: 'Click "+ New provider" to add one, or "Import current config" to bring in existing settings. Used the original cc-switch? "Import from cc-switch" migrates automatically.'
  },

  // ── 路由 ──
  'router.off': { zh: '本机路由：关', en: 'Local router: OFF' },
  'router.on': { zh: '本机路由：开', en: 'Local router: ON' },
  'router.tipOff': {
    zh: '开启后请求经本机代理转发，支持自动故障转移',
    en: 'Routes requests through a local proxy with automatic failover'
  },
  'router.tipOn': {
    zh: '本机路由运行中（127.0.0.1:{port}）；已转发 {req} 次，故障转移 {err} 次',
    en: 'Local router running (127.0.0.1:{port}); {req} forwarded, {err} failovers'
  },
  'router.enabledToast': {
    zh: '已开启本机路由：重启工具会话后生效；路由模式下切换供应商即时生效，上游故障自动转移',
    en: 'Local router enabled: restart tool sessions to apply. Switches apply instantly in router mode; upstream failures fail over automatically'
  },
  'router.disabledToast': {
    zh: '已切回直连模式：重启工具会话后生效',
    en: 'Switched back to direct mode: restart tool sessions to apply'
  },

  // ── 聚合模式 ──
  'agg.off': { zh: '聚合: 关', en: 'Aggregate: OFF' },
  'agg.on': { zh: '聚合: 开', en: 'Aggregate: ON' },
  'agg.tipOff': {
    zh: '开启聚合模式：同一个配置里用「别名/模型」直接选用所有供应商的模型（如 ds/deepseek-chat），无需来回切换。请在各供应商上设置英文别名（纯英文名会自动推导）',
    en: 'Enable aggregate mode: use "alias/model" (e.g. ds/deepseek-chat) in one config to reach every provider — no more switching. Set an ASCII alias per provider (English names auto-derive one)'
  },
  'agg.tipOn': {
    zh: '聚合模式运行中：请求按模型名前缀「别名/模型」分发，无前缀的请求走当前供应商。可用：{list}',
    en: 'Aggregate mode running: requests are dispatched by model prefix "alias/model"; unprefixed requests go to the current provider. Available: {list}'
  },
  'agg.none': { zh: '（暂无可前缀寻址的供应商——请设置英文别名或英文名称）', en: '(no prefix-addressable providers — set ASCII aliases or English names)' },
  'agg.enabledToast': {
    zh: '聚合模式已开启：客户端里用「别名/模型」选模型（如 ds/deepseek-chat），无前缀走当前供应商；重启会话后生效',
    en: 'Aggregate mode enabled: pick models with "alias/model" (e.g. ds/deepseek-chat); unprefixed goes to current. Restart sessions to apply'
  },
  'agg.disabledToast': { zh: '聚合模式已关闭：恢复按当前供应商转发', en: 'Aggregate mode disabled: forwarding to the current provider as before' },
  'agg.emptyHint': {
    zh: '还没有可前缀寻址的供应商：给供应商起英文名或设置别名（新建/编辑表单里）后即可用「别名/模型」直达',
    en: 'No prefix-addressable providers yet: give providers English names or aliases (in the form) to reach them via "alias/model"'
  },
  'form.alias': { zh: '聚合别名（可选）', en: 'Aggregate alias (optional)' },
  'form.aliasHint': {
    zh: '聚合模式下用「别名/模型」直达该供应商；仅限字母/数字/下划线/中划线。英文名称会自动推导，无需填写',
    en: 'Used as the "alias/model" prefix in aggregate mode; letters/digits/underscore/dash only. English names auto-derive one'
  },

  // ── 更新横幅 ──
  'update.available': { zh: '发现新版本 v{v}', en: 'New version v{v} available' },
  'update.downloadNow': { zh: '立即下载', en: 'Download now' },
  'update.later': { zh: '稍后', en: 'Later' },
  'update.downloading': { zh: '正在下载 v{v}…', en: 'Downloading v{v}…' },
  'update.ready': { zh: '更新已就绪，点击后重启并自动安装', en: 'Update ready — restart to install' },
  'update.restartInstall': { zh: '重启并安装', en: 'Restart & install' },
  'update.openReleases': { zh: '打开发布页', en: 'Open releases page' },
  'update.close': { zh: '关闭', en: 'Close' },
  'update.latestToast': { zh: '已是最新版本', en: 'Up to date' },
  'update.foundToast': { zh: '发现新版本 v{v}', en: 'New version v{v} found' },

  // ── 供应商区（功能区：页头操作 + 卡片网格） ──
  'zone.import': { zh: '导入', en: 'Import' },
  'zone.searchPh': { zh: '搜索供应商…', en: 'Search providers…' },
  'zone.dragHint': { zh: '拖动卡片可调整顺序，把最常用的放最前面', en: 'Drag cards to reorder — put favorites first' },
  'zone.noneMatch': { zh: '没有匹配「{q}」的供应商', en: 'No providers match "{q}"' },

  // ── 供应商卡片（图标优先的紧凑卡片） ──
  'card.more': { zh: '更多操作', en: 'More actions' },
  'card.clone': { zh: '克隆', en: 'Clone' },
  'card.confirmDeleteMsg': { zh: '确定删除「{name}」吗？', en: 'Delete "{name}"?' },
  'card.inUse': { zh: '使用中', en: 'In use' },
  'card.enable': { zh: '启用', en: 'Enable' },
  'card.switching': { zh: '切换中…', en: 'Switching…' },
  'card.test': { zh: '测试', en: 'Test' },
  'card.testing': { zh: '测试中…', en: 'Testing…' },
  'card.edit': { zh: '编辑', en: 'Edit' },
  'card.delete': { zh: '删除', en: 'Delete' },
  'card.confirmDelete': { zh: '确认删除', en: 'Confirm delete' },
  'card.keyLabel': { zh: 'Key：', en: 'Key: ' },
  'card.balance': { zh: '余额', en: 'Balance' },
  'card.balanceChecking': { zh: '查询中…', en: 'Checking…' },
  'card.balanceShow': { zh: '余额 {balance} {currency}', en: 'Balance {balance} {currency}' },
  'card.copyLink': { zh: '复制导入链接', en: 'Copy import link' },
  'card.linkCopied': { zh: '已复制导入链接（不含 Key）', en: 'Import link copied (no key included)' },
  'test.ok': { zh: '✓ 连通正常 · {ms}ms', en: '✓ OK · {ms}ms' },
  'test.auth': { zh: '✗ 鉴权失败（{status}）', en: '✗ Auth failed ({status})' },
  'test.http': { zh: '✗ HTTP {status}', en: '✗ HTTP {status}' },
  'test.network': { zh: '✗ {msg}', en: '✗ {msg}' },

  // ── 表单 ──
  'form.editTitle': { zh: '编辑供应商', en: 'Edit provider' },
  'form.newTitle': { zh: '新建供应商', en: 'New provider' },
  'form.presetLabel': { zh: '从预设填入（{n} 条，按名称或域名搜索）', en: 'From presets ({n}, search by name or domain)' },
  'form.presetPh': { zh: '例如：packy、智谱、88api、deepseek…', en: 'e.g. packy, deepseek, glm, 88api…' },
  'form.presetNote': {
    zh: '预设仅供参考，端点与模型以各服务商官方文档为准',
    en: 'Presets are for reference; endpoints/models follow each provider’s official docs'
  },
  'form.name': { zh: '名称 *', en: 'Name *' },
  'form.namePh': { zh: '例如：我的中转站', en: 'e.g. My relay' },
  'form.apiKey': { zh: 'API Key *', en: 'API Key *' },
  'form.show': { zh: '显示', en: 'show' },
  'form.keyType': { zh: 'Key 类型', en: 'Key type' },
  'form.keyType.auth': { zh: 'ANTHROPIC_AUTH_TOKEN（绝大多数中转站）', en: 'ANTHROPIC_AUTH_TOKEN (most relays)' },
  'form.keyType.api': { zh: 'ANTHROPIC_API_KEY（官方 API 计费）', en: 'ANTHROPIC_API_KEY (official API billing)' },
  'form.protocol': { zh: '接口协议', en: 'Protocol' },
  'form.protocol.anthropic': { zh: 'Anthropic（标准 Claude 端点）', en: 'Anthropic (standard Claude endpoint)' },
  'form.protocol.openai': { zh: 'OpenAI 兼容（经本机路由转换）', en: 'OpenAI-compatible (converted via local router)' },
  'form.protocolHint': {
    zh: 'OpenAI 兼容端点（Chat Completions）经本机路由做协议转换，启用时会自动开启路由；模型名必填',
    en: 'OpenAI-compatible endpoints (Chat Completions) are converted through the local router, which starts automatically on switch; model name is required'
  },
  'form.err.model': { zh: 'OpenAI 兼容供应商需要填写模型名', en: 'Model name is required for OpenAI-compatible providers' },
  'form.modelCodex': { zh: '模型（写入 config.toml 的 model，可选）', en: 'Model (written to config.toml, optional)' },
  'form.modelClaude': { zh: '模型（仅用于连接测试，可选）', en: 'Model (for connection test only, optional)' },
  'form.notes': { zh: '备注（可选）', en: 'Notes (optional)' },
  'form.deeplinkNote': { zh: '来自导入链接（Key 需自行填写）', en: 'From import link (fill in the key yourself)' },
  'form.err.name': { zh: '请填写名称', en: 'Name is required' },
  'form.err.url': { zh: 'Base URL 必须以 http:// 或 https:// 开头', en: 'Base URL must start with http:// or https://' },
  'form.err.key': { zh: '请填写 API Key', en: 'API Key is required' },
  'btn.cancel': { zh: '取消', en: 'Cancel' },
  'btn.save': { zh: '保存', en: 'Save' },
  'btn.saving': { zh: '保存中…', en: 'Saving…' },
  'toast.saved': { zh: '已保存', en: 'Saved' },
  'toast.added': { zh: '已添加', en: 'Added' },
  'toast.switched': {
    zh: '已切换到「{name}」。重启 {tool} 会话后生效。',
    en: 'Switched to "{name}". Restart {tool} sessions to apply.'
  },
  'toast.restoredOfficial': {
    zh: '已恢复官方登录配置（清除代理键）。',
    en: 'Official login restored (proxy keys removed).'
  },
  'toast.deleted': { zh: '已删除「{name}」', en: 'Deleted "{name}"' },
  'toast.cloned': { zh: '已克隆「{name}」', en: 'Cloned "{name}"' },
  'toast.importNone': { zh: '没有需要导入的新供应商。{detail}', en: 'Nothing new to import. {detail}' },
  'toast.imported': { zh: '成功从 cc-switch 导入 {n} 条供应商', en: 'Imported {n} providers from cc-switch' },

  // ── 用量统计 ──
  'usage.title': { zh: '用量统计', en: 'Usage' },
  'usage.desc': {
    zh: '来自本机会话日志（Claude Code / Codex），花费为按模型单价的估算值；扫描 {files} 个文件用时 {ms}ms',
    en: 'From local session logs (Claude Code / Codex); spend is estimated from model pricing. Scanned {files} files in {ms}ms'
  },
  'usage.rescan': { zh: '重新扫描', en: 'Rescan' },
  'usage.scanning': { zh: '正在扫描本地会话日志…', en: 'Scanning local session logs…' },
  'usage.none': { zh: '暂无数据', en: 'No data' },
  'usage.requests': { zh: '总请求', en: 'Requests' },
  'usage.input': { zh: '输入 Token（含缓存读 {n}）', en: 'Input tokens ({n} cached)' },
  'usage.output': { zh: '输出 Token', en: 'Output tokens' },
  'usage.cost': { zh: '估算花费', en: 'Est. spend' },
  'usage.cacheRate': { zh: '缓存命中率', en: 'Cache hit rate' },
  'usage.heatmap': { zh: '全年活跃度', en: 'Yearly activity' },
  'usage.less': { zh: '少', en: 'Less' },
  'usage.more': { zh: '多（按请求次数）', en: 'More (by requests)' },
  'usage.trend': { zh: '最近 30 天请求趋势', en: 'Last 30 days' },
  'usage.byModel': { zh: '按模型', en: 'By model' },
  'usage.recent': { zh: '最近请求', en: 'Recent requests' },
  'usage.noRecords': { zh: '暂无记录', en: 'No records' },
  'usage.scanFail': { zh: '用量扫描失败：{msg}', en: 'Usage scan failed: {msg}' },
  'th.model': { zh: '模型', en: 'Model' },
  'th.tool': { zh: '工具', en: 'Tool' },
  'th.requests': { zh: '请求', en: 'Reqs' },
  'th.input': { zh: '输入', en: 'In' },
  'th.output': { zh: '输出', en: 'Out' },
  'th.cost': { zh: '估算花费', en: 'Est.' },
  'th.time': { zh: '时间', en: 'Time' },
  'th.cacheRead': { zh: '缓存读', en: 'Cached' },
  'th.file': { zh: '文件', en: 'File' },
  'th.size': { zh: '大小', en: 'Size' },

  // ── 设置 ──
  'set.appearance': { zh: '外观', en: 'Appearance' },
  'set.theme': { zh: '主题', en: 'Theme' },
  'set.theme.system': { zh: '跟随系统', en: 'System' },
  'set.theme.light': { zh: '浅色', en: 'Light' },
  'set.theme.dark': { zh: '深色', en: 'Dark' },
  'set.language': { zh: '语言', en: 'Language' },
  'set.general': { zh: '通用', en: 'General' },
  'set.autoUpdate': { zh: '启动时自动检查更新（仅提示，不静默安装）', en: 'Check updates at launch (prompt only, never silent-install)' },
  'set.autoStart': { zh: '开机自启', en: 'Launch at login' },
  'set.checkUpdate': { zh: '检查更新', en: 'Check updates' },
  'set.checking': { zh: '检查中…', en: 'Checking…' },
  'set.currentVersion': { zh: '当前版本 v{v}', en: 'Current version v{v}' },
  'set.updateHint': {
    zh: '发现新版本时页面顶部会出现下载横幅，下载完成后一键重启安装；网络不畅时会提供发布页链接手动下载。',
    en: 'New versions show a banner at the top; one click to download and install. If GitHub is unreachable, a link to the releases page is provided.'
  },
  'set.router': { zh: '本机路由', en: 'Local router' },
  'set.routerDesc': {
    zh: '在工具页用「本机路由」开关开启。开启后请求经 127.0.0.1 代理转发：切换供应商即时生效，上游故障（5xx / 429 / 连接失败）时按列表顺序自动转移——转移会在下一家重发同一请求，极端情况下可能重复计费。支持协议转换：接口协议为「OpenAI 兼容」的 Claude 供应商自动经路由转换（Anthropic↔OpenAI，含流式与工具调用），使用时会自动开启路由。',
    en: 'Toggle per tool on its page. Requests go through a 127.0.0.1 proxy: provider switches apply instantly; upstream failures (5xx / 429 / connection errors) fail over in list order — the same request is resent to the next provider, which may cause duplicate billing in rare cases. Protocol conversion is supported: Claude providers with the "OpenAI-compatible" protocol are converted through the router (Anthropic↔OpenAI, incl. streaming and tool calls); the router starts automatically when such a provider is enabled.'
  },
  'set.routerRunning': {
    zh: '状态：运行中（127.0.0.1:{port}）｜Claude 转发 {c} 次/失败 {cf} 次｜Codex 转发 {x} 次/失败 {xf} 次',
    en: 'Status: running (127.0.0.1:{port}) | Claude {c} fwd / {cf} fail | Codex {x} fwd / {xf} fail'
  },
  'set.routerIdle': { zh: '状态：未运行', en: 'Status: not running' },
  'set.routerError': { zh: '｜最近错误：{err}', en: ' | Last error: {err}' },
  'set.backup': { zh: '备份与迁移', en: 'Backup & migration' },
  'set.backupDesc': {
    zh: '把供应商库导出为 AES-256-GCM 加密文件，用于跨设备迁移或冷备份。文件用你设置的口令加密，Key 永远不会离开本机——需要迁移时手动把文件带到另一台电脑导入即可。',
    en: 'Export your provider library as an AES-256-GCM encrypted file for migration or cold backup. Encrypted with your passphrase; keys never leave this machine — copy the file to another computer and import.'
  },
  'set.export': { zh: '导出加密备份', en: 'Export encrypted backup' },
  'set.import': { zh: '导入加密备份', en: 'Import encrypted backup' },
  'set.toastExported': {
    zh: '已导出加密备份（口令未存储，请妥善保管文件与口令）',
    en: 'Encrypted backup exported (passphrase is not stored — keep both safe)'
  },
  'set.toastImported': {
    zh: '导入完成：新增 {a} 条，跳过 {s} 条（已存在或不合法）',
    en: 'Import done: {a} added, {s} skipped (duplicates or invalid)'
  },
  'set.pp.exportTitle': { zh: '导出加密备份', en: 'Export encrypted backup' },
  'set.pp.importTitle': { zh: '导入加密备份', en: 'Import encrypted backup' },
  'set.pp.exportHint': {
    zh: '供应商库（含 API Key）会用 AES-256-GCM 加密后保存到你选择的位置；口令不会存储，忘记将无法恢复。',
    en: 'Your library (incl. API keys) is encrypted with AES-256-GCM and saved where you choose. The passphrase is not stored — if forgotten, the backup cannot be recovered.'
  },
  'set.pp.importHint': {
    zh: '选择 .ccslbak 备份文件，用导出时设置的口令解密；与现有库相同的供应商会自动跳过。',
    en: 'Pick a .ccslbak file and decrypt it with the passphrase you set on export; duplicates are skipped automatically.'
  },
  'set.pp.passExport': { zh: '设置口令（至少 8 位）', en: 'Set passphrase (min 8 chars)' },
  'set.pp.passImport': { zh: '解密口令', en: 'Passphrase' },
  'set.pp.pass2': { zh: '再输一遍口令', en: 'Repeat passphrase' },
  'set.pp.ph.export': { zh: '用于加密这份备份', en: 'used to encrypt this backup' },
  'set.pp.ph.import': { zh: '导出时设置的口令', en: 'the passphrase you set on export' },
  'set.pp.ph2': { zh: '重复口令', en: 'repeat passphrase' },
  'set.pp.errLen': { zh: '口令至少 8 个字符', en: 'Passphrase must be at least 8 characters' },
  'set.pp.errMismatch': { zh: '两次输入的口令不一致', en: 'Passphrases do not match' },
  'set.pp.pick': { zh: '选择保存位置', en: 'Choose location' },
  'set.pp.pickImport': { zh: '选择备份文件', en: 'Choose backup file' },
  'set.dataDir': { zh: '数据与配置目录', en: 'Data & config directories' },
  'set.dataDesc': {
    zh: '供应商数据（含明文 API Key）只保存在本机数据目录，不上传任何服务器。API Key 存储于 providers.json，请注意不要把该目录分享给他人。',
    en: 'Provider data (including plaintext API keys) lives only in the local data folder — nothing is uploaded. Keys are stored in providers.json; do not share that folder.'
  },
  'set.openData': { zh: '打开数据目录', en: 'Open data folder' },
  'set.openClaude': { zh: '打开 Claude 配置目录', en: 'Open Claude config folder' },
  'set.openCodex': { zh: '打开 Codex 配置目录', en: 'Open Codex config folder' },
  'set.danger': { zh: '数据危险区', en: 'Danger zone' },
  'set.dangerDesc': {
    zh: '清空供应商库与用量缓存，并把 Claude Code / Codex 配置恢复为官方状态（我们写入的键会被移除）。操作不可撤销，建议先导出加密备份。',
    en: 'Clears the provider library and usage cache, and restores Claude Code / Codex configs to official state (keys written by this app are removed). Irreversible — export an encrypted backup first.'
  },
  'set.clearAll': { zh: '一键清空全部数据', en: 'Clear all data' },
  'set.clearAll.busy': { zh: '清空中…', en: 'Clearing…' },
  'set.confirmClear1': {
    zh: '确定要清空全部数据吗？\n\n将删除：供应商库（含所有 API Key）、用量缓存；并把 Claude Code / Codex 配置恢复为官方状态。',
    en: 'Clear ALL data?\n\nThis deletes: the provider library (all API keys) and usage cache, and restores Claude Code / Codex configs to official state.'
  },
  'set.confirmClear2': {
    zh: '最后确认：此操作不可撤销。确定继续吗？',
    en: 'Final confirmation: this cannot be undone. Continue?'
  },
  'set.toastCleared': {
    zh: '已清空全部数据（删除 {n} 个数据文件）',
    en: 'All data cleared ({n} data files removed)'
  },
  'set.clearFail': { zh: '清空失败：{msg}', en: 'Clear failed: {msg}' },
  'set.backupsTitle': {
    zh: '{tool} 配置备份（最近 {n} 份，自动保留 10 份）',
    en: '{tool} config backups (last {n}, keep 10)'
  },
  'set.noBackups': {
    zh: '暂无备份。每次切换/恢复前都会自动备份。',
    en: 'No backups yet. One is created automatically before every switch/restore.'
  },
  'set.restore': { zh: '恢复', en: 'Restore' },
  'set.confirmRestore': {
    zh: '确定恢复备份 {file} 吗？\n当前配置会先再自动备份一份。',
    en: 'Restore backup {file}?\nThe current config will be backed up first.'
  },
  'set.toastRestored': {
    zh: '已恢复备份，重启对应工具的会话后生效',
    en: 'Backup restored; restart the tool sessions to apply'
  },
  'set.about': { zh: '关于', en: 'About' },
  'set.aboutText': {
    zh: 'CC Switch Local v{v} —— 本地优先的 API 供应商管理与切换工具。所有数据仅存本机，无遥测、无上传；切换只改动目标工具配置文件中的少量键，其余内容原样保留，并在每次写入前自动备份。',
    en: 'CC Switch Local v{v} — local-first API provider manager and switcher. All data stays on this machine; no telemetry, no uploads. Switching touches only a few keys in each tool’s config and backs it up first.'
  },
  'set.deeplink': { zh: '导入链接（ccsl://）', en: 'Import links (ccsl://)' },
  'set.deeplinkDesc': {
    zh: '在网页上点 ccsl:// 链接可一键预填供应商（端点/模型），API Key 永远不会包含在链接里，需手动填写。链接格式见 README。',
    en: 'ccsl:// links on web pages prefill a provider (endpoint/model). Keys are never included in links — fill them in manually. Format documented in the README.'
  },

  // ── 托盘（主进程） ──
  'tray.current': { zh: '当前「{name}」', en: 'current "{name}"' },
  'tray.unmanaged': { zh: '未接管（官方配置）', en: 'not managed (official config)' },
  'tray.none': { zh: '（暂无供应商，打开主窗口添加）', en: '(no providers yet — open the app to add)' },
  'tray.restore': { zh: '恢复官方配置', en: 'Restore official config' },
  'tray.show': { zh: '显示主窗口', en: 'Show main window' },
  'tray.quit': { zh: '退出', en: 'Quit' },
  'tray.tooltip': { zh: 'CC Switch Local — 本地 API 供应商管理', en: 'CC Switch Local — local API provider manager' },
  'tray.switched': {
    zh: '已切换 {tool} →「{name}」，重启会话后生效',
    en: 'Switched {tool} → "{name}"; restart sessions to apply'
  },
  'tray.restored': { zh: '已恢复官方配置', en: 'Official config restored' },
  'tray.switchFail': { zh: '切换失败：{msg}', en: 'Switch failed: {msg}' },

  // ── 深链 ──
  'deeplink.okToast': {
    zh: '已从导入链接预填供应商（{name}），请填写 API Key 后保存',
    en: 'Provider prefilled from import link ({name}) — fill in the API key and save'
  },
  'deeplink.errToast': { zh: '导入链接无效：{msg}', en: 'Invalid import link: {msg}' }
} satisfies Record<string, Entry>

export type StrKey = keyof typeof STRINGS

export function t(lang: Lang, key: StrKey, vars?: Record<string, string | number>): string {
  const entry = (STRINGS as Record<string, Entry>)[key]
  let out = entry ? entry[lang] : key
  if (vars) {
    for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v))
  }
  return out
}
