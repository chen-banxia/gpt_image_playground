import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildVideoRequest, defaultDraft, effectiveParams, modelFor, validateDraft, VIDEO_MODELS } from './models'
import { normalizeGateway, parseSnapshot, requestVideo, safeMediaUrl, videoEndpoint, VideoApiError } from './api'
import * as db from './db'
import type { VideoAsset, VideoTask } from './types'
import { importVideoBackup, validateBackup } from './backup'
import { useStore as useImageStore } from '../../store'
import { useVideoStore, syncVideoTask, reauthorizeTask, submitVideo, removeVideoTasks } from './store'
import { useVideoSettings } from './settings'
import { VIDEO_PROVIDERS } from './providers'

const asset = (id = 'image'): VideoAsset => ({ id, name: `${id}.png`, mediaType: 'image', mimeType: 'image/png', sizeBytes: 10, createdAt: 1 })
const task = (overrides: Partial<VideoTask> = {}): VideoTask => ({ id: 'local', modelId: VIDEO_MODELS[0].id, keySlot: 'doubaoVideo', credentialRevision: 'r1', gatewayBaseUrl: 'https://gateway.example/sub', proxy: false, prompt: 'A moving scene', inputMode: 'frames', inputs: [], params: defaultDraft().params, submissionState: 'submitted', gatewayTaskId: 'remote', status: 'running', syncState: 'syncing', groupId: null, isFavorite: false, createdAt: 1, updatedAt: 1, ...overrides })
beforeEach(async () => {
  await db.clearVideo(true)
  useVideoStore.setState({ ready: true, tasks: [], assets: [], draft: { ...defaultDraft(), prompt: 'test scene' }, error: '', submitting: false })
  useVideoSettings.setState({ settings: { gatewayBaseUrl: 'https://gateway.example/sub', proxy: false, doubaoVideo: { apiKey: 'doubao-test-key', remember: false, revision: 'r1' }, hailuoVideo: { apiKey: 'hailuo-test-key', remember: false, revision: 'h1' } } })
})
afterEach(() => vi.restoreAllMocks())

describe('New API Doubao contract', () => {
  it('uses exactly the five models and binds four keys to doubao and H3 to hailuo', () => {
    expect(VIDEO_MODELS).toHaveLength(5)
    expect(VIDEO_MODELS.filter(m => m.keySlot === 'doubaoVideo')).toHaveLength(4)
    expect(modelFor('MiniMax-H3').keySlot).toBe('hailuoVideo')
    expect(() => modelFor('MiniMax-Hailuo-2.3')).toThrow()
  })
  it('preserves deployment prefix and encodes task IDs', () => {
    expect(videoEndpoint('https://gateway.example/sub/', 'id/123')).toBe('https://gateway.example/sub/doubao/api/v3/contents/generations/tasks/id%2F123')
    expect(videoEndpoint('https://gateway.example', undefined, true)).toBe('/video-api-proxy/doubao/api/v3/contents/generations/tasks')
    expect(() => normalizeGateway('https://gateway.example/v1')).toThrow()
    expect(() => normalizeGateway('https://secret:pass@example.com')).toThrow()
  })
  it('creates JSON text-only input without mode, n or image fields', () => {
    const request = buildVideoRequest({ ...defaultDraft(), prompt: ' hello ' }, [])
    expect(request).toEqual({ model: VIDEO_MODELS[0].id, content: [{ type: 'text', text: 'hello' }], duration: 5, resolution: '720p', ratio: '16:9' })
  })
  it('serializes start/end roles and applies adaptive only to 2.5 frames', () => {
    const draft = { ...defaultDraft(), modelId: VIDEO_MODELS[3].id, frames: [{ assetId: 'a', role: 'first_frame' as const }, { assetId: 'b', role: 'last_frame' as const }] }
    const body = buildVideoRequest(draft, draft.frames.map(i => ({ ...i, url: 'https://assets.example/' + i.assetId })))
    expect(body.ratio).toBe('adaptive')
    expect((body.content as any[]).slice(1).map(i => i.role)).toEqual(['first_frame', 'last_frame'])
    expect(effectiveParams({ ...draft, inputMode: 'reference' }).ratio).toBe('16:9')
  })
  it('preserves H3 identity, resolution and reference content without unsupported switches', () => {
    const draft = { ...defaultDraft(), modelId: 'MiniMax-H3', inputMode: 'reference' as const, params: { duration: 5, resolution: '768P', ratio: '16:9', watermark: true, generate_audio: true } }
    const body = buildVideoRequest(draft, [{ assetId: 'a', role: 'reference_video', url: 'https://a.example/a.mp4' }, { assetId: 'b', role: 'reference_audio', url: 'https://a.example/a.mp3' }])
    expect(body.model).toBe('MiniMax-H3'); expect(body.resolution).toBe('768P')
    expect(body.watermark).toBeUndefined(); expect(body.generate_audio).toBeUndefined()
    expect((body.content as any[])[1]).toMatchObject({ type: 'video_url', role: 'reference_video' })
  })
  it('does not interpret id-only snapshots or arbitrary nested urls as success', () => {
    expect(parseSnapshot({ id: 'x' }).status).toBe('unknown')
    expect(parseSnapshot({ status: 'succeeded', input: { url: 'https://wrong.example' } }).videoUrl).toBeUndefined()
    expect(parseSnapshot({ status: 'succeeded', content: { video_url: 'https://cdn.example/video.mp4' } }).videoUrl).toBe('https://cdn.example/video.mp4')
    expect(safeMediaUrl('javascript:alert(1)')).toBeUndefined()
  })
  it('sets Bearer and JSON headers for POST and no request body for GET', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"id":"task"}', { status: 200 }))
    await requestVideo('https://gateway.example', 'key', { model: 'm' })
    expect(mock.mock.calls[0][1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer key', 'Content-Type': 'application/json' }, body: '{"model":"m"}' })
    mock.mockResolvedValue(new Response('{"id":"task"}'))
    await requestVideo('https://gateway.example', 'key')
    expect(mock.mock.calls[1][1]).toMatchObject({ method: 'GET', body: undefined })
  })
  it('redacts keys and reads rate limit retry hints', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"error":{"message":"bad secret"}}', { status: 429, headers: { 'Retry-After': '23' } }))
    try { await requestVideo('https://gateway.example', 'secret'); expect.unreachable() } catch (e) {
      expect(e).toBeInstanceOf(VideoApiError); expect((e as VideoApiError).retryAfter).toBe(23); expect((e as Error).message).not.toContain('secret')
    }
  })
})

