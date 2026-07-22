import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { isLegacyTts1Voice } from '@shared/voices'
import type { ProviderSettings, ProviderTrace, SpeechProvider, SpeechSentenceTiming } from './types'

const SPEECH_ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/unidirectional'
const TTS_COMPLETE_CODE = 20_000_000
const SUBTITLE_CAPABLE_RESOURCES = new Set(['seed-tts-2.0', 'seed-icl-2.0'])

/**
 * Route a voice ID to its required API resource ID, per the official voice
 * list: uranus/saturn voices are TTS 2.0, moon/mars voices are retired TTS
 * 1.0 (kept only so legacy data degrades gracefully), S_* clones are ICL 2.0.
 */
export function resourceForVoice(voiceId: string, configuredResourceId: string): string {
  if (voiceId.startsWith('S_')) return 'seed-icl-2.0'
  if (/_uranus_bigtts$/i.test(voiceId) || /^saturn_/i.test(voiceId)) return 'seed-tts-2.0'
  if (isLegacyTts1Voice(voiceId) || /^ICL_/i.test(voiceId)) return 'seed-tts-1.0'
  return configuredResourceId
}

interface SpeechSentencePayload {
  text?: string
  words?: Array<{ word?: string; startTime?: number; endTime?: number }>
}

interface SpeechStreamPayload {
  code?: number
  message?: string
  data?: string
  usage?: { text_words?: number }
  sentence?: SpeechSentencePayload
}

function parseSentence(payload: SpeechSentencePayload | undefined): SpeechSentenceTiming | null {
  if (!payload || !Array.isArray(payload.words)) return null
  const words = payload.words
    .filter((word): word is { word: string; startTime: number; endTime: number } => Boolean(word)
      && typeof word.word === 'string' && Boolean(word.word.trim())
      && Number.isFinite(word.startTime) && Number.isFinite(word.endTime))
    .map((word) => ({ word: word.word, startMs: Math.max(0, Math.round(word.startTime * 1000)), endMs: Math.max(0, Math.round(word.endTime * 1000)) }))
    .filter((word) => word.endMs >= word.startMs)
  if (!words.length) return null
  return { text: typeof payload.text === 'string' ? payload.text : '', words }
}

class SpeechApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
    readonly logId?: string,
  ) {
    super(message)
    this.name = 'SpeechApiError'
  }
}

export function isVoiceConfigurationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /speaker|voice|音色|音库|发音人|resource (?:id )?(?:is )?mismatched|resource.*speaker|invalid.*resource/i.test(error.message)
}

function speechErrorMessage(input: { status?: number; code?: number; message?: string; logId?: string; resourceId?: string }): string {
  const parts = [
    input.status ? `HTTP ${input.status}` : undefined,
    input.code !== undefined ? `code ${input.code}` : undefined,
    input.message?.trim() || undefined,
    input.logId ? `LogID ${input.logId}` : undefined,
  ].filter(Boolean)
  const base = `豆包语音合成失败：${parts.join(' / ') || '未知错误'}`
  if (input.status === 403) {
    return `${base}。该音色未在你的火山引擎语音应用中开通（1.0 moon/mars 音色不属于新版控制台的语音合成 2.0 服务），请在角色音色中改用 2.0（uranus）音色或点击「重新分配音色」`
  }
  if (input.code === 55_000_000 || /resource.*mismatch/i.test(input.message ?? '')) {
    return `${base}。音色与资源 ID 不匹配：uranus 音色需 seed-tts-2.0，moon/mars 音色需 seed-tts-1.0，S_ 复刻音色需 seed-icl-2.0`
  }
  return base
}

function parsePayloadLine(line: string): SpeechStreamPayload {
  const normalized = line.trim().replace(/^data:\s*/i, '')
  if (!normalized || normalized === '[DONE]') return {}
  try {
    return JSON.parse(normalized) as SpeechStreamPayload
  } catch {
    throw new Error(`豆包语音返回了无法解析的流式数据：${normalized.slice(0, 200)}`)
  }
}

function errorPayloadFromText(text: string): SpeechStreamPayload {
  const firstLine = text.split(/\r?\n/).find((line) => line.trim()) ?? ''
  try { return JSON.parse(firstLine) as SpeechStreamPayload } catch { return { message: text.slice(0, 500) } }
}

function selectedVoice(config: ProviderSettings, locale: 'zh-CN' | 'en-US', override?: string): string {
  const voiceId = override?.trim() || (locale === 'en-US' ? config.speechEnglishVoiceId : config.speechVoiceId).trim()
  if (!voiceId) throw new Error(`${locale === 'en-US' ? '英文' : '中文'} Voice ID 不能为空`)
  return voiceId
}

