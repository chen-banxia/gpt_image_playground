import { useT } from '../hooks/useI18n'

export default function GenerationPreview({ images }: { images: Record<number, string> }) {
  const t = useT()
  // 以并发请求编号固定预览位置，避免不同图片的中间帧互相覆盖。
  const entries = Object.entries(images)
  return (
    <div className="absolute inset-0 p-2 flex flex-col gap-1">
      <div className={`grid flex-1 min-h-0 gap-1 ${entries.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {entries.map(([index, image]) => <img key={index} src={image} alt={`${t('previewIntermediate')} ${Number(index) + 1}`} className="w-full h-full min-h-0 object-contain" />)}
      </div>
      <span className="self-center rounded bg-black/60 px-2 py-1 text-[10px] text-white" role="status">{t('previewIntermediate')}</span>
    </div>
  )
}
