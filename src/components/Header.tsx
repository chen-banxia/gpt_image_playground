import { useState } from 'react'
import { useStore } from '../store'
import { useVersionCheck } from '../hooks/useVersionCheck'
import { useLanguage, useT } from '../hooks/useI18n'
import HelpModal from './HelpModal'

export default function Header() {
  const language = useLanguage()
  const t = useT()
  const setSettings = useStore((s) => s.setSettings)
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
                href="https://colorflowai.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-800 transition-colors hover:text-gray-600 dark:text-gray-100 dark:hover:text-gray-300"
              >
                {t('appName')}
              </a>
            </h1>
            {hasUpdate && latestRelease && (
              <a
                href={latestRelease.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={dismiss}
                className="mt-0.5 rounded border border-red-500/30 bg-red-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white transition-colors hover:bg-red-600 animate-fade-in"
                title={t('newVersion', { tag: latestRelease.tag })}
              >
                NEW
              </a>
            )}
          </div>
          <a
            href="https://colorflowai.com"
            target="_blank"
            rel="noopener noreferrer"
            title={t('imageBackendTitle')}
            className="group hidden min-w-0 items-center gap-1.5 rounded-full border border-purple-200/70 bg-purple-50/80 px-2.5 py-1 text-xs text-gray-600 shadow-sm shadow-purple-900/5 transition hover:border-purple-300 hover:bg-purple-100/80 hover:text-gray-800 dark:border-purple-400/20 dark:bg-purple-400/10 dark:text-gray-300 dark:hover:bg-purple-400/15 dark:hover:text-gray-100 sm:inline-flex"
          >
            <svg className="h-3.5 w-3.5 flex-shrink-0 text-purple-500 dark:text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
            <span className="hidden font-medium text-purple-700 dark:text-purple-300 md:inline">{t('imageBackend')}</span>
            <span className="max-w-[32rem] truncate">{t('imageBackendCta')}</span>
            <svg className="h-3.5 w-3.5 flex-shrink-0 text-purple-500 transition-transform group-hover:translate-x-0.5 dark:text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M9 7h8v8" />
            </svg>
          </a>
          <a
            href="https://colorflowai.com"
            target="_blank"
            rel="noopener noreferrer"
            title={t('imageBackendTitle')}
            className="inline-flex flex-shrink-0 items-center rounded-full border border-purple-200/70 bg-purple-50/80 px-2 py-1 text-[11px] font-medium text-purple-700 transition hover:bg-purple-100 dark:border-purple-400/20 dark:bg-purple-400/10 dark:text-purple-300 dark:hover:bg-purple-400/15 sm:hidden"
          >
            {t('imageBackend')}
          </a>
{/*          <a
            href="https://aicodelink.top"
            target="_blank"
            rel="noopener noreferrer"
            title={t('modelRelayTitle')}
            className="group hidden min-w-0 items-center gap-1.5 rounded-full border border-blue-200/70 bg-blue-50/80 px-2.5 py-1 text-xs text-gray-600 shadow-sm shadow-blue-900/5 transition hover:border-blue-300 hover:bg-blue-100/80 hover:text-gray-800 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-gray-300 dark:hover:bg-blue-400/15 dark:hover:text-gray-100 sm:inline-flex"
          >
            <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.16)]" />
            <span className="hidden font-medium text-blue-700 dark:text-blue-300 md:inline">{t('modelRelay')}</span>
            <span className="max-w-[32rem] truncate">
              {t('modelRelayCta')}
            </span>
            <svg className="h-3.5 w-3.5 flex-shrink-0 text-blue-500 transition-transform group-hover:translate-x-0.5 dark:text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17L17 7M9 7h8v8" />
            </svg>
          </a>*/}
        {/*  <a
            href="https://aicodelink.top"
            target="_blank"
            rel="noopener noreferrer"
            title={t('modelRelayTitle')}
            className="inline-flex flex-shrink-0 items-center rounded-full border border-blue-200/70 bg-blue-50/80 px-2 py-1 text-[11px] font-medium text-blue-700 transition hover:bg-blue-100 dark:border-blue-400/20 dark:bg-blue-400/10 dark:text-blue-300 dark:hover:bg-blue-400/15 sm:hidden"
          >
            {t('modelRelayMobile')}
          </a>*/}
        </div>
        <div className="flex items-center gap-1">
{/*          <button
            onClick={() => setSettings({ language: language === 'en' ? 'zh' : 'en' })}
            className="inline-flex h-9 items-center rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.06]"
            title={language === 'en' ? t('switchToChinese') : t('switchToEnglish')}
            aria-label={t('language')}
          >
            {language === 'en' ? '中文' : 'EN'}
          </button>*/}
          <button
            onClick={() => setShowHelp(true)}
            className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
            title={t('help')}
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
            title={t('settings')}
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