function requestHeaders(config: ProviderSettings, requestId: string, resourceId: string): { headers: Record<string, string>; authMode: 'api-key' | 'legacy-app' } {
  const common = {
    'Content-Type': 'application/json',
    'X-Api-Resource-Id': resourceId,
    'X-Api-Request-Id': requestId,
    'X-Control-Require-Usage-Tokens-Return': '*',
  }
  if (!common['X-Api-Resource-Id']) throw new Error('请配置豆包语音资源 ID（标准音色为 seed-tts-2.0）')
  if (config.speechApiKey.trim()) return { headers: { ...common, 'X-Api-Key': config.speechApiKey.trim() }, authMode: 'api-key' }
  if (config.speechAppId.trim() && config.speechAccessToken.trim()) {
    return {
      headers: { ...common, 'X-Api-App-Id': config.speechAppId.trim(), 'X-Api-Access-Key': config.speechAccessToken.trim() },
      authMode: 'legacy-app',
    }
  }
  if (config.speechAppId.trim() || config.speechAccessToken.trim()) throw new Error('旧版豆包语音鉴权必须同时配置 App ID 和 Access Token')
  throw new Error('请配置新版豆包语音 API Key，或同时配置旧版 App ID 和 Access Token')
}

export class VolcanoSpeechProvider implements SpeechProvider {
  constructor(private readonly settings: () => ProviderSettings, private readonly trace?: ProviderTrace) {}

  withTrace(trace: ProviderTrace): VolcanoSpeechProvider { return new VolcanoSpeechProvider(this.settings, trace) }

  resolveVoiceId(locale: 'zh-CN' | 'en-US', override?: string): string { return selectedVoice(this.settings(), locale, override) }

