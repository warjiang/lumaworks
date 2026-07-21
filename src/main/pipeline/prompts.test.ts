import { describe, expect, it } from 'vitest'
import { episodeDetailPrompt, episodePlanPrompt, episodeReviewPrompt, episodeScriptSchema, shotGridImagePrompt, storyBibleSchema, storyCharactersPrompt, storyEpisodesPrompt, storyFoundationPrompt, storyLocationsPrompt } from './prompts'

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

  it('spells out the plan contract with continuity rules', () => {
    const prompt = episodePlanPrompt({ storyBible: '{"logline":"原创故事"}', episodeNumber: 1 })
    for (const field of ['title', 'summary', 'shots', 'description', 'characters', 'location', 'sceneType', 'sourceText', 'carryOver', 'durationSeconds', 'dialogue', 'speaker', 'text', 'shotPosition', 'startMs', 'endMs']) {
      expect(prompt).toContain(`"${field}"`)
    }
    expect(prompt).toContain('数字必须是 JSON number')
    expect(prompt).toContain('所有视觉描述必须保持原创')
    expect(prompt).toContain('动作桥梁')
    expect(prompt).toContain('人物存续')
    expect(prompt).not.toContain('原始梗概')
  })

  it('spells out the detail contract with motion vocabulary rules', () => {
    const prompt = episodeDetailPrompt({ storyBible: '{}', planJson: '[]' })
    for (const field of ['shots', 'title', 'description', 'shotType', 'cameraMove', 'imagePrompt', 'videoPrompt', 'actingNotes', 'durationSeconds']) {
      expect(prompt).toContain(`"${field}"`)
    }
    expect(prompt).toContain('正在说话')
    expect(prompt).toContain('固定镜头')
    expect(prompt).toContain('首帧')
    expect(prompt).toContain('数字必须是 JSON number')
  })

  it('spells out the review contract with red lines', () => {
    const prompt = episodeReviewPrompt({ storyBible: '{}', scriptJson: '{}' })
    for (const rule of ['人物存续', '对话拆分', '时长合理', '动作桥梁', '可视化', '一致性', '运动词汇', '原创性']) {
      expect(prompt).toContain(rule)
    }
    expect(prompt).toContain('"grade"')
    expect(prompt).toContain('"problems"')
  })

  it('builds a 2x2 grid prompt with exactly four labeled cells and reference binding', () => {
    const prompt = shotGridImagePrompt({ shots: [{ imagePrompt: '镜头一画面' }, { imagePrompt: '镜头二画面' }, { imagePrompt: '镜头三画面' }, { imagePrompt: '镜头四画面' }], referenceCount: 2 })
    expect(prompt).toContain('exactly 4 visible panels')
    expect(prompt).toContain('no merged panels, no missing panels')
    expect(prompt).toContain('参考图1至参考图2')
    for (const cell of ['格1（左上）：镜头一画面', '格2（右上）：镜头二画面', '格3（左下）：镜头三画面', '格4（右下）：镜头四画面']) {
      expect(prompt).toContain(cell)
    }
  })
})
