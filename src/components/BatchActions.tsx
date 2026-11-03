import { useCallback } from 'react'
import { useStore, updateTaskInStore, removeMultipleTasks, assignTaskGroup } from '../store'
import { downloadImageBatch, selectedImageFiles, useImageDownloads } from '../lib/imageBatchDownloads'
import { useT } from '../hooks/useI18n'
import { useGalleryPage } from '../hooks/useGalleryPage'
import WorkspaceBatchToolbar from './workspace/WorkspaceBatchToolbar'

/** 批量操作独立于画图面板，收起面板后仍可管理当前页的记录。 */
export default function BatchActions() {
  const t = useT()
  const showToast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const batchMode = useStore((s) => s.batchMode)
  const setBatchMode = useStore((s) => s.setBatchMode)
  const downloading = useImageDownloads(s => s.busy)
  const groups = useStore(s => s.groups)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const clearSelection = useStore((s) => s.clearSelection)

  const { items: filteredTasks } = useGalleryPage()

  const allVisibleSelected = filteredTasks.length > 0 && filteredTasks.every((task) => selectedTaskIds.includes(task.id))
  // 即使选择清理的 effect 尚未执行，也只允许操作当前页仍可见的记录。
  const selectedTasks = filteredTasks.filter((task) => selectedTaskIds.includes(task.id))
  const imageCount = selectedImageFiles(selectedTasks, false, {}).length

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
    selectedTasks.forEach((task) => {
      updateTaskInStore(task.id, { isFavorite: newFavoriteState })
    })
  }, [selectedTasks])

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

  return <WorkspaceBatchToolbar
    count={selectedTasks.length} files={imageCount} pageCount={filteredTasks.length}
    allSelected={allVisibleSelected} allFavorite={selectedTasks.length > 0 && selectedTasks.every(t => t.isFavorite)}
    busy={downloading} groups={groups} onSelectAll={handleSelectAllToggle}
    onMove={groupId => { void assignTaskGroup(selectedTasks.map(t => t.id), groupId).catch(error => showToast(error instanceof Error ? error.message : String(error), 'error')) }}
    onFavorite={handleToggleFavorite} onDelete={handleDeleteSelected}
    onDownload={(mode, onlyUndownloaded) => { void downloadImageBatch(selectedTasks, mode, onlyUndownloaded) }}
    onExit={() => { clearSelection(); setBatchMode(false) }} />
}
