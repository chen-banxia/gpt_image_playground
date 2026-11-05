import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadImage } from './downloadImage'

describe('download tracking', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

  it.each([['gif', 'gif'], ['svg+xml', 'svg']])('downloads %s without converting file contents', async (subtype, extension) => {
    vi.useFakeTimers()
    const link = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
    vi.stubGlobal('document', { createElement: () => link, body: { appendChild: vi.fn() } })
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const base64 = subtype === 'gif' ? 'R0lGODlhAQABAIAAAAAAAP///yH/C05FVFNDQVBFMi4wAwEAAAAh+QQAFAAAACwAAAAAAQABAAACAkQBACH5BAAUAAAALAAAAAABAAEAAAICTAEAOw==' : btoa('<svg xmlns="http://www.w3.org/2000/svg"/>')
    await downloadImage(`data:image/${subtype};base64,${base64}`)
    expect(link.download).toMatch(new RegExp(`\\.${extension}$`))
    const blob = create.mock.calls[0][0] as Blob
    expect(blob.type).toBe(`image/${subtype}`)
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(Uint8Array.from(atob(base64), char => char.charCodeAt(0)))
  })

  it('marks only after the browser download is triggered and releases the object URL later', async () => {
    vi.useFakeTimers()
    const mark = vi.fn()
    const link = { href: '', download: '', click: vi.fn(() => expect(mark).not.toHaveBeenCalled()), remove: vi.fn() }
    vi.stubGlobal('document', { createElement: () => link, body: { appendChild: vi.fn() } })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const pending = downloadImage('data:image/jpeg;base64,aQ==', mark)
    // 本地预览图在 await 前已经触发点击，不依赖网络或异步 Blob 转换。
    expect(link.click).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
    await pending
    expect(mark).toHaveBeenCalledOnce()
    expect(link.download).toMatch(/\.jpg$/)
    expect(revoke).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(revoke).toHaveBeenCalledWith('blob:test')
  })

  it('does not mark failed image fetches', async () => {
    const mark = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('failure', { status: 500 }))
    await expect(downloadImage('url', mark)).rejects.toThrow()
    expect(mark).not.toHaveBeenCalled()
  })
})
