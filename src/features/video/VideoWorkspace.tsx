import WorkspaceLibraryToolbar from '../../components/workspace/WorkspaceLibraryToolbar'
import WorkspaceBatchToolbar from '../../components/workspace/WorkspaceBatchToolbar'
import GalleryPagination from '../../components/GalleryPagination'
import { useVideoMessage } from '../../hooks/useVideoMessage'
import { tCurrent as t } from '../../i18n'
import { useT } from '../../hooks/useI18n'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import GroupManager from '../../components/GroupManager'
import { useCloseOnEscape } from '../../hooks/useCloseOnEscape'
import { paginateItems } from '../../lib/pagination'
import { canSync, message, reauthorizeTask, removeVideoTasks, retryVideoTask, reuseVideo, syncVideoTask, updateVideoTasks, useVideoStore } from './store'
import { isUnsupportedVideoModelError } from './api'
import { VIDEO_MODELS } from './models'
import type { VideoTask } from './types'
import VideoInputPanel, { AssetPreview, roleName } from './VideoInputPanel'
import VideoCardPreview from './VideoCardPreview'
import { buttonClass } from './VideoSettings'
import { cancelVideoDownloads, downloadVideos, useVideoDownloads } from './downloads'

export const hasVideo = (task: VideoTask) => task.status === 'succeeded' && Boolean(task.videoUrl)
export function statusLabel(task: VideoTask, translate = t) {
  if (task.submissionState === 'submit_unknown') return translate("提交结果待确认")
  if (task.submissionState === 'submitting') return translate("正在提交")
  return { unknown: translate("等待同步"), queued: translate("排队中"), running: translate("生成中"), succeeded: translate("已生成"), failed: translate("生成失败"), cancelled: translate("已取消"), expired: translate("任务已过期") }[task.status]
}
export function filterVideos(tasks: VideoTask[], filters: { group: string; status: string; model: string; download: string; favorite: boolean; query: string }, groupIds: string[]) {
  const query = filters.query.toLowerCase().trim()
  return tasks.filter(t => (filters.group === 'all' || filters.group === 'ungrouped' ? filters.group === 'all' || !t.groupId || !groupIds.includes(t.groupId) : t.groupId === filters.group)
    && (filters.status === 'all' || t.status === filters.status)
    && (filters.model === 'all' || t.modelId === filters.model)
    && (!filters.favorite || t.isFavorite)
    && (filters.download === 'all' || hasVideo(t) && (filters.download === 'downloaded' ? Boolean(t.downloadedAt) : filters.download === 'not_downloaded' && !t.downloadedAt))
    && (!query || `${t.prompt} ${t.modelId} ${JSON.stringify(t.params)}`.toLowerCase().includes(query)))
}
function initialFilters() {
  const defaults = { group: 'all', status: 'all', model: 'all', download: 'all', favorite: false, query: '' }
  try { return { ...defaults, ...JSON.parse(localStorage.getItem('gpt-video-playground-ui') ?? '{}').filters } } catch { return defaults }
}
function initialPage() {
  try { const page = JSON.parse(localStorage.getItem('gpt-video-playground-ui') ?? '{}').page; return Number.isInteger(page) && page > 0 ? page : 1 } catch { return 1 }
}
export default function VideoWorkspace() {
  const t = useT()
  const localize = useVideoMessage()
  const { tasks, assets, error, ready, draft, submitting } = useVideoStore()
  const [retryingId, setRetryingId] = useState<string | null>(null)
  const retryBusy = useRef(false)
  const groups = useStore(s => s.groups)
  const [filters, setFilters] = useState(initialFilters)
  const [page, setPage] = useState(initialPage)
  const [collapsed, setCollapsed] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [batch, setBatch] = useState(false)
  const [managing, setManaging] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const layoutRef = useRef<HTMLDivElement>(null)
  const galleryRef = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)
  const filtered = filterVideos(tasks, filters, groups.map(g => g.id))
  const pagination = paginateItems(filtered, page)
  const visibleIds = pagination.items.map(t => t.id)
  const selectedTasks = pagination.items.filter(t => selected.includes(t.id))
  const downloads = useVideoDownloads()
  const detail = tasks.find(t => t.id === detailId)
  const run = async (fn: () => Promise<unknown>, success = '') => { try { await fn(); if (success) setNotice(success) } catch (e) { setNotice(message(e)) } }
  const changeFilters = (patch: Partial<typeof filters>) => { setFilters({ ...filters, ...patch }); setPage(1); setSelected([]) }
  useEffect(() => { if (ready && page !== pagination.page) setPage(pagination.page) }, [ready, page, pagination.page])
  useEffect(() => { setSelected(s => s.filter(id => visibleIds.includes(id))) }, [visibleIds.join('|')])
  useEffect(() => { try { localStorage.setItem('gpt-video-playground-ui', JSON.stringify({ filters, page })) } catch { /* 业务记录仍保存在 IndexedDB */ } }, [filters, page])
  useLayoutEffect(() => {
    const align = () => {
      const item = galleryRef.current?.querySelector('[data-workspace-toolbar]')
      if (item && matchMedia('(min-width: 768px)').matches) layoutRef.current?.style.setProperty('--input-panel-top', `${item.getBoundingClientRect().top + window.scrollY}px`)
      else layoutRef.current?.style.removeProperty('--input-panel-top')
    }
    const observer = new ResizeObserver(align)
    if (galleryRef.current) observer.observe(galleryRef.current)
    align(); window.addEventListener('resize', align)
    return () => { observer.disconnect(); window.removeEventListener('resize', align) }
  }, [])
  useCloseOnEscape(Boolean(detail), () => setDetailId(null))
  const remove = (items: VideoTask[]) => {
    if (!items.length) return
    if (downloads.busy && items.some(t => downloads.entries.some(e => e.id === t.id))) { setNotice(t("这些记录正在下载，请先等待或取消下载队列。")); return }
    useStore.getState().setConfirmDialog({ title: t("删除视频记录"), message: t("删除 {0} 条本地视频记录？其中 {1} 条仍待完成。不会取消远端任务或删除图片。", { "0": items.length, "1": items.filter(canSync).length }), action: async () => { await removeVideoTasks(items.map(t => t.id)); setSelected([]); if (items.some(t => t.id === detailId)) setDetailId(null) } })
  }
  const reuse = (task: VideoTask) => {
    const draft = useVideoStore.getState().draft
    if ((draft.prompt || draft.frames.length || draft.references.length) && !window.confirm(t("将用此视频的描述、模型和素材替换当前对应草稿，是否继续？"))) return
    reuseVideo(task); setCollapsed(false); setDetailId(null); setNotice(t("已恢复参数与素材用途，请检查后点击生成视频。"))
  }
  const retry = async (task: VideoTask) => {
    if (retryBusy.current || useVideoStore.getState().submitting) return
    retryBusy.current = true
    setRetryingId(task.id)
    try {
      const submitted = await retryVideoTask(task.id)
      setNotice(submitted ? t('已按原参数重新提交，当前草稿未改动。') : useVideoStore.getState().error)
    } catch (error) { setNotice(message(error)) }
    finally { retryBusy.current = false; setRetryingId(null) }
  }
  const retryButton = (task: VideoTask) => task.status === 'failed' && task.submissionState !== 'submit_unknown' && <button
    type="button" disabled={submitting || retryingId !== null}
    title={t('使用原描述、模型和素材，以及当前对应 Key 创建新任务，可能产生费用；不修改当前草稿。')}
    className="inline-flex items-center gap-1 rounded-lg bg-blue-500/10 px-2 py-1.5 font-medium text-blue-600 hover:bg-blue-500/20 disabled:opacity-40 dark:text-blue-300"
    onClick={() => void retry(task)}>
    <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}><path d="M3 4v6h6M3 10a9 9 0 1 1 0 5" /></svg>
    {t(retryingId === task.id ? '正在重试…' : '重试')}
  </button>
  const configurationHint = (task: VideoTask) => isUnsupportedVideoModelError(task.error) && <div className="space-y-1 rounded-lg bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-300">
    <p>{t('网关当前插件不支持此模型。请检查模型路由与渠道配置；同源代理不能解决这个错误。')}</p>
    <button type="button" className="font-medium text-blue-500 underline" onClick={() => useStore.getState().setShowSettings(true)}>{t('检查视频配置')}</button>
  </div>
  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
  const groupPicker = (items: VideoTask[], batchPicker = false) => <select aria-label={batchPicker ? t("批量移动视频分组") : t("视频所属分组")} className="max-w-[160px] rounded-lg border bg-transparent px-2 py-1.5 text-xs dark:border-white/10 dark:bg-gray-900" disabled={!items.length} value={batchPicker ? '' : groups.some(g => g.id === items[0]?.groupId) ? items[0].groupId! : 'ungrouped'} onClick={e => e.stopPropagation()} onChange={e => void run(() => updateVideoTasks(items.map(t => t.id), { groupId: e.target.value === 'ungrouped' ? null : e.target.value }), t("已移动 {0} 条视频记录", { "0": items.length }))}>
    {batchPicker && <option value="" disabled>{t("移至分组")}</option>}<option value="ungrouped">{t("未分组")}</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
  </select>
  const mark = (task: VideoTask) => void run(() => updateVideoTasks([task.id], { downloadedAt: task.downloadedAt ? undefined : Date.now(), downloadSource: task.downloadedAt ? undefined : 'manual' }), t("已更新本地下载标记，不会下载文件。"))
  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.pointerType !== 'mouse' || (event.target as HTMLElement).closest('button,input,select,a,video,[data-video-card]')) return
    const start = { x: event.clientX, y: event.clientY }
    const initial = event.ctrlKey || event.metaKey ? selected : []
    const move = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return
      suppressClick.current = true
      const box = { x: Math.min(e.clientX, start.x), y: Math.min(e.clientY, start.y), width: Math.abs(e.clientX - start.x), height: Math.abs(e.clientY - start.y) }
      setSelectionBox(box)
      const ids: string[] = []
      galleryRef.current?.querySelectorAll<HTMLElement>('[data-video-card]').forEach(el => { const r = el.getBoundingClientRect(); if (r.left < box.x + box.width && r.right > box.x && r.top < box.y + box.height && r.bottom > box.y) ids.push(el.dataset.videoCard!) })
      setSelected([...new Set([...initial, ...ids])]); setBatch(true)
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setSelectionBox(null); setTimeout(() => { suppressClick.current = false }, 100) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up, { once: true })
  }
  return <div ref={layoutRef} className="generation-layout" data-input-collapsed={collapsed}>
    <VideoInputPanel collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
    <main className="generation-gallery min-w-0 pb-10" aria-label={t("视频作品")}>
      <div ref={galleryRef} className="safe-area-x mx-auto max-w-7xl">
        <WorkspaceLibraryToolbar
          title={t('视频作品')} storageHint={t('历史与链接保存在当前浏览器，视频文件通过服务端链接访问。')}
          groups={[
            { value: 'all', label: t('allGroups') + ' (' + tasks.length + ')' },
            { value: 'ungrouped', label: t('ungrouped') + ' (' + tasks.filter(task => !groups.some(g => g.id === task.groupId)).length + ')' },
            ...groups.map(g => ({ value: g.id, label: g.name + ' (' + tasks.filter(task => task.groupId === g.id).length + ')' })),
          ]}
          destination={groups.find(g => g.id === draft.groupId)?.name ?? t('ungrouped')}
          statuses={[{ value: 'all', label: t('allStatuses') }, { value: 'running', label: t('running') }, { value: 'succeeded', label: t('completed') }, { value: 'failed', label: t('failed') }, { value: 'queued', label: t('排队中') }, { value: 'unknown', label: t('等待同步') }]}
          models={[{ value: 'all', label: t('workspaceAllModels') }, ...VIDEO_MODELS.map(m => ({ value: m.id, label: t(m.name) }))]}
          filters={filters} batch={batch}
          onFiltersChange={patch => {
            changeFilters(patch)
            if (patch.group !== undefined) useVideoStore.getState().updateDraft({ groupId: groups.some(g => g.id === patch.group) ? patch.group! : null })
          }}
          onManageGroups={() => setManaging(true)} onToggleBatch={() => { setBatch(!batch); setSelected([]) }} />
        {(batch || selected.length > 0) && <WorkspaceBatchToolbar
          count={selectedTasks.length} files={selectedTasks.filter(hasVideo).length} pageCount={pagination.items.length}
          allSelected={selectedTasks.length > 0 && selectedTasks.length === pagination.items.length}
          allFavorite={selectedTasks.length > 0 && selectedTasks.every(task => task.isFavorite)} busy={downloads.busy} groups={groups}
          onSelectAll={() => setSelected(selectedTasks.length === pagination.items.length ? [] : visibleIds)}
          onMove={groupId => { void run(() => updateVideoTasks(selectedTasks.map(task => task.id), { groupId }), t('已移动 {0} 条视频记录', { 0: selectedTasks.length })) }}
          onFavorite={() => { void run(() => updateVideoTasks(selectedTasks.map(task => task.id), { isFavorite: !selectedTasks.every(task => task.isFavorite) })) }}
          onDownload={(mode, onlyUndownloaded) => { void downloadVideos(selectedTasks, mode, onlyUndownloaded) }}
          onDelete={() => remove(selectedTasks)} onExit={() => { setBatch(false); setSelected([]) }} />}
        {notice && <p role="status" className="mb-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">{localize(notice)}<button className="float-right" aria-label={t("关闭提示")} onClick={() => setNotice('')}>✕</button></p>}
        {!ready && <p className="py-10 text-center text-gray-500">{localize(error) || t("正在打开独立视频数据库…")}</p>}
        <GalleryPagination {...pagination} onPageChange={next => { setPage(next); setSelected([]) }} />
        {/* 同排卡片等高，信息区弹性填充，底部操作栏对齐。 */}
        <div data-video-grid className="grid min-h-[45vh] grid-cols-[repeat(auto-fill,minmax(min(100%,260px),1fr))] items-stretch content-start gap-3" onPointerDown={pointerDown}>
          {pagination.items.map(task => <article key={task.id} data-video-card={task.id} className={`flex flex-col overflow-hidden rounded-2xl border bg-white dark:bg-gray-900 ${selected.includes(task.id) ? 'border-blue-500 ring-2 ring-blue-400/40' : 'border-gray-200 dark:border-white/10'}`} onClick={e => { if (suppressClick.current) return; if ((e.target as HTMLElement).closest('button,select,input,a,video')) return; if (batch || e.ctrlKey || e.metaKey) toggle(task.id); else setDetailId(task.id) }}>
            <div className="relative flex aspect-video shrink-0 items-center justify-center bg-gradient-to-br from-slate-700 to-slate-900 text-white">
              {hasVideo(task) && <VideoCardPreview key={task.videoUrl} url={task.videoUrl!} />}
              <span className="absolute left-3 top-3 z-10 rounded-lg bg-black/50 px-2 py-1 text-xs">{statusLabel(task, t)}</span>
              {(batch || selected.includes(task.id)) && <input aria-label={t("选择视频 {0}", { "0": task.prompt })} type="checkbox" className="absolute right-3 top-3 z-20 h-5 w-5 accent-blue-500" checked={selected.includes(task.id)} onChange={() => toggle(task.id)} />}
              {hasVideo(task) ? <button aria-label={t("播放视频 {0}", { "0": task.prompt })} className="relative z-10 flex h-11 w-11 items-center justify-center rounded-full bg-black/50 text-xl shadow-sm transition-colors hover:bg-black/70" onClick={() => setDetailId(task.id)}>▶</button> : <div className="px-4 text-center text-sm text-slate-300">{task.status === 'failed' ? t("生成失败，查看详情") : t("等待视频结果")}</div>}
              <span className="absolute bottom-3 right-3 z-10 rounded bg-black/50 px-1.5 py-0.5 text-xs">{task.actualParams?.duration !== undefined ? String(task.actualParams.duration) : task.params.duration === -1 ? t("智能") : task.params.duration} {t("秒")}</span>
            </div>
            <div className="flex flex-1 flex-col items-start gap-2 p-2.5">{groupPicker([task])}<p className="line-clamp-2 w-full text-sm leading-5" title={task.prompt}>{task.prompt}</p><p className="w-full truncate text-xs text-gray-500">{t(VIDEO_MODELS.find(m => m.id === task.modelId)!.name)} · {String(task.actualParams?.resolution ?? task.params.resolution)} · {task.inputMode === 'frames' ? t("首尾帧") : t("全能参考")}</p>
              {task.error && <div className="flex w-full min-w-0 items-center gap-2 text-xs">
                <p className="min-w-0 flex-1 truncate text-amber-600" title={localize(task.error)}>{localize(task.error)}</p>
                {isUnsupportedVideoModelError(task.error) && <button type="button" className="shrink-0 text-blue-500" onClick={() => useStore.getState().setShowSettings(true)}>{t('检查视频配置')}</button>}
              </div>}
              <div data-video-card-actions className="mt-auto flex min-h-8 w-full flex-wrap items-center gap-2 text-xs"><span className={task.downloadedAt ? 'text-green-600' : 'text-gray-500'} title={t("仅记录本页发起的下载，不能识别外部另存为")}>{hasVideo(task) ? task.downloadedAt ? t("✓ 已下载") : t("↓ 未下载") : t("暂无成品")}</span><div className="flex-1" />
                <button disabled={!hasVideo(task) || downloads.busy} className="text-blue-500 disabled:opacity-30" onClick={() => void downloadVideos([task], 'files')}>{t("下载")}</button>
                <button title={task.isFavorite ? t("取消收藏") : t("收藏")} className={task.isFavorite ? 'text-yellow-500' : 'text-gray-400'} onClick={() => void run(() => updateVideoTasks([task.id], { isFavorite: !task.isFavorite }))}>{task.isFavorite ? '★' : '☆'}</button>
                {retryButton(task)}<button onClick={() => reuse(task)}>{t("复用")}</button><button onClick={() => setDetailId(task.id)}>{t("详情")}</button><button className="text-red-500" onClick={() => remove([task])}>{t("删除")}</button>
              </div>
            </div>
          </article>)}
          {ready && !pagination.items.length && <div className="col-span-full py-20 text-center text-sm text-gray-500">{tasks.length ? t("没有符合条件的视频，试试调整筛选。") : t("输入描述，按需添加素材，开始生成第一条视频。")}</div>}
        </div>
      </div>
    </main>
    {selectionBox && <div className="pointer-events-none fixed z-50 border border-blue-500 bg-blue-500/15" style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.width, height: selectionBox.height }} />}
    {managing && <GroupManager onClose={() => setManaging(false)} />}
    {detail && <div className="fixed inset-0 z-[65] flex items-center justify-center bg-black/60 p-4" onClick={() => setDetailId(null)}><div role="dialog" aria-modal="true" aria-label={t("视频详情")} className="max-h-[90dvh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 dark:bg-gray-900" onClick={e => e.stopPropagation()}>
      <div className="mb-4 flex justify-between"><h3 className="font-semibold">{t("视频详情 ·")} {statusLabel(detail, t)}</h3><button aria-label={t("关闭视频详情")} onClick={() => setDetailId(null)}>✕</button></div>
      {detail.videoUrl && <video key={detail.videoUrl} src={detail.videoUrl} controls playsInline preload="metadata" className="max-h-[50vh] w-full rounded-xl bg-black" onError={() => void run(() => updateVideoTasks([detail.id], { resultAccessError: t("链接暂不可访问或浏览器不支持此编码。请刷新链接或下载原文件。") }))} />}
      {detail.resultAccessError && <p className="my-3 text-sm text-amber-600">{localize(detail.resultAccessError)}</p>}
      <p className="my-4 whitespace-pre-wrap text-sm" data-selectable-text>{detail.prompt}</p>
      <div className="my-3 flex flex-wrap items-center gap-2">{groupPicker([detail])}<button className={buttonClass} disabled={!hasVideo(detail) || downloads.busy} onClick={() => void downloadVideos([detail], 'files')}>{t("下载视频")}</button><button className={buttonClass} onClick={() => reuse(detail)}>{t("复用参数")}</button><button className={buttonClass} disabled={!detail.gatewayTaskId} onClick={() => void syncVideoTask(detail.id, true)}>{t("刷新状态 / 链接")}</button>{detail.syncState === 'auth_required' && <button className={buttonClass} onClick={() => { if (window.confirm(t("确认使用当前设置中同一网关和对应视频 Key 查询此任务？"))) void run(() => reauthorizeTask(detail)) }}>{t("授权当前 Key 查询")}</button>}{detail.videoUrl && <a className={buttonClass} href={detail.videoUrl} target="_blank" rel="noreferrer">{t("打开原视频")}</a>}</div>
      {hasVideo(detail) && <button className="text-xs text-gray-500" onClick={() => mark(detail)}>{detail.downloadedAt ? t("重置为未下载") : t("手动标记已下载")}{t("（只更新本地标记）")}</button>}
      {detail.error && <p className="my-3 whitespace-pre-wrap text-sm text-amber-600">{localize(detail.error)}</p>}
      {configurationHint(detail)}
      {detail.status === 'failed' && <div className="my-3 space-y-2">{retryButton(detail)}<p className="text-xs text-gray-500">{t('使用原描述、模型和素材，以及当前对应 Key 创建新任务，可能产生费用；不修改当前草稿。')}</p></div>}
      <div className="my-4 grid grid-cols-3 gap-2 sm:grid-cols-5">{detail.inputs.map((i, index) => { const a = assets.find(a => a.id === i.assetId); return <div key={index} className="rounded-xl border p-2 text-[10px] dark:border-white/10">{a ? <AssetPreview asset={a} /> : <p>{t("原素材缺失")}</p>}<p className="truncate">{t(roleName[i.role])}</p></div> })}</div>
      <details><summary className="cursor-pointer text-sm">{t("任务与参数详情")}</summary><pre data-selectable-text className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-xl bg-gray-100 p-3 text-xs dark:bg-gray-800">{JSON.stringify({ taskId: detail.gatewayTaskId, model: detail.modelId, createdAt: new Date(detail.createdAt).toLocaleString(), requested: detail.params, actual: detail.actualParams }, null, 2)}</pre></details>
    </div></div>}
  </div>
}

