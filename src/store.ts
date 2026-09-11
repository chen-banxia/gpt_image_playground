import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AppSettings,
  ApiProfile,
  TaskParams,
  InputImage,
  MaskDraft,
  TaskRecord,
  ExportData,
} from './types'
import { DEFAULT_PARAMS } from './types'
import { DEFAULT_SETTINGS, getActiveApiProfile, mergeImportedSettings, migrateLegacyDefaultImagesModel, normalizeSettings, validateApiProfile } from './lib/apiProfiles'
import {
  getAllTasks,
  putTask,
  deleteTask as dbDeleteTask,
  clearTasks as dbClearTasks,
  getImage,
  getAllImages,
  putImage,
  deleteImage,
  clearImages,
  storeImage,
} from './lib/db'
import { callImageApi } from './lib/api'
import { getFalErrorMessage, getFalQueuedImageResult, getFalQueueStatus } from './lib/falAiImageApi'
import { validateMaskMatchesImage } from './lib/canvasImage'
import { orderInputImagesForMask } from './lib/mask'
import { getChangedParams, normalizeParamsForSettings } from './lib/paramCompatibility'
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate'
import { translate, type TranslationKey } from './i18n'

// ===== Image cache =====
// 内存缓存，id → dataUrl，避免每次从 IndexedDB 读取

const imageCache = new Map<string, string>()
const FAL_RECOVERY_POLL_MS = 10_000
const falRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
const openAIWatchdogTimers = new Map<string, ReturnType<typeof setTimeout>>()
const executingTaskIds = new Set<string>()

function createOpenAITimeoutError(timeoutSeconds: number) {
  return tr('requestTimeoutError', { seconds: timeoutSeconds })
}

function tr(key: TranslationKey, replacements?: Record<string, string | number>) {
  return translate(useStore.getState().settings.language, key, replacements)
}

export function getCachedImage(id: string): string | undefined {
  return imageCache.get(id)
}

export async function ensureImageCached(id: string): Promise<string | undefined> {
  if (imageCache.has(id)) return imageCache.get(id)
  const rec = await getImage(id)
  if (rec) {
    imageCache.set(id, rec.dataUrl)
    return rec.dataUrl
  }
  return undefined
}

function orderImagesWithMaskFirst(images: InputImage[], maskTargetImageId: string | null | undefined) {
  if (!maskTargetImageId) return images
  const maskIdx = images.findIndex((img) => img.id === maskTargetImageId)
  if (maskIdx <= 0) return images
  const next = [...images]
  const [maskImage] = next.splice(maskIdx, 1)
  next.unshift(maskImage)
  return next
}

// ===== Store 类型 =====

interface AppState {
  // 设置
  settings: AppSettings
  setSettings: (s: Partial<AppSettings>) => void
  dismissedCodexCliPrompts: string[]
  dismissCodexCliPrompt: (key: string) => void

  // 输入
  prompt: string
  setPrompt: (p: string) => void
  inputImages: InputImage[]
  addInputImage: (img: InputImage) => void
  removeInputImage: (idx: number) => void
  clearInputImages: () => void
  setInputImages: (imgs: InputImage[]) => void
  moveInputImage: (fromIdx: number, toIdx: number) => void
  maskDraft: MaskDraft | null
  setMaskDraft: (draft: MaskDraft | null) => void
  clearMaskDraft: () => void
  maskEditorImageId: string | null
  setMaskEditorImageId: (id: string | null) => void

  // 参数
  params: TaskParams
  setParams: (p: Partial<TaskParams>) => void

  // 任务列表
  tasks: TaskRecord[]
  setTasks: (t: TaskRecord[]) => void

  // 搜索和筛选
  searchQuery: string
  setSearchQuery: (q: string) => void
  filterStatus: 'all' | 'running' | 'done' | 'error'
  setFilterStatus: (status: AppState['filterStatus']) => void
  filterFavorite: boolean
  setFilterFavorite: (f: boolean) => void

  // 多选
  selectedTaskIds: string[]
  setSelectedTaskIds: (ids: string[] | ((prev: string[]) => string[])) => void
  toggleTaskSelection: (id: string, force?: boolean) => void
  clearSelection: () => void

  // UI
  detailTaskId: string | null
  setDetailTaskId: (id: string | null) => void
  lightboxImageId: string | null
  lightboxImageList: string[]
  setLightboxImageId: (id: string | null, list?: string[]) => void
  showSettings: boolean
  setShowSettings: (v: boolean) => void

  // Toast
  toast: { message: string; type: 'info' | 'success' | 'error' } | null
  showToast: (message: string, type?: 'info' | 'success' | 'error') => void

