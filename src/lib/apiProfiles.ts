import type { ApiMode, ApiProfile, ApiProvider, AppSettings, Language } from '../types'
import { translate } from '../i18n'
import { readRuntimeEnv } from './runtimeEnv'

const DEFAULT_BASE_URL = readRuntimeEnv(import.meta.env.VITE_DEFAULT_API_URL) || 'https://colorflowai.com/v1'
export const DEFAULT_IMAGES_MODEL = 'gpt-image-2.5-flare'
export const DEFAULT_RESPONSES_MODEL = 'gpt-5.5'
export const DEFAULT_FAL_BASE_URL = 'https://fal.run'
export const DEFAULT_FAL_MODEL = 'openai/gpt-image-2'
export const DEFAULT_OPENAI_PROFILE_ID = 'default-openai'
export const DEFAULT_API_TIMEOUT = 600
export const MAX_API_TIMEOUT = 600

/**
 * 历史上默认超时时间曾被设为 200 秒（commit 87faea8），后又调回 600 秒。
 * 自定义超时功能加入前，存量配置会把当时的默认值固化在 localStorage 中，
 * 导致老用户仍卡在 200 秒（对图生图偏紧）。这里把恰好等于旧默认值的超时
 * 迁移到当前默认值，用户手动设过的其他值不动。
 */
const LEGACY_DEFAULT_API_TIMEOUTS = [200]

function migrateLegacyTimeout(value: number): number {
  return LEGACY_DEFAULT_API_TIMEOUTS.includes(value) ? DEFAULT_API_TIMEOUT : value
}

function readTimeout(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.min(MAX_API_TIMEOUT, Math.max(1, migrateLegacyTimeout(value)))
  }
  return Math.min(MAX_API_TIMEOUT, Math.max(1, fallback))
}

function readLanguage(value: unknown): Language {
  return value === 'zh' ? 'zh' : 'en'
}

export function createDefaultOpenAIProfile(overrides: Partial<ApiProfile> = {}): ApiProfile {
  return {
    id: DEFAULT_OPENAI_PROFILE_ID,
    name: '默认',
    provider: 'openai',
    baseUrl: DEFAULT_BASE_URL,
    apiKey: '',
    model: DEFAULT_IMAGES_MODEL,
    timeout: DEFAULT_API_TIMEOUT,
    apiMode: 'images',
    codexCli: false,
    apiProxy: false,
    ...overrides,
  }
}

