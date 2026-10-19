import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

it('persists download markers per image and restores them after a store reload', async () => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
  vi.stubGlobal('window', { localStorage: globalThis.localStorage })
  vi.resetModules()
  const first = (await import('../store')).useStore
  first.getState().markImagesDownloaded(['image-a', 'image-b', 'image-a'])
  const saved = JSON.parse(storage.get('gpt-image-playground')!)
  expect(Object.keys(saved.state.downloadedImages)).toEqual(['image-a', 'image-b'])
  expect(saved.state.downloadedImages['image-a']).toBeGreaterThan(0)
  vi.resetModules()
  const restored = (await import('../store')).useStore
  expect(restored.getState().downloadedImages).toEqual(saved.state.downloadedImages)
  expect(restored.getState().downloadedImages['not-downloaded']).toBeUndefined()
})
