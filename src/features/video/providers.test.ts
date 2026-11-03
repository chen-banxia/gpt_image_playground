import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configuredVideoRoute, taskVideoRoute, validateVideoRoute, VIDEO_PROVIDERS } from './providers'
import { createdVideoId, parseSnapshot, requestVideo, videoEndpoint } from './api'
import { defaultDraft } from './models'
import { loadVideoSettings, persistSettings, useVideoSettings, VIDEO_SETTINGS_KEY } from './settings'
import { retryVideoTask, syncVideoTask, useVideoStore } from './store'
import * as db from './db'
import type { VideoTask } from './types'

function failedTask(patch: Partial<VideoTask> = {}): VideoTask {
  return { id: 'failed-original', modelId: 'MiniMax-H3', keySlot: 'hailuoVideo', credentialRevision: 'old', gatewayBaseUrl: 'https://gateway.example/prefix', proxy: false, prompt: 'Original description', inputMode: 'frames', inputs: [], params: { duration: 5, resolution: '768P', ratio: '16:9' }, submissionState: 'rejected', status: 'failed', syncState: 'paused', error: 'model "MiniMax-H3" is not served by this plugin', groupId: 'original-group', isFavorite: true, createdAt: 1, updatedAt: 1, ...patch }
}
beforeEach(async () => {
  await db.clearVideo(true)
  useVideoStore.setState({ ready: true, tasks: [], assets: [], submitting: false, draft: { ...defaultDraft(), prompt: 'Keep this unsent draft' }, error: '' })
  useVideoSettings.setState({ settings: { gatewayBaseUrl: 'https://gateway.example/prefix', proxy: false, routes: structuredClone(VIDEO_PROVIDERS), doubaoVideo: { apiKey: 'doubao-test', remember: false, revision: 'd1' }, hailuoVideo: { apiKey: 'hailuo-test', remember: true, revision: 'h1' } } })
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('provider route configuration', () => {
  it('uses H3 v2 defaults and keeps deployment prefixes and encoded task IDs', () => {
    expect(videoEndpoint('https://gateway.example/prefix', undefined, false, VIDEO_PROVIDERS.hailuoVideo)).toBe('https://gateway.example/prefix/hailuo/v2/video_generation')
    expect(videoEndpoint('https://gateway.example/prefix', 'task/a', true, VIDEO_PROVIDERS.hailuoVideo)).toBe('/video-api-proxy/hailuo/v2/query/video_generation/task%2Fa')
  })
  it('allows explicit deployment aliases without changing protocol', () => {
    const route = validateVideoRoute({ protocol: 'hailuo-h3', createPath: '/hailuo/v1/video_generation', queryPath: '/hailuo/v1/query/video_generation/{task_id}' })
    expect(videoEndpoint('https://gateway.example', '123', false, route)).toBe('https://gateway.example/hailuo/v1/query/video_generation/123')
  })
  it.each(['https://evil.example/create', '//evil.example/create', '/a/../create', '/a?key=x', '/a#x', '/a%2Fcreate'])('rejects unsafe configured path %s', path => {
    expect(() => validateVideoRoute({ ...VIDEO_PROVIDERS.hailuoVideo, createPath: path })).toThrow()
  })
  it('rejects missing or duplicate task placeholders and protocol mismatch', () => {
    for (const queryPath of ['/hailuo/query', '/{task_id}/query/{task_id}']) expect(() => validateVideoRoute({ ...VIDEO_PROVIDERS.hailuoVideo, queryPath })).toThrow()
    expect(() => configuredVideoRoute({ ...useVideoSettings.getState().settings, routes: { doubaoVideo: VIDEO_PROVIDERS.hailuoVideo, hailuoVideo: VIDEO_PROVIDERS.hailuoVideo } }, 'doubaoVideo')).toThrow()
  })
  it('preserves old task routes even for H3 and honors new task snapshots', () => {
    expect(taskVideoRoute(failedTask())).toEqual(VIDEO_PROVIDERS.doubaoVideo)
    expect(taskVideoRoute(failedTask({ route: VIDEO_PROVIDERS.hailuoVideo }))).toEqual(VIDEO_PROVIDERS.hailuoVideo)
  })
  it('migrates old settings without losing keys or replacing a custom gateway', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
    values.set(VIDEO_SETTINGS_KEY, JSON.stringify({ ...useVideoSettings.getState().settings, version: 1, routes: undefined }))
    const migrated = loadVideoSettings()
    expect(migrated.gatewayBaseUrl).toBe('https://gateway.example/prefix')
    expect(migrated.hailuoVideo.apiKey).toBe('hailuo-test')
    expect(migrated.doubaoVideo.apiKey).toBe('')
    expect(migrated.routes?.hailuoVideo).toEqual(VIDEO_PROVIDERS.hailuoVideo)
    migrated.routes!.hailuoVideo.createPath = '/custom/h3/create'
    persistSettings(migrated)
    expect(JSON.parse(values.get(VIDEO_SETTINGS_KEY)!).version).toBe(2)
    expect(loadVideoSettings().routes?.hailuoVideo.createPath).toBe('/custom/h3/create')
  })
})

describe('H3 response contract', () => {
  it('reads H3 task_id and task.content.url without confusing Doubao fields', () => {
    expect(createdVideoId({ task_id: 'h3-id' }, 'hailuo-h3')).toBe('h3-id')
    expect(createdVideoId({ id: 'wrong' }, 'hailuo-h3')).toBeUndefined()
    expect(parseSnapshot({ task_id: 'h3-id', task: { id: 'h3-id', status: 'queued' } }, 'hailuo-h3').status).toBe('queued')
    expect(parseSnapshot({ task: { status: 'succeeded', content: { url: 'https://cdn.example/video.mp4' } } }, 'hailuo-h3')).toMatchObject({ status: 'succeeded', videoUrl: 'https://cdn.example/video.mp4' })
    expect(parseSnapshot({ task: { status: 'failed', error: { message: 'failed reason' } } }, 'hailuo-h3')).toMatchObject({ status: 'failed', error: 'failed reason' })
    expect(parseSnapshot({ task_id: 'waiting' }, 'hailuo-h3').status).toBe('unknown')
  })
  it('does not turn a failed Doubao task into a failed GET request', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 'failed', error: { message: 'rejected content' } })))
    const result = await requestVideo('https://gateway.example', 'test-key')
    expect(parseSnapshot(result).status).toBe('failed')
  })
  it('rejects native business errors inside HTTP 200 without accepting a task ID', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ task_id: 'not-real', base_resp: { status_code: 1004, status_msg: 'bad credential' } })))
    await expect(requestVideo('https://gateway.example', 'test-key', {})).rejects.toThrow('bad credential')
  })
})

