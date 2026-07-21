import type { SpeechSentenceTiming } from '../providers/types'

export interface AlignedChunk { text: string; startMs: number; endMs: number }

function plainLength(text: string): number {
  return [...text.replace(/\\N/g, '').replace(/\s/g, '')].length
}

/**
 * Map sequential subtitle chunks onto TTS word timings with a two-pointer walk.
 * Chunks are exact sequential partitions of the spoken text and words cover the
 * same text in order, so each chunk consumes words until its length is covered.
 * Returns null when the word stream cannot plausibly cover the chunks.
 */
export function alignChunksToWords(chunks: string[], sentences: SpeechSentenceTiming[]): Array<{ startMs: number; endMs: number }> | null {
  const words = sentences
    .flatMap((sentence) => sentence.words)
    .map((word) => ({ startMs: word.startMs, endMs: word.endMs, length: plainLength(word.word) }))
    .filter((word) => word.length > 0)
  if (!chunks.length || !words.length) return null
  const timings: Array<{ startMs: number; endMs: number }> = []
  let cursor = 0
  for (const chunk of chunks) {
    const need = plainLength(chunk)
    if (!need || cursor >= words.length) return null
    const startMs = words[cursor].startMs
    let covered = 0
    let endMs = startMs
    while (covered < need && cursor < words.length) {
      covered += words[cursor].length
      endMs = Math.max(endMs, words[cursor].endMs)
      cursor++
    }
    timings.push({ startMs, endMs })
  }
  if (words.length - cursor > Math.max(2, words.length * 0.2)) return null
  return timings
}

/**
 * Build absolute-timed subtitle chunks for a voiced line. `wordScale` converts
 * raw-audio word times onto the calibrated (atempo-adjusted) audio timeline.
 * Returns null when word timings are unavailable or implausible, letting the
 * renderer fall back to proportional chunk timing.
 */
export function buildTimedChunks(input: {
  chunks: string[]
  sentences: SpeechSentenceTiming[] | undefined
  wordScale: number
  lineStartMs: number
  lineEndMs: number
  rawAudioMs: number
}): AlignedChunk[] | null {
  if (!input.sentences?.length) return null
  const lastWordEndMs = Math.max(...input.sentences.flatMap((sentence) => sentence.words).map((word) => word.endMs), 0)
  if (input.rawAudioMs > 0 && lastWordEndMs > input.rawAudioMs * 1.25 + 500) return null
  const scaled = input.sentences.map((sentence) => ({
    text: sentence.text,
    words: sentence.words.map((word) => ({ word: word.word, startMs: Math.round(word.startMs * input.wordScale), endMs: Math.round(word.endMs * input.wordScale) })),
  }))
  const aligned = alignChunksToWords(input.chunks, scaled)
  if (!aligned) return null
  return input.chunks.map((text, index) => {
    const startMs = Math.max(input.lineStartMs, input.lineStartMs + aligned[index].startMs)
    const endMs = Math.min(input.lineEndMs, input.lineStartMs + aligned[index].endMs)
    return { text, startMs, endMs: Math.max(startMs + 200, endMs) }
  })
}
