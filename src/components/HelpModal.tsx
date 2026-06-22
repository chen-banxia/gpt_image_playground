import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useCloseOnEscape } from '../hooks/useCloseOnEscape'
import { useT } from '../hooks/useI18n'

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
  const t = useT()
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
            {t('help')}
          </h3>
          <button
            onClick={onClose}
            className="rounded-full p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-white/[0.06] dark:hover:text-gray-200"
            aria-label={t('close')}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pr-1 custom-scrollbar">
          <div className="grid gap-4 md:grid-cols-2">
            <Section title={t('firstUse')}>
              <List>
                <li>{t('firstUse1')}</li>
                <li>{t('firstUse2')}</li>
                <li>{t('firstUse3')}</li>
              </List>
            </Section>

            <Section title={t('textToImage')}>
              <List>
                <li>{t('textToImage1')}</li>
                <li>{t('textToImage2')}</li>
                <li>{t('textToImage3')}</li>
              </List>
            </Section>

            <Section title={t('referenceEdit')}>
              <List>
                <li>{t('referenceEdit1')}</li>
                <li>{t('referenceEdit2')}</li>
                <li>{t('referenceEdit3')}</li>
              </List>
            </Section>

            <Section title={t('maskEditing')}>
              <List>
                <li>{t('maskEditing1')}</li>
                <li>{t('maskEditing2')}</li>
                <li>{t('maskEditing3')}</li>
              </List>
            </Section>

            <Section title={t('historyManagement')}>
              <List>
                <li>{t('historyManagement1')}</li>
                <li>{t('historyManagement2')}</li>
                <li>
                  {isMobile
                    ? t('historyManagementMobile')
                    : t('historyManagementDesktop')}
                </li>
                <li>{t('historyManagement4')}</li>
              </List>
            </Section>

            <Section title={t('dataBackup')}>
              <List>
                <li>{t('dataBackup1')}</li>
                <li>{t('dataBackup2')}</li>
                <li>{t('dataBackup3')}</li>
                <li>{t('dataBackup4')}</li>
              </List>
            </Section>

            <Section title={t('privacy')}>
              <List>
                <li>{t('privacy1')}</li>
                <li>{t('privacy2')}</li>
                <li>{t('privacy3')}</li>
              </List>
            </Section>
          </div>
        </div>

        <div className="mt-5 border-t border-gray-200 pt-4 dark:border-white/[0.08]">
          <div className="flex flex-col items-center gap-1.5">
           {/* <a
              href="https://aicodelink.top/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-sm font-medium text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
            >
              {t('appName')}
            </a>*/}
            <span className="text-center text-[11px] text-gray-400 dark:text-gray-500">
              {t('basedOnProject')}{' '}
              <a
                href="https://github.com/CookSleep/gpt_image_playground"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-gray-300 transition-colors hover:text-gray-600 dark:decoration-gray-600 dark:hover:text-gray-300"
              >
                GPT Image Playground
              </a>
              {' '}{t('originalAuthorThanks')}
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
