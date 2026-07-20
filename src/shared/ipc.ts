import type { ContentLocale, CreateProjectInput, DashboardSnapshot, DiagnosticEvent, EnqueueJobInput, Job, JobDetails, ModelTestKind, ModelTestResult, PublishDraftInput, RendererErrorInput, SaveSettingsInput, SystemEventFilters, UpdateCharacterVoiceInput } from './domain'

export const IPC = {
  dashboard: 'dashboard:get',
  createProject: 'project:create',
  selectProject: 'project:select',
  enqueueJob: 'job:enqueue',
  cancelJob: 'job:cancel',
  retryJob: 'job:retry',
  saveSettings: 'settings:save',
  testModel: 'settings:test-model',
  createPublishDrafts: 'publish:drafts:create',
  approvePublishDraft: 'publish:draft:approve',
  connectPlatform: 'platform:connect',
  revealPath: 'system:reveal-path',
  openProjectDirectory: 'project:open-directory',
  updateCharacterVoice: 'character:update-voice',
  previewCharacterVoice: 'character:preview-voice',
  jobDetails: 'job:details',
  systemEvents: 'diagnostics:system-events',
  exportJobDiagnostics: 'diagnostics:export-job',
  clearDiagnostics: 'diagnostics:clear',
  reportRendererError: 'diagnostics:renderer-error',
  jobEvent: 'job:event',
  diagnosticEvent: 'diagnostics:event',
} as const

export interface LumaWorksApi {
  getDashboard(projectId?: string): Promise<DashboardSnapshot>
  createProject(input: CreateProjectInput): Promise<string>
  selectProject(projectId: string): Promise<DashboardSnapshot>
  enqueueJob(input: EnqueueJobInput): Promise<Job>
  cancelJob(jobId: string): Promise<void>
  retryJob(jobId: string): Promise<Job>
  saveSettings(input: SaveSettingsInput): Promise<void>
  testModel(kind: ModelTestKind): Promise<ModelTestResult>
  createPublishDrafts(input: PublishDraftInput): Promise<string[]>
  approvePublishDraft(draftId: string): Promise<Job>
  connectPlatform(platform: 'xiaohongshu' | 'tiktok' | 'youtube'): Promise<{ connected: boolean; message: string }>
  revealPath(path: string): Promise<void>
  openProjectDirectory(projectId: string): Promise<void>
  updateCharacterVoice(input: UpdateCharacterVoiceInput): Promise<void>
  previewCharacterVoice(characterId: string, locale: ContentLocale): Promise<{ path: string; warning?: string }>
  getJobDetails(jobId: string): Promise<JobDetails>
  listSystemEvents(filters?: SystemEventFilters): Promise<DiagnosticEvent[]>
  exportJobDiagnostics(jobId: string): Promise<{ cancelled: boolean; path?: string }>
  clearDiagnostics(): Promise<void>
  reportRendererError(error: RendererErrorInput): Promise<void>
  onJobEvent(listener: (job: Job) => void): () => void
  onDiagnosticEvent(listener: (event: DiagnosticEvent) => void): () => void
}
