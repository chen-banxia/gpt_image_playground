import { tCurrent as t } from '../../i18n'
import type { VideoAsset, VideoDraft, VideoTask } from './types'

export const VIDEO_DB_NAME = 'gpt-video-playground'
type StoreName = 'videoTasks' | 'inputAssets' | 'assetBlobs' | 'drafts' | 'meta'
let connection: Promise<IDBDatabase> | undefined
export function openVideoDb() {
  if (!connection) connection = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(VIDEO_DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      const tasks = db.createObjectStore('videoTasks', { keyPath: 'id' })
      for (const key of ['createdAt', 'status', 'groupId', 'modelId']) tasks.createIndex(key, key)
      db.createObjectStore('inputAssets', { keyPath: 'id' })
      db.createObjectStore('assetBlobs', { keyPath: 'id' })
      db.createObjectStore('drafts', { keyPath: 'id' })
      db.createObjectStore('meta', { keyPath: 'id' })
    }
    req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); connection = undefined }; resolve(req.result) }
    req.onerror = () => { connection = undefined; reject(req.error) }
    req.onblocked = () => { connection = undefined; reject(new Error(t("视频数据库被其他页面占用，请关闭其他页面后重试"))) }
  })
  return connection
}
export async function transaction<T>(stores: StoreName[], mode: IDBTransactionMode, work: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
  const db = await openVideoDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode)
    let result: T
    // 必须等待整个事务完成，单个 request success 不代表已持久化。
    tx.oncomplete = () => resolve(result)
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error(t("视频数据保存失败")))
    try { work(tx, value => { result = value }) } catch (e) { tx.abort(); reject(e) }
  })
}
export const readAll = <T>(store: StoreName) => transaction<T[]>([store], 'readonly', (tx, done) => { const r = tx.objectStore(store).getAll(); r.onsuccess = () => done(r.result) })
export const readOne = <T>(store: StoreName, id: string) => transaction<T | undefined>([store], 'readonly', (tx, done) => { const r = tx.objectStore(store).get(id); r.onsuccess = () => done(r.result) })
export const put = <T>(store: StoreName, value: T) => transaction<void>([store], 'readwrite', tx => { tx.objectStore(store).put(value) })
export const saveDraft = (draft: VideoDraft) => put('drafts', draft)
export const saveTask = (task: VideoTask) => put('videoTasks', task)
export async function patchTasks(ids: string[], patch: Partial<VideoTask>): Promise<void> {
  return transaction(['videoTasks'], 'readwrite', tx => {
    const store = tx.objectStore('videoTasks')
    for (const id of ids) { const r = store.get(id); r.onsuccess = () => { if (r.result) store.put({ ...r.result, ...patch, id, updatedAt: Date.now() }) } }
  })
}
export const saveAsset = (asset: VideoAsset, blob?: Blob) => transaction<void>(['inputAssets', 'assetBlobs'], 'readwrite', tx => {
  tx.objectStore('inputAssets').put(asset)
  if (blob) tx.objectStore('assetBlobs').put({ id: asset.id, blob })
})
export const deleteTasks = (ids: string[]) => transaction<void>(['videoTasks'], 'readwrite', tx => { ids.forEach(id => tx.objectStore('videoTasks').delete(id)) })
export async function cleanUnusedAssets() {
  return transaction<number>(['videoTasks', 'drafts', 'inputAssets', 'assetBlobs'], 'readwrite', (tx, done) => {
    const refs = new Set<string>()
    const tasks = tx.objectStore('videoTasks').getAll()
    tasks.onsuccess = () => {
      tasks.result.forEach((t: VideoTask) => t.inputs.forEach(i => refs.add(i.assetId)))
      const drafts = tx.objectStore('drafts').getAll()
      drafts.onsuccess = () => {
        drafts.result.forEach((d: VideoDraft) => [...d.frames, ...d.references].forEach(i => refs.add(i.assetId)))
        const assets = tx.objectStore('inputAssets').getAll()
        assets.onsuccess = () => {
          let count = 0
          for (const a of assets.result as VideoAsset[]) if (!refs.has(a.id)) { tx.objectStore('inputAssets').delete(a.id); tx.objectStore('assetBlobs').delete(a.id); count++ }
          done(count)
        }
      }
    }
  })
}
export const clearVideo = (includeDraft: boolean) => transaction<void>(['videoTasks', 'drafts', 'inputAssets', 'assetBlobs'], 'readwrite', tx => {
  tx.objectStore('videoTasks').clear()
  if (includeDraft) for (const name of ['drafts', 'inputAssets', 'assetBlobs']) tx.objectStore(name).clear()
})
