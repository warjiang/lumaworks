import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { mkdir, writeFile } from 'node:fs/promises'
import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron'
import { pathToFileURL } from 'node:url'
import { createProjectInputSchema, enqueueJobInputSchema, modelTestKindSchema, publishDraftInputSchema, rendererErrorSchema, saveSettingsInputSchema, updateCharacterVoiceSchema, type ContentLocale, type DiagnosticLevel, type Platform, type SystemEventFilters } from '@shared/domain'
import { IPC } from '@shared/ipc'
import { AppDatabase } from './db/database'
import { DiagnosticsService } from './diagnostics/service'
import { JobRunner } from './jobs/runner'
import { MediaStore } from './media/store'
import { registerPipelineHandlers } from './pipeline/handlers'
import { ArkProvider } from './providers/ark'
import type { ProviderSettings } from './providers/types'
import { ProviderTester } from './providers/tester'
import { isVoiceConfigurationError, VolcanoSpeechProvider } from './providers/speech'
import { PublisherRegistry } from './publishers/registry'
import { FfmpegRenderer } from './render/ffmpeg'
import { OAuthService } from './security/oauth'
import { SecretStore } from './security/secrets'

let mainWindow: BrowserWindow | null = null
let database: AppDatabase | null = null
let runner: JobRunner | null = null
let diagnostics: DiagnosticsService | null = null
let diagnosticsTimer: NodeJS.Timeout | null = null
let selectedProjectId: string | undefined

const DEFAULT_SPEECH_VOICE_ID = 'zh_female_vv_uranus_bigtts'
const DEFAULT_ENGLISH_SPEECH_VOICE_ID = 'en_female_dacey_uranus_bigtts'

function speechVoiceId(secrets: SecretStore): string {
  const stored = secrets.get('speechVoiceId')
  // Migrate the legacy default written by pre-TTS-2.0 releases. Custom voice
  // IDs are preserved verbatim.
  return !stored || stored === 'BV700_V2_streaming' ? DEFAULT_SPEECH_VOICE_ID : stored
}

protocol.registerSchemesAsPrivileged([{ scheme: 'luma-media', privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true, stream: true } }])

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1120, minHeight: 720, titleBarStyle: 'hiddenInset', backgroundColor: '#111214',
    webPreferences: { preload: join(__dirname, '../preload/index.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
  window.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: 'deny' } })
  return window
}

