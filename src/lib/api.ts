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
import { buildImageCompositionPrompt, resolveUpscaleModel, stripImageCompositionPrompt } from './imageComposition'
import { isAnimatedGifDataUrl, isOriginalImageDataUrl, requiresOriginalOutput } from './imageFormats'
import { tCurrent } from '../i18n'

export type { CallApiOptions, CallApiResult } from './imageApiShared'
export { normalizeBaseUrl } from './devProxy'

export async function callImageApi(opts: CallApiOptions): Promise<CallApiResult> {
  const profile = getActiveApiProfile(opts.settings)
  const params = normalizeParamsForSettings(opts.params, opts.settings)
  if (requiresOriginalOutput(params.output_format) && (opts.inputImageDataUrls.length || opts.maskDataUrl)) {
    throw new Error(tCurrent('generationOnlyFormat'))
  }
  if (opts.inputImageDataUrls.some((image) => image.startsWith('data:image/svg+xml'))) {
    throw new Error(tCurrent('svgInputUnsupported'))
  }
  if (profile.provider === 'openai' && opts.inputImageDataUrls.some(isAnimatedGifDataUrl)) {
    // 输出支持动画不代表输入支持；拒绝静默取第一帧，避免改变用户的编辑意图。
    throw new Error(tCurrent('animatedGifInputUnsupported'))
  }
  const localTransparency = params.transparent_output && params.transparent_method === 'local'
  const compositionPrompt = requiresOriginalOutput(params.output_format) ? opts.prompt : buildImageCompositionPrompt(opts.prompt, params, opts.inputImageDataUrls.length > 0, Boolean(opts.maskDataUrl))
  // 2K/4K 后处理由 codex2api 的 Images 别名触发；Responses 工具不支持同一超分路由。
  const requestProfile = profile.provider === 'openai' && profile.apiMode === 'images'
    ? { ...profile, model: resolveUpscaleModel(profile.model, normalizeImageSize(params.size), profile.baseUrl) }
    : profile
  // 上游尺寸用于生图，用户的精确目标保留至最终输出阶段，避免 1080 被改成 1088。
  const request = { ...opts, params: { ...params, size: params.output_format === 'gif' ? params.size : normalizeImageSize(params.size) }, prompt: localTransparency ? buildTransparentPrompt(compositionPrompt) : compositionPrompt }
  const result = profile.provider === 'fal'
    ? await callFalAiImageApi(request, profile)
    : await callOpenAICompatibleImageApi(request, requestProfile)
  result.requestModel = requestProfile.model
  result.revisedPrompts = result.revisedPrompts?.map(stripImageCompositionPrompt)
  return finalizeImageResult(result, params, opts.signal)
}

export async function finalizeImageResult(result: CallApiResult, params: TaskParams, signal?: AbortSignal): Promise<CallApiResult> {
  if (params.transparent_output && params.transparent_method === 'local') {
    // 一次处理一张，避免批量 4K 抠图同时占用大量像素缓冲区。
    for (let index = 0; index < result.images.length; index++) {
      // 同时检查实际文件类型，兼容网关返回与请求格式不同的原始文件。
      if (isOriginalImageDataUrl(result.images[index]) || requiresOriginalOutput(params.output_format)) continue
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
      if (isOriginalImageDataUrl(result.images[index]) || requiresOriginalOutput(params.output_format)) continue
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
