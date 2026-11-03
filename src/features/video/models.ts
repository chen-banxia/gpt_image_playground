import { tCurrent as t } from '../../i18n'
import type { VideoAsset, VideoDraft, VideoInput, VideoParams, KeySlot } from './types'

export const RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive']
// 分辨率按从低到高排列，用户切换模型时使用首项作为默认档位。
export const VIDEO_MODELS = [
  { id: 'doubao-seedance-2-0-260128', name: "豆包 Seedance 2.0" as const, keySlot: 'doubaoVideo', resolutions: ['480p', '720p', '1080p', '4k'], maxDuration: 15, images: 9, videos: 3, audios: 3 },
  { id: 'doubao-seedance-2-0-fast-260128', name: "豆包 Seedance 2.0 Fast" as const, keySlot: 'doubaoVideo', resolutions: ['480p', '720p'], maxDuration: 15, images: 9, videos: 3, audios: 3 },
  { id: 'doubao-seedance-2-0-mini-260615', name: "豆包 Seedance 2.0 Mini" as const, keySlot: 'doubaoVideo', resolutions: ['480p', '720p'], maxDuration: 15, images: 9, videos: 3, audios: 3 },
  { id: 'doubao-seedance-2-5-260628', name: "豆包 Seedance 2.5" as const, keySlot: 'doubaoVideo', resolutions: ['480p', '720p', '1080p'], maxDuration: 30, images: 30, videos: 10, audios: 10 },
  { id: 'MiniMax-H3', name: "海螺 H3" as const, keySlot: 'hailuoVideo', resolutions: ['768P', '2K'], maxDuration: 15, images: 9, videos: 3, audios: 3 },
] satisfies Array<{ id: string; name: string; keySlot: KeySlot; resolutions: string[]; maxDuration: number; images: number; videos: number; audios: number }>
export function modelFor(id: string) {
  const model = VIDEO_MODELS.find(m => m.id === id)
  if (!model) throw new Error(t("请选择支持的视频模型"))
  return model
}
/** 上游允许整数秒范围；常用档位仅用于简化 UI，不代表其余整数秒不可用。
 * https://www.volcengine.com/docs/82379/1520757
 * https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create
 */
