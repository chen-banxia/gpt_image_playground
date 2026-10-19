import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PARAMS } from '../types'
import { DEFAULT_SETTINGS } from './apiProfiles'
import { callImageApi } from './api'
import { fetchImageUrlAsDataUrl } from './imageApiShared'
import * as transparentImage from './transparentImage'
import * as exactImageSize from './exactImageSize'

describe('callImageApi', () => {
  it.each(['gpt-image-2.5-flare', 'gpt-image-2.5-flare-2k', 'gpt-image-2.5-sunburst-4k'])(
    'preserves the gateway image for %s by default without local resizing', async (model) => {
      const resize = vi.spyOn(exactImageSize, 'applyExactImageSize')
      const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
        data: [{ b64_json: 'Z2F0ZXdheQ==' }], size: '2048x2048', quality: 'low',
      }), { headers: { 'Content-Type': 'application/json' } }))
      const result = await callImageApi({
        settings: { ...DEFAULT_SETTINGS, model, apiKey: 'test' },
        params: { ...DEFAULT_PARAMS, size: '3840x1648', quality: 'high' },
        prompt: 'draw', inputImageDataUrls: [],
      })
      expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ model: model === 'gpt-image-2.5-flare' ? 'gpt-image-2.5-flare-4k' : model, size: '3840x1648', quality: 'high' })
      expect(resize).not.toHaveBeenCalled()
      expect(result.images).toEqual(['data:image/png;base64,Z2F0ZXdheQ=='])
      expect(result.actualParams).toMatchObject({ size: '2048x2048', quality: 'low' })
      expect(result.actualParams?.source_size).toBeUndefined()
    },
  )
  it.each(['images', 'responses'] as const)('uses a compatible %s request size but keeps an exact final target and reported quality', async (apiMode) => {
    const payload = apiMode === 'images'
      ? { quality: 'low', size: '1145x1374', data: [{ b64_json: 'Zg==' }] }
      : { output: [{ type: 'image_generation_call', quality: 'low', size: '1145x1374', result: 'Zg==' }] }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } }))
    const resize = vi.spyOn(exactImageSize, 'applyExactImageSize').mockResolvedValue({ image: 'data:image/png;base64,ZXhhY3Q=', sourceSize: '1145x1374', resized: true })
    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiMode, apiKey: 'test' },
      params: { ...DEFAULT_PARAMS, size: '1920x1080', size_fit: 'pad', quality: 'high' },
      prompt: 'draw', inputImageDataUrls: [],
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const sent = apiMode === 'responses' ? body.tools[0] : body
    expect(sent).toMatchObject({ size: '1920x1088', quality: 'high' })
    expect(sent.size_fit).toBeUndefined()
    expect(resize).toHaveBeenCalledWith('data:image/png;base64,Zg==', expect.objectContaining({ size: '1920x1080', size_fit: 'pad' }), undefined)
    expect(result.actualParams).toMatchObject({ size: '1920x1080', source_size: '1145x1374', quality: 'low', size_fit: 'pad' })
    expect(result.images).toEqual(['data:image/png;base64,ZXhhY3Q='])
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it.each(['images', 'responses'] as const)('injects composition only into the %s request and strips exact upstream echoes', async (apiMode) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body))
      const prompt = apiMode === 'images' ? body.prompt : body.input
      const item = { b64_json: 'Zg==', revised_prompt: prompt, quality: 'low' }
      const payload = apiMode === 'images' ? { data: [item] } : { output: [{ ...item, type: 'image_generation_call', result: 'Zg==' }] }
      return new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } })
    })
    const opts = {
      settings: { ...DEFAULT_SETTINGS, apiMode, apiKey: 'test', model: apiMode === 'images' ? 'gpt-image-2.5-flare' : 'gpt-5.5' },
      prompt: '画一个可爱的小狗', inputImageDataUrls: [],
      params: { ...DEFAULT_PARAMS, size: '3840x1648', quality: 'high' as const },
    }
    const result = await callImageApi(opts)
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const prompt = apiMode === 'images' ? body.prompt : body.input
    expect(prompt).toContain('Target canvas: 3840x1648')
    expect(prompt).toContain('landscape')
    expect(prompt).toContain('complete intended subject')
    expect(opts.prompt).toBe('画一个可爱的小狗')
    expect(opts.settings.model).toBe(apiMode === 'images' ? 'gpt-image-2.5-flare' : 'gpt-5.5')
    expect(result.requestModel).toBe(apiMode === 'images' ? 'gpt-image-2.5-flare-4k' : 'gpt-5.5')
    expect(result.revisedPrompts?.[0]).not.toContain('[Image canvas requirements]')
    expect(result.revisedPrompts?.[0]).toContain(opts.prompt)
  })

  it('injects outpainting guidance into multipart edits without changing user content', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).startsWith('data:')) return new Response(new Blob(['png'], { type: 'image/png' }))
      return new Response(JSON.stringify({ data: [{ b64_json: 'Zg==' }] }), { headers: { 'Content-Type': 'application/json' } })
    })
    await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test', model: 'gpt-image-2.5-sunburst' },
      prompt: '保留小狗', inputImageDataUrls: ['data:image/png;base64,Zg=='],
      params: { ...DEFAULT_PARAMS, size: '2560x1440', size_fit: 'none', quality: 'high' },
    })
    const form = fetchMock.mock.calls.find(([, init]) => init?.body instanceof FormData)![1]!.body as FormData
    expect(form.get('model')).toBe('gpt-image-2.5-sunburst-2k')
    expect(form.get('prompt')).toContain('outpaint the surrounding scene')
    expect(form.get('prompt')).toContain('保留小狗')
    expect(form.get('size')).toBe('2560x1440')
    expect(form.get('quality')).toBe('high')
  })

  it.each([false, true])('fits the screenshot case only with explicit padding (stream=%s)', async (stream) => {
    // 不 mock 尺寸处理器，走实际的参数归一化、解码、画布处理和结果存储元数据。
    vi.stubGlobal('Image', class {
      naturalWidth = 1254
      naturalHeight = 1254
      onload: (() => void) | null = null
      set src(_value: string) { queueMicrotask(() => this.onload?.()) }
    })
    const drawImage = vi.fn()
    const canvas = { width: 0, height: 0, getContext: () => ({ drawImage }), toDataURL: vi.fn(() => {
      expect([canvas.width, canvas.height]).toEqual([3840, 1648])
      return 'data:image/png;base64,ZXhhY3Q='
    }) }
    vi.stubGlobal('document', { createElement: () => canvas })
    const payload = stream
      ? 'data: {"type":"image_generation.completed","b64_json":"Zg==","quality":"low","size":"1254x1254"}\n\n'
      : JSON.stringify({ data: [{ b64_json: 'Zg==' }], quality: 'low', size: '1254x1254' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(payload, {
      headers: { 'Content-Type': stream ? 'text/event-stream' : 'application/json' },
    }))
    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, model: 'gpt-image-2.5-flare', apiKey: 'test' },
      params: { ...DEFAULT_PARAMS, size: '3840x1648', quality: 'high', stream, size_fit: 'pad' },
      prompt: 'a puppy', inputImageDataUrls: [],
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ size: '3840x1648', quality: 'high' })
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 1096, 0, 1648, 1648)
    expect(result.images).toEqual(['data:image/png;base64,ZXhhY3Q='])
    expect(result.actualParams).toMatchObject({ size: '3840x1648', source_size: '1254x1254', size_fit: 'pad', quality: 'low' })
    expect(result.actualParamsList?.[0]).toEqual(result.actualParams)
  })

  it.each([
    'gpt-image-2-2k', 'gpt-image-2-4k',
    'gpt-image-2.5-flare-2k', 'gpt-image-2.5-flare-4k',
    'gpt-image-2.5-sunburst-2k', 'gpt-image-2.5-sunburst-4k',
  ])('preserves codex2api model alias %s for generation and editing', async (model) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).startsWith('data:')) return new Response(new Blob(['png'], { type: 'image/png' }))
      return new Response(JSON.stringify({ data: [{ b64_json: 'Zg==' }] }), { headers: { 'Content-Type': 'application/json' } })
    })
    const size = model.endsWith('-4k') ? '3840x2160' : '2560x1440'
    for (const isEdit of [false, true]) {
      await callImageApi({
        settings: { ...DEFAULT_SETTINGS, model, apiKey: 'test', apiMode: 'images' },
        prompt: 'draw', inputImageDataUrls: isEdit ? ['data:image/png;base64,Zg=='] : [],
        params: { ...DEFAULT_PARAMS, size, quality: 'high', size_fit: 'none' },
      })
      const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
      expect(String(url)).toContain(isEdit ? '/images/edits' : '/images/generations')
      const body = init?.body instanceof FormData
        ? Object.fromEntries(init.body.entries()) : JSON.parse(String(init?.body))
      expect(body).toMatchObject({ model, size, quality: 'high' })
    }
  })

  it('postprocesses transparent output locally without requesting native background support', async () => {
    const remove = vi.spyOn(transparentImage, 'removeKeyedBackgroundFromDataUrl').mockResolvedValue('data:image/png;base64,Y2xlYW4=')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      data: [{ b64_json: 'cmF3' }], background: 'opaque', quality: 'high',
    }), { headers: { 'Content-Type': 'application/json' } }))
    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test' }, prompt: 'a sticker', inputImageDataUrls: [],
      params: { ...DEFAULT_PARAMS, transparent_output: true, transparent_method: 'local', size: '2048x2048', size_fit: 'none', quality: 'high' },
    })
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.prompt).toContain('#00FF00')
    expect(body.background).toBeUndefined()
    expect(body.size).toBe('2048x2048')
    expect(body.quality).toBe('high')
    expect(remove).toHaveBeenCalledOnce()
    expect(result.images).toEqual(['data:image/png;base64,Y2xlYW4='])
    expect(result.actualParams?.background).toBeUndefined()
  })

  it('keeps concurrent previews associated with their request and saves only final images', async () => {
    let requestIndex = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const index = requestIndex++
      return new Response(`data: {"type":"image_generation.partial_image","partial_image_b64":"preview${index}"}\n\ndata: {"type":"image_generation.completed","b64_json":"final${index}"}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
    })
    const preview = vi.fn()
    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test' }, prompt: 'draw', inputImageDataUrls: [],
      params: { ...DEFAULT_PARAMS, n: 2, stream: true }, onPartialImage: preview,
    })
    expect(preview).toHaveBeenCalledWith('data:image/png;base64,preview0', 0)
    expect(preview).toHaveBeenCalledWith('data:image/png;base64,preview1', 1)
    expect(result.images).toEqual(['data:image/png;base64,final0', 'data:image/png;base64,final1'])
  })

  it('sends 2K, max quality and native transparency on Images requests with streaming enabled', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      'data: {"type":"image_generation.partial_image","partial_image_b64":"cA=="}\n\ndata: {"type":"image_generation.completed","b64_json":"Zg==","quality":"medium"}\n\n',
      { headers: { 'Content-Type': 'text/event-stream' } },
    ))
    const preview = vi.fn()
    const result = await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test' }, prompt: 'draw', inputImageDataUrls: [],
      params: { ...DEFAULT_PARAMS, size: '2048x2048', quality: 'max', transparent_output: true, stream: true, size_fit: 'none' },
      onPartialImage: preview,
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      size: '2048x2048', quality: 'max', background: 'transparent', stream: true, partial_images: 2,
    })
    expect(preview).toHaveBeenCalledWith('data:image/png;base64,cA==', 0)
    expect(result.images).toEqual(['data:image/png;base64,Zg=='])
    expect(result.actualParams?.quality).toBe('medium')
  })

  it('keeps all parameters on Responses tools and selects a separate image model', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: 'image_generation_call', result: 'Zg==' }],
    }), { headers: { 'Content-Type': 'application/json' } }))
    await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test', apiMode: 'responses', model: 'gpt-5.5', imageGenerationModel: 'gpt-image-2.5-sunburst' },
      prompt: 'draw', inputImageDataUrls: [],
      params: { ...DEFAULT_PARAMS, size: '2560x1440', quality: 'xhigh', moderation: 'low', transparent_output: true, stream: true, size_fit: 'none' },
    })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      model: 'gpt-5.5', stream: true,
      tools: [{ model: 'gpt-image-2.5-sunburst', size: '2560x1440', quality: 'xhigh', moderation: 'low', background: 'transparent', partial_images: 2 }],
    })
  })

  it('keeps size, quality, transparency and stream fields on multipart image edits', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).startsWith('data:')) return new Response(new Blob(['png'], { type: 'image/png' }))
      return new Response(JSON.stringify({ data: [{ b64_json: 'Zg==' }] }), { headers: { 'Content-Type': 'application/json' } })
    })
    await callImageApi({
      settings: { ...DEFAULT_SETTINGS, apiKey: 'test' }, prompt: 'edit', inputImageDataUrls: ['data:image/png;base64,Zg=='],
      params: { ...DEFAULT_PARAMS, size: '2048x2048', quality: 'high', transparent_output: true, stream: true, size_fit: 'none' },
    })
    const form = fetchMock.mock.calls.find(([, init]) => init?.body instanceof FormData)![1]!.body as FormData
    expect(form.get('size')).toBe('2048x2048')
    expect(form.get('quality')).toBe('high')
    expect(form.get('background')).toBe('transparent')
    expect(form.get('stream')).toBe('true')
    expect(form.getAll('image[]')).toHaveLength(1)
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
      `${DEFAULT_SETTINGS.baseUrl}/images/generations`,
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
