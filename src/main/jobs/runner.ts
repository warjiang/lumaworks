import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import type { EnqueueJobInput, Job, JobType, ProgressState } from '@shared/domain'
import type { ProviderTraceEntry } from '../providers/types'
import type { AppDatabase } from '../db/database'
import type { DiagnosticsService } from '../diagnostics/service'
import { isRetryableJobError } from '../errors'

export interface JobContext {
  job: Job
  signal: AbortSignal
  stage(phase: string, message: string, details?: Record<string, unknown>): void
  progress(value: number, message?: string, counts?: { current?: number; total?: number; unit?: string }): void
  trace(entry: Omit<ProviderTraceEntry, 'timestamp'>): void
}
export type JobHandler = (context: JobContext) => Promise<Record<string, unknown> | void>

const terminal = new Set(['completed', 'failed', 'cancelled'])
type JobLane = 'local' | 'text' | 'image' | 'video' | 'speech' | 'render' | 'publish'

const defaultLaneLimits: Record<JobLane, number> = {
  local: 12, text: 4, image: 6, video: 6, speech: 2, render: 2, publish: 3,
}

function jobLane(type: JobType): JobLane {
  if (['story-foundation', 'story-characters', 'story-locations', 'story-episodes', 'episode-script', 'translate-episode'].includes(type)) return 'text'
  if (['character-image', 'location-image', 'shot-image', 'shot-grid-image'].includes(type)) return 'image'
  if (type === 'shot-video') return 'video'
  if (type === 'voice-line') return 'speech'
  if (type === 'render-episode') return 'render'
  if (type === 'publish') return 'publish'
  return 'local'
}

export class JobRunner extends EventEmitter {
  private timer: NodeJS.Timeout | null = null
  private heartbeatTimer: NodeJS.Timeout | null = null
  private stopping = false
  private readonly controllers = new Map<string, AbortController>()
  private readonly activeLanes = new Map<string, JobLane>()
  private readonly handlers = new Map<JobType, JobHandler>()
  private readonly laneLimits: Record<JobLane, number>

  constructor(private readonly db: AppDatabase, private readonly diagnostics: DiagnosticsService, private readonly maxConcurrency = 16, laneLimits: Partial<Record<JobLane, number>> = {}) {
    super()
    this.laneLimits = { ...defaultLaneLimits, ...laneLimits }
  }

  register(type: JobType, handler: JobHandler): void { this.handlers.set(type, handler) }

  start(): void {
    this.stopping = false
    for (const job of this.db.recoverJobs()) {
      this.diagnostics.log({ jobId: job.id, projectId: job.projectId, attempt: job.attempts, level: 'warn', phase: 'job.recovered', message: '应用重启后任务已恢复到队列', details: { previousAttempts: job.attempts } })
      this.emitJob(job)
    }
    this.timer = setInterval(() => void this.tick(), 750)
    this.heartbeatTimer = setInterval(() => this.heartbeat(), 10_000)
    void this.tick()
  }

