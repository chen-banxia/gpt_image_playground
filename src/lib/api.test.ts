import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { callImageApi } from './api'
import { fetchImageUrlAsDataUrl } from './imageApiShared'

describe('callImageApi', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('retries a transient result-image download without resubmitting generation', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }))

    const resultPromise = fetchImageUrlAsDataUrl('https://example.com/result.png', 'image/png')
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(500)

    await expect(resultPromise).resolves.toMatch(/^data:image\/png;base64,/)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])(
    'adds the prompt rewrite guard on Responses API when Codex CLI mode is %s',
    async (codexCli) => {
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
        output: [{
          type: 'image_generation_call',
          result: 'aW1hZ2U=',
        }],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))

      await callImageApi({
        settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses', codexCli },
        prompt: 'prompt',
        params: { ...DEFAULT_PARAMS },
        inputImageDataUrls: [],
      })

      const [, init] = fetchMock.mock.calls[0]
      const body = JSON.parse(String((init as RequestInit).body))
      expect(body.input).toBe('Use the following text as the complete prompt. Do not rewrite it:\nprompt')
    },
  )

  it('sends the selected quality on Images API requests even in Codex CLI mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, quality: 'high' },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String((init as RequestInit).body)).quality).toBe('high')
  })

  it('sends the selected quality on Responses API image tools even in Codex CLI mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'image_generation_call', result: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', apiMode: 'responses', codexCli: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, quality: 'medium' },
      inputImageDataUrls: [],
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(String((init as RequestInit).body)).tools[0].quality).toBe('medium')
  })

  it('keeps the selected quality when Codex CLI mode splits multi-image requests', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS, quality: 'low', n: 2 },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(String((init as RequestInit).body))
      expect(body.quality).toBe('low')
      expect(body.n).toBeUndefined()
    }
  })

  it('records actual params returned on Images API responses in Codex CLI mode', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
      data: [{
        b64_json: 'aW1hZ2U=',
        revised_prompt: '移除靴子',
      }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.actualParams).toEqual({
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
    })
    expect(result.actualParamsList).toEqual([{
      output_format: 'png',
      quality: 'medium',
      size: '1033x1522',
    }])
    expect(result.revisedPrompts).toEqual(['移除靴子'])
  })

  it('does not synthesize actual quality in Codex CLI mode when the API omits it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output_format: 'png',
      size: '1033x1522',
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test-key', codexCli: true },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(result.actualParams).toEqual({
      output_format: 'png',
      size: '1033x1522',
    })
    expect(result.actualParams?.quality).toBeUndefined()
    expect(result.actualParamsList).toEqual([{
      output_format: 'png',
      size: '1033x1522',
    }])
  })

  it('uses the same-origin API proxy path when API proxy is enabled', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'true')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiProxy: true,
        baseUrl: 'http://api.example.com/v1',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api-proxy/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('ignores stored API proxy settings when the current deployment has no proxy', async () => {
    vi.stubEnv('VITE_API_PROXY_AVAILABLE', 'false')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'aW1hZ2U=' }],
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await callImageApi({
      settings: {
        ...DEFAULT_SETTINGS,
        apiKey: 'test-key',
        apiProxy: true,
        baseUrl: 'http://api.example.com/v1',
      },
      prompt: 'prompt',
      params: { ...DEFAULT_PARAMS },
      inputImageDataUrls: [],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://colorflowai.com/v1/images/generations',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
