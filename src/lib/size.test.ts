import { describe, expect, it } from 'vitest'
import { calculateImageSize, normalizeImageSize } from './size'

describe('image resolution presets', () => {
  it.each([
    ['1K', '16:9', '1280x720'], ['2K', '16:9', '2560x1440'],
    ['2K', '1:1', '2048x2048'], ['2K', '2:3', '1440x2160'],
    ['4K', '1:1', '2880x2880'], ['4K', '16:9', '3840x2160'],
  ] as const)('%s %s maps to %s', (tier, ratio, size) => {
    expect(calculateImageSize(tier, ratio)).toBe(size)
    expect(normalizeImageSize(size)).toBe(size)
  })

  it('fits a custom aspect ratio inside the pixel budget without excessive ratio error', () => {
    const [w, h] = calculateImageSize('2K', '5:4')!.split('x').map(Number)
    expect(w * h).toBeLessThanOrEqual(2048 * 2048)
    expect(w % 16).toBe(0)
    expect(h % 16).toBe(0)
    expect(Math.abs(w / h - 1.25) / 1.25).toBeLessThanOrEqual(0.01)
  })
})
