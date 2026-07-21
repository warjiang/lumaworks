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

  it('runs the two-phase script pipeline and assembles carry-over plus constraint pack into video prompts', async () => {
    const { root, db, diagnostics, runner, projectId } = await fixture()
    db.saveStoryBible(projectId, JSON.stringify({
      world: '原创世界', visualDirection: '冷峻写实，低饱和青灰色调', logline: '原创冲突',
      characters: [{ name: '角色', role: '主角', appearance: '32岁瘦长脸男性，黑色立领衬衫', personality: '克制', voice: '低沉' }],
      locations: [{ name: '画廊', description: '展厅', visualPrompt: '冷色展厅' }],
      episodes: [{ number: 1, title: '第一集', summary: '剧情', hook: '钩子', cliffhanger: '悬念' }],
    }))
    const planShots = Array.from({ length: 8 }, (_, index) => ({
      title: `镜头${index + 1}`, description: '焦点层+在场层+环境层', characters: ['角色'], location: '画廊', sceneType: 'daily', sourceText: '原文片段', carryOver: index === 0 ? '' : '上镜定格于角色转身望向门口', durationSeconds: 5,
    }))
    const detailShots = planShots.map((shot) => ({ title: shot.title, description: shot.description, shotType: '平视中景', cameraMove: '缓推', imagePrompt: '风格锚点 角色外观 场景 景深 灯光', videoPrompt: '年轻男子转头望向门口，镜头缓缓推近', actingNotes: '眉头轻皱', durationSeconds: 5 }))
    const arkOutputs = [
      { title: '第一集', summary: '测试', shots: planShots, dialogue: [{ speaker: '角色', text: '台词', shotPosition: 1, startMs: 0, endMs: 1000 }] },
      { shots: detailShots },
      { grade: 'A', problems: [] },
    ]
    let videoPrompt = ''
    const ark = {
      withTrace() { return this },
      async generateJson(_prompt: string, validate: (value: unknown) => unknown) { return validate(arkOutputs.shift()) },
      async generateImage() { return { url: 'https://example.test/frame.jpg' } },
      async generateVideo(input: { prompt: string }) { videoPrompt = input.prompt; return { url: 'https://example.test/video.mp4', externalId: 'video-1' } },
    }
    const media = { projectDir: () => root, async download(_projectId: string, kind: string) { return join(root, kind, kind === 'images' ? 'frame.jpg' : 'video.mp4') } }
    registerPipelineHandlers({ db, runner, ark: ark as never, speech: {} as never, media: media as never, renderer: {} as never, publishers: {} as never })
    runner.start()
    const scriptJob = runner.enqueue({ type: 'episode-script', entityId: projectId, payload: { episodeNumber: 1 }, force: true })
    await waitFor(() => db.getJob(scriptJob.id)?.status === 'completed')
    const episode = db.listEpisodes(projectId)[0]
    const shots = db.listShotsForEpisode(episode.id)
    expect(shots).toHaveLength(8)
    expect(shots[1].direction).toMatchObject({ carryOver: '上镜定格于角色转身望向门口', shotType: '平视中景', cameraMove: '缓推', sceneType: 'daily' })
    runner.enqueue({ type: 'shot-image', entityId: shots[1].id, payload: { continueToVideo: true, batchScheduledAt: new Date().toISOString() }, force: true })
    await waitFor(() => Boolean(db.getShot(shots[1].id)?.videoPath))
    expect(videoPrompt).toContain('承接上镜：上镜定格于角色转身望向门口')
    expect(videoPrompt).toContain('年轻男子转头望向门口')
    expect(videoPrompt).toContain('动作连贯自然，不僵硬')
    expect(videoPrompt).toContain('无穿模无卡顿')
    runner.stop(); diagnostics.clear(); db.close()
  })

  it('auto-revises the script once when the review grades it C or D', async () => {
    const { root, db, diagnostics, runner, projectId } = await fixture()
    db.saveStoryBible(projectId, JSON.stringify({
      world: '原创世界', visualDirection: '冷峻写实', logline: '原创冲突',
      characters: [{ name: '角色', role: '主角', appearance: '32岁男性', personality: '克制', voice: '低沉' }],
      locations: [{ name: '画廊', description: '展厅', visualPrompt: '冷色展厅' }],
      episodes: [{ number: 1, title: '第一集', summary: '剧情', hook: '钩子', cliffhanger: '悬念' }],
    }))
    const planShots = Array.from({ length: 8 }, (_, index) => ({
      title: `镜头${index + 1}`, description: '画面', characters: ['角色'], location: '画廊', sceneType: 'daily', sourceText: '原文', carryOver: '', durationSeconds: 5,
    }))
    const detailShots = planShots.map((shot) => ({ title: shot.title, description: shot.description, shotType: '平视中景', cameraMove: '固定', imagePrompt: '首帧提示词', videoPrompt: '年轻男子站着不动', actingNotes: '', durationSeconds: 5 }))
    const revisedShots = planShots.map((shot, index) => ({
      title: shot.title, description: '修复后的画面', imagePrompt: '修复后首帧', videoPrompt: '年轻男子转身走向窗边，镜头缓缓推近', durationSeconds: 5, characters: ['角色'],
      direction: { sceneType: 'daily', shotType: '平视中景', cameraMove: '缓推', location: '画廊', sourceText: '原文', carryOver: index === 0 ? '' : '上镜定格状态', actingNotes: '' },
    }))
    const arkOutputs = [
      { title: '第一集', summary: '测试', shots: planShots, dialogue: [{ speaker: '角色', text: '台词', shotPosition: 1, startMs: 0, endMs: 1000 }] },
      { shots: detailShots },
      { grade: 'C', problems: [{ shotPosition: 3, rule: 'R4 动作桥梁', issue: 'carryOver 为空且非首镜', fix: '补充上镜定格状态' }] },
      { title: '第一集', summary: '测试', shots: revisedShots, dialogue: [{ speaker: '角色', text: '台词', shotPosition: 1, startMs: 0, endMs: 1000 }] },
    ]
    const prompts: string[] = []
    const ark = {
      withTrace() { return this },
      async generateJson(prompt: string, validate: (value: unknown) => unknown) { prompts.push(prompt); return validate(arkOutputs.shift()) },
    }
    registerPipelineHandlers({ db, runner, ark: ark as never, speech: {} as never, media: { projectDir: () => root } as never, renderer: {} as never, publishers: {} as never })
    runner.start()
    const scriptJob = runner.enqueue({ type: 'episode-script', entityId: projectId, payload: { episodeNumber: 1 }, force: true })
    await waitFor(() => db.getJob(scriptJob.id)?.status === 'completed')
    expect(db.getJob(scriptJob.id)?.resultJson).toContain('"reviewGrade":"C"')
    expect(prompts[3]).toContain('R4 动作桥梁')
    const episode = db.listEpisodes(projectId)[0]
    const shots = db.listShotsForEpisode(episode.id)
    expect(shots[0].description).toBe('修复后的画面')
    expect(shots[0].videoPrompt).toContain('转身走向窗边')
    runner.stop(); diagnostics.clear(); db.close()
  })

  it('generates a 2x2 grid storyboard and assigns sliced cells to four shots', async () => {
    const { root, db, diagnostics, runner, episodeId } = await fixture()
    let gridPrompt = ''
    const ark = {
      withTrace() { return this },
      async generateImage(input: { prompt: string }) { gridPrompt = input.prompt; return { url: 'https://example.test/grid.jpg' } },
    }
    const media = { projectDir: () => root, async download(_projectId: string, kind: string) { return join(root, kind, 'grid.jpg') } }
    const renderer = { async sliceGrid(_path: string, _rows: number, _cols: number, dir: string) { return [1, 2, 3, 4].map((index) => join(dir, `cell-${index}.jpg`)) } }
    registerPipelineHandlers({ db, runner, ark: ark as never, speech: {} as never, media: media as never, renderer: renderer as never, publishers: {} as never })
    runner.start()
    const shots = db.listShotsForEpisode(episodeId).slice(0, 4)
    const job = runner.enqueue({ type: 'shot-grid-image', entityId: episodeId, payload: { shotIds: shots.map((shot) => shot.id) }, force: true })
    await waitFor(() => db.getJob(job.id)?.status === 'completed')
    expect(gridPrompt).toContain('exactly 4 visible panels')
    expect(gridPrompt).toContain('格1（左上）')
    expect(gridPrompt).toContain('格4（右下）')
    for (const [index, shot] of shots.entries()) {
      expect(db.getShot(shot.id)?.imagePath).toContain(`cell-${index + 1}.jpg`)
    }
    runner.stop(); diagnostics.clear(); db.close()
  })

  it('rejects grid generation without exactly four shots', async () => {
    const { root, db, diagnostics, runner, episodeId } = await fixture()
    registerPipelineHandlers({ db, runner, ark: {} as never, speech: {} as never, media: { projectDir: () => root } as never, renderer: {} as never, publishers: {} as never })
    runner.start()
    const shots = db.listShotsForEpisode(episodeId).slice(0, 3)
    const job = runner.enqueue({ type: 'shot-grid-image', entityId: episodeId, payload: { shotIds: shots.map((shot) => shot.id) }, force: true })
    await waitFor(() => db.getJob(job.id)?.status === 'failed')
    expect(db.getJob(job.id)?.error).toContain('恰好 4 个镜头')
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