export function durationPolicy(modelId: string) {
  const model = modelFor(modelId)
  return {
    min: 4,
    max: model.maxDuration,
    automatic: model.keySlot === 'doubaoVideo',
    presets: [5, 10, 15, 20, 30].filter(seconds => seconds <= model.maxDuration),
  }
}
export function supportsDuration(modelId: string, seconds: number) {
  const policy = durationPolicy(modelId)
  return Number.isInteger(seconds) && (seconds >= policy.min && seconds <= policy.max || seconds === -1 && policy.automatic)
}
export const defaultDraft = (): VideoDraft => ({ id: 'main', prompt: '', modelId: VIDEO_MODELS[0].id, inputMode: 'frames', frames: [], references: [], params: { duration: 5, resolution: '720p', ratio: '16:9' }, groupId: null })
export const activeInputs = (draft: VideoDraft) => draft.inputMode === 'frames' ? draft.frames : draft.references
export const is25 = (id: string) => id === 'doubao-seedance-2-5-260628'
export function effectiveParams(draft: VideoDraft): VideoParams {
  // 首尾帧约束和参考图片的语义不同，不能对所有有图请求强制 adaptive。
  return { ...draft.params, ...((is25(draft.modelId) || draft.modelId === 'MiniMax-H3') && draft.inputMode === 'frames' && draft.frames.some(i => i.role === 'first_frame') ? { ratio: 'adaptive' } : {}) }
}
export function validateDraft(draft: VideoDraft, assets: VideoAsset[], translate = t): string[] {
  let model
  try { model = modelFor(draft.modelId) } catch { return [translate("请选择支持的视频模型")] }
  const errors: string[] = []
  const inputs = activeInputs(draft)
  const params = effectiveParams(draft)
  if (!draft.prompt.trim()) errors.push(translate("请描述希望生成的画面、动作或镜头变化"))
  if (draft.prompt.length > 10000) errors.push(translate("描述不能超过 10000 个字符"))
  if (!supportsDuration(model.id, params.duration)) errors.push(translate("时长请选择 4–{0} 秒{1}", { "0": model.maxDuration, "1": model.keySlot === 'doubaoVideo' ? translate("或智能时长") : '' }))
  if (!model.resolutions.includes(params.resolution)) errors.push(translate("{0} 不支持 {1}，请调整分辨率", { "0": translate(model.name), "1": params.resolution }))
  if (!RATIOS.includes(params.ratio)) errors.push(translate("请选择有效的画面比例"))
  if (model.keySlot === 'hailuoVideo' && !inputs.some(i => i.role !== 'reference_audio') && params.ratio === 'adaptive') errors.push(translate("海螺无素材时需要选择明确的画面比例"))
  if (draft.inputMode === 'frames') {
    if (inputs.length > 2 || inputs.some(i => !['first_frame', 'last_frame'].includes(i.role))) errors.push(translate("首尾帧只能放入首帧和尾帧图片，更多素材请使用全能参考"))
    if (inputs.some(i => i.role === 'last_frame') && !inputs.some(i => i.role === 'first_frame')) errors.push(translate("请先添加首帧，或将尾帧设为首帧"))
    if (new Set(inputs.map(i => i.role)).size !== inputs.length) errors.push(translate("首帧和尾帧各只能使用一张图片"))
  } else {
    if (!inputs.length) errors.push(translate("请添加至少一份参考素材，或切回首尾帧进行纯文本生成"))
    if (inputs.some(i => !i.role.startsWith('reference_'))) errors.push(translate("参考素材不能与首尾帧混用"))
    if (model.keySlot === 'doubaoVideo' && !is25(model.id) && inputs.length && inputs.every(i => i.role === 'reference_audio')) errors.push(translate("请在参考音频之外添加图片或视频"))
  }
  const selected = inputs.map(i => assets.find(a => a.id === i.assetId))
  if (selected.some(a => !a)) errors.push(translate("部分输入素材缺失，请重新选择，系统不会忽略缺失素材"))
  for (const [index, asset] of selected.entries()) {
    if (!asset) continue
    if (!inputs[index].role.endsWith(asset.mediaType) && !(asset.mediaType === 'image' && ['first_frame', 'last_frame'].includes(inputs[index].role))) errors.push(translate("{0} 的类型与用途不匹配", { "0": asset.name }))
    const maxSeconds = is25(model.id) ? 30 : 15
    if (asset.mediaType !== 'image' && asset.duration !== undefined && (asset.duration < 2 || asset.duration > maxSeconds)) errors.push(translate("{0} 时长需为 2–{1} 秒", { "0": asset.name, "1": maxSeconds }))
    if (asset.mediaType === 'audio' && asset.sizeBytes > 15 * 1024 * 1024) errors.push(translate("{0} 音频不能超过 15MB", { "0": asset.name }))
    if (asset.mediaType === 'video' && model.keySlot === 'hailuoVideo' && asset.sizeBytes > 50 * 1024 * 1024) errors.push(translate("{0} 的海螺参考视频不能超过 50MB", { "0": asset.name }))
    if (asset.mediaType === 'video' && !asset.remoteUrl && model.keySlot === 'doubaoVideo') errors.push(translate("{0} 请使用公网视频链接；豆包参考视频不发送本地 Base64。文件已保留，可移除后添加链接", { "0": asset.name }))
    if (asset.mediaType === 'audio' && !asset.remoteUrl && !['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav'].includes(asset.mimeType)) errors.push(translate("{0} 请使用 WAV 或 MP3 音频", { "0": asset.name }))
    if (asset.mediaType === 'video' && !asset.remoteUrl && !['video/mp4', 'video/quicktime'].includes(asset.mimeType)) errors.push(translate("{0} 请使用 MP4 或 MOV 视频", { "0": asset.name }))
  }
  for (const [type, max] of [['image', model.images], ['video', model.videos], ['audio', model.audios]] as const) {
    if (selected.filter(a => a?.mediaType === type).length > max) errors.push(translate("{0} 最多使用 {1} 份{2}参考", { "0": translate(model.name), "1": max, "2": { image: translate("图片"), video: translate("视频"), audio: translate("音频") }[type] }))
    if (type !== 'image' && selected.filter(a => a?.mediaType === type).reduce((sum, a) => sum + (a?.duration ?? 0), 0) > (is25(model.id) ? 30 : 15)) errors.push(translate("参考{0}总时长不能超过 {1} 秒", { "0": type === 'video' ? translate("视频") : translate("音频"), "1": is25(model.id) ? 30 : 15 }))
  }
  return [...new Set(errors)]
}

/** Doubao 与 H3 均使用 content JSON，但路由、响应及厂商专用参数分别处理。 */
export function buildVideoRequest(draft: VideoDraft, resolvedInputs: Array<VideoInput & { url: string }>) {
  const model = modelFor(draft.modelId)
  const p = effectiveParams(draft)
  if (!supportsDuration(model.id, p.duration)) throw new Error(t('时长请选择 4–{0} 秒{1}', { 0: model.maxDuration, 1: durationPolicy(model.id).automatic ? t('或智能时长') : '' }))
  const content: Record<string, unknown>[] = [{ type: 'text', text: draft.prompt.trim() }]
  for (const input of resolvedInputs) {
    const type = input.role.endsWith('video') ? 'video_url' : input.role.endsWith('audio') ? 'audio_url' : 'image_url'
    content.push({ type, [type]: { url: input.url }, role: input.role })
  }
  const request: Record<string, unknown> = { model: model.id, content, duration: p.duration, resolution: p.resolution, ratio: p.ratio }
  if (model.keySlot === 'doubaoVideo') {
    for (const key of ['generate_audio', 'watermark', 'return_last_frame'] as const) if (typeof p[key] === 'boolean') request[key] = p[key]
    if (is25(model.id) && p.output_format) request.output_format = p.output_format
  }
  return request
}
