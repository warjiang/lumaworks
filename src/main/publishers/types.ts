import type { Platform, PublishDraft } from '@shared/domain'

export interface PublishMedia {
  videoPath: string
  coverPath: string | null
}

export interface PublishResult { externalId: string; status: 'processing' | 'published'; url?: string }
export interface PublishStatus { status: 'processing' | 'published' | 'failed'; url?: string; error?: string }

export interface PublisherAdapter {
  readonly platform: Platform
  connect(): Promise<{ connected: boolean; message: string }>
  validate(draft: PublishDraft, media: PublishMedia): Promise<string[]>
  publish(draft: PublishDraft, media: PublishMedia): Promise<PublishResult>
  status(externalId: string): Promise<PublishStatus>
  cancel?(externalId: string): Promise<void>
}
