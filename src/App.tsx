import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { initStore } from './store'
import { useStore } from './store'
import { normalizeBaseUrl } from './lib/api'
import { normalizeSettings, switchApiProfileProvider } from './lib/apiProfiles'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import { setActiveLanguage } from './i18n'
import type { ApiMode, ApiProvider, AppSettings } from './types'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import BatchActions from './components/BatchActions'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import SettingsModal from './components/SettingsModal'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import VideoWorkspace, { VideoDownloadPanel } from './features/video/VideoWorkspace'
import { initializeVideo } from './features/video/store'
import ImageDownloadPanel from './components/workspace/ImageDownloadPanel'

export default function App() {
  const [workspace, setWorkspace] = useState(window.location.hash === '#/video' ? 'video' : 'image')
  useEffect(() => {
    const update = () => setWorkspace(window.location.hash === '#/video' ? 'video' : 'image')
    window.addEventListener('hashchange', update)
    void initializeVideo()
    return () => window.removeEventListener('hashchange', update)
  }, [])
  useEffect(() => { useStore.getState().setBatchMode(false) }, [workspace])
  // 每次进入首页默认展开；收起状态只控制布局，不清空已填写的生成参数。
  const [inputCollapsed, setInputCollapsed] = useState(false)
  const layoutRef = useRef<HTMLDivElement>(null)
  const galleryRef = useRef<HTMLDivElement>(null)
  const setSettings = useStore((s) => s.setSettings)
  const language = useStore((s) => s.settings.language)
  useDockerApiUrlMigrationNotice()

  useLayoutEffect(() => {
    const layout = layoutRef.current
    const gallery = galleryRef.current
    if (!layout || !gallery) return

    const alignInputPanel = () => {
      const items = gallery.querySelector<HTMLElement>('[data-workspace-toolbar]')
      if (!window.matchMedia('(min-width: 768px)').matches || !items) {
        layout.style.removeProperty('--input-panel-top')
        return
      }
      // 对齐顶部操作栏，充分利用可用高度；页面滚动时仍保持固定。
      layout.style.setProperty('--input-panel-top', `${items.getBoundingClientRect().top + window.scrollY}px`)
    }

    alignInputPanel()
    // 语言切换和窗口变化时，重新测量操作栏位置。
    const observer = new ResizeObserver(alignInputPanel)
    observer.observe(gallery)
    window.addEventListener('resize', alignInputPanel)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', alignInputPanel)
    }
  }, [workspace])

  useEffect(() => {
    setActiveLanguage(language)
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en'
  }, [language])

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    const nextSettings: Partial<AppSettings> = {}

    const apiUrlParam = searchParams.get('apiUrl')
    if (apiUrlParam !== null) {
      nextSettings.baseUrl = normalizeBaseUrl(apiUrlParam.trim())
    }

    const apiKeyParam = searchParams.get('apiKey')
    if (apiKeyParam !== null) {
      nextSettings.apiKey = apiKeyParam.trim()
    }

    const codexCliParam = searchParams.get('codexCli')
    if (codexCliParam !== null) {
      nextSettings.codexCli = codexCliParam.trim().toLowerCase() === 'true'
    }

    const apiModeParam = searchParams.get('apiMode')
    if (apiModeParam === 'images' || apiModeParam === 'responses') {
      nextSettings.apiMode = apiModeParam
    }

    const providerParam = searchParams.get('provider')?.trim().toLowerCase()
    if (providerParam) {
      const provider: ApiProvider | null = providerParam === 'fal'
        ? 'fal'
        : ['openai', 'openai-compatible'].includes(providerParam)
          ? 'openai'
          : null
      if (provider) {
        const state = useStore.getState()
        const settings = normalizeSettings(state.settings)
        const current = settings.profiles.find((profile) => profile.id === settings.activeProfileId) ?? settings.profiles[0]
        if (current) {
          nextSettings.profiles = settings.profiles.map((profile) =>
            profile.id === current.id
              ? {
                  ...switchApiProfileProvider(profile, provider),
                  ...(nextSettings.baseUrl !== undefined ? { baseUrl: nextSettings.baseUrl } : {}),
                  ...(nextSettings.apiKey !== undefined ? { apiKey: nextSettings.apiKey } : {}),
                  ...(provider === 'openai' && nextSettings.apiMode !== undefined ? { apiMode: nextSettings.apiMode } : {}),
                  ...(provider === 'openai' && nextSettings.codexCli !== undefined ? { codexCli: nextSettings.codexCli } : {}),
                }
              : profile,
          )
          nextSettings.activeProfileId = current.id
        }
      }
    }

    setSettings(nextSettings)

    if (searchParams.has('apiUrl') || searchParams.has('apiKey') || searchParams.has('codexCli') || searchParams.has('apiMode') || searchParams.has('provider')) {
      searchParams.delete('apiUrl')
      searchParams.delete('apiKey')
      searchParams.delete('codexCli')
      searchParams.delete('apiMode')
      searchParams.delete('provider')

      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    initStore()
  }, [setSettings])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) {
        e.preventDefault()
      }
    }

    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  return (
    <>
      <Header />
      {workspace === 'video' ? <VideoWorkspace /> : <div ref={layoutRef} className="generation-layout" data-input-collapsed={inputCollapsed}>
        <InputBar collapsed={inputCollapsed} onToggle={() => setInputCollapsed((value) => !value)} />
        <main data-home-main data-drag-select-surface className="generation-gallery min-w-0 pb-6">
          <div ref={galleryRef} className="safe-area-x max-w-7xl mx-auto">
            <SearchBar />
            <BatchActions />
            <TaskGrid />
          </div>
        </main>
      </div>}
      <DetailModal />
      <Lightbox />
      <SettingsModal />
      <ConfirmDialog />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
      <VideoDownloadPanel />
      <ImageDownloadPanel />
    </>
  )
}