export function createDefaultFalProfile(overrides: Partial<ApiProfile> = {}): ApiProfile {
  return {
    id: `fal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: 'New profile',
    provider: 'fal',
    baseUrl: DEFAULT_FAL_BASE_URL,
    apiKey: '',
    model: DEFAULT_FAL_MODEL,
    timeout: DEFAULT_API_TIMEOUT,
    apiMode: 'images',
    codexCli: false,
    apiProxy: false,
    ...overrides,
  }
}

export function switchApiProfileProvider(profile: ApiProfile, provider: ApiProvider): ApiProfile {
  if (provider === 'fal') {
    return {
      ...profile,
      provider,
      baseUrl: DEFAULT_FAL_BASE_URL,
      model: DEFAULT_FAL_MODEL,
      apiMode: 'images',
      codexCli: false,
      apiProxy: false,
    }
  }

  return {
    ...profile,
    provider,
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_IMAGES_MODEL,
  }
}

export function normalizeApiProfile(input: unknown, fallback?: Partial<ApiProfile>): ApiProfile {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const provider: ApiProvider = record.provider === 'fal' ? 'fal' : 'openai'
  const defaults = provider === 'fal' ? createDefaultFalProfile(fallback) : createDefaultOpenAIProfile(fallback)
  const apiMode: ApiMode = record.apiMode === 'responses' ? 'responses' : 'images'

  return {
    ...defaults,
    id: typeof record.id === 'string' && record.id.trim() ? record.id : defaults.id,
    name: typeof record.name === 'string' && record.name.trim() ? record.name : defaults.name,
    provider,
    baseUrl: provider === 'openai'
      ? DEFAULT_BASE_URL
      : typeof record.baseUrl === 'string' ? record.baseUrl : defaults.baseUrl,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : defaults.apiKey,
    model: typeof record.model === 'string' && record.model.trim() ? record.model : defaults.model,
    timeout: readTimeout(record.timeout, defaults.timeout),
    apiMode,
    codexCli: provider === 'openai' ? true : Boolean(record.codexCli),
    apiProxy: Boolean(record.apiProxy),
  }
}

export function normalizeSettings(input: Partial<AppSettings> | unknown): AppSettings {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {}
  const legacyProfile = createDefaultOpenAIProfile({
    baseUrl: DEFAULT_BASE_URL,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : '',
    model: typeof record.model === 'string' && record.model.trim() ? record.model : DEFAULT_IMAGES_MODEL,
    timeout: readTimeout(record.timeout, DEFAULT_API_TIMEOUT),
    apiMode: record.apiMode === 'responses' ? 'responses' : 'images',
    codexCli: Boolean(record.codexCli),
    apiProxy: Boolean(record.apiProxy),
  })
  const profiles = Array.isArray(record.profiles) && record.profiles.length
    ? record.profiles.map((profile) => normalizeApiProfile(profile))
    : [legacyProfile]
  const activeProfileId = typeof record.activeProfileId === 'string' && profiles.some((p) => p.id === record.activeProfileId)
    ? record.activeProfileId
    : profiles[0].id
  const active = profiles.find((p) => p.id === activeProfileId) ?? profiles[0]

  return {
    language: readLanguage(record.language),
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    rememberApiKey: typeof record.rememberApiKey === 'boolean' ? record.rememberApiKey : false,
    model: active.model,
    timeout: active.timeout,
    apiMode: active.apiMode,
    codexCli: active.codexCli,
    apiProxy: active.apiProxy,
    clearInputAfterSubmit: typeof record.clearInputAfterSubmit === 'boolean' ? record.clearInputAfterSubmit : false,
    profiles,
    activeProfileId,
  }
}

/**
 * 模型选择器加入前，默认模型固化为 gpt-image-2 并被写进了 localStorage。
 * 存量配置里的该值只是旧默认值（当时界面上无从选择），一次性迁移到当前默认模型。
 * 迁移只在 persist 版本升级时执行一次，之后用户在下拉里主动选回 gpt-image-2 不会再被改动。
 */
const LEGACY_DEFAULT_IMAGES_MODEL = 'gpt-image-2'

export function migrateLegacyDefaultImagesModel(settings: Partial<AppSettings> | unknown): AppSettings {
  const normalized = normalizeSettings(settings)
  return normalizeSettings({
    ...normalized,
    profiles: normalized.profiles.map((profile) =>
      profile.provider === 'openai' && profile.model === LEGACY_DEFAULT_IMAGES_MODEL
        ? { ...profile, model: DEFAULT_IMAGES_MODEL }
        : profile,
    ),
  })
}

export function getActiveApiProfile(settings: Partial<AppSettings> | unknown): ApiProfile {
  const record = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {}
  const normalized = normalizeSettings(settings)
  const profile = normalized.profiles.find((p) => p.id === normalized.activeProfileId) ?? normalized.profiles[0] ?? createDefaultOpenAIProfile()

  return {
    ...profile,
    baseUrl: profile.provider === 'openai'
      ? DEFAULT_BASE_URL
      : typeof record.baseUrl === 'string' ? record.baseUrl : profile.baseUrl,
    apiKey: typeof record.apiKey === 'string' ? record.apiKey : profile.apiKey,
    model: typeof record.model === 'string' && record.model.trim() ? record.model : profile.model,
    timeout: readTimeout(record.timeout, profile.timeout),
    apiMode: record.apiMode === 'images' || record.apiMode === 'responses' ? record.apiMode : profile.apiMode,
    codexCli: profile.provider === 'openai'
      ? true
      : typeof record.codexCli === 'boolean' ? record.codexCli : profile.codexCli,
    apiProxy: typeof record.apiProxy === 'boolean' ? record.apiProxy : profile.apiProxy,
  }
}

export function validateApiProfile(profile: ApiProfile, language: Language = 'en'): string | null {
  if (!profile.name.trim()) return translate(language, 'missingName')
  if (profile.provider === 'openai' && !profile.baseUrl.trim()) return translate(language, 'missingApiUrl')
  if (!profile.apiKey.trim()) return translate(language, 'missingApiKey')
  if (!profile.model.trim()) return translate(language, 'missingModelId')
  return null
}

function isDefaultOpenAIProfile(profile: ApiProfile): boolean {
  return profile.id === DEFAULT_OPENAI_PROFILE_ID &&
    profile.name === '默认' &&
    profile.provider === 'openai' &&
    profile.baseUrl === DEFAULT_BASE_URL &&
    profile.apiKey === '' &&
    profile.model === DEFAULT_IMAGES_MODEL &&
    profile.timeout === DEFAULT_API_TIMEOUT &&
    profile.apiMode === 'images' &&
    profile.apiProxy === false
}

function hasOnlyDefaultProfiles(settings: AppSettings): boolean {
  return settings.profiles.length === 1 &&
    settings.activeProfileId === DEFAULT_OPENAI_PROFILE_ID &&
    isDefaultOpenAIProfile(settings.profiles[0])
}

function createImportedProfileId(provider: ApiProvider, usedIds: Set<string>): string {
  let id = `${provider}-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  while (usedIds.has(id)) {
    id = `${provider}-imported-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  }
  usedIds.add(id)
  return id
}

function getApiProfileDedupKey(profile: ApiProfile): string {
  return JSON.stringify([
    profile.provider,
    profile.baseUrl.trim().replace(/\/+$/, '').toLowerCase(),
    profile.apiKey.trim(),
    profile.model.trim(),
    profile.apiMode,
  ])
}

function dedupeApiProfiles(profiles: ApiProfile[]): ApiProfile[] {
  const seen = new Set<string>()
  return profiles.filter((profile) => {
    const key = getApiProfileDedupKey(profile)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function mergeImportedSettings(currentSettings: Partial<AppSettings> | unknown, importedSettings: Partial<AppSettings> | unknown): AppSettings {
  const current = normalizeSettings(currentSettings)
  const normalizedImported = normalizeSettings(importedSettings)
  const imported = normalizeSettings({
    ...normalizedImported,
    profiles: dedupeApiProfiles(normalizedImported.profiles),
  })

  if (hasOnlyDefaultProfiles(current)) {
    return imported
  }

  const usedIds = new Set(current.profiles.map((profile) => profile.id))
  const existingKeys = new Set(current.profiles.map(getApiProfileDedupKey))
  const importedProfiles = imported.profiles
    .filter((profile) => !existingKeys.has(getApiProfileDedupKey(profile)))
    .map((profile) => ({
      ...profile,
      id: createImportedProfileId(profile.provider, usedIds),
    }))
  const profiles = [...current.profiles, ...importedProfiles]

  return normalizeSettings({
    ...current,
    profiles,
    activeProfileId: current.activeProfileId,
  })
}

export const DEFAULT_SETTINGS: AppSettings = normalizeSettings({
  baseUrl: DEFAULT_BASE_URL,
  language: 'en',
  apiKey: '',
  model: DEFAULT_IMAGES_MODEL,
  timeout: DEFAULT_API_TIMEOUT,
  apiMode: 'images',
  codexCli: false,
  apiProxy: false,
  clearInputAfterSubmit: false,
})
