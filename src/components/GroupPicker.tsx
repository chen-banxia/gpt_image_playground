import { assignTaskGroup, useStore } from '../store'
import { resolveTaskGroup } from '../lib/taskGroups'
import { useT } from '../hooks/useI18n'

export default function GroupPicker({ taskIds, batch = false }: { taskIds: string[]; batch?: boolean }) {
  const t = useT()
  const groups = useStore((state) => state.groups)
  const tasks = useStore((state) => state.tasks)
  // 批量选择器始终显示操作入口，避免把多个不同分组误显示成同一归属。
  const value = batch ? '' : resolveTaskGroup(tasks.find((task) => task.id === taskIds[0])?.groupId, groups) ?? ''
  return <select aria-label={t(batch ? 'batchGroup' : 'imageGroup')} value={value} disabled={!taskIds.length}
    className="max-w-[160px] rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-700 dark:border-white/10 dark:bg-gray-900 dark:text-gray-200 disabled:opacity-40"
    onClick={(event) => event.stopPropagation()}
    onChange={async (event) => {
      const target = event.target.value
      try { await assignTaskGroup(taskIds, target === 'ungrouped' || !target ? null : target) }
      catch (error) { useStore.getState().showToast(error instanceof Error ? error.message : String(error), 'error') }
    }}>
    {batch && <option value="" disabled>{t('batchGroup')}</option>}
    <option value={batch ? 'ungrouped' : ''}>{t('ungrouped')}</option>
    {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
  </select>
}
