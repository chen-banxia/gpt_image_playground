import { useState } from 'react'
import { useT } from '../../hooks/useI18n'
import { FavoriteIcon, workspaceControlClass } from './WorkspaceLibraryToolbar'

export type BatchDownloadMode = 'files' | 'zip'
interface Props {
  count: number; files: number; pageCount: number; allSelected: boolean; allFavorite: boolean; busy: boolean
  groups: { id: string; name: string }[]
  onSelectAll: () => void; onMove: (id: string | null) => void; onFavorite: () => void
  onDownload: (mode: BatchDownloadMode, onlyUndownloaded: boolean) => void
  onDelete: () => void; onExit: () => void
}
export default function WorkspaceBatchToolbar(props: Props) {
  // 两端只共享控件和文案；实际选中范围、下载队列及存储更新由各自业务层处理。
  const t = useT()
  const [downloadOpen, setDownloadOpen] = useState(false)
  const [onlyUndownloaded, setOnlyUndownloaded] = useState(false)
  return <div data-workspace-batch data-no-drag-select role="toolbar" aria-label={t('batchActions')} className="mb-4 space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
    <p className="text-xs text-gray-600 dark:text-gray-300" aria-live="polite">{t('workspaceSelectionCount', { count: props.count, files: props.files })}</p>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className={workspaceControlClass} disabled={!props.pageCount} onClick={props.onSelectAll}>{t(props.allSelected ? 'cancelSelectAll' : 'selectCurrentPage')}</button>
      <select aria-label={t('batchGroup')} value="" disabled={!props.count || props.busy} className={`${workspaceControlClass} min-w-0 max-w-full`} onChange={e => props.onMove(e.target.value === 'ungrouped' ? null : e.target.value)}>
        <option value="" disabled>{t('batchGroup')}</option><option value="ungrouped">{t('ungrouped')}</option>{props.groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
      </select>
      <button type="button" className={`${workspaceControlClass} inline-flex items-center gap-2`} disabled={!props.count || props.busy} onClick={props.onFavorite}><FavoriteIcon active={props.allFavorite} />{t(props.allFavorite ? '取消收藏' : '收藏')}</button>
      <button type="button" aria-expanded={downloadOpen} disabled={!props.files || props.busy} title={!props.files ? t('workspaceNoDownloadable') : undefined} className={`${workspaceControlClass} inline-flex items-center gap-2 text-blue-600 dark:text-blue-300`} onClick={() => setDownloadOpen(!downloadOpen)}>
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" /></svg>{t('download')}<span aria-hidden="true">{downloadOpen ? '▴' : '▾'}</span>
      </button>
      <button type="button" className={`${workspaceControlClass} !text-red-500`} disabled={!props.count || props.busy} onClick={props.onDelete}>{t('workspaceDeleteRecords')}</button>
      <button type="button" className={`${workspaceControlClass} sm:ml-auto`} onClick={props.onExit}>{t('exitBatch')}</button>
    </div>
    {downloadOpen && <div role="group" aria-label={t('workspaceDownloadOptions')} className="flex flex-wrap items-center gap-3 border-t border-gray-200 pt-3 dark:border-white/10" onKeyDown={e => { if (e.key === 'Escape') setDownloadOpen(false) }}>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyUndownloaded} disabled={props.busy} onChange={e => setOnlyUndownloaded(e.target.checked)} />{t('workspaceOnlyUndownloaded')}</label>
      <button type="button" className={workspaceControlClass} disabled={props.busy || !props.files} onClick={() => { props.onDownload('zip', onlyUndownloaded); setDownloadOpen(false) }}>{t('workspaceZipDownload')}</button>
      <button type="button" className={workspaceControlClass} disabled={props.busy || !props.files} onClick={() => { props.onDownload('files', onlyUndownloaded); setDownloadOpen(false) }}>{t('workspaceIndividualDownload')}</button>
    </div>}
  </div>
}
