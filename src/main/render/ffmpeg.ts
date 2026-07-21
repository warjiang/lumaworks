import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import ffmpegPath from 'ffmpeg-static'

function srtTime(ms: number): string {
  const total = Math.max(0, Math.round(ms)); const hours = Math.floor(total / 3_600_000); const minutes = Math.floor((total % 3_600_000) / 60_000)
  const seconds = Math.floor((total % 60_000) / 1000); const millis = total % 1000
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':') + `,${String(millis).padStart(3, '0')}`
}

function assTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 10)); const hours = Math.floor(total / 360_000); const minutes = Math.floor((total % 360_000) / 6_000)
  const seconds = Math.floor((total % 6_000) / 100); const centis = total % 100
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`
}

export function buildSrt(lines: Array<{ text: string; startMs: number; endMs: number }>): string {
  return lines.map((line, index) => `${index + 1}\n${srtTime(line.startMs)} --> ${srtTime(Math.max(line.startMs + 300, line.endMs))}\n${line.text.trim()}\n`).join('\n')
}

export function chunksForSubtitle(text: string, locale: 'zh-CN' | 'en-US'): string[] {
  const clean = text.trim().replace(/\s+/g, locale === 'zh-CN' ? '' : ' ')
  if (!clean) return []
  if (locale === 'en-US') {
    const words = clean.split(' '); const lines: string[] = []; let current = ''
    for (const word of words) {
      if (`${current} ${word}`.trim().length > 28 && current) { lines.push(current); current = word } else current = `${current} ${word}`.trim()
    }
    if (current) lines.push(current)
    return Array.from({ length: Math.ceil(lines.length / 2) }, (_, index) => lines.slice(index * 2, index * 2 + 2).join('\\N'))
  }
  const chars = [...clean]; const lines: string[] = []
  while (chars.length) {
    let take = Math.min(14, chars.length)
    const candidate = chars.slice(0, take).join(''); const punctuation = Math.max(candidate.lastIndexOf('，'), candidate.lastIndexOf('。'), candidate.lastIndexOf('！'), candidate.lastIndexOf('？'))
    if (punctuation >= 7 && chars.length > take) take = punctuation + 1
    lines.push(chars.splice(0, take).join(''))
  }
  return Array.from({ length: Math.ceil(lines.length / 2) }, (_, index) => lines.slice(index * 2, index * 2 + 2).join('\\N'))
}

function assEscape(value: string): string { return value.replaceAll('\\', '\\').replaceAll('{', '\\{').replaceAll('}', '\\}') }

export interface AssLineInput { text: string; startMs: number; endMs: number; chunks?: Array<{ text: string; startMs: number; endMs: number }> }

export function buildAss(lines: AssLineInput[], locale: 'zh-CN' | 'en-US'): string {
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding\nStyle: Default,PingFang SC,54,&H00F4F3EF,&H00F4F3EF,&H0015171A,&H900A0B0D,-1,0,0,0,100,100,0,0,3,3,0,2,96,96,200,1\n\n[Events]\nFormat: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text\n`
  const events: string[] = []
  for (const line of lines) {
    if (line.chunks?.length) {
      for (const chunk of line.chunks) {
        events.push(`Dialogue: 0,${assTime(chunk.startMs)},${assTime(Math.max(chunk.startMs + 200, chunk.endMs))},Default,,0,0,0,,${assEscape(chunk.text)}`)
      }
      continue
    }
    const chunks = chunksForSubtitle(line.text, locale); const duration = Math.max(300, line.endMs - line.startMs)
    const weights = chunks.map((chunk) => Math.max(1, [...chunk.replace(/\\N/g, '').replace(/\s/g, '')].length))
    const total = weights.reduce((sum, value) => sum + value, 0)
    let cursor = line.startMs
    chunks.forEach((chunk, index) => {
      const end = index === chunks.length - 1 ? line.startMs + duration : cursor + Math.round(duration * weights[index] / total)
      events.push(`Dialogue: 0,${assTime(cursor)},${assTime(end)},Default,,0,0,0,,${assEscape(chunk)}`)
      cursor = end
    })
  }
  return header + events.join('\n') + '\n'
}

