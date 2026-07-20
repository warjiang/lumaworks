import { z } from 'zod'

export const storyBibleSchema = z.object({
  world: z.string().trim().min(1), visualDirection: z.string().trim().min(1), logline: z.string().trim().min(1),
  characters: z.array(z.object({ name: z.string().trim().min(1), role: z.string().trim().min(1), appearance: z.string().trim().min(1), personality: z.string().trim().min(1), voice: z.string().trim().min(1) })).min(1).max(8),
  locations: z.array(z.object({ name: z.string().trim().min(1), description: z.string().trim().min(1), visualPrompt: z.string().trim().min(1) })).min(1).max(12),
  episodes: z.array(z.object({ number: z.number().int().positive(), title: z.string().trim().min(1), summary: z.string().trim().min(1), hook: z.string().trim().min(1), cliffhanger: z.string().trim().min(1) })).min(1).max(20),
})

export const storyFoundationSchema = storyBibleSchema.pick({ world: true, visualDirection: true, logline: true })
export const storyCharactersSchema = storyBibleSchema.pick({ characters: true })
export const storyLocationsSchema = storyBibleSchema.pick({ locations: true })
export const storyEpisodesSchema = storyBibleSchema.pick({ episodes: true })

export const episodeScriptSchema = z.object({
  title: z.string().trim().min(1), summary: z.string().trim().min(1),
  shots: z.array(z.object({
    title: z.string().trim().min(1), description: z.string().trim().min(1), imagePrompt: z.string().trim().min(1), videoPrompt: z.string().trim().min(1), durationSeconds: z.number().int().min(4).max(8),
  })).min(8).max(16),
  dialogue: z.array(z.object({ speaker: z.string().trim().min(1), text: z.string().trim().min(1), shotPosition: z.number().int().positive(), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() })),
})

export const STORY_BIBLE_JSON_CONTRACT = `{
  "world": "故事发生的时代、城市、社会规则和氛围，非空字符串",
  "visualDirection": "统一的真人影视视觉基调、色彩、光线和摄影语言，非空字符串",
  "logline": "一句话核心故事，非空字符串",
  "characters": [
    {
      "name": "角色姓名，非空字符串",
      "role": "主角/反派/盟友等剧情职能，非空字符串",
      "appearance": "年龄、性别呈现、脸型、发型、服装、体态和辨识物，非空字符串",
      "personality": "性格、欲望、弱点和人物弧光，非空字符串",
      "voice": "音色、年龄感、语速、口音和表演风格，非空字符串"
    }
  ],
  "locations": [
    {
      "name": "场景名称，非空字符串",
      "description": "空间用途及剧情意义，非空字符串",
      "visualPrompt": "供图像模型复用的空间、陈设、材质、色彩和灯光描述，非空字符串"
    }
  ],
  "episodes": [
    {
      "number": 1,
      "title": "分集标题，非空字符串",
      "summary": "本集完整剧情摘要，非空字符串",
      "hook": "前三秒视觉钩子，非空字符串",
      "cliffhanger": "结尾悬念，非空字符串"
    }
  ]
}`

export const EPISODE_SCRIPT_JSON_CONTRACT = `{
  "title": "本集标题，非空字符串",
  "summary": "本集摘要，非空字符串",
  "shots": [
    {
      "title": "镜头标题，非空字符串",
      "description": "剧情和表演内容，非空字符串",
      "imagePrompt": "静态构图、角色外观、场景、灯光和9:16摄影描述，非空字符串",
      "videoPrompt": "动作、表演、摄影机和物理变化，非空字符串",
      "durationSeconds": 5
    }
  ],
  "dialogue": [
    {
      "speaker": "角色姓名，非空字符串",
      "text": "可直接配音的台词，非空字符串",
      "shotPosition": 1,
      "startMs": 0,
      "endMs": 2500
    }
  ]
}`

