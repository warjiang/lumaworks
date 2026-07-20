import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DiagnosticEvent, DiagnosticLevel, DiagnosticScope, Job, JobDetails, ProgressState, SystemEventFilters } from '@shared/domain'
import type { AppDatabase, StoredDiagnosticEvent } from '../db/database'

export interface DiagnosticsCipher {
  available(): boolean
  encrypt(value: string): string
  decrypt(value: string): string | null
}

export interface DiagnosticInput {
  jobId?: string | null
  projectId?: string | null
  attempt?: number | null
  level?: DiagnosticLevel
  scope?: DiagnosticScope
  phase: string
  message: string
  progress?: ProgressState | null
  details?: Record<string, unknown>
}

const SENSITIVE_KEY = /authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|cookie|credential|password|signature/i
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000
const MAX_BYTES = 200 * 1024 * 1024

export function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/((?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|client[_ -]?secret|authorization|cookie|password|signature)\s*[:=]\s*)[^\s,;"}]+/gi, '$1[REDACTED]')
}

export function redactValue(value: unknown, key = ''): unknown {
  if (SENSITIVE_KEY.test(key) && !/configured|length|count|suffix/i.test(key)) return '[REDACTED]'
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map((item) => redactValue(item))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([nestedKey, item]) => [nestedKey, redactValue(item, nestedKey)]))
  return value
}

const ENCRYPTED_CONTENT_KEY = /^(prompt|content|instructions|request|response|candidate|text|contextTexts)$/i

function summarizeValue(value: unknown, depth = 0, key = ''): unknown {
  if (ENCRYPTED_CONTENT_KEY.test(key)) {
    if (typeof value === 'string') return `[Encrypted text: ${value.length} chars]`
    return '[Encrypted payload]'
  }
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}… [${value.length} chars]` : value
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => summarizeValue(item, depth + 1))
  if (value && typeof value === 'object' && depth < 4) return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40).map(([nestedKey, item]) => [nestedKey, summarizeValue(item, depth + 1, nestedKey)]))
  if (value && typeof value === 'object') return '[Object]'
  return value
}

export class DiagnosticsService extends EventEmitter {
  constructor(
    private readonly db: AppDatabase,
    private readonly cipher: DiagnosticsCipher,
    private readonly emergencyPath: string,
  ) { super() }

  log(input: DiagnosticInput): DiagnosticEvent {
    const timestamp = new Date().toISOString()
    const message = redactString(input.message).slice(0, 4_000)
    const sanitized = input.details ? redactValue(input.details) as Record<string, unknown> : undefined
    let encryptedPayload: string | null = null
    let payloadAvailable = false
    let summary = sanitized ? summarizeValue(sanitized) as Record<string, unknown> : undefined
    if (sanitized) {
      if (this.cipher.available()) {
        try {
          encryptedPayload = this.cipher.encrypt(JSON.stringify(sanitized))
          payloadAvailable = true
        } catch (error) {
          summary = { ...summary, diagnosticWarning: `正文加密失败，未落盘：${error instanceof Error ? error.message : String(error)}` }
        }
      } else summary = { ...summary, diagnosticWarning: '系统安全存储不可用，完整正文未落盘' }
    }
    let sequence = 0
    try { sequence = this.db.nextDiagnosticSequence(input.jobId ?? null) }
    catch (error) {
      const fallback: DiagnosticEvent = {
        id: randomUUID(), jobId: input.jobId ?? null, projectId: input.projectId ?? null, attempt: input.attempt ?? null,
        sequence, timestamp, level: input.level ?? 'error', scope: input.scope ?? (input.jobId ? 'job' : 'app'),
        phase: input.phase, message, progress: input.progress ?? null, details: summary, payloadAvailable: false,
      }
      this.writeEmergency({ event: fallback, persistenceError: error instanceof Error ? error.message : String(error) })
      return fallback
    }
    const event: DiagnosticEvent = {
      id: randomUUID(), jobId: input.jobId ?? null, projectId: input.projectId ?? null, attempt: input.attempt ?? null,
      sequence, timestamp, level: input.level ?? 'info', scope: input.scope ?? (input.jobId ? 'job' : 'app'),
      phase: input.phase, message, progress: input.progress ?? null,
      details: payloadAvailable ? sanitized : summary, payloadAvailable,
    }
    const row: StoredDiagnosticEvent = {
      ...event,
      progressJson: event.progress ? JSON.stringify(event.progress) : null,
      summaryJson: summary ? JSON.stringify(summary) : null,
      encryptedPayload,
      sizeBytes: Buffer.byteLength(message) + Buffer.byteLength(encryptedPayload ?? '') + Buffer.byteLength(JSON.stringify(summary ?? {})),
    }
    try {
      this.db.insertDiagnosticEvent(row)
      this.emit('event', event)
      if (event.level === 'error') console.error(`[${event.phase}] ${event.message}`)
      else if (event.level === 'warn') console.warn(`[${event.phase}] ${event.message}`)
      else console.info(`[${event.phase}] ${event.message}`)
    } catch (error) {
      this.writeEmergency({ event, persistenceError: error instanceof Error ? error.message : String(error) })
    }
    return event
  }

  forJob(job: Job): (entry: Omit<DiagnosticInput, 'jobId' | 'projectId' | 'attempt'>) => DiagnosticEvent {
    return (entry) => this.log({ ...entry, jobId: job.id, projectId: job.projectId, attempt: job.attempts })
  }

  getJobDetails(jobId: string): JobDetails {
    const job = this.db.getJob(jobId)
    if (!job) throw new Error('任务不存在')
    return { job, events: this.db.listJobDiagnosticEvents(jobId).map((row) => this.fromStored(row)) }
  }

  listSystemEvents(filters: SystemEventFilters = {}): DiagnosticEvent[] {
    return this.db.listSystemDiagnosticEvents(filters).map((row) => this.fromStored(row))
  }

  clear(): void { this.db.clearDiagnosticEvents() }

  cleanup(): { deleted: number } {
    const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString()
    return this.db.cleanupDiagnosticEvents(cutoff, MAX_BYTES)
  }

  private fromStored(row: StoredDiagnosticEvent): DiagnosticEvent {
    let details: Record<string, unknown> | undefined
    if (row.encryptedPayload) {
      try {
        const decrypted = this.cipher.decrypt(row.encryptedPayload)
        if (decrypted) details = JSON.parse(decrypted) as Record<string, unknown>
      } catch { /* fall back to the searchable summary */ }
    }
    if (!details && row.summaryJson) {
      try { details = JSON.parse(row.summaryJson) as Record<string, unknown> } catch { /* malformed legacy summary */ }
    }
    let progress: ProgressState | null = null
    if (row.progressJson) {
      try { progress = JSON.parse(row.progressJson) as ProgressState } catch { /* malformed legacy progress */ }
    }
    return {
      id: row.id, jobId: row.jobId, projectId: row.projectId, attempt: row.attempt, sequence: row.sequence,
      timestamp: row.timestamp, level: row.level, scope: row.scope, phase: row.phase, message: row.message,
      progress, details, payloadAvailable: Boolean(row.encryptedPayload),
    }
  }

  private writeEmergency(value: unknown): void {
    try {
      mkdirSync(dirname(this.emergencyPath), { recursive: true })
      appendFileSync(this.emergencyPath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...value as Record<string, unknown> })}\n`, 'utf8')
    } catch { console.error('LumaWorks diagnostics persistence failed') }
  }
}