function concatEscape(path: string): string { return path.replaceAll("'", "'\\''") }
function filterEscape(path: string): string { return path.replaceAll('\\', '\\\\').replaceAll(':', '\\:').replaceAll("'", "\\'") }

export class FfmpegRenderer {
  private readonly binary = ffmpegPath || 'ffmpeg'

  async probeDuration(path: string, signal?: AbortSignal): Promise<number> {
    const output = await this.capture(['-hide_banner', '-i', path], signal, true)
    const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
    if (!match) throw new Error(`无法读取媒体时长: ${path}`)
    return Math.round((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000)
  }

  /**
   * Slice a grid storyboard image into per-shot cells with the crop filter.
   * Cells are returned in reading order (left-to-right, top-to-bottom).
   */
  async sliceGrid(imagePath: string, rows: number, cols: number, outputDir: string, signal?: AbortSignal): Promise<string[]> {
    if (rows < 1 || cols < 1) throw new Error('宫格行列必须为正数')
    await mkdir(outputDir, { recursive: true })
    const ext = extname(imagePath) || '.jpg'
    const cells: string[] = []
    for (let index = 0; index < rows * cols; index++) {
      const col = index % cols; const row = Math.floor(index / cols)
      const outputPath = join(outputDir, `cell-${index + 1}${ext}`)
      await this.run(['-y', '-i', imagePath, '-vf', `crop=w=iw/${cols}:h=ih/${rows}:x=iw/${cols}*${col}:y=ih/${rows}*${row}`, '-frames:v', '1', outputPath], signal)
      cells.push(outputPath)
    }
    return cells
  }

  async calibrateAudio(inputPath: string, outputPath: string, targetMs: number, signal?: AbortSignal): Promise<number> {
    const actualMs = await this.probeDuration(inputPath, signal); const tempo = actualMs / Math.max(1, targetMs)
    if (tempo <= 1.005) return actualMs
    if (tempo > 1.2) throw new Error(`语音需要 ${tempo.toFixed(2)} 倍加速，超过 1.20 倍上限`)
    await this.run(['-y', '-i', inputPath, '-filter:a', `atempo=${tempo.toFixed(5)}`, '-c:a', 'libmp3lame', '-b:a', '128k', outputPath], signal)
    return this.probeDuration(outputPath, signal)
  }

  async render(input: {
    outputDir: string
    clips: string[]
    voiceTracks: Array<{ path: string; startMs: number }>
    lines: AssLineInput[]
    locale: 'zh-CN' | 'en-US'
    durationMs: number
    signal?: AbortSignal
    onProgress?: (progress: number) => void
    onStage?: (phase: string, message: string, details?: Record<string, unknown>) => void
  }): Promise<{ masterPath: string; videoPath: string; subtitlePath: string; coverPath: string }> {
    if (!input.clips.length) throw new Error('没有可渲染的视频镜头')
    await mkdir(input.outputDir, { recursive: true })
    const concatPath = join(input.outputDir, 'clips.txt'); const subtitlePath = join(input.outputDir, 'captions.ass')
    const masterPath = join(input.outputDir, 'master.mp4'); const voicedPath = join(input.outputDir, 'voiced.mp4')
    const videoPath = join(input.outputDir, 'final.mp4'); const coverPath = join(input.outputDir, 'cover.jpg'); const durationSeconds = (input.durationMs / 1000).toFixed(3)
    await Promise.all([writeFile(concatPath, input.clips.map((path) => `file '${concatEscape(path)}'`).join('\n')), writeFile(subtitlePath, buildAss(input.lines, input.locale))])
    input.onStage?.('render.video', '正在拼接并编码镜头', { clips: input.clips.length, durationMs: input.durationMs })
    await this.run(['-y', '-f', 'concat', '-safe', '0', '-i', concatPath, '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,format=yuv420p', '-t', durationSeconds, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-an', masterPath], input.signal, (ratio) => input.onProgress?.(ratio * 50))
    let source = masterPath
    if (input.voiceTracks.length) {
      input.onStage?.('render.audio', '正在按最终时间轴混合角色配音', { tracks: input.voiceTracks.length })
      const audioInputs = input.voiceTracks.flatMap((track) => ['-i', track.path])
      const delayed = input.voiceTracks.map((track, index) => `[${index + 1}:a]adelay=${Math.max(0, track.startMs)}|${Math.max(0, track.startMs)}[a${index}]`)
      const mixInputs = input.voiceTracks.map((_track, index) => `[a${index}]`).join('')
      const filter = `${delayed.join(';')};${mixInputs}amix=inputs=${input.voiceTracks.length}:duration=longest:normalize=0,apad,atrim=0:${durationSeconds}[voice]`
      await this.run(['-y', '-i', masterPath, ...audioInputs, '-filter_complex', filter, '-map', '0:v:0', '-map', '[voice]', '-t', durationSeconds, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', voicedPath], input.signal, (ratio) => input.onProgress?.(50 + ratio * 20))
      source = voicedPath
    } else input.onProgress?.(70)
    input.onStage?.('render.subtitles', '正在烧录安全区字幕', { subtitlePath })
    await this.run(['-y', '-i', source, '-vf', `ass='${filterEscape(subtitlePath)}'`, '-t', durationSeconds, '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', ...(input.voiceTracks.length ? ['-c:a', 'copy'] : ['-an']), videoPath], input.signal, (ratio) => input.onProgress?.(70 + ratio * 25))
    input.onStage?.('render.cover', '正在提取封面')
    await this.run(['-y', '-ss', '00:00:01', '-i', videoPath, '-frames:v', '1', '-q:v', '2', coverPath], input.signal)
    input.onProgress?.(100)
    return { masterPath, videoPath, subtitlePath, coverPath }
  }

  private async capture(args: string[], signal?: AbortSignal, acceptFailure = false): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const child = spawn(this.binary, args, { stdio: ['ignore', 'ignore', 'pipe'] }); let stderr = ''
      const onAbort = (): void => { child.kill('SIGTERM') }; signal?.addEventListener('abort', onAbort, { once: true })
      child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk: string) => { stderr += chunk })
      child.once('error', reject); child.once('close', (code) => { signal?.removeEventListener('abort', onAbort); if (signal?.aborted) reject(Object.assign(new Error('FFmpeg 已取消'), { name: 'AbortError' })); else if (code === 0 || acceptFailure) resolve(stderr); else reject(new Error(`FFmpeg 执行失败: ${stderr.slice(-1200)}`)) })
    })
  }

  private async run(args: string[], signal?: AbortSignal, onTimeline?: (ratio: number) => void): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(this.binary, ['-progress', 'pipe:2', '-nostats', ...args], { stdio: ['ignore', 'ignore', 'pipe'] }); let stderr = ''; let durationMs = 0
      const onAbort = (): void => { child.kill('SIGTERM') }; signal?.addEventListener('abort', onAbort, { once: true }); child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-20_000); const duration = chunk.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/); if (duration) durationMs = (Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000; for (const match of chunk.matchAll(/out_time_ms=(\d+)/g)) if (durationMs > 0) onTimeline?.(Math.max(0, Math.min(1, Number(match[1]) / 1000 / durationMs))) })
      child.once('error', (error) => { signal?.removeEventListener('abort', onAbort); reject(error) }); child.once('close', (code) => { signal?.removeEventListener('abort', onAbort); if (signal?.aborted) { const error = new Error('FFmpeg 渲染已取消'); error.name = 'AbortError'; reject(error) } else if (code === 0) { onTimeline?.(1); resolve() } else reject(new Error(`FFmpeg 执行失败: ${stderr.slice(-1200)}`)) })
    })
  }
}
