import { describe, expect, it } from 'vitest'
import { buildVideoRequest, defaultDraft, durationPolicy, supportsDuration, validateDraft, VIDEO_MODELS } from './models'

describe('upstream video durations', () => {
  it.each(VIDEO_MODELS)('$id exposes only supported presets and validates every boundary', model => {
    const policy = durationPolicy(model.id)
    expect(policy.presets).toEqual(model.maxDuration === 30 ? [5, 10, 15, 20, 30] : [5, 10, 15])
    expect(policy.presets.every(seconds => supportsDuration(model.id, seconds))).toBe(true)
    for (const value of [3, model.maxDuration + 1, 4.5, Number.NaN, Infinity]) expect(supportsDuration(model.id, value)).toBe(false)
    for (let seconds = 4; seconds <= model.maxDuration; seconds++) expect(supportsDuration(model.id, seconds)).toBe(true)
    expect(supportsDuration(model.id, -1)).toBe(model.keySlot === 'doubaoVideo')
  })
  it('blocks a retained 30-second draft after changing to a 15-second model', () => {
    const draft = { ...defaultDraft(), prompt: 'Scene', params: { ...defaultDraft().params, duration: 30 } }
    expect(validateDraft(draft, []).join()).toContain('15')
    expect(() => buildVideoRequest(draft, [])).toThrow()
  })
  it('sends supported custom seconds unchanged and rejects H3 automatic duration', () => {
    const draft = { ...defaultDraft(), prompt: 'Scene', modelId: 'MiniMax-H3', params: { duration: 7, resolution: '768P', ratio: '16:9' } }
    expect(buildVideoRequest(draft, []).duration).toBe(7)
    expect(() => buildVideoRequest({ ...draft, params: { ...draft.params, duration: -1 } }, [])).toThrow()
  })
})
