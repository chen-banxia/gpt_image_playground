import CreationPanelHeader from './workspace/CreationPanelHeader'
import { useRef, useEffect, useLayoutEffect, useCallback, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore, submitTask, addImageFromFile } from '../store'
import { DEFAULT_PARAMS } from '../types'
import { getActiveApiProfile } from '../lib/apiProfiles'
import { IMAGE_MODEL_OPTIONS, isKnownImageModel, isGptImage25Model } from '../lib/imageModels'
import { DEFAULT_FAL_IMAGE_SIZE, getChangedParams, getOutputImageLimitForSettings, normalizeParamsForSettings } from '../lib/paramCompatibility'
import { normalizeImageSize } from '../lib/size'
import { createMaskPreviewDataUrl } from '../lib/canvasImage'
import { useT } from '../hooks/useI18n'
import Select from './Select'
import SizePickerModal from './SizePickerModal'

/** 气泡挂载到页面根部，避免被侧栏的独立滚动区域裁切。 */
function ButtonTooltip({ visible, text }: { visible: boolean; text: ReactNode }) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!visible) {
      setPosition(null)
      return
    }
    const updatePosition = () => {
      const anchor = anchorRef.current
      const tooltip = tooltipRef.current
      if (!anchor?.getClientRects().length || !tooltip) {
        setPosition(null)
        return
      }
      const rect = anchor.getBoundingClientRect()
      const { width, height } = tooltip.getBoundingClientRect()
      // 优先显示在控件上方，并为视口左右边缘预留间距。
      setPosition({
        left: Math.max(8, Math.min(rect.left + (rect.width - width) / 2, window.innerWidth - width - 8)),
        top: rect.top - height - 8 >= 8 ? rect.top - height - 8 : rect.bottom + 8,
      })
    }
    updatePosition()
    const observer = new ResizeObserver(updatePosition)
    if (anchorRef.current) observer.observe(anchorRef.current)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [visible, text])

  return (
    <>
      <span ref={anchorRef} aria-hidden="true" className="pointer-events-none absolute inset-0" />
      {visible && createPortal(
        <div ref={tooltipRef} role="tooltip"
          className="pointer-events-none fixed z-50 w-max max-w-[min(280px,calc(100vw-16px))] rounded-lg bg-gray-800 px-3 py-2 text-xs font-normal text-white shadow-lg"
          style={{ left: position?.left ?? 0, top: position?.top ?? 0, visibility: position ? 'visible' : 'hidden' }}>
          {text}
        </div>,
        document.body,
      )}
    </>
  )
}

/** API 支持的最大参考图数量 */
const API_MAX_IMAGES = 16

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

interface InputBarProps {
  collapsed: boolean
  onToggle: () => void
}

