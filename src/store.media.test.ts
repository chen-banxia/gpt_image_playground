import { afterEach, describe, expect, it, vi } from 'vitest'
import { unzipSync } from 'fflate'
import { exportData, importData, useStore } from './store'
import { DEFAULT_SETTINGS } from './lib/apiProfiles'
import * as db from './lib/db'

describe('GIF and SVG backups', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('round-trips original bytes, MIME types and filenames through an exported backup', async () => {
    const images = [
      { id: 'animation', dataUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAAAQABAAACAkQBACH5BAAUAAAALAAAAAABAAEAAAICRAEAOw==', source: 'generated' as const, createdAt: Date.now() },
      { id: 'vector', dataUrl: `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="M0 0L10 10"/></svg>')}`, source: 'generated' as const, createdAt: Date.now() },
    ]
    vi.spyOn(db, 'getAllTasks').mockResolvedValue([])
    vi.spyOn(db, 'getAllImages').mockResolvedValue(images)
    const put = vi.spyOn(db, 'putImage').mockImplementation(async image => image.id)
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.fn()
    vi.stubGlobal('document', { createElement: () => ({ href: '', download: '', click }) })
    useStore.setState({ settings: DEFAULT_SETTINGS, groups: [], showToast: vi.fn() })

    await exportData()
    expect(click).toHaveBeenCalledOnce()
    const archive = createUrl.mock.calls[0][0] as Blob
    const bytes = new Uint8Array(await archive.arrayBuffer())
    const files = unzipSync(bytes)
    expect(Object.keys(files)).toEqual(['images/animation.gif', 'images/vector.svg', 'manifest.json'])
    for (const [index, extension] of ['gif', 'svg'].entries()) {
      expect(files[`images/${images[index].id}.${extension}`]).toEqual(Uint8Array.from(atob(images[index].dataUrl.split(',')[1]), char => char.charCodeAt(0)))
    }
    expect(await importData(new File([bytes], 'backup.zip', { type: 'application/zip' }))).toBe(true)
    expect(put.mock.calls.map(([image]) => image)).toEqual(images)
  })
})
