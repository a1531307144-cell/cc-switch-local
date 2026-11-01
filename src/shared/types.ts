export type ToolId = 'claude' | 'codex'
export type KeyType = 'auth_token' | 'api_key'
export type ThemeMode = 'system' | 'light' | 'dark'
export type Lang = 'zh' | 'en'
/** 接口协议（claude 工具用）：anthropic=标准 Claude 端点；openai=OpenAI 兼容（经本机路由转换） */
export type Protocol = 'anthropic' | 'openai'

/** 模型映射档位（v0.8.18，对标原版 cc-switch）：写入 settings.json env 的角色键 */
export type ModelRole = 'sonnet' | 'opus' | 'fable' | 'haiku' | 'subagent'

/** 模型映射单条（v0.8.18）：某档位映射到的实际模型 */
export interface ModelMapEntry {
  /** 实际请求模型（空串视为未配置） */
  model: string
  /** /model 菜单显示名（写入 ANTHROPIC_DEFAULT_*_MODEL_NAME；subagent 档无菜单项） */
  display?: string
  /** 声明支持 1M 上下文：env 值带「 [1m]」后缀，本机路由转发前剥离 */
  ctx1m?: boolean
}

/** 供应商级模型映射（v0.8.18）：env 写入 + 本机路由档位改写共用 */
export interface ProviderModelMapping {
  sonnet?: ModelMapEntry
  opus?: ModelMapEntry
  fable?: ModelMapEntry
  haiku?: ModelMapEntry
  subagent?: ModelMapEntry
}

export interface Provider {
  id: string
  tool: ToolId
  name: string
  baseUrl: string
  apiKey: string
  /** claude 用：写入 ANTHROPIC_AUTH_TOKEN 或 ANTHROPIC_API_KEY；codex 忽略（固定写 auth.json） */
  keyType: KeyType
  /** claude 用：接口协议（缺省 anthropic）；openai 协议只能经本机路由使用（自动转换） */
  protocol?: Protocol
  /** 聚合模式的模型前缀别名（ASCII [A-Za-z0-9_-]，缺省时由名称自动推导；纯中文名不可前缀寻址） */
  alias?: string
  /** 可选：codex 会写入 config.toml 的 model；claude 仅作测试请求的模型名 */
  model?: string
  /** OpenAI 兼容端点的报文格式：codex 写入 config.toml 的 wire_api；claude（protocol=openai）选择上游走 Chat Completions 或 Responses API（v0.8.10 起） */
  wireApi?: 'responses' | 'chat'
  /** 模型映射（v0.8.18，仅 claude）：写入 settings.json env（ANTHROPIC_DEFAULT_*_MODEL 等），本机路由同步做档位改写 */
  modelMapping?: ProviderModelMapping
  /** 默认兜底模型声明 1M（v0.8.18）：model 字段的 env 值（ANTHROPIC_MODEL）带「 [1m]」后缀 */
  model1m?: boolean
  /** 完整 URL（v0.8.18）：本机路由转发时原样使用 baseUrl，不再拼接 /v1/* 路径 */
  fullUrl?: boolean
  /** 自定义 User-Agent（v0.8.18）：仅本机路由模式生效 */
  customUserAgent?: string
  /** 上游请求头覆盖（v0.8.18）：仅本机路由模式生效，键为合法头名 */
  headerOverrides?: Record<string, string>
  /** 上游请求体覆盖（v0.8.18）：仅本机路由模式生效，浅合并进 JSON 请求体顶层 */
  bodyOverrides?: Record<string, unknown>
  notes?: string
  /** 图标 slug（v0.8.14 起）：从预设带入随供应商持久化，卡片渲染优先于域名识别 */
  icon?: string
  /** 最近一次余额查询结果（v0.8.8 起，点卡片「余额」时持久化；ok 才上卡面） */
  lastBalance?: { ok: boolean; balance: number; currency?: string; checkedAt: number }
  createdAt: number
  updatedAt: number
}

export interface ProviderInput {
  id?: string
  tool: ToolId
  name: string
  baseUrl: string
  apiKey: string
  keyType?: KeyType
  protocol?: Protocol
  /** 聚合模式别名（同 Provider.alias） */
  alias?: string
  model?: string
  wireApi?: 'responses' | 'chat'
  /** 模型映射（v0.8.18，同 Provider.modelMapping） */
  modelMapping?: ProviderModelMapping
  model1m?: boolean
  fullUrl?: boolean
  customUserAgent?: string
  headerOverrides?: Record<string, string>
  bodyOverrides?: Record<string, unknown>
  notes?: string
  /** 图标 slug（v0.8.14）：从预设带入 */
  icon?: string
}

