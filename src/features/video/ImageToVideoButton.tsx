import { useT } from '../../hooks/useI18n'
import { useState } from 'react'
import { ensureImageCached, useStore } from '../../store'
import { addFile } from './assets'
import { initializeVideo, message, refreshVideo, useVideoStore } from './store'
export default function ImageToVideoButton({ imageId, groupId }: { imageId?: string; groupId?: string | null }) {
  const t = useT()
  const [busy, setBusy] = useState(false)
  return <button disabled={!imageId || busy} className="rounded-md p-1.5 text-xs text-blue-500 hover:bg-blue-500/10 disabled:opacity-30" title={t("将图片复制到视频工作台")} onClick={async event => {
    event.stopPropagation()
    if (!imageId) return
    setBusy(true)
    try {
      await initializeVideo()
      const draft = useVideoStore.getState().draft
      if (draft.inputMode === 'frames' && draft.frames.some(i => i.role === 'first_frame') && !window.confirm(t("替换视频草稿的首帧？描述和其他素材会保留。"))) return
      const data = await ensureImageCached(imageId)
      if (!data) throw new Error(t("原图缺失，无法作为视频输入"))
      const blob = await (await fetch(data)).blob()
      const asset = await addFile(new File([blob], t("图片工作台素材.png"), { type: blob.type }))
      await refreshVideo()
      if (draft.inputMode === 'frames') useVideoStore.getState().updateDraft({ frames: [...draft.frames.filter(i => i.role !== 'first_frame'), { assetId: asset.id, role: 'first_frame' }], groupId: groupId ?? null })
      else useVideoStore.getState().updateDraft({ references: [...draft.references, { assetId: asset.id, role: 'reference_image' }], groupId: groupId ?? null })
      useStore.getState().setDetailTaskId(null)
      window.location.hash = '/video'
      useStore.getState().showToast(t("图片已复制到视频素材区，请补充描述后生成"), 'success')
    } catch (e) { useStore.getState().showToast(message(e), 'error') } finally { setBusy(false) }
  }}>{busy ? t("准备中…") : t("生成视频")}</button>
}
