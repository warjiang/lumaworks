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

export const episodePlanSchema = z.object({
  title: z.string().trim().min(1), summary: z.string().trim().min(1),
  shots: z.array(z.object({
    title: z.string().trim().min(1), description: z.string().trim().min(1),
    characters: z.array(z.string().trim().min(1)).max(8).default([]),
    location: z.string().trim().default(''),
    sceneType: z.enum(['daily', 'emotion', 'action', 'epic', 'suspense']).default('daily'),
    sourceText: z.string().trim().min(1),
    carryOver: z.string().trim().default(''),
    durationSeconds: z.number().int().min(4).max(12),
  })).min(8).max(16),
  dialogue: z.array(z.object({ speaker: z.string().trim().min(1), text: z.string().trim().min(1), shotPosition: z.number().int().positive(), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() })),
})

export const episodeDetailSchema = z.object({
  shots: z.array(z.object({
    title: z.string().trim().min(1), description: z.string().trim().min(1),
    shotType: z.string().trim().min(1), cameraMove: z.string().trim().min(1),
    imagePrompt: z.string().trim().min(1), videoPrompt: z.string().trim().min(1),
    actingNotes: z.string().trim().default(''),
    durationSeconds: z.number().int().min(4).max(12),
  })).min(8).max(16),
})

