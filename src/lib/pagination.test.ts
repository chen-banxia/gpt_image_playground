import { describe, expect, it } from 'vitest'
import { paginateItems } from './pagination'
import { useStore } from '../store'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'

describe('gallery pagination', () => {
  it('shows fifteen records and keeps the final partial page', () => {
    // 覆盖连续两页与不足一页的尾页，防止分页边界出现遗漏或重复。
    const items = Array.from({ length: 35 }, (_, i) => i)
    expect(paginateItems(items, 1).items).toEqual(items.slice(0, 15))
    expect(paginateItems(items, 2).items).toEqual(items.slice(15, 30))
    expect(paginateItems(items, 3)).toMatchObject({ items: [30, 31, 32, 33, 34], start: 31, end: 35, total: 35, totalPages: 3 })
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
