import { z } from 'zod'

export const projectStageSchema = z.enum(['concept', 'script', 'assets', 'storyboard', 'video', 'render', 'publish'])
export type ProjectStage = z.infer<typeof projectStageSchema>

export const jobStatusSchema = z.enum(['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled'])
export type JobStatus = z.infer<typeof jobStatusSchema>

export const jobTypeSchema = z.enum([
  'story-bible', 'story-foundation', 'story-characters', 'story-locations', 'story-episodes', 'story-bible-assemble',
  'episode-script', 'character-image', 'location-image', 'shot-image', 'shot-grid-image',
  'shot-video', 'dialogue-timing', 'voice-line', 'translate-episode', 'render-episode', 'publish',
])
export type JobType = z.infer<typeof jobTypeSchema>

export const progressModeSchema = z.enum(['indeterminate', 'determinate'])
export type ProgressMode = z.infer<typeof progressModeSchema>

export const diagnosticLevelSchema = z.enum(['debug', 'info', 'warn', 'error'])
export type DiagnosticLevel = z.infer<typeof diagnosticLevelSchema>

export const diagnosticScopeSchema = z.enum(['job', 'provider', 'media', 'renderer', 'publisher', 'app'])
export type DiagnosticScope = z.infer<typeof diagnosticScopeSchema>

export const platformSchema = z.enum(['xiaohongshu', 'tiktok', 'youtube'])
export type Platform = z.infer<typeof platformSchema>

export const localeSchema = z.enum(['zh-CN', 'en-US'])
export type ContentLocale = z.infer<typeof localeSchema>

export const voicePresetIdSchema = z.enum(['narrator', 'young-female', 'mature-female', 'young-male', 'mature-male', 'elder-male', 'elder-female', 'cold-villain'])
export type VoicePresetId = z.infer<typeof voicePresetIdSchema>

export interface CharacterVoice {
  id: string
  projectId: string
  name: string
  role: string
  description: string
  voiceDescription: string
  voicePreset: VoicePresetId
  zhVoiceId: string
  enVoiceId: string
  zhVoiceWarning: string | null
  enVoiceWarning: string | null
  voiceLocked: boolean
  referenceAssetId: string | null
}

export interface VoiceLine {
  id: string
  episodeId: string
  shotId: string | null
  shotPosition: number | null
  locale: ContentLocale
  position: number
  speaker: string
  text: string
  spokenText: string
  originalStartMs: number
  originalEndMs: number
  startMs: number
  endMs: number
  voiceId: string | null
  audioPath: string | null
  audioDurationMs: number | null
  planVersion: string | null
  chunks: Array<{ text: string; startMs: number; endMs: number }> | null
}

export interface DialoguePlanSummary {
  episodeId: string
  locale: ContentLocale
  status: 'stale' | 'ready' | 'voiced'
  version: string | null
  durationMs: number
  lineCount: number
  updatedAt: string | null
}

export interface Project {
  id: string
  title: string
  synopsis: string
  visualStyle: string
  aspectRatio: '9:16'
  stage: ProjectStage
  autoAdvance: boolean
  createdAt: string
  updatedAt: string
}

export interface StoryBible {
  world: string
  visualDirection: string
  logline: string
  characters: Array<{ name: string; role: string; appearance: string; personality: string; voice: string }>
  locations: Array<{ name: string; description: string; visualPrompt: string }>
  episodes: Array<{ number: number; title: string; summary: string; hook: string; cliffhanger: string }>
}

export interface Episode {
  id: string
  projectId: string
  number: number
  title: string
  summary: string
  scriptJson: string | null
  approved: boolean
  createdAt: string
  updatedAt: string
}

export interface ShotDirection {
  sceneType: string
  shotType: string
  cameraMove: string
  location: string
  sourceText: string
  carryOver: string
  actingNotes: string
}

export interface Shot {
  id: string
  episodeId: string
  position: number
  title: string
  description: string
  imagePrompt: string
  videoPrompt: string
  durationSeconds: number
  status: 'draft' | 'image-ready' | 'video-ready' | 'failed'
  characters: string[]
  direction: ShotDirection | null
  imagePath: string | null
  videoPath: string | null
  updatedAt: string
}

export interface Job {
  id: string
  type: JobType
  status: JobStatus
  entityId: string
  projectId: string | null
  payloadJson: string
  resultJson: string | null
  error: string | null
  progress: number
  progressMode: ProgressMode
  currentPhase: string | null
  currentMessage: string | null
  attempts: number
  maxAttempts: number
  scheduledAt: string
  startedAt: string | null
  finishedAt: string | null
  heartbeatAt: string | null
  idempotencyKey: string
  createdAt: string
  updatedAt: string
}

export interface ProgressState {
  mode: ProgressMode
  value?: number
  current?: number
  total?: number
  unit?: string
}

export interface DiagnosticEvent {
  id: string
  jobId: string | null
  projectId: string | null
  attempt: number | null
  sequence: number
  timestamp: string
  level: DiagnosticLevel
  scope: DiagnosticScope
  phase: string
  message: string
  progress: ProgressState | null
  details?: Record<string, unknown>
  payloadAvailable: boolean
}