describe('model and material validation', () => {
  it('rejects fast 1080p, H3 adaptive text-only and missing first frame', () => {
    expect(validateDraft({ ...defaultDraft(), prompt: 'test', modelId: VIDEO_MODELS[1].id, params: { duration: 5, resolution: '1080p', ratio: '16:9' } }, [])).toEqual(expect.arrayContaining([expect.stringContaining('不支持')]))
    expect(validateDraft({ ...defaultDraft(), prompt: 'test', modelId: 'MiniMax-H3', params: { duration: 5, resolution: '768P', ratio: 'adaptive' } }, []).join()).toContain('明确')
    expect(validateDraft({ ...defaultDraft(), prompt: 'test', frames: [{ assetId: 'image', role: 'last_frame' }] }, [asset()]).join()).toContain('首帧')
  })
  it('rejects mixed modes, missing assets and unsupported audio-only combinations', () => {
    expect(validateDraft({ ...defaultDraft(), prompt: 'test', frames: [{ assetId: 'missing', role: 'reference_image' }] }, []).length).toBeGreaterThan(1)
    expect(validateDraft({ ...defaultDraft(), prompt: 'test', inputMode: 'reference', references: [{ assetId: 'audio', role: 'reference_audio' }] }, [{ ...asset('audio'), mediaType: 'audio', mimeType: 'audio/mpeg' }]).join()).toContain('图片或视频')
  })
  it('checks duration, counts and whole reference duration without silently truncating', () => {
    const a = { ...asset('v'), mediaType: 'video' as const, mimeType: 'video/mp4', duration: 16, remoteUrl: 'https://a.example/v.mp4' }
    expect(validateDraft({ ...defaultDraft(), prompt: 'test', inputMode: 'reference', references: [{ assetId: 'v', role: 'reference_video' }] }, [a]).join()).toContain('15')
  })
})

describe('separate video storage', () => {
  it('commits blobs and metadata together in the independent database', async () => {
    await db.saveAsset(asset(), new Blob(['abc']))
    expect((await db.openVideoDb()).name).toBe('gpt-video-playground')
    expect((await db.readOne<{ blob: Blob }>('assetBlobs', 'image'))?.blob.size).toBe(3)
  })
  it('patches remote fields without overwriting favorites, grouping or download state', async () => {
    await db.saveTask(task({ groupId: 'group', isFavorite: true, downloadedAt: 100 }))
    await db.patchTasks(['local'], { status: 'succeeded', videoUrl: 'https://cdn.example/video.mp4' })
    expect(await db.readOne('videoTasks', 'local')).toMatchObject({ groupId: 'group', isFavorite: true, downloadedAt: 100, status: 'succeeded' })
  })
  it('does not resurrect deleted records from late responses', async () => {
    await db.saveTask(task()); await db.deleteTasks(['local']); await db.patchTasks(['local'], { status: 'succeeded' })
    expect(await db.readOne('videoTasks', 'local')).toBeUndefined()
  })
  it('keeps assets referenced by either mode draft while cleaning unreferenced files', async () => {
    for (const id of ['start', 'reference', 'orphan']) await db.saveAsset(asset(id), new Blob([id]))
    await db.saveDraft({ ...defaultDraft(), frames: [{ assetId: 'start', role: 'first_frame' }], references: [{ assetId: 'reference', role: 'reference_image' }] })
    expect(await db.cleanUnusedAssets()).toBe(1)
    expect((await db.readAll<VideoAsset>('inputAssets')).map(a => a.id).sort()).toEqual(['reference', 'start'])
    await db.clearVideo(false)
    expect(await db.readOne('drafts', 'main')).toBeDefined()
  })
})

