import { join } from 'node:path'
import { copyFile } from 'node:fs/promises'
import { z } from 'zod'
import type { AppDatabase } from '../db/database'
import type { JobContext, JobRunner } from '../jobs/runner'
import type { MediaStore } from '../media/store'
import type { ArkProvider } from '../providers/ark'
import { isVoiceConfigurationError, type VolcanoSpeechProvider } from '../providers/speech'
import type { FfmpegRenderer } from '../render/ffmpeg'
import type { PublisherRegistry } from '../publishers/registry'
import { mapConcurrent } from '../utils/concurrency'
import { buildClipTimeline, planDialogue, timingFingerprint } from './timing'
import { episodeScriptPrompt, episodeScriptSchema, storyCharactersPrompt, storyCharactersSchema, storyEpisodesPrompt, storyEpisodesSchema, storyFoundationPrompt, storyFoundationSchema, storyLocationsPrompt, storyLocationsSchema, storyBibleSchema } from './prompts'

const translatedLinesSchema = z.object({ lines: z.array(z.object({ speaker: z.string(), text: z.string(), shotPosition: z.number().int().positive().optional(), startMs: z.number().int(), endMs: z.number().int() })) })
const shortenedLineSchema = z.object({ text: z.string().trim().min(1) })

function payload(json: string): Record<string, unknown> { return JSON.parse(json) as Record<string, unknown> }