export interface AppSettings {
  autoUpdate: boolean
  autoStart: boolean
  theme: ThemeMode
  /** 界面语言（v0.7.0 起；缺省 zh） */
  language?: Lang
  /** 侧栏折叠（v0.8.0 起；缺省展开） */
  sidebarCollapsed?: boolean
  /** 供应商列表视图样式（v0.8.6 起；缺省 grid 方块，list 为横向长条） */
  providerView?: 'grid' | 'list'
  /** 配色主题（v0.8.18；shared/themes.ts 的 id，缺省 sage 鼠尾草；独立于明暗模式） */
  accent?: string
  /** 本机路由模式（每工具独立开关；port 缺省 15731；缺省 false） */
  router?: {
    claude: boolean
    codex: boolean
    port?: number
    /** 聚合模式（仅 claude 路由）：按请求模型名前缀「别名/模型」分发到对应供应商 */
    aggregate?: boolean
  }
}

export interface RouterStatus {
  running: boolean
  port: number
  error?: string
  claude: { enabled: boolean; requests: number; errors: number }
  codex: { enabled: boolean; requests: number; errors: number }
}

export interface BalanceResult {
  ok: boolean
  balance?: number
  currency?: string
  message?: string
}

/** ccsl:// 深链解析结果（链接永不携带 API Key） */
export interface DeeplinkResult {
  ok: boolean
  input?: Omit<ProviderInput, 'apiKey'>
  error?: string
}

export interface StoreShape {
  version: 1
  current: Record<ToolId, string | null>
  providers: Provider[]
  settings: AppSettings
  /** 提示词库（v0.8.9 起；缺省空） */
  prompts?: StoredPrompt[]
  /** 方案组（v0.8.9 起；缺省空） */
  groups?: ProviderGroup[]
  /** 主密码加密已启用且尚未解锁（渲染层据此显示解锁屏） */
  locked?: true
}

export interface TestResult {
  ok: boolean
  kind: 'ok' | 'auth' | 'http' | 'network'
  status?: number
  latencyMs?: number
  message?: string
}

/** 可用模型列表拉取结果（v0.8.18）：OpenAI 兼容 GET /v1/models（anthropic 端点带 x-api-key/版本头） */
export interface ModelsResult {
  ok: boolean
  models?: string[]
  message?: string
}

export interface ToolStatus {
  configPath: string
  exists: boolean
  currentBaseUrl?: string
  currentKeyMasked?: string
}

export interface BackupInfo {
  file: string
  created: number
  size: number
}

export interface SwitchResult {
  ok: boolean
  files: string[]
  backup?: string
}

export interface Preset {
  tool: ToolId
  name: string
  baseUrl: string
  model?: string
  /** claude 预设：应使用的 env 键类型（缺省 auth_token） */
  keyType?: KeyType
  /** claude 预设：接口协议（缺省 anthropic；openai = 经本机路由转换） */
  protocol?: Protocol
  /** codex 预设：wire_api（缺省 responses） */
  wireApi?: 'responses' | 'chat'
  notes?: string
  /** 预设分类（v0.8.13 起，添加页分组用）：official/cn_official/aggregator/third_party/cloud_provider/local */
  category?: 'official' | 'cn_official' | 'aggregator' | 'third_party' | 'cloud_provider' | 'local'
  /** 同族变体分组键（v0.8.13 起）：同 family 的条目在添加页聚合为一张卡（N 个版本） */
  family?: string
  /** 图标 slug（v0.8.14 起）：来自 cc-switch 图标库，文件在 assets/vendors/（presetIcons.ts 解析） */
  icon?: string
  /** 搜索键：名称 + 域名小写，渲染层过滤用 */
  searchKey?: string
}

export interface ProviderDraft {
  name?: string
  baseUrl: string
  apiKey: string
  keyType: KeyType
  source: string
}

export interface ImportReport {
  imported: number
  skipped: number
  details: string[]
  providers: ProviderDraft[]
}

export interface TestInput {
  tool: ToolId
  baseUrl: string
  apiKey: string
  keyType: KeyType
  protocol?: 'anthropic' | 'openai'
  model?: string
}

// ─── 会话阅读器（解析各工具本地会话日志的只读视图） ───

export interface SessionInfo {
  tool: ToolId
  /** 会话文件的绝对路径（读取时回传，主进程校验其位于会话根目录内） */
  file: string
  project: string
  id: string
  mtime: number
  size: number
}

export interface SessionEntry {
  role: 'user' | 'assistant' | 'tool'
  text: string
  ts: number
  /** role=tool 时的工具名 */
  toolName?: string
}

export interface SessionPage {
  entries: SessionEntry[]
  /** 超长会话被截断（仅展示前 N 条） */
  truncated: boolean
}

// ─── MCP 服务器管理 ───

