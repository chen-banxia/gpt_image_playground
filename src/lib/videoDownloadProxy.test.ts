import { describe, expect, it } from 'vitest'
import { videoDownloadProxyPath } from './videoDownloadProxy'

describe('video file proxy allowlist', () => {
  it('preserves the signed query string verbatim', () => {
    const path = '/doubao-seedance-2-0/a.mp4?X-Tos-Credential=a%2Fb&X-Tos-Signature=ABC&x=1+2'
    expect(videoDownloadProxyPath('https://ark-acg-cn-beijing.tos-cn-beijing.volces.com' + path)).toBe('/video-download-proxy/ark-acg-cn-beijing.tos-cn-beijing.volces.com' + path)
  })
  it.each([
    'http://ark-acg-cn-beijing.tos-cn-beijing.volces.com/a.mp4',
    'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com.evil.example/a.mp4',
    'https://127.0.0.1/a.mp4', 'https://localhost/a.mp4',
    'https://user:pass@ark-acg-cn-beijing.tos-cn-beijing.volces.com/a.mp4',
    'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com:8443/a.mp4',
    'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/index.html',
    'https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/a.mp4#fragment',
  ])('does not proxy untrusted or non-video URL %s', url => {
    expect(videoDownloadProxyPath(url)).toBeUndefined()
  })
})
