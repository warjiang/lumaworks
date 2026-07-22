import { afterEach, describe, expect, it, vi } from 'vitest'
import { unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { ArkProvider } from './ark'
import { buildSeedanceRequest, buildSeedreamRequest, extractSeedreamUrl, isSeedancePolicyViolation, parseSeedanceTask, seedanceCapabilities, seedanceFailureMessage, seedreamCapabilities } from './ark-contracts'
import type { ProviderSettings } from './types'

const baseSettings: ProviderSettings = {
  arkApiKey: 'test-key', arkTextModel: 'doubao-test', arkTextApi: 'responses', arkTextStream: true,
  seedreamModel: 'doubao-seedream-5-0-pro-260628', seedanceModel: 'doubao-seedance-2-0-fast-260128',
  speechApiKey: '', speechAppId: '', speechAccessToken: '', speechResourceId: 'seed-tts-2.0', speechVoiceId: 'zh_female_vv_uranus_bigtts', speechEnglishVoiceId: 'en_female_dacey_uranus_bigtts',
}

const testImagePath = join(tmpdir(), 'lumaworks-ark-provider-test.png')

afterEach(async () => {
  vi.unstubAllGlobals()
  await unlink(testImagePath).catch(() => undefined)
})

describe('Ark Responses API', () => {
  it('collects response.output_text.delta events from SSE', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: response.created\ndata: {"type":"response.created","response":{"id":"resp-1"}}\n\n'))
        controller.enqueue(encoder.encode('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"{\\"reply\\":\\"ok"}\n\n'))
        controller.enqueue(encoder.encode('event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"\\"}"}\n\n'))
        controller.enqueue(encoder.encode('event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp-1","status":"completed"}}\n\n'))
        controller.close()
      },
    })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req-1' } }))
    vi.stubGlobal('fetch', fetchMock)
    const trace: string[] = []
    const provider = new ArkProvider(() => baseSettings, (entry) => trace.push(entry.phase))
    const result = await provider.generateJson('test', (value) => z.object({ reply: z.string() }).parse(value))
    expect(result.reply).toBe('ok')
    expect(String(fetchMock.mock.calls[0][0]).endsWith('/api/v3/responses')).toBe(true)
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)) as Record<string, unknown>
    expect(body.stream).toBe(true)
    expect(body).not.toHaveProperty('tools')
    expect(trace).toContain('responses.stream.complete')
  })

  it('extracts output_text from a non-stream response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'resp-2', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"reply":"json"}' }] }] }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const provider = new ArkProvider(() => ({ ...baseSettings, arkTextStream: false }))
    const result = await provider.generateJson('test', (value) => z.object({ reply: z.string() }).parse(value))
    expect(result.reply).toBe('json')
  })

  it('repairs a schema-valid JSON object with missing nested required fields once', async () => {
    const incomplete = { characters: [{ name: '林澈' }] }
    const complete = { characters: [{ name: '林澈', role: '主角', appearance: '短发黑风衣', personality: '克制坚韧', voice: '冷静低沉' }] }
    const outputs = [incomplete, complete]
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      const value = outputs.shift()
      return new Response(JSON.stringify({ id: 'resp-repair', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(value) }] }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const phases: string[] = []
    const schema = z.object({ characters: z.array(z.object({ name: z.string(), role: z.string(), appearance: z.string(), personality: z.string(), voice: z.string() })) })
    const provider = new ArkProvider(() => ({ ...baseSettings, arkTextStream: false }), (entry) => phases.push(entry.phase))
    const result = await provider.generateJson('generate characters', (value) => schema.parse(value), { contractName: '故事圣经' })
    expect(result).toEqual(complete)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const repairBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as { input: Array<{ content: Array<{ text: string }> }> }
    expect(repairBody.input[0].content[0].text).toContain('characters[0].role')
    expect(repairBody.input[0].content[0].text).toContain('数组中每个对象都要分别补齐字段')
    expect(phases).toEqual(expect.arrayContaining(['text.validation.failed', 'text.repair.start', 'text.repair.complete']))
  })

  it('repairs malformed JSON syntax using the same guarded repair pass', async () => {
    const outputs = ['{"reply":', '{"reply":"fixed"}']
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: outputs.shift() }] }] }), { status: 200 })))
    const provider = new ArkProvider(() => ({ ...baseSettings, arkTextStream: false }))
    const result = await provider.generateJson('test', (value) => z.object({ reply: z.string() }).parse(value), { contractName: '测试 JSON' })
    expect(result.reply).toBe('fixed')
  })

  it('returns a concise actionable error when the repair still violates the schema', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: '{"characters":[{"name":"林澈"}]}' }] }] }), { status: 200 })))
    const schema = z.object({ characters: z.array(z.object({ name: z.string(), role: z.string(), appearance: z.string() })) })
    const provider = new ArkProvider(() => ({ ...baseSettings, arkTextStream: false }))
    await expect(provider.generateJson('test', (value) => schema.parse(value), { contractName: '故事圣经' }))
      .rejects.toThrow('故事圣经结构校验失败，自动修复后仍不符合要求：characters[0].role: 缺少必填字段')
  })

  it('lowers reasoning effort for Seed 2.x models and uses minimal effort for repairs', async () => {
    const outputs = ['{"reply":', '{"reply":"fixed"}']
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: outputs.shift() }] }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new ArkProvider(() => ({ ...baseSettings, arkTextModel: 'doubao-seed-2-1-turbo-260628', arkTextStream: false }))
    await provider.generateJson('test', (value) => z.object({ reply: z.string() }).parse(value))
    const generateBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>
    const repairBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as Record<string, unknown>
    expect(generateBody.reasoning).toEqual({ effort: 'low' })
    expect(repairBody.reasoning).toEqual({ effort: 'minimal' })
  })

  it('omits the reasoning field for models that do not support it', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: '{"reply":"ok"}' }] }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new ArkProvider(() => ({ ...baseSettings, arkTextModel: 'doubao-seed-1-6-250615', arkTextStream: false }))
    await provider.generateJson('test', (value) => z.object({ reply: z.string() }).parse(value))
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>
    expect(body).not.toHaveProperty('reasoning')
  })

  it('converts internal request timeouts into a clear retryable error', async () => {
    vi.useFakeTimers()
    try {
      vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })))
      })))
      const provider = new ArkProvider(() => ({ ...baseSettings, arkTextStream: false }))
      const promise = provider.generateJson('test', (value) => z.object({ reply: z.string() }).parse(value))
      const assertion = expect(promise).rejects.toThrow('火山方舟文本生成超过 600 秒仍未完成')
      await vi.advanceTimersByTimeAsync(600_000)
      await assertion
    } finally { vi.useRealTimers() }
  })
})

