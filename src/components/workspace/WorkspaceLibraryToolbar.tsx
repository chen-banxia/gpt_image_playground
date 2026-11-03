import { useState } from 'react'
import { useT } from '../../hooks/useI18n'

export const workspaceControlClass = 'min-h-11 md:min-h-10 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-white/10 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-white/[0.06]'
export interface ToolbarOption { value: string; label: string }
export interface LibraryFilters { group: string; status: string; model: string; download: string; favorite: boolean; query: string }
interface Props {
  title: string
  storageHint: string
  groups: ToolbarOption[]
  destination: string
  statuses: ToolbarOption[]
  models: ToolbarOption[]
  filters: LibraryFilters
  batch: boolean
  onFiltersChange: (patch: Partial<LibraryFilters>) => void
  onManageGroups: () => void
  onToggleBatch: () => void
}

export function FavoriteIcon({ active = false }: { active?: boolean }) {
  return <svg aria-hidden="true" className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.7}><path strokeLinejoin="round" d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" /></svg>
}

/** 只接受筛选值与动作，图片、视频的业务 store 和数据读取由各自页面负责。 */
export default function WorkspaceLibraryToolbar(props: Props) {
  const t = useT()
  const [showStorage, setShowStorage] = useState(false)
  const { filters, onFiltersChange } = props
  const select = (key: 'status' | 'model' | 'download', label: string, options: ToolbarOption[]) => <select
    data-filter={key} aria-label={label} className={`${workspaceControlClass} w-full min-w-0 truncate`} value={filters[key]}
    onChange={e => onFiltersChange({ [key]: e.target.value })}>
    {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
  </select>
  return <section data-workspace-toolbar data-no-drag-select aria-label={t('workspaceLibraryTools')} className="mb-4 mt-6 space-y-3">
    <div className="flex min-h-8 items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">{props.title}</h2>
      <button type="button" aria-expanded={showStorage} className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs text-gray-500 hover:bg-gray-100 focus-visible:outline-blue-500 dark:hover:bg-white/10" onClick={() => setShowStorage(!showStorage)}>
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v1" /></svg>{t('workspaceStorageInfo')}
      </button>
    </div>
    {showStorage && <p role="note" className="rounded-xl bg-gray-100 p-3 text-xs leading-relaxed text-gray-500 dark:bg-white/5">{props.storageHint}</p>}
    <div data-toolbar-group-row className="flex flex-wrap items-center gap-2">
      <select data-filter="group" aria-label={t('filterGroup')} className={`${workspaceControlClass} min-w-0 max-w-[min(240px,100%)] flex-1 sm:flex-none`} value={filters.group} onChange={e => onFiltersChange({ group: e.target.value })}>
        {props.groups.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <button type="button" className="min-h-11 shrink-0 rounded-xl px-3 text-sm text-blue-500 hover:bg-blue-500/10 focus-visible:outline-blue-500 md:min-h-10" onClick={props.onManageGroups}>{t('manageGroups')}</button>
      <span className="w-full text-xs text-gray-500 sm:w-auto">{t('workspaceDestination', { name: props.destination })}</span>
    </div>
    <div data-toolbar-filter-row className="grid grid-cols-1 gap-2 min-[1500px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
        <button data-filter="favorite" type="button" aria-pressed={filters.favorite} onClick={() => onFiltersChange({ favorite: !filters.favorite })}
          className={`${workspaceControlClass} inline-flex min-w-0 items-center justify-center gap-2 ${filters.favorite ? '!border-yellow-400 !bg-yellow-50 !text-yellow-600 dark:!bg-yellow-500/10 dark:!text-yellow-400' : ''}`}>
          <FavoriteIcon active={filters.favorite} />{t('workspaceFavoritesOnly')}
        </button>
        {select('status', t('workspaceStatusFilter'), props.statuses)}
        {select('model', t('workspaceModelFilter'), props.models)}
        {select('download', t('workspaceDownloadFilter'), [
          { value: 'all', label: t('workspaceAllDownloads') }, { value: 'not_downloaded', label: t('imageNotDownloaded') },
          { value: 'partial', label: t('workspacePartDownloaded') }, { value: 'downloaded', label: t('imageDownloaded') },
        ])}
      </div>
      <div className="flex min-w-0 items-stretch gap-2">
        <div className="relative min-w-0 flex-1">
          <svg aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7}><circle cx="10.5" cy="10.5" r="7" /><path d="m16 16 5 5" /></svg>
          <input data-filter="query" aria-label={t('workspaceSearch')} className={`${workspaceControlClass} h-full w-full pl-9 pr-9`} placeholder={t('workspaceSearchPlaceholder')} value={filters.query} onChange={e => onFiltersChange({ query: e.target.value })} />
          {filters.query && <button type="button" aria-label={t('workspaceClearSearch')} className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10" onClick={() => onFiltersChange({ query: '' })}>×</button>}
        </div>
        <button type="button" aria-pressed={props.batch} className={`${workspaceControlClass} shrink-0 ${props.batch ? '!border-blue-400 !bg-blue-50 !text-blue-600 dark:!bg-blue-500/10 dark:!text-blue-300' : ''}`} onClick={props.onToggleBatch}>{t(props.batch ? 'exitBatch' : 'batchActions')}</button>
      </div>
    </div>
  </section>
}
