import { describe, expect, it } from 'vitest'
import { episodeScriptPrompt, episodeScriptSchema, storyBibleSchema, storyCharactersPrompt, storyEpisodesPrompt, storyFoundationPrompt, storyLocationsPrompt } from './prompts'

describe('pipeline schemas', () => {
  it('accepts a complete story bible', () => {
    expect(storyBibleSchema.parse({
      world: '当代上海', visualDirection: '冷峻写实', logline: '新娘在婚礼前发现另一个自己。',
      characters: [{ name: '林澈', role: '主角', appearance: '短发，黑色风衣', personality: '克制', voice: '低沉' }],
      locations: [{ name: '旧公寓', description: '狭窄走廊', visualPrompt: '冷色顶灯，潮湿墙面' }],
      episodes: [{ number: 1, titlessa: '错误', title: '门外的人', summary: '陌生人敲门', hook: '猫眼里是自己', cliffhanger: '门从里面打开' }],
    }).episodes).toHaveLength(1)
  })

  it('rejects scripts with fewer than eight shots', () => {
    expect(() => episodeScriptSchema.parse({ title: '测试', summary: '测试', shots: [], dialogue: [] })).toThrow()
  })

  it('splits the story bible into narrow generation contracts', () => {
    const source = { title: '来源标题', synopsis: '来源内容', visualStyle: 'cinematic' }
    const foundation = storyFoundationPrompt(source)
    const context = { title: source.title, synopsis: source.synopsis, foundation: { world: '原创世界', logline: '原创冲突' } }
    expect(foundation).toContain('"world"')
    expect(foundation).not.toContain('"characters"')
    expect(storyCharactersPrompt(context)).toContain('"characters"')
    expect(storyLocationsPrompt(context)).toContain('"locations"')
    expect(storyEpisodesPrompt(context)).toContain('"episodes"')
  })

  it('spells out the complete shot and dialogue contracts', () => {
    const prompt = episodeScriptPrompt({ storyBible: '{"logline":"原创故事"}', episodeNumber: 1 })
    for (const field of ['title', 'summary', 'shots', 'description', 'imagePrompt', 'videoPrompt', 'durationSeconds', 'dialogue', 'speaker', 'text', 'shotPosition', 'startMs', 'endMs']) {
      expect(prompt).toContain(`"${field}"`)
    }
    expect(prompt).toContain('数字必须是 JSON number')
    expect(prompt).toContain('所有视觉描述必须保持原创')
    expect(prompt).not.toContain('原始梗概')
  })
})