/** 已安装的 Skill（v0.8.10）：目录含 SKILL.md */
export interface SkillInfo {
  tool: ToolId
  /** 目录名（即 skill id） */
  name: string
  /** SKILL.md frontmatter 的 description（缺失为空串） */
  description: string
  path: string
  fileCount: number
  size: number
  /** 安装来源（GitHub 安装时记录，供「更新」重拉） */
  source?: { repo: string; ref?: string; installedAt: number }
}

// ─── MCP 服务器管理 ───

/** 工具当前的全局提示词文件状态（v0.8.9） */
export interface CurrentPromptFile {
  path: string
  exists: boolean
  content: string
  mtime: number
}

/** 提示词库条目（v0.8.9）：应用到工具的全局提示词文件（CLAUDE.md / AGENTS.md） */
export interface StoredPrompt {
  id: string
  tool: ToolId
  /** 1-100 字符 */
  name: string
  /** ≤ 100_000 字符 */
  content: string
  createdAt: number
  updatedAt: number
}

/** 方案组（v0.8.9）：一键切换整套供应商组合；成员为 null 表示该工具恢复官方配置 */
export interface ProviderGroup {
  id: string
  /** 1-100 字符 */
  name: string
  members: { claude: string | null; codex: string | null }
  createdAt: number
  updatedAt: number
}

/** CLI 工具（Claude Code / Codex）版本信息（v0.8.8） */
export interface AgentVersionInfo {
  tool: ToolId
  /** npm 包名 */
  pkg: string
  /** 本机检测到的已装版本；null = PATH 上找不到该命令 */
  installed: string | null
  /** npm registry 上的最新版本；null = 查询失败或 npm 不可用 */
  latest: string | null
  npmFound: boolean
  /** CLI 可执行文件路径（用于判断是否 npm 全局安装） */
  binPath: string | null
  /** true = npm 全局安装（可一键升级）；false = 原生/其他方式安装 */
  managed: boolean
  error?: string
}

export interface McpServerSpec {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
}

export interface McpListResult {
  tool: ToolId
  /** 配置文件路径 */
  file: string
  servers: McpServerSpec[]
}

// ─── 用量统计（扫描各工具本地会话日志的聚合结果） ───

