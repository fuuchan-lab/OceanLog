import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { I18nContext, detectLang, saveLang, translate, type I18n, type Lang } from './context.ts'

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang)

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    saveLang(next)
  }, [])

  const value = useMemo<I18n>(
    () => ({ lang, setLang, t: (key, vars) => translate(lang, key, vars) }),
    [lang, setLang],
  )

  // 読み上げ・ブラウザの翻訳提案のため、ページの言語とタイトルも合わせる
  useEffect(() => {
    document.documentElement.lang = lang
    document.title = translate(lang, 'app.title')
  }, [lang])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}