export default function InputBar({ collapsed, onToggle }: InputBarProps) {
  const t = useT()
  const prompt = useStore((s) => s.prompt)
  const setPrompt = useStore((s) => s.setPrompt)
  const inputImages = useStore((s) => s.inputImages)
  const removeInputImage = useStore((s) => s.removeInputImage)
  const clearInputImages = useStore((s) => s.clearInputImages)
  const params = useStore((s) => s.params)
  const setParams = useStore((s) => s.setParams)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const setShowSettings = useStore((s) => s.setShowSettings)
  const setLightboxImageId = useStore((s) => s.setLightboxImageId)
  const showToast = useStore((s) => s.showToast)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  const maskDraft = useStore((s) => s.maskDraft)
  const clearMaskDraft = useStore((s) => s.clearMaskDraft)
  const setMaskEditorImageId = useStore((s) => s.setMaskEditorImageId)
  const moveInputImage = useStore((s) => s.moveInputImage)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const imagesRef = useRef<HTMLDivElement>(null)
  const prevHeightRef = useRef(120)

  const [isDragging, setIsDragging] = useState(false)
  const [submitHover, setSubmitHover] = useState(false)
  const [attachHover, setAttachHover] = useState(false)
  const [compressionHintVisible, setCompressionHintVisible] = useState(false)
  const [moderationHintVisible, setModerationHintVisible] = useState(false)
  const [sizeHintVisible, setSizeHintVisible] = useState(false)
  const [qualityHintVisible, setQualityHintVisible] = useState(false)
  const [imageHintId, setImageHintId] = useState<string | null>(null)
  const [showSizePicker, setShowSizePicker] = useState(false)
  const [maskPreviewUrl, setMaskPreviewUrl] = useState('')
  const [imageDragIndex, setImageDragIndex] = useState<number | null>(null)
  const [imageDragOverIndex, setImageDragOverIndex] = useState<number | null>(null)
  const [touchDragPreview, setTouchDragPreview] = useState<{ src: string; x: number; y: number } | null>(null)
  const imageDragIndexRef = useRef<number | null>(null)
  const imageTouchDragRef = useRef({ index: null as number | null, startX: 0, startY: 0, moved: false })
  const imageDragOverIndexRef = useRef<number | null>(null)
  const imageDragPreviewRef = useRef<HTMLElement | null>(null)
  const suppressImageClickRef = useRef(false)
  const maskConflictNoticeShownRef = useRef(false)
  const compressionHintTimerRef = useRef<number | null>(null)
  const moderationHintTimerRef = useRef<number | null>(null)
  const sizeHintTimerRef = useRef<number | null>(null)
  const qualityHintTimerRef = useRef<number | null>(null)
  const imageHintTimerRef = useRef<number | null>(null)
  const nLimitHintTimerRef = useRef<number | null>(null)
  const [outputCompressionInput, setOutputCompressionInput] = useState(
    params.output_compression == null ? '' : String(params.output_compression),
  )
  const [nInput, setNInput] = useState(String(params.n))
  const [nInputFocused, setNInputFocused] = useState(false)
  const [nLimitHintVisible, setNLimitHintVisible] = useState(false)
  const dragCounter = useRef(0)
  const isMobile = useIsMobile()

  const canSubmit = prompt.trim() && settings.apiKey
  const activeProfile = getActiveApiProfile(settings)
  const activeProvider = activeProfile.provider
  const isFalProvider = activeProvider === 'fal'
  const activeModel = activeProfile.apiMode === 'responses' ? activeProfile.imageGenerationModel ?? '' : activeProfile.model
  // fal 的模型是 endpoint（来自 Provider 配置），不属于这里的画图模型列表
  const modelSelectDisabled = isFalProvider
  const modelOptions = [
    ...IMAGE_MODEL_OPTIONS.map((option) => ({
      label: option.value,
      value: option.value,
      description: t(option.descriptionKey),
    })),
    // 配置里手写/导入的模型也要出现在列表中，避免打开下拉就丢失当前值
    ...(activeModel && !isKnownImageModel(activeModel)
      ? [{ label: activeModel, value: activeModel }]
      : []),
  ]
  const moderationDisabled = isFalProvider
  const compressionDisabled = params.output_format === 'png' || isFalProvider
  const outputImageLimit = getOutputImageLimitForSettings(settings)
  const nLimitHintText = isFalProvider
    ? t('maxFalRequests', { count: outputImageLimit })
    : t('maxOpenAIRequests', { count: outputImageLimit })
  const displaySize = isFalProvider && params.size === 'auto'
    ? DEFAULT_FAL_IMAGE_SIZE
    : (params.size_fit === 'pad' || params.size_fit === 'cover' ? params.size : normalizeImageSize(params.size)) || DEFAULT_PARAMS.size
  const qualityOptions = isFalProvider
    ? [
        { label: 'low', value: 'low' },
        { label: 'medium', value: 'medium' },
        { label: 'high', value: 'high' },
      ]
    : [
        { label: 'auto', value: 'auto' },
        { label: 'low', value: 'low' },
        { label: 'medium', value: 'medium' },
        { label: 'high', value: 'high' },
        ...(isGptImage25Model(activeModel) ? [{ label: 'xhigh', value: 'xhigh' }, { label: 'max', value: 'max' }] : []),
      ]
  const atImageLimit = inputImages.length >= API_MAX_IMAGES
  const maskTargetImage = maskDraft
    ? inputImages.find((img) => img.id === maskDraft.targetImageId) ?? null
    : null
  const referenceImages = maskTargetImage
    ? inputImages.filter((img) => img.id !== maskTargetImage.id)
    : inputImages

  useEffect(() => {
    setOutputCompressionInput(
      params.output_compression == null ? '' : String(params.output_compression),
    )
  }, [params.output_compression])

  useEffect(() => {
    setNInput(String(params.n))
  }, [params.n])

  useEffect(() => {
    const normalizedParams = normalizeParamsForSettings(params, settings)
    const patch = getChangedParams(params, normalizedParams)
    if (Object.keys(patch).length) {
      setParams(patch)
    }
  }, [params, settings, setParams])

  useEffect(() => () => {
    if (compressionHintTimerRef.current != null) {
      window.clearTimeout(compressionHintTimerRef.current)
    }
    if (moderationHintTimerRef.current != null) {
      window.clearTimeout(moderationHintTimerRef.current)
    }
    if (qualityHintTimerRef.current != null) {
      window.clearTimeout(qualityHintTimerRef.current)
    }
    if (sizeHintTimerRef.current != null) {
      window.clearTimeout(sizeHintTimerRef.current)
    }
    if (imageHintTimerRef.current != null) {
      window.clearTimeout(imageHintTimerRef.current)
    }
    if (nLimitHintTimerRef.current != null) {
      window.clearTimeout(nLimitHintTimerRef.current)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!maskDraft || !maskTargetImage) {
      setMaskPreviewUrl('')
      return
    }

    createMaskPreviewDataUrl(maskTargetImage.dataUrl, maskDraft.maskDataUrl)
      .then((url) => {
        if (!cancelled) setMaskPreviewUrl(url)
      })
      .catch(() => {
        if (!cancelled) setMaskPreviewUrl('')
      })

    return () => {
      cancelled = true
    }
  }, [maskDraft, maskTargetImage?.id, maskTargetImage?.dataUrl])

  const commitOutputCompression = useCallback(() => {
    if (outputCompressionInput.trim() === '') {
      setOutputCompressionInput('')
      setParams({ output_compression: null })
      return
    }

    const nextValue = Number(outputCompressionInput)
    if (Number.isNaN(nextValue)) {
      setOutputCompressionInput(params.output_compression == null ? '' : String(params.output_compression))
      return
    }

    setOutputCompressionInput(String(nextValue))
    setParams({ output_compression: nextValue })
  }, [outputCompressionInput, params.output_compression, setParams])

  const commitN = useCallback(() => {
    setNLimitHintVisible(false)
    if (nLimitHintTimerRef.current != null) {
      window.clearTimeout(nLimitHintTimerRef.current)
      nLimitHintTimerRef.current = null
    }
    const nextValue = Number(nInput)
    const normalizedValue =
      nInput.trim() === '' ? DEFAULT_PARAMS.n : Number.isNaN(nextValue) ? params.n : nextValue
    const clampedValue = Math.min(outputImageLimit, Math.max(1, normalizedValue))
    setNInput(String(clampedValue))
    setParams({ n: clampedValue })
  }, [nInput, outputImageLimit, params.n, setParams])

  const showNLimitHint = useCallback(() => {
    setNLimitHintVisible(true)
    if (nLimitHintTimerRef.current != null) {
      window.clearTimeout(nLimitHintTimerRef.current)
    }
    nLimitHintTimerRef.current = window.setTimeout(() => {
      setNLimitHintVisible(false)
      nLimitHintTimerRef.current = null
    }, 2000)
  }, [])

  const hideNLimitHint = useCallback(() => {
    setNLimitHintVisible(false)
    if (nLimitHintTimerRef.current != null) {
      window.clearTimeout(nLimitHintTimerRef.current)
      nLimitHintTimerRef.current = null
    }
  }, [])

  const handleNInputChange = useCallback((value: string) => {
    setNInput(value)
    const nextValue = Number(value)
    if (!Number.isNaN(nextValue) && nextValue > outputImageLimit) {
      showNLimitHint()
    } else {
      hideNLimitHint()
    }
  }, [hideNLimitHint, outputImageLimit, showNLimitHint])

  const handleNLimitIncreaseAttempt = useCallback((preventDefault: () => void) => {
    const currentValue = Number(nInput)
    const effectiveValue = Number.isNaN(currentValue) ? params.n : currentValue
    if (!nInputFocused || effectiveValue < outputImageLimit) return

    preventDefault()
    showNLimitHint()
  }, [nInput, nInputFocused, outputImageLimit, params.n, showNLimitHint])

  const showModerationHint = () => {
    if (moderationDisabled) setModerationHintVisible(true)
  }

  const hideModerationHint = () => {
    setModerationHintVisible(false)
    clearModerationHintTimer()
  }

  const clearModerationHintTimer = () => {
    if (moderationHintTimerRef.current != null) {
      window.clearTimeout(moderationHintTimerRef.current)
      moderationHintTimerRef.current = null
    }
  }

  const startModerationHintTouch = () => {
    if (!moderationDisabled) return
    moderationHintTimerRef.current = window.setTimeout(() => {
      setModerationHintVisible(true)
      moderationHintTimerRef.current = null
    }, 450)
  }

  const showCompressionHint = () => setCompressionHintVisible(true)

  const hideCompressionHint = () => {
    setCompressionHintVisible(false)
    clearCompressionHintTimer()
  }

  const clearCompressionHintTimer = () => {
    if (compressionHintTimerRef.current != null) {
      window.clearTimeout(compressionHintTimerRef.current)
      compressionHintTimerRef.current = null
    }
  }

  const startCompressionHintTouch = () => {
    compressionHintTimerRef.current = window.setTimeout(() => {
      setCompressionHintVisible(true)
      compressionHintTimerRef.current = null
    }, 450)
  }

  const showQualityHint = () => {
    if (isFalProvider) setQualityHintVisible(true)
  }

  const showSizeHint = () => {
    if (isFalProvider) setSizeHintVisible(true)
  }

  const hideSizeHint = () => {
    setSizeHintVisible(false)
    clearSizeHintTimer()
  }

  const clearSizeHintTimer = () => {
    if (sizeHintTimerRef.current != null) {
      window.clearTimeout(sizeHintTimerRef.current)
      sizeHintTimerRef.current = null
    }
  }

  const startSizeHintTouch = () => {
    if (!isFalProvider) return
    sizeHintTimerRef.current = window.setTimeout(() => {
      setSizeHintVisible(true)
      sizeHintTimerRef.current = null
    }, 450)
  }

  const hideQualityHint = () => {
    setQualityHintVisible(false)
    clearQualityHintTimer()
  }

  const clearQualityHintTimer = () => {
    if (qualityHintTimerRef.current != null) {
      window.clearTimeout(qualityHintTimerRef.current)
      qualityHintTimerRef.current = null
    }
  }

  const startQualityHintTouch = () => {
    if (!isFalProvider) return
    qualityHintTimerRef.current = window.setTimeout(() => {
      setQualityHintVisible(true)
      qualityHintTimerRef.current = null
    }, 450)
  }

  const clearImageHintTimer = () => {
    if (imageHintTimerRef.current != null) {
      window.clearTimeout(imageHintTimerRef.current)
      imageHintTimerRef.current = null
    }
  }

  const showImageHint = (id: string) => setImageHintId(id)

  const hideImageHint = () => {
    setImageHintId(null)
    clearImageHintTimer()
  }

  const startImageHintTouch = (id: string) => {
    clearImageHintTimer()
    imageHintTimerRef.current = window.setTimeout(() => {
      setImageHintId(id)
      imageHintTimerRef.current = null
    }, 450)
  }

  const handleFiles = async (files: FileList | File[]) => {
    try {
      const currentCount = useStore.getState().inputImages.length
      if (currentCount >= API_MAX_IMAGES) {
        useStore.getState().showToast(
          t('imageLimitReachedToast', { count: API_MAX_IMAGES }),
          'error',
        )
        return
      }

      const remaining = API_MAX_IMAGES - currentCount
      const accepted = Array.from(files).filter((f) => f.type.startsWith('image/'))
      const toAdd = accepted.slice(0, remaining)
      const discarded = accepted.length - toAdd.length

      for (const file of toAdd) {
        await addImageFromFile(file)
      }

      if (discarded > 0) {
        useStore.getState().showToast(
          t('imageLimitDiscarded', { limit: API_MAX_IMAGES, discarded }),
          'error',
        )
      }
    } catch (err) {
      useStore.getState().showToast(
        t('imageAddFailed', { message: err instanceof Error ? err.message : String(err) }),
        'error',
      )
    }
  }

  const handleFilesRef = useRef(handleFiles)
  handleFilesRef.current = handleFiles

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await handleFilesRef.current(e.target.files || [])
    e.target.value = ''
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      submitTask()
    }
  }

  // 粘贴图片
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      const imageFiles: File[] = []
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) imageFiles.push(file)
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault()
        handleFilesRef.current(imageFiles)
      }
    }
    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  // 拖拽图片 - 监听整个页面
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current++
      if (e.dataTransfer?.types.includes('Files')) {
        setIsDragging(true)
      }
    }

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current--
      if (dragCounter.current === 0) {
        setIsDragging(false)
      }
    }

    const handleDrop = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = 0
      setIsDragging(false)
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        handleFilesRef.current(files)
      }
    }

    document.addEventListener('dragenter', handleDragEnter)
    document.addEventListener('dragover', handleDragOver)
    document.addEventListener('dragleave', handleDragLeave)
    document.addEventListener('drop', handleDrop)

    return () => {
      document.removeEventListener('dragenter', handleDragEnter)
      document.removeEventListener('dragover', handleDragOver)
      document.removeEventListener('dragleave', handleDragLeave)
      document.removeEventListener('drop', handleDrop)
    }
  }, [])

  const adjustTextareaHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el || !el.getClientRects().length) return

    const maxH = Math.max(120, Math.min(window.innerHeight * 0.35, 320))

    // 1. 关闭过渡动画，设高度为 0 以获取真实的文本内容高度
    el.style.transition = 'none'
    el.style.height = '0'
    el.style.overflowY = 'hidden'
    const scrollH = el.scrollHeight
    const minH = 120
    const desired = Math.max(scrollH, minH)
    const targetH = desired > maxH ? maxH : desired

    // 2. 将高度设回上一次的实际高度，强制重绘，准备开始动画
    el.style.height = prevHeightRef.current + 'px'
    void el.offsetHeight

    // 3. 恢复平滑过渡，并设置目标高度
    el.style.transition = 'height 150ms ease, border-color 200ms, box-shadow 200ms'
    el.style.height = targetH + 'px'
    el.style.overflowY = desired > maxH ? 'auto' : 'hidden'

    prevHeightRef.current = targetH
  }, [])

  useEffect(() => {
    if (!collapsed) adjustTextareaHeight()
  }, [prompt, collapsed, adjustTextareaHeight])

  // 图片队列变化时也重新计算
  useEffect(() => {
    adjustTextareaHeight()
  }, [inputImages.length, Boolean(maskDraft), maskPreviewUrl, adjustTextareaHeight])

  useEffect(() => {
    window.addEventListener('resize', adjustTextareaHeight)
    return () => window.removeEventListener('resize', adjustTextareaHeight)
  }, [adjustTextareaHeight])

  const selectClass = 'px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] text-xs transition-all duration-200 shadow-sm'

  const getTouchDropIndex = (touch: React.Touch) => {
    const target = document
      .elementFromPoint(touch.clientX, touch.clientY)
      ?.closest<HTMLElement>('[data-input-image-index]')
    if (!target) return null
    const idx = Number(target.dataset.inputImageIndex)
    if (!Number.isInteger(idx)) return null
    const rect = target.getBoundingClientRect()
    return touch.clientX < rect.left + rect.width / 2 ? idx : idx + 1
  }

  const normalizeImageDropIndex = (idx: number) => {
    const minIdx = maskTargetImage ? 1 : 0
    return Math.max(minIdx, Math.min(inputImages.length, idx))
  }

  const isBeforeMaskDropArea = (clientX: number) => {
    if (!maskTargetImage) return false
    const maskEl = document.querySelector<HTMLElement>('[data-input-image-index="0"]')
    if (!maskEl) return false
    const rect = maskEl.getBoundingClientRect()
    return clientX < rect.left + rect.width / 2
  }

  const resetImageDrag = () => {
    setImageDragIndex(null)
    setImageDragOverIndex(null)
    imageDragIndexRef.current = null
    imageDragOverIndexRef.current = null
    imageTouchDragRef.current = { index: null, startX: 0, startY: 0, moved: false }
    setTouchDragPreview(null)
    imageDragPreviewRef.current?.remove()
    imageDragPreviewRef.current = null
    hideImageHint()
  }

  useEffect(() => {
    if (!touchDragPreview) return
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [touchDragPreview])

  const getDataTransferDragIndex = (e: React.DragEvent) => {
    const value = e.dataTransfer.getData('text/plain')
    const idx = Number(value)
    return Number.isInteger(idx) ? idx : null
  }

  const setImageDragTarget = (idx: number | null, clientX?: number) => {
    const fromIdx = imageDragIndexRef.current
    if (fromIdx !== null && maskTargetImage && (idx === 0 || (clientX != null && isBeforeMaskDropArea(clientX)))) {
      showImageHint(maskTargetImage.id)
      imageDragOverIndexRef.current = null
      setImageDragOverIndex(null)
      return
    }

    if (fromIdx !== null) hideImageHint()
    const normalizedIdx = idx == null ? null : normalizeImageDropIndex(idx)
    const isNoopTarget = fromIdx !== null && normalizedIdx !== null && (normalizedIdx === fromIdx || normalizedIdx === fromIdx + 1)
    const nextIdx = isNoopTarget ? null : normalizedIdx
    imageDragOverIndexRef.current = nextIdx
    setImageDragOverIndex(nextIdx)
  }

  const renderImageThumb = (img: (typeof inputImages)[number], idx: number) => {
    const isMaskTarget = maskDraft?.targetImageId === img.id
    const canEdit = !maskTargetImage || isMaskTarget
    const imageHintText = isMaskTarget
    ? t('maskImageMustBeFirst')
      : maskTargetImage
        ? t('onlyOneMaskImage')
        : ''
    const displaySrc = isMaskTarget && maskPreviewUrl ? maskPreviewUrl : img.dataUrl
    const isImageDragging = imageDragIndex === idx
    const isLast = idx === inputImages.length - 1
    const showDropBefore = imageDragOverIndex === idx && imageDragIndex !== idx
    const showDropAfter = imageDragOverIndex === inputImages.length && isLast && imageDragIndex !== idx

    const handleDragStart = (e: React.DragEvent) => {
      if (isMaskTarget) {
        e.preventDefault()
        return
      }
      hideImageHint()
      imageDragIndexRef.current = idx
      setImageDragIndex(idx)
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', String(idx))
      const preview = document.createElement('div')
      preview.style.cssText = 'position:fixed;left:-1000px;top:-1000px;width:52px;height:52px;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.25);'
      const previewImg = document.createElement('img')
      previewImg.src = displaySrc
      previewImg.style.cssText = 'width:52px;height:52px;object-fit:cover;display:block;'
      preview.appendChild(previewImg)
      document.body.appendChild(preview)
      imageDragPreviewRef.current = preview
      e.dataTransfer.setDragImage(preview, 26, 26)
    }

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      const fromIdx = imageDragIndexRef.current
      if (fromIdx === null || fromIdx === idx) return
      const rect = e.currentTarget.getBoundingClientRect()
      setImageDragTarget(e.clientX < rect.left + rect.width / 2 ? idx : idx + 1, e.clientX)
    }

    const handleDrop = (e: React.DragEvent) => {
      e.preventDefault()
      const fromIdx = imageDragIndexRef.current ?? getDataTransferDragIndex(e)
      const toIdx = imageDragOverIndexRef.current
      if (fromIdx !== null && toIdx !== null) {
        moveInputImage(fromIdx, toIdx)
      }
      resetImageDrag()
    }

    const handleTouchStart = (e: React.TouchEvent) => {
      if (isMaskTarget) {
        startImageHintTouch(img.id)
        return
      }
      const touch = e.touches[0]
      imageDragIndexRef.current = idx
      imageTouchDragRef.current = { index: idx, startX: touch.clientX, startY: touch.clientY, moved: false }
      setTouchDragPreview(null)
    }

    const handleTouchMove = (e: React.TouchEvent) => {
      const touch = e.touches[0]
      const touchDrag = imageTouchDragRef.current
      if (touchDrag.index === null) return

      touchDrag.moved = true
      clearImageHintTimer()
      setImageHintId(null)
      suppressImageClickRef.current = true
      e.preventDefault()
      setImageDragIndex(touchDrag.index)
      setTouchDragPreview({ src: displaySrc, x: touch.clientX, y: touch.clientY })
      const dropIndex = getTouchDropIndex(touch)
      setImageDragTarget(dropIndex, touch.clientX)
    }

    const handleTouchEnd = (e: React.TouchEvent) => {
      const touchDrag = imageTouchDragRef.current
      clearImageHintTimer()
      if (touchDrag.index !== null && imageDragOverIndexRef.current !== null) {
        e.preventDefault()
        moveInputImage(touchDrag.index, imageDragOverIndexRef.current)
        window.setTimeout(() => {
          suppressImageClickRef.current = false
        }, 0)
      }
      resetImageDrag()
    }

    const handleTouchCancel = () => {
      suppressImageClickRef.current = false
      hideImageHint()
      resetImageDrag()
    }

    return (
      <div
        key={img.id}
        data-input-image-index={idx}
        className={`relative group inline-block shrink-0 transition-opacity ${isImageDragging ? 'opacity-40' : ''}`}
        style={{ touchAction: isMaskTarget ? 'auto' : 'none' }}
        draggable={!isMobile && !isMaskTarget}
        onMouseEnter={() => imageHintText && (!isMobile || isMaskTarget) && showImageHint(img.id)}
        onMouseLeave={hideImageHint}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onDragEnd={resetImageDrag}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
      >
        <ButtonTooltip
          visible={imageHintId === img.id && Boolean(imageHintText) && (!isMobile || isMaskTarget)}
          text={imageHintText}
        />
        {showDropBefore && (
          <div className="absolute -left-[5px] top-0 bottom-0 w-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
        )}
        {showDropAfter && (
          <div className="absolute -right-[5px] top-0 bottom-0 w-[2px] bg-blue-500 rounded-full z-40 shadow-sm pointer-events-none" />
        )}
        <div
          className={`relative w-[52px] h-[52px] rounded-xl overflow-hidden shadow-sm cursor-grab active:cursor-grabbing select-none ${
            isMaskTarget
              ? 'border-2 border-blue-500'
              : 'border border-gray-200 dark:border-white/[0.08]'
          }`}
          onClick={() => {
            if (suppressImageClickRef.current) return
            if (isMaskTarget) {
              setMaskEditorImageId(img.id)
              return
            }
            if (isMobile && maskTargetImage && !maskConflictNoticeShownRef.current) {
              maskConflictNoticeShownRef.current = true
              showToast(t('onlyOneMaskImage'), 'info')
            }
            setLightboxImageId(img.id, inputImages.map((i) => i.id))
          }}
        >
          {displaySrc && (
            <img
              src={displaySrc}
              className="w-full h-full object-cover hover:opacity-90 transition-opacity pointer-events-none"
              alt=""
            />
          )}
          {isMaskTarget && (
            <span className="absolute left-1 top-1 rounded bg-blue-500/90 px-1.5 py-0.5 text-[8px] leading-none text-white font-bold tracking-wider backdrop-blur-sm z-10 pointer-events-none">
              MASK
            </span>
          )}
          {canEdit && (
            <button 
              className="absolute inset-0 w-full h-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer z-20 focus:outline-none border-none"
              onClick={(e) => {
                e.stopPropagation()
                setMaskEditorImageId(img.id)
              }}
              title={isMaskTarget ? t('editMask') : t('addMask')}
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          )}
        </div>
        {!isMaskTarget && (
          <span
            className="absolute -top-2 -right-2 w-[22px] h-[22px] rounded-full bg-red-500 text-white flex items-center justify-center cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-red-600 z-30"
            onClick={(e) => {
              e.stopPropagation()
              removeInputImage(idx)
            }}
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </span>
        )}
      </div>
    )
  }

  const renderClearAllButton = () => (
    <button
      onClick={() =>
        setConfirmDialog({
      title: maskTargetImage ? t('clearMaskInputsTitle') : t('clearReferenceImagesTitle'),
      message: maskTargetImage
            ? t('clearMaskInputsMessage', { count: referenceImages.length })
            : t('clearReferenceImagesMessage', { count: inputImages.length }),
          action: () => clearInputImages(),
        })
      }
      className="w-[52px] h-[52px] rounded-xl border border-dashed border-gray-300 dark:border-white/[0.08] flex flex-col items-center justify-center gap-0.5 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:border-red-300 hover:bg-red-50/50 dark:hover:bg-red-950/30 transition-all cursor-pointer flex-shrink-0"
      title={maskTargetImage ? t('clearMaskInputsTitle') : t('clearReferenceImagesTitle')}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
      </svg>
      <span className="text-[8px] leading-none">{maskTargetImage ? t('clearAllInputs') : t('clearReferenceImages')}</span>
    </button>
  )

  const renderImageThumbs = () => {
    return (
      <div ref={imagesRef}>
        <div className="grid grid-cols-[repeat(auto-fill,52px)] justify-between gap-x-2 gap-y-3 mb-3">
          {inputImages.map((img, idx) => renderImageThumb(img, idx))}
          {renderClearAllButton()}
        </div>
        {touchDragPreview?.src && createPortal(
          <div
            className="fixed z-[140] h-[52px] w-[52px] overflow-hidden rounded-xl shadow-xl pointer-events-none opacity-90"
            style={{ left: touchDragPreview.x, top: touchDragPreview.y, transform: 'translate(-50%, -50%)' }}
          >
            <img src={touchDragPreview.src} className="h-full w-full object-cover" alt="" />
          </div>,
          document.body,
        )}
      </div>
    )
  }

  const renderParams = (cols: string, modelCellClass = '') => (
    <div className={`grid ${cols} gap-2 text-xs flex-1`}>
      <label className={`relative flex flex-col gap-0.5 min-w-0 ${modelCellClass}`}>
        <span className="text-gray-400 dark:text-gray-500 ml-1">{t(activeProfile.apiMode === 'responses' ? 'responseImageModel' : 'model')}</span>
        <Select portal
          value={activeModel}
          onChange={(val) => setSettings(activeProfile.apiMode === 'responses' ? { imageGenerationModel: val as string } : { model: val as string })}
          options={modelOptions}
          disabled={modelSelectDisabled}
          title={modelSelectDisabled ? t('falModelFromProfile') : t('chooseModel')}
          menuClassName="w-full"
          className={modelSelectDisabled
            ? 'px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-gray-100/50 dark:bg-white/[0.05] opacity-50 cursor-not-allowed text-[11px] transition-all duration-200 shadow-sm'
            : `${selectClass} !text-[11px]`}
        />
      </label>
      <label
        className="relative flex flex-col gap-0.5 min-w-0"
        onMouseEnter={showSizeHint}
        onMouseLeave={hideSizeHint}
        onTouchStart={startSizeHintTouch}
        onTouchEnd={clearSizeHintTimer}
        onTouchCancel={hideSizeHint}
        onClick={showSizeHint}
      >
        <span className="text-gray-400 dark:text-gray-500 ml-1">{t('size')}</span>
        <button
          type="button"
          onClick={() => setShowSizePicker(true)}
          className="px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] hover:bg-white dark:hover:bg-white/[0.06] focus:outline-none text-xs text-left transition-all duration-200 shadow-sm font-mono truncate"
          title={t('parametersBestEffort')}
        >
          {displaySize}
        </button>
        {displaySize !== 'auto' && (
          <span className="ml-1 text-[10px] text-gray-500 dark:text-gray-400">
            {t(params.size_fit === 'pad' ? 'sizeFitPad' : params.size_fit === 'cover' ? 'sizeFitCover' : 'sizeFitNone')}
          </span>
        )}
        <ButtonTooltip
          visible={isFalProvider && sizeHintVisible}
          text={t('falNoAutoParam')}
        />
      </label>
      <label
        className="relative flex flex-col gap-0.5 min-w-0"
        onMouseEnter={showQualityHint}
        onMouseLeave={hideQualityHint}
        onTouchStart={startQualityHintTouch}
        onTouchEnd={clearQualityHintTimer}
        onTouchCancel={hideQualityHint}
        onClick={showQualityHint}
      >
        <span className="text-gray-400 dark:text-gray-500 ml-1">{t('quality')}</span>
        <Select portal
          value={isFalProvider && params.quality === 'auto' ? 'high' : params.quality}
          onChange={(val) => setParams({ quality: val as any })}
          options={qualityOptions}
          className={selectClass}
        />
        <ButtonTooltip
          visible={isFalProvider && qualityHintVisible}
          text={t('falNoAutoParam')}
        />
      </label>
      <label className="flex flex-col gap-0.5 min-w-0">
        <span className="text-gray-400 dark:text-gray-500 ml-1">{t('format')}</span>
        <Select portal
          value={params.output_format}
          onChange={(val) => setParams({ output_format: val as typeof params.output_format, ...(val === 'jpeg' ? { transparent_output: false } : {}) })}
          options={[
            { label: 'PNG', value: 'png' },
            { label: 'JPEG', value: 'jpeg' },
            { label: 'WebP', value: 'webp' },
          ]}
          className={selectClass}
        />
      </label>
      <label
        className="relative flex flex-col gap-0.5 min-w-0"
        onMouseEnter={showCompressionHint}
        onMouseLeave={hideCompressionHint}
        onTouchStart={startCompressionHintTouch}
        onTouchEnd={clearCompressionHintTimer}
        onTouchCancel={hideCompressionHint}
        onClick={showCompressionHint}
      >
        <span className="text-gray-400 dark:text-gray-500 ml-1">{t('compression')}</span>
        <input
          value={outputCompressionInput}
          onChange={(e) => setOutputCompressionInput(e.target.value)}
          onBlur={commitOutputCompression}
          disabled={compressionDisabled}
          type="number"
          min={0}
          max={100}
          placeholder="0-100"
          className={`px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] focus:outline-none text-xs transition-all duration-200 shadow-sm ${
            compressionDisabled
              ? 'bg-gray-100/50 dark:bg-white/[0.05] opacity-50 cursor-not-allowed'
              : 'bg-white/50 dark:bg-white/[0.03]'
            }`}
        />
        <ButtonTooltip
          visible={compressionHintVisible}
          text={isFalProvider ? t('falNoCompression') : t('compressionOnlyJpegWebp')}
        />
      </label>
      <label
        className="relative flex flex-col gap-0.5 min-w-0"
        onMouseEnter={showModerationHint}
        onMouseLeave={hideModerationHint}
        onTouchStart={startModerationHintTouch}
        onTouchEnd={clearModerationHintTimer}
        onTouchCancel={hideModerationHint}
        onClick={showModerationHint}
      >
        <span className="text-gray-400 dark:text-gray-500 ml-1">{t('moderation')}</span>
        <Select portal
          value={moderationDisabled ? 'auto' : params.moderation}
          onChange={(val) => {
            if (!moderationDisabled) setParams({ moderation: val as any })
          }}
          options={[
            { label: 'auto', value: 'auto' },
            { label: 'low', value: 'low' },
          ]}
          disabled={moderationDisabled}
          className={moderationDisabled
            ? 'px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-gray-100/50 dark:bg-white/[0.05] opacity-50 cursor-not-allowed text-xs transition-all duration-200 shadow-sm'
            : selectClass}
        />
        <ButtonTooltip
          visible={moderationDisabled && moderationHintVisible}
          text={isFalProvider ? t('falNoModeration') : t('responsesNoModeration')}
        />
      </label>
      <label className="flex flex-col gap-0.5 min-w-0" title={t('transparentHint')}>
        <span className="text-gray-400 dark:text-gray-500 ml-1">{t('transparentBackground')}</span>
        <Select portal
          value={params.transparent_output ? params.transparent_method ?? 'native' : 'off'}
          onChange={(value) => setParams({
            transparent_output: value !== 'off',
            transparent_method: value === 'local' ? 'local' : 'native',
            ...(value !== 'off' && params.output_format === 'jpeg' ? { output_format: 'png', output_compression: null } : {}),
          })}
          options={[
            { label: t('backgroundDefault'), value: 'off' },
            { label: t('backgroundNative'), value: 'native' },
            { label: t('backgroundLocal'), value: 'local' },
          ]}
          className={selectClass}
        />
      </label>
      <label className="flex flex-col gap-0.5 min-w-0" title={t('streamPreviewHint')}>
        <span className="text-gray-400 dark:text-gray-500 ml-1">{t('streamPreview')}</span>
        <Select portal value={params.stream && !isFalProvider ? 'on' : 'off'}
          onChange={(value) => setParams({ stream: value === 'on' })}
          disabled={isFalProvider}
          options={[{ label: t('disabled'), value: 'off' }, { label: t('enabled'), value: 'on' }]}
          className={selectClass}
        />
      </label>
      <label className="relative flex flex-col gap-0.5 min-w-0">
        <span className="text-gray-400 dark:text-gray-500 ml-1">{t('count')}</span>
        <input
          value={nInput}
          onChange={(e) => handleNInputChange(e.target.value)}
          onFocus={() => setNInputFocused(true)}
          onBlur={() => {
            setNInputFocused(false)
            commitN()
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp') {
              handleNLimitIncreaseAttempt(() => e.preventDefault())
            }
          }}
          onWheel={(e) => {
            if (e.deltaY < 0) {
              handleNLimitIncreaseAttempt(() => e.preventDefault())
            }
          }}
          type="number"
          min={1}
          max={outputImageLimit}
          className="px-3 py-1.5 rounded-xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] focus:outline-none text-xs transition-all duration-200 shadow-sm"
        />
        <ButtonTooltip visible={nLimitHintVisible} text={nLimitHintText} />
      </label>
    </div>
  )

  return (
    <>
      {/* 全屏拖拽遮罩 */}
      {isDragging && (
        <div className="fixed inset-0 z-[100] bg-white/60 dark:bg-gray-900/60 backdrop-blur-md flex flex-col items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center gap-4 p-8 rounded-3xl">
            <div className={`w-20 h-20 rounded-full border-2 border-dashed flex items-center justify-center ${
              atImageLimit ? 'bg-red-50 dark:bg-red-500/10 border-red-300' : 'bg-blue-50 dark:bg-blue-500/10 border-blue-400'
            }`}>
              {atImageLimit ? (
                <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              ) : (
                <svg className="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              )}
            </div>
            <div className="text-center">
              {atImageLimit ? (
                <>
                  <p className="text-lg font-semibold text-red-500">{t('imageLimitReached', { count: API_MAX_IMAGES })}</p>
                  <p className="text-sm text-gray-400 mt-1">{t('removeReferenceFirst')}</p>
                </>
              ) : (
                <>
                  <p className="text-lg font-semibold text-gray-700 dark:text-gray-200">{t('releaseToAddReference')}</p>
                  <p className="text-sm text-gray-400 mt-1">{t('supportedImageFormats')}</p>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showSizePicker && (
        <SizePickerModal
          currentSize={isFalProvider && params.size === 'auto' ? DEFAULT_FAL_IMAGE_SIZE : params.size}
          currentFit={params.size_fit}
          onSelect={(size, size_fit) => setParams({ size, size_fit })}
          onClose={() => setShowSizePicker(false)}
          allowAuto={!isFalProvider}
        />
      )}

      <aside data-input-bar aria-label={t('generationPanel')} className="generation-sidebar">
        <div className="generation-panel bg-white/90 dark:bg-gray-900/90 border border-gray-200/80 dark:border-white/[0.08] shadow-lg rounded-2xl">
          <CreationPanelHeader title={t('workspaceImageCreation')} collapsed={collapsed} controls="generation-panel-content" onToggle={onToggle} />
          {/* 仅隐藏内容而不卸载，保留输入草稿、参数编辑状态和参考图。 */}
          <div id="generation-panel-content" className="generation-panel-body" hidden={collapsed}>
            {inputImages.length > 0 && renderImageThumbs()}

            {/* 输入框 */}
            <textarea
              ref={textareaRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={4}
              aria-label={t('promptPlaceholder')}
              placeholder={t('promptPlaceholder')}
              className="w-full px-4 py-3 rounded-2xl border border-gray-200/60 dark:border-white/[0.08] bg-white/50 dark:bg-white/[0.03] text-sm focus:outline-none leading-relaxed resize-none shadow-sm transition-[border-color,box-shadow] duration-200"
            />

            <div className="mt-4 flex flex-col gap-4">
              {renderParams('grid-cols-2', 'col-span-2')}
              <div className="flex items-center gap-2">
                <div
                  className="relative"
                  onMouseEnter={() => setAttachHover(true)}
                  onMouseLeave={() => setAttachHover(false)}
                >
                  <ButtonTooltip visible={atImageLimit && attachHover} text={t('imageLimitReachedToast', { count: API_MAX_IMAGES })} />
                  <button
                    onClick={() => !atImageLimit && fileInputRef.current?.click()}
                    className={`p-2.5 rounded-xl transition-all shadow-sm flex-shrink-0 ${
                      atImageLimit
                        ? 'bg-gray-200 dark:bg-white/[0.04] text-gray-300 dark:text-gray-500 cursor-not-allowed'
                        : 'bg-gray-200 dark:bg-white/[0.06] hover:bg-gray-300 dark:hover:bg-white/[0.1] text-gray-500 dark:text-gray-300'
                    }`}
                    title={atImageLimit ? t('imageLimitReached', { count: API_MAX_IMAGES }) : t('addReferenceImage')}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                    </svg>
                  </button>
                </div>
                <div
                  className="relative flex-1"
                  onMouseEnter={() => setSubmitHover(true)}
                  onMouseLeave={() => setSubmitHover(false)}
                >
                  <ButtonTooltip visible={!settings.apiKey && submitHover} text={t('configureApiFirstTooltip')} />
                  <button
                    onClick={() => settings.apiKey ? submitTask() : setShowSettings(true)}
                    disabled={settings.apiKey ? !canSubmit : false}
                    className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all shadow-sm ${
                      !settings.apiKey
                        ? 'bg-gray-300 dark:bg-white/[0.06] text-white cursor-pointer'
                        : 'bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-300 dark:disabled:bg-white/[0.04] disabled:opacity-50 disabled:cursor-not-allowed'
                    }`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>
                    {maskDraft ? t('editMask') : t('generateImage')}
                  </button>
                </div>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
        </div>
      </aside>
    </>
  )
}
