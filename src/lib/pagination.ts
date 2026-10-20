// 桌面三列布局每页正好三行，所有展示与批量选择共用此页容量。
export const GALLERY_PAGE_SIZE = 9

/** 筛选后分页；删除末页记录时回到最后一个有效页，空列表仍保留第 1 页。 */
export function paginateItems<T>(items: T[], requestedPage: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / GALLERY_PAGE_SIZE))
  const page = Math.min(totalPages, Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1))
  const start = (page - 1) * GALLERY_PAGE_SIZE
  return { items: items.slice(start, start + GALLERY_PAGE_SIZE), page, totalPages, total: items.length, start: items.length ? start + 1 : 0, end: Math.min(start + GALLERY_PAGE_SIZE, items.length) }
}
