import { afterEach, describe, expect, it } from 'vitest'
import { setActiveLanguage, translate } from '../../i18n'
import { localizeVideoMessage, videoEn, videoZh } from '../../i18n/video'
import { defaultDraft, validateDraft } from './models'
import { normalizeGateway } from './api'

afterEach(() => setActiveLanguage('zh'))

describe('video localization', () => {
  it('provides English text and matching placeholders for every Chinese message', () => {
    for (const [zh, en] of Object.entries(videoEn)) {
      expect(en, zh).not.toMatch(/\p{Script=Han}/u)
      expect(en.match(/\{\d+\}/g)?.sort() ?? [], zh).toEqual(zh.match(/\{\d+\}/g)?.sort() ?? [])
      expect(videoZh[zh as keyof typeof videoZh]).toBe(zh)
    }
  })
  it('uses the existing application language for validation and API errors', () => {
    setActiveLanguage('en')
    expect(validateDraft(defaultDraft(), [])).toContain('Describe the scene, action or camera movement you want')
    expect(() => normalizeGateway('https://example.com/v1')).toThrow('Enter the gateway root URL without /v1 or the task path')
    setActiveLanguage('zh')
    expect(validateDraft(defaultDraft(), [])).toContain('请描述希望生成的画面、动作或镜头变化')
  })
  it('can validate using the render language before the global language effect runs', () => {
    setActiveLanguage('zh')
    const errors = validateDraft(defaultDraft(), [], (key, values) => translate('en', key, values))
    expect(errors.join(' ')).not.toMatch(/\p{Script=Han}/u)
  })
  it('relocalizes saved application messages while preserving dynamic file names', () => {
    const zh = '素材「用户文件{1}.png」的原文件缺失，请重新选择'
    const en = 'The original file for “用户文件{1}.png” is missing. Please select it again'
    expect(localizeVideoMessage('en', zh)).toBe(en)
    expect(localizeVideoMessage('zh', en)).toBe(zh)
    expect(localizeVideoMessage('en', '视频历史已清空，草稿已保留。')).toBe('Video history cleared. Your draft was kept.')
    expect(localizeVideoMessage('en', '上游自定义错误 code=xyz')).toBe('上游自定义错误 code=xyz')
  })
  it('does not replace placeholder-like text inside user input a second time', () => {
    expect(translate('en', '{0} 时长需为 2–{1} 秒', { 0: 'video-{1}.mp4', 1: 15 })).toBe('video-{1}.mp4 must be 2–15 seconds long')
  })
})
