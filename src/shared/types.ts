export type ToolId = 'claude' | 'codex'
export type KeyType = 'auth_token' | 'api_key'
export type ThemeMode = 'system' | 'light' | 'dark'

export interface Provider {
  id: string
  tool: ToolId
  name: string
  baseUrl: string
  apiKey: string
  /** claude 用：写入 ANTHROPIC_AUTH_TOKEN 或 ANTHROPIC_API_KEY；codex 忽略（固定写 auth.json） */
  keyType: KeyType
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
  model?: string
  wireApi?: 'responses' | 'chat'
  notes?: string
}

export interface AppSettings {
  autoUpdate: boolean
  autoStart: boolean
  theme: ThemeMode
}

export interface StoreShape {
  version: 1
  current: Record<ToolId, string | null>
  providers: Provider[]
  settings: AppSettings
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
  notes?: string
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
  model?: string
}

export interface Api {
  storeGet(): Promise<StoreShape>
  providerSave(input: ProviderInput): Promise<Provider>
  providerDelete(id: string): Promise<boolean>
  providerSwitch(tool: ToolId, id: string | null): Promise<SwitchResult>
  toolImportCurrent(tool: ToolId): Promise<Provider | null>
  toolStatus(tool: ToolId): Promise<ToolStatus>
  toolBackups(tool: ToolId): Promise<BackupInfo[]>
  toolRestoreBackup(tool: ToolId, file: string): Promise<SwitchResult>
  providerTest(input: TestInput): Promise<TestResult>
  ccswitchImport(): Promise<ImportReport>
  presetsGet(): Promise<Preset[]>
  settingsUpdate(patch: Partial<AppSettings>): Promise<AppSettings>
  openPath(kind: 'data' | 'claudeConfig' | 'codexConfig'): Promise<void>
  appVersion(): Promise<string>
  updateCheck(): Promise<{ version?: string | null; current?: string; error?: string }>
  updateDownload(): Promise<{ ok?: boolean; error?: string }>
  updateCancel(): Promise<{ ok?: boolean; error?: string }>
  updateInstall(): Promise<{ ok?: boolean; error?: string }>
  onUpdateAvailable(cb: (p: { version: string }) => void): () => void
  onUpdateProgress(cb: (p: { percent: number; transferred?: number; total?: number; bytesPerSecond?: number }) => void): () => void
  onUpdateDownloaded(cb: () => void): () => void
  openReleases(): Promise<void>
}