export function registerPipelineHandlers(input: {
  db: AppDatabase; runner: JobRunner; ark: ArkProvider; speech: VolcanoSpeechProvider; media: MediaStore; renderer: FfmpegRenderer; publishers: PublisherRegistry
}): void {
  const { db, runner, ark, speech, media, renderer, publishers } = input

  const storyRunPayload = (jobPayload: string): { runId: string; rootScheduledAt: string } => {
    const data = payload(jobPayload)
    if (typeof data.runId !== 'string' || typeof data.rootScheduledAt !== 'string') throw new Error('故事圣经子任务缺少运行标识')
    return { runId: data.runId, rootScheduledAt: data.rootScheduledAt }
  }

  const maybeQueueStoryAssembly = (projectId: string, runId: string, rootScheduledAt: string): void => {
    const parts = db.getStoryBibleParts(projectId, runId)
    if (!['foundation', 'characters', 'locations', 'episodes'].every((part) => part in parts)) return
    runner.enqueue({ type: 'story-bible-assemble', entityId: projectId, payload: { runId, rootScheduledAt }, scheduledAt: rootScheduledAt, force: false })
  }

  runner.register('story-bible', async ({ job, stage }) => {
    stage('story.start', '正在创建故事圣经子任务')
    const project = db.getProject(job.entityId); if (!project) throw new Error('项目不存在')
    const runId = job.id; const rootScheduledAt = job.createdAt
    db.beginStoryBibleRun(project.id, runId)
    const child = runner.enqueue({ type: 'story-foundation', entityId: project.id, payload: { runId, rootScheduledAt }, scheduledAt: rootScheduledAt, force: false })
    return { runId, childJobIds: [child.id] }
  })

  runner.register('story-foundation', async ({ job, signal, stage, trace }) => {
    const project = db.getProject(job.entityId); if (!project) throw new Error('项目不存在')
    const { runId, rootScheduledAt } = storyRunPayload(job.payloadJson)
    if (!db.isActiveStoryBibleRun(project.id, runId)) return { ignored: true, reason: '已有更新的故事圣经任务' }
    stage('story.foundation.generate', '正在生成故事基底')
    const foundation = await ark.withTrace(trace).generateJson(storyFoundationPrompt(project), (value) => storyFoundationSchema.parse(value), { contractName: '故事基底', signal })
    if (!db.saveStoryBiblePart(project.id, runId, 'foundation', foundation)) return { ignored: true }
    const childJobIds = (['story-characters', 'story-locations', 'story-episodes'] as const).map((type) => runner.enqueue({ type, entityId: project.id, payload: { runId, rootScheduledAt }, scheduledAt: rootScheduledAt, force: false }).id)
    return { foundation, childJobIds }
  })

  runner.register('story-characters', async ({ job, signal, stage, trace }) => {
    const project = db.getProject(job.entityId); if (!project) throw new Error('项目不存在')
    const { runId, rootScheduledAt } = storyRunPayload(job.payloadJson); const foundation = db.getStoryBibleParts(project.id, runId).foundation
    if (!foundation || !db.isActiveStoryBibleRun(project.id, runId)) return { ignored: true }
    stage('story.characters.generate', '正在生成角色设定')
    const result = await ark.withTrace(trace).generateJson(storyCharactersPrompt({ ...project, foundation }), (value) => storyCharactersSchema.parse(value), { contractName: '角色设定', signal })
    if (db.saveStoryBiblePart(project.id, runId, 'characters', result)) maybeQueueStoryAssembly(project.id, runId, rootScheduledAt)
    return result
  })

  runner.register('story-locations', async ({ job, signal, stage, trace }) => {
    const project = db.getProject(job.entityId); if (!project) throw new Error('项目不存在')
    const { runId, rootScheduledAt } = storyRunPayload(job.payloadJson); const foundation = db.getStoryBibleParts(project.id, runId).foundation
    if (!foundation || !db.isActiveStoryBibleRun(project.id, runId)) return { ignored: true }
    stage('story.locations.generate', '正在生成场景设定')
    const result = await ark.withTrace(trace).generateJson(storyLocationsPrompt({ ...project, foundation }), (value) => storyLocationsSchema.parse(value), { contractName: '场景设定', signal })
    if (db.saveStoryBiblePart(project.id, runId, 'locations', result)) maybeQueueStoryAssembly(project.id, runId, rootScheduledAt)
    return result
  })

  runner.register('story-episodes', async ({ job, signal, stage, trace }) => {
    const project = db.getProject(job.entityId); if (!project) throw new Error('项目不存在')
    const { runId, rootScheduledAt } = storyRunPayload(job.payloadJson); const foundation = db.getStoryBibleParts(project.id, runId).foundation
    if (!foundation || !db.isActiveStoryBibleRun(project.id, runId)) return { ignored: true }
    stage('story.episodes.generate', '正在生成分集大纲')
    const result = await ark.withTrace(trace).generateJson(storyEpisodesPrompt({ ...project, foundation }), (value) => storyEpisodesSchema.parse(value), { contractName: '分集大纲', signal })
    if (db.saveStoryBiblePart(project.id, runId, 'episodes', result)) maybeQueueStoryAssembly(project.id, runId, rootScheduledAt)
    return result
  })

  runner.register('story-bible-assemble', async ({ job, stage }) => {
    const project = db.getProject(job.entityId); if (!project) throw new Error('项目不存在')
    const { runId } = storyRunPayload(job.payloadJson)
    if (!db.isActiveStoryBibleRun(project.id, runId)) return { ignored: true, reason: '已有更新的故事圣经任务' }
    stage('story.assemble', '正在合并故事圣经')
    const parts = db.getStoryBibleParts(project.id, runId)
    const foundation = storyFoundationSchema.parse(parts.foundation)
    const characters = storyCharactersSchema.parse(parts.characters)
    const locations = storyLocationsSchema.parse(parts.locations)
    const episodes = storyEpisodesSchema.parse(parts.episodes)
    const bible = storyBibleSchema.parse({ ...foundation, ...characters, ...locations, ...episodes })
    if (!db.completeStoryBibleRun(project.id, runId, bible)) return { ignored: true }
    stage('story.saved', '故事圣经已合并并保存', { characters: bible.characters.length, locations: bible.locations.length, episodes: bible.episodes.length })
    return { bible }
  })

  runner.register('episode-script', async ({ job, signal, stage, trace }) => {
    stage('script.load', '正在加载项目与故事圣经')
    const project = db.getProject(job.entityId); if (!project) throw new Error('项目不存在')
    const bible = db.getStoryBible(project.id); if (!bible) throw new Error('请先生成故事圣经')
    const prompt = episodeScriptPrompt({ storyBible: bible, episodeNumber: Number(payload(job.payloadJson).episodeNumber ?? 1) })
    stage('script.request_model', '正在请求模型拆解竖屏分镜', { promptChars: prompt.length })
    const data = await ark.withTrace(trace).generateJson(prompt, (value) => episodeScriptSchema.parse(value), { contractName: '分镜剧本', signal })
    if (signal.aborted) throw abortError()
    stage('script.persist', '正在保存剧本与镜头', { shots: data.shots.length })
    const episodeId = db.replaceEpisodeScript(project.id, data); db.setProjectStage(project.id, 'storyboard')
    return { episodeId, shots: data.shots.length }
  })

  runner.register('shot-image', async ({ job, progress, signal, stage, trace }) => {
    const shot = db.getShot(job.entityId); if (!shot) throw new Error('镜头不存在')
    const project = db.getProjectForEpisode(shot.episodeId); if (!project) throw new Error('项目不存在')
    const data = payload(job.payloadJson)
    stage('image.generate', '正在生成分镜关键帧')
    const result = await ark.withTrace(trace).generateImage({ prompt: `${shot.imagePrompt}\n真人电影质感，原创人物面孔且不模仿任何真实艺人或现有影视角色，角色一致，竖屏9:16，无品牌 Logo、无文字无水印`, aspectRatio: '9:16', referencePaths: (data.referencePaths as string[] | undefined) ?? [], signal })
    stage('media.download', '正在下载并保存图片')
    const path = await media.download(project.id, 'images', result.url, { signal, onProgress: (received, total) => { if (total) progress(received / total * 100, '正在下载图片', { current: received, total, unit: 'bytes' }) } }); db.updateShotMedia(shot.id, 'image', path); db.addAsset({ projectId: project.id, entityType: 'shot', entityId: shot.id, kind: 'storyboard-image', path, sourceUrl: result.url })
    let nextJobId: string | undefined
    if (data.continueToVideo === true) {
      const scheduledAt = typeof data.batchScheduledAt === 'string' ? data.batchScheduledAt : job.createdAt
      nextJobId = runner.enqueue({ type: 'shot-video', entityId: shot.id, payload: {}, scheduledAt, force: false }).id
      stage('image.video_queued', '关键帧完成，已接续镜头视频任务', { nextJobId })
    }
    return { path, nextJobId }
  })

  runner.register('shot-video', async ({ job, progress, signal, stage, trace }) => {
    const shot = db.getShot(job.entityId); if (!shot?.imagePath) throw new Error('请先生成镜头关键帧')
    const project = db.getProjectForEpisode(shot.episodeId); if (!project) throw new Error('项目不存在')
    stage('video.generate', '正在提交 Seedance 视频任务')
    const result = await ark.withTrace(trace).generateVideo({ prompt: shot.videoPrompt, imagePath: shot.imagePath, durationSeconds: shot.durationSeconds, lastFramePath: typeof payload(job.payloadJson).lastFramePath === 'string' ? String(payload(job.payloadJson).lastFramePath) : undefined }, ({ progress: value, message }) => value === undefined ? stage('video.waiting', message ?? '等待 Seedance 处理') : progress(value, message), signal)
    stage('media.download', '正在下载并保存视频')
    const path = await media.download(project.id, 'videos', result.url, { signal, onProgress: (received, total) => { if (total) progress(received / total * 100, '正在下载视频', { current: received, total, unit: 'bytes' }) } }); db.updateShotMedia(shot.id, 'video', path); db.addAsset({ projectId: project.id, entityType: 'shot', entityId: shot.id, kind: 'video', path, sourceUrl: result.url, metadata: { externalId: result.externalId } })
    return { path, externalId: result.externalId }
  })

  const genericImage = async ({ job, progress, signal, stage, trace }: JobContext) => {
    const data = payload(job.payloadJson); const projectId = String(data.projectId ?? '')
    if (!projectId || typeof data.prompt !== 'string') throw new Error('素材任务缺少 projectId 或 prompt')
    stage('image.generate', '正在生成视觉资产'); const result = await ark.withTrace(trace).generateImage({ prompt: data.prompt, aspectRatio: String(data.aspectRatio ?? '9:16'), referencePaths: data.referencePaths as string[] | undefined, signal })
    stage('media.download', '正在下载视觉资产')
    const path = await media.download(projectId, 'references', result.url, { signal, onProgress: (received, total) => { if (total) progress(received / total * 100, '正在下载视觉资产', { current: received, total, unit: 'bytes' }) } }); const assetId = db.addAsset({ projectId, entityType: job.type.startsWith('character') ? 'character' : 'location', entityId: job.entityId, kind: 'reference-image', path, sourceUrl: result.url })
    return { path, assetId }
  }
  runner.register('character-image', genericImage)
  runner.register('location-image', genericImage)

  runner.register('translate-episode', async ({ job, signal, stage, trace }) => {
    const episode = db.getEpisode(job.entityId); if (!episode) throw new Error('剧集不存在')
    const lines = db.listVoiceLines(episode.id, 'zh-CN'); stage('translation.request_model', '正在改写英文台词', { lines: lines.length })
    const translated = await ark.withTrace(trace).generateJson(`将以下短剧台词本地化为自然、口语化的美式英语，保留角色名、镜头位置和估算时间轴，控制长度以适合原视频。不要逐字硬译。只返回 {"lines":[{"speaker":"角色名","text":"英文台词","shotPosition":1,"startMs":0,"endMs":1000}]}，每项必须包含全部字段且时间为数字。\n${JSON.stringify(lines)}`, (value) => translatedLinesSchema.parse(value), { contractName: '英文台词', signal })
    if (signal.aborted) throw abortError()
    stage('translation.persist', '正在保存英文台词')
    db.replaceTranslatedLines(episode.id, translated.lines)
    return { count: translated.lines.length }
  })

  runner.register('dialogue-timing', async ({ job, signal, stage }) => {
    const data = payload(job.payloadJson); const locale = data.locale === 'en-US' ? 'en-US' : 'zh-CN'
    const episode = db.getEpisode(job.entityId); if (!episode) throw new Error('剧集不存在')
    const shots = db.listShotsForEpisode(episode.id); if (!shots.length || shots.some((shot) => !shot.videoPath)) throw new Error('请先完成全部镜头视频，再规划对白')
    const shotIds = new Set(shots.map((shot) => shot.id)); const videoRunning = db.listJobs().some((item) => item.type === 'shot-video' && shotIds.has(item.entityId) && ['queued', 'running', 'waiting'].includes(item.status))
    if (videoRunning) throw new Error('镜头视频仍在生成，请等待全部视频定稿后再规划对白')
    db.invalidateDialoguePlans(episode.id, locale)
    stage('timing.probe', '正在读取每个视频的真实时长', { clips: shots.length, locale })
    const durations = await Promise.all(shots.map((shot) => renderer.probeDuration(shot.videoPath!, signal)))
    const lines = db.listVoiceLines(episode.id, locale); const clips = buildClipTimeline(shots, durations); const version = timingFingerprint(shots, lines, locale)
    stage('timing.plan', '正在按镜头和文本密度规划对白', { lines: lines.length, durationMs: clips.at(-1)?.endMs ?? 0 })
    const planned = planDialogue(lines, clips, locale); db.applyDialoguePlan(episode.id, locale, version, clips.at(-1)?.endMs ?? 0, planned)
    let nextJobId: string | undefined
    if (data.continueToVoice === true) nextJobId = runner.enqueue({ type: 'voice-line', entityId: episode.id, payload: { locale }, force: true }).id
    return { locale, version, durationMs: clips.at(-1)?.endMs ?? 0, lines: planned.length, nextJobId }
  })

  runner.register('voice-line', async ({ job, progress, signal, stage, trace }) => {
    const data = payload(job.payloadJson); const locale = data.locale === 'en-US' ? 'en-US' : 'zh-CN'
    const episode = db.getEpisode(job.entityId); if (!episode) throw new Error('剧集不存在')
    const project = db.getProject(episode.projectId)!; const lines = db.listVoiceLines(episode.id, locale); const plan = db.getDialoguePlan(episode.id, locale)
    if (!plan || plan.status === 'stale' || !plan.version || lines.some((line) => line.planVersion !== plan.version)) throw new Error('对白时间轴已过期，请先根据当前视频重新规划对白')
    stage('speech.prepare', '正在准备多角色配音', { locale, lines: lines.length })
    const jobSpeech = speech.withTrace(trace)
    const overrideVoiceId = typeof data.voiceId === 'string' && data.voiceId.trim() ? data.voiceId.trim() : undefined
    let completed = 0
    await mapConcurrent(lines, 4, async (line) => {
      const character = db.getCharacterVoice(project.id, line.speaker); const preferredVoiceId = overrideVoiceId ?? (locale === 'en-US' ? character?.enVoiceId : character?.zhVoiceId)
      const defaultVoiceId = jobSpeech.resolveVoiceId(locale); const requestedVoiceId = jobSpeech.resolveVoiceId(locale, preferredVoiceId); let effectiveVoiceId = requestedVoiceId
      const targetMs = Math.max(300, line.endMs - line.startMs); let spokenText = line.text; let outputPath = ''; let audioDurationMs = 0
      for (let attempt = 0; attempt < 3; attempt++) {
        const base = join(media.projectDir(project.id), 'audio', locale, `${String(line.position).padStart(3, '0')}-${plan.version}-${attempt}`); const rawPath = `${base}-raw.mp3`; const finalPath = `${base}.mp3`
        try {
          await jobSpeech.synthesize({ text: spokenText, voiceId: effectiveVoiceId, locale, outputPath: rawPath, signal })
          if (character && !overrideVoiceId && effectiveVoiceId === requestedVoiceId) db.setCharacterVoiceWarning(character.id, locale, null)
        } catch (error) {
          if (effectiveVoiceId === defaultVoiceId || !isVoiceConfigurationError(error)) throw error
          const warning = `${locale === 'en-US' ? '英文' : '中文'}音色 ${effectiveVoiceId} 不可用，已回退到项目默认音色 ${defaultVoiceId}`
          stage('speech.voice_fallback', warning, { position: line.position, requestedVoiceId: effectiveVoiceId, fallbackVoiceId: defaultVoiceId })
          effectiveVoiceId = defaultVoiceId
          if (character && !overrideVoiceId) db.setCharacterVoiceWarning(character.id, locale, warning)
          await jobSpeech.synthesize({ text: spokenText, voiceId: effectiveVoiceId, locale, outputPath: rawPath, signal })
        }
        const actualMs = await renderer.probeDuration(rawPath, signal)
        if (actualMs <= targetMs * 1.2) {
          if (actualMs > targetMs * 1.005) audioDurationMs = await renderer.calibrateAudio(rawPath, finalPath, targetMs, signal)
          else { await copyFile(rawPath, finalPath); audioDurationMs = actualMs }
          outputPath = finalPath; break
        }
        if (attempt === 2) throw new Error(`“${line.speaker}：${line.text}”无法在 ${(targetMs / 1000).toFixed(1)} 秒镜头区间内自然说完`)
        stage('speech.rewrite', '台词超出镜头时长，正在保留原意自动精简', { position: line.position, actualMs, targetMs, attempt: attempt + 1 })
        const shortened = await ark.withTrace(trace).generateJson(`将下面台词精简到正常语速约 ${(targetMs / 1000 / 1.05).toFixed(1)} 秒可说完。保留剧情关键信息、角色口吻和语气，不增加新信息，只返回 {"text":"精简台词"}。\n角色：${line.speaker}\n原文：${spokenText}`, (value) => shortenedLineSchema.parse(value), { contractName: '配音台词精简', signal })
        spokenText = shortened.text
      }
      if (!outputPath) throw new Error(`配音生成失败：${line.speaker}`)
      db.updateVoiceAudio(line.id, { audioPath: outputPath, spokenText, voiceId: effectiveVoiceId, audioDurationMs, startMs: line.startMs, endMs: Math.min(line.endMs, line.startMs + audioDurationMs), planVersion: plan.version! })
      completed++
      progress((completed / lines.length) * 100, `配音 ${completed}/${lines.length}`, { current: completed, total: lines.length, unit: 'lines' })
      return outputPath
    }, signal)
    db.markDialoguePlanVoiced(episode.id, locale, plan.version)
    return { count: lines.length, locale, version: plan.version }
  })

  runner.register('render-episode', async ({ job, progress, signal, stage }) => {
    const data = payload(job.payloadJson); const locale = data.locale === 'en-US' ? 'en-US' : 'zh-CN'
    const episode = db.getEpisode(job.entityId); if (!episode) throw new Error('剧集不存在')
    const project = db.getProject(episode.projectId)!; const shots = db.listShotsForEpisode(episode.id); const clips = shots.map((shot) => shot.videoPath).filter((path): path is string => Boolean(path))
    if (clips.length !== shots.length) throw new Error('仍有镜头未生成视频')
    const plan = db.getDialoguePlan(episode.id, locale); if (!plan || plan.status !== 'voiced' || !plan.version) throw new Error('请先基于当前视频完成对白规划和配音')
    const lines = db.listVoiceLines(episode.id, locale); if (lines.some((line) => !line.audioPath || line.planVersion !== plan.version)) throw new Error('配音与当前视频时间轴不一致，请重新生成配音')
    const voices = lines.map((line) => ({ path: line.audioPath!, startMs: line.startMs }))
    const renderId = db.createRender(episode.id, locale, { width: 1080, height: 1920, fps: 30, subtitle: true })
    try {
      const result = await renderer.render({ outputDir: join(media.projectDir(project.id), 'renders', renderId), clips, voiceTracks: voices, lines: lines.map((line) => ({ text: line.spokenText, startMs: line.startMs, endMs: line.endMs })), locale, durationMs: plan.durationMs, signal, onStage: stage, onProgress: (value) => progress(value, '正在渲染成片', { current: Math.round(value), total: 100, unit: 'percent' }) })
      db.updateRender(renderId, { status: 'completed', ...result }); db.setProjectStage(project.id, 'publish')
      return { renderId, ...result }
    } catch (error) { db.updateRender(renderId, { status: 'failed' }); throw error }
  })

  runner.register('publish', async ({ job, stage }) => {
    const draft = db.getPublishDraft(job.entityId); if (!draft?.approved) throw new Error('发布草稿尚未审核')
    const render = db.getRender(draft.renderId); if (!render || typeof render.videoPath !== 'string') throw new Error('找不到可投稿的成片')
    const adapter = publishers.get(draft.platform); const publishJobId = db.createPublishJob(draft.id, draft.platform)
    stage('publish.submit', `正在提交到 ${draft.platform}`, { platform: draft.platform, draftId: draft.id })
    try {
      const result = await adapter.publish(draft, { videoPath: render.videoPath, coverPath: typeof render.coverPath === 'string' ? render.coverPath : null })
      db.finishPublishJob(publishJobId, { externalId: result.externalId, status: result.status, resultUrl: result.url }); return { ...result }
    } catch (error) { db.finishPublishJob(publishJobId, { externalId: '', status: 'failed', error: error instanceof Error ? error.message : String(error) }); throw error }
  })
}

function abortError(): Error { const error = new Error('任务已取消'); error.name = 'AbortError'; return error }
