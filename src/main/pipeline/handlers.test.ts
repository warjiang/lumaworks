import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { AppDatabase } from '../db/database'
import { DiagnosticsService } from '../diagnostics/service'
import { JobRunner } from '../jobs/runner'
import { registerPipelineHandlers } from './handlers'

const paths: string[] = []
afterEach(async () => { await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

async function waitFor(check: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) { if (Date.now() > deadline) throw new Error('timed out'); await new Promise((resolve) => setTimeout(resolve, 10)) }
}

async function fixture(lineCount = 1) {
  const root = await mkdtemp(join(tmpdir(), 'lumaworks-pipeline-')); paths.push(root)
  const db = new AppDatabase(join(root, 'test.sqlite'))
  const diagnostics = new DiagnosticsService(db, { available: () => true, encrypt: (value) => Buffer.from(value).toString('base64'), decrypt: (value) => Buffer.from(value, 'base64').toString() }, join(root, 'emergency.jsonl'))
  const runner = new JobRunner(db, diagnostics, 16)
  const projectId = db.createProject({ title: '并行测试', synopsis: '测试流水线与配音并行。', visualStyle: 'cinematic' })
  const episodeId = db.replaceEpisodeScript(projectId, {
    title: '第一集', summary: '测试',
    shots: Array.from({ length: 8 }, (_, index) => ({ title: `镜头${index}`, description: '剧情', imagePrompt: '原创人物', videoPrompt: '人物移动', durationSeconds: 4 })),
    dialogue: Array.from({ length: lineCount }, (_, index) => ({ speaker: '角色', text: `台词${index}`, startMs: index * 500, endMs: index * 500 + 400 })),
  })
  return { root, db, diagnostics, runner, projectId, episodeId }
}

describe('parallel pipeline handlers', () => {
  it('starts a shot video as soon as its missing keyframe completes', async () => {
    const { root, db, diagnostics, runner, projectId, episodeId } = await fixture()
    let videoImagePath = ''
    const ark = {
      withTrace() { return this },
      async generateImage() { return { url: 'https://example.test/frame.jpg' } },
      async generateVideo(input: { imagePath: string }) { videoImagePath = input.imagePath; return { url: 'https://example.test/video.mp4', externalId: 'video-1' } },
    }
    const media = {
      projectDir: () => root,
      async download(_projectId: string, kind: string) { return join(root, kind, kind === 'images' ? 'frame.jpg' : 'video.mp4') },
    }
    registerPipelineHandlers({ db, runner, ark: ark as never, speech: {} as never, media: media as never, renderer: {} as never, publishers: {} as never })
    runner.start()
    const shot = db.listShotsForEpisode(episodeId)[0]
    runner.enqueue({ type: 'shot-image', entityId: shot.id, payload: { continueToVideo: true, batchScheduledAt: new Date().toISOString() }, force: true })
    await waitFor(() => Boolean(db.getShot(shot.id)?.videoPath))
    expect(videoImagePath).toContain('frame.jpg')
    expect(db.listJobs().filter((job) => job.entityId === shot.id).map((job) => job.type)).toEqual(expect.arrayContaining(['shot-image', 'shot-video']))
    expect(db.getProject(projectId)).not.toBeNull()
    runner.stop(); diagnostics.clear(); db.close()
  })

  it('synthesizes lines four at a time instead of serially', async () => {
    const { root, db, diagnostics, runner, episodeId } = await fixture(8)
    const lines = db.listVoiceLines(episodeId, 'zh-CN')
    db.applyDialoguePlan(episodeId, 'zh-CN', 'test-plan', 4_000, lines.map((line, index) => ({ id: line.id, shotId: db.listShotsForEpisode(episodeId)[0].id, shotPosition: 1, startMs: index * 500, endMs: index * 500 + 400 })))
    let active = 0; let peak = 0
    const speech = {
      withTrace() { return this },
      resolveVoiceId(_locale: string, override?: string) { return override ?? 'default-voice' },
      async synthesize(input: { outputPath: string }) {
        active++; peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 20))
        await mkdir(dirname(input.outputPath), { recursive: true }); await writeFile(input.outputPath, 'audio')
        active--
        return { path: input.outputPath, requestId: 'request', bytes: 1 }
      },
    }
    const media = { projectDir: () => root }
    const renderer = { async probeDuration() { return 300 }, async calibrateAudio() { return 300 } }
    registerPipelineHandlers({ db, runner, ark: {} as never, speech: speech as never, media: media as never, renderer: renderer as never, publishers: {} as never })
    runner.start()
    const job = runner.enqueue({ type: 'voice-line', entityId: episodeId, payload: { locale: 'zh-CN' }, force: true })
    await waitFor(() => db.getJob(job.id)?.status === 'completed')
    expect(peak).toBe(4)
    expect(db.listVoiceLines(episodeId, 'zh-CN').every((line) => Boolean(line.audioPath))).toBe(true)
    runner.stop(); diagnostics.clear(); db.close()
  })

  it('falls back from an invalid character voice and records the effective voice', async () => {
    const { root, db, diagnostics, runner, projectId, episodeId } = await fixture(1)
    const stamp = new Date().toISOString()
    db.sqlite.prepare(`INSERT INTO characters(id,project_id,name,role,description,voice_id,reference_asset_id,created_at,updated_at,voice_description,voice_preset,zh_voice_id,en_voice_id,voice_locked) VALUES(?,?,?,?,?,NULL,NULL,?,?,?,?,?,?,?)`).run('character', projectId, '角色', '主角', '青年', stamp, stamp, '自然', 'young-male', 'invalid-voice', 'english-voice', 1)
    const [line] = db.listVoiceLines(episodeId, 'zh-CN'); const [shot] = db.listShotsForEpisode(episodeId)
    db.applyDialoguePlan(episodeId, 'zh-CN', 'fallback-plan', 4_000, [{ id: line.id, shotId: shot.id, shotPosition: 1, startMs: 200, endMs: 1_200 }])
    const attempted: string[] = []
    const speech = {
      withTrace() { return this },
      resolveVoiceId(_locale: string, override?: string) { return override ?? 'default-voice' },
      async synthesize(input: { outputPath: string; voiceId?: string }) {
        attempted.push(input.voiceId ?? '')
        if (input.voiceId === 'invalid-voice') throw new Error('[Invalid argument] speaker not found')
        await mkdir(dirname(input.outputPath), { recursive: true }); await writeFile(input.outputPath, 'audio')
        return { path: input.outputPath, requestId: 'request', bytes: 1 }
      },
    }
    const renderer = { async probeDuration() { return 700 }, async calibrateAudio() { return 700 } }
    registerPipelineHandlers({ db, runner, ark: {} as never, speech: speech as never, media: { projectDir: () => root } as never, renderer: renderer as never, publishers: {} as never })
    runner.start()
    const job = runner.enqueue({ type: 'voice-line', entityId: episodeId, payload: { locale: 'zh-CN' }, force: true })
    await waitFor(() => db.getJob(job.id)?.status === 'completed')
    expect(attempted).toEqual(['invalid-voice', 'default-voice'])
    expect(db.listVoiceLines(episodeId, 'zh-CN')[0].voiceId).toBe('default-voice')
    expect(db.getCharacterVoiceById('character')?.zhVoiceWarning).toContain('已回退到项目默认音色')
    runner.stop(); diagnostics.clear(); db.close()
  })
})
