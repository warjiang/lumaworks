import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import { buildAss, buildSrt, FfmpegRenderer } from './ffmpeg'

const run = promisify(execFile)

describe('buildSrt', () => {
  it('creates stable subtitle timestamps and guards zero-length lines', () => {
    expect(buildSrt([
      { text: '别开门。', startMs: 0, endMs: 1_250 },
      { text: 'I know you are inside.', startMs: 61_001, endMs: 61_001 },
    ])).toBe('1\n00:00:00,000 --> 00:00:01,250\n别开门。\n\n2\n00:01:01,001 --> 00:01:01,301\nI know you are inside.\n')
  })
})

describe('buildAss', () => {
  it('uses a 1080x1920 safe area and splits long Chinese subtitles into at most two visual lines per event', () => {
    const ass = buildAss([{ text: '家里花了代价保你出来。条件是嫁入裴家，给裴衍舟冲喜。他昏迷不醒，你是冲喜新娘。', startMs: 500, endMs: 7_500 }], 'zh-CN')
    expect(ass).toContain('PlayResX: 1080')
    expect(ass).toContain('PlayResY: 1920')
    expect(ass).toContain(',96,96,200,1')
    const events = ass.split('\n').filter((line) => line.startsWith('Dialogue:'))
    expect(events.length).toBeGreaterThan(1)
    expect(events.every((line) => (line.match(/\\N/g) ?? []).length <= 1)).toBe(true)
  })
})

describe('FfmpegRenderer', () => {
  it('keeps the measured video duration when the voice track is shorter', { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'lumaworks-render-')); const ffmpeg = ffmpegPath || 'ffmpeg'
    try {
      const clipA = join(root, 'a.mp4'); const clipB = join(root, 'b.mp4'); const voice = join(root, 'voice.mp3')
      await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=160x284:d=0.5:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipA])
      await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=160x284:d=0.5:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clipB])
      await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.2', '-c:a', 'libmp3lame', voice])
      const renderer = new FfmpegRenderer(); const result = await renderer.render({ outputDir: join(root, 'out'), clips: [clipA, clipB], voiceTracks: [{ path: voice, startMs: 0 }], lines: [{ text: '完整字幕不会截断视频', startMs: 0, endMs: 500 }], locale: 'zh-CN', durationMs: 1_000 })
      expect(Math.abs(await renderer.probeDuration(result.videoPath) - 1_000)).toBeLessThanOrEqual(40)
      expect(await readFile(result.subtitlePath, 'utf8')).toContain('PlayResY: 1920')
    } finally { await rm(root, { recursive: true, force: true }) }
  })
})
