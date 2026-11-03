import { useState } from 'react'
import { useT } from '../../hooks/useI18n'
import { cancelImageDownloads, downloadImageIds, useImageDownloads } from '../../lib/imageBatchDownloads'
import { workspaceControlClass } from './WorkspaceLibraryToolbar'

export default function ImageDownloadPanel() {
  const t = useT()
  const state = useImageDownloads()
  const [collapsed, setCollapsed] = useState(false)
  if (!state.entries.length && !state.notice) return null
  const failed = state.entries.filter(e => e.state === 'failed')
  return <section aria-label={t('workspaceImageDownloads')} className="fixed bottom-4 left-4 z-[75] max-h-[40vh] w-[min(420px,calc(100vw-32px))] overflow-auto rounded-2xl border border-gray-200 bg-white p-4 shadow-xl dark:border-white/10 dark:bg-gray-900">
    <div className="flex items-center justify-between gap-2"><h3 className="text-sm font-semibold">{t('workspaceImageDownloads')}</h3><button type="button" className="text-xs" onClick={() => setCollapsed(!collapsed)}>{t(collapsed ? '展开' : '收起')}</button></div>
    {!collapsed && <>
      <p role="status" className="my-2 text-xs">{t('workspaceDownloadProgress', { done: state.entries.filter(e => ['saved', 'failed'].includes(e.state)).length, total: state.entries.length, failed: failed.length })}</p>
      <p className="mb-2 text-xs text-gray-500">{t('downloadBadgeHint')}</p>
      {state.notice && <p role="alert" className="mb-2 text-xs text-amber-600">{state.notice}</p>}
      {failed.map((entry, index) => <p key={entry.id} className="text-xs text-amber-600">{index + 1}. {entry.error ?? t('downloadFailed')}</p>)}
      <div className="mt-3 flex flex-wrap gap-2">{state.busy ? <button className={workspaceControlClass} onClick={cancelImageDownloads}>{t('取消下载')}</button> : <><button className={workspaceControlClass} disabled={!failed.length} onClick={() => void downloadImageIds(failed.map(e => e.id), state.mode, state.taskIds)}>{t('重试失败项')}</button><button className={workspaceControlClass} onClick={() => useImageDownloads.setState({ entries: [], notice: '', taskIds: [] })}>{t('close')}</button></>}</div>
    </>}
  </section>
}
