import { describe, expect, it } from 'vitest'
import { buildImageCompositionPrompt, resolveUpscaleModel, stripImageCompositionPrompt } from './imageComposition'
import { DEFAULT_PARAMS } from '../types'

describe('request-only image composition', () => {
  it('does not invent a target for auto size', () => {
    expect(buildImageCompositionPrompt('dog', DEFAULT_PARAMS, false, false)).toBe('dog')
  })
  it('uses exact dimensions and ratio for portrait and square images', () => {
    expect(buildImageCompositionPrompt('dog', { ...DEFAULT_PARAMS, size: '1440x2560' }, false, false)).toContain('9:16; portrait')
    expect(buildImageCompositionPrompt('dog', { ...DEFAULT_PARAMS, size: '2048x2048' }, false, false)).toContain('1:1; square')
  })
  it('prioritizes masks and transparency over generic outpainting requirements', () => {
    const prompt = buildImageCompositionPrompt('edit', { ...DEFAULT_PARAMS, size: '2560x1440', transparent_output: true }, true, true)
    expect(prompt).toContain('Preserve unmasked content')
    expect(prompt).not.toContain('outpaint the surrounding scene')
    expect(prompt).not.toContain('no letterboxing')
    expect(prompt).toContain('transparent or solid-key background')
  })
  it('removes the injected block from an upstream echo', () => {
    const prompt = buildImageCompositionPrompt('dog', { ...DEFAULT_PARAMS, size: '2048x2048' }, false, false)
    expect(stripImageCompositionPrompt(prompt)).toBe('dog')
    expect(stripImageCompositionPrompt(undefined)).toBeUndefined()
  })
  it.each([
    ['gpt-image-2', '1024x1536', 'gpt-image-2'],
    ['gpt-image-2.5-flare', '2560x1440', 'gpt-image-2.5-flare-2k'],
    ['gpt-image-2.5-sunburst', '3840x1648', 'gpt-image-2.5-sunburst-4k'],
    ['gpt-image-2.5-flare-2k', '3840x2160', 'gpt-image-2.5-flare-2k'],
    ['custom-image', '3840x2160', 'custom-image'],
    ['gpt-image-2', 'auto', 'gpt-image-2'],
  ])('routes %s at %s to %s', (model, size, expected) => {
    expect(resolveUpscaleModel(model, size)).toBe(expected)
  })
})
