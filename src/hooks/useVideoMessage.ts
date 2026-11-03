import { useLanguage } from './useI18n'
import { localizeVideoMessage } from '../i18n/video'

/** 历史任务和队列中已保存的应用提示也随语言切换，不翻译提示词或素材名称。 */
export function useVideoMessage() {
  const language = useLanguage()
  return (text: string) => localizeVideoMessage(language, text)
}
