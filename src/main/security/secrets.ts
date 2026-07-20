import { safeStorage } from 'electron'
import type { AppDatabase } from '../db/database'

const SECRET_KEYS = new Set(['arkApiKey', 'speechApiKey', 'speechAccessToken', 'tiktokClientSecret', 'youtubeClientSecret', 'tiktokAccessToken', 'youtubeAccessToken', 'youtubeRefreshToken'])

export class SecretStore {
  constructor(private readonly db: AppDatabase) {}

  set(key: string, value: string): void {
    const secret = SECRET_KEYS.has(key)
    if (secret && value) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用')
      this.db.upsertSetting(key, safeStorage.encryptString(value).toString('base64'), true)
    } else this.db.upsertSetting(key, value, false)
  }

  get(key: string): string | null {
    const record = this.db.getSetting(key)
    if (!record) return null
    if (!record.encrypted) return record.value
    try { return safeStorage.decryptString(Buffer.from(record.value, 'base64')) } catch { return null }
  }

  has(key: string): boolean { return Boolean(this.get(key)) }
}