/** 下载队列独立于工作台挂载，切回图片页也可取消或查看失败项。 */
export function VideoDownloadPanel() {
  const t = useT()
  const localize = useVideoMessage()
  const state = useVideoDownloads()
  const [collapsed, setCollapsed] = useState(false)
  if (!state.entries.length && !state.notice) return null
  return <section className="fixed bottom-4 right-4 z-[75] max-h-[45vh] w-[min(420px,calc(100vw-32px))] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-gray-900" aria-label={t("视频下载队列")}>
    <div className="flex items-center justify-between"><h3 className="text-sm font-semibold">{state.mode === 'zip' ? t("视频打包") : t("视频下载")} · {(state.bytes / 1024 / 1024).toFixed(1)}MB</h3><button className="text-xs" onClick={() => setCollapsed(!collapsed)}>{collapsed ? t("展开") : t("收起")}</button></div>
    {!collapsed && <><p className="my-2 text-xs text-gray-500">{localize(state.notice)}</p>{state.entries.map(e => <div key={e.id} className="border-t py-2 text-xs dark:border-white/10"><p className="truncate">{e.prompt}</p><p className={e.state === 'failed' ? 'text-amber-600' : 'text-gray-500'}>{({ waiting: t("等待处理"), fetching: t("获取文件中"), saved: t("已发起保存"), failed: t("未完成"), cancelled: t("已取消") })[e.state]}{e.error ? ` · ${localize(e.error)}` : ''}</p>{e.originalUrl && <div className="mt-2 space-y-1"><a className="text-blue-500 underline" href={e.originalUrl} target="_blank" rel="noopener noreferrer">{t('打开原视频另存为')}</a><p className="text-gray-500">{t('若打开后直接播放，请使用播放器下载菜单或右键另存为；外部保存不会自动标记已下载。')}</p></div>}</div>)}<div className="mt-3 flex gap-2">{state.busy ? <button className={buttonClass} onClick={cancelVideoDownloads}>{t("取消下载")}</button> : <><button className={buttonClass} disabled={!state.entries.some(e => e.state === 'failed')} onClick={() => void downloadVideos(useVideoStore.getState().tasks.filter(t => state.entries.some(e => e.id === t.id && e.state === 'failed')), state.mode)}>{t("重试失败项")}</button><button className={buttonClass} onClick={() => useVideoDownloads.setState({ entries: [], notice: '' })}>{t("关闭")}</button></>}</div></>}
  </section>
}
