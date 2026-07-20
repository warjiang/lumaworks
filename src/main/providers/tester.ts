import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import type { ModelTestKind, ModelTestResult } from '@shared/domain'
import type { MediaStore } from '../media/store'
import type { ArkProvider } from './ark'
import type { ProviderSettings, ProviderTraceEntry } from './types'
import type { VolcanoSpeechProvider } from './speech'
import type { DiagnosticsService } from '../diagnostics/service'

const textTestSchema = z.object({ reply: z.string().min(1) })
type TestOutcome = Omit<ModelTestResult, 'requestId' | 'logPath' | 'diagnostics'>

export class ProviderTester {
  constructor(
    private readonly ark: ArkProvider,
    private readonly speech: VolcanoSpeechProvider,
    private readonly media: MediaStore,
    private readonly settings: () => ProviderSettings,
    private readonly systemDiagnostics?: DiagnosticsService,
  ) {}

  async test(kind: ModelTestKind): Promise<ModelTestResult> {
    const startedAt = Date.now()
    const requestId = randomUUID()
    const diagnostics: ProviderTraceEntry[] = []
    const trace = (entry: Omit<ProviderTraceEntry, 'timestamp'>): void => {
      diagnostics.push(redactEntry({ ...entry, timestamp: new Date().toISOString() }))
      this.systemDiagnostics?.log({ level: entry.level, scope: 'provider', phase: `model-test.${entry.phase}`, message: entry.message, details: { requestId, kind, ...entry.details } })
    }
    const ark = this.ark.withTrace(trace)
    const speech = this.speech.withTrace(trace)
    const directory = join(this.media.root, '_diagnostics', 'model-tests')
    const logPath = join(directory, `${new Date().toISOString().replaceAll(':', '-')}-${kind}-${requestId.slice(0, 8)}.json`)
    trace({ level: 'info', phase: 'test.start', message: `开始${kind}模型测试`, details: { requestId, kind, model: this.modelName(kind), appVersion: process.env.npm_package_version ?? 'development', platform: process.platform, arch: process.arch } })
    let outcome: TestOutcome
    try {
      if (kind === 'text') outcome = await this.testText(startedAt, ark)
      else if (kind === 'image') outcome = await this.testImage(startedAt, ark, trace)
      else if (kind === 'video') outcome = await this.testVideo(startedAt, ark, trace)
      else outcome = await this.testSpeech(startedAt, speech)
      trace({ level: 'info', phase: 'test.complete', message: outcome.message, details: { elapsedMs: outcome.elapsedMs, outputPath: outcome.outputPath, externalId: outcome.externalId } })
    } catch (error) {
      outcome = {
        kind,
        ok: false,
        model: this.modelName(kind),
        elapsedMs: Date.now() - startedAt,
        message: this.readableError(error),
      }
      trace({ level: 'error', phase: 'test.failed', message: outcome.message, details: { errorName: error instanceof Error ? error.name : 'UnknownError', stack: error instanceof Error ? error.stack?.split('\n').slice(0, 8).join('\n') : undefined } })
    }
    await mkdir(directory, { recursive: true })
    await writeFile(logPath, JSON.stringify({ requestId, kind, result: { ...outcome, diagnostics: undefined }, diagnostics }, null, 2), 'utf8')
    return { ...outcome, requestId, logPath, diagnostics }
  }

  private async testText(startedAt: number, ark: ArkProvider): Promise<TestOutcome> {
    const result = await ark.generateJson(
      '这是连接测试。请只返回 JSON：{"reply":"LumaWorks 文本模型连接成功"}',
      (value) => textTestSchema.parse(value),
    )
    return { kind: 'text', ok: true, model: this.settings().arkTextModel, elapsedMs: Date.now() - startedAt, message: '文本模型响应正常', previewText: result.reply }
  }

