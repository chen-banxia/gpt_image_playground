import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultFalProfile, DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { getOutputImageLimitForSettings, normalizeParamsForSettings } from './paramCompatibility'

describe('parameter compatibility', () => {
  it('normalizes out-of-range imported values before sending requests', () => {
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 2.8, output_format: 'jpeg', output_compression: 120.2 }, DEFAULT_SETTINGS))
      .toMatchObject({ n: 3, output_compression: 100 })
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: Infinity, output_format: 'webp', output_compression: -10 }, DEFAULT_SETTINGS))
      .toMatchObject({ n: 1, output_compression: 0 })
    const invalid = { ...DEFAULT_PARAMS, n: NaN, quality: 'hd', moderation: 'off', output_format: 'bmp', output_compression: NaN, size: '0x0' } as unknown as typeof DEFAULT_PARAMS
    expect(normalizeParamsForSettings(invalid, DEFAULT_SETTINGS))
      .toMatchObject({ n: 1, quality: 'auto', moderation: 'auto', output_format: 'png', output_compression: null, size: 'auto' })
  })

  it.each(['gpt-image-2.5', 'custom-gpt-image-2.5-proxy'])('does not infer extended quality from undocumented ID %s', model => {
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, quality: 'max' }, { ...DEFAULT_SETTINGS, model }).quality).toBe('high')
  })
  it.each(['gpt-image-2.6', 'gpt-image-2.6-flare', 'gpt-image-2.6-sunburst'])('uses documented quality values for %s in both API modes', (model) => {
    for (const apiMode of ['images', 'responses'] as const) {
      const settings = { ...DEFAULT_SETTINGS, apiMode, model: apiMode === 'responses' ? 'gpt-5.5' : model, imageGenerationModel: model }
      for (const quality of ['auto', 'low', 'medium', 'high', 'xhigh', 'max'] as const) {
        expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, quality }, settings).quality)
          .toBe(model === 'gpt-image-2.6' && (quality === 'xhigh' || quality === 'max') ? 'high' : quality)
      }
    }
  })

  it('normalizes GIF fields without applying static-image minimum size or local processing', () => {
    const result = normalizeParamsForSettings({ ...DEFAULT_PARAMS, output_format: 'gif', size: '256x256', size_fit: 'cover', frame_count: 64, frame_duration_ms: 205, transparent_output: true, output_compression: 80 }, DEFAULT_SETTINGS)
    expect(result).toMatchObject({ output_format: 'gif', size: '256x256', size_fit: 'none', frame_count: 16, frame_duration_ms: 210, stream: false, transparent_output: false, output_compression: null })
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, output_format: 'gif' }, DEFAULT_SETTINGS)).toMatchObject({ frame_count: 9, frame_duration_ms: 200 })
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, output_format: 'gif', frame_count: NaN, frame_duration_ms: Infinity }, DEFAULT_SETTINGS)).toMatchObject({ frame_count: 9, frame_duration_ms: 200 })
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, output_format: 'gif', frame_count: 0, frame_duration_ms: 0, size: '257x256' }, DEFAULT_SETTINGS)).toMatchObject({ frame_count: 2, frame_duration_ms: 20, size: 'auto' })
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, output_format: 'gif', frame_duration_ms: 9999 }, DEFAULT_SETTINGS).frame_duration_ms).toBe(2000)
  })

  it('clears GIF-only fields on format changes and does not enable new capabilities for old models or fal', () => {
    const animated = { ...DEFAULT_PARAMS, output_format: 'gif' as const, frame_count: 9, frame_duration_ms: 200, complexity: 'low' as const }
    expect(normalizeParamsForSettings({ ...animated, output_format: 'svg', n: 3, stream: true, size_fit: 'pad' }, DEFAULT_SETTINGS))
      .toMatchObject({ n: 1, stream: false, size_fit: 'none', frame_count: undefined, frame_duration_ms: undefined, complexity: 'low' })
    for (const model of ['gpt-image-2', 'gpt-image-2.5-sunburst', 'gpt-image-2.6', 'custom']) {
      expect(normalizeParamsForSettings(animated, { ...DEFAULT_SETTINGS, model }))
        .toMatchObject({ output_format: 'png', complexity: undefined, frame_count: undefined, frame_duration_ms: undefined })
    }
    const fal = createDefaultFalProfile({ model: 'gpt-image-2.6-sunburst' })
    expect(normalizeParamsForSettings(animated, normalizeSettings({ profiles: [fal] })))
      .toMatchObject({ output_format: 'png', complexity: undefined, frame_count: undefined, frame_duration_ms: undefined })
  })

  it('retains the exact final target only when local size fitting is enabled', () => {
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '1920x1080', size_fit: 'pad' }, DEFAULT_SETTINGS).size).toBe('1920x1080')
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '1920x1080', size_fit: 'none' }, DEFAULT_SETTINGS).size).toBe('1920x1088')
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto', size_fit: 'cover' }, DEFAULT_SETTINGS).size_fit).toBe('cover')
    expect(() => normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '8192x8192', size_fit: 'pad' }, DEFAULT_SETTINGS)).toThrow()
  })
  it('defaults missing policies to original and retains the default after auto size', () => {
    const auto = normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: 'auto', size_fit: undefined }, DEFAULT_SETTINGS)
    expect(auto.size_fit).toBe('none')
    const sized = normalizeParamsForSettings({ ...auto, size: '3840x1648' }, DEFAULT_SETTINGS)
    expect(sized).toMatchObject({ size: '3840x1648', size_fit: 'none' })
    expect(normalizeParamsForSettings({ ...sized, size_fit: 'none' }, DEFAULT_SETTINGS).size_fit).toBe('none')
  })
  it('limits OpenAI output count to 10', () => {
    const settings = normalizeSettings(DEFAULT_SETTINGS)

    expect(getOutputImageLimitForSettings(settings)).toBe(10)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 12 }, settings).n).toBe(10)
  })

  it('keeps the chosen quality for OpenAI profiles', () => {
    const settings = normalizeSettings(DEFAULT_SETTINGS)

    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, quality: 'high' }, settings).quality).toBe('high')
  })

  it('preserves 2K and max quality with GPT Image 2.5', () => {
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '2048x2048', quality: 'max' }, { ...DEFAULT_SETTINGS, model: 'gpt-image-2.5-sunburst' }))
      .toMatchObject({ size: '2048x2048', quality: 'max' })
  })

  it('switches JPEG to PNG when transparency is requested', () => {
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, output_format: 'jpeg', output_compression: 80, transparent_output: true }, DEFAULT_SETTINGS))
      .toMatchObject({ output_format: 'png', output_compression: null, transparent_output: true })
  })

  it('limits fal.ai output count to 4', () => {
    const falProfile = createDefaultFalProfile({ apiKey: 'fal-key' })
    const settings = normalizeSettings({
      ...DEFAULT_SETTINGS,
      profiles: [falProfile],
      activeProfileId: falProfile.id,
    })

    expect(getOutputImageLimitForSettings(settings)).toBe(4)
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, n: 8 }, settings).n).toBe(4)
  })
})
