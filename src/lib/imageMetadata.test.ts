import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveActualImageParams } from './imageMetadata'

describe('actual image dimensions', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('uses the decoded size instead of the echoed request and does not invent quality', async () => {
    vi.stubGlobal('Image', class {
      naturalWidth = 1254
      naturalHeight = 1254
      onload?: () => void
      set src(_value: string) { queueMicrotask(() => this.onload?.()) }
    })
    const actual = await resolveActualImageParams('data:image/png;base64,Zg==', { size: '2048x2048' })
    expect(actual).toEqual({ size: '1254x1254', output_format: 'png' })
  })
})
