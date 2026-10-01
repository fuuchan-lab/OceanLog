/**
 * 海しる（海洋状況表示システム、海上保安庁）の公開 API。
 * 使う人がそれぞれキー（サブスクリプションキー）を設定に入れる。開発者ポータル（https://portal.msil.go.jp/）にアカウント登録はなく、
 * 「利用方法」のページの試用キーを使うか、海上保安庁 海洋情報部の問い合わせフォームで自分のキーの発行を申し込む。キーは端末に保存し、ログイン中は自分の Google ドライブ（prefs.json）にも保存して、同じアカウントの端末で共通にする。
 * 地図に重ねる項目は、ArcGIS の MapServer の export（PNG）を使う。
 * 利用規約により、使う時は「海しるAPIを利用して取得した情報を基に作成しているが、サービスの内容は海上保安庁によって保証されたものではない」旨を表示する
 */

export const MSIL_PORTAL = 'https://portal.msil.go.jp/'
/** 試用キーと、自分のキーの申し込み方法が載っているページ */
export const MSIL_HOWTO = 'https://portal.msil.go.jp/howtouse'

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

export const MSIL_KEY = 'oceanlog-msil'

export function parseMsil(raw: string | null): MsilSettings {
  if (!raw) return EMPTY_MSIL
  try {
    return msilFrom(JSON.parse(raw))
  } catch {
    return EMPTY_MSIL
  }
}

export function msilFrom(value: unknown): MsilSettings {
  if (typeof value !== 'object' || value === null) return EMPTY_MSIL
  const v = value as Partial<MsilSettings>
  const layers = Array.isArray(v.layers)
    ? v.layers.filter((l): l is MsilLayer => typeof l?.id === 'string' && typeof l.name === 'string' && isMsilUrl(l.url))
    : []
  return {
    key: typeof v.key === 'string' ? v.key.trim() : '',
    layers,
    enabled: Array.isArray(v.enabled) ? v.enabled.filter((id): id is string => layers.some((l) => l.id === id)) : [],
  }
}

export function loadMsil(): MsilSettings {
  try {
    return parseMsil(localStorage.getItem(MSIL_KEY))
  } catch {
    return EMPTY_MSIL
  }
}

export function saveMsil(s: MsilSettings) {
  try {
    localStorage.setItem(MSIL_KEY, JSON.stringify(s))
  } catch {
    // 保存できなくても、その回は使える
  }
}

/** 海しるの API の URL か（https で、…/MapServer で終わる） */
export function isMsilUrl(url: unknown): url is string {
  return typeof url === 'string' && /^https:\/\/[^\s]+\/MapServer\/?$/i.test(url.trim())
}

/** 地図のタイル1枚ぶんの範囲（Web メルカトル, m）の画像の URL。キーは subscription-key で付ける（ヘッダーを付けられない画像のタイルのため） */
export function exportUrl(base: string, bbox: [number, number, number, number], size = 256, key = ''): string {
  const params = new URLSearchParams({
    bbox: bbox.map((v) => v.toFixed(2)).join(','),
    bboxSR: '3857',
    imageSR: '3857',
    size: `${size},${size}`,
    format: 'png32',
    transparent: 'true',
    f: 'image',
  })
  if (key) params.set('subscription-key', key)
  return `${base.trim().replace(/\/$/, '')}/export?${params}`
}

/**
 * よく使う項目（海しる API の開発者ポータルの、各項目の説明に載っている Base URL + /MapServer）。
 * name はメッセージのキー
 */
export const MSIL_PRESETS = [
  { id: 'preset-depth-contour', name: 'msil.preset.depthContour', url: 'https://api.msil.go.jp/depth-contour/v2/MapServer' },
  { id: 'preset-lighthouse', name: 'msil.preset.lighthouse', url: 'https://api.msil.go.jp/lights/lighthouse/v2/MapServer' },
  { id: 'preset-fixed-gear', name: 'msil.preset.fixedGear', url: 'https://api.msil.go.jp/fixed-gear-fishery-right/v2/MapServer' },
] as const

/** 確かめるのに使う範囲（日本の周り、Web メルカトル, m） */
const CHECK_BBOX: [number, number, number, number] = [13_000_000, 2_800_000, 17_000_000, 5_800_000]

/**
 * キーで海しるの画像が取れるか、日本の周りの小さな画像を1枚読んで確かめる。
 * 'ok' / 'failed'（キーか URL が違う、または海しる側の都合）/ 'offline'（電波がない）
 */
export function checkMsil(url: string, key: string): Promise<'ok' | 'failed' | 'offline'> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return Promise.resolve('offline')
  return new Promise((resolve) => {
    const img = new Image()
    const timer = setTimeout(() => resolve('failed'), 20_000)
    img.onload = () => {
      clearTimeout(timer)
      resolve('ok')
    }
    img.onerror = () => {
      clearTimeout(timer)
      resolve('failed')
    }
    img.src = exportUrl(url, CHECK_BBOX, 64, key)
  })
}

/** 項目を表示する・しない。まだ一覧になければ追加する（よく使う項目を選んだ時） */
export function setMsilLayerOn(msil: MsilSettings, layer: MsilLayer, on: boolean): MsilSettings {
  const layers = msil.layers.some((l) => l.id === layer.id) ? msil.layers : [...msil.layers, layer]
  const enabled = on ? [...msil.enabled.filter((x) => x !== layer.id), layer.id] : msil.enabled.filter((x) => x !== layer.id)
  return { ...msil, layers, enabled }
}

const PRESET_IDS: ReadonlySet<string> = new Set(MSIL_PRESETS.map((p) => p.id))

/** 自分で追加した項目（よく使う項目以外） */
export const customMsilLayers = (msil: MsilSettings) => msil.layers.filter((l) => !PRESET_IDS.has(l.id))
