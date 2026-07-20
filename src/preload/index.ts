import { contextBridge, ipcRenderer } from 'electron'
import type { LumaWorksApi } from '@shared/ipc'
import { IPC } from '@shared/ipc'

const api: LumaWorksApi = {
  getDashboard: (projectId) => ipcRenderer.invoke(IPC.dashboard, projectId),
  createProject: (input) => ipcRenderer.invoke(IPC.createProject, input),
  selectProject: (projectId) => ipcRenderer.invoke(IPC.selectProject, projectId),
  enqueueJob: (input) => ipcRenderer.invoke(IPC.enqueueJob, input),
  cancelJob: (jobId) => ipcRenderer.invoke(IPC.cancelJob, jobId),
  retryJob: (jobId) => ipcRenderer.invoke(IPC.retryJob, jobId),
  saveSettings: (input) => ipcRenderer.invoke(IPC.saveSettings, input),
  testModel: (kind) => ipcRenderer.invoke(IPC.testModel, kind),
  createPublishDrafts: (input) => ipcRenderer.invoke(IPC.createPublishDrafts, input),
  approvePublishDraft: (draftId) => ipcRenderer.invoke(IPC.approvePublishDraft, draftId),
  connectPlatform: (platform) => ipcRenderer.invoke(IPC.connectPlatform, platform),
  revealPath: (path) => ipcRenderer.invoke(IPC.revealPath, path),
  openProjectDirectory: (projectId) => ipcRenderer.invoke(IPC.openProjectDirectory, projectId),
  updateCharacterVoice: (input) => ipcRenderer.invoke(IPC.updateCharacterVoice, input),
  previewCharacterVoice: (characterId, locale) => ipcRenderer.invoke(IPC.previewCharacterVoice, characterId, locale),
  getJobDetails: (jobId) => ipcRenderer.invoke(IPC.jobDetails, jobId),
  listSystemEvents: (filters) => ipcRenderer.invoke(IPC.systemEvents, filters),
  exportJobDiagnostics: (jobId) => ipcRenderer.invoke(IPC.exportJobDiagnostics, jobId),
  clearDiagnostics: () => ipcRenderer.invoke(IPC.clearDiagnostics),
  reportRendererError: (error) => ipcRenderer.invoke(IPC.reportRendererError, error),
  onJobEvent: (listener) => { const handler = (_event: Electron.IpcRendererEvent, job: Parameters<typeof listener>[0]) => listener(job); ipcRenderer.on(IPC.jobEvent, handler); return () => ipcRenderer.removeListener(IPC.jobEvent, handler) },
  onDiagnosticEvent: (listener) => { const handler = (_event: Electron.IpcRendererEvent, entry: Parameters<typeof listener>[0]) => listener(entry); ipcRenderer.on(IPC.diagnosticEvent, handler); return () => ipcRenderer.removeListener(IPC.diagnosticEvent, handler) },
}
contextBridge.exposeInMainWorld('lumaworks', api)