export const episodeScriptSchema = z.object({
  title: z.string().trim().min(1), summary: z.string().trim().min(1),
  shots: z.array(z.object({
    title: z.string().trim().min(1), description: z.string().trim().min(1), imagePrompt: z.string().trim().min(1), videoPrompt: z.string().trim().min(1), durationSeconds: z.number().int().min(4).max(12),
    characters: z.array(z.string().trim().min(1)).max(8).default([]),
    direction: z.object({
      sceneType: z.string().trim().default('daily'),
      shotType: z.string().trim().default(''),
      cameraMove: z.string().trim().default(''),
      location: z.string().trim().default(''),
      sourceText: z.string().trim().default(''),
      carryOver: z.string().trim().default(''),
      actingNotes: z.string().trim().default(''),
    }).default({}),
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

export const EPISODE_PLAN_JSON_CONTRACT = `{
  "title": "本集标题，非空字符串",
  "summary": "本集摘要，非空字符串",
  "shots": [
    {
      "title": "镜头标题，非空字符串",
      "description": "画面描述：焦点层（主要人物动作）+ 在场层（其他在场人物位置状态）+ 环境层（场景氛围）",
      "characters": ["出场角色姓名，与故事圣经完全一致，无出场则为空数组"],
      "location": "场景名，与故事圣经场景一致",
      "sceneType": "daily/emotion/action/epic/suspense 之一",
      "sourceText": "该镜头对应的剧情原文片段，非空字符串",
      "carryOver": "上一镜头结束时的定格状态（角色姿态、位置、朝向、动作终态）；首镜或跨场景硬切为空字符串",
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

export const EPISODE_DETAIL_JSON_CONTRACT = `{
  "shots": [
    {
      "title": "镜头标题，与输入一致",
      "description": "画面描述，可微调但核心不变",
      "shotType": "视角+景别，如 平视中景 / 越肩近景 / 仰拍全景",
      "cameraMove": "一种运镜：缓推/缓拉/跟随/环绕/固定/手持跟随/急推",
      "imagePrompt": "视频首帧静态画面提示词：风格锚点 + 角色完整外观 + 场景 + 景深 + 灯光色调",
      "videoPrompt": "视频动作提示词：人物动作 + 镜头运动 + 说话状态，年龄段+性别替代姓名",
      "actingNotes": "每个出场角色一句可视化表演指令（表情+肢体+微动作）",
      "durationSeconds": 5
    }
  ]
}`

export const episodeReviewSchema = z.object({
  grade: z.enum(['A', 'B', 'C', 'D']),
  problems: z.array(z.object({
    shotPosition: z.number().int().positive().optional(),
    rule: z.string().trim().min(1),
    issue: z.string().trim().min(1),
    fix: z.string().trim().min(1),
  })).default([]),
})

export const EPISODE_REVIEW_JSON_CONTRACT = `{
  "grade": "A 可直接使用 / B 小问题可用 / C 需较大修改 / D 建议重做",
  "problems": [
    {
      "shotPosition": 1,
      "rule": "被违反的红线名称",
      "issue": "具体问题描述",
      "fix": "具体修复建议"
    }
  ]
}`

export function episodeReviewPrompt(input: { storyBible: string; scriptJson: string }): string {
  return `你是短剧分镜的审校责编。只提出问题和修复建议，不做创作。对照故事圣经，按红线清单逐项审查下面的分镜剧本 JSON。
故事圣经：${input.storyBible}
分镜剧本：${input.scriptJson}

【红线清单——逐条审查，违反即记为问题】
R1 人物存续：角色进入场景后，没有明确离场动作不得凭空消失；全景/中景中在场角色必须有位置或状态交代。
R2 对话拆分：dialogue 中每句台词的 shotPosition 必须指向一个包含该说话者的镜头；对话镜头必须是单人说话。
R3 时长合理：台词按每秒约4个汉字必须能在所属镜头时长内说完；纯氛围镜头不得超过6秒；每镜4-12秒。
R4 动作桥梁：除首镜和跨场景硬切外，每个镜头的 carryOver 必须非空且准确描述上一镜的定格状态；相邻镜头不得"冻结-跳转"。
R5 可视化：description/actingNotes 中不得出现抽象情绪词（如"尴尬""悲伤""紧张"），必须是可见表现。
R6 一致性：每个 imagePrompt 必须以同一风格锚点开头，且包含出场角色的完整外观描述；同一角色各镜外观逐字一致。
R7 运动词汇：每个 videoPrompt 必须同时包含人物动作和镜头运动；特写镜头必须"固定镜头"；有台词的镜头必须写"正在说话"。
R8 原创性：不得出现真实艺人、现有影视/动漫/游戏角色、品牌或特定作品风格。

【评级标准】A=无问题可直接使用；B=仅轻微问题（单镜措辞）可用；C=存在结构问题（人物消失、台词错位、时长错误）需较大修改；D=多镜违反红线建议重做。
只返回一个 JSON 对象，必须严格使用下面的英文键名和层级；problems 按严重程度从高到低排列，只列真实违反红线的项，没有则为空数组；不得返回解释或 Markdown：
${EPISODE_REVIEW_JSON_CONTRACT}`
}

export function episodeRevisionPrompt(input: { storyBible: string; scriptJson: string; problemsJson: string }): string {
  return `你是短剧分镜修订师。下面的分镜剧本在审校中被发现违反红线。按问题清单逐条修复，输出修复后的完整剧本。
故事圣经：${input.storyBible}
审校问题清单：${input.problemsJson}
待修复剧本：${input.scriptJson}

【修复规则】
1. 逐条修复问题清单中的每一项，不得遗漏；修复方式以问题中的 fix 建议为准，但不局限于建议。
2. 保留未出问题镜头的全部内容，不得改写或删除。
3. 修复后必须满足全部红线：人物存续、对话拆分、台词时长（每秒约4字）、动作桥梁（carryOver 非空且准确）、可视化描述、风格与角色锚点逐字一致、videoPrompt 必须包含人物动作与镜头运动（特写固定镜头、说话镜头写"正在说话"）、原创性。
4. shots 数量保持 8-16 个；dialogue 的 shotPosition 必须指向包含说话者的镜头；每个 shot 保留 title/description/imagePrompt/videoPrompt/durationSeconds/characters/direction 全部字段，direction 内 sceneType/shotType/cameraMove/location/sourceText/carryOver/actingNotes 不得丢失。
5. 数字必须是 JSON number；只返回修复后的完整 JSON 对象，不得返回解释或 Markdown。`
}

const GRID_CELL_POSITIONS = ['左上', '右上', '左下', '右下'] as const

export function shotGridImagePrompt(input: { shots: Array<{ imagePrompt: string }>; referenceCount: number }): string {
  const cells = input.shots.map((shot, index) => `格${index + 1}（${GRID_CELL_POSITIONS[index] ?? ''}）：${shot.imagePrompt}`).join('\n')
  return `一张 2x2 宫格布局的竖屏短剧关键帧合图：exactly 4 visible panels arranged in a uniform 2x2 grid，四格等分、边界清晰，consistent art style，真人电影质感。
${input.referenceCount ? `随附 ${input.referenceCount} 张参考图（参考图1至参考图${input.referenceCount}）为本剧角色定妆照，对应角色必须与参考图的面部特征、发型、服饰完全一致，不得换脸或改变造型。\n` : ''}${cells}
要求：四格共享统一的光线方向、色调与质感；每格独立成画，呈现该镜头动作即将发生的起始瞬间，静态构图清晰；no merged panels, no missing panels；画面禁止任何文字、编号、水印、Logo；原创人物面孔，不模仿任何真实艺人或现有影视角色。`
}

export function episodePlanPrompt(input: { storyBible: string; episodeNumber: number }): string {
  return `你是资深竖屏短剧分镜规划师。仅根据下面这份已经完成原创审校的故事圣经，把第${input.episodeNumber}集拆解为连续的电影镜头。不要补充、猜测或引用任何项目原始标题和来源材料。
原创故事圣经：${input.storyBible}

【核心原则——必须逐条遵守】
1. 镜头密度：聚焦关键动作与情绪点，全集8-16个镜头，总时长60-90秒，每镜4-12秒。第一镜头必须在3秒内建立钩子，最后镜头必须留下悬念。
2. 对话拆分：每段对话至少2个镜头——说话者镜头（聚焦说话者脸部，其他角色只能在背景中虚化）+ 听者反应镜头。禁止一个镜头中多人同时说话。
3. 人物存续：角色进入场景后，在没有明确离场动作之前必须持续在场；全景/中景中所有在场角色都要交代位置或状态，禁止人物凭空消失。
4. 动作桥梁（动作连贯铁律）：每个镜头的结尾必须停在动作的"起始态"，下一镜头从该动作的"进行时"承接，禁止"冻结-跳转"。错误示例：上镜结尾"他握紧剑柄"→下镜开头"他已刺出长剑"；正确示例：上镜结尾"他猛地握住剑柄，指节泛白"→下镜开头"利剑锵一声出鞘"。carryOver 字段用一句话写清上一镜头结束时的定格状态（角色姿态、位置、朝向、动作终态）；第一个镜头为空字符串，跨场景硬切时也为空字符串。
5. 空间关系：明确谁面对谁、谁挡在谁前、前后左右位置；同一场景内角色朝向保持一致，不跳轴；任何角色位置或朝向的改变都必须有明确的移动动作交代。
6. 只写可视化内容：禁止主观情绪词（"尴尬""充满敌意""格格不入"），改写为可见表现（"皱眉""攥紧拳头""瞪大眼睛"）。
7. 台词时长：dialogue 台词按正常语速每秒约4个汉字估算，必须能在所属镜头时长内说完；情绪激动的台词语速更快，悲伤的更慢。
8. 景别多样：相邻镜头避免完全相同的景别与内容；同场景镜头循序渐进（远→中→近或近→中→远）。
9. 所有视觉描述必须保持原创，不得出现现有影视、动漫或游戏角色、品牌 Logo、艺人姓名、艺术家姓名或特定作品风格。

【每个镜头必须包含】title、description（按焦点层/在场层/环境层三层书写）、characters（与故事圣经角色名完全一致）、location（与故事圣经场景一致）、sceneType、sourceText（必填）、carryOver、durationSeconds（对话镜头按台词长度留足时间，纯氛围镜头不超过6秒）。

只返回一个 JSON 对象，必须严格使用下面的英文键名和层级，shots 和 dialogue 中的每一个对象都必须包含示例列出的全部字段。数字必须是 JSON number，不得写成字符串；不得省略字段，不得返回解释或 Markdown：
${EPISODE_PLAN_JSON_CONTRACT}`
}

export function episodeDetailPrompt(input: { storyBible: string; planJson: string }): string {
  return `你是电影摄影指导兼表演指导。下面是一集竖屏短剧的故事圣经和分镜规划 JSON。为每个镜头补充摄影与视频生成细节。
故事圣经：${input.storyBible}
分镜规划：${input.planJson}

【每个镜头必须补充的字段】
1. shotType：视角+景别（如"平视中景""越肩近景""仰拍全景""荷兰角近景"）。
2. cameraMove：一个镜头只用一种运镜（缓推/缓拉/跟随/环绕/固定/手持跟随/急推）。
3. imagePrompt（视频首帧静态画面提示词，必须符合全部规则）：
   - 首帧原则：呈现动作"即将发生的起始瞬间"（如"剑已举至头顶，即将劈下的瞬间"），而非动作完成态；静态构图清晰。
   - 风格锚点：以故事圣经 visualDirection 的第一句开头，逐字复用不得改写。
   - 角色锚点：每个出场角色原样重复故事圣经 appearance 的完整外观描述（年龄、脸型、发型、服装、辨识物），同一角色在所有镜头中逐字一致，不得改写、省略或换形象。
   - 景深：全景深景深清晰展现空间，中景中等景深，近景浅景深背景虚化，特写极浅景深；对话镜头必须浅景深，只让说话者脸部清晰，背景人物必须虚化。
   - 灯光与色调：写明光源方向和整体色调，同场景保持一致。
   - 禁止任何文字、水印、Logo。
4. videoPrompt（视频动作提示词，必须"动起来"，禁止纯静态描述）：
   - 必须同时包含人物动作（转头/点头/抬手/起身/走近/皱眉/嘴角上扬等具体动作）和镜头运动（缓缓推近/轻轻跟随/微微摇晃/缓慢环绕/手持跟随）。
   - 特写镜头必须写"固定镜头"，禁止运镜（避免暴露画外内容）。
   - 有台词的镜头明确写"正在说话"。
   - 角色用年龄段+性别（少年/少女/年轻男子/年轻女子/中年男子/中年女子/老年男子/老年女子）替代姓名。
   - 一镜一运镜；动作幅度与 sceneType 匹配（daily 微动作、emotion 细腻渐进、action 爆发有力、epic 缓慢庄重、suspense 紧绷警觉）。
5. actingNotes：每个出场角色一句可视化表演指令（表情+肢体+微动作+视线），前后镜头情绪有合理递进，禁止抽象情绪词。
6. durationSeconds：保持规划值；仅当台词明显超时才能上调，最多12秒。

【输出要求】shots 数量和顺序必须与输入完全一致；title/description 可微调但核心不变。只返回一个 JSON 对象，必须严格使用下面的英文键名和层级，每个对象都必须包含示例列出的全部字段。数字必须是 JSON number；不得省略字段，不得返回解释或 Markdown：
${EPISODE_DETAIL_JSON_CONTRACT}`
}

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
  return episodePlanPrompt(input)
}
