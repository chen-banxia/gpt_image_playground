import { useCallback, useState } from 'react'
import { useStore, updateTaskInStore, removeMultipleTasks, ensureImageCached } from '../store'
import { buildSelectedImagesZip, saveImagesZip } from '../lib/batchDownload'
import { useT } from '../hooks/useI18n'
import { useGalleryPage } from '../hooks/useGalleryPage'
import GroupPicker from './GroupPicker'

/** 批量操作独立于画图面板，收起面板后仍可管理当前页的记录。 */
export default function BatchActions() {
  const t = useT()
  const showToast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const batchMode = useStore((s) => s.batchMode)
  const setBatchMode = useStore((s) => s.setBatchMode)
  const [downloading, setDownloading] = useState(false)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const clearSelection = useStore((s) => s.clearSelection)

  const { items: filteredTasks } = useGalleryPage()

  const allVisibleSelected = filteredTasks.length > 0 && filteredTasks.every((task) => selectedTaskIds.includes(task.id))
  // 即使选择清理的 effect 尚未执行，也只允许操作当前页仍可见的记录。
  const selectedTasks = filteredTasks.filter((task) => selectedTaskIds.includes(task.id))
  const imageCount = selectedTasks.reduce((count, task) => count + task.outputImages.length, 0)

  const handleDownloadSelected = async () => {
    if (downloading || !imageCount) return
    setDownloading(true)
    try {
      const result = await buildSelectedImagesZip(selectedTasks, ensureImageCached)
      saveImagesZip(result.bytes)
      useStore.getState().markImagesDownloaded(result.imageIds)
      showToast(t('batchDownloadDone', { count: result.count, skipped: result.skipped }), 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('downloadFailed'), 'error')
    } finally { setDownloading(false) }
  }

  const handleSelectAllToggle = useCallback(() => {
    if (allVisibleSelected) {
      const visibleIds = new Set(filteredTasks.map((task) => task.id))
      setSelectedTaskIds(selectedTaskIds.filter((id) => !visibleIds.has(id)))
    } else {
      setSelectedTaskIds([...new Set([...selectedTaskIds, ...filteredTasks.map((task) => task.id)])])
    }
  }, [allVisibleSelected, selectedTaskIds, filteredTasks, setSelectedTaskIds])

  const handleToggleFavorite = useCallback(() => {
    const allFavorite = selectedTasks.length > 0 && selectedTasks.every((t) => t.isFavorite)
    const newFavoriteState = !allFavorite
    setConfirmDialog({
      title: newFavoriteState ? t('batchFavorite') : t('batchUnfavorite'),
      message: newFavoriteState
        ? t('batchFavoriteMessage', { count: selectedTasks.length })
        : t('batchUnfavoriteMessage', { count: selectedTasks.length }),
      confirmText: newFavoriteState ? t('confirmFavorite') : t('confirmUnfavorite'),
      action: () => {
        selectedTasks.forEach((task) => {
          updateTaskInStore(task.id, { isFavorite: newFavoriteState })
        })
        clearSelection()
      },
    })
  }, [selectedTasks, clearSelection, setConfirmDialog, t])

  const handleDeleteSelected = useCallback(() => {
    if (!selectedTasks.length) return
    setConfirmDialog({
      title: t('batchDelete'),
      message: t('batchDeleteMessage', { count: selectedTasks.length }),
      action: async () => {
        try { await removeMultipleTasks(selectedTasks.map((task) => task.id)) }
        catch (error) { showToast(error instanceof Error ? error.message : String(error), 'error') }
      },
    })
  }, [selectedTasks, setConfirmDialog, showToast, t])

  if (!batchMode && selectedTaskIds.length === 0) return null

  return (
    <div data-no-drag-select className="mb-3 flex justify-center">
      <div className="flex max-w-full flex-wrap items-center justify-center gap-1 rounded-2xl border border-white/10 bg-gray-800/95 p-2 text-xs text-white shadow-lg backdrop-blur" role="toolbar" aria-label={t('batchActions')}>
        <span className="px-2" aria-live="polite">{t('batchSelected', { count: selectedTasks.length, images: imageCount })}</span>
        <GroupPicker taskIds={selectedTasks.map((task) => task.id)} batch />
        <button type="button" onClick={handleSelectAllToggle} className="rounded-lg px-2 py-2 text-blue-300 hover:bg-white/10">
          {t(allVisibleSelected ? 'cancelSelectAll' : 'selectCurrentPage')}
        </button>
        <button type="button" onClick={handleDownloadSelected} disabled={downloading || imageCount === 0}
          className="rounded-lg px-2 py-2 text-green-300 hover:bg-white/10 disabled:opacity-40">
          {t(downloading ? 'batchDownloading' : 'batchDownload')}
        </button>
        <button type="button" onClick={handleToggleFavorite} disabled={!selectedTasks.length}
          className="rounded-lg px-2 py-2 text-yellow-300 hover:bg-white/10 disabled:opacity-40">{t('favoriteOrUnfavorite')}</button>
        <button type="button" onClick={handleDeleteSelected} disabled={!selectedTasks.length || downloading}
          className="rounded-lg px-2 py-2 text-red-300 hover:bg-white/10 disabled:opacity-40">{t('batchDelete')}</button>
        <button type="button" onClick={() => { clearSelection(); setBatchMode(false) }}
          className="rounded-lg px-2 py-2 text-gray-300 hover:bg-white/10">{t('exitBatch')}</button>
      </div>
    </div>
  )
}
