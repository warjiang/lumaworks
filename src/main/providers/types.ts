export interface ProgressUpdate { progress?: number; message?: string }
export type ProgressReporter = (update: ProgressUpdate) => void

export interface ProviderTraceEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  phase: string
  message: string
  details?: Record<string, unknown>
}
export type ProviderTrace = (entry: Omit<ProviderTraceEntry, 'timestamp'>) => void

export interface TextProvider {
  generateJson<T>(prompt: string, validate: (value: unknown) => T, options?: { contractName?: string; signal?: AbortSignal }): Promise<T>
}

export interface ImageProvider {
  generateImage(input: { prompt: string; referencePaths?: string[]; aspectRatio?: string; signal?: AbortSignal }): Promise<{ url: string }>
}

export interface VideoProvider {
  generateVideo(input: { prompt: string; imagePath: string; lastFramePath?: string; durationSeconds?: number; returnLastFrame?: boolean; resolution?: string }, report?: ProgressReporter, signal?: AbortSignal): Promise<{ url: string; externalId: string; lastFrameUrl?: string }>
}

export interface SpeechWordTiming { word: string; startMs: number; endMs: number }
export interface SpeechSentenceTiming { text: string; words: SpeechWordTiming[] }

export interface SpeechProvider {
  synthesize(input: { text: string; voiceId?: string; locale: 'zh-CN' | 'en-US'; outputPath: string; contextTexts?: string[]; enableSubtitle?: boolean; signal?: AbortSignal }): Promise<{ path: string; requestId: string; logId?: string; bytes: number; usageTextWords?: number; subtitles?: SpeechSentenceTiming[] }>
}

export interface ProviderSettings {
  arkApiKey: string
  arkTextModel: string
  arkTextApi: 'responses' | 'chat-completions'
  arkTextStream: boolean
  seedreamModel: string
  seedanceModel: string
  speechApiKey: string
  speechAppId: string
  speechAccessToken: string
  speechResourceId: string
  speechVoiceId: string
  speechEnglishVoiceId: string
}
