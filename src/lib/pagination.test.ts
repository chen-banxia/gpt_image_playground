import { describe, expect, it } from 'vitest'
import { paginateItems } from './pagination'
import { useStore } from '../store'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'

describe('gallery pagination', () => {
  it('shows nine records and keeps the final partial page', () => {
    const items = Array.from({ length: 23 }, (_, i) => i)
    expect(paginateItems(items, 1).items).toEqual(items.slice(0, 9))
    expect(paginateItems(items, 2).items).toEqual(items.slice(9, 18))
    expect(paginateItems(items, 3)).toMatchObject({ items: [18, 19, 20, 21, 22], start: 19, end: 23, total: 23, totalPages: 3 })
  })
  it('clamps removed pages and empty results without invalid ranges', () => {
    expect(paginateItems([1, 2], 4)).toMatchObject({ page: 1, totalPages: 1, items: [1, 2] })
    expect(paginateItems([], 2)).toMatchObject({ page: 1, start: 0, end: 0, total: 0 })
    expect(paginateItems([1], NaN).page).toBe(1)
  })
  it('changes view and selection without changing tasks or prompts', () => {
    const task: TaskRecord = { id: 'running', groupId: 'a', prompt: 'dog', params: DEFAULT_PARAMS, inputImageIds: [], outputImages: [], status: 'running', error: null, createdAt: 1, finishedAt: null, elapsed: null }
    useStore.setState({ tasks: [task], prompt: 'draft', galleryPage: 1, selectedTaskIds: ['running'] })
    useStore.getState().setGalleryPage(2)
    expect(useStore.getState().tasks[0]).toBe(task)
    expect(useStore.getState().prompt).toBe('draft')
    expect(useStore.getState().selectedTaskIds).toEqual([])
    for (const changeFilter of [() => useStore.getState().setGroupFilter('b'), () => useStore.getState().setSearchQuery('cat'), () => useStore.getState().setFilterStatus('done'), () => useStore.getState().setFilterFavorite(true)]) {
      useStore.getState().setGalleryPage(3)
      changeFilter()
      expect(useStore.getState().galleryPage).toBe(1)
      expect(useStore.getState().tasks[0].status).toBe('running')
    }
    useStore.setState({ tasks: [], prompt: '', galleryPage: 1, groupFilter: 'all', searchQuery: '', filterStatus: 'all', filterFavorite: false })
  })
})
