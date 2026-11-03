import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestVideo } from './api'
import { loadVideoSettings, persistSettings, useVideoSettings, VIDEO_SETTINGS_KEY } from './settings'
import { normalizeVideoSubmitTimeout } from './timeouts'
import { submitVideo, syncVideoTask, useVideoStore } from './store'
import { defaultDraft } from './models'
import * as db from './db'
import type { VideoTask } from './types'

function pendingRequest() {
  let signal!: AbortSignal
  vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
    signal = init!.signal as AbortSignal
    return new Promise((_resolve, reject) => {
      if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'))
      else signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    })
  })
  return () => signal
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('video HTTP timeouts', () => {
  beforeEach(() => vi.useFakeTimers())
  it('keeps a submission alive beyond 60 seconds and aborts only at 600 seconds by default', async () => {
    const getSignal = pendingRequest()
    const result = requestVideo('https://example.com/create', 'secret', {}).catch(e => e)
    await vi.advanceTimersByTimeAsync(60000)
    expect(getSignal().aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(539999)
    expect(getSignal().aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect((await result).message).toContain('600')
    expect((await result).status).toBe(0)
    expect(getSignal().aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('keeps GET queries at 60 seconds even when a longer submission timeout is configured', async () => {
    const getSignal = pendingRequest()
    const result = requestVideo('https://example.com/query', 'secret', undefined, undefined, 300).catch(e => e)
    await vi.advanceTimersByTimeAsync(60000)
    expect(getSignal().aborted).toBe(true)
    expect((await result).message).toContain('60')
    expect((await result).message).toContain('不会重新提交')
  })
  it('uses a configured submission timeout even with an external signal', async () => {
    const getSignal = pendingRequest()
    const caller = new AbortController()
    const result = requestVideo('https://example.com/create', 'secret', {}, caller.signal, 120).catch(e => e)
    await vi.advanceTimersByTimeAsync(120000)
    expect(getSignal().aborted).toBe(true)
    expect(caller.signal.aborted).toBe(false)
    expect((await result).message).toContain('120')
  })
  it('distinguishes caller cancellation and clears its timer', async () => {
    pendingRequest()
    const caller = new AbortController()
    const result = requestVideo('https://example.com/create', 'secret', {}, caller.signal).catch(e => e)
    caller.abort()
    expect((await result).message).toContain('已中断')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('covers response-body reading and does not misreport its timeout as invalid JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => ({
      ok: true, status: 200,
      json: () => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })),
    } as Response))
    const result = requestVideo('https://example.com/create', 'secret', {}, undefined, 5).catch(e => e)
    await vi.advanceTimersByTimeAsync(5000)
    expect((await result).message).toContain('提交等待超过 5 秒')
    expect((await result).message).not.toContain('JSON')
  })
  it('clears the timeout on success or parse failure', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"id":"task"}'))
    await expect(requestVideo('https://example.com/create', 'secret', {})).resolves.toEqual({ id: 'task' })
    expect(vi.getTimerCount()).toBe(0)
    fetch.mockResolvedValue(new Response('invalid'))
    await expect(requestVideo('https://example.com/create', 'secret', {})).rejects.toThrow('JSON')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('timeout settings', () => {
  it('migrates missing values, preserves configured values and enforces bounds', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
    values.set(VIDEO_SETTINGS_KEY, JSON.stringify({ version: 2, gatewayBaseUrl: 'https://custom.example' }))
    expect(loadVideoSettings().submitTimeoutSeconds).toBe(600)
    persistSettings({ ...loadVideoSettings(), submitTimeoutSeconds: 180 })
    expect(loadVideoSettings()).toMatchObject({ submitTimeoutSeconds: 180, gatewayBaseUrl: 'https://custom.example' })
    expect(normalizeVideoSubmitTimeout(900)).toBe(600)
    expect(normalizeVideoSubmitTimeout(0)).toBe(600)
    expect(normalizeVideoSubmitTimeout(NaN)).toBe(600)
  })
})

describe('task behavior on timeout', () => {
  it('retains uncertain submissions without automatically submitting again', async () => {
    await db.clearVideo(true)
    useVideoStore.setState({ draft: { ...defaultDraft(), prompt: 'test' }, assets: [], submitting: false, tasks: [] })
    useVideoSettings.setState({ settings: { ...useVideoSettings.getState().settings, gatewayBaseUrl: 'https://example.com', submitTimeoutSeconds: 1, doubaoVideo: { apiKey: 'test', remember: false, revision: 'r1' } } })
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))))
    expect(await submitVideo()).toBe(false)
    const tasks = await db.readAll<VideoTask>('videoTasks')
    expect(tasks[0]).toMatchObject({ status: 'unknown', submissionState: 'submit_unknown' })
    expect(tasks[0].error).toContain('1 秒')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
