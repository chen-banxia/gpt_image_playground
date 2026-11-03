import { tCurrent as t } from '../../i18n'
import * as db from './db'
import type { MediaType, VideoAsset } from './types'
import { safeMediaUrl } from './api'

// 明确的客户端资源保护上限，页面同步展示；不将其冒充厂商配额。
export const MAX_INPUT_BYTES = 100 * 1024 * 1024
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export async function addFile(file: File): Promise<VideoAsset> {
  const mediaType = file.type.split('/')[0] as MediaType
  if (!['image', 'video', 'audio'].includes(mediaType)) throw new Error(t("请选择图片、视频或音频文件"))
  if (!file.size || file.size > (mediaType === 'image' ? MAX_IMAGE_BYTES : MAX_INPUT_BYTES)) throw new Error(mediaType === 'image' ? t("图片需小于 20MB") : t("本地参考视频或音频需小于 100MB，可改用可访问的素材链接"))
  if (mediaType === 'image' && !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(t("首帧和参考图支持 PNG、JPEG、WebP"))
  const asset: VideoAsset = { id: crypto.randomUUID(), name: file.name, mediaType, mimeType: file.type, sizeBytes: file.size, createdAt: Date.now() }
  if (mediaType === 'image') {
    const bitmap = await createImageBitmap(file)
    asset.width = bitmap.width; asset.height = bitmap.height; bitmap.close()
    if (Math.min(asset.width, asset.height) < 300 || Math.max(asset.width / asset.height, asset.height / asset.width) > 2.5) throw new Error(t("图片短边至少 300px，长宽比需在 2:5 到 5:2 之间"))
  } else {
    const objectUrl = URL.createObjectURL(file)
    try {
      await new Promise<void>((resolve, reject) => {
        const media = document.createElement(mediaType)
        const timer = window.setTimeout(() => finish(new Error(t("无法读取媒体信息，请换用常见的视频或音频格式"))), 10000)
        function finish(error?: Error) { clearTimeout(timer); media.removeAttribute('src'); media.load(); error ? reject(error) : resolve() }
        media.preload = 'metadata'
        media.onloadedmetadata = () => {
          asset.duration = media.duration
          if (media instanceof HTMLVideoElement) { asset.width = media.videoWidth; asset.height = media.videoHeight }
          finish(Number.isFinite(asset.duration) && asset.duration > 0 ? undefined : new Error(t("无法读取素材时长")))
        }
        media.onerror = () => finish(new Error(t("无法解码该素材，请检查文件格式")))
        media.src = objectUrl
      })
    } finally { URL.revokeObjectURL(objectUrl) }
  }
  await db.saveAsset(asset, file)
  return asset
}
export async function addRemoteAsset(url: string, mediaType: MediaType, name?: string): Promise<VideoAsset> {
  const safe = safeMediaUrl(url)
  if (!safe) throw new Error(t("请输入有效的 HTTP(S) 素材链接"))
  const asset: VideoAsset = { id: crypto.randomUUID(), name: name || t("{0}链接", { "0": { image: t("图片"), video: t("视频"), audio: t("音频") }[mediaType] }), remoteUrl: safe, mediaType, mimeType: `${mediaType}/*`, sizeBytes: 0, createdAt: Date.now() }
  await db.saveAsset(asset)
  return asset
}
export function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(blob) })
}
export async function resolveInput(asset: VideoAsset) {
  if (asset.remoteUrl) return asset.remoteUrl
  const record = await db.readOne<{ id: string; blob: Blob }>('assetBlobs', asset.id)
  if (!record?.blob) throw new Error(t("素材「{0}」的原文件缺失，请重新选择", { "0": asset.name }))
  return blobDataUrl(record.blob)
}
