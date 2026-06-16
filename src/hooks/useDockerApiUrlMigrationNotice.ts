import { useEffect } from 'react'
import { useStore } from '../store'
import { readRuntimeEnv } from '../lib/runtimeEnv'
import { translate } from '../i18n'

const NOTICE_KEY = 'docker-api-url-migration-notice-v1'

export function useDockerApiUrlMigrationNotice() {
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)

  useEffect(() => {
    if (readRuntimeEnv(import.meta.env.VITE_DOCKER_DEPLOYMENT) !== 'true') return
    if (readRuntimeEnv(import.meta.env.VITE_DOCKER_LEGACY_API_URL_USED) !== 'true') return
    if (localStorage.getItem(NOTICE_KEY) === 'true') return

    const dismiss = () => {
      localStorage.setItem(NOTICE_KEY, 'true')
    }
    const language = useStore.getState().settings.language === 'zh' ? 'zh' : 'en'

    setConfirmDialog({
      title: translate(language, 'dockerMigrationTitle'),
      message: translate(language, 'dockerMigrationMessage'),
      confirmText: translate(language, 'gotIt'),
      showCancel: false,
      icon: 'info',
      minConfirmDelayMs: 3000,
      action: dismiss,
      cancelAction: dismiss,
    })
  }, [setConfirmDialog])
}
