import { afterEach, describe, expect, it, vi } from 'vitest'
import { filterGalleryTasks } from './taskGroups'
import { DEFAULT_PARAMS, type TaskRecord } from '../types'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { assignTaskGroup, deleteImageGroup, saveImageGroup, submitTask, useStore, updateTaskInStore } from '../store'
import * as db from './db'
import * as api from './api'
import type { CallApiResult } from './api'

const task = (id: string, groupId?: string): TaskRecord => ({
  id, groupId, prompt: 'dog', params: DEFAULT_PARAMS, inputImageIds: [], outputImages: [],
  status: 'running', error: null, createdAt: 1, finishedAt: null, elapsed: null,
})

afterEach(() => {
  vi.restoreAllMocks()
  useStore.setState({ groups: [], groupFilter: 'all', tasks: [], selectedTaskIds: [], inputImages: [], prompt: '', maskDraft: null })
})

describe('task grouping', () => {
  it('filters the same visible records for gallery and batch actions', () => {
    const groups = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
    const tasks = [task('one', 'a'), task('two', 'b'), task('legacy'), task('orphan', 'deleted')]
    expect(filterGalleryTasks(tasks, groups, 'a', '', 'all', false).map((t) => t.id)).toEqual(['one'])
    expect(filterGalleryTasks(tasks, groups, 'ungrouped', '', 'all', false).map((t) => t.id)).toEqual(['legacy', 'orphan'])
    expect(filterGalleryTasks(tasks, groups, 'all', '', 'all', false)).toHaveLength(4)
  })

  it('renames and deletes a group without deleting or cancelling its tasks', async () => {
    const completed = { ...task('completed', 'a'), status: 'done' as const, outputImages: ['image-1', 'image-2'] }
    const other = task('other', 'b')
    useStore.setState({ groups: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], groupFilter: 'a', tasks: [task('running', 'a'), completed, other] })
    const updateGroups = vi.spyOn(db, 'putTaskGroups').mockResolvedValue()
    const deleteTask = vi.spyOn(db, 'deleteTask')
    const deleteImage = vi.spyOn(db, 'deleteImage')
    saveImageGroup('Renamed', 'a')
    expect(useStore.getState().groups[0].name).toBe('Renamed')
    expect(() => saveImageGroup('Renamed')).toThrow()
    await deleteImageGroup('a')
    expect(useStore.getState().tasks[0]).toMatchObject({ id: 'running', groupId: null, status: 'running' })
    expect(useStore.getState().tasks[1]).toMatchObject({ id: 'completed', groupId: null, outputImages: ['image-1', 'image-2'] })
    expect(useStore.getState().tasks[2]).toBe(other)
    expect(updateGroups).toHaveBeenCalledWith(['running', 'completed'], null)
    expect(useStore.getState().groupFilter).toBe('ungrouped')
    expect(deleteTask).not.toHaveBeenCalled()
    expect(deleteImage).not.toHaveBeenCalled()
  })

  it('does not overwrite a result completed during an asynchronous group update', async () => {
    useStore.setState({ groups: [{ id: 'b', name: 'B' }], tasks: [task('running')], selectedTaskIds: ['running'] })
    let release!: () => void
    vi.spyOn(db, 'putTaskGroups').mockImplementation(() => new Promise((resolve) => { release = resolve }))
    vi.spyOn(db, 'putTask').mockResolvedValue('running')
    const moving = assignTaskGroup(['running'], 'b')
    updateTaskInStore('running', { status: 'done', outputImages: ['result'] })
    release()
    await moving
    expect(useStore.getState().tasks[0]).toMatchObject({ groupId: 'b', status: 'done', outputImages: ['result'] })
    expect(useStore.getState().selectedTaskIds).toEqual([])
  })

  it('keeps simultaneous generations in their submitted groups when filters change', async () => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test' }, params: { ...DEFAULT_PARAMS },
      prompt: 'group A dog', inputImages: [], maskDraft: null, tasks: [],
      groups: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], groupFilter: 'a',
    })
    vi.spyOn(useStore.getState(), 'showToast').mockImplementation(() => {})
    vi.spyOn(db, 'putTask').mockResolvedValue('task')
    vi.spyOn(db, 'storeImage').mockImplementation(async (image) => image)
    const completions: Array<(value: CallApiResult) => void> = []
    const call = vi.spyOn(api, 'callImageApi').mockImplementation(() => new Promise((resolve) => completions.push(resolve)))
    await submitTask()
    const taskA = useStore.getState().tasks[0].id
    useStore.getState().setGroupFilter('b')
    useStore.getState().setPrompt('group B dog')
    await submitTask()
    const taskB = useStore.getState().tasks[0].id
    expect(call).toHaveBeenCalledTimes(2)
    useStore.getState().setGroupFilter('all')
    completions[1]({ images: ['result-b'] })
    completions[0]({ images: ['result-a'] })
    await vi.waitFor(() => expect(useStore.getState().tasks.every((t) => t.status === 'done')).toBe(true))
    expect(useStore.getState().tasks.find((t) => t.id === taskA)).toMatchObject({ groupId: 'a', outputImages: ['result-a'] })
    expect(useStore.getState().tasks.find((t) => t.id === taskB)).toMatchObject({ groupId: 'b', outputImages: ['result-b'] })
  })
})
