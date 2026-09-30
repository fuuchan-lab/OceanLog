/**
 * 海しる（海洋状況表示システム、海上保安庁）の公開 API。
 * 使う人がそれぞれ開発者ポータル（https://portal.msil.go.jp/）で利用登録して、自分のキー（サブスクリプションキー）を
 * 設定に入れる。キーはこの端末にだけ保存し、Google ドライブには送らない。
 * 地図に重ねる項目は、ArcGIS の MapServer の export（PNG）を使う。
 * 利用規約により、使う時は「海しるAPIを利用して取得した情報を基に作成しているが、サービスの内容は海上保安庁によって保証されたものではない」旨を表示する
 */

export const MSIL_PORTAL = 'https://portal.msil.go.jp/'

/** 地図に重ねる海しるの項目 */
export interface MsilLayer {
  id: string
  name: string
  /** 項目の MapServer の URL（…/MapServer まで） */
  url: string
}

export interface MsilSettings {
  key: string
  layers: MsilLayer[]
  /** 表示中の項目の ID */
  enabled: string[]
}

export const EMPTY_MSIL: MsilSettings = { key: '', layers: [], enabled: [] }

const KEY = 'oceanlog-msil'

export function parseMsil(raw: string | null): MsilSettings {
  if (!raw) return EMPTY_MSIL
  try {
    const v = JSON.parse(raw) as Partial<MsilSettings>
    const layers = Array.isArray(v.layers)
      ? v.layers.filter((l): l is MsilLayer => typeof l?.id === 'string' && typeof l.name === 'string' && isMsilUrl(l.url))
      : []
    return {
      key: typeof v.key === 'string' ? v.key.trim() : '',
      layers,
      enabled: Array.isArray(v.enabled) ? v.enabled.filter((id): id is string => layers.some((l) => l.id === id)) : [],
    }
  } catch {
    return EMPTY_MSIL
  }
}

export function loadMsil(): MsilSettings {
  try {
    return parseMsil(localStorage.getItem(KEY))
  } catch {
    return EMPTY_MSIL
  }
}

export function saveMsil(s: MsilSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    // 保存できなくても、その回は使える
  }
}

/** 海しるの API の URL か（https で、…/MapServer で終わる） */
export function isMsilUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https:\/\/[^\s]+\/MapServer\/?$/i.test(url.trim())
}

/** 地図のタイル1枚ぶんの範囲（Web メルカトル, m）の画像の URL */
export function exportUrl(base: string, bbox: [number, number, number, number], size = 256): string {
  const params = new URLSearchParams({
    bbox: bbox.map((v) => v.toFixed(2)).join(','),
    bboxSR: '3857',
    imageSR: '3857',
    size: `${size},${size}`,
    format: 'png32',
    transparent: 'true',
    f: 'image',
  })
  return `${base.trim().replace(/\/$/, '')}/export?${params}`
}
