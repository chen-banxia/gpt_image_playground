/** 提交含上传和上游受理等待，查询只读取快照，两者不应共用短超时。 */
export const DEFAULT_VIDEO_SUBMIT_TIMEOUT = 600
export const VIDEO_QUERY_TIMEOUT = 60
export const MAX_VIDEO_SUBMIT_TIMEOUT = 600
// 旧配置没有该字段时使用新默认值；非法输入不产生无限等待或负数定时器。
export function normalizeVideoSubmitTimeout(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.max(1, Math.min(MAX_VIDEO_SUBMIT_TIMEOUT, Math.round(value)))
    : DEFAULT_VIDEO_SUBMIT_TIMEOUT
}
