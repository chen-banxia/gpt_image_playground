import { DEFAULT_PARAMS, type AppSettings, type TaskParams } from '../types'
import { getActiveApiProfile } from './apiProfiles'
import { normalizeImageSize, parseOutputSize } from './size'
import { isGptImage25Model } from './imageModels'
import { tCurrent } from '../i18n'

export const DEFAULT_FAL_IMAGE_SIZE = '1360x1024'
export const MAX_FAL_OUTPUT_IMAGES = 4
export const MAX_OPENAI_OUTPUT_IMAGES = 10

export function getOutputImageLimitForSettings(settings: AppSettings) {
  return getActiveApiProfile(settings).provider === 'fal' ? MAX_FAL_OUTPUT_IMAGES : MAX_OPENAI_OUTPUT_IMAGES
}

export function normalizeParamsForSettings(params: TaskParams, settings: AppSettings): TaskParams {
  const activeProfile = getActiveApiProfile(settings)
  const outputImageLimit = getOutputImageLimitForSettings(settings)
  // 缺省保留网关原图，只有用户明确选择补边或裁剪时才启用本地尺寸处理。
  const sizeFit = params.size_fit === 'pad' || params.size_fit === 'cover' ? params.size_fit : 'none'
  const exact = params.size !== 'auto' && sizeFit !== 'none'
  const target = exact ? parseOutputSize(params.size) : null
  if (exact && !target) throw new Error(tCurrent('invalidOutputSize'))
  const nextParams: TaskParams = {
    ...DEFAULT_PARAMS,
    ...params,
    size: target ? `${target.width}x${target.height}` : normalizeImageSize(params.size) || DEFAULT_PARAMS.size,
    size_fit: sizeFit,
    n: Math.min(outputImageLimit, Math.max(1, params.n || DEFAULT_PARAMS.n)),
  }

  if (activeProfile.provider === 'fal') {
    if (nextParams.size === 'auto') nextParams.size = DEFAULT_FAL_IMAGE_SIZE
    if (nextParams.quality === 'auto') nextParams.quality = 'high'
    nextParams.moderation = DEFAULT_PARAMS.moderation
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  }

  const imageModel = activeProfile.apiMode === 'responses' ? activeProfile.imageGenerationModel ?? '' : activeProfile.model
  if ((nextParams.quality === 'xhigh' || nextParams.quality === 'max') && !isGptImage25Model(imageModel)) nextParams.quality = 'high'
  if (nextParams.transparent_output && nextParams.output_format === 'jpeg') nextParams.output_format = 'png'
  if (activeProfile.provider === 'fal') nextParams.stream = false

  if (nextParams.output_format === 'png') {
    nextParams.output_compression = DEFAULT_PARAMS.output_compression
  }

  return nextParams
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