describe('Ark Seedream API', () => {
  it('uses the official 5.0 Pro portrait size and omits unsupported fields', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ url: 'https://example.test/image.png' }] }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new ArkProvider(() => baseSettings)
    await provider.generateImage({ prompt: 'test', aspectRatio: '9:16' })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>
    expect(body.size).toBe('1584x2816')
    expect(body).not.toHaveProperty('sequential_image_generation')
    expect(body).not.toHaveProperty('stream')
    expect(body.response_format).toBe('url')
    expect(body.watermark).toBe(false)
  })

  it('sends disabled single-image mode only to models that support the field', () => {
    const lite = buildSeedreamRequest({ model: 'doubao-seedream-5-0-lite-260628', prompt: 'test', aspectRatio: '9:16' })
    const legacy = buildSeedreamRequest({ model: 'doubao-seedream-4-5-251128', prompt: 'test', aspectRatio: '16:9' })
    expect(lite.body).toMatchObject({ size: '1600x2848', sequential_image_generation: 'disabled' })
    expect(legacy.body).toMatchObject({ size: '2848x1600', sequential_image_generation: 'disabled' })
    expect(seedreamCapabilities('doubao-seedream-5-0-260128').family).toBe('5.0-pro')
  })

  it('uses a string for one reference image and enforces model reference limits', () => {
    const one = buildSeedreamRequest({ model: baseSettings.seedreamModel, prompt: 'test', images: ['data:image/png;base64,AA=='] })
    expect(one.body.image).toBe('data:image/png;base64,AA==')
    expect(() => buildSeedreamRequest({ model: baseSettings.seedreamModel, prompt: 'test', images: Array.from({ length: 11 }, (_, index) => `image-${index}`) })).toThrow('最多支持 10 张参考图')
  })

  it('surfaces nested Ark error messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'InvalidParameter', message: 'unsupported option' } }), { status: 400, headers: { 'content-type': 'application/json' } })))
    const provider = new ArkProvider(() => baseSettings)
    await expect(provider.generateImage({ prompt: 'test', aspectRatio: '9:16' })).rejects.toThrow('unsupported option')
  })

  it('surfaces per-image errors returned in a successful HTTP response', () => {
    expect(() => extractSeedreamUrl({ data: [{ error: { code: 'ContentRisk', message: 'image rejected' } }] })).toThrow('ContentRisk: image rejected')
  })
})

