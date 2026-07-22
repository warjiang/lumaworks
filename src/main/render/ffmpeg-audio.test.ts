import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FfmpegRenderer } from './ffmpeg'

const ff = '/opt/homebrew/bin/ffmpeg'

function makeFixtures(dir: string): { withAudio: string; silent: string; voice: string } {
  const withAudio = join(dir, 'clip-with-audio.mp4'); const silent = join(dir, 'clip-silent.mp4'); const voice = join(dir, 'voice.mp3')
  execFileSync(ff, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=540x960:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', withAudio])
  execFileSync(ff, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=540x960:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', silent])
  execFileSync(ff, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=3', '-c:a', 'libmp3lame', voice])
  return { withAudio, silent, voice }
}

describe('renderer ambient audio', () => {
  it('keeps Seedance ambience under the voice mix even when some clips are silent', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lw-render-audio-'))
    const { withAudio, silent, voice } = makeFixtures(dir)
    const renderer = new FfmpegRenderer()
    expect(await renderer.probeHasAudio(withAudio)).toBe(true)
    expect(await renderer.probeHasAudio(silent)).toBe(false)
    const result = await renderer.render({
      outputDir: join(dir, 'out'),
      clips: [withAudio, silent],
      voiceTracks: [{ path: voice, startMs: 1000 }],
      lines: [{ text: '测试字幕', startMs: 500, endMs: 2500 }],
      locale: 'zh-CN',
      durationMs: 4000,
    })
    expect(await renderer.probeHasAudio(result.videoPath)).toBe(true)
    expect(await renderer.probeHasAudio(result.masterPath)).toBe(true)
    const durationMs = await renderer.probeDuration(result.videoPath)
    expect(Math.abs(durationMs - 4000)).toBeLessThan(500)
  }, 120_000)

  it('renders audible output without any voice tracks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lw-render-bed-'))
    const { withAudio, silent } = makeFixtures(dir)
    const renderer = new FfmpegRenderer()
    const result = await renderer.render({
      outputDir: join(dir, 'out'),
      clips: [withAudio, silent],
      voiceTracks: [],
      lines: [],
      locale: 'zh-CN',
      durationMs: 4000,
    })
    expect(await renderer.probeHasAudio(result.videoPath)).toBe(true)
  }, 120_000)
})
