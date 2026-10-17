import { describe, expect, it } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { createDefaultFalProfile, DEFAULT_SETTINGS, normalizeSettings } from './apiProfiles'
import { getOutputImageLimitForSettings, normalizeParamsForSettings } from './paramCompatibility'

describe('parameter compatibility', () => {
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

  it('preserves 2K and max quality with the current image model', () => {
    expect(normalizeParamsForSettings({ ...DEFAULT_PARAMS, size: '2048x2048', quality: 'max' }, DEFAULT_SETTINGS))
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
