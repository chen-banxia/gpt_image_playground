import { getLanguage, translate, type TranslationKey } from '../i18n'
import { useStore } from '../store'

export function useLanguage() {
  return useStore((s) => getLanguage(s.settings.language))
}

export function useT() {
  const language = useLanguage()
  return (key: TranslationKey, replacements?: Record<string, string | number>) => translate(language, key, replacements)
}
