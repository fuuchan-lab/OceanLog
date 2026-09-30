/** 画面の配色（ライト / ダーク）の選択。「自動」は端末の設定に合わせる */
export type ThemePreference = 'auto' | 'light' | 'dark'

const THEME_STORAGE_KEY = 'sealog-theme'

export function parseTheme(value: string | null | undefined): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'auto'
}

export function loadTheme(): ThemePreference {
  try {
    return parseTheme(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'auto'
  }
}

export function saveTheme(theme: ThemePreference) {
  try {
    if (theme === 'auto') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, theme)
  } catch {
    // 保存できなくても、その回の表示は切り替わる
  }
}

/** 「自動」は属性を外して、CSS の prefers-color-scheme（端末の設定）に任せる */
export function applyTheme(theme: ThemePreference) {
  const root = document.documentElement
  if (theme === 'auto') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}
