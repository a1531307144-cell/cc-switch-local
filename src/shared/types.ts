export type ToolId = 'claude' | 'codex'
export type KeyType = 'auth_token' | 'api_key'
export type ThemeMode = 'system' | 'light' | 'dark'
export type Lang = 'zh' | 'en'
/** 接口协议（claude 工具用）：anthropic=标准 Claude 端点；openai=OpenAI 兼容（经本机路由协议转换） */
export type Protocol = 'anthropic' | 'openai'

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
  /** codex 专用：自定义 provider 的 wire_api */
  wireApi?: 'responses' | 'chat'
  notes?: string
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
  notes?: string
}

export interface AppSettings {
  autoUpdate: boolean
  autoStart: boolean
  theme: ThemeMode
  /** 界面语言（v0.7.0 起；缺省 zh） */
  language?: Lang
  /** 侧栏折叠（v0.8.0 起；缺省展开） */
  sidebarCollapsed?: boolean
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
  clearAllData(): Promise<{ removed: string[] }>
  onDeeplinkProvider(cb: (r: DeeplinkResult) => void): () => void
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
