import { useMemo } from 'react'
import { useStore } from '../store'
import { filterGalleryTasks } from '../lib/taskGroups'
import { paginateItems } from '../lib/pagination'

/** 画廊和批量操作使用同一页数据，避免“全选”选到其他页的图片。 */
export function useGalleryPage() {
  const tasks = useStore((s) => s.tasks)
  const groups = useStore((s) => s.groups)
  const groupFilter = useStore((s) => s.groupFilter)
  const query = useStore((s) => s.searchQuery)
  const status = useStore((s) => s.filterStatus)
  const favorite = useStore((s) => s.filterFavorite)
  const page = useStore((s) => s.galleryPage)
  return useMemo(() => paginateItems(filterGalleryTasks(tasks, groups, groupFilter, query, status, favorite), page),
    [tasks, groups, groupFilter, query, status, favorite, page])
}
