import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

export class MediaStore {
  constructor(readonly root: string) {}

  projectDir(projectId: string): string { return join(this.root, 'projects', projectId) }

  async download(projectId: string, kind: string, url: string, options: { signal?: AbortSignal; onProgress?: (received: number, total?: number) => void } = {}): Promise<string> {
    const response = await fetch(url, { signal: options.signal })
    if (!response.ok) throw new Error(`素材下载失败: HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') ?? ''
    const ext = contentType.includes('video') ? '.mp4' : contentType.includes('png') ? '.png' : contentType.includes('audio') ? '.mp3' : '.jpg'
    const directory = join(this.projectDir(projectId), kind); await mkdir(directory, { recursive: true })
    const totalHeader = response.headers.get('content-length'); const total = totalHeader ? Number(totalHeader) : undefined
    const chunks: Uint8Array[] = []; let received = 0
    if (!response.body) throw new Error('素材下载响应没有数据流')
    const reader = response.body.getReader()
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      if (value?.length) { chunks.push(value); received += value.length; options.onProgress?.(received, total) }
    }
    const temp = join(directory, `${randomUUID()}.tmp`); const bytes = Buffer.concat(chunks.map((item) => Buffer.from(item)))
    await writeFile(temp, bytes)
    const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 24); const path = join(directory, `${digest}${ext}`)
    await rename(temp, path).catch(async () => { await writeFile(path, bytes) })
    return path
  }

  async dataUrl(path: string): Promise<string> {
    const ext = extname(path).toLowerCase(); const mime = ext === '.png' ? 'image/png' : ext === '.mp4' ? 'video/mp4' : 'image/jpeg'
    return `data:${mime};base64,${(await readFile(path)).toString('base64')}`
  }
}
