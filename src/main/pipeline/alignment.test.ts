import { describe, expect, it } from 'vitest'
import { alignChunksToWords, buildTimedChunks } from './alignment'

const sentence = (words: Array<[string, number, number]>) => ({ text: words.map((word) => word[0]).join(''), words: words.map(([word, startMs, endMs]) => ({ word, startMs, endMs })) })

describe('alignChunksToWords', () => {
  it('walks words sequentially and assigns each chunk its real time window', () => {
    const words = sentence([
      ['家', 0, 200], ['里', 200, 400], ['花', 400, 650], ['了', 650, 800], ['代', 800, 1000], ['价', 1000, 1200], ['保', 1200, 1400], ['你', 1400, 1600], ['出', 1600, 1800], ['来', 1800, 2000], ['。', 2000, 2100],
      ['条', 2300, 2500], ['件', 2500, 2700], ['是', 2700, 2900], ['嫁', 2900, 3200], ['入', 3200, 3400], ['裴', 3400, 3600], ['家', 3600, 3800], ['。', 3800, 3900],
    ])
    const aligned = alignChunksToWords(['家里花了代价保你出来。', '条件是嫁入裴家。'], [words])
    expect(aligned).toEqual([{ startMs: 0, endMs: 2100 }, { startMs: 2300, endMs: 3900 }])
  })

  it('ignores ASS line-join markers when measuring chunk length', () => {
    const words = sentence([['你', 0, 300], ['好', 300, 600], ['，', 600, 700], ['再', 900, 1200], ['见', 1200, 1500], ['。', 1500, 1600]])
    const aligned = alignChunksToWords(['你好，\\N再见。'], [words])
    expect(aligned).toEqual([{ startMs: 0, endMs: 1600 }])
  })

  it('returns null when the word stream is missing or far too short', () => {
    expect(alignChunksToWords(['第一句话'], [])).toBeNull()
    const words = sentence([['第', 0, 200]])
    expect(alignChunksToWords(['第一句话', '第二句话', '第三句话', '第四句话', '第五句话', '第六句话'], [words])).toBeNull()
  })
})

describe('buildTimedChunks', () => {
  const sentences = [
    sentence([['你', 100, 400], ['好', 400, 700], ['。', 700, 800]]),
    sentence([['再', 1000, 1300], ['见', 1300, 1600], ['。', 1600, 1700]]),
  ]

  it('offsets word times onto the line window and clamps to the line end', () => {
    const chunks = buildTimedChunks({ chunks: ['你好。', '再见。'], sentences, wordScale: 1, lineStartMs: 5_000, lineEndMs: 6_700, rawAudioMs: 1_800 })
    expect(chunks).toEqual([
      { text: '你好。', startMs: 5_100, endMs: 5_800 },
      { text: '再见。', startMs: 6_000, endMs: 6_700 },
    ])
  })

  it('scales word times when the audio was tempo-calibrated', () => {
    const chunks = buildTimedChunks({ chunks: ['你好。', '再见。'], sentences, wordScale: 0.5, lineStartMs: 0, lineEndMs: 900, rawAudioMs: 1_800 })
    expect(chunks?.[0]).toEqual({ text: '你好。', startMs: 50, endMs: 400 })
    expect(chunks?.[1]).toEqual({ text: '再见。', startMs: 500, endMs: 850 })
  })

  it('rejects word timelines that cannot belong to the raw audio', () => {
    expect(buildTimedChunks({ chunks: ['你好。'], sentences, wordScale: 1, lineStartMs: 0, lineEndMs: 2_000, rawAudioMs: 200 })).toBeNull()
    expect(buildTimedChunks({ chunks: ['你好。'], sentences: undefined, wordScale: 1, lineStartMs: 0, lineEndMs: 2_000, rawAudioMs: 1_800 })).toBeNull()
  })
})
