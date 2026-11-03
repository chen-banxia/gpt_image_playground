import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { normalizeDevProxyConfig } from './src/lib/devProxy'
import { VIDEO_DOWNLOAD_HOSTS, VIDEO_DOWNLOAD_PROXY_PREFIX } from './src/lib/videoDownloadProxy'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

function loadDevProxyConfig() {
  try {
    return normalizeDevProxyConfig(
      JSON.parse(readFileSync('./dev-proxy.config.json', 'utf-8')) as unknown,
    )
  } catch (error) {
    const err = error as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw error
  }
}

export default defineConfig(({ command }) => {
  const devProxyConfig = command === 'serve' ? loadDevProxyConfig() : null

  return {
    plugins: [react()],
    base: './',
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
      __DEV_PROXY_CONFIG__: JSON.stringify(devProxyConfig),
    },
    server: {
      host: true,
      proxy: {
        // 文件代理与带鉴权的任务代理分离，固定 CDN 目标并移除用户凭证。
        ...Object.fromEntries(VIDEO_DOWNLOAD_HOSTS.map(host => {
          const prefix = `${VIDEO_DOWNLOAD_PROXY_PREFIX}/${host}`
          return [`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`, {
            target: `https://${host}`,
            changeOrigin: true,
            secure: true,
            followRedirects: false,
            timeout: 630000,
            proxyTimeout: 630000,
            rewrite: (path: string) => path.slice(prefix.length),
            configure: (proxy: any) => {
              proxy.on('proxyReq', (proxyReq: any, req: any, res: any) => {
                const path = (req.url ?? '').split('?')[0]
                if (req.method !== 'GET' || !/^\/.*\.(mp4|mov|webm)$/i.test(path)) {
                  proxyReq.destroy(); res.writeHead(403); res.end('Video file proxy path restricted'); return
                }
                for (const header of proxyReq.getHeaderNames()) if (!['host', 'range'].includes(String(header).toLowerCase())) proxyReq.removeHeader(header)
              })
              proxy.on('proxyRes', (proxyRes: any) => {
                proxyRes.headers['x-video-download-proxy'] = '1'
                proxyRes.headers['cache-control'] = 'private, no-store'
                delete proxyRes.headers['set-cookie']
                if (proxyRes.statusCode >= 300 && proxyRes.statusCode < 400 && proxyRes.statusCode !== 304) {
                  proxyRes.statusCode = 502
                  delete proxyRes.headers.location
                }
              })
            },
          }]
        })),
        ...(process.env.VIDEO_API_PROXY_URL ? {
          '/video-api-proxy': {
            target: process.env.VIDEO_API_PROXY_URL,
            timeout: 630000,
            proxyTimeout: 630000,
            changeOrigin: true,
            rewrite: (path: string) => path.replace(/^\/video-api-proxy/, ''),
            configure: (proxy: any) => proxy.on('proxyReq', (proxyReq: any, req: any, res: any) => {
              const path = (req.url ?? '').split('?')[0]
              if (!(req.method === 'POST' && /^(\/doubao\/api\/v3\/contents\/generations\/tasks|\/hailuo\/v[12]\/video_generation)$/.test(path) || req.method === 'GET' && /^(\/doubao\/api\/v3\/contents\/generations\/tasks|\/hailuo\/v[12]\/query\/video_generation)\/[^/]+$/.test(path))) {
                proxyReq.destroy(); res.writeHead(403); res.end('Video proxy path restricted')
              }
            }),
          },
        } : {}),
        ...(devProxyConfig?.enabled
          ? {
              [devProxyConfig.prefix]: {
                target: devProxyConfig.target,
                changeOrigin: devProxyConfig.changeOrigin,
                secure: devProxyConfig.secure,
                rewrite: (path) =>
                  path.replace(
                    new RegExp(`^${devProxyConfig.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
                    '',
                  ),
              },
            }
          : {}),
      },
    },
  }
})