  // Confirm dialog
  confirmDialog: {
    title: string
    message: string
    confirmText?: string
    showCancel?: boolean
    icon?: 'info'
    minConfirmDelayMs?: number
    messageAlign?: 'left' | 'center'
    tone?: 'danger' | 'warning'
    action: () => void
    cancelAction?: () => void
  } | null
  setConfirmDialog: (d: AppState['confirmDialog']) => void
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Settings
      settings: { ...DEFAULT_SETTINGS },
      setSettings: (s) => set((st) => {
        const previous = normalizeSettings(st.settings)
        const incoming = s as Partial<AppSettings>
        const hasLegacyOverrides =
          incoming.baseUrl !== undefined ||
          incoming.apiKey !== undefined ||
          incoming.model !== undefined ||
          incoming.timeout !== undefined ||
          incoming.apiMode !== undefined ||
          incoming.codexCli !== undefined ||
          incoming.apiProxy !== undefined
        const merged = normalizeSettings({ ...previous, ...incoming })
        if (hasLegacyOverrides && incoming.profiles === undefined) {
          merged.profiles = merged.profiles.map((profile) =>
            profile.id === merged.activeProfileId
              ? {
                  ...profile,
                  baseUrl: incoming.baseUrl ?? profile.baseUrl,
                  apiKey: incoming.apiKey ?? profile.apiKey,
                  model: incoming.model ?? profile.model,
                  timeout: incoming.timeout ?? profile.timeout,
                  apiMode: incoming.apiMode === 'images' || incoming.apiMode === 'responses' ? incoming.apiMode : profile.apiMode,
                  codexCli: incoming.codexCli ?? profile.codexCli,
                  apiProxy: incoming.apiProxy ?? profile.apiProxy,
                }
              : profile,
          )
        }
        return { settings: normalizeSettings(merged) }
      }),
      dismissedCodexCliPrompts: [],
      dismissCodexCliPrompt: (key) => set((st) => ({
        dismissedCodexCliPrompts: st.dismissedCodexCliPrompts.includes(key)
          ? st.dismissedCodexCliPrompts
          : [...st.dismissedCodexCliPrompts, key],
      })),

      // Input
      prompt: '',
      setPrompt: (prompt) => set({ prompt }),
      inputImages: [],
      addInputImage: (img) =>
        set((s) => {
          if (s.inputImages.find((i) => i.id === img.id)) return s
          return { inputImages: [...s.inputImages, img] }
        }),
      removeInputImage: (idx) =>
        set((s) => {
          const removed = s.inputImages[idx]
          const shouldClearMask = removed?.id === s.maskDraft?.targetImageId
          return {
            inputImages: s.inputImages.filter((_, i) => i !== idx),
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          }
        }),
      clearInputImages: () =>
        set((s) => {
          for (const img of s.inputImages) imageCache.delete(img.id)
          return { inputImages: [], maskDraft: null, maskEditorImageId: null }
        }),
      setInputImages: (imgs) =>
        set((s) => {
          const inputImages = orderImagesWithMaskFirst(imgs, s.maskDraft?.targetImageId)
          const shouldClearMask =
            Boolean(s.maskDraft) && !inputImages.some((img) => img.id === s.maskDraft?.targetImageId)
          return {
            inputImages,
            ...(shouldClearMask ? { maskDraft: null, maskEditorImageId: null } : {}),
          }
        }),
      moveInputImage: (fromIdx, toIdx) =>
        set((s) => {
          const images = [...s.inputImages]
          if (fromIdx < 0 || fromIdx >= images.length) return s
          const maskTargetImageId = s.maskDraft?.targetImageId
          if (maskTargetImageId && images[fromIdx]?.id === maskTargetImageId) return s
          const minTargetIdx = maskTargetImageId && images.some((img) => img.id === maskTargetImageId) ? 1 : 0
          const targetIdx = Math.max(minTargetIdx, Math.min(images.length, toIdx))
          const insertIdx = fromIdx < targetIdx ? targetIdx - 1 : targetIdx
          if (insertIdx === fromIdx) return s
          const [moved] = images.splice(fromIdx, 1)
          images.splice(insertIdx, 0, moved)
          return { inputImages: images }
        }),
      maskDraft: null,
      setMaskDraft: (maskDraft) =>
        set((s) => ({
          maskDraft,
          inputImages: orderImagesWithMaskFirst(s.inputImages, maskDraft?.targetImageId),
        })),
      clearMaskDraft: () => set({ maskDraft: null }),
      maskEditorImageId: null,
      setMaskEditorImageId: (maskEditorImageId) => set({ maskEditorImageId }),

      // Params
      params: { ...DEFAULT_PARAMS },
      setParams: (p) => set((s) => ({ params: { ...s.params, ...p } })),

      // Tasks
      tasks: [],
      setTasks: (tasks) => set({ tasks }),

      // Search & Filter
      searchQuery: '',
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      filterStatus: 'all',
      setFilterStatus: (filterStatus) => set({ filterStatus }),
      filterFavorite: false,
      setFilterFavorite: (filterFavorite) => set({ filterFavorite }),

      // Selection
      selectedTaskIds: [],
      setSelectedTaskIds: (updater) => set((s) => ({
        selectedTaskIds: typeof updater === 'function' ? updater(s.selectedTaskIds) : updater
      })),
      toggleTaskSelection: (id, force) => set((s) => {
        const isSelected = s.selectedTaskIds.includes(id)
        const shouldSelect = force !== undefined ? force : !isSelected
        if (shouldSelect === isSelected) return s
        return {
          selectedTaskIds: shouldSelect
            ? [...s.selectedTaskIds, id]
            : s.selectedTaskIds.filter((x) => x !== id)
        }
      }),
      clearSelection: () => set({ selectedTaskIds: [] }),

      // UI
      detailTaskId: null,
      setDetailTaskId: (detailTaskId) => set({ detailTaskId }),
      lightboxImageId: null,
      lightboxImageList: [],
      setLightboxImageId: (lightboxImageId, list) =>
        set({ lightboxImageId, lightboxImageList: list ?? (lightboxImageId ? [lightboxImageId] : []) }),
      showSettings: false,
      setShowSettings: (showSettings) => set({ showSettings }),

      // Toast
      toast: null,
      showToast: (message, type = 'info') => {
        set({ toast: { message, type } })
        setTimeout(() => {
          set((s) => (s.toast?.message === message ? { toast: null } : s))
        }, 3000)
      },

