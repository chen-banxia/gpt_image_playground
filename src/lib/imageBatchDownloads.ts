import { create } from 'zustand'
import { ensureImageCached, useStore } from '../store'
import { downloadImage } from './downloadImage'
import { buildSelectedImagesZip, saveImagesZip } from './batchDownload'
import { tCurrent } from '../i18n'
import type { TaskRecord } from '../types'

interface Entry { id: string; state: 'waiting' | 'saving' | 'saved' | 'failed' | 'cancelled'; error?: string }
interface QueueState { busy: boolean; mode: 'files' | 'zip'; entries: Entry[]; notice: string; taskIds: string[] }
export const useImageDownloads = create<QueueState>(() => ({ busy: false, mode: 'files', entries: [], notice: '', taskIds: [] }))
let cancelRequested = false
export const cancelImageDownloads = () => { cancelRequested = true }
const updateEntry = (id: string, patch: Partial<Entry>) => useImageDownloads.setState(s => ({ entries: s.entries.map(e => e.id === id ? { ...e, ...patch } : e) }))
export function selectedImageFiles(tasks: TaskRecord[], onlyUndownloaded: boolean, downloaded: Record<string, number>) {
  return [...new Set(tasks.flatMap(task => task.outputImages))].filter(id => !onlyUndownloaded || !downloaded[id])
}

/** 队列独立于图片页面，切换工作台后继续处理；结果仅标记实际发起保存的文件。 */
export async function downloadImageBatch(tasks: TaskRecord[], mode: 'files' | 'zip', onlyUndownloaded = false) {
  return downloadImageIds(selectedImageFiles(tasks, onlyUndownloaded, useStore.getState().downloadedImages), mode, tasks.map(t => t.id))
}
export async function downloadImageIds(ids: string[], mode: 'files' | 'zip', taskIds: string[]) {
  if (useImageDownloads.getState().busy) return
  if (!ids.length) { useImageDownloads.setState({ notice: tCurrent('workspaceNoDownloadable') }); return }
  cancelRequested = false
  useImageDownloads.setState({ busy: true, mode, entries: ids.map(id => ({ id, state: 'waiting' })), notice: '', taskIds })
  try {
    if (mode === 'zip') {
      // 包内统一按去重后的文件列表打包；读取失败不交付不完整的 ZIP。
      const result = await buildSelectedImagesZip([{ outputImages: ids } as TaskRecord], async id => {
        if (cancelRequested) throw new Error(tCurrent('已取消'))
        updateEntry(id, { state: 'saving' })
        const src = await ensureImageCached(id)
        if (!src) { updateEntry(id, { state: 'failed', error: tCurrent('batchImageMissing') }); throw new Error(tCurrent('batchImageMissing')) }
        return src
      })
      if (cancelRequested) return
      saveImagesZip(result.bytes)
      useStore.getState().markImagesDownloaded(result.imageIds)
      ids.forEach(id => updateEntry(id, { state: 'saved' }))
    } else {
      for (const id of ids) {
        if (cancelRequested) break
        updateEntry(id, { state: 'saving', error: undefined })
        try {
          const src = await ensureImageCached(id)
          if (!src) throw new Error(tCurrent('batchImageMissing'))
          if (cancelRequested) break
          await downloadImage(src, () => useStore.getState().markImagesDownloaded([id]))
          updateEntry(id, { state: 'saved' })
        } catch (error) { updateEntry(id, { state: 'failed', error: error instanceof Error ? error.message : String(error) }) }
      }
    }
  } catch (error) {
    if (!cancelRequested) useImageDownloads.setState(s => ({ notice: error instanceof Error ? error.message : String(error), entries: s.entries.map(e => e.state === 'saved' || e.state === 'failed' ? e : { ...e, state: 'failed' }) }))
  } finally {
    useImageDownloads.setState(s => ({ busy: false, entries: s.entries.map(e => e.state === 'waiting' || e.state === 'saving' ? { ...e, state: 'cancelled' } : e) }))
  }
}
