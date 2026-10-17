import { describe, expect, it, vi } from 'vitest'
import { readImageStream } from './imageStream'

function stream(text: string, chunkSize = 7) {
  const bytes = new TextEncoder().encode(text)
  return new Response(new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize))
      controller.close()
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } })
}

describe('image SSE', () => {
  it('handles split UTF-8, CRLF, named events and previews without saving intermediate images', async () => {
    const preview = vi.fn()
    const result = await readImageStream(stream([
      ': heartbeat', '',
      'event: image_generation.partial_image', 'data: {"partial_image_b64":"cHJldmlldw=="}', '',
      'event: image_generation.completed', 'data: {"b64_json":"ZmluYWw=","quality":"high","size":"1254x1254","revised_prompt":"中文提示"}', '', '',
    ].join('\r\n'), 1), 'image/png', preview)
    expect(preview).toHaveBeenCalledWith('data:image/png;base64,cHJldmlldw==')
    expect(result.images).toEqual(['data:image/png;base64,ZmluYWw='])
    expect(result.actualParams).toEqual({ quality: 'high', size: '1254x1254' })
    expect(result.revisedPrompts).toEqual(['中文提示'])
  })

  it('deduplicates Responses output_item.done against response.completed', async () => {
    const item = { type: 'image_generation_call', id: 'img-1', result: 'ZmluYWw=', quality: 'max' }
    const result = await readImageStream(stream([
      `data: ${JSON.stringify({ type: 'response.output_item.done', item })}`, '',
      `data: ${JSON.stringify({ type: 'response.completed', response: { output: [item] } })}`, '', '',
    ].join('\n')), 'image/png')
    expect(result.images).toHaveLength(1)
    expect(result.actualParams?.quality).toBe('max')
  })

  it('accepts a terminal Images payload with per-image metadata and no trailing newline', async () => {
    const result = await readImageStream(stream('data: {"data":[{"b64_json":"Zg==","quality":"medium"}],"quality":"high"}'), 'image/png')
    expect(result.actualParams?.quality).toBe('medium')
  })

  it('rejects a disconnected stream that only contains a preview', async () => {
    await expect(readImageStream(stream('data: {"type":"image_generation.partial_image","partial_image_b64":"cA=="}\n\n'), 'image/png')).rejects.toThrow(/final|最终/)
  })

  it('propagates upstream errors rather than declaring a partial result successful', async () => {
    await expect(readImageStream(stream('event: error\ndata: {"error":{"message":"quota exceeded"}}\n\n'), 'image/png')).rejects.toThrow('quota exceeded')
  })

  it('cancels a pending reader when the request is aborted', async () => {
    const cancelled = vi.fn()
    const controller = new AbortController()
    const response = new Response(new ReadableStream({ cancel: cancelled }))
    const pending = readImageStream(response, 'image/png', undefined, controller.signal)
    controller.abort(new Error('cancelled by user'))
    await expect(pending).rejects.toThrow('cancelled by user')
    expect(cancelled).toHaveBeenCalledOnce()
  })
})