      // Confirm
      confirmDialog: null,
      setConfirmDialog: (confirmDialog) => set({ confirmDialog }),
    }),
    {
      name: 'gpt-image-playground',
      version: 1,
      migrate: (persistedState, version) => {
        const state = (persistedState ?? {}) as Record<string, unknown>
        if (version >= 1) return state as never
        return { ...state, settings: migrateLegacyDefaultImagesModel(state.settings) } as never
      },
      partialize: (state) => {
        const shouldRememberApiKey = state.settings.rememberApiKey
        const sanitizedSettings: AppSettings = shouldRememberApiKey
          ? state.settings
          : {
              ...state.settings,
              apiKey: '',
              profiles: state.settings.profiles.map((profile) => ({ ...profile, apiKey: '' })),
            }
        return {
          settings: sanitizedSettings,
          params: state.params,
          prompt: state.prompt,
          inputImages: state.inputImages.map((img) => ({ id: img.id, dataUrl: '' })),
          dismissedCodexCliPrompts: state.dismissedCodexCliPrompts,
        }
      },
    },
  ),
)

// ===== Actions =====

let uid = 0
function genId(): string {
  return Date.now().toString(36) + (++uid).toString(36) + Math.random().toString(36).slice(2, 6)
}

export function getCodexCliPromptKey(settings: AppSettings): string {
  const profile = getActiveApiProfile(settings)
  return `${profile.baseUrl}\n${profile.apiKey}`
}

function getTaskApiProfile(settings: AppSettings, task: TaskRecord) {
  const normalized = normalizeSettings(settings)
  const provider = task.apiProvider ?? 'openai'
  const active = getActiveApiProfile(normalized)
  if (
    active.provider === provider &&
    (!task.apiProfileName || task.apiProfileName === active.name || task.apiModel === active.model)
  ) {
    return active
  }

  return normalized.profiles.find((profile) =>
    profile.provider === provider &&
    (profile.name === task.apiProfileName || profile.model === task.apiModel),
  ) ?? (active.provider === provider ? active : null) ?? normalized.profiles.find((profile) => profile.provider === provider) ?? null
}

function getOpenAITaskProfile(settings: AppSettings, task: TaskRecord) {
  const profile = getTaskApiProfile(settings, { ...task, apiProvider: 'openai' })
  return profile?.provider === 'openai' ? profile : null
}

function activateProfileForTask(settings: AppSettings, profile: ApiProfile): AppSettings {
  return normalizeSettings({
    ...settings,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    model: profile.model,
    timeout: profile.timeout,
    apiMode: profile.apiMode,
    codexCli: profile.codexCli,
    apiProxy: profile.apiProxy,
    activeProfileId: profile.id,
  })
}

function isOpenAITask(task: TaskRecord) {
  return (task.apiProvider ?? 'openai') === 'openai'
}

function isRunningOpenAITask(task: TaskRecord) {
  return task.status === 'running' && isOpenAITask(task)
}

export function markExpiredOpenAIRunningTasks(tasks: TaskRecord[], settings: AppSettings, now = Date.now()) {
  const expiredTasks: TaskRecord[] = []
  const updatedTasks = tasks.map((task) => {
    if (!isRunningOpenAITask(task)) return task

    const timeoutSeconds = getOpenAITaskProfile(settings, task)?.timeout ?? DEFAULT_SETTINGS.timeout
    const attemptElapsed = Math.max(0, now - (task.attemptStartedAt ?? task.createdAt))
    if (attemptElapsed < timeoutSeconds * 1000) return task
    const elapsed = Math.max(0, now - task.createdAt)

    const updated: TaskRecord = {
      ...task,
      status: 'error',
      error: createOpenAITimeoutError(timeoutSeconds),
      falRecoverable: false,
      finishedAt: now,
      elapsed,
    }
    expiredTasks.push(updated)
    return updated
  })

  return { tasks: updatedTasks, expiredTasks }
}

function clearOpenAIWatchdogTimer(taskId: string) {
  const timer = openAIWatchdogTimers.get(taskId)
  if (timer) clearTimeout(timer)
  openAIWatchdogTimers.delete(taskId)
}

function failOpenAITaskIfStillRunning(taskId: string, error: string, now = Date.now()) {
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningOpenAITask(task)) return false

  updateTaskInStore(taskId, {
    status: 'error',
    error,
    falRecoverable: false,
    finishedAt: now,
    elapsed: Math.max(0, now - task.createdAt),
  })
  return true
}

function scheduleOpenAIWatchdog(taskId: string, timeoutSeconds: number, onTimeout?: () => void) {
  clearOpenAIWatchdogTimer(taskId)
  const task = useStore.getState().tasks.find((item) => item.id === taskId)
  if (!task || !isRunningOpenAITask(task)) return

  const timeoutMs = Math.max(0, timeoutSeconds * 1000)
  const timer = setTimeout(() => {
    openAIWatchdogTimers.delete(taskId)
    const failed = failOpenAITaskIfStillRunning(taskId, createOpenAITimeoutError(timeoutSeconds))
    if (failed) {
      onTimeout?.()
      useStore.getState().showToast(tr('openAITaskTimeout'), 'error')
    }
  }, timeoutMs)
  openAIWatchdogTimers.set(taskId, timer)
}

export function showCodexCliPrompt(force = false, reason?: string) {
  const state = useStore.getState()
  const settings = state.settings
  const promptKey = getCodexCliPromptKey(settings)
  if (!force && (settings.codexCli || state.dismissedCodexCliPrompts.includes(promptKey))) return
  const displayReason = reason ?? translate(settings.language, 'promptRewrittenReason')

  state.setConfirmDialog({
    title: translate(settings.language, 'codexCliDetectedTitle'),
    message: translate(settings.language, 'codexCliDetectedMessage', { reason: displayReason }),
    confirmText: translate(settings.language, 'enable'),
    action: () => {
      const state = useStore.getState()
      state.dismissCodexCliPrompt(promptKey)
      state.setSettings({ codexCli: true })
    },
    cancelAction: () => useStore.getState().dismissCodexCliPrompt(promptKey),
  })
}

