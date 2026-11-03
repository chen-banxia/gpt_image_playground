import { useEffect, useRef, useState } from 'react'
import { useT } from '../../hooks/useI18n'

/** 静止视频帧直接由浏览器渲染，不用 Canvas 截图，避免 CDN 未开放 CORS 时无法显示。 */
export default function VideoCardPreview({ url }: { url: string }) {
  const t = useT()
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [visible, setVisible] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '100px 0px' })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !visible) return
    setState('loading')
    const onMetadata = () => {
      // 略过文件零点的空白帧，仍保持暂停，不自动播放或发声。
      if (Number.isFinite(video.duration) && video.duration > 0) video.currentTime = Math.min(0.1, video.duration / 2)
    }
    const onReady = () => { if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) setState('ready') }
    const onError = () => setState('failed')
    video.addEventListener('loadedmetadata', onMetadata)
    video.addEventListener('loadeddata', onReady)
    video.addEventListener('seeked', onReady)
    video.addEventListener('error', onError)
    video.muted = true
    video.src = url
    video.load()
    return () => {
      video.removeEventListener('loadedmetadata', onMetadata)
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('seeked', onReady)
      video.removeEventListener('error', onError)
      // 翻页、离开可见区或更新签名 URL 时释放加载，不让整页视频持续占用资源。
      video.pause()
      video.removeAttribute('src')
      video.load()
    }
  }, [url, visible])

  return <div ref={containerRef} data-video-preview data-preview-state={visible ? state : 'idle'} className="pointer-events-none absolute inset-0">
    <video ref={videoRef} muted playsInline preload="auto" aria-hidden="true" tabIndex={-1}
      className={`h-full w-full bg-black object-contain ${state === 'ready' && visible ? 'opacity-100' : 'opacity-0'}`} />
    {visible && state !== 'ready' && <p className="absolute inset-x-4 bottom-10 text-center text-xs leading-relaxed text-slate-300" role="status">
      {t(state === 'failed' ? '预览暂不可用，可打开详情播放或刷新链接' : '正在加载视频预览…')}
    </p>}
  </div>
}
