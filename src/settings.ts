/** この端末だけの設定（単位・地図など）。端末に保存する */
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
}

export const DEFAULT_SETTINGS: Settings = {
  windUnit: 'ms',
  baseLayer: 'gsi-pale',
  seamarks: true,
  customTileUrl: '',
  customTileAttribution: '',
}

const KEY = 'oceanlog-settings'

export function parseSettings(raw: string | null): Settings {
  if (!raw) return DEFAULT_SETTINGS
  try {
    const v = JSON.parse(raw) as Partial<Settings>
    return {
      windUnit: v.windUnit === 'kn' || v.windUnit === 'kmh' ? v.windUnit : 'ms',
      baseLayer: v.baseLayer === 'osm' || v.baseLayer === 'gsi-photo' || v.baseLayer === 'gebco' ? v.baseLayer : 'gsi-pale',
      seamarks: v.seamarks !== false,
      customTileUrl: typeof v.customTileUrl === 'string' ? v.customTileUrl : '',
      customTileAttribution: typeof v.customTileAttribution === 'string' ? v.customTileAttribution : '',
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function loadSettings(): Settings {
  try {
    return parseSettings(localStorage.getItem(KEY))
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // 保存できなくても、その回は反映される
  }
}

/** 自分で用意したタイルの URL として使えるか（https で {z} {x} {y} を含む） */
export function isValidTileUrl(url: string): boolean {
  return /^https:\/\/\S+$/.test(url) && url.includes('{z}') && url.includes('{x}') && url.includes('{y}')
}
