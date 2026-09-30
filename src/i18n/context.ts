import { createContext } from 'react'
import { en, ja, type MessageKey } from './messages.ts'

export type Lang = 'ja' | 'en'

export type Vars = Record<string, string | number>

export type TFn = (key: MessageKey, vars?: Vars) => string

export interface I18n {
  lang: Lang
  setLang: (lang: Lang) => void
  t: TFn
}

export const LANG_STORAGE_KEY = 'oceanlog-language'

export const LOCALES: Record<Lang, string> = { ja: 'ja-JP', en: 'en-US' }

export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const template: string = (lang === 'en' ? en : ja)[key]
  return vars ? template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`)) : template
}

/** 保存済みの選択があればそれを、なければ端末の言語（日本語以外は英語）を使う（CapLog と同じ） */
export function detectLang(): Lang {
  const saved = savedLang()
  if (saved) return saved
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

/** 自分で選んだ言語。選んでいなければ null */
export function savedLang(): Lang | null {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY)
    return saved === 'ja' || saved === 'en' ? saved : null
  } catch {
    return null
  }
}

export function saveLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang)
  } catch {
    // 保存できなくても、その回の表示は切り替わる
  }
}

export const I18nContext = createContext<I18n>({
  lang: 'ja',
  setLang: () => {},
  t: (key, vars) => translate('ja', key, vars),
})
