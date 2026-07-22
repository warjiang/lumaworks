export type SeedreamFamily = '5.0-pro' | '5.0-lite' | '4.5' | '4.0' | 'unknown'

export interface SeedreamCapabilities {
  family: SeedreamFamily
  maxReferenceImages: number
  supportsSequentialImages: boolean
  supportsStreaming: boolean
  supportsOutputFormat: boolean
}

export interface SeedreamRequestBody {
  model: string
  prompt: string
  image?: string | string[]
  size: string
  response_format: 'url'
  watermark: boolean
  sequential_image_generation?: 'disabled'
}

export interface SeedreamResponseItem {
  url?: string
  b64_json?: string
  size?: string
  output_format?: string
  error?: { code?: string; message?: string }
}

export interface SeedreamResponse {
  created?: number
  model?: string
  data?: SeedreamResponseItem[]
  error?: { code?: string; message?: string }
  usage?: Record<string, unknown>
}

const PRO_2K_SIZES: Record<string, string> = {
  '1:1': '2048x2048',
  '4:3': '2368x1776',
  '3:4': '1776x2368',
  '16:9': '2816x1584',
  '9:16': '1584x2816',
  '3:2': '2496x1664',
  '2:3': '1664x2496',
  '21:9': '3136x1344',
}

const STANDARD_2K_SIZES: Record<string, string> = {
  '1:1': '2048x2048',
  '4:3': '2304x1728',
  '3:4': '1728x2304',
  '16:9': '2848x1600',
  '9:16': '1600x2848',
  '3:2': '2496x1664',
  '2:3': '1664x2496',
  '21:9': '3136x1344',
}

function normalizedModelId(model: string): string {
  return model.toLowerCase().replace(/[_.]/g, '-')
}

export function seedreamCapabilities(model: string): SeedreamCapabilities {
  const id = normalizedModelId(model)
  if (/seedream-5-0-lite(?:-|$)/.test(id)) {
    return { family: '5.0-lite', maxReferenceImages: 14, supportsSequentialImages: true, supportsStreaming: true, supportsOutputFormat: true }
  }
  // The first Seedream 5.0 model IDs did not include the `pro` segment. They
  // have the same single-image API restrictions as the current 5.0 Pro IDs.
  if (/seedream-5-0(?:-pro)?(?:-|$)/.test(id)) {
    return { family: '5.0-pro', maxReferenceImages: 10, supportsSequentialImages: false, supportsStreaming: false, supportsOutputFormat: true }
  }
  if (/seedream-4-5(?:-|$)/.test(id)) {
    return { family: '4.5', maxReferenceImages: 14, supportsSequentialImages: true, supportsStreaming: true, supportsOutputFormat: false }
  }
  if (/seedream-4-0(?:-|$)/.test(id)) {
    return { family: '4.0', maxReferenceImages: 14, supportsSequentialImages: true, supportsStreaming: true, supportsOutputFormat: false }
  }
  // Endpoint IDs do not expose their backing model. Use the strictest common
  // request shape so that unknown endpoints do not receive model-only fields.
  return { family: 'unknown', maxReferenceImages: 10, supportsSequentialImages: false, supportsStreaming: false, supportsOutputFormat: false }
}

export function buildSeedreamRequest(input: {
  model: string
  prompt: string
  images?: string[]
  aspectRatio?: string
}): { body: SeedreamRequestBody; capabilities: SeedreamCapabilities; omittedUnsupportedParameters: string[] } {
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('Seedream 提示词不能为空')
  const images = input.images ?? []
  const capabilities = seedreamCapabilities(input.model)
  if (images.length > capabilities.maxReferenceImages) {
    throw new Error(`Seedream ${capabilities.family} 最多支持 ${capabilities.maxReferenceImages} 张参考图，当前为 ${images.length} 张`)
  }

  const sizeMap = capabilities.family === '5.0-pro' ? PRO_2K_SIZES : STANDARD_2K_SIZES
  const body: SeedreamRequestBody = {
    model: input.model,
    prompt,
    size: sizeMap[input.aspectRatio ?? '9:16'] ?? '2K',
    response_format: 'url',
    watermark: false,
  }
  if (images.length === 1) body.image = images[0]
  else if (images.length > 1) body.image = images
  if (capabilities.supportsSequentialImages) body.sequential_image_generation = 'disabled'

  const omittedUnsupportedParameters: string[] = []
  if (!capabilities.supportsSequentialImages) omittedUnsupportedParameters.push('sequential_image_generation', 'sequential_image_generation_options')
  if (!capabilities.supportsStreaming) omittedUnsupportedParameters.push('stream')
  if (!capabilities.supportsOutputFormat) omittedUnsupportedParameters.push('output_format')
  return { body, capabilities, omittedUnsupportedParameters }
}

