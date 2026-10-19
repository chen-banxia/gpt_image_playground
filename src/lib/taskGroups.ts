import type { ImageGroup, TaskRecord } from '../types'

export const ALL_GROUPS = 'all'
export const UNGROUPED = 'ungrouped'

export function resolveTaskGroup(groupId: string | null | undefined, groups: ImageGroup[]) {
  // 旧记录没有分组，或引用的分组已删除时，统一作为未分组展示。
  return groups.some((group) => group.id === groupId) ? groupId! : null
}

/** 画廊和批量操作共用筛选，确保全选不会包含其他分组的隐藏记录。 */
export function filterGalleryTasks(tasks: TaskRecord[], groups: ImageGroup[], groupFilter: string, query: string, status: string, favorite: boolean) {
  const q = query.trim().toLowerCase()
  return tasks.filter((task) => {
    const groupId = resolveTaskGroup(task.groupId, groups)
    if (groupFilter !== ALL_GROUPS && (groupFilter === UNGROUPED ? groupId !== null : groupId !== groupFilter)) return false
    if (favorite && !task.isFavorite) return false
    if (status !== 'all' && task.status !== status) return false
    return !q || task.prompt.toLowerCase().includes(q) || JSON.stringify(task.params).toLowerCase().includes(q)
  }).sort((a, b) => b.createdAt - a.createdAt)
}
