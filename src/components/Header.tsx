import { useState } from 'react'
import { useStore } from '../store'
import { useVersionCheck } from '../hooks/useVersionCheck'
import HelpModal from './HelpModal'

export default function Header() {
  const setShowSettings = useStore((s) => s.setShowSettings)
  const { hasUpdate, latestRelease, dismiss } = useVersionCheck()
  const [showHelp, setShowHelp] = useState(false)

  return (
    <header data-no-drag-select className="safe-area-top sticky top-0 z-40 bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-200 dark:border-white/[0.08]">
      <div className="safe-area-x safe-header-inner max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex flex-shrink-0 items-start gap-1">
            <h1 className="text-lg font-bold tracking-tight">
              <a
                href="https://aicodelink.top/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-800 transition-colors hover:text-gray-600 dark:text-gray-100 dark:hover:text-gray-300"
              >
                Code Link
              </a>
            </h1>
            {hasUpdate && latestRelease && (
              <a
                href={latestRelease.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={dismiss}
                className="mt-0.5 rounded border border-red-500/30 bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white transition-colors hover:bg-red-600 animate-fade-in"
                title={`新版本 ${latestRelease.tag}`}
              >
                NEW
              </a>
            )}
          </div>
          <a
            href="https://aicodelink.top"
            target="_blank"
            rel="noopener noreferrer"
            title="Code Link，一家稳定的大模型中转站，支持claude、gpt、gemini等，国内直连，稳定快速。"
            className="group hidden min-w-0 items-center gap-1.5 rounded-full border border-blue-200/70 bg-blue-50/80 px-2.5 py-1 text-xs text-gray-600 shadow-sm shadow-blue-900/5 transition hover:border-blue-300 hover:bg-blue-100/80 hover:text-gray-800 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-gray-300 dark:hover:bg-blue-400/15 dark:hover:text-gray-100 sm:inline-flex"
          >
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.16)]" />
            <span className="hidden font-medium text-blue-700 dark:text-blue-300 md:inline">大模型中转站</span>
            <span className="max-w-[32rem] truncate">
              支持 claude / gpt / gemini，国内直连，稳定快速
            </span>
            <svg className="h-3.5 w-3.5 flex-shrink-0 text-blue-500 transition-transform group-hover:translate-x-0.5 dark:text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M9 7h8v8" />
            </svg>
          </a>
          <a
            href="https://aicodelink.top"
            target="_blank"
            rel="noopener noreferrer"
            title="Code Link，一家稳定的大模型中转站，支持claude、gpt、gemini等，国内直连，稳定快速。"
            className="inline-flex flex-shrink-0 items-center rounded-full border border-blue-200/70 bg-blue-50/80 px-2 py-1 text-[11px] font-medium text-blue-700 transition hover:bg-blue-100 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-300 dark:hover:bg-blue-400/15 sm:hidden"
          >
            中转站
          </a>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowHelp(true)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
            title="操作指南"
          >
            <svg
              className="w-5 h-5 text-gray-600 dark:text-gray-400"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <path d="M12 17h.01" />
            </svg>
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
            title="设置"
          >
            <svg
              className="w-5 h-5 text-gray-600 dark:text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
      </div>
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </header>
  )
}
