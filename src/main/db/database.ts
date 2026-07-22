import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { CharacterVoice, ContentLocale, CreateProjectInput, DashboardSnapshot, DiagnosticLevel, DiagnosticScope, DialoguePlanSummary, Episode, Job, JobType, Project, PublishDraft, PublishDraftInput, Shot, ShotDirection, StoryBible, UpdateProjectInput, VoiceLine, VoicePresetId } from '@shared/domain'
import { inferVoicePreset, isLegacyTts1Voice, voicePreset } from '@shared/voices'
import * as schema from './schema'

const now = () => new Date().toISOString()

const SHOT_SELECT = `id, episode_id episodeId, position, title, description, image_prompt imagePrompt, video_prompt videoPrompt, duration_seconds durationSeconds, status, characters_json charactersJson, direction_json directionJson, image_path imagePath, video_path videoPath, updated_at updatedAt`

function parseCharactersJson(value: unknown): string[] {
  if (typeof value !== 'string' || !value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : []
  } catch { return [] }
}

function parseDirectionJson(value: unknown): ShotDirection | null {
  if (typeof value !== 'string' || !value) return null
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return null
    const text = (key: keyof ShotDirection): string => typeof parsed[key] === 'string' ? parsed[key] as string : ''
    const direction: ShotDirection = { sceneType: text('sceneType') || 'daily', shotType: text('shotType'), cameraMove: text('cameraMove'), location: text('location'), sourceText: text('sourceText'), carryOver: text('carryOver'), actingNotes: text('actingNotes') }
    if (!direction.shotType && !direction.cameraMove && !direction.location && !direction.sourceText && !direction.carryOver && !direction.actingNotes) return null
    return direction
  } catch { return null }
}

function parseChunksJson(value: unknown): VoiceLine['chunks'] {
  if (typeof value !== 'string' || !value) return null
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return null
    const chunks = parsed.filter((item): item is { text: string; startMs: number; endMs: number } => Boolean(item) && typeof item === 'object'
      && typeof (item as { text?: unknown }).text === 'string'
      && Number.isFinite((item as { startMs?: unknown }).startMs)
      && Number.isFinite((item as { endMs?: unknown }).endMs))
    return chunks.length ? chunks : null
  } catch { return null }
}

function mapShotRow(row: Record<string, unknown>): Shot {
  const { charactersJson, directionJson, ...rest } = row
  return { ...rest, characters: parseCharactersJson(charactersJson), direction: parseDirectionJson(directionJson) } as Shot
}

function mapVoiceLineRow(row: Record<string, unknown>): VoiceLine {
  const { chunksJson, ...rest } = row
  return { ...rest, chunks: parseChunksJson(chunksJson) } as VoiceLine
}

const JOB_SELECT = `SELECT id,type,status,entity_id entityId,project_id projectId,payload_json payloadJson,result_json resultJson,error,progress,progress_mode progressMode,current_phase currentPhase,current_message currentMessage,attempts,max_attempts maxAttempts,scheduled_at scheduledAt,started_at startedAt,finished_at finishedAt,heartbeat_at heartbeatAt,idempotency_key idempotencyKey,created_at createdAt,updated_at updatedAt FROM jobs`

export interface StoredDiagnosticEvent {
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
  progressJson: string | null
  summaryJson: string | null
  encryptedPayload: string | null
  sizeBytes: number
}

