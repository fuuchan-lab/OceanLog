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

const STORAGE_KEY = 'oceanlog-language'

export const LOCALES: Record<Lang, string> = { ja: 'ja-JP', en: 'en-US' }

export function translate(lang: Lang, key: MessageKey, vars?: Vars): string {
  const template: string = (lang === 'en' ? en : ja)[key]
  return vars ? template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`)) : template
}

/** 保存済みの選択があればそれを、なければ端末の言語（日本語以外は英語）を使う（CapLog と同じ） */
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'ja' || saved === 'en') return saved
  } catch {
    // 読めなければ端末の言語で決める
  }
  return navigator.language.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}

export function saveLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // 保存できなくても、その回の表示は切り替わる
  }
}

export const I18nContext = createContext<I18n>({
  lang: 'ja',
  setLang: () => {},
  t: (key, vars) => translate('ja', key, vars),
})
