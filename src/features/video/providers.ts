import { tCurrent as t } from '../../i18n'
import type { KeySlot, VideoRoute, VideoSettings, VideoTask } from './types'

/** New API 各插件的原生路由，不以模型名称拼接或猜测端点。
 * Doubao: https://apifox.newapi.ai/525593884e0
 * H3: https://apifox.newapi.ai/525593869e0
 */
export const VIDEO_PROVIDERS: Record<KeySlot, VideoRoute> = {
  doubaoVideo: { protocol: 'doubao', createPath: '/doubao/api/v3/contents/generations/tasks', queryPath: '/doubao/api/v3/contents/generations/tasks/{task_id}' },
  hailuoVideo: { protocol: 'hailuo-h3', createPath: '/hailuo/v2/video_generation', queryPath: '/hailuo/v2/query/video_generation/{task_id}' },
}
export function validateVideoRoute(route: VideoRoute): VideoRoute {
  // 只允许网关内相对路径，防止将模型 Key 转发到任意外部地址。
  if (!route || !['doubao', 'hailuo-h3'].includes(route.protocol)) throw new Error(t('视频接口协议无效'))
  const validPath = (path: unknown) => typeof path === 'string' && /^\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+$/.test(path)
  if (!validPath(route.createPath) || typeof route.queryPath !== 'string' || !route.queryPath.endsWith('/{task_id}') || !validPath(route.queryPath.slice(0, -10))) throw new Error(t('接口路径须为站内相对路径，查询路径必须以 /{task_id} 结尾'))
  return { protocol: route.protocol, createPath: route.createPath, queryPath: route.queryPath }
}
export function configuredVideoRoute(settings: VideoSettings, slot: KeySlot): VideoRoute {
  const route = settings.routes?.[slot] ?? VIDEO_PROVIDERS[slot]
  const validated = validateVideoRoute(route)
  if (validated.protocol !== VIDEO_PROVIDERS[slot].protocol) throw new Error(t('接口协议与模型服务不匹配'))
  return validated
}
export function taskVideoRoute(task: Pick<VideoTask, 'route'>): VideoRoute {
  // 老版所有模型实际都发往 Doubao，不能修改旧远端 ID 的查询路由。
  return validateVideoRoute(task.route ?? VIDEO_PROVIDERS.doubaoVideo)
}
