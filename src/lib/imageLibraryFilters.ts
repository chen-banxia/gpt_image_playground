import type { TaskRecord } from '../types'

// 未知历史模型单独归类，不能用当前设置中的模型冒充生成时的模型。
export const UNKNOWN_IMAGE_MODEL = '__unknown_model__'
export const imageTaskModel = (task: TaskRecord) => task.apiImageModel?.trim() || task.apiModel?.trim() || UNKNOWN_IMAGE_MODEL
export function imageDownloadState(task: TaskRecord, downloaded: Record<string, number>) {
  // 没有产物的运行中或失败记录不属于“未下载”，多图记录按去重后的文件计算。
  const ids = [...new Set(task.outputImages)]
  if (!ids.length) return 'no_output'
  const count = ids.filter(id => Boolean(downloaded[id])).length
  return count === 0 ? 'not_downloaded' : count === ids.length ? 'downloaded' : 'partial'
}
export function filterImageLibrary(tasks: TaskRecord[], model: string, download: string, downloaded: Record<string, number>) {
  return tasks.filter(task => (model === 'all' || imageTaskModel(task) === model) && (download === 'all' || imageDownloadState(task, downloaded) === download))
}
