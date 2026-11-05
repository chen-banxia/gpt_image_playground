import { DEFAULT_PARAMS, type AppSettings, type TaskParams } from '../types'
import { getActiveApiProfile } from './apiProfiles'
import { normalizeImageSize, parseOutputSize } from './size'
import { isGptImage26Model, supportsExtendedImageQuality } from './imageModels'
import { requiresOriginalOutput } from './imageFormats'
import { tCurrent } from '../i18n'

export const DEFAULT_FAL_IMAGE_SIZE = '1360x1024'
export const MAX_FAL_OUTPUT_IMAGES = 4
export const MAX_OPENAI_OUTPUT_IMAGES = 10

export function getOutputImageLimitForSettings(settings: AppSettings) {
  return getActiveApiProfile(settings).provider === 'fal' ? MAX_FAL_OUTPUT_IMAGES : MAX_OPENAI_OUTPUT_IMAGES
}

export function normalizeParamsForSettings(params: TaskParams, settings: AppSettings): TaskParams {
  const activeProfile = getActiveApiProfile(settings)
  const imageModel = activeProfile.apiMode === 'responses' ? activeProfile.imageGenerationModel ?? '' : activeProfile.model
  const supports26 = activeProfile.provider === 'openai' && isGptImage26Model(imageModel)
  const requestedFormat = ['png', 'jpeg', 'webp', 'gif', 'svg'].includes(params.output_format) ? params.output_format : 'png'
  const outputFormat = requiresOriginalOutput(requestedFormat) && !supports26 ? 'png' : requestedFormat
  const requestedSize = typeof params.size === 'string' ? params.size : DEFAULT_PARAMS.size
  const preserveOriginal = requiresOriginalOutput(outputFormat)
  const outputImageLimit = getOutputImageLimitForSettings(settings)
  // 缺省保留网关原图，只有用户明确选择补边或裁剪时才启用本地尺寸处理。
  const sizeFit = !preserveOriginal && (params.size_fit === 'pad' || params.size_fit === 'cover') ? params.size_fit : 'none'
  const exact = requestedSize !== 'auto' && sizeFit !== 'none'
  const target = exact ? parseOutputSize(requestedSize) : null
  if (exact && !target) throw new Error(tCurrent('invalidOutputSize'))
  // 备份导入和历史任务可绕过表单限制，因此在统一入口再次规整枚举及数值。
  const nextParams: TaskParams = {
    ...DEFAULT_PARAMS,
    ...params,
    size: outputFormat === 'gif' ? normalizeGifSize(requestedSize) : target ? `${target.width}x${target.height}` : normalizeImageSize(requestedSize),
    output_format: outputFormat,
    size_fit: sizeFit,
    n: clampInteger(params.n, DEFAULT_PARAMS.n, 1, outputImageLimit),
    quality: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'].includes(params.quality) ? params.quality : DEFAULT_PARAMS.quality,
    moderation: params.moderation === 'low' ? 'low' : 'auto',
    output_compression: typeof params.output_compression === 'number' && Number.isFinite(params.output_compression)
      ? clampInteger(params.output_compression, 100, 0, 100) : null,
  }

  if (activeProfile.provider === 'fal') {
    if (nextParams.size === 'auto') nextParams.size = DEFAULT_FAL_IMAGE_SIZE
    if (nextParams.quality === 'auto') nextParams.quality = 'high'
    nextParams.moderation = DEFAULT_PARAMS.moderation
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  }

  if ((nextParams.quality === 'xhigh' || nextParams.quality === 'max') && !supportsExtendedImageQuality(imageModel)) nextParams.quality = 'high'
  nextParams.complexity = supports26 && ['low', 'medium', 'high'].includes(params.complexity ?? '') ? params.complexity : undefined
  // 官方指南与 API 参考的 GIF 上限暂不一致，采用共同范围；切换格式后清除帧参数。
  nextParams.frame_count = outputFormat === 'gif' ? clampInteger(params.frame_count, 9, 2, 16) : undefined
  nextParams.frame_duration_ms = outputFormat === 'gif' ? Math.round(clampInteger(params.frame_duration_ms, 200, 20, 2000) / 10) * 10 : undefined
  if (preserveOriginal) {
    // GIF/SVG 不使用部分图预览，也不能经过会丢帧或栅格化的本地处理。
    nextParams.stream = false
    nextParams.transparent_output = false
    if (outputFormat === 'svg') nextParams.n = 1
  }
  if (nextParams.transparent_output && nextParams.output_format === 'jpeg') nextParams.output_format = 'png'
  if (activeProfile.provider === 'fal') nextParams.stream = false

  if (nextParams.output_format !== 'jpeg' && nextParams.output_format !== 'webp') {
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  }

  return nextParams
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number) {
  return value == null || !Number.isFinite(value) ? fallback : Math.min(max, Math.max(min, Math.round(value)))
}

/** GIF 的 size 是单帧尺寸，不能套用静态图的最小像素预算将小帧放大。 */
function normalizeGifSize(size: string) {
  if (size === 'auto') return size
  const parsed = parseOutputSize(size)
  if (!parsed || parsed.width % 16 || parsed.height % 16) return 'auto'
  return `${parsed.width}x${parsed.height}`
}

export function getChangedParams(current: TaskParams, next: TaskParams): Partial<TaskParams> {
  const patch: Partial<TaskParams> = {}
  for (const key of Object.keys(next) as Array<keyof TaskParams>) {
    if (current[key] !== next[key]) {
      ;(patch as Record<keyof TaskParams, TaskParams[keyof TaskParams]>)[key] = next[key]
    }
  }
  return patch
}
