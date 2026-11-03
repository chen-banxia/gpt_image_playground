import { useStore } from '../store'
import { useT } from '../hooks/useI18n'
import { useState } from 'react'
import GroupManager from './GroupManager'
import WorkspaceLibraryToolbar, { type LibraryFilters } from './workspace/WorkspaceLibraryToolbar'
import { imageTaskModel, UNKNOWN_IMAGE_MODEL } from '../lib/imageLibraryFilters'

export default function SearchBar() {
  const t = useT()
  const state = useStore()
  const [managingGroups, setManagingGroups] = useState(false)
  const filters: LibraryFilters = { group: state.groupFilter, query: state.searchQuery, status: state.filterStatus, favorite: state.filterFavorite, model: state.filterModel, download: state.filterDownload }
  const change = (patch: Partial<LibraryFilters>) => {
    if (patch.group !== undefined) state.setGroupFilter(patch.group)
    if (patch.query !== undefined) state.setSearchQuery(patch.query)
    if (patch.status !== undefined) state.setFilterStatus(patch.status as typeof state.filterStatus)
    if (patch.favorite !== undefined) state.setFilterFavorite(patch.favorite)
    if (patch.model !== undefined) state.setFilterModel(patch.model)
    if (patch.download !== undefined) state.setFilterDownload(patch.download)
  }
  const modelIds = [...new Set([...state.tasks.map(imageTaskModel), ...(state.filterModel === 'all' ? [] : [state.filterModel])])].sort()
  return <>
    <WorkspaceLibraryToolbar
      title={t('workspaceImageLibrary')} storageHint={t('workspaceImageStorage')}
      groups={[
        { value: 'all', label: t('allGroups') + ' (' + state.tasks.length + ')' },
        { value: 'ungrouped', label: t('ungrouped') + ' (' + state.tasks.filter(task => !state.groups.some(g => g.id === task.groupId)).length + ')' },
        ...state.groups.map(g => ({ value: g.id, label: g.name + ' (' + state.tasks.filter(task => task.groupId === g.id).length + ')' })),
      ]}
      destination={state.groups.find(g => g.id === state.groupFilter)?.name ?? t('ungrouped')}
      statuses={[{ value: 'all', label: t('allStatuses') }, { value: 'running', label: t('running') }, { value: 'done', label: t('completed') }, { value: 'error', label: t('failed') }]}
      models={[{ value: 'all', label: t('workspaceAllModels') }, ...modelIds.map(id => ({ value: id, label: id === UNKNOWN_IMAGE_MODEL ? t('workspaceUnknownModel') : id }))]}
      filters={filters} onFiltersChange={change} batch={state.batchMode}
      onToggleBatch={() => state.setBatchMode(!state.batchMode)} onManageGroups={() => setManagingGroups(true)} />
    {managingGroups && <GroupManager onClose={() => setManagingGroups(false)} />}
  </>
}