function getFalRecoveryProfile(settings: AppSettings, task: TaskRecord) {
  const normalized = normalizeSettings(settings)
  const active = getActiveApiProfile(normalized)
  if (active.provider === 'fal') return active
  return normalized.profiles.find((profile) =>
    profile.provider === 'fal' &&
    (profile.name === task.apiProfileName || profile.model === task.apiModel),
  ) ?? normalized.profiles.find((profile) => profile.provider === 'fal') ?? null
}

function isFalConnectionRecoverableError(err: unknown) {
  if (typeof DOMException !== 'undefined' && err instanceof DOMException && err.name === 'AbortError') return true
  const message = err instanceof Error ? err.message : String(err)
  return /abort|network|failed to fetch|fetch failed|load failed|timeout|连接|断开|中断/i.test(message)
}

function clearFalRecoveryTimer(taskId: string) {
  const timer = falRecoveryTimers.get(taskId)
  if (timer) clearTimeout(timer)
  falRecoveryTimers.delete(taskId)
}

function scheduleFalRecovery(taskId: string, delayMs = FAL_RECOVERY_POLL_MS) {
  if (falRecoveryTimers.has(taskId)) return
  const timer = setTimeout(() => {
    falRecoveryTimers.delete(taskId)
    recoverFalTask(taskId)
  }, delayMs)
  falRecoveryTimers.set(taskId, timer)
}

async function completeRecoveredFalTask(task: TaskRecord, result: Awaited<ReturnType<typeof getFalQueuedImageResult>>) {
  const latest = useStore.getState().tasks.find((item) => item.id === task.id)
  if (!latest || latest.status === 'done') return

  const outputIds: string[] = []
  for (const dataUrl of result.images) {
    const imgId = await storeImage(dataUrl, 'generated')
    imageCache.set(imgId, dataUrl)
    outputIds.push(imgId)
  }

  updateTaskInStore(task.id, {
    outputImages: outputIds,
    actualParams: undefined,
    actualParamsByImage: undefined,
    revisedPromptByImage: undefined,
    status: 'done',
    error: null,
    falRecoverable: false,
    finishedAt: Date.now(),
    elapsed: Date.now() - task.createdAt,
  })
  useStore.getState().showToast(tr('falTaskRecovered', { count: outputIds.length }), 'success')
}

async function recoverFalTask(taskId: string) {
  const { settings, tasks } = useStore.getState()
  const task = tasks.find((item) => item.id === taskId)
  if (!task || task.apiProvider !== 'fal' || !task.falRequestId || !task.falEndpoint || task.status === 'done') return

  const profile = getFalRecoveryProfile(settings, task)
  if (!profile) {
    scheduleFalRecovery(taskId)
    return
  }

  try {
    const status = await getFalQueueStatus(profile, task.falEndpoint, task.falRequestId)
    if (status.status === 'COMPLETED') {
      clearFalRecoveryTimer(taskId)
      const result = await getFalQueuedImageResult(profile, task.falEndpoint, task.falRequestId, task.params)
      await completeRecoveredFalTask(task, result)
      return
    }

    if (task.status !== 'running') {
      updateTaskInStore(taskId, {
        status: 'running',
        error: null,
        falRecoverable: true,
        finishedAt: null,
        elapsed: null,
      })
    }
    scheduleFalRecovery(taskId)
  } catch (err) {
    if (isFalConnectionRecoverableError(err)) {
      scheduleFalRecovery(taskId)
      return
    }

    clearFalRecoveryTimer(taskId)
    updateTaskInStore(taskId, {
      status: 'error',
      error: getFalErrorMessage(err) ?? (err instanceof Error ? err.message : String(err)),
      falRecoverable: false,
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
    })
  }
}

/** 初始化：从 IndexedDB 加载任务和图片缓存，清理孤立图片 */
export async function initStore() {
  const storedTasks = await getAllTasks()
  const settings = useStore.getState().settings
  const { tasks, expiredTasks } = markExpiredOpenAIRunningTasks(storedTasks, settings)
  await Promise.all(expiredTasks.map((task) => putTask(task)))
  useStore.getState().setTasks(tasks)
  const openAITasksToResubmit: string[] = []
  for (const task of tasks) {
    if (
      task.apiProvider === 'fal' &&
      task.falRequestId &&
      task.falEndpoint &&
      (task.status === 'running' || task.falRecoverable)
    ) {
      scheduleFalRecovery(task.id, 0)
    } else if (isRunningOpenAITask(task)) {
      openAITasksToResubmit.push(task.id)
    }
  }

  // 收集所有任务引用的图片 id
  const referencedIds = new Set<string>()
  const persistedInputImages = useStore.getState().inputImages
  for (const img of persistedInputImages) referencedIds.add(img.id)
  for (const t of tasks) {
    for (const id of t.inputImageIds || []) referencedIds.add(id)
    if (t.maskImageId) referencedIds.add(t.maskImageId)
    for (const id of t.outputImages || []) {
      referencedIds.add(id)
    }
  }

  // 预加载所有图片到缓存，同时清理孤立图片
  const images = await getAllImages()
  const imageById = new Map(images.map((img) => [img.id, img]))
  for (const img of images) {
    if (referencedIds.has(img.id)) {
      imageCache.set(img.id, img.dataUrl)
    } else {
      await deleteImage(img.id)
    }
  }
  const restoredInputImages = persistedInputImages
    .map((img) => ({ ...img, dataUrl: img.dataUrl || imageById.get(img.id)?.dataUrl || '' }))
    .filter((img) => img.dataUrl)
  if (restoredInputImages.length !== persistedInputImages.length || restoredInputImages.some((img, index) => img.dataUrl !== persistedInputImages[index]?.dataUrl)) {
    useStore.getState().setInputImages(restoredInputImages)
  }

  for (const taskId of openAITasksToResubmit) {
    executeTask(taskId)
  }
  if (openAITasksToResubmit.length > 0) {
    useStore.getState().showToast(
      tr('openAITasksResubmittedAfterReload', { count: openAITasksToResubmit.length }),
      'info',
    )
  }
}

