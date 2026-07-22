import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isVoiceConfigurationError, VolcanoSpeechProvider } from './speech'
import type { ProviderSettings } from './types'

const outputPath = join(tmpdir(), 'lumaworks-speech-provider-test.mp3')
const settings: ProviderSettings = {
  arkApiKey: '', arkTextModel: '', arkTextApi: 'responses', arkTextStream: false,
  seedreamModel: '', seedanceModel: '', speechApiKey: 'new-api-key', speechAppId: '', speechAccessToken: '',
  speechResourceId: 'seed-tts-2.0', speechVoiceId: 'zh_female_vv_uranus_bigtts', speechEnglishVoiceId: 'en_female_dacey_uranus_bigtts',
}

function successfulStream(audio = Buffer.from('fake-mp3-audio')): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const first = JSON.stringify({ code: 0, message: 'OK', data: audio.subarray(0, 5).toString('base64') }) + '\n'
  const second = JSON.stringify({ code: 0, message: 'OK', data: audio.subarray(5).toString('base64'), usage: { text_words: 12 } }) + '\n'
  const complete = JSON.stringify({ code: 20_000_000, message: 'OK', usage: { text_words: 12 } }) + '\n'
  return new ReadableStream({
    start(controller) {
      // Split JSON across transport chunks to verify incremental NDJSON parsing.
      controller.enqueue(encoder.encode(first.slice(0, 11)))
      controller.enqueue(encoder.encode(first.slice(11) + second + complete))
      controller.close()
    },
  })
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await unlink(outputPath).catch(() => undefined)
})