export interface JobDetails {
  job: Job
  events: DiagnosticEvent[]
}

export interface SystemEventFilters {
  level?: DiagnosticLevel
  limit?: number
}

export interface PublishDraft {
  id: string
  renderId: string
  platform: Platform
  title: string
  description: string
  tags: string[]
  coverPath: string | null
  scheduledAt: string | null
  visibility: 'public' | 'private' | 'unlisted'
  approved: boolean
}

export interface DashboardSnapshot {
  projects: Project[]
  activeProject: (Project & { episodes: Episode[]; shots: Shot[]; characters: CharacterVoice[]; dialoguePlans: DialoguePlanSummary[] }) | null
  jobs: Job[]
  publishDrafts: PublishDraft[]
  renders: Array<{ id: string; episodeId: string; locale: string; status: string; videoPath: string | null; coverPath: string | null; createdAt: string }>
  configured: { ark: boolean; speech: boolean; tiktok: boolean; youtube: boolean }
  modelSettings: {
    arkTextModel: string
    arkTextApi: 'responses' | 'chat-completions'
    arkTextStream: boolean
    seedreamModel: string
    seedanceModel: string
    speechResourceId: string
    speechVoiceId: string
    speechEnglishVoiceId: string
  }
}

export const createProjectInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  synopsis: z.string().trim().min(20).max(20_000),
  visualStyle: z.string().trim().min(1).default('cinematic realism'),
})
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>

export const enqueueJobInputSchema = z.object({
  type: jobTypeSchema,
  entityId: z.string().min(1),
  payload: z.record(z.unknown()).default({}),
  scheduledAt: z.string().datetime().optional(),
  force: z.boolean().default(false),
})
export type EnqueueJobInput = z.infer<typeof enqueueJobInputSchema>

export const updateCharacterVoiceSchema = z.object({
  id: z.string().min(1),
  voicePreset: voicePresetIdSchema,
  zhVoiceId: z.string().trim().min(1),
  enVoiceId: z.string().trim().min(1),
  voiceLocked: z.boolean().default(true),
})
export type UpdateCharacterVoiceInput = z.infer<typeof updateCharacterVoiceSchema>

export const saveSettingsInputSchema = z.object({
  arkApiKey: z.string().optional(),
  arkTextModel: z.string().default('doubao-seed-2-1-turbo-260628'),
  arkTextApi: z.enum(['responses', 'chat-completions']).default('responses'),
  arkTextStream: z.enum(['true', 'false']).default('true'),
  seedreamModel: z.string().default('doubao-seedream-5-0-pro-260628'),
  seedanceModel: z.string().default('doubao-seedance-2-0-fast-260128'),
  speechApiKey: z.string().optional(),
  speechAppId: z.string().optional(),
  speechAccessToken: z.string().optional(),
  speechResourceId: z.string().trim().min(1).default('seed-tts-2.0'),
  speechVoiceId: z.string().trim().min(1).default('zh_female_vv_uranus_bigtts'),
  speechEnglishVoiceId: z.string().trim().min(1).default('en_female_dacey_uranus_bigtts'),
  tiktokClientKey: z.string().optional(),
  tiktokClientSecret: z.string().optional(),
  youtubeClientId: z.string().optional(),
  youtubeClientSecret: z.string().optional(),
  tiktokAccessToken: z.string().optional(),
  youtubeAccessToken: z.string().optional(),
  youtubeRefreshToken: z.string().optional(),
})
export type SaveSettingsInput = z.infer<typeof saveSettingsInputSchema>

export const modelTestKindSchema = z.enum(['text', 'image', 'video', 'speech'])
export type ModelTestKind = z.infer<typeof modelTestKindSchema>

export interface ModelTestResult {
  kind: ModelTestKind
  ok: boolean
  model: string
  elapsedMs: number
  message: string
  outputPath?: string
  previewText?: string
  externalId?: string
  requestId: string
  logPath: string
  diagnostics: Array<{
    timestamp: string
    level: 'info' | 'warn' | 'error'
    phase: string
    message: string
    details?: Record<string, unknown>
  }>
}

export const publishDraftInputSchema = z.object({
  renderId: z.string().min(1),
  platforms: z.array(platformSchema).min(1),
  title: z.string().min(1),
  description: z.string().default(''),
  tags: z.array(z.string()).max(30).default([]),
  coverPath: z.string().nullable().default(null),
  scheduledAt: z.string().datetime().nullable().default(null),
  visibility: z.enum(['public', 'private', 'unlisted']).default('public'),
})
export type PublishDraftInput = z.infer<typeof publishDraftInputSchema>

export const rendererErrorSchema = z.object({
  level: z.enum(['warn', 'error']).default('error'),
  message: z.string().trim().min(1).max(4_000),
  stack: z.string().max(20_000).optional(),
  source: z.string().max(500).optional(),
})
export type RendererErrorInput = z.infer<typeof rendererErrorSchema>