export function extractSeedreamUrl(payload: SeedreamResponse): { url: string; item: SeedreamResponseItem } {
  const item = payload.data?.find((candidate) => typeof candidate.url === 'string' && candidate.url.length > 0)
  if (item?.url) return { url: item.url, item }

  const failures = (payload.data ?? [])
    .map((candidate) => candidate.error)
    .filter((error): error is NonNullable<SeedreamResponseItem['error']> => Boolean(error))
    .map((error) => [error.code, error.message].filter(Boolean).join(': '))
    .filter(Boolean)
  const topLevel = [payload.error?.code, payload.error?.message].filter(Boolean).join(': ')
  throw new Error(topLevel || failures.join('; ') || 'Seedream 没有返回图片地址')
}

export type SeedanceFamily = '2.0' | '2.0-fast' | '2.0-mini' | '1.5-pro' | '1.0-pro' | '1.0-pro-fast' | 'unknown'

export interface SeedanceCapabilities {
  family: SeedanceFamily
  minDurationSeconds: number
  maxDurationSeconds: number
  supportsSmartDuration: boolean
  supportsLastFrame: boolean
  supportsGenerateAudio: boolean
  defaultResolution: '1080p' | '720p'
}

export type SeedanceContent =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string }; role: 'first_frame' | 'last_frame' }

export interface SeedanceRequestBody {
  model: string
  content: SeedanceContent[]
  resolution: string
  ratio: '9:16'
  duration: number
  generate_audio?: boolean
  return_last_frame?: boolean
  watermark: boolean
}

export function seedanceCapabilities(model: string): SeedanceCapabilities {
  const id = normalizedModelId(model)
  if (/seedance-2-0-fast(?:-|$)/.test(id)) return { family: '2.0-fast', minDurationSeconds: 4, maxDurationSeconds: 15, supportsSmartDuration: true, supportsLastFrame: true, supportsGenerateAudio: true, defaultResolution: '1080p' }
  if (/seedance-2-0-mini(?:-|$)/.test(id)) return { family: '2.0-mini', minDurationSeconds: 4, maxDurationSeconds: 15, supportsSmartDuration: true, supportsLastFrame: true, supportsGenerateAudio: true, defaultResolution: '1080p' }
  if (/seedance-2-0(?:-|$)/.test(id)) return { family: '2.0', minDurationSeconds: 4, maxDurationSeconds: 15, supportsSmartDuration: true, supportsLastFrame: true, supportsGenerateAudio: true, defaultResolution: '1080p' }
  if (/seedance-1-5-pro(?:-|$)/.test(id)) return { family: '1.5-pro', minDurationSeconds: 4, maxDurationSeconds: 12, supportsSmartDuration: true, supportsLastFrame: true, supportsGenerateAudio: true, defaultResolution: '720p' }
  if (/seedance-1-0-pro-fast(?:-|$)/.test(id)) return { family: '1.0-pro-fast', minDurationSeconds: 2, maxDurationSeconds: 12, supportsSmartDuration: false, supportsLastFrame: false, supportsGenerateAudio: false, defaultResolution: '720p' }
  if (/seedance-1-0-pro(?:-|$)/.test(id)) return { family: '1.0-pro', minDurationSeconds: 2, maxDurationSeconds: 12, supportsSmartDuration: false, supportsLastFrame: true, supportsGenerateAudio: false, defaultResolution: '720p' }
  return { family: 'unknown', minDurationSeconds: 4, maxDurationSeconds: 12, supportsSmartDuration: false, supportsLastFrame: true, supportsGenerateAudio: false, defaultResolution: '720p' }
}

export function buildSeedanceRequest(input: {
  model: string
  prompt: string
  firstFrameUrl: string
  lastFrameUrl?: string
  durationSeconds?: number
  returnLastFrame?: boolean
  resolution?: string
}): { body: SeedanceRequestBody; capabilities: SeedanceCapabilities; requestedDuration: number; effectiveDuration: number; omittedUnsupportedParameters: string[] } {
  const prompt = input.prompt.trim()
  if (!prompt) throw new Error('Seedance 提示词不能为空')
  if (!input.firstFrameUrl) throw new Error('Seedance 图生视频需要首帧图片')
  const capabilities = seedanceCapabilities(input.model)
  if (input.lastFrameUrl && !capabilities.supportsLastFrame) {
    throw new Error(`Seedance ${capabilities.family} 不支持首尾帧模式`)
  }

  const requestedDuration = Math.round(input.durationSeconds ?? 5)
  const effectiveDuration = requestedDuration === -1 && capabilities.supportsSmartDuration
    ? -1
    : Math.min(capabilities.maxDurationSeconds, Math.max(capabilities.minDurationSeconds, requestedDuration))
  const content: SeedanceContent[] = [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: input.firstFrameUrl }, role: 'first_frame' },
  ]
  if (input.lastFrameUrl) content.push({ type: 'image_url', image_url: { url: input.lastFrameUrl }, role: 'last_frame' })
  const body: SeedanceRequestBody = {
    model: input.model,
    content,
    resolution: input.resolution ?? capabilities.defaultResolution,
    ratio: '9:16',
    duration: effectiveDuration,
    watermark: false,
  }
  if (capabilities.supportsGenerateAudio) body.generate_audio = false
  if (input.returnLastFrame) body.return_last_frame = true
  return {
    body,
    capabilities,
    requestedDuration,
    effectiveDuration,
    omittedUnsupportedParameters: capabilities.supportsGenerateAudio ? [] : ['generate_audio'],
  }
}