describe('VolcanoSpeechProvider TTS 2.0', () => {
  it('only classifies voice and speaker failures as fallback candidates', () => {
    expect(isVoiceConfigurationError(new Error('[Invalid argument] speaker not found'))).toBe(true)
    expect(isVoiceConfigurationError(new Error('resource ID is mismatched with speaker related resource'))).toBe(true)
    expect(isVoiceConfigurationError(new Error('HTTP 401 unauthorized'))).toBe(false)
    expect(isVoiceConfigurationError(new Error('fetch failed'))).toBe(false)
  })

  it('uses new API Key auth, sends official request fields, and joins streamed MP3 chunks', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(successfulStream(), { status: 200, headers: { 'content-type': 'application/x-ndjson', 'x-tt-logid': 'log-new' } }))
    vi.stubGlobal('fetch', fetchMock)
    const phases: string[] = []
    const provider = new VolcanoSpeechProvider(() => settings, (entry) => phases.push(entry.phase))
    const result = await provider.synthesize({ text: '你好，语音测试', locale: 'zh-CN', outputPath, contextTexts: ['请用温暖的语气说话'] })

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://openspeech.bytedance.com/api/v3/tts/unidirectional')
    const init = fetchMock.mock.calls[0][1] as RequestInit
    const headers = init.headers as Record<string, string>
    expect(headers['X-Api-Key']).toBe('new-api-key')
    expect(headers['X-Api-Resource-Id']).toBe('seed-tts-2.0')
    expect(headers['X-Api-Request-Id']).toBeTruthy()
    expect(headers).not.toHaveProperty('Authorization')
    const body = JSON.parse(String(init.body)) as { req_params: { text: string; speaker: string; audio_params: Record<string, unknown>; additions: string } }
    expect(body.req_params).toMatchObject({ text: '你好，语音测试', speaker: 'zh_female_vv_uranus_bigtts', audio_params: { format: 'mp3', sample_rate: 24_000 } })
    expect(JSON.parse(body.req_params.additions)).toEqual({ context_texts: ['请用温暖的语气说话'] })
    expect((await readFile(outputPath)).toString()).toBe('fake-mp3-audio')
    expect(result).toMatchObject({ path: outputPath, logId: 'log-new', bytes: 14, usageTextWords: 12 })
    expect(phases).toContain('speech.complete')
  })

  it('requests subtitles on TTS 2.0 and parses word-level sentence timings', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(JSON.stringify({ code: 0, message: '', data: Buffer.from('audio').toString('base64') }) + '\n'))
        controller.enqueue(encoder.encode(JSON.stringify({
          code: 0, message: '', data: null,
          sentence: { text: '你好。', words: [{ word: '你', startTime: 0.1, endTime: 0.4, confidence: 0.9 }, { word: '好。', startTime: 0.4, endTime: 0.8, confidence: 0.9 }] },
        }) + '\n'))
        controller.enqueue(encoder.encode(JSON.stringify({ code: 20_000_000, message: 'ok' }) + '\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(stream, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new VolcanoSpeechProvider(() => settings)
    const result = await provider.synthesize({ text: '你好。', locale: 'zh-CN', outputPath })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { req_params: { audio_params: Record<string, unknown> } }
    expect(body.req_params.audio_params).toMatchObject({ enable_subtitle: true })
    expect(result.subtitles).toEqual([{ text: '你好。', words: [{ word: '你', startMs: 100, endMs: 400 }, { word: '好。', startMs: 400, endMs: 800 }] }])
  })

  it('falls back to the configured resource for voices that match no known pattern', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(successfulStream(), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new VolcanoSpeechProvider(() => ({ ...settings, speechResourceId: 'seed-tts-1.0' }))
    await provider.synthesize({ text: '自定义音色', locale: 'zh-CN', outputPath, voiceId: 'my_custom_endpoint_voice' })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['X-Api-Resource-Id']).toBe('seed-tts-1.0')
    const body = JSON.parse(String(init.body)) as { req_params: { audio_params: Record<string, unknown> } }
    expect(body.req_params.audio_params).not.toHaveProperty('enable_subtitle')
  })

  it('supports the documented legacy App ID and Access Token headers', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(successfulStream(), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new VolcanoSpeechProvider(() => ({ ...settings, speechApiKey: '', speechAppId: 'legacy-app', speechAccessToken: 'legacy-token' }))
    await provider.synthesize({ text: '兼容鉴权', locale: 'zh-CN', outputPath })
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>
    expect(headers['X-Api-App-Id']).toBe('legacy-app')
    expect(headers['X-Api-Access-Key']).toBe('legacy-token')
    expect(headers).not.toHaveProperty('X-Api-Key')
  })

  it('selects the configured English voice for English production calls', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(successfulStream(), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new VolcanoSpeechProvider(() => settings)
    await provider.synthesize({ text: 'Hello from LumaWorks.', locale: 'en-US', outputPath })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as { req_params: { speaker: string } }
    expect(body.req_params.speaker).toBe('en_female_dacey_uranus_bigtts')
  })

  it('surfaces HTTP errors with code, message, and server LogID', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 45_000_001, message: '[Invalid argument] speaker not found' }), { status: 400, headers: { 'x-tt-logid': 'log-error' } })))
    const provider = new VolcanoSpeechProvider(() => settings)
    await expect(provider.synthesize({ text: '错误测试', locale: 'zh-CN', outputPath })).rejects.toThrow('HTTP 400 / code 45000001 / [Invalid argument] speaker not found / LogID log-error')
  })

  it('surfaces error messages received inside an HTTP 200 stream', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode('{"code":55000000,"message":"resource ID is mismatched with speaker related resource"}\n')); controller.close() } })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200, headers: { 'x-tt-logid': 'log-stream-error' } })))
    const provider = new VolcanoSpeechProvider(() => settings)
    await expect(provider.synthesize({ text: '资源错误', locale: 'zh-CN', outputPath })).rejects.toThrow('resource ID is mismatched with speaker related resource')
  })

  it('validates credentials and voice-instruction resource compatibility before billing', async () => {
    const noCredentials = new VolcanoSpeechProvider(() => ({ ...settings, speechApiKey: '' }))
    await expect(noCredentials.synthesize({ text: '无凭据', locale: 'zh-CN', outputPath })).rejects.toThrow('请配置新版豆包语音 API Key')

    const legacyVoice = new VolcanoSpeechProvider(() => settings)
    await expect(legacyVoice.synthesize({ text: '旧音色', locale: 'zh-CN', outputPath, voiceId: 'zh_male_beijingxiaoye_moon_bigtts', contextTexts: ['开心'] })).rejects.toThrow('当前音色为 1.0 音色')
  })

  it('routes TTS 1.0 moon/mars voices to the seed-tts-1.0 resource without subtitles', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(successfulStream(), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new VolcanoSpeechProvider(() => settings)
    await provider.synthesize({ text: '旧音色', locale: 'zh-CN', outputPath, voiceId: 'zh_male_beijingxiaoye_moon_bigtts' })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['X-Api-Resource-Id']).toBe('seed-tts-1.0')
    const body = JSON.parse(String(init.body)) as { req_params: { speaker: string; audio_params: Record<string, unknown> } }
    expect(body.req_params.speaker).toBe('zh_male_beijingxiaoye_moon_bigtts')
    expect(body.req_params.audio_params).not.toHaveProperty('enable_subtitle')
  })

  it('routes S_ voice clones to seed-icl-2.0 with model_type 4 and merges context texts', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(successfulStream(), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new VolcanoSpeechProvider(() => settings)
    await provider.synthesize({ text: '复刻音色', locale: 'zh-CN', outputPath, voiceId: 'S_ABCDEFG', contextTexts: ['用平静的语气'] })
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)['X-Api-Resource-Id']).toBe('seed-icl-2.0')
    const body = JSON.parse(String(init.body)) as { req_params: { additions: string; audio_params: Record<string, unknown> } }
    expect(JSON.parse(body.req_params.additions)).toEqual({ context_texts: ['用平静的语气'], model_type: 4 })
    expect(body.req_params.audio_params).toMatchObject({ enable_subtitle: true })
  })
})