const ORIGINALITY_RULES = `只保留来源材料的宽泛题材、抽象主题和一般性情绪；不得换名复刻。不得复用来源标题、角色名、地点、组织、台词、标志性设定、独特情节组合或场景顺序。不得模仿艺人、现有角色、品牌、艺术家或特定作品风格。`

export function storyFoundationPrompt(input: { title: string; synopsis: string; visualStyle: string }): string {
  return `为原创竖屏真人短剧设计一个精炼的故事基底。\n来源标题：${input.title}\n来源材料：${input.synopsis}\n期望视觉方向：${input.visualStyle}\n${ORIGINALITY_RULES}\n必须重建故事世界、核心冲突成因和视觉语言。只返回：{"world":"原创世界与社会规则","visualDirection":"原创真人影视视觉基调","logline":"原创的一句话核心故事"}`
}

export function storyCharactersPrompt(input: { title: string; synopsis: string; foundation: unknown }): string {
  return `为下面的原创故事基底设计1-8名角色。\n来源标题：${input.title}\n来源材料：${input.synopsis}\n原创故事基底：${JSON.stringify(input.foundation)}\n${ORIGINALITY_RULES}\n全部姓名、职业、关系网络、欲望、弱点、人物弧光和视觉身份必须重新设计。只返回：{"characters":[{"name":"原创姓名","role":"剧情职能","appearance":"年龄、脸型、发型、服装、体态和原创辨识物","personality":"性格、欲望、弱点和人物弧光","voice":"音色、语速、口音和表演风格"}]}`
}

export function storyLocationsPrompt(input: { title: string; synopsis: string; foundation: unknown }): string {
  return `为下面的原创故事基底设计1-12个可制作场景。\n来源标题：${input.title}\n来源材料：${input.synopsis}\n原创故事基底：${JSON.stringify(input.foundation)}\n${ORIGINALITY_RULES}\n地点、空间用途、陈设、材质、色彩、灯光和剧情功能必须重新设计。只返回：{"locations":[{"name":"原创场景名","description":"空间用途及剧情意义","visualPrompt":"供图像模型复用的原创空间视觉描述"}]}`
}

export function storyEpisodesPrompt(input: { title: string; synopsis: string; foundation: unknown }): string {
  return `为下面的原创故事基底设计1-20集竖屏短剧大纲。\n来源标题：${input.title}\n来源材料：${input.synopsis}\n原创故事基底：${JSON.stringify(input.foundation)}\n${ORIGINALITY_RULES}\n必须重建事件因果链、反转机制、场景顺序和结局；每集60-90秒，前三秒有钩子，结尾有悬念。只返回：{"episodes":[{"number":1,"title":"原创分集标题","summary":"原创完整剧情摘要","hook":"前三秒视觉钩子","cliffhanger":"结尾悬念"}]}`
}

export function episodeScriptPrompt(input: { storyBible: string; episodeNumber: number }): string {
  return `仅根据下面这份已经完成原创审校的故事圣经，编写第${input.episodeNumber}集竖屏真人短剧可制作剧本。不要补充、猜测或引用任何项目原始标题和来源材料。
原创故事圣经：${input.storyBible}

生成8-16个镜头，总时长60-90秒，每个镜头4-8秒。第一镜头必须在3秒内建立钩子，最后镜头必须留下悬念。imagePrompt描述静态构图、角色外观、场景、灯光和9:16镜头；videoPrompt只描述动作、表演、摄影机和物理变化。所有视觉描述必须保持原创，不得出现现有影视、动漫或游戏角色、品牌 Logo、艺人姓名、艺术家姓名或特定作品风格。dialogue提供可直接配音的台词及估算毫秒时间轴，并用 shotPosition 明确台词所属镜头。台词应简洁，正常语速必须能在对应镜头时长内完整说完。

只返回一个 JSON 对象，必须严格使用下面的英文键名和层级，shots 和 dialogue 中的每一个对象都必须包含示例列出的全部字段。数字必须是 JSON number，不得写成字符串；不得省略字段，不得返回解释或 Markdown：
${EPISODE_SCRIPT_JSON_CONTRACT}`
}
