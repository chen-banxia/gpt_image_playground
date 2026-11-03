import { useVideoMessage } from '../../hooks/useVideoMessage'
import { useT } from '../../hooks/useI18n'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_VIDEO_GATEWAY, useVideoSettings } from './settings'
import { normalizeGateway } from './api'
import { configuredVideoRoute, VIDEO_PROVIDERS } from './providers'
import type { KeySlot } from './types'
import { cleanVideoAssets, message, resetVideo } from './store'
import { useVideoDownloads } from './downloads'
import { exportVideoBackup, importVideoBackup } from './backup'
import { useStore } from '../../store'
import { MAX_VIDEO_SUBMIT_TIMEOUT, normalizeVideoSubmitTimeout } from './timeouts'

export const fieldClass = 'w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500'
export const buttonClass = 'rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-100 disabled:opacity-40 dark:border-white/10 dark:hover:bg-white/10'
export default function VideoSettings() {
  const t = useT()
  const localize = useVideoMessage()
  const settings = useVideoSettings(s => s.settings)
  const save = useVideoSettings(s => s.save)
  const [draft, setDraft] = useState(() => ({ ...settings, routes: { doubaoVideo: configuredVideoRoute(settings, 'doubaoVideo'), hailuoVideo: configuredVideoRoute(settings, 'hailuoVideo') } }))
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error'; save?: boolean } | null>(null)
  useEffect(() => {
    // 成功反馈自动收起；错误持续显示，给用户足够时间阅读并修正配置。
    if (!feedback || feedback.type === 'error') return
    const timer = window.setTimeout(() => setFeedback(null), 5000)
    return () => window.clearTimeout(timer)
  }, [feedback])
  const [timeoutInput, setTimeoutInput] = useState(String(normalizeVideoSubmitTimeout(settings.submitTimeoutSeconds)))
  const [busy, setBusy] = useState(false)
  const downloading = useVideoDownloads(s => s.busy)
  const run = async (fn: () => Promise<string>) => { setBusy(true); try { setFeedback({ message: await fn(), type: 'success' }) } catch (e) { setFeedback({ message: message(e), type: 'error' }) } finally { setBusy(false) } }
  const commit = () => {
    try {
      const timeout = Number(timeoutInput)
      if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_VIDEO_SUBMIT_TIMEOUT) throw new Error(t('提交超时请输入 1–600 秒的整数'))
      const next = { ...draft, submitTimeoutSeconds: timeout, gatewayBaseUrl: normalizeGateway(draft.gatewayBaseUrl.trim() || DEFAULT_VIDEO_GATEWAY) }
      next.routes = { doubaoVideo: configuredVideoRoute(next, 'doubaoVideo'), hailuoVideo: configuredVideoRoute(next, 'hailuoVideo') }
      for (const slot of ['doubaoVideo', 'hailuoVideo'] as KeySlot[]) next[slot] = { ...draft[slot], apiKey: draft[slot].apiKey.trim(), revision: draft[slot].apiKey.trim() !== settings[slot].apiKey ? crypto.randomUUID() : settings[slot].revision }
      save(next); setDraft(next); setFeedback({ message: t("视频配置已保存。模型会自动选择对应 Key，不会借用生图 Key。"), type: 'success', save: true })
    } catch (e) { setFeedback({ message: message(e), type: 'error', save: true }) }
  }
  return <section className="space-y-4 border-t pt-5 dark:border-white/10" aria-label={t("视频接口设置")}>
    <h4 className="font-semibold">{t("视频接口 · New API")}</h4>
    <p className="text-xs text-gray-500">{t('视频按模型选择对应的 Key、创建路径、查询路径和协议。生图配置独立保留。')}</p>
    <label className="block text-sm">{t("New API 网关根地址")}<input className={`${fieldClass} mt-1`} placeholder={DEFAULT_VIDEO_GATEWAY} value={draft.gatewayBaseUrl} onChange={e => setDraft({ ...draft, gatewayBaseUrl: e.target.value })} /></label>
    <p className="text-xs text-gray-500">{t("不包含 /v1 或任务路径；使用 HTTPS 页面时网关也应为 HTTPS。")}</p>
    <label className="block text-sm">{t('视频提交超时（秒）')}<input type="number" min={1} max={MAX_VIDEO_SUBMIT_TIMEOUT} step={1} className={`${fieldClass} mt-1`} value={timeoutInput} onChange={e => setTimeoutInput(e.target.value)} /></label>
    <p className="text-xs leading-relaxed text-gray-500">{t('默认 600 秒（10 分钟），用于上传素材并等待任务 ID，不是视频生成总时长。查询超时为 60 秒，失败后继续同步；修改仅影响之后发起的请求。')}</p>
    {(['doubaoVideo', 'hailuoVideo'] as KeySlot[]).map(slot => <div key={slot} className="space-y-2">
      <label className="block text-sm">{slot === 'doubaoVideo' ? t("豆包视频 API Key") : t("海螺视频 API Key")}
        <div className="mt-1 flex gap-2"><input aria-label={slot === 'doubaoVideo' ? t("豆包视频 API Key") : t("海螺视频 API Key")} autoComplete="off" className={fieldClass} type={visible[slot] ? 'text' : 'password'} value={draft[slot].apiKey} onChange={e => setDraft({ ...draft, [slot]: { ...draft[slot], apiKey: e.target.value } })} /><button type="button" className={buttonClass} aria-label={t("显示{0} Key", { "0": slot === 'doubaoVideo' ? t("豆包") : t("海螺") })} onClick={() => setVisible({ ...visible, [slot]: !visible[slot] })}>{visible[slot] ? t("隐藏") : t("显示")}</button></div>
      </label>
      <label className="flex gap-2 text-xs"><input type="checkbox" checked={draft[slot].remember} onChange={e => setDraft({ ...draft, [slot]: { ...draft[slot], remember: e.target.checked } })} />{t("在当前浏览器记住此 Key")}</label>
      <div className="space-y-2 rounded-xl border border-gray-200 p-3 dark:border-white/10">
        <p className="text-xs font-medium">{slot === 'doubaoVideo' ? 'Doubao' : 'MiniMax-H3'} · {t('接口路由配置')}</p>
        <p className="text-xs text-gray-500">{t('响应协议')}：{slot === 'doubaoVideo' ? 'Doubao · id / content.video_url' : 'H3 · task_id / task.content.url'}</p>
        <label className="block text-xs">{t('创建任务路径')}<input aria-label={`${slot === 'doubaoVideo' ? 'Doubao' : 'H3'} ${t('创建任务路径')}`} className={`${fieldClass} mt-1 font-mono !text-xs`} value={draft.routes[slot].createPath} onChange={e => setDraft({ ...draft, routes: { ...draft.routes, [slot]: { ...draft.routes[slot], createPath: e.target.value } } })} /></label>
        <label className="block text-xs">{t('查询任务路径')}<input aria-label={`${slot === 'doubaoVideo' ? 'Doubao' : 'H3'} ${t('查询任务路径')}`} className={`${fieldClass} mt-1 font-mono !text-xs`} value={draft.routes[slot].queryPath} onChange={e => setDraft({ ...draft, routes: { ...draft.routes, [slot]: { ...draft.routes[slot], queryPath: e.target.value } } })} /></label>
        <button type="button" className="text-xs text-blue-500" onClick={() => setDraft({ ...draft, routes: { ...draft.routes, [slot]: { ...VIDEO_PROVIDERS[slot] } } })}>{t('恢复服务默认路径')}</button>
        {slot === 'hailuoVideo' && <p className="text-xs leading-relaxed text-amber-600">{t('H3 官方插件使用 /hailuo/v2；/hailuo/v1 是旧系列接口。只有部署已做 H3 兼容映射时才填写 V1 路径，路径修改不会自动转换请求或响应协议。')}</p>}
      </div>
    </div>)}
    <label className="flex gap-2 text-xs"><input type="checkbox" checked={draft.proxy} onChange={e => setDraft({ ...draft, proxy: e.target.checked })} />{t("通过已部署的同源视频代理请求")}</label>
    <p className="text-xs leading-relaxed text-gray-500">{t('默认关闭，浏览器直接请求网关。开启后由本站 /video-api-proxy 转发，需部署 VIDEO_API_PROXY_URL，主要用于解决跨域；不代理结果文件，也不会增加模型支持。')}</p>
    {draft.proxy && <p className="text-xs text-amber-600">{t("代理目标由服务器 VIDEO_API_PROXY_URL 配置，必须与上方网关一致；未部署代理时请关闭。")}</p>}
    <p className="text-xs leading-relaxed text-gray-500">{t('新任务和快捷重试使用保存后的服务配置；已有任务继续使用创建时的路由。自定义路径使用同源代理时，也需部署端白名单放行。')}</p>
    <button type="button" className="rounded-xl bg-blue-500 px-4 py-2 text-sm text-white" onClick={commit}>{t("保存视频配置")}</button>
    <h4 className="border-t pt-4 font-semibold dark:border-white/10">{t("视频本地数据")}</h4>
    <p className="text-xs text-gray-500">{t("视频历史只存记录和结果链接；输入素材独立保存。清理不影响图片工作台或 API Key。")}</p>
    <div className="flex flex-wrap gap-2">
      <button disabled={busy || downloading} className={buttonClass} onClick={() => run(async () => { await exportVideoBackup(useStore.getState().groups); return t("视频历史备份已发起下载，不含成品文件和 Key。") })}>{t("导出视频历史")}</button>
      <button disabled={busy || downloading} className={buttonClass} onClick={() => run(async () => { await exportVideoBackup(useStore.getState().groups, true); return t("输入素材备份已发起下载，不含生成视频文件。") })}>{t("连同输入素材导出")}</button>
      <label className={`${buttonClass} cursor-pointer`}>{t("导入视频备份")}<input className="hidden" type="file" accept=".json,.zip" disabled={busy || downloading} onChange={e => { const f = e.target.files?.[0]; if (f) void run(async () => t("已导入 {0} 条记录。查询需重新授权，缺失素材需重新选择。", { "0": await importVideoBackup(f, useStore.getState().groups, window.confirm(t("是否同时恢复备份中的视频草稿？确认会替换当前草稿；取消只导入历史。"))) })); e.target.value = '' }} /></label>
      <button disabled={busy || downloading} className={buttonClass} onClick={() => run(async () => t("已清理 {0} 份无引用视频素材。", { "0": await cleanVideoAssets() }))}>{t("清理无引用素材")}</button>
      <button disabled={busy || downloading} className={buttonClass} onClick={() => { if (window.confirm(t("清空视频历史？不会取消远端生成；保留当前视频草稿、图片记录和 Key。"))) void run(async () => { await resetVideo(false); return t("视频历史已清空，草稿已保留。") }) }}>{t("清空视频历史")}</button>
      <button disabled={busy || downloading} className={`${buttonClass} text-red-500`} onClick={() => { if (window.confirm(t("重置视频工作台的全部历史、草稿及输入素材？保留图片、公共分组和 API 配置。"))) void run(async () => { await resetVideo(true); return t("视频本地数据已重置。") }) }}>{t("重置视频数据")}</button>
    </div>
    {/* 挂载到页面根部，避免保存按钮位于长面板底部时反馈被滚动区域遮住。 */}
    {feedback && createPortal(
      <div data-settings-feedback className="pointer-events-none fixed inset-x-4 top-[max(1rem,env(safe-area-inset-top))] z-[150] flex justify-center">
        <div role={feedback.type === 'error' ? 'alert' : 'status'} aria-atomic="true"
          className={`pointer-events-auto flex w-full max-w-lg items-start gap-3 rounded-2xl border p-4 shadow-2xl ${feedback.type === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-600 dark:bg-emerald-950 dark:text-emerald-100' : 'border-red-300 bg-red-50 text-red-950 dark:border-red-600 dark:bg-red-950 dark:text-red-100'}`}>
          <span aria-hidden="true" className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg font-bold text-white ${feedback.type === 'success' ? 'bg-emerald-600' : 'bg-red-600'}`}>{feedback.type === 'success' ? '✓' : '!'}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{t(feedback.save ? feedback.type === 'success' ? '保存成功' : '保存失败' : feedback.type === 'success' ? '操作成功' : '操作失败')}</p>
            <p className="mt-1 break-words text-sm leading-relaxed">{localize(feedback.message)}</p>
          </div>
          <button type="button" aria-label={t('关闭提示')} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xl hover:bg-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-current dark:hover:bg-white/10" onClick={() => setFeedback(null)}>×</button>
        </div>
      </div>, document.body,
    )}
  </section>
}
