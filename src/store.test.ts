import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from './types'
import { DEFAULT_SETTINGS } from './lib/apiProfiles'
import type { TaskRecord } from './types'
import { editOutputs, markExpiredOpenAIRunningTasks, migrateImagePreferences, submitTask, useStore } from './store'

const imageA = { id: 'image-a', dataUrl: 'data:image/png;base64,a' }

describe('image upgrade preferences', () => {
  it.each([2, 3])('restores original output for stored version %s without changing model, quality or history', (version) => {
    const before = {
      settings: { model: 'gpt-image-2.5-flare' },
      params: { ...DEFAULT_PARAMS, size: '3840x1648', size_fit: 'pad', quality: 'low' },
      tasks: [task({ params: { ...DEFAULT_PARAMS, size_fit: 'none' } })],
    }
    const after = migrateImagePreferences(before, version) as typeof before
    expect(after.params).toMatchObject({ size: '3840x1648', size_fit: 'none', quality: 'low' })
    expect(after.settings).toEqual(before.settings)
    expect(after.tasks).toBe(before.tasks)
    expect(migrateImagePreferences(before, 4)).toBe(before)
  })
  it('migrates the previous default to sunburst/high while preserving size and input', async () => {
    const result = migrateImagePreferences({
      settings: { model: 'gpt-image-2.5-flare', apiKey: 'saved-key' },
      params: { ...DEFAULT_PARAMS, quality: 'auto', size: '2048x2048' }, prompt: 'keep me',
    }, 1) as { settings: typeof DEFAULT_SETTINGS; params: typeof DEFAULT_PARAMS; prompt: string }
    expect(result.settings.model).toBe('gpt-image-2.5-sunburst')
    expect(result.settings.apiKey).toBe('saved-key')
    expect(result.params).toMatchObject({ quality: 'high', size: '2048x2048' })
    expect(result.prompt).toBe('keep me')
  })

  it('tracks previews only for running tasks and clears them without writing final outputs', () => {
    useStore.setState({ tasks: [task({ status: 'running' })], taskPreviews: {} })
    useStore.getState().setTaskPreview('task-a', 'data:image/png;base64,cA==', 1)
    expect(useStore.getState().taskPreviews['task-a'][1]).toContain('cA==')
    expect(useStore.getState().tasks[0].outputImages).toEqual([])
    useStore.getState().setTaskPreview('task-a')
    expect(useStore.getState().taskPreviews['task-a']).toBeUndefined()
    useStore.setState({ tasks: [task()] })
    useStore.getState().setTaskPreview('task-a', 'late-preview')
    expect(useStore.getState().taskPreviews['task-a']).toBeUndefined()
  })
})

function task(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 'task-a',
    prompt: 'prompt',
    params: { ...DEFAULT_PARAMS },
    inputImageIds: [],
    maskTargetImageId: null,
    maskImageId: null,
    outputImages: [],
    status: 'done',
    error: null,
    createdAt: 1,
    finishedAt: 2,
    elapsed: 1,
    ...overrides,
  }
}

describe('mask draft lifecycle in store actions', () => {
  beforeEach(() => {
    useStore.setState({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key' },
      prompt: 'prompt',
      inputImages: [],
      maskDraft: null,
      maskEditorImageId: null,
      params: { ...DEFAULT_PARAMS },
      tasks: [],
      detailTaskId: null,
      lightboxImageId: null,
      lightboxImageList: [],
      showSettings: false,
      toast: null,
      confirmDialog: null,
      showToast: vi.fn(),
      setConfirmDialog: vi.fn(),
    })
  })

  it('preserves an existing mask when quick edit-output adds outputs as references', async () => {
    const maskDraft = {
      targetImageId: imageA.id,
      maskDataUrl: 'data:image/png;base64,mask',
      updatedAt: 1,
    }
    useStore.setState({
      inputImages: [imageA],
      maskDraft,
    })

    await editOutputs(task({ outputImages: [imageA.id] }))

    expect(useStore.getState().maskDraft).toEqual(maskDraft)
  })

  it('clears an invalid mask draft when submit cannot find the mask target image', async () => {
    useStore.setState({
      inputImages: [imageA],
      maskDraft: {
        targetImageId: 'missing-image',
        maskDataUrl: 'data:image/png;base64,mask',
        updatedAt: 1,
      },
    })

    await submitTask()

    expect(useStore.getState().maskDraft).toBeNull()
  })
})

describe('expired OpenAI running tasks', () => {
  it('marks only timed-out legacy and OpenAI running tasks as expired', () => {
    const now = 700_000
    const legacyRunning = task({ id: 'legacy-running', status: 'running', createdAt: 1_000, finishedAt: null, elapsed: null })
    const openAIRunning = task({ id: 'openai-running', apiProvider: 'openai', status: 'running', createdAt: 2_000, finishedAt: null, elapsed: null })
    const openAIStillRunning = task({ id: 'openai-still-running', apiProvider: 'openai', status: 'running', createdAt: 200_000, finishedAt: null, elapsed: null })
    const falRunning = task({ id: 'fal-running', apiProvider: 'fal', status: 'running', createdAt: 3_000, finishedAt: null, elapsed: null })
    const doneTask = task({ id: 'done-task', apiProvider: 'openai', status: 'done' })

    const result = markExpiredOpenAIRunningTasks([legacyRunning, openAIRunning, openAIStillRunning, falRunning, doneTask], DEFAULT_SETTINGS, now)

    expect(result.expiredTasks.map((item) => item.id)).toEqual(['legacy-running', 'openai-running'])
    expect(result.tasks.find((item) => item.id === 'legacy-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('Request timed out'),
      finishedAt: now,
      elapsed: 699_000,
    })
    expect(result.tasks.find((item) => item.id === 'openai-running')).toMatchObject({
      status: 'error',
      error: expect.stringContaining('Request timed out'),
      finishedAt: now,
      elapsed: 698_000,
    })
    expect(result.tasks.find((item) => item.id === 'openai-still-running')).toEqual(openAIStillRunning)
    expect(result.tasks.find((item) => item.id === 'fal-running')).toEqual(falRunning)
    expect(result.tasks.find((item) => item.id === 'done-task')).toEqual(doneTask)
  })

  it('uses the latest resubmission attempt when checking the 600-second timeout', () => {
    const now = 700_000
    const resubmitted = task({
      id: 'resubmitted',
      apiProvider: 'openai',
      status: 'running',
      createdAt: 1_000,
      attemptStartedAt: 650_000,
      finishedAt: null,
      elapsed: null,
    })

    const result = markExpiredOpenAIRunningTasks([resubmitted], DEFAULT_SETTINGS, now)

    expect(result.expiredTasks).toEqual([])
    expect(result.tasks[0]).toEqual(resubmitted)
  })
})
