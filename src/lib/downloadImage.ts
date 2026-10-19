import { tCurrent } from '../i18n'

/** 页面只能确认已向浏览器发起下载，无法判断用户是否取消保存或磁盘写入是否完成。 */
export async function downloadImage(src: string, onStarted?: () => void) {
  // 预览使用本地 data URL，同步解码以在用户点击的调用栈内触发下载。
  // 网络 URL 才需要异步读取，避免本地图先 fetch 导致部分浏览器丢失用户手势。
  const match = src.match(/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/)
  let blob: Blob
  if (match) {
    const binary = atob(match[2])
    blob = new Blob([Uint8Array.from(binary, (char) => char.charCodeAt(0))], { type: match[1] })
  } else {
    const response = await fetch(src)
    if (!response.ok) throw new Error(tCurrent('downloadFailed'))
    blob = await response.blob()
  }
  if (!blob.type.startsWith('image/')) throw new Error(tCurrent('downloadFailed'))
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `image-${Date.now()}.${blob.type.split('/')[1] === 'jpeg' ? 'jpg' : blob.type.split('/')[1]}`
  document.body.appendChild(link)
  try {
    link.click()
    onStarted?.()
  } finally {
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
}
