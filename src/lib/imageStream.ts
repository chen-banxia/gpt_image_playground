import { tCurrent } from '../i18n'
import type { CallApiResult } from './imageApiShared'
import { fetchImageUrlAsDataUrl, isDataUrl, isHttpUrl, mergeActualParams, MIME_MAP, normalizeBase64Image, pickActualParams } from './imageApiShared'

type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue => value && typeof value === 'object' ? value as RecordValue : {}

/** SSE 的网络分片不等于事件；同时兼容命名事件、心跳、CRLF 和多行 data。 */
export async function readImageStream(
  response: Response,
  fallbackMime: string,
  onPartialImage?: (image: string) => void,
  signal?: AbortSignal,
): Promise<CallApiResult> {
  if (!response.body) throw new Error(tCurrent('apiNoImageData'))
  const reader = response.body.getReader()
  // 同一个解码器跨分片保留 UTF-8 状态，防止中文字符被网络分片截断后乱码。
  const decoder = new TextDecoder()
  const images = new Map<string, { image: string; params: ReturnType<typeof mergeActualParams>; prompt?: string }>()
  let buffer = ''
  let dataLines: string[] = []
  let eventName = ''
  let completed = false
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener('abort', abort, { once: true })

  async function addImage(item: RecordValue, key: string, metadata: RecordValue = {}) {
    const result = record(item.result)
    const b64 = item.b64_json ?? (typeof item.result === 'string' ? item.result : result.b64_json)
    const url = item.url
    const params = mergeActualParams(pickActualParams(metadata), pickActualParams(item))
    const mime = MIME_MAP[params?.output_format ?? ''] || fallbackMime
    const image = typeof b64 === 'string' && b64.trim()
      ? normalizeBase64Image(b64, mime)
      : isHttpUrl(url) || isDataUrl(url) ? await fetchImageUrlAsDataUrl(url, mime, signal) : ''
    if (image) images.set(key, { image, params, prompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : undefined })
  }

  async function dispatch() {
    const data = dataLines.join('\n')
    const name = eventName
    dataLines = []
    eventName = ''
    if (!data || data === '[DONE]') return
    let event: RecordValue
    try { event = record(JSON.parse(data)) } catch { throw new Error(tCurrent('imageStreamInvalid')) }
    const type = typeof event.type === 'string' ? event.type : name
    if (type === 'error' || event.error || type.endsWith('.failed') || type === 'response.incomplete') {
      const error = record(event.error ?? record(event.response).error)
      throw new Error(typeof error.message === 'string' ? error.message : typeof event.error === 'string' ? event.error : typeof event.message === 'string' ? event.message : tCurrent('imageStreamFailed'))
    }
    if (type.endsWith('.partial_image')) {
      const partial = event.partial_image_b64 ?? event.b64_json
      if (typeof partial === 'string' && partial) {
        onPartialImage?.(normalizeBase64Image(partial, MIME_MAP[String(event.output_format)] || fallbackMime))
      }
      return
    }
    if (type === 'response.output_item.done') {
      const item = record(event.item)
      if (item.type === 'image_generation_call') await addImage(item, String(item.id ?? event.output_index ?? 0))
    }
    if (type === 'response.completed' || Array.isArray(event.output)) {
      const payload = type === 'response.completed' ? record(event.response) : event
      if (Array.isArray(payload.output)) {
        // completed 的完整输出与 output_item.done 是同一张图，不能重复计数。
        const finalItems = payload.output.map(record).filter((item) => item.type === 'image_generation_call' && item.result)
        if (finalItems.length) {
          images.clear()
          for (const [index, item] of finalItems.entries()) await addImage(item, String(item.id ?? index))
        }
      }
      completed = true
    } else if (Array.isArray(event.data)) {
      for (const [index, item] of event.data.entries()) await addImage(record(item), String(index), event)
      completed = true
    } else if (type === 'image_generation.completed' || type === 'image_edit.completed') {
      await addImage(event, String(event.index ?? 0))
      completed = true
    }
  }

  async function line(value: string) {
    if (!value) return dispatch()
    if (value.startsWith('data:')) dataLines.push(value.slice(5).replace(/^ /, ''))
    if (value.startsWith('event:')) eventName = value.slice(6).trim()
  }

  try {
    signal?.throwIfAborted()
    while (!completed) {
      const chunk = await reader.read()
      signal?.throwIfAborted()
      buffer += decoder.decode(chunk.value, { stream: !chunk.done })
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const value = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        await line(value)
        if (completed) break
      }
      if (chunk.done) {
        if (buffer) await line(buffer.replace(/\r$/, ''))
        await dispatch()
        break
      }
    }
    // 中间预览图永远不作为成功结果保存。
    if (!images.size) throw new Error(tCurrent('imageStreamIncomplete'))
    const values = [...images.values()]
    return {
      images: values.map((item) => item.image),
      actualParams: values[0].params,
      actualParamsList: values.map((item) => item.params),
      revisedPrompts: values.map((item) => item.prompt),
    }
  } finally {
    signal?.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
