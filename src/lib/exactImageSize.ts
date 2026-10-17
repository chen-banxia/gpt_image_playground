import { tCurrent } from '../i18n'
import type { TaskParams } from '../types'
import { loadImage } from './canvasImage'
import { parseOutputSize } from './size'

/** 仅做等比例补边或裁剪，不拉伸人物。 */
export function getOutputPlacement(sw: number, sh: number, width: number, height: number, fit: 'pad' | 'cover') {
  const scale = fit === 'cover' ? Math.max(width / sw, height / sh) : Math.min(width / sw, height / sh)
  const drawWidth = sw * scale
  const drawHeight = sh * scale
  return { x: (width - drawWidth) / 2, y: (height - drawHeight) / 2, width: drawWidth, height: drawHeight }
}

export async function applyExactImageSize(dataUrl: string, params: TaskParams, signal?: AbortSignal) {
  const target = parseOutputSize(params.size)
  if (!target || (params.size_fit !== 'pad' && params.size_fit !== 'cover')) throw new Error(tCurrent('invalidOutputSize'))
  signal?.throwIfAborted()
  const image = await loadImage(dataUrl)
  signal?.throwIfAborted()
  if (!image.naturalWidth || !image.naturalHeight) throw new Error(tCurrent('imageLoadFailed'))
  const sourceSize = `${image.naturalWidth}x${image.naturalHeight}`
  if (image.naturalWidth === target.width && image.naturalHeight === target.height) return { image: dataUrl, sourceSize, resized: false }
  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error(tCurrent('canvasUnsupported'))
    // PNG/WebP 的补边保留透明通道；JPEG 不支持透明，使用白色补边。
    if (params.output_format === 'jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, target.width, target.height)
    }
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    const rect = getOutputPlacement(image.naturalWidth, image.naturalHeight, target.width, target.height, params.size_fit)
    ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height)
    const quality = params.output_compression == null ? undefined : Math.max(0, Math.min(1, params.output_compression / 100))
    const output = canvas.toDataURL(`image/${params.output_format}`, quality)
    if (!output.startsWith('data:image/')) throw new Error(tCurrent('imageExportFailed'))
    signal?.throwIfAborted()
    return { image: output, sourceSize, resized: true }
  } finally {
    canvas.width = 0
    canvas.height = 0
  }
}
