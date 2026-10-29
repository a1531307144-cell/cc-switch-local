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
  openReleases: () => ipcRenderer.invoke('app:openReleases')
}

contextBridge.exposeInMainWorld('api', api)