describe('Ark Seedance API', () => {
  it('turns copyright policy failures into an actionable message', () => {
    const task = parseSeedanceTask({
      id: 'cgt-policy', status: 'failed',
      error: {
        code: 'OutputVideoSensitiveContentDetected.PolicyViolation',
        message: 'The request failed because the output video may be related to copyright restrictions. Request id: req-policy-1',
      },
    })
    expect(isSeedancePolicyViolation(task)).toBe(true)
    expect(seedanceFailureMessage(task)).toContain('更换关键帧')
    expect(seedanceFailureMessage(task)).toContain('Request ID：req-policy-1')
  })

  it('marks a copyright policy task failure as non-retryable', async () => {
    await writeFile(testImagePath, new Uint8Array([137, 80, 78, 71]))
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'cgt-policy' }), { status: 200 })
      return new Response(JSON.stringify({
        id: 'cgt-policy', status: 'failed',
        error: { code: 'OutputVideoSensitiveContentDetected.PolicyViolation', message: 'copyright restrictions. Request id: req-policy-2' },
      }), { status: 200 })
    }))
    const provider = new ArkProvider(() => baseSettings, undefined, { videoPollIntervalMs: 0, videoMaxPolls: 1 })
    await expect(provider.generateVideo({ prompt: 'move', imagePath: testImagePath })).rejects.toMatchObject({ retryable: false })
  })

  it('turns real-person input rejections into an actionable non-retryable message', async () => {
    const task = parseSeedanceTask({
      id: 'cgt-face', status: 'failed',
      error: {
        code: 'InputImageSensitiveContentDetected.PrivacyInformation',
        message: 'The request failed because the input image may contain real person. Request id: req-face-1',
      },
    })
    expect(isSeedancePolicyViolation(task)).toBe(true)
    expect(seedanceFailureMessage(task)).toContain('真实人物面孔')
    expect(seedanceFailureMessage(task)).toContain('Request ID：req-face-1')

    await writeFile(testImagePath, new Uint8Array([137, 80, 78, 71]))
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response(JSON.stringify({ error: { code: 'InputImageSensitiveContentDetected.PrivacyInformation', message: 'The request failed because the input image may contain real person. Request id: req-face-2' } }), { status: 400 })
      }
      throw new Error('unexpected poll')
    }))
    const provider = new ArkProvider(() => baseSettings, undefined, { videoPollIntervalMs: 0, videoMaxPolls: 1 })
    await expect(provider.generateVideo({ prompt: 'move', imagePath: testImagePath })).rejects.toMatchObject({ retryable: false, message: expect.stringContaining('Request ID：req-face-2') })
  })

  it('builds official first-frame and first/last-frame content roles', () => {
    const first = buildSeedanceRequest({ model: baseSettings.seedanceModel, prompt: 'move', firstFrameUrl: 'data:image/png;base64,AA==', durationSeconds: 3 })
    expect(first.body).toMatchObject({ resolution: '1080p', ratio: '9:16', duration: 4, generate_audio: false, watermark: false })
    expect(first.body.content[1]).toMatchObject({ type: 'image_url', role: 'first_frame' })

    const both = buildSeedanceRequest({ model: baseSettings.seedanceModel, prompt: 'move', firstFrameUrl: 'first', lastFrameUrl: 'last', durationSeconds: 15, returnLastFrame: true })
    expect(both.body.content.map((item) => 'role' in item ? item.role : item.type)).toEqual(['text', 'first_frame', 'last_frame'])
    expect(both.body.return_last_frame).toBe(true)
  })

  it('defaults to 1080p for Seedance 2.x, 720p for older models, and honors explicit overrides', () => {
    expect(buildSeedanceRequest({ model: 'doubao-seedance-2-0-260128', prompt: 'move', firstFrameUrl: 'first' }).body.resolution).toBe('1080p')
    expect(buildSeedanceRequest({ model: 'doubao-seedance-1-5-pro-260128', prompt: 'move', firstFrameUrl: 'first' }).body.resolution).toBe('720p')
    expect(buildSeedanceRequest({ model: 'doubao-seedance-2-0-fast-260128', prompt: 'move', firstFrameUrl: 'first', resolution: '720p' }).body.resolution).toBe('720p')
  })

  it('omits generate_audio for 1.0 models and rejects unsupported fast-model last frames', () => {
    const model = 'doubao-seedance-1-0-pro-fast-251015'
    const request = buildSeedanceRequest({ model, prompt: 'move', firstFrameUrl: 'first', durationSeconds: 2 })
    expect(request.body).not.toHaveProperty('generate_audio')
    expect(request.body.duration).toBe(2)
    expect(seedanceCapabilities(model).supportsLastFrame).toBe(false)
    expect(() => buildSeedanceRequest({ model, prompt: 'move', firstFrameUrl: 'first', lastFrameUrl: 'last' })).toThrow('不支持首尾帧模式')
  })

  it('accepts every official query status and rejects unknown states', () => {
    for (const status of ['queued', 'running', 'cancelled', 'succeeded', 'failed', 'expired']) {
      expect(parseSeedanceTask({ id: 'task-1', status }).status).toBe(status)
    }
    expect(() => parseSeedanceTask({ id: 'task-1', status: 'completed' })).toThrow('未知任务状态')
  })

  it('creates, polls, and parses an official successful task response', async () => {
    await writeFile(testImagePath, new Uint8Array([137, 80, 78, 71]))
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'cgt-test' }), { status: 200 })
      if (url.endsWith('/cgt-test') && fetchMock.mock.calls.length === 2) return new Response(JSON.stringify({ id: 'cgt-test', model: baseSettings.seedanceModel, status: 'queued', created_at: 1, updated_at: 1 }), { status: 200 })
      return new Response(JSON.stringify({
        id: 'cgt-test', model: baseSettings.seedanceModel, status: 'succeeded', content: { video_url: 'https://example.test/video.mp4', last_frame_url: 'https://example.test/last.png' },
        usage: { completion_tokens: 108900, total_tokens: 108900 }, created_at: 1, updated_at: 2, resolution: '720p', ratio: '9:16', duration: 4, framespersecond: 24, generate_audio: false,
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = new ArkProvider(() => baseSettings, undefined, { videoPollIntervalMs: 0, videoMaxPolls: 3 })
    const result = await provider.generateVideo({ prompt: 'move', imagePath: testImagePath, durationSeconds: 4, returnLastFrame: true })
    expect(result).toEqual({ url: 'https://example.test/video.mp4', externalId: 'cgt-test', lastFrameUrl: 'https://example.test/last.png' })
    const createBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>
    expect(createBody).toMatchObject({ model: baseSettings.seedanceModel, resolution: '1080p', ratio: '9:16', duration: 4, generate_audio: false, return_last_frame: true, watermark: false })
    expect(fetchMock.mock.calls.slice(1).every((call) => call[1]?.method === 'GET')).toBe(true)
  })

  it('retries a transient polling error and reports the official failure payload', async () => {
    await writeFile(testImagePath, new Uint8Array([137, 80, 78, 71]))
    let getCount = 0
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'cgt-failed' }), { status: 200 })
      getCount++
      if (getCount === 1) return new Response(JSON.stringify({ error: { code: 'RateLimitExceeded', message: 'slow down' } }), { status: 429 })
      return new Response(JSON.stringify({ id: 'cgt-failed', status: 'failed', error: { code: 'InternalError', message: 'generation failed' } }), { status: 200 })
    }))
    const provider = new ArkProvider(() => baseSettings, undefined, { videoPollIntervalMs: 0, videoMaxPolls: 3 })
    await expect(provider.generateVideo({ prompt: 'move', imagePath: testImagePath })).rejects.toThrow('InternalError: generation failed')
    expect(getCount).toBe(2)
  })

  it('uses the documented DELETE task endpoint for cancellation', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const provider = new ArkProvider(() => baseSettings)
    await provider.cancelVideoTask('cgt-cancel')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/contents\/generations\/tasks\/cgt-cancel$/)
    expect(fetchMock.mock.calls[0][1]?.method).toBe('DELETE')
  })

  it('cancels the remote queued task when the local job is already aborted', async () => {
    await writeFile(testImagePath, new Uint8Array([137, 80, 78, 71]))
    const methods: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      methods.push(init?.method ?? 'GET')
      return new Response(init?.method === 'POST' ? JSON.stringify({ id: 'cgt-abort' }) : '{}', { status: 200 })
    }))
    const controller = new AbortController()
    controller.abort()
    const provider = new ArkProvider(() => baseSettings, undefined, { videoPollIntervalMs: 0 })
    await expect(provider.generateVideo({ prompt: 'move', imagePath: testImagePath }, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(methods).toEqual(['POST', 'DELETE'])
  })
})
