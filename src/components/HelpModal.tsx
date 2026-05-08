import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'

interface HelpModalProps {
  onClose: () => void
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < 640)
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < 640)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return isMobile
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200/70 bg-white/55 p-4 dark:border-white/[0.08] dark:bg-white/[0.03]">
      <h4 className="mb-3 text-sm font-semibold text-gray-800 dark:text-gray-100">{title}</h4>
      <div className="space-y-2 text-sm leading-6 text-gray-600 dark:text-gray-300">
        {children}
      </div>
    </section>
  )
}

function List({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-4">{children}</ul>
}

export default function HelpModal({ onClose }: HelpModalProps) {
  const isMobile = useIsMobile()
  useCloseOnEscape(true, onClose)

  return createPortal(
    <div
      data-no-drag-select
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-overlay-in" />
      <div
        className="relative z-10 flex max-h-[88vh] w-full max-w-4xl flex-col rounded-3xl border border-white/50 bg-white/95 p-5 shadow-2xl ring-1 ring-black/5 animate-modal-in dark:border-white/[0.08] dark:bg-gray-900/95 dark:ring-white/10 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 flex items-center justify-between gap-4">
          <h3 className="flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-gray-100">
            <svg className="h-5 w-5 text-blue-500" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <path d="M12 17h.01" />
            </svg>
            操作指南
          </h3>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            aria-label="关闭"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
          <div className="grid gap-4 md:grid-cols-2">
            <Section title="首次使用">
              <List>
                <li>点击右上角设置按钮，输入 API Key 后即可开始生成。</li>
                <li>API 地址和接口已由系统固定配置，页面不会要求填写 API URL。</li>
                <li>默认不会记住 API Key；需要刷新后继续使用时，可在设置中开启“记住 API Key”。</li>
              </List>
            </Section>

            <Section title="文本生成图片">
              <List>
                <li>在底部输入框写入提示词，点击发送按钮或按 Ctrl+Enter 提交。</li>
                <li>可在输入框上方调整尺寸、质量、格式、数量等参数。</li>
                <li>生成完成后，图片会出现在历史记录中，可打开详情查看实际参数。</li>
              </List>
            </Section>

            <Section title="参考图与编辑">
              <List>
                <li>可以通过选择文件、粘贴图片或拖拽图片添加参考图。</li>
                <li>添加参考图后提交，会进入图片编辑流程，让模型基于参考图生成结果。</li>
                <li>在历史记录中可将某次输出再次加入输入区，继续迭代编辑。</li>
              </List>
            </Section>

            <Section title="遮罩编辑">
              <List>
                <li>添加参考图后，可进入遮罩编辑，涂抹需要重绘的区域。</li>
                <li>遮罩会随当前任务一起提交；如果遮罩覆盖整张图，提交前会二次确认。</li>
                <li>遮罩任务完成后，当前遮罩会自动清理，避免误用于下一次生成。</li>
              </List>
            </Section>

            <Section title="历史记录管理">
              <List>
                <li>可搜索历史任务，也可以按状态或收藏筛选。</li>
                <li>打开任务详情后，可以收藏、删除、复用配置、继续编辑输出图。</li>
                <li>
                  {isMobile
                    ? '移动端在记录卡片上左右滑动，可选中或取消选中记录。'
                    : '桌面端可在空白处拖拽框选，也可按住 Ctrl 或 Command 点击卡片多选。'}
                </li>
                <li>选中多条记录后，底部会出现批量收藏、批量删除和全选当前可见记录。</li>
              </List>
            </Section>

            <Section title="数据保存与备份">
              <List>
                <li>浏览器关闭或刷新页面不会自动清空任务和图片，它们会保存在当前浏览器本地 IndexedDB。</li>
                <li>API Key 默认只保存在当前页面会话；开启“记住 API Key”后，才会保存到当前浏览器本地。</li>
                <li>导出的备份 zip 不包含 API Key，导入到新浏览器后需要重新输入 Key。</li>
                <li>清理浏览器站点数据、使用无痕模式、点击清空所有数据或删除记录，可能导致内容无法恢复。</li>
              </List>
            </Section>

            <Section title="关于与隐私">
              <List>
                <li>生成时会把提示词、参考图、遮罩和必要参数发送到系统配置的图片接口。</li>
                <li>除图片生成请求外，应用不会主动上传历史记录、备份文件或 API Key。</li>
                <li>页面使用本地存储保存任务数据；跨浏览器、跨设备不会自动同步。</li>
              </List>
            </Section>
          </div>
        </div>

        <div className="mt-5 border-t border-gray-200 pt-4 dark:border-white/[0.08]">
          <div className="flex flex-col items-center gap-1.5">
            <a
              href="https://aicodelink.top/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              Code Link
            </a>
            <span className="text-center text-[11px] text-gray-400 dark:text-gray-500">
              基于开源项目{' '}
              <a
                href="https://github.com/CookSleep/gpt_image_playground"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-gray-300 transition-colors hover:text-gray-600 dark:decoration-gray-600 dark:hover:text-gray-300"
              >
                GPT Image Playground
              </a>
              {' '}构建，感谢原作者的贡献
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