/** 提交新任务 */
export async function submitTask(options: { allowFullMask?: boolean } = {}) {
  const { settings, prompt, inputImages, maskDraft, params, showToast, setConfirmDialog } =
    useStore.getState()

  const activeProfile = getActiveApiProfile(settings)
  const validationError = validateApiProfile(activeProfile, settings.language)
  if (validationError) {
    showToast(tr('completeCurrentProvider', { reason: validationError }), 'error')
    useStore.getState().setShowSettings(true)
    return
  }

  if (!prompt.trim()) {
    showToast(tr('enterPrompt'), 'error')
    return
  }

  let orderedInputImages = inputImages
  let maskImageId: string | null = null
  let maskTargetImageId: string | null = null

  if (maskDraft) {
    try {
      orderedInputImages = orderInputImagesForMask(inputImages, maskDraft.targetImageId)
      const coverage = await validateMaskMatchesImage(maskDraft.maskDataUrl, orderedInputImages[0].dataUrl)
      if (coverage === 'full' && !options.allowFullMask) {
        setConfirmDialog({
          title: tr('confirmFullImageEditTitle'),
          message: tr('confirmFullImageEditMessage'),
          confirmText: tr('continueSubmit'),
          tone: 'warning',
          action: () => {
            void submitTask({ allowFullMask: true })
          },
        })
        return
      }
      maskImageId = await storeImage(maskDraft.maskDataUrl, 'mask')
      imageCache.set(maskImageId, maskDraft.maskDataUrl)
      maskTargetImageId = maskDraft.targetImageId
    } catch (err) {
      if (!inputImages.some((img) => img.id === maskDraft.targetImageId)) {
        useStore.getState().clearMaskDraft()
      }
      showToast(err instanceof Error ? err.message : String(err), 'error')
      return
    }
  }

  // 持久化输入图片到 IndexedDB（此前只在内存缓存中）
  for (const img of orderedInputImages) {
    await storeImage(img.dataUrl)
  }

  const normalizedParams = normalizeParamsForSettings(params, settings)
  const normalizedParamPatch = getChangedParams(params, normalizedParams)
  if (Object.keys(normalizedParamPatch).length) {
    useStore.getState().setParams(normalizedParamPatch)
  }

  const taskId = genId()
  const task: TaskRecord = {
    id: taskId,
    prompt: prompt.trim(),
    params: normalizedParams,
    apiProvider: activeProfile.provider,
    apiProfileName: activeProfile.name,
    apiModel: activeProfile.model,
    inputImageIds: orderedInputImages.map((i) => i.id),
    maskTargetImageId,
    maskImageId,
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    elapsed: null,
  }

  const latestTasks = useStore.getState().tasks
  useStore.getState().setTasks([task, ...latestTasks])
  await putTask(task)

  if (settings.clearInputAfterSubmit) {
    useStore.getState().setPrompt('')
    useStore.getState().clearInputImages()
  }

  // 异步调用 API
  executeTask(taskId)
}