  async synthesize(input: { text: string; voiceId?: string; locale: 'zh-CN' | 'en-US'; outputPath: string; contextTexts?: string[]; enableSubtitle?: boolean; signal?: AbortSignal }): Promise<{ path: string; requestId: string; logId?: string; bytes: number; usageTextWords?: number; subtitles?: SpeechSentenceTiming[] }> {
    const config = this.settings()
    if (!input.text.trim()) throw new Error('待合成文本不能为空')
    const requestId = randomUUID()
    const voiceId = selectedVoice(config, input.locale, input.voiceId)
    const resourceId = resourceForVoice(voiceId, config.speechResourceId.trim())
    const { headers, authMode } = requestHeaders(config, requestId, resourceId)
    const contextTexts = (input.contextTexts ?? []).map((value) => value.trim()).filter(Boolean)
    if (contextTexts.length && resourceId !== 'seed-tts-2.0' && resourceId !== 'seed-icl-2.0') {
      throw new Error('语音指令 context_texts 仅支持豆包语音合成 2.0 音色（uranus）与声音复刻 2.0，当前音色为 1.0 音色')
    }
    const subtitleEnabled = input.enableSubtitle !== false && SUBTITLE_CAPABLE_RESOURCES.has(resourceId)
    const additionsObject: Record<string, unknown> = {}
    if (contextTexts.length) additionsObject.context_texts = contextTexts
    if (resourceId === 'seed-icl-2.0') additionsObject.model_type = 4
    const additions = Object.keys(additionsObject).length ? JSON.stringify(additionsObject) : undefined
    const body = {
      req_params: {
        text: input.text,
        speaker: voiceId,
        audio_params: { format: 'mp3', sample_rate: 24_000, ...(subtitleEnabled ? { enable_subtitle: true } : {}) },
        additions,
      },
    }
    this.trace?.({
      level: 'info', phase: 'speech.config', message: '豆包语音合成 2.0 配置已加载',
      details: {
        endpoint: '/api/v3/tts/unidirectional', authMode, apiKeyConfigured: Boolean(config.speechApiKey),
        appIdConfigured: Boolean(config.speechAppId), appIdSuffix: config.speechAppId ? `***${config.speechAppId.slice(-4)}` : '',
        accessTokenConfigured: Boolean(config.speechAccessToken), resourceId,
        voiceId, locale: input.locale, textChars: input.text.length, contextTextCount: contextTexts.length,
        text: input.text, contextTexts, request: body, format: 'mp3', sampleRate: 24_000, subtitleEnabled, requestId,
      },
    })

    const controller = new AbortController()
    const onAbort = (): void => controller.abort()
    input.signal?.addEventListener('abort', onAbort, { once: true })
    const timeout = setTimeout(() => controller.abort(), 120_000)
    const startedAt = Date.now()
    let logId: string | undefined
    try {
      this.trace?.({ level: 'info', phase: 'speech.request', message: '开始请求豆包语音合成 2.0', details: { endpoint: '/api/v3/tts/unidirectional', requestId, timeoutMs: 120_000 } })
      const response = await fetch(SPEECH_ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal })
      logId = response.headers.get('x-tt-logid') ?? response.headers.get('x-request-id') ?? undefined
      if (!response.ok) {
        const responseText = await response.text()
        const payload = errorPayloadFromText(responseText)
        const message = speechErrorMessage({ status: response.status, code: payload.code, message: payload.message, logId })
        this.trace?.({ level: 'error', phase: 'speech.response', message, details: { httpStatus: response.status, code: payload.code, serviceMessage: payload.message?.slice(0, 500), logId, requestId, elapsedMs: Date.now() - startedAt } })
        throw new SpeechApiError(message, response.status, payload.code, logId)
      }
      if (!response.body) throw new Error('豆包语音响应没有数据流')
      this.trace?.({ level: 'info', phase: 'speech.response', message: `豆包语音已连接，HTTP ${response.status}`, details: { httpStatus: response.status, contentType: response.headers.get('content-type'), logId, requestId, elapsedMs: Date.now() - startedAt } })

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const audioChunks: Buffer[] = []
      const subtitles: SpeechSentenceTiming[] = []
      let buffer = ''
      let messageCount = 0
      let finalReceived = false
      let usageTextWords: number | undefined
      const consume = (line: string): void => {
        const payload = parsePayloadLine(line)
        if (payload.code === undefined) return
        messageCount++
        if (payload.usage?.text_words !== undefined) usageTextWords = payload.usage.text_words
        if (payload.code === 0) {
          const sentence = parseSentence(payload.sentence)
          if (sentence) subtitles.push(sentence)
          if (!payload.data) return
          const chunk = Buffer.from(payload.data, 'base64')
          if (!chunk.length) throw new Error('豆包语音返回了空的音频分片')
          audioChunks.push(chunk)
          return
        }
        if (payload.code === TTS_COMPLETE_CODE) {
          finalReceived = true
          return
        }
        throw new SpeechApiError(speechErrorMessage({ status: response.status, code: payload.code, message: payload.message, logId }), response.status, payload.code, logId)
      }

      while (!finalReceived) {
        const { done, value } = await reader.read()
        buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() ?? ''
        for (const line of lines) consume(line)
        if (done) {
          if (buffer.trim()) consume(buffer)
          break
        }
      }
      if (finalReceived) await reader.cancel().catch(() => undefined)
      const audio = Buffer.concat(audioChunks)
      if (!audio.length) throw new Error('豆包语音请求成功但没有返回音频数据')
      if (!finalReceived) this.trace?.({ level: 'warn', phase: 'speech.stream.incomplete', message: '豆包语音数据流结束但未收到完成码，已保留有效音频', details: { requestId, logId, messageCount, audioChunks: audioChunks.length } })
      await mkdir(dirname(input.outputPath), { recursive: true })
      await writeFile(input.outputPath, audio)
      this.trace?.({
        level: 'info', phase: 'speech.complete', message: '豆包语音合成 2.0 音频已保存',
        details: { outputPath: input.outputPath, bytes: audio.length, audioChunks: audioChunks.length, messageCount, finalReceived, usageTextWords, subtitleSentences: subtitles.length, subtitleWords: subtitles.reduce((sum, sentence) => sum + sentence.words.length, 0), logId, requestId, elapsedMs: Date.now() - startedAt },
      })
      return { path: input.outputPath, requestId, logId, bytes: audio.length, usageTextWords, subtitles: subtitles.length ? subtitles : undefined }
    } catch (error) {
      if (error instanceof SpeechApiError) {
        this.trace?.({ level: 'error', phase: 'speech.error', message: error.message, details: { httpStatus: error.status, code: error.code, logId: error.logId ?? logId, requestId, elapsedMs: Date.now() - startedAt } })
      } else {
        const message = error instanceof Error && error.name === 'AbortError'
          ? input.signal?.aborted ? '豆包语音合成任务已取消' : '豆包语音合成请求超时（120 秒）'
          : error instanceof Error ? error.message : String(error)
        this.trace?.({ level: 'error', phase: 'speech.exception', message, details: { errorName: error instanceof Error ? error.name : 'UnknownError', requestId, logId, elapsedMs: Date.now() - startedAt } })
        if (error instanceof Error && error.name === 'AbortError') throw new Error(message)
      }
      throw error
    } finally {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', onAbort)
    }
  }
}