export const SEEDANCE_TASK_STATUSES = ['queued', 'running', 'cancelled', 'succeeded', 'failed', 'expired'] as const
export type SeedanceTaskStatus = typeof SEEDANCE_TASK_STATUSES[number]

export interface SeedanceTask {
  id: string
  model?: string
  status: SeedanceTaskStatus
  error?: { code?: string; message?: string } | null
  content?: { video_url?: string; last_frame_url?: string }
  usage?: { completion_tokens?: number; total_tokens?: number; tool_usage?: { web_search?: number } }
  created_at?: number
  updated_at?: number
  seed?: number
  resolution?: string
  ratio?: string
  duration?: number
  frames?: number
  framespersecond?: number
  generate_audio?: boolean
  draft?: boolean
  draft_task_id?: string
  service_tier?: string
  execution_expires_after?: number
  priority?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function parseSeedanceTask(payload: unknown, expectedId?: string): SeedanceTask {
  if (!isRecord(payload)) throw new Error('Seedance 查询响应不是有效对象')
  const id = typeof payload.id === 'string' && payload.id ? payload.id : expectedId
  if (!id) throw new Error('Seedance 查询响应缺少任务 ID')
  const status = typeof payload.status === 'string' ? payload.status.toLowerCase() : ''
  if (!(SEEDANCE_TASK_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Seedance 返回未知任务状态：${status || 'missing'}`)
  }
  const error = isRecord(payload.error)
    ? { code: typeof payload.error.code === 'string' ? payload.error.code : undefined, message: typeof payload.error.message === 'string' ? payload.error.message : undefined }
    : payload.error === null ? null : undefined
  const content = isRecord(payload.content)
    ? { video_url: typeof payload.content.video_url === 'string' ? payload.content.video_url : undefined, last_frame_url: typeof payload.content.last_frame_url === 'string' ? payload.content.last_frame_url : undefined }
    : undefined
  return { ...payload, id, status: status as SeedanceTaskStatus, error, content } as SeedanceTask
}

/** Seedance i2v rejects first frames that look like real people — including
 * photorealistic AI-generated faces (InputImageSensitiveContentDetected). */
export function isRealPersonRejection(code?: string, message?: string): boolean {
  return /InputImageSensitiveContentDetected/i.test(code ?? '')
    || /may contain real person/i.test(message ?? '')
}

export function realPersonFailureMessage(raw?: string): string {
  const requestId = raw?.match(/request id:\s*([^\s]+)/i)?.[1]
  return `Seedance 拒绝生成：首帧图片被判定为可能包含真实人物面孔（AI 生成的高写实面孔同样会触发）。请重做该镜头关键帧——电影剧照感、略带风格化的人像更容易通过审核${requestId ? `（Request ID：${requestId}）` : ''}`
}

export function seedanceFailureMessage(task: SeedanceTask): string {
  const detail = [task.error?.code, task.error?.message].filter(Boolean).join(': ')
  if (isRealPersonRejection(task.error?.code, task.error?.message)) return realPersonFailureMessage(task.error?.message)
  const copyrightViolation = /OutputVideoSensitiveContentDetected\.PolicyViolation/i.test(task.error?.code ?? '')
    || /copyright restrictions/i.test(task.error?.message ?? '')
  if (copyrightViolation) {
    const requestId = task.error?.message?.match(/request id:\s*([^\s]+)/i)?.[1]
    const diagnostic = [task.error?.code && `错误代码：${task.error.code}`, requestId && `Request ID：${requestId}`].filter(Boolean).join('；')
    return `Seedance 拒绝生成：输出视频可能涉及受版权保护的内容。请更换关键帧，并移除提示词中的影视、动漫或游戏角色、品牌 Logo、艺人姓名及特定作品风格后重试${diagnostic ? `（${diagnostic}）` : ''}`
  }
  const labels: Record<SeedanceTaskStatus, string> = {
    queued: '排队中', running: '运行中', cancelled: '已取消', succeeded: '已完成', failed: '失败', expired: '已超时',
  }
  return detail ? `Seedance 任务${labels[task.status]}：${detail}` : `Seedance 任务${labels[task.status]}`
}

export function isSeedancePolicyViolation(task: SeedanceTask): boolean {
  return isRealPersonRejection(task.error?.code, task.error?.message)
    || /PolicyViolation/i.test(task.error?.code ?? '')
    || /copyright restrictions/i.test(task.error?.message ?? '')
}
