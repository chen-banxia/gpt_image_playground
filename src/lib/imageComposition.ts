import type { TaskParams } from '../types'
import { parseOutputSize } from './size'

const START = '[Image canvas requirements]'
const END = '[/Image canvas requirements]'

/** 仅在发送时附加画布要求，不修改输入框和历史任务里的用户原文。 */
export function buildImageCompositionPrompt(prompt: string, params: TaskParams, hasReferences: boolean, hasMask: boolean) {
  const target = parseOutputSize(params.size)
  if (!target) return prompt
  // 用实际宽高约分，避免把接近 21:9 的自定义尺寸误写成另一组固定比例。
  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b)
  const divisor = gcd(target.width, target.height)
  const orientation = target.width === target.height ? 'square' : target.width > target.height ? 'landscape' : 'portrait'
  const instructions = [
    START,
    `Target canvas: ${target.width}x${target.height} pixels; aspect ratio ${target.width / divisor}:${target.height / divisor}; ${orientation} orientation.`,
    'Compose the image for this aspect ratio from the start. Keep the complete intended subject inside the frame with safe margins; do not crop off heads, limbs, or important content to fit the canvas.',
    'If the native generation resolution is lower, keep the same target aspect ratio and composition so the gateway can upscale the image without cropping or stretching.',
    hasMask
      ? 'Respect the supplied mask and the requested edit. Preserve unmasked content; do not expand or repaint protected regions to satisfy the canvas instructions.'
      : hasReferences
        ? 'Use the reference images for the requested edit. Preserve subject identity, proportions and important details. When a reference does not fit the target aspect ratio, outpaint the surrounding scene to fill the target canvas, extending perspective, lighting and textures naturally instead of cropping or distorting the subject.'
        : 'Use the available canvas for a coherent composition rather than placing a square image inside a wider or taller frame.',
    params.transparent_output
      ? 'Preserve the requested transparent or solid-key background workflow. Keep the subject complete; do not add an opaque scene that conflicts with that workflow.'
      : 'Fill the canvas edge to edge with image content: no letterboxing, pillarboxing, empty borders, transparent padding, or black bars.',
    'These are rendering instructions, not text to print inside the image. Follow the user request for content.',
    END,
  ]
  return `${prompt}\n\n${instructions.join('\n')}`
}

/** 过滤上游原样回显的内部尺寸段；其余 revised_prompt 保持原样。 */
export function stripImageCompositionPrompt(prompt: string | undefined) {
  if (!prompt) return prompt
  return prompt.replace(/\[Image canvas requirements\][\s\S]*?\[\/Image canvas requirements\]/g, '').trim() || undefined
}

/** 仅为已知 codex2api Images 模型选择超分别名，不改写自定义模型或用户显式选择的别名。 */
export function resolveUpscaleModel(model: string, size: string) {
  if (!['gpt-image-2', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'].includes(model)) return model
  const target = parseOutputSize(size)
  // 按像素预算选择网关档位；后缀只触发网关超分，不代表模型原生质量。
  if (!target || target.width * target.height <= 1_572_864) return model
  return `${model}-${target.width * target.height <= 4_194_304 ? '2k' : '4k'}`
}
