import type { VoicePresetId } from './domain'

const LEGACY_TTS1_VOICE_PATTERN = /_((emo_v2_)?(moon|mars)|conversation_wvae)_bigtts$/i

/** Retired 豆包语音合成 1.0 voices (moon/mars/emo_v2/wvae). They require the
 * separately-provisioned seed-tts-1.0 service and lack subtitle timestamps,
 * so LumaWorks migrates away from them everywhere. */
export function isLegacyTts1Voice(voiceId: string | null | undefined): boolean {
  return Boolean(voiceId) && LEGACY_TTS1_VOICE_PATTERN.test(voiceId!)
}

export interface VoicePreset {
  id: VoicePresetId
  label: string
  description: string
  zhVoiceId: string
  enVoiceId: string
}

// All presets use 豆包语音合成模型 2.0 (uranus) voices: they work with the
// seed-tts-2.0 resource, support context_texts emotion control, and return
// word-level subtitle timings. The retired 1.0 (moon/mars) voices are still
// routed correctly by resourceForVoice for legacy data.
export const VOICE_PRESETS: VoicePreset[] = [
  { id: 'narrator', label: '旁白', description: '稳定、清晰、中性叙事', zhVoiceId: 'zh_male_jieshuoxiaoming_uranus_bigtts', enVoiceId: 'en_male_tim_uranus_bigtts' },
  { id: 'young-female', label: '青年女声', description: '自然、克制、年轻', zhVoiceId: 'zh_female_vv_uranus_bigtts', enVoiceId: 'en_female_dacey_uranus_bigtts' },
  { id: 'mature-female', label: '成熟女声', description: '沉稳、有阅历', zhVoiceId: 'zh_female_cancan_uranus_bigtts', enVoiceId: 'en_female_stokie_uranus_bigtts' },
  { id: 'young-male', label: '青年男声', description: '清朗、自然、年轻', zhVoiceId: 'zh_male_liufei_uranus_bigtts', enVoiceId: 'en_male_tim_uranus_bigtts' },
  { id: 'mature-male', label: '成熟男声', description: '低沉、稳重、有控制力', zhVoiceId: 'zh_male_dayi_uranus_bigtts', enVoiceId: 'en_male_tim_uranus_bigtts' },
  { id: 'elder-male', label: '老年男声', description: '苍劲、缓慢、有威严', zhVoiceId: 'zh_male_yizhipiannan_uranus_bigtts', enVoiceId: 'en_male_tim_uranus_bigtts' },
  { id: 'elder-female', label: '老年女声', description: '温厚、缓慢、有年龄感', zhVoiceId: 'zh_female_wenroumama_uranus_bigtts', enVoiceId: 'en_female_stokie_uranus_bigtts' },
  { id: 'cold-villain', label: '冷峻反派', description: '冷静、压迫、低饱和情绪', zhVoiceId: 'zh_male_m191_uranus_bigtts', enVoiceId: 'en_male_tim_uranus_bigtts' },
]

export function voicePreset(id: VoicePresetId): VoicePreset {
  return VOICE_PRESETS.find((item) => item.id === id) ?? VOICE_PRESETS[0]
}

const MALE_VOICE_REGISTER = /男(?:低|中|高)?音|男声/
const FEMALE_VOICE_REGISTER = /女(?:低|中|高)?音|女声/
const MALE_ROLE_MARKERS = /男主角|男配角|堂[兄弟]|表[兄弟]|师兄|师弟|兄弟|伯父|叔父|父亲|生父|养父|祖父|爷爷|公子|少爷|新郎|丈夫|男友|管家/
const FEMALE_ROLE_MARKERS = /女主角|女配角|堂[姐妹]|表[姐妹]|师姐|师妹|姐妹|伯母|叔母|母亲|生母|养母|祖母|奶奶|夫人|小姐|新娘|妻子|女友/

function inferFemale(input: { name: string; role: string; description: string; voiceDescription: string }): boolean {
  // The voice register ("男中音"/"女高音") is the most reliable gender signal.
  if (FEMALE_VOICE_REGISTER.test(input.voiceDescription)) return true
  if (MALE_VOICE_REGISTER.test(input.voiceDescription)) return false
  // Kinship/lead markers in the role come next. Never scan for a bare 女
  // character — words like 女儿 describe relatives, not the character.
  if (FEMALE_ROLE_MARKERS.test(input.role)) return true
  if (MALE_ROLE_MARKERS.test(input.role)) return false
  return /女性|姑娘|她/.test(input.description)
}

export function inferVoicePreset(input: { name: string; role: string; description: string; voiceDescription: string }, used: Set<VoicePresetId> = new Set()): VoicePresetId {
  const value = `${input.name} ${input.role} ${input.description} ${input.voiceDescription}`
  if (/旁白|解说|narrator/i.test(value)) return 'narrator'
  const female = inferFemale(input)
  const age = Number(value.match(/(\d{1,2})岁/)?.[1] ?? 0)
  const elder = age >= 60 || /老年|老人|长辈|爷爷|奶奶|祖父|祖母|苍老|年迈/.test(value)
  const mature = !elder && (age >= 40 || /中年|掌权|沉稳/.test(value))
  const villain = /反派|阴冷|冷峻|狠厉|压迫|villain/i.test(value)
  // Gender outranks archetype: the cold-villain preset ships a male voice, so a
  // female villain must fall back to a female register of her age tier.
  const chosen: VoicePresetId = villain && !female && !elder
    ? 'cold-villain'
    : elder ? (female ? 'elder-female' : 'elder-male')
      : mature ? (female ? 'mature-female' : 'mature-male')
        : (female ? 'young-female' : 'young-male')
  if (!used.has(chosen)) return chosen
  if (chosen === 'young-male') return 'mature-male'
  if (chosen === 'young-female') return 'mature-female'
  return chosen
}
