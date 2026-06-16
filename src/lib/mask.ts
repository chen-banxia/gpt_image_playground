import type { InputImage } from '../types'
import { tCurrent } from '../i18n'

export type MaskCoverage = 'empty' | 'partial' | 'full'

export function validateMaskTarget(inputImages: InputImage[], targetImageId: string): InputImage {
  const target = inputImages.find((img) => img.id === targetImageId)
  if (!target) throw new Error(tCurrent('maskTargetMissing'))
  return target
}

export function orderInputImagesForMask(inputImages: InputImage[], targetImageId: string): InputImage[] {
  const target = validateMaskTarget(inputImages, targetImageId)
  return [target, ...inputImages.filter((img) => img.id !== targetImageId)]
}

export function classifyMaskAlpha(imageData: Pick<ImageData, 'data'>): MaskCoverage {
  let edited = 0
  let fullyTransparent = 0
  const total = imageData.data.length / 4

  for (let i = 3; i < imageData.data.length; i += 4) {
    if (imageData.data[i] < 255) edited++
    if (imageData.data[i] === 0) fullyTransparent++
  }

  if (edited === 0) return 'empty'
  if (fullyTransparent === total) return 'full'
  return 'partial'
}

export function assertUsableMaskCoverage(coverage: MaskCoverage): void {
  if (coverage === 'empty') {
    throw new Error(tCurrent('paintMaskFirst'))
  }
}
