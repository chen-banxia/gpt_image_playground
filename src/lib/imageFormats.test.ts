import { describe, expect, it } from 'vitest'
import { isAnimatedGifDataUrl } from './imageFormats'

describe('GIF input compatibility', () => {
  it('distinguishes a still GIF from a GIF with multiple timed frames', () => {
    expect(isAnimatedGifDataUrl('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==')).toBe(false)
    expect(isAnimatedGifDataUrl('data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAAAQABAAACAkQBACH5BAAUAAAALAAAAAABAAEAAAICTAEAOw==')).toBe(true)
    expect(isAnimatedGifDataUrl('data:image/png;base64,iVBORw0KGgo=')).toBe(false)
  })
})
