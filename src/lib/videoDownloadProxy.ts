/** 仅代理已知生成产物 CDN，不接受任意目标，避免变成公共 URL 转发服务。 */
export const VIDEO_DOWNLOAD_HOSTS = [
  'ark-acg-cn-beijing.tos-cn-beijing.volces.com',
  'ark-content-generation-cn-beijing.tos-cn-beijing.volces.com',
] as const
export const VIDEO_DOWNLOAD_PROXY_PREFIX = '/video-download-proxy'
export function videoDownloadProxyPath(value: string): string | undefined {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash || !VIDEO_DOWNLOAD_HOSTS.some(host => host === url.hostname) || !/\.(mp4|mov|webm)$/i.test(url.pathname)) return
    // 保留服务端签名查询串原顺序和转义，不重排 URLSearchParams。
    return `${VIDEO_DOWNLOAD_PROXY_PREFIX}/${url.hostname}${url.pathname}${url.search}`
  } catch { return }
}
