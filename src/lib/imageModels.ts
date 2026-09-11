import type { TranslationKey } from '../i18n'

export interface ImageModelOption {
  /** 请求中使用的模型 ID */
  value: string
  /** 下拉项里的一句话说明 */
  descriptionKey: TranslationKey
}

/**
 * 画图可选模型，顺序即下拉展示顺序。
 * 第一项与 apiProfiles 的 DEFAULT_IMAGES_MODEL 保持一致，为默认模型。
 */
export const IMAGE_MODEL_OPTIONS: ImageModelOption[] = [
  { value: 'gpt-image-2.5-flare', descriptionKey: 'modelDescGptImage25Flare' },
  { value: 'gpt-image-2.5-sunburst', descriptionKey: 'modelDescGptImage25Sunburst' },
  { value: 'gpt-image-2.5', descriptionKey: 'modelDescGptImage25' },
  { value: 'gpt-image-2', descriptionKey: 'modelDescGptImage2' },
]

export function isKnownImageModel(model: string): boolean {
  return IMAGE_MODEL_OPTIONS.some((option) => option.value === model)
}
