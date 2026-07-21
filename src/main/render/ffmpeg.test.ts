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

  it('burns explicit speech-aligned chunk timings instead of splitting the line window', () => {
    const ass = buildAss([{
      text: '别开门。先听我说。', startMs: 1_000, endMs: 5_000,
      chunks: [
        { text: '别开门。', startMs: 1_200, endMs: 2_100 },
        { text: '先听我说。', startMs: 3_400, endMs: 4_800 },
      ],
    }], 'zh-CN')
    const events = ass.split('\n').filter((line) => line.startsWith('Dialogue:'))
    expect(events).toHaveLength(2)
    expect(events[0]).toContain('0:00:01.20,0:00:02.10')
    expect(events[1]).toContain('0:00:03.40,0:00:04.80')
  })

  it('weights fallback chunk windows by character count instead of splitting evenly', () => {
    // 30 chars split into 14/14/2 lines → chunks of 28 and 2 chars; an even
    // split would give 2000/2000, the weighted split gives ~3733/267.
    const ass = buildAss([{ text: '嗯。接下来的这句话必须足够长才能切成三行从而验证按字分配时间', startMs: 0, endMs: 4_000 }], 'zh-CN')
    const events = ass.split('\n').filter((line) => line.startsWith('Dialogue:'))
    expect(events).toHaveLength(2)
    expect(events[0]).toContain('0:00:00.00,0:00:03.73')
    expect(events[1]).toContain('0:00:03.73,0:00:04.00')
  })
})

describe('FfmpegRenderer', () => {
  it('slices a 2x2 grid image into four equal 9:16 cells', { timeout: 30_000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'lumaworks-grid-')); const ffmpeg = ffmpegPath || 'ffmpeg'
    try {
      const gridPath = join(root, 'grid.png')
      await run(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x568:d=0.1:r=1', '-frames:v', '1', gridPath])
      const cells = await new FfmpegRenderer().sliceGrid(gridPath, 2, 2, join(root, 'cells'))
      expect(cells).toHaveLength(4)
      for (const cell of cells) {
        const { stdout, stderr } = await run(ffmpeg, ['-hide_banner', '-i', cell]).catch((error: { stdout: string; stderr: string }) => ({ stdout: error.stdout ?? '', stderr: error.stderr ?? '' }))
        expect(`${stdout}${stderr}`).toContain('160x284')
      }
    } finally { await rm(root, { recursive: true, force: true }) }
  })

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
