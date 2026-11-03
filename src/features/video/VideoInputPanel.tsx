import CreationPanelHeader from '../../components/workspace/CreationPanelHeader'
import { useVideoMessage } from '../../hooks/useVideoMessage'
import { useT } from '../../hooks/useI18n'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { activeInputs, effectiveParams, is25, modelFor, RATIOS, validateDraft, VIDEO_MODELS } from './models'
import { addFile, addRemoteAsset } from './assets'
import { message, refreshVideo, retryAcceptedSave, submitVideo, useVideoStore } from './store'
import { useVideoSettings } from './settings'
import type { AssetRole, InputMode, MediaType, VideoAsset, VideoInput } from './types'
import * as db from './db'
import { buttonClass, fieldClass } from './VideoSettings'
import VideoDurationField from './VideoDurationField'

export function AssetPreview({ asset }: { asset: VideoAsset }) {
  const t = useT()
  const localize = useVideoMessage()
  const [url, setUrl] = useState(asset.remoteUrl ?? '')
  useEffect(() => {
    let local = ''; let cancelled = false
    if (!asset.remoteUrl) void db.readOne<{ blob: Blob }>('assetBlobs', asset.id).then(r => { if (r && !cancelled) { local = URL.createObjectURL(r.blob); setUrl(local) } })
    return () => { cancelled = true; if (local) URL.revokeObjectURL(local) }
  }, [asset.id, asset.remoteUrl])
  if (asset.mediaType === 'image' && url) return <img src={url} alt={asset.name} className="h-16 w-full rounded-lg object-contain" />
  return <div className="flex h-12 items-center justify-center text-xs text-gray-400">{asset.mediaType === 'video' ? t("▶ 参考视频") : asset.mediaType === 'audio' ? t("♫ 参考音频") : t("图片待恢复")}</div>
}
export const roleName = { first_frame: '首帧 · 开始画面', last_frame: '尾帧 · 结束画面', reference_image: '参考图片', reference_video: '参考视频', reference_audio: '参考音频' } as const satisfies Record<AssetRole, string>
export default function VideoInputPanel({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const t = useT()
  const localize = useVideoMessage()
  const { draft, assets, ready, error, submitting, saving, pendingAccepted, updateDraft } = useVideoStore()
  const settings = useVideoSettings(s => s.settings)
  const groups = useStore(s => s.groups)
  const [advanced, setAdvanced] = useState(false)
  const [modePickerOpen, setModePickerOpen] = useState(false)
  const modePickerRef = useRef<HTMLDivElement>(null)
  const modeButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!modePickerOpen || collapsed) return
    // 在当前素材区直接呈现选择，并保证短窗口内也能看到，不再展开远处的高级设置。
    modePickerRef.current?.querySelector('#video-mode-picker')?.scrollIntoView({ block: 'nearest' })
    modePickerRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true })
  }, [modePickerOpen, collapsed])
  const [localError, setLocalError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkType, setLinkType] = useState<MediaType>('image')
  const [chooseFrames, setChooseFrames] = useState(false)
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const requestedRole = useRef<AssetRole | undefined>(undefined)
  const replacementId = useRef<string | undefined>(undefined)
  const model = modelFor(draft.modelId)
  const inputs = activeInputs(draft)
  const errors = validateDraft(draft, assets, t)
  const boundParams = effectiveParams(draft)
  const setInputs = (next: VideoInput[]) => updateDraft({ [draft.inputMode === 'frames' ? 'frames' : 'references']: next })
  const closeModePicker = () => {
    setModePickerOpen(false)
    modeButtonRef.current?.focus({ preventScroll: true })
  }
  const changeMode = (mode: InputMode) => {
    if (mode === draft.inputMode) { closeModePicker(); return }
    if (!inputs.length) { updateDraft({ inputMode: mode }); closeModePicker(); return }
    if (mode === 'reference') {
      if (!window.confirm(t("首帧和尾帧将作为参考图，不再指定起止画面。原首尾帧草稿会保留。是否转换？"))) return
      updateDraft({ inputMode: mode, references: [...draft.references, ...draft.frames.filter(i => !draft.references.some(r => r.assetId === i.assetId)).map(i => ({ ...i, role: 'reference_image' as const }))] })
      closeModePicker()
    } else { setFirst(draft.frames.find(i => i.role === 'first_frame')?.assetId ?? ''); setLast(draft.frames.find(i => i.role === 'last_frame')?.assetId ?? ''); setChooseFrames(true) }
  }
  const appendAssets = async (items: VideoAsset[], role?: AssetRole) => {
    const current = useVideoStore.getState().draft
    if (current.inputMode === 'frames') {
      if (!role && current.frames.length >= 2) throw new Error(t("首尾帧已满，请明确替换某个槽位，或切换全能参考。原素材已保留。"))
      const target = role ?? (!current.frames.some(i => i.role === 'first_frame') ? 'first_frame' : 'last_frame')
      if (items.length > 1 || items[0]?.mediaType !== 'image') throw new Error(t("首尾帧每个槽位只能选择一张图片；多素材请用全能参考"))
      const next = current.frames.filter(i => i.role !== target)
      updateDraft({ frames: [...next, { assetId: items[0].id, role: target }] })
    } else updateDraft({ references: [...current.references, ...items.map(a => ({ assetId: a.id, role: `reference_${a.mediaType}` as AssetRole }))] })
    await refreshVideo()
  }
  const upload = async (files: FileList | File[], role?: AssetRole) => {
    if (uploading || !files.length) return
    setUploading(true); setLocalError('')
    try {
      if (draft.inputMode === 'frames' && files.length > 1) throw new Error(t("请分别选择首帧和尾帧；超过两张请使用全能参考"))
      if (draft.inputMode === 'frames' && !role && draft.frames.length >= 2) throw new Error(t("首尾帧已满，请选择替换槽位或切换全能参考"))
      const added: VideoAsset[] = []
      for (const file of Array.from(files)) added.push(await addFile(file))
      await appendAssets(added, role)
    } catch (e) { setLocalError(message(e)) } finally { setUploading(false) }
  }
  return <aside data-input-bar className="generation-sidebar" aria-label={t("视频创作")}>
    <div className="generation-panel rounded-2xl border border-gray-200 bg-white shadow-lg dark:border-white/10 dark:bg-gray-900">
      <CreationPanelHeader title={t('generationPanelVideo')} collapsed={collapsed} controls="video-input-content" onToggle={onToggle} />
      <div id="video-input-content" className="generation-panel-body space-y-4" hidden={collapsed}>
        <label className="block space-y-1 text-xs">{t("模型")}<select aria-label={t("模型")} className={fieldClass} value={draft.modelId} onChange={e => {
          const nextModel = modelFor(e.target.value)
          if (nextModel.id !== draft.modelId) updateDraft({ modelId: nextModel.id, params: { ...draft.params, resolution: nextModel.resolutions[0] } })
        }}>{VIDEO_MODELS.map(m => <option key={m.id} value={m.id}>{t(m.name)}</option>)}</select></label>
        <p className="text-xs text-gray-500">{t("自动使用{0}视频配置", { "0": model.keySlot === 'doubaoVideo' ? t("豆包") : t("海螺") })}</p>
        {!settings[model.keySlot].apiKey && <button className="text-xs text-blue-500" onClick={() => useStore.getState().setShowSettings(true)}>{t("请在设置中配置对应视频 Key →")}</button>}
        <label className="block text-xs">{t("描述画面、动作与镜头")}<textarea className={`${fieldClass} mt-1 min-h-28 resize-y`} value={draft.prompt} placeholder={t("描述希望生成的视频，可按需添加素材…")} onChange={e => updateDraft({ prompt: e.target.value })} onPaste={e => { const files = e.clipboardData.files; if (files.length) { e.preventDefault(); void upload(files) } }} /></label>
        <div onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files) }}>
          <div ref={modePickerRef} className="mb-3" onKeyDown={event => {
            if (event.key === 'Escape' && modePickerOpen) { event.stopPropagation(); closeModePicker() }
          }}>
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium" aria-live="polite">{draft.inputMode === 'frames' ? t("首尾帧模式") : t("全能参考模式")}</span>
              <button ref={modeButtonRef} type="button" aria-expanded={modePickerOpen} aria-controls="video-mode-picker"
                className={`inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg border px-3 font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 ${modePickerOpen ? 'border-blue-500 bg-blue-500 text-white' : 'border-blue-200 bg-blue-50 text-blue-600 hover:bg-blue-100 dark:border-blue-400/30 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/20'}`}
                onClick={() => setModePickerOpen(open => !open)}>
                {modePickerOpen ? t('收起方式选择') : t('更改方式')}
                <svg aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${modePickerOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="m6 9 6 6 6-6" /></svg>
              </button>
            </div>
            <div id="video-mode-picker" hidden={!modePickerOpen} style={{ maxHeight: 'max(8rem, min(20rem, calc(100dvh - 280px)))' }} className="mt-2 space-y-2 overflow-y-auto overscroll-contain rounded-xl border border-blue-200 bg-blue-50/70 p-2.5 dark:border-blue-400/30 dark:bg-blue-500/[0.08]">
              <p className="px-1 text-xs font-medium text-blue-700 dark:text-blue-300">{t('选择素材如何参与生成')}</p>
              {(['frames', 'reference'] as InputMode[]).map(mode => {
                const selected = draft.inputMode === mode
                return <button key={mode} type="button" aria-pressed={selected} aria-label={mode === 'frames' ? t('首尾帧') : t('全能参考')} disabled={uploading || submitting}
                  className={`block w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 ${selected ? 'border-blue-500 bg-white dark:bg-gray-800' : 'border-transparent hover:border-blue-300 hover:bg-white/80 dark:hover:bg-white/5'}`}
                  onClick={() => changeMode(mode)}>
                  <span className="flex items-center justify-between gap-2 text-sm font-semibold"><span>{mode === 'frames' ? t('首尾帧') : t('全能参考')}</span>{selected && <span className="text-xs text-blue-600 dark:text-blue-300">✓ {t('当前方式')}</span>}</span>
                  <span className="mt-1 block text-xs leading-relaxed text-gray-500 dark:text-gray-400">{mode === 'frames' ? t('指定开始和结束画面，尾帧可选。') : t('参考人物、场景、动作或声音，不指定起止画面。')}</span>
                </button>
              })}
            </div>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-gray-500">{draft.inputMode === 'frames' ? t("首帧指定开始画面，尾帧引导结束画面；无图也可按描述生成。") : t("参考人物、场景、动作或声音，不指定开始和结束画面。")}</p>
          <div className="grid grid-cols-2 gap-2">
            {(draft.inputMode === 'frames' ? (['first_frame', 'last_frame'] as AssetRole[]).map(role => inputs.find(i => i.role === role) ?? { assetId: '', role }) : inputs).map((input, index) => {
              const asset = assets.find(a => a.id === input.assetId)
              return <div key={`${input.role}-${index}`} className="min-w-0 rounded-xl border border-dashed border-gray-300 p-2 dark:border-white/20">
                <p className="mb-1 text-[11px] text-gray-500">{t(roleName[input.role])}{draft.inputMode === 'reference' ? ` ${index + 1}` : ''}</p>
                {asset ? <><AssetPreview asset={asset} /><p className="truncate text-[11px]" title={asset.name}>{asset.name}</p><p className="text-[10px] text-gray-500">{asset.remoteUrl ? t("仅链接") : t("{0}MB · 已保存", { "0": (asset.sizeBytes / 1024 / 1024).toFixed(1) })}</p></> : input.assetId ? <p className="text-xs text-red-500">{t("原素材缺失，请替换")}</p> : null}
                <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-blue-500">
                  <button disabled={uploading} onClick={() => { replacementId.current = input.assetId || undefined; requestedRole.current = input.role; fileRef.current?.click() }}>{input.assetId ? t("替换") : t("＋ 添加")}</button>
                  {input.assetId && <button onClick={() => setInputs(inputs.filter((_, i) => i !== inputs.indexOf(input)))}>{t("移除")}</button>}
                  {draft.inputMode === 'reference' && index > 0 && <button aria-label={t("前移素材 {0}", { "0": index + 1 })} onClick={() => { const next = [...inputs]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; setInputs(next) }}>{t("前移")}</button>}
                </div>
              </div>
            })}
          </div>
          {draft.inputMode === 'frames' && inputs.length > 0 && <button className="mt-2 text-xs text-blue-500" onClick={() => updateDraft({ frames: draft.frames.map(i => ({ ...i, role: i.role === 'first_frame' ? 'last_frame' : 'first_frame' })) })}>{inputs.length === 1 && inputs[0].role === 'last_frame' ? t("将尾帧设为首帧") : t("交换首尾帧")}</button>}
          {draft.inputMode === 'reference' && <button className={`${buttonClass} mt-2 w-full`} disabled={uploading} onClick={() => { requestedRole.current = undefined; replacementId.current = undefined; fileRef.current?.click() }}>{t("＋ 添加参考素材")}</button>}
          <input ref={fileRef} type="file" accept={draft.inputMode === 'frames' ? 'image/png,image/jpeg,image/webp' : 'image/png,image/jpeg,image/webp,video/*,audio/*'} multiple={draft.inputMode === 'reference'} className="hidden" onChange={async e => { const files = Array.from(e.target.files ?? []); e.target.value = ''; const role = requestedRole.current; if (draft.inputMode === 'reference' && replacementId.current && files[0]) { try { if (files.length !== 1) throw new Error(t("替换素材时一次只能选择一个文件")); setUploading(true); const asset = await addFile(files[0]); const index = draft.references.findIndex(i => i.assetId === replacementId.current); const refs = [...draft.references]; refs[index] = { assetId: asset.id, role: `reference_${asset.mediaType}` as AssetRole }; updateDraft({ references: refs }); await refreshVideo() } catch (err) { setLocalError(message(err)) } finally { setUploading(false) } } else await upload(files, role) }} />
          <details className="mt-3 text-xs"><summary className="cursor-pointer text-gray-500">{t("使用公网素材链接")}</summary><div className="mt-2 space-y-2">
            {draft.inputMode === 'reference' && <select aria-label={t("链接素材类型")} className={fieldClass} value={linkType} onChange={e => setLinkType(e.target.value as MediaType)}><option value="image">{t("图片")}</option><option value="video">{t("视频")}</option><option value="audio">{t("音频")}</option></select>}
            <input aria-label={t("素材链接")} className={fieldClass} value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://…" />
            <button className={buttonClass} disabled={uploading} onClick={async () => { try { setUploading(true); const a = await addRemoteAsset(linkUrl, draft.inputMode === 'frames' ? 'image' : linkType); await appendAssets([a]); setLinkUrl(''); setLocalError('') } catch (e) { setLocalError(message(e)) } finally { setUploading(false) } }}>{t("添加链接")}</button>
          </div></details>
          <p className="mt-2 text-[11px] leading-relaxed text-gray-500">{t("本地图片 ≤20MB、短边 ≥300px；视频/音频 ≤100MB。编码请求总量 ≤60MB，较大素材请使用公网链接。参考上限：图片 {0} / 视频 {1} / 音频 {2}，仍以网关实际能力为准。", { "0": model.images, "1": model.videos, "2": model.audios })}</p>
          {uploading && <p role="status" className="mt-2 text-xs text-blue-500">{t("正在准备素材，完成后可提交…")}</p>}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <VideoDurationField key={draft.modelId} modelId={draft.modelId} value={draft.params.duration} onChange={duration => updateDraft({ params: { ...draft.params, duration } })} />
          <label className="text-xs">{t("分辨率")}<select aria-label={t("分辨率")} className={`${fieldClass} mt-1`} value={draft.params.resolution} onChange={e => updateDraft({ params: { ...draft.params, resolution: e.target.value } })}>{!model.resolutions.includes(draft.params.resolution) && <option value={draft.params.resolution}>{t("{0} · 不支持", { "0": draft.params.resolution })}</option>}{model.resolutions.map(r => <option key={r}>{r}</option>)}</select></label>
        </div>
        <label className="block text-xs">{t("画面比例")}<select aria-label={t("画面比例")} className={`${fieldClass} mt-1`} disabled={(is25(model.id) || model.id === 'MiniMax-H3') && draft.inputMode === 'frames' && draft.frames.some(i => i.role === 'first_frame')} value={boundParams.ratio} onChange={e => updateDraft({ params: { ...draft.params, ratio: e.target.value } })}>{RATIOS.map(r => <option key={r} value={r}>{r === 'adaptive' ? t("自动 / 跟随素材") : r}</option>)}</select></label>
        {boundParams.ratio !== draft.params.ratio && <p className="text-xs text-gray-500">{t("当前模型有首帧时须跟随首帧比例。")}</p>}
        <button className="w-full text-left text-sm" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>{t("高级参数")} {advanced ? '▴' : '▾'}</button>
        {advanced && <div className="space-y-3 rounded-xl border p-3 dark:border-white/10">
          {model.keySlot === 'doubaoVideo' ? <>{([['generate_audio', t("生成声音")], ['watermark', t("添加水印")], ['return_last_frame', t("返回生成尾帧")]] as const).map(([key, label]) => <label key={key} className="block text-xs">{label}<select className={`${fieldClass} mt-1`} value={draft.params[key] === undefined ? 'default' : String(draft.params[key])} onChange={e => updateDraft({ params: { ...draft.params, [key]: e.target.value === 'default' ? undefined : e.target.value === 'true' } })}><option value="default">{t("平台默认")}</option><option value="true">{t("开启")}</option><option value="false">{t("停用")}</option></select></label>)}{is25(model.id) && <label className="block text-xs">{t("输出格式")}<select className={fieldClass} value={draft.params.output_format ?? 'mp4'} onChange={e => updateDraft({ params: { ...draft.params, output_format: e.target.value as 'mp4' | 'mov' } })}><option value="mp4">MP4</option><option value="mov">MOV</option></select></label>}</> : <p className="text-xs text-gray-500">{t("海螺使用网关默认声音和水印设置，未确认的高级字段不发送。")}</p>}
        </div>}
        <label className="block text-xs">{t("新视频归入")}<select aria-label={t("新视频归入")} className={`${fieldClass} mt-1`} value={draft.groupId ?? ''} onChange={e => updateDraft({ groupId: e.target.value || null })}><option value="">{t("未分组")}</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
        {(localError || error) && <p role="alert" data-selectable-text className="whitespace-pre-wrap rounded-lg bg-red-50 p-3 text-xs text-red-600 dark:bg-red-500/10">{localize(localError || error)}</p>}
        {pendingAccepted && <button className={buttonClass} onClick={() => void retryAcceptedSave().catch(e => setLocalError(message(e)))}>{t("重试保存已提交的任务（不会重新生成）")}</button>}
        {errors.length > 0 && <ul className="space-y-1 text-xs text-amber-600" aria-label={t("需要调整的内容")}>{errors.map(e => <li key={e}>{e}</li>)}</ul>}
        <p className="text-xs text-gray-500">{saving ? t("正在保存草稿…") : t("草稿保存在当前浏览器")}{t(" · 素材 {0} 份 · 生成 1 条", { "0": inputs.length })}</p>
        {draft.retryOfTaskId && <p className="text-xs text-amber-600">{t("已载入失败任务参数；点击生成会创建新的收费任务，不是恢复原任务。")}</p>}
        <button className="w-full rounded-xl bg-blue-500 py-3 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-40" disabled={!ready || submitting || uploading || saving || errors.length > 0 || !settings[model.keySlot].apiKey} onClick={() => void submitVideo()}>{submitting ? t("正在提交，请勿重复操作…") : t("生成视频 →")}</button>
      </div>
    </div>
    {chooseFrames && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4"><div role="dialog" aria-modal="true" aria-label={t("选择首尾帧")} className="w-full max-w-md space-y-4 rounded-2xl bg-white p-5 dark:bg-gray-900"><h3>{t("选择开始与结束画面")}</h3><p className="text-sm text-gray-500">{t("其余素材保留在参考草稿中，本次不发送。")}</p>{[[t("首帧"), first, setFirst], [t("尾帧（可选）"), last, setLast]].map(([label, value, setter]) => <label key={String(label)} className="block text-sm">{String(label)}<select className={fieldClass} value={value as string} onChange={e => (setter as (value: string) => void)(e.target.value)}><option value="">{t("不选择")}</option>{[...new Map([...draft.frames, ...draft.references].filter(i => assets.find(a => a.id === i.assetId)?.mediaType === 'image').map(i => [i.assetId, i])).values()].map(i => <option key={i.assetId} value={i.assetId}>{assets.find(a => a.id === i.assetId)?.name}</option>)}</select></label>)}<div className="flex gap-2"><button className={buttonClass} disabled={Boolean(last && !first)} onClick={() => { updateDraft({ inputMode: 'frames', frames: [...(first ? [{ assetId: first, role: 'first_frame' as const }] : []), ...(last ? [{ assetId: last, role: 'last_frame' as const }] : [])] }); setChooseFrames(false); closeModePicker() }}>{t("确认使用")}</button><button className={buttonClass} onClick={() => setChooseFrames(false)}>{t("保留当前方式")}</button></div></div></div>}
  </aside>
}