export interface UsageEntry {
  ts: number
  tool: ToolId
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export interface UsageDay {
  date: string
  requests: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cost: number
}

export interface UsageStats {
  totals: { requests: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }
  days: UsageDay[]
  models: { model: string; tool: ToolId; requests: number; input: number; output: number; cost: number }[]
  recent: UsageEntry[]
  scannedFiles: number
  scanMs: number
  lastScanAt: number
}

export interface Api {
  storeGet(): Promise<StoreShape>
  providerSave(input: ProviderInput): Promise<Provider>
  providerDelete(id: string): Promise<boolean>
  /** 克隆供应商（复制全部字段，新 id，名称加「副本」后缀，排在原条目之后） */
  providerClone(id: string): Promise<Provider>
  /** 重排某工具的供应商顺序（拖拽排序；ids 必须恰好是该工具全部供应商） */
  providersReorder(tool: ToolId, ids: string[]): Promise<boolean>
  providerSwitch(tool: ToolId, id: string | null): Promise<SwitchResult>
  toolImportCurrent(tool: ToolId): Promise<Provider | null>
  toolStatus(tool: ToolId): Promise<ToolStatus>
  toolBackups(tool: ToolId): Promise<BackupInfo[]>
  toolRestoreBackup(tool: ToolId, file: string): Promise<SwitchResult>
  providerTest(input: TestInput): Promise<TestResult>
  /** 拉取上游可用模型列表（v0.8.18）：GET /v1/models，多候选地址依次尝试 */
  modelsFetch(input: { baseUrl: string; apiKey: string; keyType?: KeyType; protocol?: 'anthropic' | 'openai' }): Promise<ModelsResult>
  ccswitchImport(): Promise<ImportReport>
  presetsGet(): Promise<Preset[]>
  backupExport(passphrase: string): Promise<{ savedTo?: string; canceled?: boolean }>
  backupImport(passphrase: string): Promise<{ added: number; skipped: number; canceled?: boolean }>
  usageGet(): Promise<UsageStats>
  /** 会话阅读器 */
  sessionsList(tool: ToolId): Promise<SessionInfo[]>
  sessionsRead(tool: ToolId, file: string): Promise<SessionPage>
  /** MCP 服务器管理 */
  mcpList(tool: ToolId): Promise<McpListResult>
  mcpSave(tool: ToolId, spec: McpServerSpec): Promise<boolean>
  mcpDelete(tool: ToolId, name: string): Promise<boolean>
  /** 主密码：解锁 / 设置 / 解除 */
  storeUnlock(passphrase: string): Promise<boolean>
  masterSet(passphrase: string): Promise<boolean>
  masterRemove(passphrase: string): Promise<boolean>
  masterStatus(): Promise<{ enabled: boolean }>
  routerStatus(): Promise<RouterStatus>
  routerSet(tool: ToolId, enabled: boolean): Promise<RouterStatus>
  /** 聚合模式开关（仅 claude 路由）：开启后按模型名前缀「别名/模型」分发 */
  routerSetAggregate(tool: ToolId, enabled: boolean): Promise<RouterStatus>
  balanceGet(input: { baseUrl: string; apiKey: string }): Promise<BalanceResult>
  /** 余额查询结果持久化到供应商（v0.8.8，卡面角标用） */
  providerSetBalance(id: string, result: { ok: boolean; balance: number; currency?: string; checkedAt: number }): Promise<boolean>
  /** CLI 工具（Claude Code / Codex）版本检测与升级（v0.8.8） */
  agentVersionGet(): Promise<{ claude: AgentVersionInfo; codex: AgentVersionInfo }>
  agentVersionUpgrade(tool: ToolId): Promise<{ ok: boolean; message: string }>
  agentVersionCancel(tool: ToolId): Promise<{ ok: boolean }>
  onAgentUpgradeProgress(cb: (p: { tool: ToolId; line: string }) => void): () => void
  /** 会话导出为 Markdown 文件（v0.8.8，主进程弹保存对话框） */
  sessionsExportMd(tool: ToolId, file: string): Promise<{ savedTo?: string; canceled?: boolean; error?: string }>
  /** 提示词库（v0.8.9）：管理并应用到 CLAUDE.md / AGENTS.md */
  promptsList(): Promise<{ prompts: StoredPrompt[]; current: { claude: CurrentPromptFile; codex: CurrentPromptFile } }>
  promptsSave(input: { id?: string; tool: ToolId; name: string; content: string }): Promise<StoredPrompt>
  promptsDelete(id: string): Promise<boolean>
  promptsApply(id: string): Promise<{ claude?: boolean; codex?: boolean }>
  promptsImportCurrent(tool: ToolId): Promise<StoredPrompt>
  /** 方案组（v0.8.9）：一键切换整套供应商组合 */
  groupsList(): Promise<ProviderGroup[]>
  groupsSave(input: { id?: string; name: string; members: { claude: string | null; codex: string | null } }): Promise<ProviderGroup>
  groupsDelete(id: string): Promise<boolean>
  groupsApply(id: string): Promise<{ switched: ToolId[]; skipped: string[] }>
  /** Skills 管理（v0.8.10）：Claude（~/.claude/skills）与 Codex（~/.codex/skills） */
  skillsList(tool: ToolId): Promise<SkillInfo[]>
  skillsInstallGithub(tool: ToolId, url: string): Promise<{ installed: string[]; skipped: string[] }>
  skillsInstallZip(tool: ToolId): Promise<{ installed: string[]; skipped: string[]; canceled?: boolean }>
  skillsDelete(tool: ToolId, name: string): Promise<boolean>
  skillsUpdate(tool: ToolId, name: string): Promise<{ installed: string[] }>
  skillsUpdateAll(tool: ToolId): Promise<{ installed: string[]; failed: string[] }>
  skillsRead(tool: ToolId, name: string): Promise<{ content: string }>
  clearAllData(): Promise<{ removed: string[] }>
  onDeeplinkProvider(cb: (r: DeeplinkResult) => void): () => void
  /** 拉取并清除主进程缓存的一条深链（冷启动推送竞态的兜底，v0.8.7）；无则返回 null */
  deeplinkTake(): Promise<DeeplinkResult | null>
  settingsUpdate(patch: Partial<AppSettings>): Promise<AppSettings>
  /** 主进程侧写剪贴板（渲染层 navigator.clipboard 会被权限加固拒绝，走 IPC 才可靠） */
  copyText(text: string): Promise<boolean>
  openPath(kind: 'data' | 'claudeConfig' | 'codexConfig'): Promise<void>
  appVersion(): Promise<string>
  updateCheck(): Promise<{ version?: string | null; current?: string; error?: string }>
  updateDownload(): Promise<{ ok?: boolean; error?: string }>
  updateCancel(): Promise<{ ok?: boolean; error?: string }>
  updateInstall(): Promise<{ ok?: boolean; error?: string }>
  onUpdateAvailable(cb: (p: { version: string }) => void): () => void
  onUpdateProgress(cb: (p: { percent: number; transferred?: number; total?: number; bytesPerSecond?: number }) => void): () => void
  onUpdateDownloaded(cb: () => void): () => void
  /** 托盘等主进程侧变更了供应商库时推送，渲染层据此刷新 */
  onStoreChanged(cb: () => void): () => void
  openReleases(): Promise<void>
}