  stop(): void {
    this.stopping = true
    if (this.timer) clearInterval(this.timer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.timer = null; this.heartbeatTimer = null
    for (const controller of this.controllers.values()) controller.abort()
  }

  isIdle(): boolean { return this.controllers.size === 0 }

  enqueue(input: EnqueueJobInput): Job {
    const scheduledAt = input.scheduledAt ?? new Date().toISOString()
    const key = `${input.type}:${input.entityId}:${JSON.stringify(input.payload)}:${scheduledAt.slice(0, 16)}`
    if (!input.force) {
      const existing = this.db.getJobByKey(key)
      if (existing) {
        this.diagnostics.log({ jobId: existing.id, projectId: existing.projectId, attempt: existing.attempts || null, phase: 'job.deduplicated', message: '检测到相同任务，已复用现有任务', details: { idempotencyKey: key, status: existing.status } })
        this.emitJob(existing)
        return existing
      }
    }
    const stamp = new Date().toISOString()
    const projectId = this.db.resolveJobProjectId(input.type, input.entityId, input.payload)
    const job: Job = {
      id: randomUUID(), type: input.type, status: 'queued', entityId: input.entityId, projectId,
      payloadJson: JSON.stringify(input.payload), resultJson: null, error: null, progress: 0, progressMode: 'indeterminate',
      currentPhase: 'job.queued', currentMessage: scheduledAt > stamp ? '等待计划执行时间' : '等待执行',
      attempts: 0, maxAttempts: 3, scheduledAt, startedAt: null, finishedAt: null, heartbeatAt: null,
      idempotencyKey: input.force ? `${key}:${randomUUID()}` : key, createdAt: stamp, updatedAt: stamp,
    }
    this.db.insertJob(job)
    this.diagnostics.log({ jobId: job.id, projectId, phase: 'job.queued', message: '任务已进入队列', details: { type: job.type, entityId: job.entityId, scheduledAt } })
    this.emitJob(job); void this.tick(); return job
  }

  cancel(id: string): void {
    const source = this.db.getJob(id)
    if (!source || terminal.has(source.status)) return
    this.controllers.get(id)?.abort()
    this.diagnostics.log({ jobId: id, projectId: source.projectId, attempt: source.attempts || null, level: 'warn', phase: 'job.cancelled', message: '用户取消了任务' })
    const job = this.db.updateJob(id, { status: 'cancelled', error: '用户已取消', currentPhase: 'job.cancelled', currentMessage: '已取消', finishedAt: new Date().toISOString(), heartbeatAt: null })
    this.emitJob(job)
  }

  retry(id: string): Job {
    const source = this.db.getJob(id); if (!source) throw new Error('任务不存在')
    this.diagnostics.log({ jobId: id, projectId: source.projectId, attempt: source.attempts || null, phase: 'job.manual_retry', message: '用户请求重新执行任务' })
    return this.enqueue({ type: source.type, entityId: source.entityId, payload: JSON.parse(source.payloadJson) as Record<string, unknown>, force: true })
  }

  private tick(): void {
    while (!this.stopping && this.controllers.size < this.maxConcurrency) {
      const job = this.db.listRunnableJobs().find((candidate) => this.hasLaneCapacity(jobLane(candidate.type)))
      if (!job) return
      void this.runJob(job)
    }
  }

  private hasLaneCapacity(lane: JobLane): boolean {
    let active = 0
    for (const value of this.activeLanes.values()) if (value === lane) active++
    return active < this.laneLimits[lane]
  }

  private async runJob(job: Job): Promise<void> {
    const handler = this.handlers.get(job.type)
    if (!handler) {
      this.diagnostics.log({ jobId: job.id, projectId: job.projectId, level: 'error', phase: 'job.handler_missing', message: `未注册任务处理器: ${job.type}` })
      this.emitJob(this.db.updateJob(job.id, { status: 'failed', error: `未注册任务处理器: ${job.type}`, currentPhase: 'job.failed', currentMessage: '任务处理器不存在', finishedAt: new Date().toISOString() }))
      setImmediate(() => this.tick())
      return
    }
    const controller = new AbortController(); this.controllers.set(job.id, controller); this.activeLanes.set(job.id, jobLane(job.type))
    const stamp = new Date().toISOString()
    let current = this.db.updateJob(job.id, { status: 'running', attempts: job.attempts + 1, progress: 0, progressMode: 'indeterminate', currentPhase: 'job.started', currentMessage: `开始第 ${job.attempts + 1} 次执行`, error: null, startedAt: job.startedAt ?? stamp, finishedAt: null, heartbeatAt: stamp })
    this.diagnostics.log({ jobId: job.id, projectId: job.projectId, attempt: current.attempts, phase: 'job.started', message: `开始第 ${current.attempts} 次执行`, details: { maxAttempts: current.maxAttempts } })
    this.emitJob(current)

    const update = (phase: string, message: string, progress: ProgressState, details?: Record<string, unknown>): void => {
      if (controller.signal.aborted) throw abortError()
      const value = progress.mode === 'determinate' ? Math.max(0, Math.min(99, Math.round(progress.value ?? 0))) : 0
      current = this.db.updateJob(job.id, { progress: value, progressMode: progress.mode, currentPhase: phase, currentMessage: message, heartbeatAt: new Date().toISOString() })
      this.diagnostics.log({ jobId: job.id, projectId: job.projectId, attempt: current.attempts, phase, message, progress, details })
      this.emitJob(current)
    }

    try {
      const result = await handler({
        job: current,
        signal: controller.signal,
        stage: (phase, message, details) => update(phase, message, { mode: 'indeterminate' }, details),
        progress: (value, message = '任务处理中', counts) => update('job.progress', message, { mode: 'determinate', value, ...counts }),
        trace: (entry) => {
          this.diagnostics.log({ jobId: job.id, projectId: job.projectId, attempt: current.attempts, level: entry.level, scope: 'provider', phase: entry.phase, message: entry.message, details: entry.details })
          current = this.db.updateJob(job.id, { currentPhase: entry.phase, currentMessage: entry.message, heartbeatAt: new Date().toISOString() })
          this.emitJob(current)
        },
      })
      if (controller.signal.aborted) return
      this.diagnostics.log({ jobId: job.id, projectId: job.projectId, attempt: current.attempts, phase: 'job.completed', message: '任务执行完成', details: result ?? {} })
      this.emitJob(this.db.updateJob(job.id, { status: 'completed', progress: 100, progressMode: 'determinate', currentPhase: 'job.completed', currentMessage: '已完成', resultJson: JSON.stringify(result ?? {}), finishedAt: new Date().toISOString(), heartbeatAt: null }))
    } catch (error) {
      if (controller.signal.aborted && this.stopping) return
      if (controller.signal.aborted) {
        const latest = this.db.getJob(job.id)
        if (latest?.status !== 'cancelled') {
          this.diagnostics.log({ jobId: job.id, projectId: job.projectId, attempt: current.attempts, level: 'warn', phase: 'job.cancelled', message: '任务已取消' })
          this.emitJob(this.db.updateJob(job.id, { status: 'cancelled', error: '任务已取消', currentPhase: 'job.cancelled', currentMessage: '已取消', finishedAt: new Date().toISOString(), heartbeatAt: null }))
        }
      } else {
        const message = error instanceof Error ? error.message : String(error); const latest = this.db.getJob(job.id)!
        if (isRetryableJobError(error) && latest.attempts < latest.maxAttempts) {
          const scheduledAt = new Date(Date.now() + 2 ** latest.attempts * 5_000).toISOString()
          this.diagnostics.log({ jobId: job.id, projectId: job.projectId, attempt: latest.attempts, level: 'warn', phase: 'job.retry_scheduled', message: '任务失败，已安排自动重试', details: { error: message, scheduledAt, nextAttempt: latest.attempts + 1 } })
          this.emitJob(this.db.updateJob(job.id, { status: 'queued', error: message, scheduledAt, currentPhase: 'job.retry_scheduled', currentMessage: '等待自动重试', heartbeatAt: null }))
        } else {
          this.diagnostics.log({ jobId: job.id, projectId: job.projectId, attempt: latest.attempts, level: 'error', phase: 'job.failed', message, details: { stack: error instanceof Error ? error.stack : undefined } })
          this.emitJob(this.db.updateJob(job.id, { status: 'failed', error: message, currentPhase: 'job.failed', currentMessage: '执行失败', finishedAt: new Date().toISOString(), heartbeatAt: null }))
        }
      }
    } finally { this.controllers.delete(job.id); this.activeLanes.delete(job.id); setImmediate(() => this.tick()) }
  }

  private heartbeat(): void {
    for (const id of this.controllers.keys()) {
      const job = this.db.getJob(id)
      if (!job || job.status !== 'running') continue
      this.emitJob(this.db.updateJob(id, { heartbeatAt: new Date().toISOString() }))
    }
  }

  private emitJob(job: Job): void { this.emit('job', job) }
}

function abortError(): Error { const error = new Error('任务已取消'); error.name = 'AbortError'; return error }
