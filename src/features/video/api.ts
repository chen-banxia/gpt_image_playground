import { tCurrent as t } from '../../i18n'
import type { GenerationState, VideoProtocol, VideoRoute } from './types'
import { validateVideoRoute, VIDEO_PROVIDERS } from './providers'
import { normalizeVideoSubmitTimeout, VIDEO_QUERY_TIMEOUT } from './timeouts'
export const VIDEO_PATH = '/doubao/api/v3/contents/generations/tasks'
export const isUnsupportedVideoModelError = (error?: string) => /model\s+["']?[^\n]*?\bis not served by (?:this|the) plugin/i.test(error ?? '')
export function normalizeGateway(value: string) {
  const url = new URL(value.trim())
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error(t("请填写不含鉴权信息或查询参数的 HTTP(S) 网关根地址"))
  if (/\/(v1|v2|doubao\/api\/v3\/contents\/generations\/tasks|hailuo\/v[12]\/(?:query\/)?video_generation)\/?$/.test(url.pathname)) throw new Error(t("请填写网关根地址，不包含 /v1 或任务路径"))
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}
export function videoEndpoint(base: string, taskId?: string, proxy = false, route: VideoRoute = VIDEO_PROVIDERS.doubaoVideo) {
  const root = normalizeGateway(base)
  const checked = validateVideoRoute(route)
  const path = taskId === undefined ? checked.createPath : checked.queryPath.replace('{task_id}', encodeURIComponent(taskId))
  return `${proxy ? '/video-api-proxy' : root}${path}`
}
export function safeMediaUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return
  try { const url = new URL(value); if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) return url.href } catch { /* 无效 URL 不进入播放器 */ }
}
export class VideoApiError extends Error {
  constructor(message: string, public status = 0, public retryAfter?: number) { super(message) }
}
export async function requestVideo(url: string, key: string, body?: unknown, signal?: AbortSignal, submitTimeoutSeconds?: number) {
  if (!key.trim()) throw new VideoApiError(t("请配置对应的视频 Key"), 401)
  const submitting = body !== undefined
  const timeout = submitting ? normalizeVideoSubmitTimeout(submitTimeoutSeconds) : VIDEO_QUERY_TIMEOUT
  const controller = new AbortController()
  let timedOut = false
  const cancel = () => controller.abort(signal?.reason)
  if (signal?.aborted) cancel()
  else signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => { timedOut = true; controller.abort() }, timeout * 1000)
  // 超时覆盖响应体读取，finally 清理定时器；外部取消也不会绕过超时保护。
  try {
    const response = await fetch(url, { method: submitting ? 'POST' : 'GET', headers: { Authorization: `Bearer ${key.trim()}`, ...(submitting ? { 'Content-Type': 'application/json' } : {}) }, body: submitting ? JSON.stringify(body) : undefined, signal: controller.signal })
    let data: any
    try { data = await response.json() } catch (error) {
      if (controller.signal.aborted) throw error
      throw new VideoApiError(t("网关没有返回有效 JSON"), response.ok ? 0 : response.status)
    }
    if (!response.ok) {
      const retry = response.headers.get('Retry-After')
      const seconds = retry ? (Number.isFinite(Number(retry)) ? Number(retry) : Math.max(0, (Date.parse(retry) - Date.now()) / 1000)) : undefined
      const message = String(data?.error?.message ?? data?.message ?? t("请求失败 ({0})", { "0": response.status })).split(key).join(t("[已隐藏]"))
      throw new VideoApiError(message.slice(0, 1000), response.status, seconds)
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new VideoApiError(t("网关响应结构无效"))
    if (data.base_resp && Number(data.base_resp.status_code) !== 0) {
      const code = Number(data.base_resp.status_code)
      throw new VideoApiError(String(data.base_resp.status_msg ?? t('网关响应结构无效')).split(key).join(t('[已隐藏]')), code === 1002 ? 429 : 400)
    }
    // GET 中 failed + error 是任务终态，不是查询请求失败。
    if (data.error && (body !== undefined || !data.status)) throw new VideoApiError(String(data.error.message ?? t('生成失败')).split(key).join(t('[已隐藏]')), 400)
    return data as Record<string, any>
  } catch (error) {
    if (timedOut) throw new VideoApiError(t(submitting ? '视频提交等待超过 {0} 秒，服务端可能已受理。请先核对 New API 任务记录，不要直接重复生成。' : '视频状态查询超过 {0} 秒，将稍后继续同步，不会重新提交生成。', { 0: timeout }))
    if (signal?.aborted) throw new VideoApiError(t('视频请求已中断，服务端任务不一定取消。请核对任务状态。'))
    if (error instanceof VideoApiError) throw error
    throw new VideoApiError(t('无法连接网关，请检查网络或跨域设置'))
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', cancel)
  }
}
export function createdVideoId(data: Record<string, any>, protocol: VideoProtocol) {
  const id = protocol === 'hailuo-h3' ? data.task_id : data.id
  return typeof id === 'string' && id.trim() ? id : undefined
}
export function parseSnapshot(data: Record<string, any>, protocol: VideoProtocol = 'doubao') {
  const snapshot = protocol === 'hailuo-h3' ? data.task : data
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return { status: 'unknown' as const, rawStatus: undefined, videoUrl: undefined, lastFrameUrl: undefined, error: undefined, actualParams: {} }
  const states: GenerationState[] = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'expired']
  const status: GenerationState = states.includes(snapshot.status) ? snapshot.status : 'unknown'
  return { status, rawStatus: typeof snapshot.status === 'string' ? snapshot.status : undefined, videoUrl: safeMediaUrl(protocol === 'hailuo-h3' ? snapshot.content?.url : snapshot.content?.video_url), lastFrameUrl: safeMediaUrl(snapshot.content?.last_frame_url), error: snapshot.error ? String(snapshot.error.message ?? t("生成失败")).slice(0, 1000) : undefined,
    actualParams: Object.fromEntries(['duration', 'resolution', 'ratio', 'framespersecond', 'generate_audio'].filter(k => ['string', 'number', 'boolean'].includes(typeof snapshot[k])).map(k => [k, snapshot[k]])) }
}
