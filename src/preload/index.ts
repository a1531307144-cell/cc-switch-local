import { contextBridge, ipcRenderer } from 'electron'
import type { Api, AppSettings, ProviderInput, TestInput, ToolId } from '../shared/types'

const api: Api = {
  storeGet: () => ipcRenderer.invoke('store:get'),
  providerSave: (input: ProviderInput) => ipcRenderer.invoke('provider:save', input),
  providerDelete: (id: string) => ipcRenderer.invoke('provider:delete', id),
  providerSwitch: (tool: ToolId, id: string | null) => ipcRenderer.invoke('provider:switch', tool, id),
  toolImportCurrent: (tool: ToolId) => ipcRenderer.invoke('tool:importCurrent', tool),
  toolStatus: (tool: ToolId) => ipcRenderer.invoke('tool:status', tool),
  toolBackups: (tool: ToolId) => ipcRenderer.invoke('tool:backups', tool),
  toolRestoreBackup: (tool: ToolId, file: string) => ipcRenderer.invoke('tool:restoreBackup', tool, file),
  providerTest: (input: TestInput) => ipcRenderer.invoke('provider:test', input),
  ccswitchImport: () => ipcRenderer.invoke('ccswitch:import'),
  presetsGet: () => ipcRenderer.invoke('presets:get'),
  settingsUpdate: (patch: Partial<AppSettings>) => ipcRenderer.invoke('settings:update', patch),
  openPath: (kind: 'data' | 'claudeConfig' | 'codexConfig') => ipcRenderer.invoke('app:openPath', kind),
  appVersion: () => ipcRenderer.invoke('app:version'),
  updateCheck: () => ipcRenderer.invoke('update:check')
}

contextBridge.exposeInMainWorld('api', api)
