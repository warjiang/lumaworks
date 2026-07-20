import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../db/database'
import { DiagnosticsService, type DiagnosticsCipher } from './service'

const paths: string[] = []
afterEach(async () => { await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

async function fixture(cipher?: DiagnosticsCipher) {
  const path = await mkdtemp(join(tmpdir(), 'lumaworks-diagnostics-')); paths.push(path)
  const db = new AppDatabase(join(path, 'test.sqlite'))
  const projectId = db.createProject({ title: '日志测试', synopsis: '这是一个用于验证任务日志加密、排序和脱敏能力的完整故事梗概。', visualStyle: 'cinematic' })
  const stamp = new Date().toISOString()
  db.insertJob({ id: 'job-1', type: 'story-bible', status: 'running', entityId: projectId, projectId, payloadJson: '{}', resultJson: null, error: null, progress: 0, progressMode: 'indeterminate', currentPhase: 'story.request_model', currentMessage: '等待模型', attempts: 1, maxAttempts: 3, scheduledAt: stamp, startedAt: stamp, finishedAt: null, heartbeatAt: stamp, idempotencyKey: 'job-1-key', createdAt: stamp, updatedAt: stamp })
  const defaultCipher: DiagnosticsCipher = { available: () => true, encrypt: (value) => Buffer.from(value).toString('base64'), decrypt: (value) => Buffer.from(value, 'base64').toString() }
  return { db, projectId, service: new DiagnosticsService(db, cipher ?? defaultCipher, join(path, 'emergency.jsonl')) }
}

describe('DiagnosticsService', () => {
  it('persists ordered encrypted details and redacts credentials', async () => {
    const { db, projectId, service } = await fixture()
    service.log({ jobId: 'job-1', projectId, attempt: 1, scope: 'provider', phase: 'text.request.body', message: 'Authorization: Bearer secret-token', details: { prompt: '完整故事提示词', apiKey: 'ark-secret' } })
    service.log({ jobId: 'job-1', projectId, attempt: 1, scope: 'provider', phase: 'text.response.body', message: '响应完成', details: { content: '{"world":"上海"}' } })
    const details = service.getJobDetails('job-1')
    expect(details.events.map((event) => event.sequence)).toEqual([1, 2])
    expect(details.events[0].message).not.toContain('secret-token')
    expect(details.events[0].details).toEqual({ prompt: '完整故事提示词', apiKey: '[REDACTED]' })
    expect(details.events[1].details).toEqual({ content: '{"world":"上海"}' })
    expect(db.sqlite.prepare(`SELECT encrypted_payload encryptedPayload FROM diagnostic_events WHERE id=?`).get(details.events[0].id)).toMatchObject({ encryptedPayload: expect.any(String) })
    const stored = db.sqlite.prepare(`SELECT summary_json summaryJson FROM diagnostic_events WHERE id=?`).get(details.events[0].id) as { summaryJson: string }
    expect(stored.summaryJson).not.toContain('完整故事提示词')
    db.close()
  })

  it('keeps a searchable summary without plaintext fallback when encryption is unavailable', async () => {
    const { db, projectId, service } = await fixture({ available: () => false, encrypt: () => { throw new Error('unavailable') }, decrypt: () => null })
    service.log({ jobId: 'job-1', projectId, phase: 'text.response.body', message: '响应完成', details: { content: '模型正文' } })
    const event = service.getJobDetails('job-1').events[0]
    expect(event.payloadAvailable).toBe(false)
    expect(event.details?.diagnosticWarning).toContain('正文未落盘')
    const row = db.sqlite.prepare(`SELECT encrypted_payload encryptedPayload FROM diagnostic_events`).get() as { encryptedPayload: string | null }
    expect(row.encryptedPayload).toBeNull()
    db.close()
  })
})
