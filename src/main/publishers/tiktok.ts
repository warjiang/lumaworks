import { createReadStream, statSync } from 'node:fs'
import type { SecretStore } from '../security/secrets'
import type { PublisherAdapter, PublishMedia, PublishResult, PublishStatus } from './types'
import type { PublishDraft } from '@shared/domain'

const API = 'https://open.tiktokapis.com/v2'

export class TikTokPublisher implements PublisherAdapter {
  readonly platform = 'tiktok' as const
  constructor(private readonly secrets: SecretStore) {}

  async connect(): Promise<{ connected: boolean; message: string }> {
    return this.secrets.has('tiktokAccessToken')
      ? { connected: true, message: 'TikTok Access Token 已配置' }
      : { connected: false, message: '请在设置中完成 TikTok OAuth 或填入 Access Token' }
  }

  async validate(draft: PublishDraft, media: PublishMedia): Promise<string[]> {
    const errors: string[] = []
    if (!this.secrets.has('tiktokAccessToken')) errors.push('TikTok 尚未连接')
    if (!media.videoPath) errors.push('缺少视频文件')
    if (draft.description.length > 2200) errors.push('TikTok 文案不能超过 2200 字符')
    return errors
  }

  async publish(draft: PublishDraft, media: PublishMedia): Promise<PublishResult> {
    const errors = await this.validate(draft, media); if (errors.length) throw new Error(errors.join('；'))
    const token = this.secrets.get('tiktokAccessToken')!; const size = statSync(media.videoPath).size
    const init = await fetch(`${API}/post/publish/video/init/`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify({ post_info: { title: `${draft.description}\n${draft.tags.map((tag) => `#${tag}`).join(' ')}`.trim(), privacy_level: draft.visibility === 'public' ? 'PUBLIC_TO_EVERYONE' : 'SELF_ONLY', disable_duet: false, disable_comment: false, disable_stitch: false }, source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: size, total_chunk_count: 1 } }),
    })
    const body = await init.json() as { data?: { publish_id?: string; upload_url?: string }; error?: { message?: string } }
    if (!init.ok || !body.data?.publish_id || !body.data.upload_url) throw new Error(body.error?.message ?? 'TikTok 初始化上传失败')
    const upload = await fetch(body.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Content-Range': `bytes 0-${size - 1}/${size}` }, body: createReadStream(media.videoPath) as unknown as BodyInit, duplex: 'half' } as RequestInit & { duplex: string })
    if (!upload.ok) throw new Error(`TikTok 视频上传失败: HTTP ${upload.status}`)
    return { externalId: body.data.publish_id, status: 'processing' }
  }

  async status(externalId: string): Promise<PublishStatus> {
    const response = await fetch(`${API}/post/publish/status/fetch/`, { method: 'POST', headers: { Authorization: `Bearer ${this.secrets.get('tiktokAccessToken')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ publish_id: externalId }) })
    const body = await response.json() as { data?: { status?: string; publicaly_available_post_id?: string[]; fail_reason?: string } }
    const state = body.data?.status
    if (state === 'PUBLISH_COMPLETE') return { status: 'published', url: body.data?.publicaly_available_post_id?.[0] }
    if (state === 'FAILED') return { status: 'failed', error: body.data?.fail_reason }
    return { status: 'processing' }
  }
}
