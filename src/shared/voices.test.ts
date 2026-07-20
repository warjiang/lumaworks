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
})
