/** 単位・地図などの設定。端末に保存し、ログイン中は Google ドライブの prefs.json で同じアカウントの端末と共通にする（prefs.ts） */
import type { WindUnit } from './geo.ts'

export type BaseLayer = 'osm' | 'gsi-pale' | 'gsi-photo' | 'gebco'

export interface Settings {
  windUnit: WindUnit
  baseLayer: BaseLayer
  /** 海図記号（OpenSeaMap）を重ねる */
  seamarks: boolean
  /** 自分で用意した海図タイルの URL（{z}/{x}/{y} を含む）。空なら使わない */
  customTileUrl: string
  customTileAttribution: string
  /** 航行モード中は、地図をスマホの向き（進行方向）に合わせて回す。false なら北が上 */
  headingUp: boolean
  /** 国土地理院の沿岸海域土地条件図（等深線）を重ねる */
  gsiDepth: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  windUnit: 'ms',
  baseLayer: 'gsi-pale',
  seamarks: true,
  customTileUrl: '',
  customTileAttribution: '',
  headingUp: true,
  gsiDepth: false,
}

export const SETTINGS_KEY = 'oceanlog-settings'

export function parseSettings(raw: string | null): Settings {
  if (!raw) return DEFAULT_SETTINGS
  try {
    return settingsFrom(JSON.parse(raw))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function settingsFrom(value: unknown): Settings {
  if (typeof value !== 'object' || value === null) return DEFAULT_SETTINGS
  const v = value as Partial<Settings>
  return {
    windUnit: v.windUnit === 'kn' || v.windUnit === 'kmh' ? v.windUnit : 'ms',
    baseLayer: v.baseLayer === 'osm' || v.baseLayer === 'gsi-photo' || v.baseLayer === 'gebco' ? v.baseLayer : 'gsi-pale',
    seamarks: v.seamarks !== false,
    customTileUrl: typeof v.customTileUrl === 'string' ? v.customTileUrl : '',
    customTileAttribution: typeof v.customTileAttribution === 'string' ? v.customTileAttribution : '',
    headingUp: v.headingUp !== false,
    gsiDepth: v.gsiDepth === true,
  }
}

export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(SETTINGS_KEY))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    // 保存できなくても、その回は反映される
  }
}

/** 自分で用意したタイルの URL として使えるか（https で {z} {x} {y} を含む） */
export function isValidTileUrl(url: string): boolean {
  return /^https:\/\/\S+$/.test(url) && url.includes('{z}') && url.includes('{x}') && url.includes('{y}')
}
