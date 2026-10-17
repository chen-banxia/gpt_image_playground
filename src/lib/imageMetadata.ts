import type { TaskParams } from '../types'

/** 最终文件像素优先于接口声明的尺寸；不根据图片外观推测质量档位。 */
export async function resolveActualImageParams(dataUrl: string, reported?: Partial<TaskParams>): Promise<Partial<TaskParams> | undefined> {
  if (typeof Image === 'undefined') return reported
  return new Promise((resolve) => {
    const image = new Image()
    const finish = (params = reported) => {
      clearTimeout(timer)
      image.onload = null
      image.onerror = null
      resolve(params)
    }
    const timer = setTimeout(() => finish(), 3000)
    image.onerror = () => finish()
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) return finish()
      const mime = dataUrl.match(/^data:image\/(png|jpeg|webp)[;,]/)?.[1] as TaskParams['output_format'] | undefined
      finish({
        ...reported,
        size: `${image.naturalWidth}x${image.naturalHeight}`,
        ...(mime ? { output_format: mime } : {}),
      })
    }
    image.src = dataUrl
  })
}
