import { useStore } from '../store'
import { useT } from '../hooks/useI18n'
import Select from './Select'
import { useState } from 'react'
import GroupManager from './GroupManager'

export default function SearchBar() {
  const t = useT()
  const searchQuery = useStore((s) => s.searchQuery)
  const setSearchQuery = useStore((s) => s.setSearchQuery)
  const filterStatus = useStore((s) => s.filterStatus)
  const setFilterStatus = useStore((s) => s.setFilterStatus)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const setFilterFavorite = useStore((s) => s.setFilterFavorite)
  const batchMode = useStore((s) => s.batchMode)
  const setBatchMode = useStore((s) => s.setBatchMode)
  const groups = useStore((s) => s.groups)
  const groupFilter = useStore((s) => s.groupFilter)
  const setGroupFilter = useStore((s) => s.setGroupFilter)
  const tasks = useStore((s) => s.tasks)
  const [managingGroups, setManagingGroups] = useState(false)

  return (
    <div data-no-drag-select className="mt-6 mb-4 flex flex-wrap gap-3">
      <div className="flex w-full flex-wrap items-center gap-2">
        <select aria-label={t('filterGroup')} value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}
          className="max-w-[240px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-gray-900">
          <option value="all">{t('allGroups')} ({tasks.length})</option>
          <option value="ungrouped">{t('ungrouped')} ({tasks.filter((task) => !groups.some((group) => group.id === task.groupId)).length})</option>
          {groups.map((group) => <option key={group.id} value={group.id}>{group.name} ({tasks.filter((task) => task.groupId === group.id).length})</option>)}
        </select>
        <button type="button" className="rounded-lg px-3 py-2 text-sm text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10" onClick={() => setManagingGroups(true)}>{t('manageGroups')}</button>
        <span className="text-xs text-gray-500">{t('newTaskGroupHint', { name: groups.find((group) => group.id === groupFilter)?.name ?? t('ungrouped') })}</span>
      </div>
      {managingGroups && <GroupManager onClose={() => setManagingGroups(false)} />}
      <div className="flex gap-2 flex-shrink-0 z-20">
        <button
          onClick={() => setFilterFavorite(!filterFavorite)}
          className={`p-2.5 rounded-xl border transition-all ${
            filterFavorite
              ? 'border-yellow-400 bg-yellow-50 dark:bg-yellow-500/10 text-yellow-500'
              : 'border-gray-200 dark:border-white/[0.08] bg-white dark:bg-gray-900 text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.06]'
          }`}
          title={filterFavorite ? t('cancelFavoritesOnly') : t('showFavoritesOnly')}
        >
          <svg className="w-5 h-5" fill={filterFavorite ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        </button>
        <div className="relative w-28">
          <Select
            value={filterStatus}
            onChange={(val) => setFilterStatus(val as any)}
            options={[
              { label: t('allStatuses'), value: 'all' },
              { label: t('completed'), value: 'done' },
              { label: t('running'), value: 'running' },
              { label: t('failed'), value: 'error' },
            ]}
            className="px-3 py-2.5 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-white/[0.06] text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition"
          />
        </div>
      </div>
      <div className="relative flex-1 min-w-[120px] z-10">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          type="text"
          placeholder={t('searchPlaceholder')}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 transition"
        />
      </div>
      <button type="button" onClick={() => setBatchMode(!batchMode)} aria-pressed={batchMode}
        className={`rounded-xl border px-3 py-2 text-sm font-medium ${batchMode ? 'border-blue-400 bg-blue-50 text-blue-600 dark:bg-blue-500/10' : 'border-gray-200 bg-white text-gray-600 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-300'}`}>
        {t(batchMode ? 'exitBatch' : 'batchActions')}
      </button>
    </div>
  )
}
