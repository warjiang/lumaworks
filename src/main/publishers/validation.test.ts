import { describe, expect, it } from 'vitest'
import { TikTokPublisher } from './tiktok'
import { YouTubePublisher } from './youtube'
import type { PublishDraft } from '@shared/domain'

const secrets = { has: () => false, get: () => null } as never
const draft: PublishDraft = { id: 'draft', renderId: 'render', platform: 'youtube', title: 'A'.repeat(101), description: '', tags: [], coverPath: null, scheduledAt: null, visibility: 'public', approved: true }

describe('publisher validation', () => {
  it('checks YouTube account and title constraints', async () => {
    const errors = await new YouTubePublisher(secrets).validate(draft, { videoPath: '/tmp/video.mp4', coverPath: null })
    expect(errors).toContain('YouTube 尚未连接')
    expect(errors).toContain('YouTube 标题不能超过 100 字符')
  })

  it('checks TikTok account requirements', async () => {
    const errors = await new TikTokPublisher(secrets).validate({ ...draft, platform: 'tiktok', title: 'Short' }, { videoPath: '/tmp/video.mp4', coverPath: null })
    expect(errors).toContain('TikTok 尚未连接')
  })
})