function registerIpc(db: AppDatabase, jobs: JobRunner, logs: DiagnosticsService, secrets: SecretStore, publishers: PublisherRegistry, oauth: OAuthService, tester: ProviderTester, media: MediaStore, speech: VolcanoSpeechProvider): void {
  const configured = () => ({ ark: secrets.has('arkApiKey'), speech: secrets.has('speechApiKey') || (secrets.has('speechAccessToken') && secrets.has('speechAppId')), tiktok: secrets.has('tiktokAccessToken'), youtube: secrets.has('youtubeAccessToken') })
  const snapshot = (projectId?: string) => ({
    ...db.snapshot(projectId ?? selectedProjectId, configured()),
    modelSettings: {
      arkTextModel: secrets.get('arkTextModel') ?? 'doubao-seed-2-1-turbo-260628',
      arkTextApi: secrets.get('arkTextApi') === 'chat-completions' ? 'chat-completions' as const : 'responses' as const,
      arkTextStream: secrets.get('arkTextStream') !== 'false',
      seedreamModel: secrets.get('seedreamModel') ?? 'doubao-seedream-5-0-pro-260628',
      seedanceModel: secrets.get('seedanceModel') ?? 'doubao-seedance-2-0-fast-260128',
      speechResourceId: secrets.get('speechResourceId') ?? 'seed-tts-2.0',
      speechVoiceId: speechVoiceId(secrets),
      speechEnglishVoiceId: secrets.get('speechEnglishVoiceId') ?? DEFAULT_ENGLISH_SPEECH_VOICE_ID,
    },
  })
  ipcMain.handle(IPC.dashboard, (_event, projectId?: string) => snapshot(projectId))
  ipcMain.handle(IPC.selectProject, (_event, projectId: string) => { selectedProjectId = projectId; return snapshot(projectId) })
  ipcMain.handle(IPC.createProject, (_event, raw: unknown) => { const id = db.createProject(createProjectInputSchema.parse(raw)); selectedProjectId = id; return id })
  ipcMain.handle(IPC.enqueueJob, (_event, raw: unknown) => jobs.enqueue(enqueueJobInputSchema.parse(raw)))
  ipcMain.handle(IPC.cancelJob, (_event, id: string) => jobs.cancel(id))
  ipcMain.handle(IPC.retryJob, (_event, id: string) => jobs.retry(id))
  ipcMain.handle(IPC.saveSettings, (_event, raw: unknown) => {
    const values = saveSettingsInputSchema.parse(raw)
    for (const [key, value] of Object.entries(values)) if (typeof value === 'string' && value) secrets.set(key, value)
  })
  ipcMain.handle(IPC.testModel, (_event, raw: unknown) => tester.test(modelTestKindSchema.parse(raw)))
  ipcMain.handle(IPC.createPublishDrafts, (_event, raw: unknown) => db.createPublishDrafts(publishDraftInputSchema.parse(raw)))
  ipcMain.handle(IPC.approvePublishDraft, (_event, draftId: string) => {
    const draft = db.getPublishDraft(draftId); if (!draft) throw new Error('发布草稿不存在')
    db.approvePublishDraft(draftId)
    return jobs.enqueue({ type: 'publish', entityId: draftId, payload: {}, scheduledAt: draft.scheduledAt ?? undefined, force: true })
  })
  ipcMain.handle(IPC.connectPlatform, async (_event, platform: Platform) => {
    if (platform === 'youtube' && !secrets.has('youtubeAccessToken')) await oauth.connectYouTube()
    if (platform === 'tiktok' && !secrets.has('tiktokAccessToken')) await oauth.connectTikTok()
    return publishers.get(platform).connect()
  })
  ipcMain.handle(IPC.revealPath, (_event, path: string) => shell.showItemInFolder(path))
  ipcMain.handle(IPC.openProjectDirectory, async (_event, projectId: string) => {
    if (!db.getProject(projectId)) throw new Error('项目不存在')
    const directory = media.projectDir(projectId)
    await mkdir(directory, { recursive: true })
    const error = await shell.openPath(directory)
    if (error) throw new Error(`无法打开项目工作目录: ${error}`)
  })
  ipcMain.handle(IPC.updateCharacterVoice, (_event, raw: unknown) => db.updateCharacterVoice(updateCharacterVoiceSchema.parse(raw)))
  ipcMain.handle(IPC.reassignCharacterVoices, (_event, projectId: string) => {
    if (!db.getProject(projectId)) throw new Error('项目不存在')
    return { changed: db.reassignCharacterVoices(projectId) }
  })
  ipcMain.handle(IPC.previewCharacterVoice, async (_event, characterId: string, locale: ContentLocale) => {
    const character = db.getCharacterVoiceById(characterId); if (!character) throw new Error('角色不存在')
    const voiceId = locale === 'en-US' ? character.enVoiceId : character.zhVoiceId
    const defaultVoiceId = speech.resolveVoiceId(locale)
    const text = locale === 'en-US' ? `I am ${character.name}. This is how my voice sounds.` : `我是${character.name}，这是我的角色声音。`
    const path = join(media.projectDir(character.projectId), 'audio', 'previews', `${character.id}-${locale}.mp3`)
    try {
      await speech.synthesize({ text, voiceId, locale, outputPath: path })
      db.setCharacterVoiceWarning(character.id, locale, null)
      return { path }
    } catch (error) {
      if (voiceId === defaultVoiceId || !isVoiceConfigurationError(error)) throw error
      const warning = `${locale === 'en-US' ? '英文' : '中文'}音色 ${voiceId} 不可用，试听已回退到项目默认音色 ${defaultVoiceId}`
      await speech.synthesize({ text, voiceId: defaultVoiceId, locale, outputPath: path })
      db.setCharacterVoiceWarning(character.id, locale, warning)
      return { path, warning }
    }
  })
  ipcMain.handle(IPC.jobDetails, (_event, id: string) => logs.getJobDetails(id))
  ipcMain.handle(IPC.systemEvents, (_event, raw?: SystemEventFilters) => {
    const level = raw?.level && ['debug', 'info', 'warn', 'error'].includes(raw.level) ? raw.level as DiagnosticLevel : undefined
    return logs.listSystemEvents({ level, limit: raw?.limit })
  })
  ipcMain.handle(IPC.clearDiagnostics, () => { logs.clear(); if (jobs.isIdle()) db.compactDiagnostics() })
  ipcMain.handle(IPC.reportRendererError, (_event, raw: unknown) => {
    const error = rendererErrorSchema.parse(raw)
    logs.log({ level: error.level, scope: 'renderer', phase: 'renderer.exception', message: error.message, details: { stack: error.stack, source: error.source } })
  })
  ipcMain.handle(IPC.exportJobDiagnostics, async (_event, id: string) => {
    const details = logs.getJobDetails(id)
    const started = new Date(details.job.startedAt ?? details.job.createdAt).getTime() - 5 * 60_000
    const finished = new Date(details.job.finishedAt ?? new Date().toISOString()).getTime() + 5 * 60_000
    const systemEvents = logs.listSystemEvents({ limit: 500 }).filter((item) => { const time = new Date(item.timestamp).getTime(); return time >= started && time <= finished })
    const saveOptions = { defaultPath: `lumaworks-${details.job.type}-${id.slice(0, 8)}.lwdiagnostics.json.gz`, filters: [{ name: 'LumaWorks Diagnostics', extensions: ['gz'] }] }
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, saveOptions) : await dialog.showSaveDialog(saveOptions)
    if (result.canceled || !result.filePath) return { cancelled: true }
    const bundle = { version: 1, exportedAt: new Date().toISOString(), appVersion: app.getVersion(), platform: process.platform, arch: process.arch, job: details.job, events: details.events, systemEvents }
    await writeFile(result.filePath, gzipSync(JSON.stringify(bundle, null, 2)))
    return { cancelled: false, path: result.filePath }
  })
}

