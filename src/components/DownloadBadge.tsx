import { useStore } from '../store'
import { useT } from '../hooks/useI18n'

export default function DownloadBadge({ imageIds, decorative = false, onDownload, disabled = false }: { imageIds: string[]; decorative?: boolean; onDownload?: () => void; disabled?: boolean }) {
  const t = useT()
  const count = useStore((state) => imageIds.filter((id) => state.downloadedImages[id]).length)
  if (!imageIds.length) return null
  const label = count === imageIds.length ? t('imageDownloaded') : count ? t('imagesPartDownloaded', { count, total: imageIds.length }) : t('imageNotDownloaded')
  // 使用独立图标显示状态，放在信息区，避免遮挡图片内容。
  const icon = (
    <span role={decorative || onDownload ? undefined : 'img'} aria-hidden={decorative || Boolean(onDownload) || undefined} aria-label={decorative || onDownload ? undefined : label} title={decorative || onDownload ? undefined : `${label} · ${t('downloadBadgeHint')}`} tabIndex={decorative || onDownload ? undefined : 0}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md p-1.5 ${count === imageIds.length ? 'text-emerald-500' : count ? 'text-blue-500' : 'text-gray-400'}`}>
      <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 16v4h16v-4" />
        {count === imageIds.length ? <path d="m7 10 3 3 7-7" /> : <path d="M12 3v12m-4-4 4 4 4-4" />}
      </svg>
      {count > 0 && count < imageIds.length && <span className="text-[10px] font-medium">{count}/{imageIds.length}</span>}
    </span>
  )
  return onDownload ? (
    <button type="button" disabled={disabled} aria-label={t('download')} title={`${t('download')} · ${label}`}
      onClick={(event) => { event.stopPropagation(); onDownload() }}
      className="inline-flex items-center rounded-md hover:bg-gray-100 focus-visible:outline focus-visible:outline-blue-400 disabled:opacity-50 dark:hover:bg-white/10">
      {icon}
    </button>
  ) : icon
}
