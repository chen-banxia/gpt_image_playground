import { useStore } from '../store'
import { useT } from '../hooks/useI18n'
import { useEffect, useState } from 'react'

export default function GalleryPagination({ page, totalPages, total, start, end }: { page: number; totalPages: number; total: number; start: number; end: number }) {
  const t = useT()
  const setPage = useStore((s) => s.setGalleryPage)
  const [targetPage, setTargetPage] = useState(String(page))
  // 筛选或删除导致总页数变化时，同步输入框，避免残留已失效的目标页码。
  useEffect(() => { setTargetPage(String(page)) }, [page, totalPages])
  // 同时校验整数和页码边界，点击按钮与回车提交共用这份规则。
  const validTarget = /^\d+$/.test(targetPage) && Number.isSafeInteger(Number(targetPage)) && Number(targetPage) >= 1 && Number(targetPage) <= totalPages
  const buttonClass = 'rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/5'
  return <nav data-no-drag-select aria-label={t('galleryPagination')} className="mb-4 flex flex-wrap items-center justify-between gap-2">
    <span className="text-xs text-gray-500" aria-live="polite">{t('galleryRange', { start, end, total })}</span>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={page === 1} className={buttonClass} onClick={() => setPage(page - 1)}>{t('previousPage')}</button>
      <span className="text-xs text-gray-500">{t('galleryPage', { page, total: totalPages })}</span>
      <button type="button" disabled={page === totalPages} className={buttonClass} onClick={() => setPage(page + 1)}>{t('nextPage')}</button>
      <form className="flex items-center gap-2" onSubmit={(event) => {
        event.preventDefault()
        if (validTarget) setPage(Number(targetPage))
      }}>
        <label className="flex items-center gap-2 text-xs text-gray-500">
          {t('jumpToPage')}
          <input type="number" inputMode="numeric" min={1} max={totalPages} step={1} required
            aria-label={t('jumpToPage')} value={targetPage} onChange={(event) => setTargetPage(event.target.value)}
            className="w-16 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-center text-xs text-gray-700 focus:outline-blue-400 dark:border-white/10 dark:bg-gray-900 dark:text-gray-200" />
        </label>
        <button type="submit" disabled={!validTarget} className={buttonClass}>{t('jumpPage')}</button>
      </form>
    </div>
  </nav>
}
