import { createReadStream, statSync } from 'node:fs'
import type { PublishDraft } from '@shared/domain'
import type { SecretStore } from '../security/secrets'
import type { PublisherAdapter, PublishMedia, PublishResult, PublishStatus } from './types'

export class YouTubePublisher implements PublisherAdapter {
  readonly platform = 'youtube' as const
  constructor(private readonly secrets: SecretStore) {}

  async connect(): Promise<{ connected: boolean; message: string }> {
    return this.secrets.has('youtubeAccessToken') ? { connected: true, message: 'YouTube 已连接' } : { connected: false, message: '请在设置中完成 Google OAuth' }
  }

  async validate(draft: PublishDraft, media: PublishMedia): Promise<string[]> {
    const errors: string[] = []
    if (!this.secrets.has('youtubeAccessToken')) errors.push('YouTube 尚未连接')
    if (!media.videoPath) errors.push('缺少视频文件')
    if (draft.title.length > 100) errors.push('YouTube 标题不能超过 100 字符')
    if (draft.description.length > 5000) errors.push('YouTube 简介不能超过 5000 字符')
    return errors
  }

  async publish(draft: PublishDraft, media: PublishMedia): Promise<PublishResult> {
    const errors = await this.validate(draft, media); if (errors.length) throw new Error(errors.join('；'))
    const token = this.secrets.get('youtubeAccessToken')!; const size = statSync(media.videoPath).size
    const metadata = { snippet: { title: draft.title, description: `${draft.description}\n${draft.tags.map((tag) => `#${tag}`).join(' ')}`.trim(), tags: draft.tags, categoryId: '24' }, status: { privacyStatus: draft.scheduledAt ? 'private' : draft.visibility, publishAt: draft.scheduledAt ?? undefined, selfDeclaredMadeForKids: false } }
    const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Length': String(size), 'X-Upload-Content-Type': 'video/mp4' }, body: JSON.stringify(metadata) })
    const location = start.headers.get('location'); if (!start.ok || !location) throw new Error(`YouTube 初始化上传失败: HTTP ${start.status}`)
    const upload = await fetch(location, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size) }, body: createReadStream(media.videoPath) as unknown as BodyInit, duplex: 'half' } as RequestInit & { duplex: string })
    const body = await upload.json() as { id?: string; error?: { message?: string } }
    if (!upload.ok || !body.id) throw new Error(body.error?.message ?? 'YouTube 上传失败')
    return { externalId: body.id, status: draft.scheduledAt ? 'processing' : 'published', url: `https://youtu.be/${body.id}` }
  }

  async status(externalId: string): Promise<PublishStatus> {
    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=status&id=${encodeURIComponent(externalId)}`, { headers: { Authorization: `Bearer ${this.secrets.get('youtubeAccessToken')}` } })
    const body = await response.json() as { items?: Array<{ status?: { uploadStatus?: string } }> }
    const state = body.items?.[0]?.status?.uploadStatus
    if (state === 'processed') return { status: 'published', url: `https://youtu.be/${externalId}` }
    if (state === 'failed' || state === 'rejected') return { status: 'failed', error: state }
    return { status: 'processing' }
  }
}
