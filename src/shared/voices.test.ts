import { describe, expect, it } from 'vitest'
import { inferVoicePreset, voicePreset } from './voices'

describe('voice presets', () => {
  it('assigns role-appropriate presets and distinct primary alternatives', () => {
    const used = new Set<ReturnType<typeof inferVoicePreset>>()
    const heroine = inferVoicePreset({ name: '沈若棠', role: '27岁女主角', description: '', voiceDescription: '克制的青年女声' }, used); used.add(heroine)
    const father = inferVoicePreset({ name: '沈广铭', role: '56岁反派父亲', description: '', voiceDescription: '低沉冷酷' }, used)
    expect(heroine).toBe('young-female')
    expect(father).toBe('cold-villain')
    expect(voicePreset(heroine).zhVoiceId).not.toBe(voicePreset(father).zhVoiceId)
  })

  it('trusts the voice register description over misleading relatives in the bio', () => {
    // 陆眠 is male ("男中音") but his bio mentions 女儿, which used to flip him female.
    expect(inferVoicePreset({ name: '陆眠', role: '盟友律师', description: '31岁，口袋里别一支彩色钢笔，是女儿送的父亲节礼物', voiceDescription: '男中音偏亮，语速快' })).toBe('young-male')
    // 沈书樾 is a 堂弟 with 男高音 — both signals must beat any female-sounding name.
    expect(inferVoicePreset({ name: '沈书樾', role: '家族内部搅局者。裴衍州堂弟', description: '30岁，圆脸面相和善', voiceDescription: '男高音偏亮，语速快且跳跃' })).toBe('young-male')
  })

  it('never assigns the male cold-villain voice to a female villain', () => {
    // 贺兰秋 is female (女中音) working a villain-adjacent role; she must keep a female register.
    expect(inferVoicePreset({ name: '贺兰秋', role: '暗线推手，构陷事件的间接牵线人，行事狠厉', description: '35岁，穿剪裁利落的黑色连衣裙', voiceDescription: '女中音，语速平稳到几乎无起伏' })).toBe('young-female')
  })

  it('keeps male villains on the cold-villain preset and seniors on elder registers', () => {
    expect(inferVoicePreset({ name: '裴衍州', role: '男主角。家族信托基金实际控制人', description: '32岁，剑眉入鬓', voiceDescription: '低沉男中音，不疾不徐中自带压迫感' })).toBe('cold-villain')
    expect(inferVoicePreset({ name: '裴鹤年', role: '裴家掌权长辈', description: '79岁，手持乌木拐杖', voiceDescription: '音色苍老但中气充沛' })).toBe('elder-male')
    expect(inferVoicePreset({ name: '容锦', role: '策展人', description: '27岁，柳叶眉，微卷长发及肩', voiceDescription: '女高音，语速快而流畅' })).toBe('young-female')
  })
})
