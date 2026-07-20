import type { VoicePresetId } from './domain'

export interface VoicePreset {
  id: VoicePresetId
  label: string
  description: string
  zhVoiceId: string
  enVoiceId: string
}

export const VOICE_PRESETS: VoicePreset[] = [
  { id: 'narrator', label: '旁白', description: '稳定、清晰、中性叙事', zhVoiceId: 'zh_female_vv_uranus_bigtts', enVoiceId: 'en_female_dacey_uranus_bigtts' },
  { id: 'young-female', label: '青年女声', description: '自然、克制、年轻', zhVoiceId: 'zh_female_vv_uranus_bigtts', enVoiceId: 'en_female_dacey_uranus_bigtts' },
  { id: 'mature-female', label: '成熟女声', description: '沉稳、有阅历', zhVoiceId: 'zh_female_wanwanxiaohe_moon_bigtts', enVoiceId: 'en_female_sarah_mars_bigtts' },
  { id: 'young-male', label: '青年男声', description: '清朗、自然、年轻', zhVoiceId: 'zh_male_yangguangqingnian_moon_bigtts', enVoiceId: 'en_male_corey_mars_bigtts' },
  { id: 'mature-male', label: '成熟男声', description: '低沉、稳重、有控制力', zhVoiceId: 'zh_male_beijingxiaoye_moon_bigtts', enVoiceId: 'en_male_adam_mars_bigtts' },
  { id: 'elder-male', label: '老年男声', description: '苍劲、缓慢、有威严', zhVoiceId: 'zh_male_jieshuoxiaoming_moon_bigtts', enVoiceId: 'en_male_adam_mars_bigtts' },
  { id: 'elder-female', label: '老年女声', description: '温厚、缓慢、有年龄感', zhVoiceId: 'zh_female_wanwanxiaohe_moon_bigtts', enVoiceId: 'en_female_sarah_mars_bigtts' },
  { id: 'cold-villain', label: '冷峻反派', description: '冷静、压迫、低饱和情绪', zhVoiceId: 'zh_male_beijingxiaoye_moon_bigtts', enVoiceId: 'en_male_corey_mars_bigtts' },
]

export function voicePreset(id: VoicePresetId): VoicePreset {
  return VOICE_PRESETS.find((item) => item.id === id) ?? VOICE_PRESETS[0]
}

export function inferVoicePreset(input: { name: string; role: string; description: string; voiceDescription: string }, used: Set<VoicePresetId> = new Set()): VoicePresetId {
  const value = `${input.name} ${input.role} ${input.description} ${input.voiceDescription}`
  if (/旁白|解说|narrator/i.test(value)) return 'narrator'
  if (/反派|阴冷|冷峻|狠厉|压迫|villain/i.test(value)) return 'cold-villain'
  const elder = /([6-9]\d)岁|老年|老人|长辈|爷爷|奶奶|祖父|祖母|苍老|年迈/i.test(value)
  const mature = /([4-5]\d)岁|中年|成熟|母亲|父亲|叔|姨|掌权|沉稳/i.test(value)
  const female = /女|母亲|妻|姐姐|妹妹|夫人|female/i.test(value)
  const candidates: VoicePresetId[] = elder
    ? [female ? 'elder-female' : 'elder-male']
    : mature ? [female ? 'mature-female' : 'mature-male']
      : [female ? 'young-female' : 'young-male']
  const chosen = candidates[0]
  if (!used.has(chosen)) return chosen
  if (chosen === 'young-male') return 'mature-male'
  if (chosen === 'young-female') return 'mature-female'
  return chosen
}
