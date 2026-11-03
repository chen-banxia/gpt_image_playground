import { create } from 'zustand'
import type { KeySlot, VideoSettings } from './types'
import { configuredVideoRoute, VIDEO_PROVIDERS } from './providers'
import { DEFAULT_VIDEO_SUBMIT_TIMEOUT, normalizeVideoSubmitTimeout } from './timeouts'

export const VIDEO_SETTINGS_KEY = 'gpt-video-playground-settings'
export const DEFAULT_VIDEO_GATEWAY = 'https://colorflowai.com'
const credential = () => ({ apiKey: '', remember: false, revision: crypto.randomUUID() })
export function loadVideoSettings(): VideoSettings {
  const defaults: VideoSettings = { gatewayBaseUrl: DEFAULT_VIDEO_GATEWAY, submitTimeoutSeconds: DEFAULT_VIDEO_SUBMIT_TIMEOUT, proxy: false, routes: structuredClone(VIDEO_PROVIDERS), doubaoVideo: credential(), hailuoVideo: credential() }
  try {
    const saved = JSON.parse(localStorage.getItem(VIDEO_SETTINGS_KEY) ?? '{}')
    if (![1, 2].includes(saved.version)) return defaults
    const settings = { ...defaults, submitTimeoutSeconds: normalizeVideoSubmitTimeout(saved.submitTimeoutSeconds), gatewayBaseUrl: typeof saved.gatewayBaseUrl === 'string' && saved.gatewayBaseUrl.trim() ? saved.gatewayBaseUrl : DEFAULT_VIDEO_GATEWAY, proxy: saved.proxy === true,
      ...Object.fromEntries((['doubaoVideo', 'hailuoVideo'] as KeySlot[]).map(slot => [slot, { ...defaults[slot], apiKey: saved[slot]?.remember && typeof saved[slot]?.apiKey === 'string' ? saved[slot].apiKey : '', remember: saved[slot]?.remember === true, revision: typeof saved[slot]?.revision === 'string' ? saved[slot].revision : defaults[slot].revision }])) }
    if (saved.version === 2 && saved.routes) {
      // 路由损坏不丢弃已有 Key；仅恢复对应插件的默认路径。
      for (const slot of ['doubaoVideo', 'hailuoVideo'] as KeySlot[]) {
        try { settings.routes![slot] = configuredVideoRoute({ ...settings, routes: saved.routes }, slot) } catch { /* 使用经过验证的默认值 */ }
      }
    }
    return settings
  } catch { return defaults }
}
export function persistSettings(settings: VideoSettings) {
  // 两组视频凭证各自决定是否落盘，关闭记住时不把内存中的 Key 写进 localStorage。
  localStorage.setItem(VIDEO_SETTINGS_KEY, JSON.stringify({ ...settings, submitTimeoutSeconds: normalizeVideoSubmitTimeout(settings.submitTimeoutSeconds), routes: { doubaoVideo: configuredVideoRoute(settings, 'doubaoVideo'), hailuoVideo: configuredVideoRoute(settings, 'hailuoVideo') }, version: 2,
    doubaoVideo: { ...settings.doubaoVideo, apiKey: settings.doubaoVideo.remember ? settings.doubaoVideo.apiKey : '' },
    hailuoVideo: { ...settings.hailuoVideo, apiKey: settings.hailuoVideo.remember ? settings.hailuoVideo.apiKey : '' } }))
}
export const useVideoSettings = create<{ settings: VideoSettings; save: (settings: VideoSettings) => void }>((set) => ({
  settings: loadVideoSettings(), save: settings => { persistSettings(settings); set({ settings }) },
}))
