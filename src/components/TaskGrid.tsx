import { useRef, useState, useEffect } from 'react'
import { useStore, reuseConfig, editOutputs, removeTask } from '../store'
import { useT } from '../hooks/useI18n'
import TaskCard from './TaskCard'
import { useGalleryPage } from '../hooks/useGalleryPage'
import GalleryPagination from './GalleryPagination'

export default function TaskGrid() {
  const t = useT()
  const tasks = useStore((s) => s.tasks)
  const searchQuery = useStore((s) => s.searchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const groupFilter = useStore((s) => s.groupFilter)
  const setDetailTaskId = useStore((s) => s.setDetailTaskId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const selectedTaskIds = useStore((s) => s.selectedTaskIds)
  const batchMode = useStore((s) => s.batchMode)
  const setSelectedTaskIds = useStore((s) => s.setSelectedTaskIds)
  const clearSelection = useStore((s) => s.clearSelection)
  const rootRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const [selectionBox, setSelectionBox] = useState<{ startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const isDragging = useRef(false)
  const dragStart = useRef<{ x: number; y: number } | null>(null)
  const hasDragged = useRef(false)
  const suppressClickUntil = useRef(0)
  const startedOnCard = useRef(false)
  const startedWithCtrl = useRef(false)
  const initialSelection = useRef<string[]>([])
  const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform)

  const pagination = useGalleryPage()
  const filteredTasks = pagination.items
  const galleryPage = useStore((s) => s.galleryPage)
  const setGalleryPage = useStore((s) => s.setGalleryPage)
  useEffect(() => {
    if (galleryPage !== pagination.page) setGalleryPage(pagination.page)
  }, [galleryPage, pagination.page, setGalleryPage])
  useEffect(() => {
    // 删除、移动或任务状态变化可能让选中记录离开当前页，及时清除隐藏选择。
    const visible = new Set(filteredTasks.map((task) => task.id))
    const selected = useStore.getState().selectedTaskIds
    if (selected.some((id) => !visible.has(id))) setSelectedTaskIds(selected.filter((id) => visible.has(id)))
  }, [filteredTasks, setSelectedTaskIds])

  const handleDelete = (task: typeof tasks[0]) => {
    setConfirmDialog({
      title: t('deleteRecord'),
      message: t('deleteRecordMessage'),
      action: () => removeTask(task),
    })
  }

  const beginSelection = (target: HTMLElement, clientX: number, clientY: number, isCtrl: boolean) => {
    startedOnCard.current = Boolean(target.closest('.task-card-wrapper'))
    startedWithCtrl.current = isCtrl
    initialSelection.current = [...useStore.getState().selectedTaskIds]

    isDragging.current = true
    hasDragged.current = false
    dragStart.current = { x: clientX, y: clientY }
    document.body.classList.add('select-none')
    document.body.classList.add('drag-selecting')
    setSelectionBox({
      startX: clientX,
      startY: clientY,
      currentX: clientX,
      currentY: clientY,
    })
  }

  const updateSelectionFromPoint = (clientX: number, clientY: number) => {
    const start = dragStart.current
    if (!start || !gridRef.current) return

    const minX = Math.min(start.x, clientX)
    const maxX = Math.max(start.x, clientX)
    const minY = Math.min(start.y, clientY)
    const maxY = Math.max(start.y, clientY)

    const cards = gridRef.current.querySelectorAll('.task-card-wrapper')
    const newSelected = new Set(initialSelection.current)
    const initialSelected = new Set(initialSelection.current)

    cards.forEach((card) => {
      const rect = card.getBoundingClientRect()
      const taskId = card.getAttribute('data-task-id')
      if (!taskId) return

      const isIntersecting =
        minX < rect.right && maxX > rect.left && minY < rect.bottom && maxY > rect.top

      if (isIntersecting) {
        if (initialSelected.has(taskId)) {
          newSelected.delete(taskId)
        } else {
          newSelected.add(taskId)
        }
      } else if (!initialSelected.has(taskId)) {
        newSelected.delete(taskId)
      }
    })

    setSelectedTaskIds(Array.from(newSelected))
  }

  useEffect(() => {
    const getEventElement = (e: MouseEvent) => {
      if (e.target instanceof Element) return e.target
      return document.elementFromPoint(e.clientX, e.clientY)
    }

    const handleDocumentMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const target = getEventElement(e)
      if (!target) return
      if (!target.closest('[data-drag-select-surface]')) return
      if (target.closest('[data-input-bar]')) return
      if (target.closest('[data-no-drag-select], [data-lightbox-root]')) return
      if (target.closest('button, a, input, textarea, select')) return

      const isCtrl = isMac ? e.metaKey : e.ctrlKey
      beginSelection(target as HTMLElement, e.clientX, e.clientY, isCtrl)
      e.preventDefault()
    }

    const handleDocumentMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !dragStart.current) return

      const start = dragStart.current
      const distance = Math.hypot(e.clientX - start.x, e.clientY - start.y)
      if (distance < 6 && !hasDragged.current) return

      hasDragged.current = true
      setSelectionBox({
        startX: start.x,
        startY: start.y,
        currentX: e.clientX,
        currentY: e.clientY,
      })
      updateSelectionFromPoint(e.clientX, e.clientY)
      e.preventDefault()
    }

    const handleDocumentMouseUp = () => {
      if (isDragging.current) {
        document.body.classList.remove('select-none')
        document.body.classList.remove('drag-selecting')
      }
      if (isDragging.current && !hasDragged.current && !startedOnCard.current && !startedWithCtrl.current) {
        clearSelection()
      }
      if (isDragging.current && hasDragged.current) {
        suppressClickUntil.current = Date.now() + 250
      }
      isDragging.current = false
      dragStart.current = null
      setSelectionBox(null)
    }

    document.addEventListener('mousedown', handleDocumentMouseDown, true)
    document.addEventListener('mousemove', handleDocumentMouseMove, true)
    document.addEventListener('mouseup', handleDocumentMouseUp, true)
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown, true)
      document.removeEventListener('mousemove', handleDocumentMouseMove, true)
      document.removeEventListener('mouseup', handleDocumentMouseUp, true)
    }
  }, [clearSelection, isMac])

  if (!filteredTasks.length) {
    return (
      <div className="text-center py-20 text-gray-400 dark:text-gray-500">
        {searchQuery || filterFavorite || groupFilter !== 'all' || filterStatus !== 'all' ? (
          <p className="text-sm">{t('noMatches')}</p>
        ) : (
          <>
            <svg
              className="w-16 h-16 mx-auto mb-4 text-gray-200 dark:text-gray-700"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <p className="text-sm">{t('startGenerating')}</p>
          </>
        )}
      </div>
    )
  }

  return (
    <div 
      ref={rootRef}
      data-task-grid-root
      className="relative min-h-[50vh]"
    >
      <GalleryPagination {...pagination} />
      <div ref={gridRef} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pb-10">
        {filteredTasks.map((task) => (
          <div key={task.id} className="task-card-wrapper relative" data-task-id={task.id}>
            {batchMode && (
              <label data-no-drag-select className="absolute top-2 right-2 z-20 flex h-7 w-7 items-center justify-center rounded-lg bg-white/90 shadow dark:bg-gray-800/90"
                onClick={(event) => event.stopPropagation()}>
                <input type="checkbox" checked={selectedTaskIds.includes(task.id)}
                  onChange={() => useStore.getState().toggleTaskSelection(task.id)}
                  aria-label={t('selectRecord', { prompt: task.prompt })} className="h-4 w-4 accent-blue-500" />
              </label>
            )}
            <TaskCard
              task={task}
              onClick={(e) => {
                if (Date.now() < suppressClickUntil.current) {
                  e.preventDefault()
                  return
                }
                suppressClickUntil.current = 0
                const isCtrl = isMac ? e.metaKey : e.ctrlKey
                if (isCtrl || batchMode) {
                  useStore.getState().toggleTaskSelection(task.id)
                } else if (selectedTaskIds.length > 0) {
                  clearSelection()
                  setDetailTaskId(task.id)
                } else {
                  setDetailTaskId(task.id)
                }
              }}
              onReuse={() => reuseConfig(task)}
              onEditOutputs={() => editOutputs(task)}
              onDelete={() => handleDelete(task)}
              isSelected={selectedTaskIds.includes(task.id)}
            />
          </div>
        ))}
      </div>
      {selectionBox && (
        <div
          className="fixed bg-blue-500/20 border border-blue-500/50 pointer-events-none z-[30]"
          style={{
            left: Math.min(selectionBox.startX, selectionBox.currentX),
            top: Math.min(selectionBox.startY, selectionBox.currentY),
            width: Math.abs(selectionBox.currentX - selectionBox.startX),
            height: Math.abs(selectionBox.currentY - selectionBox.startY),
          }}
        />
      )}
    </div>
  )
}
