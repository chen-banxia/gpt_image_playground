import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'fs'
import { normalizeDevProxyConfig } from './src/lib/devProxy'

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
        ...(process.env.VIDEO_API_PROXY_URL ? {
          '/video-api-proxy': {
            target: process.env.VIDEO_API_PROXY_URL,
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