export class AppDatabase {
  readonly sqlite: Database.Database
  readonly orm: BetterSQLite3Database<typeof schema>

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    this.sqlite = new Database(path)
    this.sqlite.pragma('journal_mode = WAL')
    this.sqlite.pragma('foreign_keys = ON')
    this.orm = drizzle(this.sqlite, { schema })
    this.migrate()
  }

  private migrate(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, encrypted INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, synopsis TEXT NOT NULL, visual_style TEXT NOT NULL, aspect_ratio TEXT NOT NULL, stage TEXT NOT NULL, auto_advance INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS story_bibles (id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE, content_json TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS story_bible_runs (project_id TEXT PRIMARY KEY, run_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS story_bible_parts (run_id TEXT NOT NULL, project_id TEXT NOT NULL, part TEXT NOT NULL, content_json TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(run_id, part));
      CREATE TABLE IF NOT EXISTS episodes (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, number INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, script_json TEXT, approved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(project_id, number));
      CREATE TABLE IF NOT EXISTS characters (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, description TEXT NOT NULL, voice_id TEXT, reference_asset_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS locations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, reference_asset_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS shots (id TEXT PRIMARY KEY, episode_id TEXT NOT NULL, position INTEGER NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, image_prompt TEXT NOT NULL, video_prompt TEXT NOT NULL, duration_seconds INTEGER NOT NULL, status TEXT NOT NULL, image_path TEXT, video_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(episode_id, position));
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, kind TEXT NOT NULL, locale TEXT, path TEXT NOT NULL, source_url TEXT, metadata_json TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS voice_lines (id TEXT PRIMARY KEY, episode_id TEXT NOT NULL, shot_id TEXT, locale TEXT NOT NULL, position INTEGER NOT NULL, speaker TEXT NOT NULL, text TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, audio_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS render_variants (id TEXT PRIMARY KEY, episode_id TEXT NOT NULL, locale TEXT NOT NULL, status TEXT NOT NULL, video_path TEXT, master_path TEXT, subtitle_path TEXT, cover_path TEXT, config_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, entity_id TEXT NOT NULL, project_id TEXT, payload_json TEXT NOT NULL, result_json TEXT, error TEXT, progress INTEGER NOT NULL, progress_mode TEXT NOT NULL DEFAULT 'indeterminate', current_phase TEXT, current_message TEXT, attempts INTEGER NOT NULL, max_attempts INTEGER NOT NULL, scheduled_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, heartbeat_at TEXT, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS jobs_runnable_idx ON jobs(status, scheduled_at);
      CREATE TABLE IF NOT EXISTS diagnostic_events (id TEXT PRIMARY KEY, job_id TEXT, project_id TEXT, attempt INTEGER, sequence INTEGER NOT NULL, timestamp TEXT NOT NULL, level TEXT NOT NULL, scope TEXT NOT NULL, phase TEXT NOT NULL, message TEXT NOT NULL, progress_json TEXT, summary_json TEXT, encrypted_payload TEXT, size_bytes INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS diagnostic_events_job_idx ON diagnostic_events(job_id, sequence);
      CREATE INDEX IF NOT EXISTS diagnostic_events_system_idx ON diagnostic_events(job_id, timestamp);
      CREATE TABLE IF NOT EXISTS platform_accounts (id TEXT PRIMARY KEY, platform TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, credentials_key TEXT, status TEXT NOT NULL, metadata_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publish_drafts (id TEXT PRIMARY KEY, render_id TEXT NOT NULL, platform TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, tags_json TEXT NOT NULL, cover_path TEXT, scheduled_at TEXT, visibility TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS publish_jobs (id TEXT PRIMARY KEY, draft_id TEXT NOT NULL UNIQUE, platform TEXT NOT NULL, external_id TEXT, status TEXT NOT NULL, result_url TEXT, error TEXT, attempts INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dialogue_plans (episode_id TEXT NOT NULL, locale TEXT NOT NULL, status TEXT NOT NULL, version TEXT, duration_ms INTEGER NOT NULL DEFAULT 0, line_count INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL, UNIQUE(episode_id, locale));
    `)
    this.addColumnIfMissing('jobs', 'project_id', 'TEXT')
    this.addColumnIfMissing('jobs', 'progress_mode', `TEXT NOT NULL DEFAULT 'indeterminate'`)
    this.addColumnIfMissing('jobs', 'current_phase', 'TEXT')
    this.addColumnIfMissing('jobs', 'current_message', 'TEXT')
    this.addColumnIfMissing('jobs', 'started_at', 'TEXT')
    this.addColumnIfMissing('jobs', 'finished_at', 'TEXT')
    this.addColumnIfMissing('jobs', 'heartbeat_at', 'TEXT')
    this.addColumnIfMissing('characters', 'voice_description', `TEXT NOT NULL DEFAULT ''`)
    this.addColumnIfMissing('characters', 'voice_preset', `TEXT NOT NULL DEFAULT 'narrator'`)
    this.addColumnIfMissing('characters', 'zh_voice_id', `TEXT NOT NULL DEFAULT 'zh_female_vv_uranus_bigtts'`)
    this.addColumnIfMissing('characters', 'en_voice_id', `TEXT NOT NULL DEFAULT 'en_female_dacey_uranus_bigtts'`)
    this.addColumnIfMissing('characters', 'zh_voice_warning', 'TEXT')
    this.addColumnIfMissing('characters', 'en_voice_warning', 'TEXT')
    this.addColumnIfMissing('characters', 'voice_locked', `INTEGER NOT NULL DEFAULT 0`)
    this.addColumnIfMissing('voice_lines', 'shot_position', 'INTEGER')
    this.addColumnIfMissing('voice_lines', 'spoken_text', 'TEXT')
    this.addColumnIfMissing('voice_lines', 'original_start_ms', 'INTEGER')
    this.addColumnIfMissing('voice_lines', 'original_end_ms', 'INTEGER')
    this.addColumnIfMissing('voice_lines', 'line_voice_id', 'TEXT')
    this.addColumnIfMissing('voice_lines', 'audio_duration_ms', 'INTEGER')
    this.addColumnIfMissing('voice_lines', 'plan_version', 'TEXT')
    this.addColumnIfMissing('voice_lines', 'chunks_json', 'TEXT')
    this.addColumnIfMissing('shots', 'characters_json', 'TEXT')
    this.addColumnIfMissing('shots', 'direction_json', 'TEXT')
    this.sqlite.exec(`UPDATE voice_lines SET spoken_text=COALESCE(spoken_text,text),original_start_ms=COALESCE(original_start_ms,start_ms),original_end_ms=COALESCE(original_end_ms,end_ms)`)
    this.sqlite.exec(`CREATE INDEX IF NOT EXISTS jobs_project_idx ON jobs(project_id, created_at)`)
    this.backfillCharacterVoices()
    this.migrateLegacyTts1Voices()
    this.backfillJobProjects()
  }

  /**
   * Retired TTS 1.0 (moon/mars) voices are unusable on accounts provisioned
   * through the new console (403) and lack subtitle timestamps. Rewrite any
   * stored 1.0 voice IDs — including manually locked ones — to the owning
   * preset's 2.0 voice, and invalidate affected dialogue plans.
   */
  private migrateLegacyTts1Voices(): void {
    const rows = this.sqlite.prepare(`SELECT id, project_id projectId, COALESCE(voice_preset,'narrator') voicePreset, zh_voice_id zhVoiceId, en_voice_id enVoiceId FROM characters`).all() as Array<{ id: string; projectId: string; voicePreset: string; zhVoiceId: string; enVoiceId: string }>
    const update = this.sqlite.prepare(`UPDATE characters SET zh_voice_id=?, en_voice_id=?, zh_voice_warning=NULL, en_voice_warning=NULL, updated_at=? WHERE id=?`)
    const affectedProjects = new Set<string>()
    for (const row of rows) {
      if (!isLegacyTts1Voice(row.zhVoiceId) && !isLegacyTts1Voice(row.enVoiceId)) continue
      const preset = voicePreset(row.voicePreset as VoicePresetId)
      update.run(isLegacyTts1Voice(row.zhVoiceId) ? preset.zhVoiceId : row.zhVoiceId, isLegacyTts1Voice(row.enVoiceId) ? preset.enVoiceId : row.enVoiceId, now(), row.id)
      affectedProjects.add(row.projectId)
    }
    if (!affectedProjects.size) return
    for (const projectId of affectedProjects) for (const episode of this.listEpisodes(projectId)) this.invalidateDialoguePlans(episode.id)
    console.log(`[lumaworks] 已将 ${affectedProjects.size} 个项目中退役的 1.0 音色迁移到 2.0 uranus 音色`)
  }

  private addColumnIfMissing(table: string, column: string, declaration: string): void {
    const columns = this.sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    if (!columns.some((item) => item.name === column)) this.sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`)
  }

  private backfillJobProjects(): void {
    const rows = this.sqlite.prepare(`SELECT id,type,entity_id entityId,payload_json payloadJson FROM jobs WHERE project_id IS NULL`).all() as Array<{ id: string; type: JobType; entityId: string; payloadJson: string }>
    const update = this.sqlite.prepare(`UPDATE jobs SET project_id=? WHERE id=?`)
    for (const row of rows) {
      let payload: Record<string, unknown> = {}
      try { payload = JSON.parse(row.payloadJson) as Record<string, unknown> } catch { /* legacy malformed payload */ }
      const projectId = this.resolveJobProjectId(row.type, row.entityId, payload)
      if (projectId) update.run(projectId, row.id)
    }
  }

  private backfillCharacterVoices(): void {
    const projects = this.sqlite.prepare(`SELECT project_id projectId FROM story_bibles`).all() as Array<{ projectId: string }>
    for (const project of projects) this.assignProjectVoices(project.projectId, false)
  }

  reassignCharacterVoices(projectId: string): number {
    const changed = this.assignProjectVoices(projectId, true)
    if (changed) {
      const episodes = this.sqlite.prepare(`SELECT id FROM episodes WHERE project_id=?`).all(projectId) as Array<{ id: string }>
      for (const episode of episodes) this.invalidateDialoguePlans(episode.id)
    }
    return changed
  }

  private assignProjectVoices(projectId: string, force: boolean): number {
    const row = this.sqlite.prepare(`SELECT content_json contentJson FROM story_bibles WHERE project_id=?`).get(projectId) as { contentJson: string } | undefined
    if (!row) return 0
    let bible: StoryBible
    try { bible = JSON.parse(row.contentJson) as StoryBible } catch { return 0 }
    const update = this.sqlite.prepare(`UPDATE characters SET voice_description=?,voice_preset=?,zh_voice_id=?,en_voice_id=?,zh_voice_warning=NULL,en_voice_warning=NULL,voice_locked=?,updated_at=? WHERE project_id=? AND name=?`)
    const used = new Set<VoicePresetId>()
    let changed = 0
    for (const character of bible.characters ?? []) {
      const existing = this.sqlite.prepare(`SELECT description,role,COALESCE(voice_locked,0) voiceLocked FROM characters WHERE project_id=? AND name=?`).get(projectId, character.name) as { description: string; role: string; voiceLocked: number } | undefined
      if (!existing || (!force && existing.voiceLocked)) continue
      const presetId = inferVoicePreset({ name: character.name, role: existing.role, description: existing.description, voiceDescription: character.voice }, used)
      used.add(presetId); const preset = voicePreset(presetId)
      update.run(character.voice, presetId, preset.zhVoiceId, preset.enVoiceId, force ? 0 : existing.voiceLocked, now(), projectId, character.name)
      changed++
    }
    return changed
  }

  close(): void { this.sqlite.close() }

  createProject(input: CreateProjectInput): string {
    const id = randomUUID(); const stamp = now()
    this.sqlite.prepare(`INSERT INTO projects VALUES (?, ?, ?, ?, '9:16', 'concept', 0, ?, ?)`).run(id, input.title, input.synopsis, input.visualStyle, stamp, stamp)
    return id
  }

  listProjects(): Project[] {
    return this.sqlite.prepare(`SELECT id, title, synopsis, visual_style visualStyle, aspect_ratio aspectRatio, stage, auto_advance autoAdvance, created_at createdAt, updated_at updatedAt FROM projects ORDER BY updated_at DESC`).all() as Project[]
  }

  getProject(id: string): Project | null {
    return (this.sqlite.prepare(`SELECT id, title, synopsis, visual_style visualStyle, aspect_ratio aspectRatio, stage, auto_advance autoAdvance, created_at createdAt, updated_at updatedAt FROM projects WHERE id = ?`).get(id) as Project | undefined) ?? null
  }

  updateProject(input: UpdateProjectInput): void {
    this.sqlite.prepare(`UPDATE projects SET title=?, synopsis=?, visual_style=?, updated_at=? WHERE id=?`).run(input.title, input.synopsis, input.visualStyle, now(), input.id)
  }

  setProjectStage(id: string, stage: string): void { this.sqlite.prepare(`UPDATE projects SET stage=?, updated_at=? WHERE id=?`).run(stage, now(), id) }

  listEpisodes(projectId: string): Episode[] {
    return this.sqlite.prepare(`SELECT id, project_id projectId, number, title, summary, script_json scriptJson, approved, created_at createdAt, updated_at updatedAt FROM episodes WHERE project_id=? ORDER BY number`).all(projectId) as Episode[]
  }

  getEpisode(id: string): Episode | null {
    return (this.sqlite.prepare(`SELECT id, project_id projectId, number, title, summary, script_json scriptJson, approved, created_at createdAt, updated_at updatedAt FROM episodes WHERE id=?`).get(id) as Episode | undefined) ?? null
  }

  getProjectForEpisode(episodeId: string): Project | null {
    const row = this.sqlite.prepare(`SELECT project_id projectId FROM episodes WHERE id=?`).get(episodeId) as { projectId: string } | undefined
    return row ? this.getProject(row.projectId) : null
  }

  listShotsForEpisode(episodeId: string): Shot[] {
    return (this.sqlite.prepare(`SELECT ${SHOT_SELECT} FROM shots WHERE episode_id=? ORDER BY position`).all(episodeId) as Array<Record<string, unknown>>).map(mapShotRow)
  }

  getNextShot(episodeId: string, position: number): Shot | null {
    const row = this.sqlite.prepare(`SELECT ${SHOT_SELECT} FROM shots WHERE episode_id=? AND position>? ORDER BY position LIMIT 1`).get(episodeId, position) as Record<string, unknown> | undefined
    return row ? mapShotRow(row) : null
  }

  listCharacters(projectId: string): CharacterVoice[] {
    const rows = this.sqlite.prepare(`SELECT id,project_id projectId,name,role,description,COALESCE(voice_description,'') voiceDescription,COALESCE(voice_preset,'narrator') voicePreset,COALESCE(zh_voice_id,voice_id,'zh_female_vv_uranus_bigtts') zhVoiceId,COALESCE(en_voice_id,'en_female_dacey_uranus_bigtts') enVoiceId,zh_voice_warning zhVoiceWarning,en_voice_warning enVoiceWarning,COALESCE(voice_locked,0) voiceLocked,reference_asset_id referenceAssetId FROM characters WHERE project_id=? ORDER BY created_at,name`).all(projectId) as Array<Omit<CharacterVoice, 'voiceLocked'> & { voiceLocked: number }>
    return rows.map((row) => ({ ...row, voiceLocked: Boolean(row.voiceLocked) }))
  }

  updateCharacterVoice(input: { id: string; voicePreset: VoicePresetId; zhVoiceId: string; enVoiceId: string; voiceLocked: boolean }): void {
    if (isLegacyTts1Voice(input.zhVoiceId) || isLegacyTts1Voice(input.enVoiceId)) throw new Error('1.0（moon/mars）音色已停用，请选择 2.0（uranus）音色；1.0 音色需单独开通且不支持字幕时间戳')
    const result = this.sqlite.prepare(`UPDATE characters SET voice_preset=?,zh_voice_id=?,en_voice_id=?,zh_voice_warning=NULL,en_voice_warning=NULL,voice_locked=?,updated_at=? WHERE id=?`).run(input.voicePreset, input.zhVoiceId.trim(), input.enVoiceId.trim(), input.voiceLocked ? 1 : 0, now(), input.id)
    if (!result.changes) throw new Error('角色不存在')
    const row = this.sqlite.prepare(`SELECT e.id episodeId FROM characters c JOIN episodes e ON e.project_id=c.project_id WHERE c.id=?`).all(input.id) as Array<{ episodeId: string }>
    for (const item of row) this.invalidateDialoguePlans(item.episodeId)
  }

  setCharacterVoiceWarning(id: string, locale: ContentLocale, warning: string | null): void {
    const column = locale === 'en-US' ? 'en_voice_warning' : 'zh_voice_warning'
    this.sqlite.prepare(`UPDATE characters SET ${column}=?,updated_at=? WHERE id=?`).run(warning, now(), id)
  }

  getCharacterVoice(projectId: string, speaker: string): CharacterVoice | null {
    const row = this.sqlite.prepare(`SELECT id,project_id projectId,name,role,description,COALESCE(voice_description,'') voiceDescription,COALESCE(voice_preset,'narrator') voicePreset,COALESCE(zh_voice_id,voice_id,'zh_female_vv_uranus_bigtts') zhVoiceId,COALESCE(en_voice_id,'en_female_dacey_uranus_bigtts') enVoiceId,zh_voice_warning zhVoiceWarning,en_voice_warning enVoiceWarning,COALESCE(voice_locked,0) voiceLocked,reference_asset_id referenceAssetId FROM characters WHERE project_id=? AND name=?`).get(projectId, speaker) as (Omit<CharacterVoice, 'voiceLocked'> & { voiceLocked: number }) | undefined
    return row ? { ...row, voiceLocked: Boolean(row.voiceLocked) } : null
  }

  getCharacterVoiceById(id: string): CharacterVoice | null {
    const row = this.sqlite.prepare(`SELECT id,project_id projectId,name,role,description,COALESCE(voice_description,'') voiceDescription,COALESCE(voice_preset,'narrator') voicePreset,COALESCE(zh_voice_id,voice_id,'zh_female_vv_uranus_bigtts') zhVoiceId,COALESCE(en_voice_id,'en_female_dacey_uranus_bigtts') enVoiceId,zh_voice_warning zhVoiceWarning,en_voice_warning enVoiceWarning,COALESCE(voice_locked,0) voiceLocked,reference_asset_id referenceAssetId FROM characters WHERE id=?`).get(id) as (Omit<CharacterVoice, 'voiceLocked'> & { voiceLocked: number }) | undefined
    return row ? { ...row, voiceLocked: Boolean(row.voiceLocked) } : null
  }

  listVoiceLines(episodeId: string, locale: ContentLocale): VoiceLine[] {
    return (this.sqlite.prepare(`SELECT id,episode_id episodeId,shot_id shotId,shot_position shotPosition,locale,position,speaker,text,COALESCE(spoken_text,text) spokenText,COALESCE(original_start_ms,start_ms) originalStartMs,COALESCE(original_end_ms,end_ms) originalEndMs,start_ms startMs,end_ms endMs,line_voice_id voiceId,audio_path audioPath,audio_duration_ms audioDurationMs,plan_version planVersion,chunks_json chunksJson FROM voice_lines WHERE episode_id=? AND locale=? ORDER BY position`).all(episodeId, locale) as Array<Record<string, unknown>>).map(mapVoiceLineRow)
  }

  updateVoiceAudio(id: string, input: { audioPath: string; spokenText: string; voiceId: string; audioDurationMs: number; startMs: number; endMs: number; planVersion: string; chunks?: VoiceLine['chunks'] }): void {
    this.sqlite.prepare(`UPDATE voice_lines SET audio_path=@audioPath,spoken_text=@spokenText,line_voice_id=@voiceId,audio_duration_ms=@audioDurationMs,start_ms=@startMs,end_ms=@endMs,plan_version=@planVersion,chunks_json=@chunksJson,updated_at=@updatedAt WHERE id=@id`).run({ id, ...input, chunksJson: input.chunks ? JSON.stringify(input.chunks) : null, updatedAt: now() })
  }

  applyDialoguePlan(episodeId: string, locale: ContentLocale, version: string, durationMs: number, lines: Array<{ id: string; shotId: string; shotPosition: number; startMs: number; endMs: number }>): void {
    const update = this.sqlite.prepare(`UPDATE voice_lines SET shot_id=@shotId,shot_position=@shotPosition,start_ms=@startMs,end_ms=@endMs,spoken_text=text,audio_path=NULL,audio_duration_ms=NULL,line_voice_id=NULL,plan_version=@version,chunks_json=NULL,updated_at=@updatedAt WHERE id=@id AND episode_id=@episodeId AND locale=@locale`)
    this.sqlite.transaction(() => {
      for (const line of lines) update.run({ ...line, episodeId, locale, version, updatedAt: now() })
      this.sqlite.prepare(`INSERT INTO dialogue_plans(episode_id,locale,status,version,duration_ms,line_count,updated_at) VALUES(?,?,'ready',?,?,?,?) ON CONFLICT(episode_id,locale) DO UPDATE SET status='ready',version=excluded.version,duration_ms=excluded.duration_ms,line_count=excluded.line_count,updated_at=excluded.updated_at`).run(episodeId, locale, version, durationMs, lines.length, now())
    })()
  }

  markDialoguePlanVoiced(episodeId: string, locale: ContentLocale, version: string): void {
    this.sqlite.prepare(`UPDATE dialogue_plans SET status='voiced',updated_at=? WHERE episode_id=? AND locale=? AND version=?`).run(now(), episodeId, locale, version)
  }

  invalidateDialoguePlans(episodeId: string, locale?: ContentLocale): void {
    const params = locale ? [now(), episodeId, locale] : [now(), episodeId]
    this.sqlite.prepare(`UPDATE dialogue_plans SET status='stale',updated_at=? WHERE episode_id=?${locale ? ' AND locale=?' : ''}`).run(...params)
  }

  listDialoguePlans(episodeId: string): DialoguePlanSummary[] {
    return this.sqlite.prepare(`SELECT episode_id episodeId,locale,status,version,duration_ms durationMs,line_count lineCount,updated_at updatedAt FROM dialogue_plans WHERE episode_id=? ORDER BY locale`).all(episodeId) as DialoguePlanSummary[]
  }

  getDialoguePlan(episodeId: string, locale: ContentLocale): DialoguePlanSummary | null {
    return (this.sqlite.prepare(`SELECT episode_id episodeId,locale,status,version,duration_ms durationMs,line_count lineCount,updated_at updatedAt FROM dialogue_plans WHERE episode_id=? AND locale=?`).get(episodeId, locale) as DialoguePlanSummary | undefined) ?? null
  }

  replaceTranslatedLines(episodeId: string, lines: Array<{ speaker: string; text: string; shotPosition?: number; startMs: number; endMs: number }>): void {
    const stamp = now(); this.sqlite.prepare(`DELETE FROM voice_lines WHERE episode_id=? AND locale='en-US'`).run(episodeId)
    const insert = this.sqlite.prepare(`INSERT INTO voice_lines(id,episode_id,shot_id,locale,position,speaker,text,start_ms,end_ms,audio_path,created_at,updated_at,spoken_text,original_start_ms,original_end_ms,shot_position) VALUES(?,?,NULL,'en-US',?,?,?,?,?,NULL,?,?,?,?,?,?)`)
    lines.forEach((line, index) => insert.run(randomUUID(), episodeId, index + 1, line.speaker, line.text, line.startMs, line.endMs, stamp, stamp, line.text, line.startMs, line.endMs, line.shotPosition ?? null))
    this.invalidateDialoguePlans(episodeId, 'en-US')
  }

  createRender(episodeId: string, locale: string, config: Record<string, unknown>): string {
    const id = randomUUID(); const stamp = now()
    this.sqlite.prepare(`INSERT INTO render_variants VALUES(?,?,?,'rendering',NULL,NULL,NULL,NULL,?,?,?)`).run(id, episodeId, locale, JSON.stringify(config), stamp, stamp)
    return id
  }

  updateRender(id: string, fields: { status: string; videoPath?: string; masterPath?: string; subtitlePath?: string; coverPath?: string }): void {
    this.sqlite.prepare(`UPDATE render_variants SET status=@status,video_path=COALESCE(@videoPath,video_path),master_path=COALESCE(@masterPath,master_path),subtitle_path=COALESCE(@subtitlePath,subtitle_path),cover_path=COALESCE(@coverPath,cover_path),updated_at=@updatedAt WHERE id=@id`).run({ id, updatedAt: now(), videoPath: null, masterPath: null, subtitlePath: null, coverPath: null, ...fields })
  }

  listRendersForProject(projectId: string): Array<Record<string, unknown>> {
    return this.sqlite.prepare(`SELECT r.id,r.episode_id episodeId,r.locale,r.status,r.video_path videoPath,r.master_path masterPath,r.subtitle_path subtitlePath,r.cover_path coverPath,r.created_at createdAt FROM render_variants r JOIN episodes e ON e.id=r.episode_id WHERE e.project_id=? ORDER BY r.created_at DESC`).all(projectId) as Array<Record<string, unknown>>
  }

  listShotsForProject(projectId: string): Shot[] {
    return (this.sqlite.prepare(`SELECT s.id, s.episode_id episodeId, s.position, s.title, s.description, s.image_prompt imagePrompt, s.video_prompt videoPrompt, s.duration_seconds durationSeconds, s.status, s.characters_json charactersJson, s.image_path imagePath, s.video_path videoPath, s.updated_at updatedAt FROM shots s JOIN episodes e ON e.id=s.episode_id WHERE e.project_id=? ORDER BY e.number,s.position`).all(projectId) as Array<Record<string, unknown>>).map(mapShotRow)
  }

  getShot(id: string): Shot | null {
    const row = this.sqlite.prepare(`SELECT ${SHOT_SELECT} FROM shots WHERE id=?`).get(id) as Record<string, unknown> | undefined
    return row ? mapShotRow(row) : null
  }

  getShotReferencePaths(shotId: string): string[] {
    const shot = this.getShot(shotId); if (!shot) return []
    const episode = this.getEpisode(shot.episodeId); if (!episode) return []
    const references = this.sqlite.prepare(`SELECT c.name, a.path FROM characters c JOIN assets a ON a.id=c.reference_asset_id WHERE c.project_id=? ORDER BY c.created_at`).all(episode.projectId) as Array<{ name: string; path: string }>
    if (!references.length) return []
    const names = new Set(shot.characters)
    if (!names.size) {
      const speakers = this.sqlite.prepare(`SELECT DISTINCT speaker FROM voice_lines WHERE episode_id=? AND locale='zh-CN' AND (shot_id=? OR shot_position=?)`).all(shot.episodeId, shot.id, shot.position) as Array<{ speaker: string }>
      for (const row of speakers) names.add(row.speaker)
    }
    if (!names.size) {
      const haystack = `${shot.title}\n${shot.description}\n${shot.imagePrompt}\n${shot.videoPrompt}`
      for (const reference of references) if (reference.name && haystack.includes(reference.name)) names.add(reference.name)
    }
    return references.filter((reference) => names.has(reference.name)).map((reference) => reference.path).slice(0, 10)
  }

  setCharacterReferenceAsset(id: string, assetId: string): void {
    const result = this.sqlite.prepare(`UPDATE characters SET reference_asset_id=?,updated_at=? WHERE id=?`).run(assetId, now(), id)
    if (!result.changes) throw new Error('角色不存在')
  }

  listJobs(): Job[] {
    return this.sqlite.prepare(`${JOB_SELECT} ORDER BY created_at DESC LIMIT 100`).all() as Job[]
  }

  getJob(id: string): Job | null {
    return (this.sqlite.prepare(`${JOB_SELECT} WHERE id=?`).get(id) as Job | undefined) ?? null
  }

  getJobByKey(key: string): Job | null {
    const row = this.sqlite.prepare(`SELECT id FROM jobs WHERE idempotency_key=?`).get(key) as { id: string } | undefined
    return row ? this.getJob(row.id) : null
  }

  insertJob(job: Job): void {
    this.sqlite.prepare(`INSERT INTO jobs(id,type,status,entity_id,project_id,payload_json,result_json,error,progress,progress_mode,current_phase,current_message,attempts,max_attempts,scheduled_at,started_at,finished_at,heartbeat_at,idempotency_key,created_at,updated_at) VALUES (@id,@type,@status,@entityId,@projectId,@payloadJson,@resultJson,@error,@progress,@progressMode,@currentPhase,@currentMessage,@attempts,@maxAttempts,@scheduledAt,@startedAt,@finishedAt,@heartbeatAt,@idempotencyKey,@createdAt,@updatedAt)`).run(job)
  }

  nextRunnableJob(): Job | null {
    const row = this.sqlite.prepare(`SELECT id FROM jobs WHERE status='queued' AND scheduled_at<=? ORDER BY scheduled_at,created_at LIMIT 1`).get(now()) as { id: string } | undefined
    return row ? this.getJob(row.id) : null
  }

  listRunnableJobs(limit = 500): Job[] {
    return this.sqlite.prepare(`${JOB_SELECT} WHERE status='queued' AND scheduled_at<=? ORDER BY scheduled_at,created_at LIMIT ?`).all(now(), limit) as Job[]
  }

  updateJob(id: string, fields: Partial<Pick<Job, 'status' | 'resultJson' | 'error' | 'progress' | 'progressMode' | 'currentPhase' | 'currentMessage' | 'attempts' | 'scheduledAt' | 'startedAt' | 'finishedAt' | 'heartbeatAt'>>): Job {
    const allowed: Record<string, string> = { status: 'status', resultJson: 'result_json', error: 'error', progress: 'progress', progressMode: 'progress_mode', currentPhase: 'current_phase', currentMessage: 'current_message', attempts: 'attempts', scheduledAt: 'scheduled_at', startedAt: 'started_at', finishedAt: 'finished_at', heartbeatAt: 'heartbeat_at' }
    const entries = Object.entries(fields).filter(([key]) => key in allowed)
    const sql = entries.map(([key]) => `${allowed[key]}=@${key}`).concat('updated_at=@updatedAt').join(',')
    this.sqlite.prepare(`UPDATE jobs SET ${sql} WHERE id=@id`).run({ id, updatedAt: now(), ...fields })
    return this.getJob(id)!
  }

  recoverJobs(): Job[] {
    const rows = this.sqlite.prepare(`SELECT id FROM jobs WHERE status IN ('running','waiting')`).all() as Array<{ id: string }>
    this.sqlite.prepare(`UPDATE jobs SET status='queued', error='应用重启后恢复', current_phase='job.recovered', current_message='应用重启后等待重新执行', heartbeat_at=NULL, updated_at=? WHERE status IN ('running','waiting')`).run(now())
    return rows.map((row) => this.getJob(row.id)!).filter(Boolean)
  }

  resolveJobProjectId(type: JobType, entityId: string, payload: Record<string, unknown>): string | null {
    if (type === 'story-bible' || type === 'story-foundation' || type === 'story-characters' || type === 'story-locations' || type === 'story-episodes' || type === 'story-bible-assemble' || type === 'episode-script') return this.getProject(entityId)?.id ?? null
    if (type === 'character-image' || type === 'location-image') return typeof payload.projectId === 'string' ? payload.projectId : null
    if (type === 'shot-image' || type === 'shot-video') {
      return (this.sqlite.prepare(`SELECT e.project_id projectId FROM shots s JOIN episodes e ON e.id=s.episode_id WHERE s.id=?`).get(entityId) as { projectId: string } | undefined)?.projectId ?? null
    }
    if (type === 'shot-grid-image') return this.getEpisode(entityId)?.projectId ?? null
    if (type === 'dialogue-timing' || type === 'voice-line' || type === 'translate-episode' || type === 'render-episode') return this.getEpisode(entityId)?.projectId ?? null
    if (type === 'publish') {
      return (this.sqlite.prepare(`SELECT e.project_id projectId FROM publish_drafts d JOIN render_variants r ON r.id=d.render_id JOIN episodes e ON e.id=r.episode_id WHERE d.id=?`).get(entityId) as { projectId: string } | undefined)?.projectId ?? null
    }
    return null
  }

  nextDiagnosticSequence(jobId: string | null): number {
    const row = jobId
      ? this.sqlite.prepare(`SELECT COALESCE(MAX(sequence),0)+1 value FROM diagnostic_events WHERE job_id=?`).get(jobId)
      : this.sqlite.prepare(`SELECT COALESCE(MAX(sequence),0)+1 value FROM diagnostic_events WHERE job_id IS NULL`).get()
    return Number((row as { value?: number } | undefined)?.value ?? 1)
  }

  insertDiagnosticEvent(event: StoredDiagnosticEvent): void {
    this.sqlite.prepare(`INSERT INTO diagnostic_events(id,job_id,project_id,attempt,sequence,timestamp,level,scope,phase,message,progress_json,summary_json,encrypted_payload,size_bytes) VALUES (@id,@jobId,@projectId,@attempt,@sequence,@timestamp,@level,@scope,@phase,@message,@progressJson,@summaryJson,@encryptedPayload,@sizeBytes)`).run(event)
  }

  listJobDiagnosticEvents(jobId: string): StoredDiagnosticEvent[] {
    return this.sqlite.prepare(`SELECT id,job_id jobId,project_id projectId,attempt,sequence,timestamp,level,scope,phase,message,progress_json progressJson,summary_json summaryJson,encrypted_payload encryptedPayload,size_bytes sizeBytes FROM diagnostic_events WHERE job_id=? ORDER BY sequence`).all(jobId) as StoredDiagnosticEvent[]
  }

  listSystemDiagnosticEvents(filters: { level?: DiagnosticLevel; limit?: number } = {}): StoredDiagnosticEvent[] {
    const limit = Math.max(1, Math.min(500, filters.limit ?? 200))
    if (filters.level) return this.sqlite.prepare(`SELECT id,job_id jobId,project_id projectId,attempt,sequence,timestamp,level,scope,phase,message,progress_json progressJson,summary_json summaryJson,encrypted_payload encryptedPayload,size_bytes sizeBytes FROM diagnostic_events WHERE job_id IS NULL AND level=? ORDER BY timestamp DESC LIMIT ?`).all(filters.level, limit) as StoredDiagnosticEvent[]
    return this.sqlite.prepare(`SELECT id,job_id jobId,project_id projectId,attempt,sequence,timestamp,level,scope,phase,message,progress_json progressJson,summary_json summaryJson,encrypted_payload encryptedPayload,size_bytes sizeBytes FROM diagnostic_events WHERE job_id IS NULL ORDER BY timestamp DESC LIMIT ?`).all(limit) as StoredDiagnosticEvent[]
  }

  clearDiagnosticEvents(): void { this.sqlite.prepare(`DELETE FROM diagnostic_events`).run() }

  compactDiagnostics(): void { this.sqlite.pragma('wal_checkpoint(TRUNCATE)'); this.sqlite.exec('VACUUM') }

  cleanupDiagnosticEvents(cutoff: string, maxBytes: number): { deleted: number } {
    let deleted = this.sqlite.prepare(`DELETE FROM diagnostic_events WHERE timestamp<?`).run(cutoff).changes
    let total = Number((this.sqlite.prepare(`SELECT COALESCE(SUM(size_bytes),0) value FROM diagnostic_events`).get() as { value: number }).value)
    while (total > maxBytes) {
      const rows = this.sqlite.prepare(`SELECT id,size_bytes sizeBytes FROM diagnostic_events ORDER BY timestamp LIMIT 200`).all() as Array<{ id: string; sizeBytes: number }>
      if (!rows.length) break
      const remove = this.sqlite.prepare(`DELETE FROM diagnostic_events WHERE id=?`)
      const transaction = this.sqlite.transaction(() => { for (const row of rows) { remove.run(row.id); total -= row.sizeBytes; deleted++ } })
      transaction()
    }
    return { deleted }
  }

  upsertSetting(key: string, value: string, encrypted = false): void {
    this.sqlite.prepare(`INSERT INTO settings(key,value,encrypted,updated_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, encrypted=excluded.encrypted, updated_at=excluded.updated_at`).run(key, value, encrypted ? 1 : 0, now())
  }

  getSetting(key: string): { value: string; encrypted: boolean } | null {
    return (this.sqlite.prepare(`SELECT value,encrypted FROM settings WHERE key=?`).get(key) as { value: string; encrypted: boolean } | undefined) ?? null
  }

  saveStoryBible(projectId: string, contentJson: string): void {
    const stamp = now(); const current = this.sqlite.prepare(`SELECT id,version FROM story_bibles WHERE project_id=?`).get(projectId) as { id: string; version: number } | undefined
    if (current) this.sqlite.prepare(`UPDATE story_bibles SET content_json=?, version=?, updated_at=? WHERE id=?`).run(contentJson, current.version + 1, stamp, current.id)
    else this.sqlite.prepare(`INSERT INTO story_bibles VALUES(?,?,?,0,1,?,?)`).run(randomUUID(), projectId, contentJson, stamp, stamp)
  }

  saveStoryBibleBundle(projectId: string, bible: StoryBible): void {
    this.sqlite.transaction(() => {
      this.saveStoryBible(projectId, JSON.stringify(bible))
      this.replaceBibleEntities(projectId, bible)
      this.setProjectStage(projectId, 'script')
    })()
  }

  beginStoryBibleRun(projectId: string, runId: string): void {
    const stamp = now()
    this.sqlite.prepare(`INSERT INTO story_bible_runs(project_id,run_id,status,created_at,updated_at) VALUES(?,?,'running',?,?) ON CONFLICT(project_id) DO UPDATE SET run_id=excluded.run_id,status='running',created_at=excluded.created_at,updated_at=excluded.updated_at`).run(projectId, runId, stamp, stamp)
  }

  isActiveStoryBibleRun(projectId: string, runId: string): boolean {
    return Boolean(this.sqlite.prepare(`SELECT 1 FROM story_bible_runs WHERE project_id=? AND run_id=? AND status='running'`).get(projectId, runId))
  }

  saveStoryBiblePart(projectId: string, runId: string, part: string, value: unknown): boolean {
    if (!this.isActiveStoryBibleRun(projectId, runId)) return false
    this.sqlite.prepare(`INSERT INTO story_bible_parts(run_id,project_id,part,content_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(run_id,part) DO UPDATE SET content_json=excluded.content_json,updated_at=excluded.updated_at`).run(runId, projectId, part, JSON.stringify(value), now())
    return true
  }

  getStoryBibleParts(projectId: string, runId: string): Record<string, unknown> {
    const rows = this.sqlite.prepare(`SELECT part,content_json contentJson FROM story_bible_parts WHERE project_id=? AND run_id=?`).all(projectId, runId) as Array<{ part: string; contentJson: string }>
    return Object.fromEntries(rows.map((row) => [row.part, JSON.parse(row.contentJson) as unknown]))
  }

  completeStoryBibleRun(projectId: string, runId: string, bible: StoryBible): boolean {
    if (!this.isActiveStoryBibleRun(projectId, runId)) return false
    this.sqlite.transaction(() => {
      this.saveStoryBibleBundle(projectId, bible)
      this.sqlite.prepare(`UPDATE story_bible_runs SET status='completed',updated_at=? WHERE project_id=? AND run_id=?`).run(now(), projectId, runId)
      this.sqlite.prepare(`DELETE FROM story_bible_parts WHERE project_id=? AND run_id<>?`).run(projectId, runId)
    })()
    return true
  }

  replaceBibleEntities(projectId: string, bible: Pick<StoryBible, 'characters' | 'locations'>): void {
    const stamp = now(); const existing = new Map(this.listCharacters(projectId).map((item) => [item.name, item])); this.sqlite.prepare(`DELETE FROM characters WHERE project_id=?`).run(projectId); this.sqlite.prepare(`DELETE FROM locations WHERE project_id=?`).run(projectId)
    const insertCharacter = this.sqlite.prepare(`INSERT INTO characters(id,project_id,name,role,description,voice_id,reference_asset_id,created_at,updated_at,voice_description,voice_preset,zh_voice_id,en_voice_id,voice_locked) VALUES(?,?,?,?,?,NULL,?,?,?,?,?,?,?,?)`)
    const insertLocation = this.sqlite.prepare(`INSERT INTO locations VALUES(?,?,?,?,NULL,?,?)`)
    const used = new Set<VoicePresetId>()
    bible.characters.forEach((item) => {
      const previous = existing.get(item.name); const description = `${String(item.appearance ?? '')}\n${String(item.personality ?? '')}`; const voiceDescription = String(item.voice ?? '')
      const presetId = previous?.voiceLocked ? previous.voicePreset : inferVoicePreset({ name: item.name, role: item.role, description, voiceDescription }, used)
      used.add(presetId); const preset = voicePreset(presetId)
      insertCharacter.run(previous?.id ?? randomUUID(), projectId, item.name, item.role, description, previous?.referenceAssetId ?? null, stamp, stamp, voiceDescription, presetId, previous?.voiceLocked ? previous.zhVoiceId : preset.zhVoiceId, previous?.voiceLocked ? previous.enVoiceId : preset.enVoiceId, previous?.voiceLocked ? 1 : 0)
    })
    bible.locations.forEach((item) => insertLocation.run(randomUUID(), projectId, String(item.name ?? ''), `${String(item.description ?? '')}\n${String(item.visualPrompt ?? '')}`, stamp, stamp))
  }

  getStoryBible(projectId: string): string | null {
    return (this.sqlite.prepare(`SELECT content_json contentJson FROM story_bibles WHERE project_id=?`).get(projectId) as { contentJson: string } | undefined)?.contentJson ?? null
  }

  replaceEpisodeScript(projectId: string, script: { title: string; summary: string; shots: Array<Record<string, unknown>>; dialogue?: Array<Record<string, unknown>> }): string {
    const stamp = now(); const id = (this.sqlite.prepare(`SELECT id FROM episodes WHERE project_id=? AND number=1`).get(projectId) as { id: string } | undefined)?.id ?? randomUUID()
    this.sqlite.prepare(`INSERT INTO episodes(id,project_id,number,title,summary,script_json,approved,created_at,updated_at) VALUES(?,?,1,?,?,?,0,?,?) ON CONFLICT(project_id,number) DO UPDATE SET title=excluded.title,summary=excluded.summary,script_json=excluded.script_json,updated_at=excluded.updated_at`).run(id, projectId, script.title, script.summary, JSON.stringify(script), stamp, stamp)
    this.sqlite.prepare(`DELETE FROM shots WHERE episode_id=?`).run(id)
    const insertShot = this.sqlite.prepare(`INSERT INTO shots(id,episode_id,position,title,description,image_prompt,video_prompt,duration_seconds,status,image_path,video_path,created_at,updated_at,characters_json,direction_json) VALUES(?,?,?,?,?,?,?,?,'draft',NULL,NULL,?,?,?,?)`)
    const insertLine = this.sqlite.prepare(`INSERT INTO voice_lines(id,episode_id,shot_id,locale,position,speaker,text,start_ms,end_ms,audio_path,created_at,updated_at,shot_position,spoken_text,original_start_ms,original_end_ms) VALUES(?,?,NULL,'zh-CN',?,?,?,?,?,NULL,?,?,?,?,?,?)`)
    this.sqlite.prepare(`DELETE FROM voice_lines WHERE episode_id=?`).run(id)
    script.shots.forEach((shot, index) => insertShot.run(randomUUID(), id, index + 1, String(shot.title ?? `镜头 ${index + 1}`), String(shot.description ?? ''), String(shot.imagePrompt ?? ''), String(shot.videoPrompt ?? ''), Number(shot.durationSeconds ?? 5), stamp, stamp, JSON.stringify(Array.isArray(shot.characters) ? shot.characters.filter((name): name is string => typeof name === 'string' && Boolean(name.trim())) : []), JSON.stringify(shot.direction && typeof shot.direction === 'object' ? shot.direction : {})))
    ;(script.dialogue ?? []).forEach((line, index) => { const startMs = Number(line.startMs ?? index * 4000); const endMs = Number(line.endMs ?? (index + 1) * 4000); const text = String(line.text ?? ''); insertLine.run(randomUUID(), id, index + 1, String(line.speaker ?? '旁白'), text, startMs, endMs, stamp, stamp, Number(line.shotPosition ?? 0) || null, text, startMs, endMs) })
    this.sqlite.prepare(`DELETE FROM dialogue_plans WHERE episode_id=?`).run(id)
    return id
  }

  updateShotMedia(id: string, kind: 'image' | 'video', path: string): void {
    const column = kind === 'image' ? 'image_path' : 'video_path'; const status = kind === 'image' ? 'image-ready' : 'video-ready'
    this.sqlite.prepare(`UPDATE shots SET ${column}=?,status=?,updated_at=? WHERE id=?`).run(path, status, now(), id)
    if (kind === 'video') {
      const row = this.sqlite.prepare(`SELECT episode_id episodeId FROM shots WHERE id=?`).get(id) as { episodeId: string } | undefined
      if (row) this.invalidateDialoguePlans(row.episodeId)
    }
  }

  addAsset(input: { projectId: string; entityType: string; entityId: string; kind: string; locale?: string; path: string; sourceUrl?: string; metadata?: Record<string, unknown> }): string {
    const id = randomUUID(); const revision = Number((this.sqlite.prepare(`SELECT MAX(revision) value FROM assets WHERE entity_id=? AND kind=?`).get(input.entityId, input.kind) as { value?: number } | undefined)?.value ?? 0) + 1
    this.sqlite.prepare(`INSERT INTO assets VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.projectId, input.entityType, input.entityId, input.kind, input.locale ?? null, input.path, input.sourceUrl ?? null, JSON.stringify(input.metadata ?? {}), revision, now())
    return id
  }

  listGridAssets(projectId: string): Array<{ id: string; path: string; createdAt: string }> {
    return this.sqlite.prepare(`SELECT id, path, created_at createdAt FROM assets WHERE project_id=? AND kind='storyboard-grid' ORDER BY created_at DESC`).all(projectId) as Array<{ id: string; path: string; createdAt: string }>
  }

  createPublishJob(draftId: string, platform: string): string {
    const id = randomUUID(); const stamp = now()
    this.sqlite.prepare(`INSERT INTO publish_jobs VALUES(?,?,?,NULL,'running',NULL,NULL,0,?,?) ON CONFLICT(draft_id) DO UPDATE SET status='running',error=NULL,attempts=publish_jobs.attempts+1,updated_at=excluded.updated_at`).run(id, draftId, platform, stamp, stamp)
    return (this.sqlite.prepare(`SELECT id FROM publish_jobs WHERE draft_id=?`).get(draftId) as { id: string }).id
  }

  finishPublishJob(id: string, result: { externalId: string; status: string; resultUrl?: string; error?: string }): void {
    this.sqlite.prepare(`UPDATE publish_jobs SET external_id=?,status=?,result_url=?,error=?,updated_at=? WHERE id=?`).run(result.externalId, result.status, result.resultUrl ?? null, result.error ?? null, now(), id)
  }

  listPublishDrafts(): PublishDraft[] {
    const rows = this.sqlite.prepare(`SELECT id,render_id renderId,platform,title,description,tags_json tagsJson,cover_path coverPath,scheduled_at scheduledAt,visibility,approved FROM publish_drafts ORDER BY created_at DESC`).all() as Array<Omit<PublishDraft, 'tags'> & { tagsJson: string }>
    return rows.map(({ tagsJson, ...row }) => ({ ...row, tags: JSON.parse(tagsJson) as string[] }))
  }

  createPublishDrafts(input: PublishDraftInput): string[] {
    const stamp = now(); const stmt = this.sqlite.prepare(`INSERT INTO publish_drafts VALUES(?,?,?,?,?,?,?,?,?,0,?,?)`)
    return input.platforms.map((platform) => { const id = randomUUID(); stmt.run(id, input.renderId, platform, input.title, input.description, JSON.stringify(input.tags), input.coverPath, input.scheduledAt, input.visibility, stamp, stamp); return id })
  }

  getPublishDraft(id: string): PublishDraft | null { return this.listPublishDrafts().find((draft) => draft.id === id) ?? null }
  approvePublishDraft(id: string): void { this.sqlite.prepare(`UPDATE publish_drafts SET approved=1,updated_at=? WHERE id=?`).run(now(), id) }

  getRender(id: string): Record<string, unknown> | null {
    return (this.sqlite.prepare(`SELECT id,episode_id episodeId,locale,status,video_path videoPath,master_path masterPath,subtitle_path subtitlePath,cover_path coverPath,config_json configJson FROM render_variants WHERE id=?`).get(id) as Record<string, unknown> | undefined) ?? null
  }

  snapshot(projectId?: string, configured = { ark: false, speech: false, tiktok: false, youtube: false }): DashboardSnapshot {
    const projects = this.listProjects(); const selected = projectId ? this.getProject(projectId) : projects[0] ?? null
    const episodes = selected ? this.listEpisodes(selected.id) : []
    return { projects, activeProject: selected ? { ...selected, episodes, shots: this.listShotsForProject(selected.id), characters: this.listCharacters(selected.id), dialoguePlans: episodes.flatMap((episode) => this.listDialoguePlans(episode.id)), gridAssets: this.listGridAssets(selected.id) } : null, jobs: this.listJobs(), publishDrafts: this.listPublishDrafts(), renders: selected ? this.listRendersForProject(selected.id) as DashboardSnapshot['renders'] : [], configured, modelSettings: { arkTextModel: 'doubao-seed-2-1-turbo-260628', arkTextApi: 'responses', arkTextStream: true, seedreamModel: 'doubao-seedream-5-0-pro-260628', seedanceModel: 'doubao-seedance-2-0-fast-260128', speechResourceId: 'seed-tts-2.0', speechVoiceId: 'zh_female_vv_uranus_bigtts', speechEnglishVoiceId: 'en_female_dacey_uranus_bigtts' } }
  }
}
