import { useMemo } from 'react'
import { useStore } from '../store'
import { filterGalleryTasks } from '../lib/taskGroups'
import { paginateItems } from '../lib/pagination'
import { filterImageLibrary } from '../lib/imageLibraryFilters'

/** 画廊和批量操作使用同一页数据，避免“全选”选到其他页的图片。 */
export function useGalleryPage() {
  const tasks = useStore((s) => s.tasks)
  const groups = useStore((s) => s.groups)
  const groupFilter = useStore((s) => s.groupFilter)
  const query = useStore((s) => s.searchQuery)
  const status = useStore((s) => s.filterStatus)
  const favorite = useStore((s) => s.filterFavorite)
  const page = useStore((s) => s.galleryPage)
  const model = useStore(s => s.filterModel)
  const download = useStore(s => s.filterDownload)
  const downloaded = useStore(s => s.downloadedImages)
  return useMemo(() => paginateItems(filterImageLibrary(filterGalleryTasks(tasks, groups, groupFilter, query, status, favorite), model, download, downloaded), page),
    [tasks, groups, groupFilter, query, status, favorite, page, model, download, downloaded])
}
