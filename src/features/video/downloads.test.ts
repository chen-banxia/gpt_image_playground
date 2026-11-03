import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { downloadVideos, readMedia, useVideoDownloads } from './downloads'
import { useVideoStore } from './store'
import * as db from './db'
import type { VideoTask } from './types'
import { defaultDraft, VIDEO_MODELS } from './models'

const task = (id: string): VideoTask => ({ id, modelId: VIDEO_MODELS[0].id, keySlot: 'doubaoVideo', credentialRevision: 'test', gatewayBaseUrl: 'https://gateway.example', proxy: false, prompt: id, inputMode: 'frames', inputs: [], params: defaultDraft().params, submissionState: 'submitted', status: 'succeeded', syncState: 'paused', videoUrl: `https://cdn.example/${id}.mp4`, isFavorite: false, groupId: null, createdAt: 1, updatedAt: 1 })
const click = vi.fn()
beforeEach(async () => {
  await db.clearVideo(true)
  useVideoDownloads.setState({ busy: false, entries: [], bytes: 0, notice: '' })
  useVideoStore.setState({ tasks: [] })
  click.mockClear()
  vi.stubGlobal('document', { createElement: () => ({ click, remove: vi.fn() }), body: { appendChild: vi.fn() } })
  vi.stubGlobal('window', { confirm: () => true })
  vi.spyOn(globalThis, 'setTimeout').mockReturnValue(0 as any)
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('video file download semantics', () => {
  it('does not send gateway credentials to result CDN', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'video/mp4' } }))
    const result = await readMedia('https://cdn.example/v.mp4', new AbortController().signal, 10, () => {})
    expect(result.bytes).toHaveLength(3)
    expect(fetch.mock.calls[0][1]).toMatchObject({ credentials: 'omit' })
    expect(fetch.mock.calls[0][1]?.headers).toBeUndefined()
  })
  it('rejects HTML and enforces actual bytes when Content-Length is absent', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('login', { headers: { 'Content-Type': 'text/html' } }))
    await expect(readMedia('https://cdn.example/v', new AbortController().signal, 100, () => {})).rejects.toThrow('视频文件')
    fetch.mockResolvedValue(new Response(new Uint8Array(11), { headers: { 'Content-Type': 'video/mp4' } }))
    await expect(readMedia('https://cdn.example/v', new AbortController().signal, 10, () => {})).rejects.toThrow('上限')
  })
  it('marks only successfully saved individual items', async () => {
    const tasks = [task('good'), task('bad')]
    for (const t of tasks) await db.saveTask(t)
    useVideoStore.setState({ tasks })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async url => String(url).includes('good') ? new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'video/mp4' } }) : new Response('failed', { status: 403 }))
    await downloadVideos(tasks, 'files')
    expect(click).toHaveBeenCalledTimes(1)
    expect((await db.readOne<VideoTask>('videoTasks', 'good'))?.downloadedAt).toBeDefined()
    expect((await db.readOne<VideoTask>('videoTasks', 'bad'))?.downloadedAt).toBeUndefined()
    expect(useVideoDownloads.getState().entries.map(e => e.state)).toEqual(['saved', 'failed'])
  })
  it('marks only included ZIP items after user accepts partial archive', async () => {
    const tasks = [task('good'), task('bad')]
    for (const t of tasks) await db.saveTask(t)
    useVideoStore.setState({ tasks })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async url => String(url).includes('good') ? new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'video/mp4' } }) : new Response('failed', { status: 403 }))
    await downloadVideos(tasks, 'zip')
    expect(click).toHaveBeenCalledTimes(1)
    expect(await db.readOne('videoTasks', 'good')).toMatchObject({ downloadSource: 'zip' })
    expect((await db.readOne<VideoTask>('videoTasks', 'bad'))?.downloadedAt).toBeUndefined()
  })
  it('does not mark any ZIP item if the partial archive is cancelled', async () => {
    vi.stubGlobal('window', { confirm: () => false })
    const tasks = [task('good'), task('bad')]
    for (const t of tasks) await db.saveTask(t)
    useVideoStore.setState({ tasks })
    vi.spyOn(globalThis, 'fetch').mockImplementation(async url => String(url).includes('good') ? new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'video/mp4' } }) : new Response('failed', { status: 403 }))
    await downloadVideos(tasks, 'zip')
    expect(click).not.toHaveBeenCalled()
    expect((await db.readOne<VideoTask>('videoTasks', 'good'))?.downloadedAt).toBeUndefined()
  })
})
