import { buildTransparentPrompt, removeKeyedBackgroundFromDataUrl } from './transparentImage'
import { normalizeParamsForSettings } from './paramCompatibility'
import { resolveActualImageParams } from './imageMetadata'
import { getActiveApiProfile } from './apiProfiles'
import { callFalAiImageApi } from './falAiImageApi'
import { callOpenAICompatibleImageApi } from './openaiCompatibleImageApi'
import type { CallApiOptions, CallApiResult } from './imageApiShared'
import type { TaskParams } from '../types'
import { normalizeImageSize } from './size'
import { applyExactImageSize } from './exactImageSize'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const profile = getActiveApiProfile(opts.settings)
  const params = normalizeParamsForSettings(opts.params, opts.settings)
  const localTransparency = params.transparent_output && params.transparent_method === 'local'
  // 上游尺寸用于生图，用户的精确目标保留至最终输出阶段，避免 1080 被改成 1088。
  const request = { ...opts, params: { ...params, size: normalizeImageSize(params.size) }, prompt: localTransparency ? buildTransparentPrompt(opts.prompt) : opts.prompt }
  const result = profile.provider === 'fal'
    ? await callFalAiImageApi(request, profile)
    : await callOpenAICompatibleImageApi(request, profile)
  return finalizeImageResult(result, params, opts.signal)
}

export async function finalizeImageResult(result: CallApiResult, params: TaskParams, signal?: AbortSignal): Promise<CallApiResult> {
  if (params.transparent_output && params.transparent_method === 'local') {
    // 一次处理一张，避免批量 4K 抠图同时占用大量像素缓冲区。
    for (let index = 0; index < result.images.length; index++) {
      signal?.throwIfAborted()
      result.images[index] = await removeKeyedBackgroundFromDataUrl(result.images[index], undefined, params.output_format === 'webp' ? 'webp' : 'png', params.output_compression ?? undefined)
    }
    // 上游的背景元数据描述抠图前的原图，不能标成后处理结果。
    if (result.actualParams) delete result.actualParams.background
    for (const actual of result.actualParamsList ?? []) if (actual) delete actual.background
  }
  result.actualParamsList = await Promise.all(result.images.map((image, index) =>
    resolveActualImageParams(image, result.actualParamsList?.[index] ?? result.actualParams),
  ))
  // codex2api 的 2K/4K 超分交给网关；保留原图模式不会在浏览器中二次缩放。
  if (params.size !== 'auto' && (params.size_fit === 'pad' || params.size_fit === 'cover')) {
    for (let index = 0; index < result.images.length; index++) {
      const output = await applyExactImageSize(result.images[index], params, signal)
      result.images[index] = output.image
      result.actualParamsList[index] = { ...result.actualParamsList[index], size: params.size }
      if (output.resized) {
        const actual = { ...result.actualParamsList[index] }
        // 原生 background 描述上游图；补边后已不一定适用。
        if (params.size_fit === 'pad') delete actual.background
        result.actualParamsList[index] = {
          ...actual, size: params.size, source_size: output.sourceSize, size_fit: params.size_fit,
          output_format: output.image.startsWith('data:image/png') ? 'png' : params.output_format,
        }
      }
    }
  }
  result.actualParams = { ...result.actualParams, ...result.actualParamsList[0] }
  if (result.actualParamsList[0]?.size_fit === 'pad') delete result.actualParams.background
  signal?.throwIfAborted()
  return result
}
