import { contextBridge, ipcRenderer } from 'electron'
import type { Api, AppSettings, DeeplinkResult, McpServerSpec, ProviderInput, TestInput, ToolId } from '../shared/types'

const api: Api = {
  storeGet: () => ipcRenderer.invoke('store:get'),
  providerSave: (input: ProviderInput) => ipcRenderer.invoke('provider:save', input),
  providerDelete: (id: string) => ipcRenderer.invoke('provider:delete', id),
  providerClone: (id: string) => ipcRenderer.invoke('provider:clone', id),
  providersReorder: (tool: ToolId, ids: string[]) => ipcRenderer.invoke('providers:reorder', tool, ids),
  providerSwitch: (tool: ToolId, id: string | null) => ipcRenderer.invoke('provider:switch', tool, id),
  toolImportCurrent: (tool: ToolId) => ipcRenderer.invoke('tool:importCurrent', tool),
  toolStatus: (tool: ToolId) => ipcRenderer.invoke('tool:status', tool),
  toolBackups: (tool: ToolId) => ipcRenderer.invoke('tool:backups', tool),
  toolRestoreBackup: (tool: ToolId, file: string) => ipcRenderer.invoke('tool:restoreBackup', tool, file),
  providerTest: (input: TestInput) => ipcRenderer.invoke('provider:test', input),
  ccswitchImport: () => ipcRenderer.invoke('ccswitch:import'),
  presetsGet: () => ipcRenderer.invoke('presets:get'),
  backupExport: (passphrase: string) => ipcRenderer.invoke('backup:export', passphrase),
  backupImport: (passphrase: string) => ipcRenderer.invoke('backup:import', passphrase),
  usageGet: () => ipcRenderer.invoke('usage:get'),
  sessionsList: (tool: ToolId) => ipcRenderer.invoke('sessions:list', tool),
  sessionsRead: (tool: ToolId, file: string) => ipcRenderer.invoke('sessions:read', tool, file),
  mcpList: (tool: ToolId) => ipcRenderer.invoke('mcp:list', tool),
  mcpSave: (tool: ToolId, spec: McpServerSpec) => ipcRenderer.invoke('mcp:save', tool, spec),
  mcpDelete: (tool: ToolId, name: string) => ipcRenderer.invoke('mcp:delete', tool, name),
  storeUnlock: (passphrase: string) => ipcRenderer.invoke('master:unlock', passphrase),
  masterSet: (passphrase: string) => ipcRenderer.invoke('master:set', passphrase),
  masterRemove: (passphrase: string) => ipcRenderer.invoke('master:remove', passphrase),
  masterStatus: () => ipcRenderer.invoke('master:status'),
  routerStatus: () => ipcRenderer.invoke('router:status'),
  routerSet: (tool: ToolId, enabled: boolean) => ipcRenderer.invoke('router:set', tool, enabled),
  routerSetAggregate: (tool: ToolId, enabled: boolean) => ipcRenderer.invoke('router:setAggregate', tool, enabled),
  balanceGet: (input: { baseUrl: string; apiKey: string }) => ipcRenderer.invoke('balance:get', input),
  clearAllData: () => ipcRenderer.invoke('data:clearAll'),
  onDeeplinkProvider: (cb: (r: DeeplinkResult) => void) => {
    const l = (_e: unknown, r: DeeplinkResult) => cb(r)
    ipcRenderer.on('deeplink:provider', l)
    return () => ipcRenderer.removeListener('deeplink:provider', l)
  },
  settingsUpdate: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:update', patch),
  copyText: (text: string) => ipcRenderer.invoke('app:copyText', text),
  openPath: (kind: 'data' | 'claudeConfig' | 'codexConfig') => ipcRenderer.invoke('app:openPath', kind),
  appVersion: () => ipcRenderer.invoke('app:version'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateCancel: () => ipcRenderer.invoke('update:cancel'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateAvailable: (cb: (p: { version: string }) => void) => {
    const l = (_e: unknown, p: { version: string }) => cb(p)
    ipcRenderer.on('update:available', l)
    return () => ipcRenderer.removeListener('update:available', l as never)
  },
  onUpdateProgress: (cb: (p: { percent: number; transferred?: number; total?: number; bytesPerSecond?: number }) => void) => {
    const l = (_e: unknown, p: { percent: number; transferred?: number; total?: number; bytesPerSecond?: number }) => cb(p)
    ipcRenderer.on('update:progress', l)
    return () => ipcRenderer.removeListener('update:progress', l as never)
  },
  onUpdateDownloaded: (cb: () => void) => {
    const l = () => cb()
    ipcRenderer.on('update:downloaded', l)
    return () => ipcRenderer.removeListener('update:downloaded', l)
  },
  onStoreChanged: (cb: () => void) => {
    const l = () => cb()
    ipcRenderer.on('store:changed', l)
    return () => ipcRenderer.removeListener('store:changed', l)
  },
  openReleases: () => ipcRenderer.invoke('app:openReleases')
}

contextBridge.exposeInMainWorld('api', api)
