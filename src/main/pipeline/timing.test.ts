import { describe, expect, it } from 'vitest'
import type { Shot, VoiceLine } from '@shared/domain'
import { buildClipTimeline, planDialogue, timingFingerprint } from './timing'

const shots = [1, 2].map((position) => ({ id: `shot-${position}`, episodeId: 'episode', position, title: '', description: '', imagePrompt: '', videoPrompt: '', durationSeconds: 5, status: 'video-ready', imagePath: null, videoPath: `clip-${position}.mp4`, updatedAt: 'now' })) as Shot[]
const lines = [
  { id: 'line-1', episodeId: 'episode', shotId: null, shotPosition: 1, locale: 'zh-CN', position: 1, speaker: '甲', text: '第一句话', spokenText: '第一句话', originalStartMs: 0, originalEndMs: 2_000, startMs: 0, endMs: 2_000, voiceId: null, audioPath: null, audioDurationMs: null, planVersion: null },
  { id: 'line-2', episodeId: 'episode', shotId: null, shotPosition: 2, locale: 'zh-CN', position: 2, speaker: '乙', text: '第二句话', spokenText: '第二句话', originalStartMs: 5_000, originalEndMs: 7_000, startMs: 5_000, endMs: 7_000, voiceId: null, audioPath: null, audioDurationMs: null, planVersion: null },
] as VoiceLine[]

describe('dialogue timing', () => {
  it('builds a timeline from measured clip durations and keeps every line inside its shot', () => {
    const clips = buildClipTimeline(shots, [5_040, 6_040]); const plan = planDialogue(lines, clips, 'zh-CN')
    expect(clips.at(-1)?.endMs).toBe(11_080)
    expect(plan[0].startMs).toBeGreaterThanOrEqual(clips[0].startMs)
    expect(plan[0].endMs).toBeLessThanOrEqual(clips[0].endMs)
    expect(plan[1].startMs).toBeGreaterThanOrEqual(clips[1].startMs)
    expect(plan[1].endMs).toBeLessThanOrEqual(clips[1].endMs)
  })

  it('changes the plan fingerprint when a video revision changes', () => {
    const first = timingFingerprint(shots, lines, 'zh-CN')
    expect(timingFingerprint([{ ...shots[0], updatedAt: 'later' }, shots[1]], lines, 'zh-CN')).not.toBe(first)
  })
})
