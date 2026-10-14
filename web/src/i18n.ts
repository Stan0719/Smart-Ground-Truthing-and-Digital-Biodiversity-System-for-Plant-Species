import { createI18n } from 'vue-i18n'

import en from './locales/en.json'
import ms from './locales/ms.json'
import zhCN from './locales/zh-CN.json'

export const supportedLocales = ['en', 'ms', 'zh-CN'] as const
export type SupportedLocale = (typeof supportedLocales)[number]

const normalizeLocale = (locale?: string | null): SupportedLocale => {
  const value = locale?.toLowerCase()
  if (value?.startsWith('ms')) return 'ms'
  if (value?.startsWith('zh')) return 'zh-CN'
  return 'en'
}

const savedLocale = localStorage.getItem('language')
const initialLocale = savedLocale && supportedLocales.includes(savedLocale as SupportedLocale)
  ? (savedLocale as SupportedLocale)
  : normalizeLocale(navigator.language)

document.documentElement.lang = initialLocale

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale,
  fallbackLocale: 'en',
  messages: {
    en,
    ms,
    'zh-CN': zhCN,
  },
})

export const setAppLocale = (locale: SupportedLocale) => {
  i18n.global.locale.value = locale
  localStorage.setItem('language', locale)
  document.documentElement.lang = locale
}
