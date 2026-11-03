import { tCurrent as translateText } from '../../i18n'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import * as db from './db'
import type { VideoAsset, VideoTask, VideoDraft } from './types'
import { defaultDraft, modelFor } from './models'
import { normalizeGateway, safeMediaUrl } from './api'
import { taskVideoRoute } from './providers'
import { saveBlob, MAX_DOWNLOAD_BYTES } from './downloads'
import { refreshVideo, useVideoStore } from './store'
import { saveImageGroup, useStore } from '../../store'

const KIND = 'gpt-video-playground-backup'
const roles = ['first_frame', 'last_frame', 'reference_image', 'reference_video', 'reference_audio']
function checkInputs(inputs: any) {
  if (!Array.isArray(inputs) || inputs.length > 50 || inputs.some(i => !i || typeof i.assetId !== 'string' || !roles.includes(i.role))) throw new Error(translateText("备份素材引用无效"))
}
function cleanParams(params: any) {
  if (!params || !Number.isInteger(params.duration) || typeof params.resolution !== 'string' || typeof params.ratio !== 'string') throw new Error(translateText("备份生成参数无效"))
  return { duration: params.duration, resolution: params.resolution, ratio: params.ratio,
    ...Object.fromEntries(['generate_audio', 'watermark', 'return_last_frame'].filter(k => typeof params[k] === 'boolean').map(k => [k, params[k]])),
    ...(['mp4', 'mov'].includes(params.output_format) ? { output_format: params.output_format } : {}) }
}
export async function exportVideoBackup(groups: { id: string; name: string }[], includeInputs = false) {
  const tasks = await db.readAll<VideoTask>('videoTasks')
  const assets = await db.readAll<VideoAsset>('inputAssets')
  const drafts = await db.readAll<VideoDraft>('drafts')
  const manifest = { kind: KIND, formatVersion: 1, exportedAt: Date.now(), tasks, assets, drafts, groups }
  if (!includeInputs) { saveBlob(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), `video-history-${Date.now()}.json`); return }
  const blobs = await db.readAll<{ id: string; blob: Blob }>('assetBlobs')
  if (blobs.reduce((n, b) => n + b.blob.size, 0) > MAX_DOWNLOAD_BYTES) throw new Error(translateText("输入素材超过 256MB 打包上限，请使用轻量历史备份并分别保存原素材"))
  const files: Record<string, Uint8Array> = { 'manifest.json': strToU8(JSON.stringify(manifest)) }
  for (const item of blobs) files[`inputs/${item.id}`] = new Uint8Array(await item.blob.arrayBuffer())
  const bytes = zipSync(files, { level: 0 })
  saveBlob(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' }), `video-input-backup-${Date.now()}.zip`)
}
export function validateBackup(value: any) {
  if (value?.kind !== KIND || value.formatVersion !== 1) throw new Error(translateText("不是支持的视频备份，图片备份请在图片设置中导入"))
  if (!Array.isArray(value.tasks) || !Array.isArray(value.assets) || !Array.isArray(value.groups)) throw new Error(translateText("备份清单不完整"))
  if (value.tasks.length > 100000 || value.assets.length > 100000) throw new Error(translateText("备份记录数过多"))
  for (const task of value.tasks) {
    modelFor(task.modelId); normalizeGateway(task.gatewayBaseUrl)
    taskVideoRoute(task)
    if (typeof task.id !== 'string' || typeof task.prompt !== 'string' || !Array.isArray(task.inputs) || !task.params || !['frames', 'reference'].includes(task.inputMode)) throw new Error(translateText("视频记录字段无效"))
    checkInputs(task.inputs); cleanParams(task.params)
    if (task.videoUrl && !safeMediaUrl(task.videoUrl)) throw new Error(translateText("备份中包含无效视频地址"))
  }
  for (const a of value.assets) if (typeof a.id !== 'string' || !['image', 'video', 'audio'].includes(a.mediaType) || a.remoteUrl && !safeMediaUrl(a.remoteUrl)) throw new Error(translateText("备份素材字段无效"))
  if (new Set(value.assets.map((a: VideoAsset) => a.id)).size !== value.assets.length) throw new Error(translateText("备份存在重复素材 ID"))
  for (const group of value.groups) if (!group || typeof group.id !== 'string' || typeof group.name !== 'string' || !group.name.trim() || group.name.length > 40) throw new Error(translateText("备份分组无效"))
  if (value.drafts !== undefined) {
    if (!Array.isArray(value.drafts) || value.drafts.length > 1) throw new Error(translateText("备份草稿无效"))
    for (const draft of value.drafts) { modelFor(draft.modelId); cleanParams(draft.params); checkInputs(draft.frames); checkInputs(draft.references); if (typeof draft.prompt !== 'string' || !['frames', 'reference'].includes(draft.inputMode)) throw new Error(translateText("备份草稿无效")) }
  }
  return value as { tasks: VideoTask[]; assets: VideoAsset[]; groups: { id: string; name: string }[]; drafts?: VideoDraft[] }
}
export async function importVideoBackup(file: File, groups: { id: string; name: string }[], restoreDraft = false) {
  if (file.size > MAX_DOWNLOAD_BYTES) throw new Error(translateText("备份文件超过 256MB 导入上限"))
  let manifest: unknown
  let files: Record<string, Uint8Array> = {}
  if (file.name.endsWith('.zip')) {
    let unpacked = 0
    files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: entry => {
      if (!(entry.name === 'manifest.json' || /^inputs\/[a-zA-Z0-9_-]+$/.test(entry.name))) return false
      unpacked += entry.originalSize
      if (unpacked > MAX_DOWNLOAD_BYTES) throw new Error(translateText("解压后的备份超过 256MB 上限"))
      return true
    } })
    if (!files['manifest.json']) throw new Error(translateText("备份缺少 manifest.json"))
    if (Object.values(files).reduce((sum, b) => sum + b.length, 0) > MAX_DOWNLOAD_BYTES) throw new Error(translateText("解压后超过导入容量上限"))
    manifest = JSON.parse(strFromU8(files['manifest.json']))
  } else manifest = JSON.parse(await file.text())
  const data = validateBackup(manifest)
  const groupMap = new Map<string, string>()
  for (const group of data.groups) {
    const match = [...groups, ...useStore.getState().groups].find(g => g.name.toLowerCase() === group.name.trim().toLowerCase())
    if (match) groupMap.set(group.id, match.id)
    else groupMap.set(group.id, saveImageGroup(group.name))
  }
  const assetIds = new Map(data.assets.map(a => [a.id, crypto.randomUUID()]))
  const existing = await db.readAll<VideoTask>('videoTasks')
  let count = 0
  const remapInputs = (inputs: VideoTask['inputs']) => inputs.map(i => ({ assetId: assetIds.get(i.assetId) ?? `missing-${i.assetId}`, role: i.role }))
  let restored: VideoDraft | undefined
  await db.transaction(['videoTasks', 'inputAssets', 'assetBlobs', 'drafts'], 'readwrite', tx => {
    for (const a of data.assets) {
      const id = assetIds.get(a.id)!
      // 白名单重建对象，不把导入文件中的未知字段或凭证写入数据库。
      tx.objectStore('inputAssets').put({ id, name: String(a.name ?? translateText("导入素材")), mediaType: a.mediaType, mimeType: String(a.mimeType ?? ''), sizeBytes: Number(a.sizeBytes) || 0, width: a.width, height: a.height, duration: a.duration, remoteUrl: a.remoteUrl, createdAt: Date.now() })
      if (files[`inputs/${a.id}`]) tx.objectStore('assetBlobs').put({ id, blob: new Blob([new Uint8Array(files[`inputs/${a.id}`]).buffer], { type: a.mimeType }) })
    }
    for (const t of data.tasks) {
      if (existing.some(e => e.gatewayBaseUrl === t.gatewayBaseUrl && e.modelId === t.modelId && (t.gatewayTaskId ? e.gatewayTaskId === t.gatewayTaskId : e.id === t.id))) continue
      const inputs = remapInputs(t.inputs)
      const task: VideoTask = {
        id: crypto.randomUUID(), gatewayTaskId: typeof t.gatewayTaskId === 'string' ? t.gatewayTaskId : undefined, modelId: t.modelId, keySlot: modelFor(t.modelId).keySlot,
        credentialRevision: 'import-requires-authorization', gatewayBaseUrl: normalizeGateway(t.gatewayBaseUrl), route: taskVideoRoute(t), proxy: false,
        prompt: t.prompt, inputMode: t.inputMode, inputs, params: cleanParams(t.params),
        status: ['succeeded', 'failed', 'cancelled', 'expired', 'queued', 'running'].includes(t.status) ? t.status : 'unknown',
        submissionState: t.gatewayTaskId ? 'submitted' : 'submit_unknown', syncState: 'auth_required', error: translateText("导入记录需要确认可信网关并重新授权查询"),
        videoUrl: safeMediaUrl(t.videoUrl), groupId: t.groupId ? groupMap.get(t.groupId) ?? null : null,
        isFavorite: Boolean(t.isFavorite), downloadedAt: typeof t.downloadedAt === 'number' ? t.downloadedAt : undefined, downloadSource: t.downloadedAt ? 'manual' : undefined,
        createdAt: Number.isFinite(t.createdAt) ? t.createdAt : Date.now(), updatedAt: Date.now(),
      }
      tx.objectStore('videoTasks').put(task); count++
    }
    if (restoreDraft && data.drafts?.[0]) {
      const d = data.drafts[0]
      restored = { ...defaultDraft(), prompt: d.prompt, modelId: d.modelId, inputMode: d.inputMode, frames: remapInputs(d.frames), references: remapInputs(d.references), params: cleanParams(d.params), groupId: d.groupId ? groupMap.get(d.groupId) ?? null : null }
      tx.objectStore('drafts').put(restored)
    }
  })
  if (restored) useVideoStore.setState({ draft: restored })
  await refreshVideo()
  return count
}
