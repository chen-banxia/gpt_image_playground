import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { filterImageLibrary, imageDownloadState, imageTaskModel, UNKNOWN_IMAGE_MODEL } from './imageLibraryFilters'
import { filterGalleryTasks } from './taskGroups'
import { selectedImageFiles, downloadImageBatch, useImageDownloads, cancelImageDownloads } from './imageBatchDownloads'
import * as store from '../store'
import * as download from './downloadImage'
import * as zip from './batchDownload'

const task = (id: string, outputs: string[], patch: Partial<TaskRecord> = {}): TaskRecord => ({ id, outputImages: outputs, inputImageIds: [], prompt: 'scene', params: DEFAULT_PARAMS, status: 'done', error: null, createdAt: 1, finishedAt: 1, elapsed: 0, ...patch })
afterEach(() => {
  vi.restoreAllMocks()
  useImageDownloads.setState({ busy: false, entries: [], taskIds: [], notice: '' })
  store.useStore.setState({ downloadedImages: {}, filterModel: 'all', filterDownload: 'all', selectedTaskIds: [], galleryPage: 1 })
})
describe('image library filters', () => {
  it('distinguishes absent, untouched, partial and complete outputs', () => {
    expect(imageDownloadState(task('empty', []), {})).toBe('no_output')
    expect(imageDownloadState(task('new', ['a']), {})).toBe('not_downloaded')
    expect(imageDownloadState(task('partial', ['a', 'b']), { a: 1 })).toBe('partial')
    expect(imageDownloadState(task('all', ['a', 'a']), { a: 1 })).toBe('downloaded')
  })
  it('uses saved image model, including unknown history, and combines filters before pagination', () => {
    const tasks = [task('a', ['a'], { apiModel: 'model-a' }), task('b', ['b', 'c'], { apiModel: 'chat', apiImageModel: 'model-b' }), task('unknown', []), task('c', ['d'], { apiModel: 'model-b' })]
    expect(imageTaskModel(tasks[1])).toBe('model-b')
    expect(imageTaskModel(tasks[2])).toBe(UNKNOWN_IMAGE_MODEL)
    expect(filterImageLibrary(tasks, 'model-b', 'partial', { b: 1 }).map(t => t.id)).toEqual(['b'])
    expect(filterImageLibrary(tasks, 'all', 'not_downloaded', { a: 1, b: 1 }).map(t => t.id)).toEqual(['c'])
    expect(filterGalleryTasks(tasks, [], 'all', 'model-b', 'all', false).map(t => t.id)).toEqual(['b', 'c'])
  })
  it('clears selection and resets page when either new filter changes', () => {
    store.useStore.setState({ selectedTaskIds: ['hidden'], galleryPage: 3 })
    store.useStore.getState().setFilterModel('model-a')
    expect(store.useStore.getState()).toMatchObject({ selectedTaskIds: [], galleryPage: 1, filterModel: 'model-a' })
    store.useStore.setState({ selectedTaskIds: ['hidden'], galleryPage: 2 })
    store.useStore.getState().setFilterDownload('partial')
    expect(store.useStore.getState()).toMatchObject({ selectedTaskIds: [], galleryPage: 1, filterDownload: 'partial' })
  })
})
describe('image batch queue', () => {
  it('deduplicates output files and excludes downloaded files only when requested', () => {
    const tasks = [task('a', ['x', 'y']), task('b', ['y', 'z'])]
    expect(selectedImageFiles(tasks, false, { x: 1 })).toEqual(['x', 'y', 'z'])
    expect(selectedImageFiles(tasks, true, { x: 1 })).toEqual(['y', 'z'])
  })
  it('marks only files whose save started and continues after a failure', async () => {
    vi.spyOn(store, 'ensureImageCached').mockImplementation(async id => id === 'bad' ? undefined : 'data:image/png;base64,AQID')
    vi.spyOn(download, 'downloadImage').mockImplementation(async (_src, onStarted) => { onStarted?.() })
    await downloadImageBatch([task('a', ['ok', 'bad', 'last'])], 'files')
    expect(Object.keys(store.useStore.getState().downloadedImages)).toEqual(['ok', 'last'])
    expect(useImageDownloads.getState().entries.map(e => e.state)).toEqual(['saved', 'failed', 'saved'])
  })
  it('does not save or mark an incomplete ZIP', async () => {
    vi.spyOn(store, 'ensureImageCached').mockImplementation(async id => id === 'bad' ? undefined : 'data:image/png;base64,AQID')
    const save = vi.spyOn(zip, 'saveImagesZip').mockImplementation(() => {})
    await downloadImageBatch([task('a', ['ok', 'bad'])], 'zip')
    expect(save).not.toHaveBeenCalled()
    expect(store.useStore.getState().downloadedImages).toEqual({})
    expect(useImageDownloads.getState().entries.every(e => e.state === 'failed')).toBe(true)
  })
  it('cancellation during file loading prevents the next browser save', async () => {
    vi.spyOn(store, 'ensureImageCached').mockImplementation(async () => { cancelImageDownloads(); return 'data:image/png;base64,AQID' })
    const save = vi.spyOn(download, 'downloadImage')
    await downloadImageBatch([task('a', ['ok'])], 'files')
    expect(save).not.toHaveBeenCalled()
    expect(store.useStore.getState().downloadedImages).toEqual({})
    expect(useImageDownloads.getState().entries[0].state).toBe('cancelled')
  })
})
