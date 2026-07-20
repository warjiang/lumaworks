import { describe, expect, it } from 'vitest'
import { ProviderTester } from './tester'
import type { ProviderSettings } from './types'

const settings: ProviderSettings = {
  arkApiKey: 'test', arkTextModel: 'doubao-test', arkTextApi: 'responses', arkTextStream: true, seedreamModel: 'seedream-test', seedanceModel: 'seedance-test',
  speechApiKey: 'speech-key', speechAppId: 'app', speechAccessToken: 'token', speechResourceId: 'seed-tts-2.0', speechVoiceId: 'voice-test', speechEnglishVoiceId: 'english-voice-test',
}

function createTester(options: { failText?: boolean } = {}): ProviderTester {
  let arkTrace: ((entry: Record<string, unknown>) => void) | undefined
  const ark = {
    withTrace: (trace: (entry: Record<string, unknown>) => void) => { arkTrace = trace; return ark },
    generateJson: async (_prompt: string, validate: (value: unknown) => unknown) => {
      arkTrace?.({ level: 'info', phase: 'mock.text', message: 'mock response Bearer private-token', details: { accessToken: 'never-log-this', apiKeyConfigured: true } })
      if (options.failText) throw new Error('401 Unauthorized')
      return validate({ reply: '连接成功' })
    },
    generateImage: async () => ({ url: 'https://example.test/image.png' }),
    generateVideo: async () => ({ url: 'https://example.test/video.mp4', externalId: 'video-task' }),
  }
  const speech = { withTrace: () => speech, synthesize: async (input: { outputPath: string }) => ({ path: input.outputPath, requestId: 'speech-request', bytes: 128 }) }
  const media = {
    root: '/tmp/lumaworks-provider-tests',
    download: async (_projectId: string, kind: string) => `/tmp/${kind}.${kind === 'video' ? 'mp4' : 'png'}`,
    projectDir: () => '/tmp/model-tests',
  }
  return new ProviderTester(ark as never, speech as never, media as never, () => settings)
}

describe('ProviderTester', () => {
  it('executes all four model smoke tests', async () => {
    const tester = createTester()
    const results = await Promise.all(['text', 'image', 'video', 'speech'].map((kind) => tester.test(kind as 'text' | 'image' | 'video' | 'speech')))
    expect(results.every((result) => result.ok)).toBe(true)
    expect(results.find((result) => result.kind === 'video')?.externalId).toBe('video-task')
    expect(results.find((result) => result.kind === 'speech')?.model).toBe('voice-test')
    expect(results.every((result) => result.requestId && result.logPath)).toBe(true)
    expect(results.find((result) => result.kind === 'text')?.diagnostics.some((entry) => entry.phase === 'mock.text')).toBe(true)
    const serialized = JSON.stringify(results.find((result) => result.kind === 'text')?.diagnostics)
    expect(serialized).not.toContain('private-token')
    expect(serialized).not.toContain('never-log-this')
  })

  it('returns a readable authentication error instead of throwing', async () => {
    const result = await createTester({ failText: true }).test('text')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('鉴权失败')
  })
})
