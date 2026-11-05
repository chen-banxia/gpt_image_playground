/** Canvas 转码会丢失 GIF 动画或 SVG 矢量，必须保留源文件。 */
export function requiresOriginalOutput(format: string) {
  return format === 'gif' || format === 'svg'
}

export function isOriginalImageDataUrl(dataUrl: string) {
  return /^data:image\/(gif|svg\+xml)[;,]/i.test(dataUrl)
}

export function imageExtension(mime: string) {
  // SVG 的 MIME 子类型包含 +xml，下载和备份文件名仍应使用 .svg。
  const subtype = mime.split('/')[1]
  return subtype === 'jpeg' ? 'jpg' : subtype === 'svg+xml' ? 'svg' : subtype || 'png'
}

/** GIF 输出可以动，但视觉输入只支持静态 GIF；按数据块解析，避免误数压缩数据。 */
export function isAnimatedGifDataUrl(dataUrl: string) {
  const encoded = dataUrl.match(/^data:[^,]*;base64,(R0lGOD[\s\S]*)$/)?.[1]
  if (!encoded) return false
  const data = atob(encoded)
  if (data.length < 13) return false
  const byte = (index: number) => data.charCodeAt(index)
  let offset = 13 + (byte(10) & 0x80 ? 3 * 2 ** ((byte(10) & 7) + 1) : 0)
  let frames = 0
  const skipBlocks = () => {
    while (offset < data.length) {
      const length = byte(offset++)
      if (!length) return
      offset += length
    }
  }
  while (offset < data.length) {
    const marker = byte(offset++)
    if (marker === 0x3b) return false
    if (marker === 0x21) {
      offset++ // 跳过扩展块标签，后续按长度遍历子块。
      skipBlocks()
    } else if (marker === 0x2c) {
      if (offset + 9 > data.length) return false
      if (++frames > 1) return true
      const packed = byte(offset + 8)
      offset += 9 + (packed & 0x80 ? 3 * 2 ** ((packed & 7) + 1) : 0)
      offset++ // 跳过 LZW 最小码长，压缩数据由子块长度界定。
      skipBlocks()
    } else return false
  }
  return false
}
