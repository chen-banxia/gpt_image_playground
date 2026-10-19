import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyExactImageSize, getOutputPlacement } from './exactImageSize'
import { parseOutputSize } from './size'
import { DEFAULT_PARAMS } from '../types'
import * as canvasImage from './canvasImage'

describe('exact final canvas', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('pads a portrait into a square without stretching or clipping', () => {
    const rect = getOutputPlacement(1145, 1374, 2880, 2880, 'pad')
    expect(rect.width).toBeCloseTo(2400)
    expect(rect.height).toBeCloseTo(2880)
    expect(rect.x).toBeCloseTo(240)
    expect(rect.y).toBeCloseTo(0)
  })

  it('covers the square with a centered crop', () => {
    const rect = getOutputPlacement(1145, 1374, 2880, 2880, 'cover')
    expect(rect.width).toBeCloseTo(2880)
    expect(rect.height).toBeCloseTo(3456)
    expect(rect.x).toBeCloseTo(0)
    expect(rect.y).toBeCloseTo(-288)
  })

  it('accepts exact small and non-aligned targets, but rejects invalid and excessive canvases', () => {
    expect(parseOutputSize('1920×1080')).toEqual({ width: 1920, height: 1080 })
    expect(parseOutputSize('300x200')).toEqual({ width: 300, height: 200 })
    for (const size of ['0x1080', '1.5x200', '8193x10', '8192x8192', 'auto']) expect(parseOutputSize(size)).toBeNull()
  })

  it.each(['png', 'webp', 'jpeg'] as const)('encodes exact dimensions as %s and only fills JPEG padding', async (format) => {
    vi.spyOn(canvasImage, 'loadImage').mockResolvedValue({ naturalWidth: 1920, naturalHeight: 1088 } as HTMLImageElement)
    const ctx = { drawImage: vi.fn(), fillRect: vi.fn(), fillStyle: '', imageSmoothingEnabled: false, imageSmoothingQuality: '' }
    const canvas = { width: 0, height: 0, getContext: () => ctx, toDataURL: vi.fn((mime: string) => {
      expect(canvas.width).toBe(1920)
      expect(canvas.height).toBe(1080)
      return `data:${mime};base64,Zg==`
    }) }
    vi.stubGlobal('document', { createElement: () => canvas })
    const output = await applyExactImageSize('source', { ...DEFAULT_PARAMS, size: '1920x1080', size_fit: 'pad', output_format: format })
    expect(output).toEqual({ image: `data:image/${format};base64,Zg==`, sourceSize: '1920x1088', resized: true })
    expect(ctx.fillRect).toHaveBeenCalledTimes(format === 'jpeg' ? 1 : 0)
    expect(canvas.width).toBe(0)
  })

  it('does not re-encode an image that already matches the target', async () => {
    vi.spyOn(canvasImage, 'loadImage').mockResolvedValue({ naturalWidth: 1000, naturalHeight: 1000 } as HTMLImageElement)
    const output = await applyExactImageSize('original', { ...DEFAULT_PARAMS, size: '1000x1000', size_fit: 'cover' })
    expect(output).toEqual({ image: 'original', sourceSize: '1000x1000', resized: false })
  })

  it('removes recorded square padding before filling an already target-sized wide image', async () => {
    const image = { naturalWidth: 3840, naturalHeight: 1648 } as HTMLImageElement
    vi.spyOn(canvasImage, 'loadImage').mockResolvedValue(image)
    const drawImage = vi.fn()
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL: () => 'data:image/png;base64,Zg==' }
    vi.stubGlobal('document', { createElement: () => canvas })
    const output = await applyExactImageSize('padded', { ...DEFAULT_PARAMS, size: '3840x1648', size_fit: 'cover' }, undefined, '1254x1254')
    expect(drawImage).toHaveBeenCalledOnce()
    expect(drawImage.mock.calls[0][0]).toBe(image)
    const expected = [1096, 0, 1648, 1648, 0, -1096, 3840, 3840]
    expected.forEach((value, index) => expect(drawImage.mock.calls[0][index + 1]).toBeCloseTo(value))
    expect(output.resized).toBe(true)
    expect(output.sourceSize).toBe('1254x1254')
  })

  it('rejects an aborted operation before decoding', async () => {
    const load = vi.spyOn(canvasImage, 'loadImage')
    const controller = new AbortController()
    controller.abort(new Error('stopped'))
    await expect(applyExactImageSize('source', { ...DEFAULT_PARAMS, size: '1920x1080', size_fit: 'pad' }, controller.signal)).rejects.toThrow('stopped')
    expect(load).not.toHaveBeenCalled()
  })
})
