import type { Platform } from '@shared/domain'
import type { SecretStore } from '../security/secrets'
import type { PublisherAdapter } from './types'
import { TikTokPublisher } from './tiktok'
import { XiaohongshuPublisher } from './xiaohongshu'
import { YouTubePublisher } from './youtube'

export class PublisherRegistry {
  private readonly adapters: Map<Platform, PublisherAdapter>
  constructor(secrets: SecretStore, diagnosticsDir: string) {
    const list: PublisherAdapter[] = [new XiaohongshuPublisher(diagnosticsDir), new TikTokPublisher(secrets), new YouTubePublisher(secrets)]
    this.adapters = new Map(list.map((adapter) => [adapter.platform, adapter]))
  }
  get(platform: Platform): PublisherAdapter {
    const adapter = this.adapters.get(platform); if (!adapter) throw new Error(`不支持的投稿平台: ${platform}`)
    return adapter
  }
}
