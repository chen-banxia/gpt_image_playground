import { describe, expect, it } from 'vitest'
import { unzipSync } from 'fflate'
import { buildSelectedImagesZip } from './batchDownload'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'

const task = (id: string, outputImages: string[]): TaskRecord => ({
  id, outputImages, inputImageIds: ['reference'], prompt: 'private prompt', params: DEFAULT_PARAMS,
  status: 'done', error: null, createdAt: 0, finishedAt: 0, elapsed: 0,
})

describe('batch image download', () => {
  it('includes all outputs with distinct filenames and skips empty tasks', async () => {
    const images: Record<string, string> = { a: 'data:image/png;base64,AQID', b: 'data:image/jpeg;base64,BAU=' }
    const result = await buildSelectedImagesZip([task('first', ['a', 'b']), task('empty', []), task('last', ['a'])], async (id) => images[id])
    const files = unzipSync(result.bytes)
    expect(Object.keys(files)).toEqual(['task-1/image-1.png', 'task-1/image-2.jpg', 'task-3/image-1.png'])
    expect([...files['task-1/image-1.png']]).toEqual([1, 2, 3])
    expect(result).toMatchObject({ count: 3, skipped: 1 })
    expect(result.imageIds).toEqual(['a', 'b'])
  })
  it('rejects missing images instead of silently downloading an incomplete archive', async () => {
    await expect(buildSelectedImagesZip([task('first', ['missing'])], async () => undefined)).rejects.toThrow()
  })
  it('rejects an empty output selection', async () => {
    await expect(buildSelectedImagesZip([task('empty', [])], async () => undefined)).rejects.toThrow()
  })
})
