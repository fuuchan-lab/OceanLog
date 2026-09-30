/**
 * 設定（単位・地図・海しるのキーと項目・言語・配色）を、Google ドライブの prefs.json で同じアカウントの端末と共通にする。
 * 設定は項目のまとまり（section）ごとに、最後に変えた日時を持つ。新しく変えたほうを残す。
 * まとまりごとに比べるので、新しい端末で地図の種類を変えただけで、海しるのキーが空で上書きされることはない。
 */
import type { Lang } from './i18n/context.ts'
import { msilFrom, type MsilSettings } from './msil.ts'
import { settingsFrom, type Settings } from './settings.ts'
import type { ThemePreference } from './theme.ts'

export interface PrefValues {
  settings: Settings
  msil: MsilSettings
  /** 選んでいなければ null（端末の言語に合わせる） */
  lang: Lang | null
  theme: ThemePreference
}

export type PrefSection = keyof PrefValues

export const PREF_SECTIONS: PrefSection[] = ['settings', 'msil', 'lang', 'theme']

/** まとまりごとの、最後に変えた日時。0 は「この端末では変えていない」 */
export type PrefStamps = Record<PrefSection, number>

export const ZERO_STAMPS: PrefStamps = { settings: 0, msil: 0, lang: 0, theme: 0 }

export interface PrefsFile {
  app: 'OceanLog'
  version: 1
  sections: Partial<{ [K in PrefSection]: { at: number; value: PrefValues[K] } }>
}

export interface Prefs {
  values: PrefValues
  stamps: PrefStamps
}

const sectionValue: { [K in PrefSection]: (v: unknown) => PrefValues[K] | undefined } = {
  settings: (v) => (typeof v === 'object' && v !== null ? settingsFrom(v) : undefined),
  msil: (v) => (typeof v === 'object' && v !== null ? msilFrom(v) : undefined),
  lang: (v) => (v === 'ja' || v === 'en' ? v : v === null ? null : undefined),
  theme: (v) => (v === 'auto' || v === 'light' || v === 'dark' ? v : undefined),
}

/** ドライブの prefs.json を読む。壊れたまとまりは無いものとして扱う */
export function parsePrefsFile(value: unknown): { values: Partial<PrefValues>; stamps: PrefStamps } {
  const values: Partial<PrefValues> = {}
  const stamps = { ...ZERO_STAMPS }
  const sections = typeof value === 'object' && value !== null ? (value as { sections?: unknown }).sections : undefined
  if (typeof sections !== 'object' || sections === null) return { values, stamps }
  for (const key of PREF_SECTIONS) {
    const s = (sections as Record<string, unknown>)[key]
    if (typeof s !== 'object' || s === null) continue
    const { at, value: raw } = s as { at?: unknown; value?: unknown }
    const v = sectionValue[key](raw)
    if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0 || v === undefined) continue
    ;(values as Record<PrefSection, unknown>)[key] = v
    stamps[key] = at
  }
  return { values, stamps }
}

export interface PrefsMerge {
  /** ドライブのほうが新しかったまとまり（端末に反映する） */
  apply: Partial<PrefValues>
  /** 反映した後の、端末の日時 */
  stamps: PrefStamps
  /** 端末のほうが新しいまとまりがあれば、ドライブに書く内容。なければ null */
  upload: PrefsFile | null
}

/** 端末とドライブの設定を、まとまりごとに新しいほうに合わせる */
export function mergePrefs(local: Prefs, remote: { values: Partial<PrefValues>; stamps: PrefStamps } | null): PrefsMerge {
  const apply: Partial<PrefValues> = {}
  const stamps = { ...local.stamps }
  const sections: PrefsFile['sections'] = {}
  let needUpload = false
  for (const key of PREF_SECTIONS) {
    const remoteAt = remote?.stamps[key] ?? 0
    const remoteValue = remote?.values[key]
    if (remoteValue !== undefined && remoteAt > local.stamps[key]) {
      ;(apply as Record<PrefSection, unknown>)[key] = remoteValue
      stamps[key] = remoteAt
      ;(sections as Record<PrefSection, unknown>)[key] = { at: remoteAt, value: remoteValue }
    } else if (local.stamps[key] > 0) {
      if (local.stamps[key] > remoteAt || remoteValue === undefined) needUpload = true
      ;(sections as Record<PrefSection, unknown>)[key] = { at: local.stamps[key], value: local.values[key] }
    }
  }
  return { apply, stamps, upload: needUpload ? { app: 'OceanLog', version: 1, sections } : null }
}

const STAMPS_KEY = 'oceanlog-prefs-at'

/**
 * この端末の日時を読む。この仕組みより前から使っている端末は、保存済みの設定を「ごく古い変更」（1）として扱う。
 * ドライブに設定があればそちらを残し、なければ端末の設定をドライブに送る
 */
export function loadPrefStamps(storedKeys: Record<PrefSection, string>): PrefStamps {
  try {
    const raw = localStorage.getItem(STAMPS_KEY)
    if (raw) {
      const v = JSON.parse(raw) as Partial<PrefStamps>
      const out = { ...ZERO_STAMPS }
      for (const key of PREF_SECTIONS) {
        const at = v[key]
        if (typeof at === 'number' && Number.isFinite(at) && at > 0) out[key] = at
      }
      return out
    }
    const out = { ...ZERO_STAMPS }
    for (const key of PREF_SECTIONS) if (localStorage.getItem(storedKeys[key]) !== null) out[key] = 1
    return out
  } catch {
    return { ...ZERO_STAMPS }
  }
}

export function savePrefStamps(stamps: PrefStamps) {
  try {
    localStorage.setItem(STAMPS_KEY, JSON.stringify(stamps))
  } catch {
    // 次に変えた時にもう一度保存する
  }
}
