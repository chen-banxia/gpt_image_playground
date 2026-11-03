import { tCurrent as t } from '../../i18n'
import { create } from 'zustand'
import * as db from './db'
import { activeInputs, buildVideoRequest, defaultDraft, modelFor, validateDraft } from './models'
import { createdVideoId, normalizeGateway, parseSnapshot, requestVideo, VideoApiError, videoEndpoint } from './api'
import { configuredVideoRoute, taskVideoRoute } from './providers'
import { resolveInput } from './assets'
import { useVideoSettings } from './settings'
import type { VideoAsset, VideoDraft, VideoTask } from './types'

interface State {
  ready: boolean; error: string; tasks: VideoTask[]; assets: VideoAsset[]; draft: VideoDraft; saving: boolean; submitting: boolean; pendingAccepted?: VideoTask
  updateDraft: (patch: Partial<VideoDraft>) => void
}
let draftWrites: Promise<void> = Promise.resolve()
// 清理时递增代次，让旧网络响应与未完成的草稿写入失效，避免记录被重新写回。
let epoch = 0
let initialized: Promise<void> | undefined
const boundCredentials = new Map<string, string>()
const inflight = new Set<string>()
const nextPoll = new Map<string, number>()
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('gpt-video-playground') : null
export const useVideoStore = create<State>((set, get) => ({
  ready: false, error: '', tasks: [], assets: [], draft: defaultDraft(), saving: false, submitting: false,
  updateDraft: patch => {
    const draft = { ...get().draft, ...patch }
    set({ draft, saving: true })
    const currentEpoch = epoch
    draftWrites = draftWrites.catch(() => {}).then(async () => { if (currentEpoch === epoch) await db.saveDraft(draft) })
    const current = draftWrites
    current.then(() => { if (draftWrites === current) set({ saving: false, error: '' }) }).catch(e => { if (draftWrites === current) set({ saving: false, error: t("草稿保存失败：{0}", { "0": message(e) }) }) })
  },
}))
export const message = (e: unknown) => e instanceof Error ? e.message : String(e)
export async function refreshVideo() {
  const captured = epoch
  const [tasks, assets] = await Promise.all([db.readAll<VideoTask>('videoTasks'), db.readAll<VideoAsset>('inputAssets')])
  if (captured === epoch) useVideoStore.setState({ tasks: tasks.sort((a, b) => b.createdAt - a.createdAt), assets })
}
async function changed() { await refreshVideo(); channel?.postMessage({ type: 'records' }) }
export function initializeVideo() {
  if (!initialized) initialized = (async () => {
    try {
      const draft = await db.readOne<VideoDraft>('drafts', 'main')
      await refreshVideo()
      // 刷新可能发生在服务端受理后、任务 ID 落盘前；不能据此自动重发收费请求。
      const interrupted = useVideoStore.getState().tasks.filter(t => t.submissionState === 'submitting' && !t.gatewayTaskId)
      if (interrupted.length) {
        await db.patchTasks(interrupted.map(t => t.id), { submissionState: 'submit_unknown', syncState: 'paused', error: t("上次提交中断，结果待确认。请先核对 New API 任务记录，不要直接重复生成。") })
        await refreshVideo()
      }
      useVideoStore.setState({ ready: true, ...(draft ? { draft } : {}) })
      startSync()
    } catch (e) { useVideoStore.setState({ error: t("视频数据库不可用：{0}", { "0": message(e) }) }); initialized = undefined }
  })()
  return initialized
}
channel?.addEventListener('message', event => {
  if (event.data?.type === 'reset') { epoch++; boundCredentials.clear(); nextPoll.clear() }
  if (event.data?.type === 'records' || event.data?.type === 'reset') void refreshVideo().catch(e => useVideoStore.setState({ error: message(e) }))
})
export async function updateVideoTasks(ids: string[], patch: Partial<VideoTask>) { await db.patchTasks(ids, patch); await changed() }
export async function removeVideoTasks(ids: string[]) {
  await draftWrites
  ids.forEach(id => { boundCredentials.delete(id); nextPoll.delete(id) })
  await db.deleteTasks(ids); await db.cleanUnusedAssets(); await changed()
}
export async function resetVideo(includeDraft = false) {
  epoch++; channel?.postMessage({ type: 'reset' }); boundCredentials.clear(); nextPoll.clear()
  useVideoStore.setState({ pendingAccepted: undefined })
  await draftWrites.catch(() => {})
  await db.clearVideo(includeDraft)
  if (includeDraft) { const draft = defaultDraft(); await db.saveDraft(draft); useVideoStore.setState({ draft }) }
  else await db.cleanUnusedAssets()
  await changed()
}
export async function cleanVideoAssets() { await draftWrites.catch(() => {}); const count = await db.cleanUnusedAssets(); await changed(); return count }
export async function submitVideo(retryOfTaskId?: string, sourceDraft?: VideoDraft) {
  const state = useVideoStore.getState()
  if (state.submitting) return false
  useVideoStore.setState({ submitting: true, error: '' })
  let task: VideoTask | undefined
  let accepted = false
  let attempted = false
  const submittedEpoch = epoch
  try {
    await draftWrites
    const draft = structuredClone(sourceDraft ?? useVideoStore.getState().draft)
    const errors = validateDraft(draft, state.assets)
    if (errors.length) throw new Error(errors.join('；'))
    const settings = useVideoSettings.getState().settings
    const model = modelFor(draft.modelId)
    const credential = settings[model.keySlot]
    if (!credential.apiKey.trim()) throw new Error(t("请配置{0}视频 Key", { "0": model.keySlot === 'doubaoVideo' ? t("豆包") : t("海螺") }))
    const root = normalizeGateway(settings.gatewayBaseUrl)
    // 新提交取当前服务配置并保存快照；后续查询不随用户切换模型或编辑路径而变化。
    const route = configuredVideoRoute(settings, model.keySlot)
    const inputs = activeInputs(draft)
    const resolved = []
    let encodedBytes = 0
    for (const i of inputs) {
      const asset = state.assets.find(a => a.id === i.assetId)!
      const url = await resolveInput(asset)
      encodedBytes += url.length
      if (encodedBytes > 60 * 1024 * 1024) throw new Error(t("编码后的素材超过 60MB 请求保护上限，请改用公网素材链接"))
      resolved.push({ ...i, url })
    }
    const body = buildVideoRequest(draft, resolved)
    task = { id: crypto.randomUUID(), modelId: model.id, keySlot: model.keySlot, credentialRevision: credential.revision, gatewayBaseUrl: root, route, proxy: settings.proxy, prompt: draft.prompt, inputMode: draft.inputMode, inputs, params: draft.params, groupId: draft.groupId, isFavorite: false, status: 'unknown', submissionState: 'submitting', syncState: 'syncing', retryOfTaskId: retryOfTaskId ?? draft.retryOfTaskId, createdAt: Date.now(), updatedAt: Date.now() }
    await db.saveTask(task) // 本地写入失败时不得先发起收费请求。
    boundCredentials.set(task.id, credential.apiKey)
    await changed()
    attempted = true
    const data = await requestVideo(videoEndpoint(root, undefined, settings.proxy, route), credential.apiKey, body, undefined, settings.submitTimeoutSeconds)
    const gatewayTaskId = createdVideoId(data, route.protocol)
    if (!gatewayTaskId) throw new VideoApiError(t("未取得网关任务 ID，请先核对 New API 记录，避免重复提交"))
    accepted = true
    task = { ...task, gatewayTaskId, submissionState: 'submitted' }
    if (submittedEpoch !== epoch) return
    try { await db.patchTasks([task.id], { gatewayTaskId, submissionState: 'submitted' }) } catch { useVideoStore.setState({ pendingAccepted: task }); throw new Error(t("任务已提交，但本地保存失败。请复制任务 ID：{0}，不要重复生成", { "0": gatewayTaskId })) }
    await changed()
    void syncVideoTask(task.id)
    return true
  } catch (e) {
    const error = message(e)
    if (task && !accepted) {
      const rejected = !attempted || e instanceof VideoApiError && [400, 401, 403, 404, 413, 415, 422, 429].includes(e.status)
      await db.patchTasks([task.id], { submissionState: rejected ? 'rejected' : 'submit_unknown', status: rejected ? 'failed' : 'unknown', syncState: 'paused', error }).catch(() => {})
      await changed().catch(() => {})
    }
    useVideoStore.setState({ error })
    return false
  } finally { useVideoStore.setState({ submitting: false }) }
}
/** 重试生成新任务，使用原记录内容及当前对应 Key，不改动左侧未提交草稿。 */
export async function retryVideoTask(id: string) {
  const original = await db.readOne<VideoTask>('videoTasks', id)
  if (!original || original.status !== 'failed' || original.submissionState === 'submit_unknown') throw new Error(t('只有明确失败的任务可以快捷重试'))
  return submitVideo(original.id, {
    ...defaultDraft(), prompt: original.prompt, modelId: original.modelId,
    inputMode: original.inputMode, params: original.params, groupId: original.groupId,
    frames: original.inputMode === 'frames' ? original.inputs : [],
    references: original.inputMode === 'reference' ? original.inputs : [],
  })
}
export const canSync = (task: VideoTask) => Boolean(task.gatewayTaskId) && (['queued', 'running', 'unknown'].includes(task.status) || task.status === 'succeeded' && !task.videoUrl && (task.resultSyncAttempts ?? 0) < 6)
export async function retryAcceptedSave() {
  const task = useVideoStore.getState().pendingAccepted
  if (!task) return
  const exists = await db.readOne<VideoTask>('videoTasks', task.id)
  if (!exists) throw new Error(t("本地记录已删除，请复制任务 ID 后从网关核对，不能恢复被主动删除的任务"))
  await db.patchTasks([task.id], { gatewayTaskId: task.gatewayTaskId, submissionState: 'submitted' })
  useVideoStore.setState({ pendingAccepted: undefined, error: '' })
  await changed(); void syncVideoTask(task.id)
}
export async function syncVideoTask(id: string, force = false) {
  if (inflight.has(id)) return
  inflight.add(id)
  const captured = epoch
  const run = async () => {
    const task = await db.readOne<VideoTask>('videoTasks', id)
    if (!task?.gatewayTaskId || !force && !canSync(task)) return
    if (!force && task.lastSyncedAt && Date.now() - task.lastSyncedAt < (Date.now() - task.createdAt > 60000 ? 10000 : 3500)) return
    const settings = useVideoSettings.getState().settings
    const credential = settings[task.keySlot]
    const key = boundCredentials.get(id) ?? (credential.revision === task.credentialRevision ? credential.apiKey : '')
    if (!key) { await db.patchTasks([id], { syncState: 'auth_required', error: t("请重新授权：该任务需要创建时对应的视频 Key") }); nextPoll.set(id, Date.now() + 30000); return }
    try {
      const route = taskVideoRoute(task)
      const data = await requestVideo(videoEndpoint(task.gatewayBaseUrl, task.gatewayTaskId, task.proxy, route), key)
      const snapshot = parseSnapshot(data, route.protocol)
      if (captured !== epoch) return
      // 旧状态不回退已确认终态；只补充 URL，不覆盖收藏、下载、分组。
      const terminal = ['succeeded', 'failed', 'cancelled', 'expired'].includes(task.status)
      const status = terminal ? task.status : snapshot.status === 'unknown' && task.status !== 'unknown' ? task.status : snapshot.status
      await db.patchTasks([id], { status, rawStatus: snapshot.rawStatus, syncState: 'paused', error: snapshot.error?.split(key).join(t("[已隐藏]")), lastSyncedAt: Date.now(), actualParams: snapshot.actualParams, ...(snapshot.videoUrl ? { videoUrl: snapshot.videoUrl, resultUrlUpdatedAt: Date.now(), resultAccessError: undefined } : {}), ...(snapshot.lastFrameUrl ? { lastFrameUrl: snapshot.lastFrameUrl } : {}), resultSyncAttempts: status === 'succeeded' && !snapshot.videoUrl ? (task.resultSyncAttempts ?? 0) + 1 : 0 })
      nextPoll.set(id, Date.now() + (Date.now() - task.createdAt > 60000 ? 12000 : 4000))
    } catch (e) {
      if (captured !== epoch) return
      const auth = e instanceof VideoApiError && [401, 403].includes(e.status)
      await db.patchTasks([id], { syncState: auth ? 'auth_required' : 'error', error: message(e) })
      nextPoll.set(id, Date.now() + Math.max(15000, ((e as VideoApiError).retryAfter ?? 0) * 1000))
    }
  }
  try {
    if (navigator.locks) await navigator.locks.request(`video-query-${id}`, { ifAvailable: true }, async lock => { if (lock) await run() })
    else await run()
    await changed()
  } catch (e) { useVideoStore.setState({ error: t("同步保存失败：{0}", { "0": message(e) }) }) }
  finally { inflight.delete(id) }
}
let syncTimer: ReturnType<typeof setInterval> | undefined
function startSync() {
  if (syncTimer) return
  syncTimer = setInterval(() => {
    for (const t of useVideoStore.getState().tasks) if (canSync(t) && t.syncState !== 'auth_required' && (nextPoll.get(t.id) ?? 0) <= Date.now()) void syncVideoTask(t.id)
  }, 2000)
}
export async function reauthorizeTask(task: VideoTask) {
  const settings = useVideoSettings.getState().settings
  if (normalizeGateway(settings.gatewayBaseUrl) !== task.gatewayBaseUrl) throw new Error(t("当前网关地址与任务原网关不同，请先核对设置"))
  if (!settings[task.keySlot].apiKey) throw new Error(t("请先填写对应的视频 Key"))
  boundCredentials.delete(task.id)
  await updateVideoTasks([task.id], { credentialRevision: settings[task.keySlot].revision, syncState: 'paused', error: undefined })
  await syncVideoTask(task.id, true)
}
export function reuseVideo(task: VideoTask) {
  useVideoStore.getState().updateDraft({ prompt: task.prompt, modelId: task.modelId, inputMode: task.inputMode, [task.inputMode === 'frames' ? 'frames' : 'references']: task.inputs, params: task.params, groupId: task.groupId, retryOfTaskId: task.status === 'failed' ? task.id : undefined })
}
