import { zip } from 'fflate'
import type { TaskRecord } from '../types'
import { tCurrent } from '../i18n'

/** 下载只包含选中任务的成品，不打包参考图、密钥和任务配置。 */
export async function buildSelectedImagesZip(tasks: TaskRecord[], readImage: (id: string) => Promise<string | undefined>) {
  const files: Record<string, Uint8Array> = {}
  let count = 0
  const imageIds = new Set<string>()
  const skipped = tasks.filter((task) => task.outputImages.length === 0).length
  for (const [taskIndex, task] of tasks.entries()) {
    for (const [imageIndex, id] of task.outputImages.entries()) {
      const dataUrl = await readImage(id)
      const match = dataUrl?.match(/^data:image\/(png|jpeg|webp);base64,([\s\S]+)$/)
      // 缺失图片时不生成看似完整的压缩包，明确提示用户。
      if (!match) throw new Error(tCurrent('batchImageMissing'))
      const binary = atob(match[2])
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
      const extension = match[1] === 'jpeg' ? 'jpg' : match[1]
      // 序号保证同一任务多图和不同任务重复图片不会互相覆盖。
      files[`task-${taskIndex + 1}/image-${imageIndex + 1}.${extension}`] = bytes
      count++
      imageIds.add(id)
    }
  }
  if (!count) throw new Error(tCurrent('batchNoImages'))
  // 图片已经压缩，ZIP 仅封装；使用异步实现，避免大批量压缩阻塞页面。
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(files, { level: 0 }, (error, result) => error ? reject(error) : resolve(result))
  })
  return { bytes, count, skipped, imageIds: [...imageIds] }
}

export function saveImagesZip(bytes: Uint8Array) {
  const blob = new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `images-${Date.now()}.zip`
  document.body.appendChild(link)
  try { link.click() } finally {
    link.remove()
    // 延迟释放，给浏览器读取下载数据的时间。
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
