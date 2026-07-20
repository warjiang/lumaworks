import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../db/database'
import { DiagnosticsService } from '../diagnostics/service'
import { JobRunner } from './runner'

const paths: string[] = []
afterEach(async () => { await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

async function setup() {
  const path = await mkdtemp(join(tmpdir(), 'lumaworks-runner-')); paths.push(path)
  const db = new AppDatabase(join(path, 'test.sqlite'))
  const diagnostics = new DiagnosticsService(db, { available: () => true, encrypt: (value) => Buffer.from(value).toString('base64'), decrypt: (value) => Buffer.from(value, 'base64').toString() }, join(path, 'emergency.jsonl'))
  const runner = new JobRunner(db, diagnostics)
  const projectId = db.createProject({ title: '任务测试', synopsis: '这是一个用于验证真实阶段进度和持久化时间线的短剧故事梗概。', visualStyle: 'cinematic' })
  return { db, diagnostics, runner, projectId }
}

async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) { if (Date.now() > deadline) throw new Error('timed out'); await new Promise((resolve) => setTimeout(resolve, 10)) }
}

describe('JobRunner diagnostics', () => {
  it('runs independent jobs concurrently up to the configured limit', async () => {
    const { db, diagnostics, projectId } = await setup()
    const runner = new JobRunner(db, diagnostics, 2)
    let active = 0; let peak = 0; let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const handler = async () => { active++; peak = Math.max(peak, active); await gate; active--; return { ok: true } }
    runner.register('story-characters', handler)
    runner.register('story-locations', handler)
    runner.start()
    const first = runner.enqueue({ type: 'story-characters', entityId: projectId, payload: {}, force: true })
    const second = runner.enqueue({ type: 'story-locations', entityId: projectId, payload: {}, force: true })
    await waitFor(() => db.getJob(first.id)?.status === 'running' && db.getJob(second.id)?.status === 'running')
    expect(peak).toBe(2)
    release()
    await waitFor(() => db.getJob(first.id)?.status === 'completed' && db.getJob(second.id)?.status === 'completed')
    runner.stop(); db.close()
  })

  it('does not let a saturated lane block work from another lane', async () => {
    const { db, diagnostics, projectId } = await setup()
    const runner = new JobRunner(db, diagnostics, 3, { text: 1, image: 1 })
    let releaseText!: () => void; let releaseImage!: () => void
    const textGate = new Promise<void>((resolve) => { releaseText = resolve })
    const imageGate = new Promise<void>((resolve) => { releaseImage = resolve })
    runner.register('story-characters', async () => { await textGate; return { ok: true } })
    runner.register('story-locations', async () => { await textGate; return { ok: true } })
    runner.register('shot-image', async () => { await imageGate; return { ok: true } })
    runner.start()
    const firstText = runner.enqueue({ type: 'story-characters', entityId: projectId, payload: {}, force: true })
    const secondText = runner.enqueue({ type: 'story-locations', entityId: projectId, payload: {}, force: true })
    const image = runner.enqueue({ type: 'shot-image', entityId: projectId, payload: {}, force: true })
    await waitFor(() => db.getJob(firstText.id)?.status === 'running' && db.getJob(image.id)?.status === 'running')
    expect(db.getJob(secondText.id)?.status).toBe('queued')
    releaseText(); releaseImage()
    await waitFor(() => db.getJob(secondText.id)?.status === 'completed')
    runner.stop(); db.close()
  })

  it('persists real stages before completing a job', async () => {
    const { db, diagnostics, runner, projectId } = await setup()
    runner.register('story-bible', async ({ stage, trace }) => {
      stage('story.build_prompt', '正在组装提示词')
      trace({ level: 'info', phase: 'http.request', message: '正在请求模型', details: { timeoutMs: 1000 } })
      stage('story.persist', '正在保存结果')
      return { ok: true }
    })
    runner.start(); const job = runner.enqueue({ type: 'story-bible', entityId: projectId, payload: {}, force: true })
    await waitFor(() => db.getJob(job.id)?.status === 'completed')
    const phases = diagnostics.getJobDetails(job.id).events.map((event) => event.phase)
    expect(phases).toEqual(expect.arrayContaining(['job.queued', 'job.started', 'story.build_prompt', 'http.request', 'story.persist', 'job.completed']))
    expect(db.getJob(job.id)).toMatchObject({ progress: 100, progressMode: 'determinate', currentPhase: 'job.completed' })
    runner.stop(); db.close()
  })

  it('does not complete after cancellation', async () => {
    const { db, runner, projectId } = await setup()
    runner.register('story-bible', async ({ signal, stage }) => {
      stage('story.request_model', '等待模型响应')
      await new Promise<void>((resolve, reject) => { signal.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error) }, { once: true }); setTimeout(resolve, 500) })
      return { shouldNotComplete: true }
    })
    runner.start(); const job = runner.enqueue({ type: 'story-bible', entityId: projectId, payload: {}, force: true })
    await waitFor(() => db.getJob(job.id)?.status === 'running')
    runner.cancel(job.id)
    await waitFor(() => db.getJob(job.id)?.status === 'cancelled')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(db.getJob(job.id)?.status).toBe('cancelled')
    runner.stop(); db.close()
  })
})
