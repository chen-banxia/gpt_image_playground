import { tCurrent as t } from '../../i18n'
import { create } from 'zustand'
import { Zip, ZipPassThrough } from 'fflate'
import type { VideoTask } from './types'
import { safeMediaUrl } from './api'
import { message, syncVideoTask, updateVideoTasks, useVideoStore } from './store'

// 内存模式明确限制总量；未知 Content-Length 同样按实际读取字节计数。
export const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024
export class MediaLimitError extends Error {}
type Entry = { id: string; prompt: string; state: 'waiting' | 'fetching' | 'saved' | 'failed' | 'cancelled'; error?: string }
interface DownloadState { busy: boolean; mode: 'files' | 'zip'; entries: Entry[]; bytes: number; notice: string }
export const useVideoDownloads = create<DownloadState>(() => ({ busy: false, mode: 'files', entries: [], bytes: 0, notice: '' }))
let controller: AbortController | undefined
export const cancelVideoDownloads = () => controller?.abort()
function patchEntry(id: string, patch: Partial<Entry>) { useVideoDownloads.setState(s => ({ entries: s.entries.map(e => e.id === id ? { ...e, ...patch } : e) })) }
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = filename; document.body.appendChild(link)
  try { link.click() } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000) }
}
export async function readMedia(url: string, signal: AbortSignal, limit: number, onBytes: (n: number) => void): Promise<{ bytes: Uint8Array; type: string }> {
  if (!safeMediaUrl(url)) throw new Error(t("结果链接无效"))
  // 结果地址属于独立资源链路，绝不携带 New API Authorization。
  const response = await fetch(url, { signal, credentials: 'omit' })
  if (!response.ok) throw new Error(t("无法获取视频 ({0})，请刷新结果链接", { "0": response.status }))
  const type = response.headers.get('Content-Type')?.split(';')[0] ?? ''
  if (type && !type.startsWith('video/') && !['application/octet-stream', 'binary/octet-stream'].includes(type)) throw new Error(t("下载地址未返回视频文件"))
  const length = Number(response.headers.get('Content-Length'))
  if (length > limit) { await response.body?.cancel(); throw new MediaLimitError(t("文件超过内存下载上限，请打开原视频下载或减少打包数量")) }
  if (!response.body) throw new Error(t("视频响应为空"))
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw new MediaLimitError(t("实际文件大小超过 256MB 内存保护上限，请减少打包数量或打开原视频下载"))
      chunks.push(value); onBytes(value.byteLength)
    }
  } catch (e) { await reader.cancel().catch(() => {}); throw e } finally { reader.releaseLock() }
  if (!size) throw new Error(t("视频文件为空"))
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return { bytes, type }
}
export async function downloadVideos(tasks: VideoTask[], mode: 'files' | 'zip', onlyUndownloaded = false) {
  if (useVideoDownloads.getState().busy) return
  const selected = tasks.filter(t => t.status === 'succeeded' && t.videoUrl && (!onlyUndownloaded || !t.downloadedAt))
  if (!selected.length) { useVideoDownloads.setState({ notice: t("所选记录没有符合条件的成品") }); return }
  controller = new AbortController()
  const signal = controller.signal
  useVideoDownloads.setState({ busy: true, mode, entries: selected.map(t => ({ id: t.id, prompt: t.prompt, state: 'waiting' })), bytes: 0, notice: t("下载记录仅表示本页已发起保存，浏览器最终保存结果以下载列表为准。内存上限 256MB。") })
  const zipChunks: Uint8Array[] = []
  let zipBytes = 0
  const included: string[] = []
  let zipError: Error | undefined
  const zip = mode === 'zip' ? new Zip((err, data) => {
    if (err) { zipError = err; return }
    zipBytes += data.byteLength
    if (zipBytes > MAX_DOWNLOAD_BYTES + 1024 * 1024) { zipError = new Error(t("压缩包超过内存上限")); return }
    zipChunks.push(data)
  }) : undefined
  let total = 0
  try {
    for (const [index, original] of selected.entries()) {
      if (signal.aborted) break
      patchEntry(original.id, { state: 'fetching' })
      try {
        let task = useVideoStore.getState().tasks.find(t => t.id === original.id) ?? original
        let result
        try { result = await readMedia(task.videoUrl!, signal, mode === 'zip' ? MAX_DOWNLOAD_BYTES - total : MAX_DOWNLOAD_BYTES, n => useVideoDownloads.setState(s => ({ bytes: s.bytes + n }))) }
        catch (e) {
          if (signal.aborted || e instanceof MediaLimitError) throw e
          await syncVideoTask(task.id, true)
          task = useVideoStore.getState().tasks.find(t => t.id === original.id) ?? task
          result = await readMedia(task.videoUrl!, signal, mode === 'zip' ? MAX_DOWNLOAD_BYTES - total : MAX_DOWNLOAD_BYTES, n => useVideoDownloads.setState(s => ({ bytes: s.bytes + n })))
        }
        if (signal.aborted) break
        total += result.bytes.length
        const extension = result.type === 'video/quicktime' ? 'mov' : result.type === 'video/webm' ? 'webm' : 'mp4'
        const filename = `${index + 1}-${task.modelId.replace(/[^a-zA-Z0-9_-]/g, '')}-${task.id.slice(0, 8)}.${extension}`
        if (zip) {
          const entry = new ZipPassThrough(filename); zip.add(entry); entry.push(result.bytes, true)
          if (zipError) throw zipError
          included.push(task.id)
          patchEntry(task.id, { state: 'waiting', error: t("已获取，等待打包保存") })
        } else {
          saveBlob(new Blob([result.bytes.buffer as ArrayBuffer], { type: result.type || 'video/mp4' }), filename)
          await updateVideoTasks([task.id], { downloadedAt: Date.now(), downloadSource: selected.length > 1 ? 'batch' : 'single' })
          patchEntry(task.id, { state: 'saved', error: undefined })
        }
      } catch (e) { patchEntry(original.id, { state: signal.aborted ? 'cancelled' : 'failed', error: message(e) }) }
    }
    if (zip && !signal.aborted) {
      const failed = useVideoDownloads.getState().entries.filter(e => e.state === 'failed').length
      if (!included.length) throw new Error(t("没有可打包的视频，请查看失败原因"))
      if (failed && !window.confirm(t("{0} 个文件获取失败。是否仅打包已获取的 {1} 个视频？取消后可重试失败项。", { "0": failed, "1": included.length }))) {
        included.forEach(id => patchEntry(id, { state: 'cancelled', error: t("归档未保存") }))
        useVideoDownloads.setState({ notice: t("已取消部分打包，未更新任何下载标记。") }); return
      }
      zip.end()
      if (zipError) throw zipError
      saveBlob(new Blob(zipChunks.map(c => c.buffer.slice(c.byteOffset, c.byteOffset + c.byteLength) as ArrayBuffer), { type: 'application/zip' }), `videos-${Date.now()}.zip`)
      await updateVideoTasks(included, { downloadedAt: Date.now(), downloadSource: 'zip' })
      included.forEach(id => patchEntry(id, { state: 'saved', error: undefined }))
    }
  } catch (e) { useVideoDownloads.setState({ notice: message(e) }) }
  finally {
    if (signal.aborted) useVideoDownloads.setState(s => ({ entries: s.entries.map(e => ['waiting', 'fetching'].includes(e.state) ? { ...e, state: 'cancelled' } : e), notice: t("下载已取消，远端生成任务不受影响。") }))
    zip?.terminate(); zipChunks.length = 0; controller = undefined; useVideoDownloads.setState({ busy: false })
  }
}