async function executeTask(taskId: string) {
  if (executingTaskIds.has(taskId)) return
  executingTaskIds.add(taskId)

  const { settings } = useStore.getState()
  const task = useStore.getState().tasks.find((t) => t.id === taskId)
  if (!task || task.status !== 'running') {
    executingTaskIds.delete(taskId)
    return
  }
  const taskProfile = getTaskApiProfile(settings, task)
  const taskSettings = taskProfile ? activateProfileForTask(settings, taskProfile) : settings
  const activeProfile = taskProfile ?? getActiveApiProfile(settings)
  const taskProvider = task.apiProvider ?? activeProfile.provider
  const openAIAbortController = taskProvider === 'openai' ? new AbortController() : null
  let falRequestInfo: { requestId: string; endpoint: string } | null = task.falRequestId && task.falEndpoint
    ? { requestId: task.falRequestId, endpoint: task.falEndpoint }
    : null

  try {
    // 获取输入图片 data URLs
    const inputDataUrls: string[] = []
    for (const imgId of task.inputImageIds) {
      const dataUrl = await ensureImageCached(imgId)
      if (!dataUrl) throw new Error(tr('inputImageMissing'))
      inputDataUrls.push(dataUrl)
    }
    let maskDataUrl: string | undefined
    if (task.maskImageId) {
      maskDataUrl = await ensureImageCached(task.maskImageId)
      if (!maskDataUrl) throw new Error(tr('maskImageMissing'))
    }

    if (taskProvider === 'openai') {
      updateTaskInStore(taskId, { attemptStartedAt: Date.now() })
      scheduleOpenAIWatchdog(taskId, activeProfile.timeout, () => {
        openAIAbortController?.abort(new Error(createOpenAITimeoutError(activeProfile.timeout)))
      })
    }

    const result = await callImageApi({
      settings: taskSettings,
      prompt: task.prompt,
      params: task.params,
      inputImageDataUrls: inputDataUrls,
      maskDataUrl,
      signal: openAIAbortController?.signal,
      onFalRequestEnqueued: (request) => {
        falRequestInfo = request
        updateTaskInStore(taskId, {
          falRequestId: request.requestId,
          falEndpoint: request.endpoint,
          falRecoverable: false,
        })
      },
    })
    clearOpenAIWatchdogTimer(taskId)

    const latestBeforeSuccess = useStore.getState().tasks.find((t) => t.id === taskId)
    if (!latestBeforeSuccess || latestBeforeSuccess.status !== 'running') return

    // 存储输出图片
    const outputIds: string[] = []
    for (const dataUrl of result.images) {
      const imgId = await storeImage(dataUrl, 'generated')
      imageCache.set(imgId, dataUrl)
      outputIds.push(imgId)
    }
    const shouldStoreApiResponseMetadata = taskProvider !== 'fal'
    const actualParamsByImage = shouldStoreApiResponseMetadata ? result.actualParamsList?.reduce<Record<string, Partial<TaskParams>>>((acc, params, index) => {
      const imgId = outputIds[index]
      if (imgId && params && Object.keys(params).length > 0) acc[imgId] = params
      return acc
    }, {}) : undefined
    const revisedPromptByImage = shouldStoreApiResponseMetadata ? result.revisedPrompts?.reduce<Record<string, string>>((acc, revisedPrompt, index) => {
      const imgId = outputIds[index]
      if (imgId && revisedPrompt && revisedPrompt.trim()) acc[imgId] = revisedPrompt
      return acc
    }, {}) : undefined
    const promptWasRevised = shouldStoreApiResponseMetadata && result.revisedPrompts?.some(
      (revisedPrompt) => revisedPrompt?.trim() && revisedPrompt.trim() !== task.prompt.trim(),
    )
    const hasRevisedPromptValue = shouldStoreApiResponseMetadata && result.revisedPrompts?.some((revisedPrompt) => revisedPrompt?.trim())
    if (taskProvider === 'openai' && !activeProfile.codexCli) {
      if (promptWasRevised) {
        showCodexCliPrompt()
      } else if (!hasRevisedPromptValue) {
        showCodexCliPrompt(false, tr('missingOfficialApiInfoReason'))
      }
    }

    // 更新任务
    const latestBeforeUpdate = useStore.getState().tasks.find((t) => t.id === taskId)
    if (!latestBeforeUpdate || latestBeforeUpdate.status !== 'running') return
    clearOpenAIWatchdogTimer(taskId)
    updateTaskInStore(taskId, {
      outputImages: outputIds,
      actualParams: shouldStoreApiResponseMetadata ? { ...result.actualParams, n: outputIds.length } : undefined,
      actualParamsByImage: actualParamsByImage && Object.keys(actualParamsByImage).length > 0 ? actualParamsByImage : undefined,
      revisedPromptByImage: revisedPromptByImage && Object.keys(revisedPromptByImage).length > 0 ? revisedPromptByImage : undefined,
      status: 'done',
      finishedAt: Date.now(),
      elapsed: Date.now() - task.createdAt,
      falRecoverable: false,
    })

    useStore.getState().showToast(tr('generationComplete', { count: outputIds.length }), 'success')
    const currentMask = useStore.getState().maskDraft
    if (
      maskDataUrl &&
      currentMask &&
      currentMask.targetImageId === task.maskTargetImageId &&
      currentMask.maskDataUrl === maskDataUrl
    ) {
      useStore.getState().clearMaskDraft()
    }
  } catch (err) {
    clearOpenAIWatchdogTimer(taskId)
    const latestTask = useStore.getState().tasks.find((t) => t.id === taskId) ?? task
    if (latestTask.status !== 'running') return
    const latestFalRequestInfo = falRequestInfo ?? (latestTask.falRequestId && latestTask.falEndpoint
      ? { requestId: latestTask.falRequestId, endpoint: latestTask.falEndpoint }
      : null)
    if (latestTask.apiProvider === 'fal' && latestFalRequestInfo && isFalConnectionRecoverableError(err)) {
      updateTaskInStore(taskId, {
        status: 'error',
        error: tr('falConnectionRecovering'),
        falRequestId: latestFalRequestInfo.requestId,
        falEndpoint: latestFalRequestInfo.endpoint,
        falRecoverable: true,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      scheduleFalRecovery(taskId)
    } else {
      const rawError = err instanceof Error ? err.message : String(err)
      const error = taskProvider === 'openai' && isFalConnectionRecoverableError(err)
        ? tr('openAIConnectionLost', { message: rawError })
        : rawError
      updateTaskInStore(taskId, {
        status: 'error',
        error,
        falRecoverable: false,
        finishedAt: Date.now(),
        elapsed: Date.now() - task.createdAt,
      })
      useStore.getState().setDetailTaskId(taskId)
    }
  } finally {
    executingTaskIds.delete(taskId)
    // 释放输入图片的内存缓存（已持久化到 IndexedDB，后续按需从 DB 加载）
    for (const imgId of task.inputImageIds) {
      imageCache.delete(imgId)
    }
  }
}

export function updateTaskInStore(taskId: string, patch: Partial<TaskRecord>) {
  const { tasks, setTasks } = useStore.getState()
  const updated = tasks.map((t) =>
    t.id === taskId ? { ...t, ...patch } : t,
  )
  setTasks(updated)
  const task = updated.find((t) => t.id === taskId)
  if (task) putTask(task)
}

/** 重试失败的任务：创建新任务并执行 */
export async function retryTask(task: TaskRecord) {
  const { settings } = useStore.getState()
  const activeProfile = getActiveApiProfile(settings)
  const normalizedParams = normalizeParamsForSettings(task.params, settings)
  const taskId = genId()
  const newTask: TaskRecord = {
    id: taskId,
    prompt: task.prompt,
    params: normalizedParams,
    apiProvider: activeProfile.provider,
    apiProfileName: activeProfile.name,
    apiModel: activeProfile.model,
    inputImageIds: [...task.inputImageIds],
    maskTargetImageId: task.maskTargetImageId ?? null,
    maskImageId: task.maskImageId ?? null,
    outputImages: [],
    status: 'running',
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    elapsed: null,
  }

  const latestTasks = useStore.getState().tasks
  useStore.getState().setTasks([newTask, ...latestTasks])
  await putTask(newTask)

  executeTask(taskId)
}

/** 复用配置 */
export async function reuseConfig(task: TaskRecord) {
  const { settings, setPrompt, setParams, setInputImages, setMaskDraft, clearMaskDraft, showToast } = useStore.getState()
  setPrompt(task.prompt)
  setParams(normalizeParamsForSettings(task.params, settings))

  // 恢复输入图片
  const imgs: InputImage[] = []
  for (const imgId of task.inputImageIds) {
    const dataUrl = await ensureImageCached(imgId)
    if (dataUrl) {
      imgs.push({ id: imgId, dataUrl })
    }
  }
  setInputImages(imgs)
  const maskTargetImageId = task.maskTargetImageId ?? (task.maskImageId ? task.inputImageIds[0] : null)
  if (maskTargetImageId && task.maskImageId && imgs.some((img) => img.id === maskTargetImageId)) {
    const maskDataUrl = await ensureImageCached(task.maskImageId)
    if (maskDataUrl) {
      setMaskDraft({
        targetImageId: maskTargetImageId,
        maskDataUrl,
        updatedAt: Date.now(),
      })
    } else {
      clearMaskDraft()
    }
  } else {
    clearMaskDraft()
  }
  showToast(tr('reusedConfigToast'), 'success')
}

/** 编辑输出：将输出图加入输入 */
export async function editOutputs(task: TaskRecord) {
  const { inputImages, addInputImage, showToast } = useStore.getState()
  if (!task.outputImages?.length) return

  let added = 0
  for (const imgId of task.outputImages) {
    if (inputImages.find((i) => i.id === imgId)) continue
    const dataUrl = await ensureImageCached(imgId)
    if (dataUrl) {
      addInputImage({ id: imgId, dataUrl })
      added++
    }
  }
  showToast(tr('addedOutputsToast', { count: added }), 'success')
}

/** 删除多条任务 */
export async function removeMultipleTasks(taskIds: string[]) {
  const { tasks, setTasks, inputImages, showToast, clearSelection, selectedTaskIds } = useStore.getState()
  
  if (!taskIds.length) return

  const toDelete = new Set(taskIds)
  const remaining = tasks.filter(t => !toDelete.has(t.id))

  // 收集所有被删除任务的关联图片
  const deletedImageIds = new Set<string>()
  for (const t of tasks) {
    if (toDelete.has(t.id)) {
      for (const id of t.inputImageIds || []) deletedImageIds.add(id)
      if (t.maskImageId) deletedImageIds.add(t.maskImageId)
      for (const id of t.outputImages || []) deletedImageIds.add(id)
    }
  }

  setTasks(remaining)
  for (const id of taskIds) {
    await dbDeleteTask(id)
  }

  // 找出其他任务仍引用的图片
  const stillUsed = new Set<string>()
  for (const t of remaining) {
    for (const id of t.inputImageIds || []) stillUsed.add(id)
    if (t.maskImageId) stillUsed.add(t.maskImageId)
    for (const id of t.outputImages || []) stillUsed.add(id)
  }
  for (const img of inputImages) stillUsed.add(img.id)

  // 删除孤立图片
  for (const imgId of deletedImageIds) {
    if (!stillUsed.has(imgId)) {
      await deleteImage(imgId)
      imageCache.delete(imgId)
    }
  }

  // 如果删除的任务在选中列表中，则移除
  const newSelection = selectedTaskIds.filter(id => !toDelete.has(id))
  if (newSelection.length !== selectedTaskIds.length) {
    useStore.getState().setSelectedTaskIds(newSelection)
  }

  showToast(tr('deletedRecordsToast', { count: taskIds.length }), 'success')
}

/** 删除单条任务 */
export async function removeTask(task: TaskRecord) {
  const { tasks, setTasks, inputImages, showToast } = useStore.getState()

  // 收集此任务关联的图片
  const taskImageIds = new Set([
    ...(task.inputImageIds || []),
    ...(task.maskImageId ? [task.maskImageId] : []),
    ...(task.outputImages || []),
  ])

  // 从列表移除
  const remaining = tasks.filter((t) => t.id !== task.id)
  setTasks(remaining)
  await dbDeleteTask(task.id)

  // 找出其他任务仍引用的图片
  const stillUsed = new Set<string>()
  for (const t of remaining) {
    for (const id of t.inputImageIds || []) stillUsed.add(id)
    if (t.maskImageId) stillUsed.add(t.maskImageId)
    for (const id of t.outputImages || []) stillUsed.add(id)
  }
  for (const img of inputImages) stillUsed.add(img.id)

  // 删除孤立图片
  for (const imgId of taskImageIds) {
    if (!stillUsed.has(imgId)) {
      await deleteImage(imgId)
      imageCache.delete(imgId)
    }
  }

  showToast(tr('recordDeletedToast'), 'success')
}

/** 清空所有数据（含配置重置） */
export async function clearAllData() {
  await dbClearTasks()
  await clearImages()
  imageCache.clear()
  const { setTasks, clearInputImages, clearMaskDraft, setSettings, setParams, showToast } = useStore.getState()
  setTasks([])
  clearInputImages()
  useStore.setState({ dismissedCodexCliPrompts: [] })
  clearMaskDraft()
  setSettings({ ...DEFAULT_SETTINGS })
  setParams({ ...DEFAULT_PARAMS })
  showToast(tr('allDataClearedToast'), 'success')
}

/** 从 dataUrl 解析出 MIME 扩展名和二进制数据 */
function dataUrlToBytes(dataUrl: string): { ext: string; bytes: Uint8Array } {
  const match = dataUrl.match(/^data:image\/(\w+);base64,/)
  const ext = match?.[1] ?? 'png'
  const b64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { ext, bytes }
}

/** 将二进制数据还原为 dataUrl */
function bytesToDataUrl(bytes: Uint8Array, filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? 'png'
  const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
  const mime = mimeMap[ext] ?? 'image/png'
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return `data:${mime};base64,${btoa(binary)}`
}

/** 导出数据为 ZIP */
export async function exportData() {
  try {
    const tasks = await getAllTasks()
    const images = await getAllImages()
    const { settings } = useStore.getState()
    const exportedAt = Date.now()
    const imageCreatedAtFallback = new Map<string, number>()

    for (const task of tasks) {
      for (const id of [
        ...(task.inputImageIds || []),
        ...(task.maskImageId ? [task.maskImageId] : []),
        ...(task.outputImages || []),
      ]) {
        const prev = imageCreatedAtFallback.get(id)
        if (prev == null || task.createdAt < prev) {
          imageCreatedAtFallback.set(id, task.createdAt)
        }
      }
    }

    const imageFiles: ExportData['imageFiles'] = {}
    const zipFiles: Record<string, Uint8Array | [Uint8Array, { mtime: Date }]> = {}

    for (const img of images) {
      const { ext, bytes } = dataUrlToBytes(img.dataUrl)
      const path = `images/${img.id}.${ext}`
      const createdAt = img.createdAt ?? imageCreatedAtFallback.get(img.id) ?? exportedAt
      imageFiles[img.id] = { path, createdAt, source: img.source }
      zipFiles[path] = [bytes, { mtime: new Date(createdAt) }]
    }

    const manifest: ExportData = {
      version: 2,
      exportedAt: new Date(exportedAt).toISOString(),
      settings,
      tasks,
      imageFiles,
    }

    zipFiles['manifest.json'] = [strToU8(JSON.stringify(manifest, null, 2)), { mtime: new Date(exportedAt) }]

    const zipped = zipSync(zipFiles, { level: 6 })
    const blob = new Blob([zipped.buffer as ArrayBuffer], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `gpt-image-playground-${Date.now()}.zip`
    a.click()
    URL.revokeObjectURL(url)
    useStore.getState().showToast(tr('dataExportedToast'), 'success')
  } catch (e) {
    useStore
      .getState()
      .showToast(
        tr('exportFailed', { message: e instanceof Error ? e.message : String(e) }),
        'error',
      )
  }
}

/** 导入 ZIP 数据 */
export async function importData(file: File): Promise<boolean> {
  try {
    const buffer = await file.arrayBuffer()
    const unzipped = unzipSync(new Uint8Array(buffer))

    const manifestBytes = unzipped['manifest.json']
    if (!manifestBytes) throw new Error(tr('zipMissingManifest'))

    const data: ExportData = JSON.parse(strFromU8(manifestBytes))
    if (!data.tasks || !data.imageFiles) throw new Error(tr('invalidDataFormat'))

    // 还原图片
    for (const [id, info] of Object.entries(data.imageFiles)) {
      const bytes = unzipped[info.path]
      if (!bytes) continue
      const dataUrl = bytesToDataUrl(bytes, info.path)
      await putImage({ id, dataUrl, createdAt: info.createdAt, source: info.source })
      imageCache.set(id, dataUrl)
    }

    for (const task of data.tasks) {
      await putTask(task)
    }

    if (data.settings) {
      const state = useStore.getState()
      state.setSettings(mergeImportedSettings(state.settings, data.settings))
    }

    const tasks = await getAllTasks()
    useStore.getState().setTasks(tasks)
    useStore
      .getState()
      .showToast(tr('importedRecordsToast', { count: data.tasks.length }), 'success')
    return true
  } catch (e) {
    useStore
      .getState()
      .showToast(
        tr('importFailed', { message: e instanceof Error ? e.message : String(e) }),
        'error',
      )
    return false
  }
}

/** 添加图片到输入（文件上传） */
export async function addImageFromFile(file: File): Promise<void> {
  if (!file.type.startsWith('image/')) return
  const dataUrl = await fileToDataUrl(file)
  const id = await storeImage(dataUrl, 'upload')
  imageCache.set(id, dataUrl)
  useStore.getState().addInputImage({ id, dataUrl })
}

/** 添加图片到输入（右键菜单）—— 支持 data/blob/http URL */
export async function addImageFromUrl(src: string): Promise<void> {
  const res = await fetch(src)
  const blob = await res.blob()
  if (!blob.type.startsWith('image/')) throw new Error(tr('invalidImage'))
  const dataUrl = await blobToDataUrl(blob)
  const id = await storeImage(dataUrl, 'upload')
  imageCache.set(id, dataUrl)
  useStore.getState().addInputImage({ id, dataUrl })
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