  private async testImage(startedAt: number, ark: ArkProvider, trace: (entry: Omit<ProviderTraceEntry, 'timestamp'>) => void): Promise<TestOutcome> {
    const result = await ark.generateImage({
      prompt: '电影感竖屏镜头，一盏暖色台灯照亮空的编剧桌面，桌上只有一本合上的剧本，写实摄影，无人物，无文字，无水印',
      aspectRatio: '9:16',
    })
    trace({ level: 'info', phase: 'media.download', message: '正在下载测试图片到本地', details: { urlHost: new URL(result.url).host } })
    const outputPath = await this.media.download('_model-tests', 'image', result.url)
    return { kind: 'image', ok: true, model: this.settings().seedreamModel, elapsedMs: Date.now() - startedAt, message: 'Seedream 已生成测试图', outputPath }
  }

  private async testVideo(startedAt: number, ark: ArkProvider, trace: (entry: Omit<ProviderTraceEntry, 'timestamp'>) => void): Promise<TestOutcome> {
    // Seedance requires an input frame. Generate a disposable Seedream frame so the
    // test verifies the same image-to-video path used by production jobs.
    trace({ level: 'info', phase: 'video.source', message: '先生成 Seedance 测试首帧', details: { generator: this.settings().seedreamModel } })
    const frame = await ark.generateImage({
      prompt: '电影感竖屏镜头，一盏暖色台灯照亮空的编剧桌面，窗帘轻微摆动，写实摄影，无人物，无文字，无水印',
      aspectRatio: '9:16',
    })
    const imagePath = await this.media.download('_model-tests', 'video-source', frame.url)
    trace({ level: 'info', phase: 'video.source.saved', message: '测试首帧已保存', details: { imagePath } })
    const result = await ark.generateVideo({
      prompt: '镜头缓慢向桌面推进，窗帘被微风轻轻吹动，灯光稳定，真实物理运动，无文字',
      imagePath,
      durationSeconds: 4,
    })
    const outputPath = await this.media.download('_model-tests', 'video', result.url)
    return { kind: 'video', ok: true, model: this.settings().seedanceModel, elapsedMs: Date.now() - startedAt, message: 'Seedance 已生成 4 秒测试视频', outputPath, externalId: result.externalId }
  }

  private async testSpeech(startedAt: number, speech: VolcanoSpeechProvider): Promise<TestOutcome> {
    const config = this.settings()
    const outputPath = join(this.media.projectDir('_model-tests'), 'speech', `speech-${Date.now()}.mp3`)
    const result = await speech.synthesize({
      text: '你好，这里是 LumaWorks 火山语音连接测试。',
      voiceId: config.speechVoiceId,
      locale: 'zh-CN',
      outputPath,
      contextTexts: config.speechResourceId === 'seed-tts-2.0' ? ['请用自然、清晰、温暖的语气说话'] : undefined,
    })
    return { kind: 'speech', ok: true, model: config.speechVoiceId, elapsedMs: Date.now() - startedAt, message: `豆包语音合成 2.0 已生成测试音频（${result.bytes} 字节）`, outputPath }
  }

  private modelName(kind: ModelTestKind): string {
    const config = this.settings()
    if (kind === 'text') return config.arkTextModel
    if (kind === 'image') return config.seedreamModel
    if (kind === 'video') return config.seedanceModel
    return config.speechVoiceId
  }

  private readableError(error: unknown): string {
    if (!(error instanceof Error)) return String(error)
    if (error.name === 'AbortError') return '请求超时，请检查网络和服务可用区'
    if (/401|Unauthorized|authentication|鉴权|API Key|Access Key/i.test(error.message)) return `鉴权失败：${error.message}`
    if (/403|permission|quota|开通/i.test(error.message)) return `服务未开通或没有权限：${error.message}`
    if (/voice|speaker|音色|resource.?id/i.test(error.message)) return `音色或语音资源配置不可用：${error.message}`
    return error.message
  }
}

const SENSITIVE_KEY = /authorization|token|secret|api.?key|password|credential/i

function redactEntry(entry: ProviderTraceEntry): ProviderTraceEntry {
  return { ...entry, message: redactString(entry.message), details: entry.details ? redactObject(entry.details) : undefined }
}

function redactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) && !/configured|length/i.test(key) ? '[REDACTED]' : redactValue(item)]))
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value)
  if (Array.isArray(value)) return value.map(redactValue)
  if (value && typeof value === 'object') return redactObject(value as Record<string, unknown>)
  return value
}

function redactString(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/(access[_ -]?token|api[_ -]?key|client[_ -]?secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 4_000)
}