app.whenReady().then(() => {
  try {
    const root = app.getPath('userData'); const mediaRoot = join(root, 'media'); database = new AppDatabase(join(root, 'lumaworks.sqlite'))
    protocol.handle('luma-media', (request) => {
      const path = decodeURIComponent(new URL(request.url).pathname)
      if (!path.startsWith(mediaRoot)) return new Response('Forbidden', { status: 403 })
      return net.fetch(pathToFileURL(path).toString())
    })
    diagnostics = new DiagnosticsService(database, {
      available: () => safeStorage.isEncryptionAvailable(),
      encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
      decrypt: (value) => { try { return safeStorage.decryptString(Buffer.from(value, 'base64')) } catch { return null } },
    }, join(root, 'diagnostics', 'emergency.jsonl'))
    const cleanup = diagnostics.cleanup()
    if (cleanup.deleted) database.compactDiagnostics()
    diagnostics.log({ phase: 'app.ready', scope: 'app', message: 'LumaWorks 主进程已启动', details: { appVersion: app.getVersion(), platform: process.platform, arch: process.arch, cleanedEvents: cleanup.deleted } })
    const secrets = new SecretStore(database)
    const settings = (): ProviderSettings => ({
      arkApiKey: secrets.get('arkApiKey') ?? '', arkTextModel: secrets.get('arkTextModel') ?? 'doubao-seed-2-1-turbo-260628', arkTextApi: secrets.get('arkTextApi') === 'chat-completions' ? 'chat-completions' : 'responses', arkTextStream: secrets.get('arkTextStream') !== 'false',
      seedreamModel: secrets.get('seedreamModel') ?? 'doubao-seedream-5-0-pro-260628', seedanceModel: secrets.get('seedanceModel') ?? 'doubao-seedance-2-0-fast-260128',
      speechApiKey: secrets.get('speechApiKey') ?? '', speechAppId: secrets.get('speechAppId') ?? '', speechAccessToken: secrets.get('speechAccessToken') ?? '',
      speechResourceId: secrets.get('speechResourceId') ?? 'seed-tts-2.0', speechVoiceId: speechVoiceId(secrets), speechEnglishVoiceId: secrets.get('speechEnglishVoiceId') ?? DEFAULT_ENGLISH_SPEECH_VOICE_ID,
    })
    const ark = new ArkProvider(settings); const speech = new VolcanoSpeechProvider(settings); const media = new MediaStore(mediaRoot)
    const publishers = new PublisherRegistry(secrets, join(root, 'diagnostics')); const oauth = new OAuthService(secrets); runner = new JobRunner(database, diagnostics)
    registerPipelineHandlers({ db: database, runner, ark, speech, media, renderer: new FfmpegRenderer(), publishers })
    registerIpc(database, runner, diagnostics, secrets, publishers, oauth, new ProviderTester(ark, speech, media, settings, diagnostics), media, speech)
    mainWindow = createWindow(); runner.on('job', (job) => mainWindow?.webContents.send(IPC.jobEvent, job)); diagnostics.on('event', (event) => mainWindow?.webContents.send(IPC.diagnosticEvent, event)); runner.start()
    diagnosticsTimer = setInterval(() => { if (runner?.isIdle()) { const result = diagnostics?.cleanup(); if (result?.deleted) database?.compactDiagnostics() } }, 24 * 60 * 60 * 1_000)
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow() })
  } catch (error) {
    // A silent startup failure leaves the app running with only a Dock icon and
    // no window, which is impossible to diagnose. Surface it loudly instead.
    console.error('[lumaworks] 启动失败', error)
    dialog.showErrorBox('LumaWorks 启动失败', error instanceof Error ? `${error.message}\n\n${error.stack ?? ''}` : String(error))
    app.quit()
  }
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
process.on('unhandledRejection', (reason) => diagnostics?.log({ level: 'error', scope: 'app', phase: 'process.unhandled_rejection', message: reason instanceof Error ? reason.message : String(reason), details: { stack: reason instanceof Error ? reason.stack : undefined } }))
process.on('uncaughtException', (error) => diagnostics?.log({ level: 'error', scope: 'app', phase: 'process.uncaught_exception', message: error.message, details: { stack: error.stack } }))

app.on('before-quit', () => { diagnostics?.log({ phase: 'app.quit', scope: 'app', message: 'LumaWorks 正在退出' }); if (diagnosticsTimer) clearInterval(diagnosticsTimer); runner?.stop() })
