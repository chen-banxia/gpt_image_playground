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
  { value: 'gpt-image-2.6-sunburst', descriptionKey: 'modelDescGptImage26Sunburst' },
  { value: 'gpt-image-2.6-flare', descriptionKey: 'modelDescGptImage26Flare' },
  { value: 'gpt-image-2.6', descriptionKey: 'modelDescGptImage26' },
  // -2k/-4k 是 codex2api 的网关别名，必须完整发送，不能去掉后缀后再调用。
  { value: 'gpt-image-2.5-sunburst', descriptionKey: 'modelDescGptImage25Sunburst' },
  { value: 'gpt-image-2.5-sunburst-2k', descriptionKey: 'modelDescImage2K' },
  { value: 'gpt-image-2.5-sunburst-4k', descriptionKey: 'modelDescImage4K' },
  { value: 'gpt-image-2.5-flare', descriptionKey: 'modelDescGptImage25Flare' },
  { value: 'gpt-image-2.5-flare-2k', descriptionKey: 'modelDescImage2K' },
  { value: 'gpt-image-2.5-flare-4k', descriptionKey: 'modelDescImage4K' },
  { value: 'gpt-image-2.5', descriptionKey: 'modelDescGptImage25' },
  { value: 'gpt-image-2', descriptionKey: 'modelDescGptImage2' },
  { value: 'gpt-image-2-2k', descriptionKey: 'modelDescImage2K' },
  { value: 'gpt-image-2-4k', descriptionKey: 'modelDescImage4K' },
]

export function isKnownImageModel(model: string): boolean {
  return IMAGE_MODEL_OPTIONS.some((option) => option.value === model)
}

/** 官方已确认的 2.6 模型；不猜测无后缀 ID 或网关别名的能力。 */
export function isGptImage26Model(model: string) {
  return model === 'gpt-image-2.6-sunburst' || model === 'gpt-image-2.6-flare'
}

export function supportsExtendedImageQuality(model: string) {
  // 2K/4K 仅保留本项目已使用的网关别名；其余自定义名称不能靠子串推断能力。
  return /^gpt-image-2\.5-(sunburst|flare)(-2026-09-08|-2k|-4k)?$/.test(model) || isGptImage26Model(model)
}
