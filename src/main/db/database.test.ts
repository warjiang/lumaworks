import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { AppDatabase } from './database'

const paths: string[] = []
afterEach(async () => { await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

async function createDb(): Promise<AppDatabase> {
  const path = await mkdtemp(join(tmpdir(), 'lumaworks-test-')); paths.push(path)
  return new AppDatabase(join(path, 'test.sqlite'))
}

describe('AppDatabase', () => {
  it('persists a project, script, shots and voice lines', async () => {
    const db = await createDb()
    const projectId = db.createProject({ title: '镜中婚礼', synopsis: '婚礼前夜，新娘发现镜子里的自己正在阻止婚礼继续。', visualStyle: 'cinematic realism' })
    db.saveStoryBible(projectId, JSON.stringify({ world: '上海' }))
    const episodeId = db.replaceEpisodeScript(projectId, {
      title: '镜子开口了', summary: '新娘收到警告',
      shots: Array.from({ length: 8 }, (_, index) => ({ title: `镜头${index + 1}`, description: '走廊', imagePrompt: '冷色走廊', videoPrompt: '缓慢推进', durationSeconds: 5 })),
      dialogue: [{ speaker: '林澈', text: '别相信他。', startMs: 0, endMs: 1800 }],
    })
    expect(db.getProject(projectId)?.title).toBe('镜中婚礼')
    expect(db.listShotsForEpisode(episodeId)).toHaveLength(8)
    expect(db.listVoiceLines(episodeId, 'zh-CN')[0].text).toBe('别相信他。')
    db.close()
  })

  it('stores idempotent jobs by key', async () => {
    const db = await createDb(); const stamp = new Date().toISOString()
    db.insertJob({ id: 'job-1', type: 'story-bible', status: 'queued', entityId: 'project-1', projectId: 'project-1', payloadJson: '{}', resultJson: null, error: null, progress: 0, progressMode: 'indeterminate', currentPhase: 'job.queued', currentMessage: '等待执行', attempts: 0, maxAttempts: 3, scheduledAt: stamp, startedAt: null, finishedAt: null, heartbeatAt: null, idempotencyKey: 'unique-key', createdAt: stamp, updatedAt: stamp })
    expect(db.getJobByKey('unique-key')?.id).toBe('job-1')
    db.close()
  })

  it('stores isolated story bible parts and rejects stale runs', async () => {
    const db = await createDb()
    const projectId = db.createProject({ title: '拆分测试', synopsis: '用于测试故事圣经并行子任务。', visualStyle: 'cinematic' })
    db.beginStoryBibleRun(projectId, 'run-1')
    expect(db.saveStoryBiblePart(projectId, 'run-1', 'foundation', { logline: 'first' })).toBe(true)
    expect(db.getStoryBibleParts(projectId, 'run-1')).toMatchObject({ foundation: { logline: 'first' } })
    db.beginStoryBibleRun(projectId, 'run-2')
    expect(db.saveStoryBiblePart(projectId, 'run-1', 'characters', { characters: [] })).toBe(false)
    expect(db.isActiveStoryBibleRun(projectId, 'run-2')).toBe(true)
    const bible = {
      world: '原创世界', visualDirection: '冷峻写实', logline: '原创冲突',
      characters: [{ name: '新角色', role: '主角', appearance: '短发灰外套', personality: '谨慎', voice: '低沉' }],
      locations: [{ name: '新场景', description: '剧情空间', visualPrompt: '冷色室内空间' }],
      episodes: [{ number: 1, title: '第一集', summary: '原创剧情', hook: '视觉钩子', cliffhanger: '结尾悬念' }],
    }
    expect(db.completeStoryBibleRun(projectId, 'run-2', bible)).toBe(true)
    expect(JSON.parse(db.getStoryBible(projectId)!)).toEqual(bible)
    expect(db.isActiveStoryBibleRun(projectId, 'run-2')).toBe(false)
    db.close()
  })

  it('preserves manually locked character voices when the story bible is regenerated', async () => {
    const db = await createDb(); const projectId = db.createProject({ title: '角色声音', synopsis: '这是用于验证角色音色持久化的完整故事简介。', visualStyle: 'cinematic' })
    const bible = { world: '城市', visualDirection: '写实', logline: '冲突', characters: [{ name: '林澈', role: '青年女主角', appearance: '27岁短发女性', personality: '冷静', voice: '克制的青年女声' }], locations: [{ name: '走廊', description: '室内', visualPrompt: '冷色走廊' }], episodes: [{ number: 1, title: '第一集', summary: '剧情', hook: '钩子', cliffhanger: '悬念' }] }
    db.saveStoryBibleBundle(projectId, bible); const character = db.listCharacters(projectId)[0]
    db.updateCharacterVoice({ id: character.id, voicePreset: 'mature-female', zhVoiceId: 'custom-zh', enVoiceId: 'custom-en', voiceLocked: true })
    db.saveStoryBibleBundle(projectId, { ...bible, characters: [{ ...bible.characters[0], voice: '新的声音描述' }] })
    expect(db.listCharacters(projectId)[0]).toMatchObject({ id: character.id, zhVoiceId: 'custom-zh', enVoiceId: 'custom-en', voiceLocked: true })
    db.close()
  })

  it('migrates retired 1.0 voices to preset 2.0 voices on startup, including locked characters', async () => {
    const path = await mkdtemp(join(tmpdir(), 'lumaworks-legacy-tts1-')); paths.push(path)
    const databasePath = join(path, 'legacy.sqlite')
    {
      const db = new AppDatabase(databasePath)
      const projectId = db.createProject({ title: '音色迁移', synopsis: '这是用于验证 1.0 音色自动迁移的完整故事简介。', visualStyle: 'cinematic' })
      const bible = { world: '城市', visualDirection: '写实', logline: '冲突', characters: [{ name: '裴衍州', role: '男主角', appearance: '32岁男性', personality: '克制', voice: '低沉男中音' }], locations: [], episodes: [{ number: 1, title: '第一集', summary: '剧情', hook: '钩子', cliffhanger: '悬念' }] }
      db.saveStoryBibleBundle(projectId, bible)
      const character = db.listCharacters(projectId)[0]
      db.sqlite.prepare(`UPDATE characters SET voice_preset='mature-male', zh_voice_id='zh_male_beijingxiaoye_moon_bigtts', en_voice_id='en_male_corey_emo_v2_mars_bigtts', voice_locked=1, zh_voice_warning='旧警告' WHERE id=?`).run(character.id)
      db.replaceEpisodeScript(projectId, { title: '第一集', summary: '测试', shots: Array.from({ length: 8 }, (_, index) => ({ title: `镜头${index}`, description: '剧情', imagePrompt: '图', videoPrompt: '动', durationSeconds: 4 })), dialogue: [] })
      db.applyDialoguePlan(db.listEpisodes(projectId)[0].id, 'zh-CN', 'plan-v1', 4_000, [])
      db.close()
    }
    const db = new AppDatabase(databasePath)
    const character = db.listCharacters(db.listProjects()[0].id)[0]
    expect(character.zhVoiceId).toBe('zh_male_dayi_uranus_bigtts')
    expect(character.enVoiceId).toBe('en_male_tim_uranus_bigtts')
    expect(character.zhVoiceWarning).toBeNull()
    expect(db.getDialoguePlan(db.listEpisodes(db.listProjects()[0].id)[0].id, 'zh-CN')?.status).toBe('stale')
    expect(() => db.updateCharacterVoice({ id: character.id, voicePreset: 'mature-male', zhVoiceId: 'zh_male_beijingxiaoye_moon_bigtts', enVoiceId: 'en_male_tim_uranus_bigtts', voiceLocked: true })).toThrow('1.0（moon/mars）音色已停用')
    db.close()
  })

  it('reassigns voices from the story bible even for manually locked characters', async () => {
    const db = await createDb(); const projectId = db.createProject({ title: '音色重推', synopsis: '这是用于验证音色重新分配会覆盖人工锁定的完整故事简介。', visualStyle: 'cinematic' })
    const bible = {
      world: '城市', visualDirection: '写实', logline: '冲突',
      characters: [
        { name: '贺兰秋', role: '暗线推手', appearance: '35岁女性，黑色连衣裙', personality: '克制', voice: '女中音，语速平稳' },
        { name: '沈书樾', role: '裴衍州堂弟', appearance: '30岁男性，圆框眼镜', personality: '圆滑', voice: '男高音偏亮' },
      ],
      locations: [], episodes: [{ number: 1, title: '第一集', summary: '剧情', hook: '钩子', cliffhanger: '悬念' }],
    }
    db.saveStoryBibleBundle(projectId, bible)
    for (const character of db.listCharacters(projectId)) db.updateCharacterVoice({ id: character.id, voicePreset: 'mature-female', zhVoiceId: 'wrong-voice', enVoiceId: 'wrong-voice-en', voiceLocked: true })
    expect(db.reassignCharacterVoices(projectId)).toBe(2)
    const voices = db.listCharacters(projectId)
    expect(voices.find((character) => character.name === '贺兰秋')).toMatchObject({ voicePreset: 'young-female', zhVoiceId: 'zh_female_vv_uranus_bigtts', voiceLocked: false })
    expect(voices.find((character) => character.name === '沈书樾')).toMatchObject({ voicePreset: 'young-male', zhVoiceId: 'zh_male_liufei_uranus_bigtts', voiceLocked: false })
    db.close()
  })

  it('persists per-shot characters and resolves shot reference images from cast, dialogue speakers, or text mentions', async () => {
    const db = await createDb(); const projectId = db.createProject({ title: '定妆参考', synopsis: '这是用于验证角色定妆参考图解析的完整故事简介。', visualStyle: 'cinematic' })
    const bible = {
      world: '城市', visualDirection: '写实', logline: '冲突',
      characters: [
        { name: '林澈', role: '青年女主角', appearance: '27岁短发女性', personality: '冷静', voice: '克制的青年女声' },
        { name: '周远', role: '反派父亲', appearance: '56岁中年男性', personality: '冷酷', voice: '低沉冷峻' },
      ],
      locations: [{ name: '走廊', description: '室内', visualPrompt: '冷色走廊' }],
      episodes: [{ number: 1, title: '第一集', summary: '剧情', hook: '钩子', cliffhanger: '悬念' }],
    }
    db.saveStoryBibleBundle(projectId, bible)
    const lin = db.listCharacters(projectId).find((character) => character.name === '林澈')!
    const zhou = db.listCharacters(projectId).find((character) => character.name === '周远')!
    db.setCharacterReferenceAsset(lin.id, db.addAsset({ projectId, entityType: 'character', entityId: lin.id, kind: 'reference-image', path: '/refs/lin.jpg' }))
    db.setCharacterReferenceAsset(zhou.id, db.addAsset({ projectId, entityType: 'character', entityId: zhou.id, kind: 'reference-image', path: '/refs/zhou.jpg' }))
    const episodeId = db.replaceEpisodeScript(projectId, {
      title: '定妆测试', summary: '定妆测试',
      shots: Array.from({ length: 8 }, (_, index) => ({ title: `镜头${index + 1}`, description: index === 2 ? '周远走进走廊' : '走廊', imagePrompt: '冷色走廊', videoPrompt: '缓慢推进', durationSeconds: 5, characters: index === 0 ? ['林澈'] : [] })),
      dialogue: [{ speaker: '周远', text: '别动。', shotPosition: 2, startMs: 0, endMs: 900 }],
    })
    const shots = db.listShotsForEpisode(episodeId)
    expect(shots[0].characters).toEqual(['林澈'])
    expect(db.getShotReferencePaths(shots[0].id)).toEqual(['/refs/lin.jpg'])
    expect(db.getShotReferencePaths(shots[1].id)).toEqual(['/refs/zhou.jpg'])
    expect(db.getShotReferencePaths(shots[2].id)).toEqual(['/refs/zhou.jpg'])
    expect(db.getShotReferencePaths(shots[3].id)).toEqual([])
    const referenceAssetIds = db.listCharacters(projectId).map((character) => character.referenceAssetId).sort()
    db.saveStoryBibleBundle(projectId, bible)
    expect(db.listCharacters(projectId).map((character) => character.referenceAssetId).sort()).toEqual(referenceAssetIds)
    db.close()
  })

  it('migrates the legacy jobs table without losing existing jobs', async () => {
    const path = await mkdtemp(join(tmpdir(), 'lumaworks-legacy-')); paths.push(path)
    const databasePath = join(path, 'legacy.sqlite'); const legacy = new Database(databasePath); const stamp = new Date().toISOString()
    legacy.exec(`CREATE TABLE jobs (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, entity_id TEXT NOT NULL, payload_json TEXT NOT NULL, result_json TEXT, error TEXT, progress INTEGER NOT NULL, attempts INTEGER NOT NULL, max_attempts INTEGER NOT NULL, scheduled_at TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`)
    legacy.prepare(`INSERT INTO jobs VALUES ('legacy-job','story-bible','queued','legacy-project','{}',NULL,NULL,0,0,3,?,'legacy-key',?,?)`).run(stamp, stamp, stamp)
    legacy.close()
    const db = new AppDatabase(databasePath)
    expect(db.getJob('legacy-job')).toMatchObject({ id: 'legacy-job', progressMode: 'indeterminate', currentPhase: null, heartbeatAt: null })
    const columns = db.sqlite.prepare(`PRAGMA table_info(jobs)`).all() as Array<{ name: string }>
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['project_id', 'progress_mode', 'current_phase', 'heartbeat_at']))
    db.close()
  })

  it('backfills voice strategy and timing fields for legacy projects', async () => {
    const path = await mkdtemp(join(tmpdir(), 'lumaworks-legacy-voice-')); paths.push(path)
    const databasePath = join(path, 'legacy.sqlite'); const legacy = new Database(databasePath); const stamp = new Date().toISOString()
    legacy.exec(`
      CREATE TABLE story_bibles (id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE, content_json TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE characters (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL, description TEXT NOT NULL, voice_id TEXT, reference_asset_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE voice_lines (id TEXT PRIMARY KEY, episode_id TEXT NOT NULL, shot_id TEXT, locale TEXT NOT NULL, position INTEGER NOT NULL, speaker TEXT NOT NULL, text TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, audio_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    `)
    const bible = { world: '城市', visualDirection: '写实', logline: '冲突', characters: [{ name: '周远', role: '56岁反派父亲', appearance: '中年男性', personality: '冷酷', voice: '低沉冷峻' }], locations: [], episodes: [] }
    legacy.prepare(`INSERT INTO story_bibles VALUES('bible','project',?,0,1,?,?)`).run(JSON.stringify(bible), stamp, stamp)
    legacy.prepare(`INSERT INTO characters VALUES('character','project','周远','反派父亲','56岁中年男性',NULL,NULL,?,?)`).run(stamp, stamp)
    legacy.prepare(`INSERT INTO voice_lines VALUES('line','episode',NULL,'zh-CN',1,'周远','别动。',100,900,NULL,?,?)`).run(stamp, stamp)
    legacy.close()
    const db = new AppDatabase(databasePath)
    expect(db.listCharacters('project')[0]).toMatchObject({ voicePreset: 'cold-villain', voiceDescription: '低沉冷峻', zhVoiceWarning: null, enVoiceWarning: null, voiceLocked: false })
    db.setCharacterVoiceWarning('character', 'zh-CN', '音色不可用，已回退')
    expect(db.getCharacterVoiceById('character')?.zhVoiceWarning).toBe('音色不可用，已回退')
    expect(db.listVoiceLines('episode', 'zh-CN')[0]).toMatchObject({ spokenText: '别动。', originalStartMs: 100, originalEndMs: 900 })
    db.close()
  })
})