describe('submission and recovery', () => {
  it.each(VIDEO_MODELS.map(m => [m.id, m.keySlot]))('routes %s to its configured key', async (modelId, slot) => {
    useVideoStore.setState({ draft: { ...defaultDraft(), prompt: 'scene', modelId, params: { duration: 5, ratio: '16:9', resolution: modelId === 'MiniMax-H3' ? '768P' : '720p' } } })
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => new Response(JSON.stringify(init?.method === 'POST' ? slot === 'hailuoVideo' ? { task_id: 'remote' } : { id: 'remote' } : slot === 'hailuoVideo' ? { task: { id: 'remote', status: 'running' } } : { id: 'remote', status: 'running' })))
    await submitVideo()
    const post = mock.mock.calls.find(c => c[1]?.method === 'POST')!
    expect(post[0]).toBe('https://gateway.example/sub' + VIDEO_PROVIDERS[slot as 'doubaoVideo' | 'hailuoVideo'].createPath)
    expect((post[1]?.headers as any).Authorization).toBe(`Bearer ${slot === 'doubaoVideo' ? 'doubao-test-key' : 'hailuo-test-key'}`)
    await vi.waitFor(() => expect(useVideoStore.getState().tasks[0]?.gatewayTaskId).toBe('remote'))
  })
  it('never POSTs when task persistence fails', async () => {
    vi.spyOn(db, 'saveTask').mockRejectedValue(new Error('quota'))
    const mock = vi.spyOn(globalThis, 'fetch')
    await submitVideo()
    expect(mock).not.toHaveBeenCalled(); expect(useVideoStore.getState().error).toContain('quota')
  })
  it('keeps uncertain POST failures for reconciliation, without automatic resubmission', async () => {
    const mock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))
    await submitVideo()
    expect(mock).toHaveBeenCalledTimes(1)
    expect(useVideoStore.getState().tasks[0].submissionState).toBe('submit_unknown')
  })
  it('queries using the original key slot and does not regress a completed task', async () => {
    const t = task({ id: 'recover', status: 'succeeded', videoUrl: 'https://cdn.example/old.mp4' })
    await db.saveTask(t)
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"status":"running"}'))
    await syncVideoTask(t.id, true)
    expect((mock.mock.calls[0][1]?.headers as any).Authorization).toBe('Bearer doubao-test-key')
    expect(await db.readOne('videoTasks', t.id)).toMatchObject({ status: 'succeeded', videoUrl: 'https://cdn.example/old.mp4' })
  })
  it('blocks imported or rotated credentials until explicitly rebound to the same gateway', async () => {
    const t = task({ id: 'imported', credentialRevision: 'import-needs-auth' })
    await db.saveTask(t)
    const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"status":"running"}'))
    await syncVideoTask(t.id, true)
    expect(mock).not.toHaveBeenCalled()
    expect(await db.readOne('videoTasks', t.id)).toMatchObject({ syncState: 'auth_required' })
    await reauthorizeTask(t)
    expect(mock).toHaveBeenCalledTimes(1)
  })
  it('rejects image backups and invalid result links', () => {
    expect(() => validateBackup({ version: 2, tasks: [] })).toThrow()
    expect(() => validateBackup({ kind: 'gpt-video-playground-backup', formatVersion: 1, tasks: [task({ videoUrl: 'javascript:evil()' })], assets: [], groups: [] })).toThrow()
  })
  it('imports independent history with remapped groups, roles and preserved advanced parameters', async () => {
    useImageStore.setState({ groups: [] })
    const original = task({ groupId: 'old-group', params: { ...defaultDraft().params, generate_audio: false, output_format: 'mov' }, inputs: [{ assetId: 'a', role: 'first_frame' }], downloadedAt: 123 })
    const backup = { kind: 'gpt-video-playground-backup', formatVersion: 1, tasks: [original], assets: [asset('a')], groups: [{ id: 'old-group', name: '导入分组' }], drafts: [{ ...defaultDraft(), prompt: 'restored', frames: original.inputs }] }
    const file = new File([JSON.stringify(backup)], 'history.json', { type: 'application/json' })
    expect(await importVideoBackup(file, [], true)).toBe(1)
    const imported = (await db.readAll<VideoTask>('videoTasks'))[0]
    expect(imported.groupId).toBe(useImageStore.getState().groups[0].id)
    expect(imported.syncState).toBe('auth_required')
    expect(imported.params.generate_audio).toBe(false)
    expect(imported.inputs[0]).toMatchObject({ role: 'first_frame' })
    expect(imported.inputs[0].assetId).not.toBe('a')
    expect(imported.downloadedAt).toBe(123)
    expect(useVideoStore.getState().draft.prompt).toBe('restored')
    expect(await importVideoBackup(file, useImageStore.getState().groups)).toBe(0)
    expect((await db.readAll<VideoTask>('videoTasks')).length).toBe(1)
    useImageStore.setState({ groups: [] })
  })
})