describe('quick retry', () => {
  it('resubmits a failed legacy H3 task using current H3 config and original inputs without overwriting draft', async () => {
    const original = failedTask()
    await db.saveTask(original)
    const draft = structuredClone(useVideoStore.getState().draft)
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method === 'POST' ? { task_id: 'new-h3-task' } : { task: { status: 'succeeded', content: { url: 'https://cdn.example/new.mp4' } } })))
    expect(await retryVideoTask(original.id)).toBe(true)
    const post = fetch.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(post[0]).toBe('https://gateway.example/prefix/hailuo/v2/video_generation')
    expect((post[1]!.headers as Record<string, string>).Authorization).toBe('Bearer hailuo-test')
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({ model: 'MiniMax-H3', content: [{ type: 'text', text: 'Original description' }], duration: 5, resolution: '768P' })
    expect(useVideoStore.getState().draft).toEqual(draft)
    const next = (await db.readAll<VideoTask>('videoTasks')).find(t => t.id !== original.id)!
    expect(next).toMatchObject({ retryOfTaskId: original.id, groupId: 'original-group', route: VIDEO_PROVIDERS.hailuoVideo, gatewayTaskId: 'new-h3-task' })
    expect(await db.readOne('videoTasks', original.id)).toMatchObject({ status: 'failed', isFavorite: true })
    await vi.waitFor(() => expect(fetch.mock.calls.some(c => String(c[0]).endsWith('/hailuo/v2/query/video_generation/new-h3-task'))).toBe(true))
  })
  it('blocks pending and uncertain tasks from creating another paid submission', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    for (const patch of [{ status: 'running' as const }, { submissionState: 'submit_unknown' as const }]) {
      await db.saveTask(failedTask(patch))
      await expect(retryVideoTask('failed-original')).rejects.toThrow()
    }
    expect(fetch).not.toHaveBeenCalled()
  })
  it('serializes duplicate retry clicks while the POST is pending', async () => {
    await db.saveTask(failedTask())
    let release!: (response: Response) => void
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => init?.method === 'POST' ? new Promise<Response>(resolve => { release = resolve }) : new Response('{"task":{"status":"queued"}}'))
    const first = retryVideoTask('failed-original')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    expect(await retryVideoTask('failed-original')).toBe(false)
    release(new Response('{"task_id":"retry-id"}'))
    await first
    expect(fetch.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(1)
  })
  it('queries new H3 tasks through their route snapshot after settings are edited', async () => {
    const route = { ...VIDEO_PROVIDERS.hailuoVideo, queryPath: '/original/h3/query/{task_id}' }
    const record = failedTask({ id: 'snapshot', route, credentialRevision: 'h1', gatewayTaskId: 'original-id', status: 'running', submissionState: 'submitted' })
    await db.saveTask(record)
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"task":{"status":"running"}}'))
    await syncVideoTask(record.id, true)
    expect(fetch.mock.calls[0][0]).toBe('https://gateway.example/prefix/original/h3/query/original-id')
  })
})
