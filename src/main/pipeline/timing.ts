import { createHash } from 'node:crypto'
import type { ContentLocale, Shot, VoiceLine } from '@shared/domain'

export interface ClipTiming { shotId: string; position: number; startMs: number; endMs: number; durationMs: number }

export function timingFingerprint(shots: Shot[], lines: VoiceLine[], locale: ContentLocale): string {
  return createHash('sha256').update(JSON.stringify({ locale, shots: shots.map((shot) => [shot.id, shot.videoPath, shot.updatedAt]), lines: lines.map((line) => [line.id, line.text, line.speaker, line.originalStartMs, line.originalEndMs]) })).digest('hex').slice(0, 24)
}

export function buildClipTimeline(shots: Shot[], durations: number[]): ClipTiming[] {
  let cursor = 0
  return shots.map((shot, index) => {
    const durationMs = Math.max(1, Math.round(durations[index] ?? shot.durationSeconds * 1000))
    const item = { shotId: shot.id, position: shot.position, startMs: cursor, endMs: cursor + durationMs, durationMs }
    cursor += durationMs
    return item
  })
}

function estimateSpeechMs(text: string, locale: ContentLocale): number {
  if (locale === 'en-US') return Math.max(700, Math.round(text.trim().split(/\s+/).length / 2.7 * 1000 + 300))
  return Math.max(700, Math.round([...text.replace(/\s/g, '')].length / 4.2 * 1000 + 260))
}

export function planDialogue(lines: VoiceLine[], clips: ClipTiming[], locale: ContentLocale): Array<{ id: string; shotId: string; shotPosition: number; startMs: number; endMs: number }> {
  if (!clips.length) return []
  const inferred = lines.map((line) => {
    const midpoint = ((line.originalStartMs ?? line.startMs) + (line.originalEndMs ?? line.endMs)) / 2
    const clip = clips.find((item) => midpoint >= item.startMs && midpoint < item.endMs) ?? clips.at(-1)!
    const explicit = clips.find((item) => item.shotId === line.shotId || item.position === line.shotPosition)
    return { line, clip: explicit ?? clip }
  })
  const result: Array<{ id: string; shotId: string; shotPosition: number; startMs: number; endMs: number }> = []
  for (const clip of clips) {
    const group = inferred.filter((item) => item.clip.shotId === clip.shotId).map((item) => item.line)
    if (!group.length) continue
    const gap = 160; const padding = 260; const available = clip.durationMs - padding * 2 - gap * Math.max(0, group.length - 1)
    if (available < group.length * 300) throw new Error(`镜头 ${clip.position} 的台词数量过多，无法在视频时长内安排`)
    const estimates = group.map((line) => estimateSpeechMs(line.text, locale)); const total = estimates.reduce((sum, value) => sum + value, 0); const flexible = available - group.length * 300
    let cursor = clip.startMs + padding
    group.forEach((line, index) => {
      const endMs = index === group.length - 1 ? clip.endMs - padding : cursor + 300 + Math.round(flexible * estimates[index] / Math.max(1, total))
      result.push({ id: line.id, shotId: clip.shotId, shotPosition: clip.position, startMs: cursor, endMs })
      cursor = endMs + gap
    })
  }
  return result.sort((a, b) => lines.findIndex((line) => line.id === a.id) - lines.findIndex((line) => line.id === b.id))
}
