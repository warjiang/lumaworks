import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  encrypted: integer('encrypted', { mode: 'boolean' }).notNull().default(false),
  updatedAt: text('updated_at').notNull(),
})

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(), title: text('title').notNull(), synopsis: text('synopsis').notNull(),
  visualStyle: text('visual_style').notNull(), aspectRatio: text('aspect_ratio').notNull(), stage: text('stage').notNull(),
  autoAdvance: integer('auto_advance', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
})

export const storyBibles = sqliteTable('story_bibles', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().unique(), contentJson: text('content_json').notNull(),
  approved: integer('approved', { mode: 'boolean' }).notNull().default(false), version: integer('version').notNull().default(1),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
})

export const episodes = sqliteTable('episodes', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull(), number: integer('number').notNull(),
  title: text('title').notNull(), summary: text('summary').notNull(), scriptJson: text('script_json'),
  approved: integer('approved', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [uniqueIndex('episodes_project_number_idx').on(table.projectId, table.number)])

export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull(), name: text('name').notNull(), role: text('role').notNull(),
  description: text('description').notNull(), voiceId: text('voice_id'), voiceDescription: text('voice_description'), voicePreset: text('voice_preset'),
  zhVoiceId: text('zh_voice_id'), enVoiceId: text('en_voice_id'), zhVoiceWarning: text('zh_voice_warning'), enVoiceWarning: text('en_voice_warning'), voiceLocked: integer('voice_locked', { mode: 'boolean' }).notNull().default(false), referenceAssetId: text('reference_asset_id'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
})

export const locations = sqliteTable('locations', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull(), name: text('name').notNull(),
  description: text('description').notNull(), referenceAssetId: text('reference_asset_id'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
})

export const shots = sqliteTable('shots', {
  id: text('id').primaryKey(), episodeId: text('episode_id').notNull(), position: integer('position').notNull(),
  title: text('title').notNull(), description: text('description').notNull(), imagePrompt: text('image_prompt').notNull(),
  videoPrompt: text('video_prompt').notNull(), durationSeconds: integer('duration_seconds').notNull(), status: text('status').notNull(),
  imagePath: text('image_path'), videoPath: text('video_path'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [uniqueIndex('shots_episode_position_idx').on(table.episodeId, table.position)])

export const assets = sqliteTable('assets', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull(), entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(), kind: text('kind').notNull(), locale: text('locale'), path: text('path').notNull(),
  sourceUrl: text('source_url'), metadataJson: text('metadata_json').notNull(), revision: integer('revision').notNull(),
  createdAt: text('created_at').notNull(),
})

export const voiceLines = sqliteTable('voice_lines', {
  id: text('id').primaryKey(), episodeId: text('episode_id').notNull(), shotId: text('shot_id'), locale: text('locale').notNull(),
  position: integer('position').notNull(), speaker: text('speaker').notNull(), text: text('text').notNull(),
  spokenText: text('spoken_text'), shotPosition: integer('shot_position'), originalStartMs: integer('original_start_ms'), originalEndMs: integer('original_end_ms'),
  startMs: integer('start_ms').notNull(), endMs: integer('end_ms').notNull(), voiceId: text('line_voice_id'), audioPath: text('audio_path'), audioDurationMs: integer('audio_duration_ms'), planVersion: text('plan_version'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
})

export const dialoguePlans = sqliteTable('dialogue_plans', {
  episodeId: text('episode_id').notNull(), locale: text('locale').notNull(), status: text('status').notNull(),
  version: text('version'), durationMs: integer('duration_ms').notNull(), lineCount: integer('line_count').notNull(), updatedAt: text('updated_at').notNull(),
}, (table) => [uniqueIndex('dialogue_plans_episode_locale_idx').on(table.episodeId, table.locale)])

export const renderVariants = sqliteTable('render_variants', {
  id: text('id').primaryKey(), episodeId: text('episode_id').notNull(), locale: text('locale').notNull(),
  status: text('status').notNull(), videoPath: text('video_path'), masterPath: text('master_path'),
  subtitlePath: text('subtitle_path'), coverPath: text('cover_path'), configJson: text('config_json').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
})

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(), type: text('type').notNull(), status: text('status').notNull(), entityId: text('entity_id').notNull(),
  projectId: text('project_id'),
  payloadJson: text('payload_json').notNull(), resultJson: text('result_json'), error: text('error'), progress: integer('progress').notNull(),
  progressMode: text('progress_mode').notNull().default('indeterminate'), currentPhase: text('current_phase'), currentMessage: text('current_message'),
  attempts: integer('attempts').notNull(), maxAttempts: integer('max_attempts').notNull(), scheduledAt: text('scheduled_at').notNull(),
  startedAt: text('started_at'), finishedAt: text('finished_at'), heartbeatAt: text('heartbeat_at'),
  idempotencyKey: text('idempotency_key').notNull().unique(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
})

export const diagnosticEvents = sqliteTable('diagnostic_events', {
  id: text('id').primaryKey(), jobId: text('job_id'), projectId: text('project_id'), attempt: integer('attempt'), sequence: integer('sequence').notNull(),
  timestamp: text('timestamp').notNull(), level: text('level').notNull(), scope: text('scope').notNull(), phase: text('phase').notNull(),
  message: text('message').notNull(), progressJson: text('progress_json'), summaryJson: text('summary_json'), encryptedPayload: text('encrypted_payload'),
  sizeBytes: integer('size_bytes').notNull().default(0),
})

export const platformAccounts = sqliteTable('platform_accounts', {
  id: text('id').primaryKey(), platform: text('platform').notNull().unique(), displayName: text('display_name').notNull(),
  credentialsKey: text('credentials_key'), status: text('status').notNull(), metadataJson: text('metadata_json').notNull(),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
})

export const publishDrafts = sqliteTable('publish_drafts', {
  id: text('id').primaryKey(), renderId: text('render_id').notNull(), platform: text('platform').notNull(),
  title: text('title').notNull(), description: text('description').notNull(), tagsJson: text('tags_json').notNull(),
  coverPath: text('cover_path'), scheduledAt: text('scheduled_at'), visibility: text('visibility').notNull(),
  approved: integer('approved', { mode: 'boolean' }).notNull().default(false), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
})

export const publishJobs = sqliteTable('publish_jobs', {
  id: text('id').primaryKey(), draftId: text('draft_id').notNull().unique(), platform: text('platform').notNull(),
  externalId: text('external_id'), status: text('status').notNull(), resultUrl: text('result_url'), error: text('error'),
  attempts: integer('attempts').notNull(), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
})
