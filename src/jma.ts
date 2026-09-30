/**
 * 気象庁の注意報・警報（日本国内）。気象庁ホームページの公開データを使う（出典: 気象庁。政府標準利用規約に準じて無料で利用できる）。
 * 1. 位置 → 市区町村コード: 国土地理院の逆ジオコーダー（海の上では見つからない）
 * 2. 市区町村コード → 気象庁の地域（class20）と、その府県予報区（office）: 気象庁の area.json
 * 3. 府県予報区の注意報・警報の JSON から、その市区町村の分を取り出す
 */
import type { LatLon } from './geo.ts'

/** 注意報・警報の種類のコード → 名前（日本語）と強さ */
const NAMES: Record<string, { ja: string; en: string; level: 'advisory' | 'warning' | 'emergency' }> = {
  '02': { ja: '暴風雪警報', en: 'Snowstorm warning', level: 'warning' },
  '03': { ja: '大雨警報', en: 'Heavy rain warning', level: 'warning' },
  '04': { ja: '洪水警報', en: 'Flood warning', level: 'warning' },
  '05': { ja: '暴風警報', en: 'Storm warning', level: 'warning' },
  '06': { ja: '大雪警報', en: 'Heavy snow warning', level: 'warning' },
  '07': { ja: '波浪警報', en: 'High wave warning', level: 'warning' },
  '08': { ja: '高潮警報', en: 'Storm surge warning', level: 'warning' },
  '10': { ja: '大雨注意報', en: 'Heavy rain advisory', level: 'advisory' },
  '12': { ja: '大雪注意報', en: 'Heavy snow advisory', level: 'advisory' },
  '13': { ja: '風雪注意報', en: 'Wind and snow advisory', level: 'advisory' },
  '14': { ja: '雷注意報', en: 'Thunderstorm advisory', level: 'advisory' },
  '15': { ja: '強風注意報', en: 'Strong wind advisory', level: 'advisory' },
  '16': { ja: '波浪注意報', en: 'High wave advisory', level: 'advisory' },
  '17': { ja: '融雪注意報', en: 'Snowmelt advisory', level: 'advisory' },
  '18': { ja: '洪水注意報', en: 'Flood advisory', level: 'advisory' },
  '19': { ja: '高潮注意報', en: 'Storm surge advisory', level: 'advisory' },
  '20': { ja: '濃霧注意報', en: 'Dense fog advisory', level: 'advisory' },
  '21': { ja: '乾燥注意報', en: 'Dry air advisory', level: 'advisory' },
  '22': { ja: 'なだれ注意報', en: 'Avalanche advisory', level: 'advisory' },
  '23': { ja: '低温注意報', en: 'Low temperature advisory', level: 'advisory' },
  '24': { ja: '霜注意報', en: 'Frost advisory', level: 'advisory' },
  '25': { ja: '着氷注意報', en: 'Icing advisory', level: 'advisory' },
  '26': { ja: '着雪注意報', en: 'Snow accretion advisory', level: 'advisory' },
  '32': { ja: '暴風雪特別警報', en: 'Snowstorm emergency warning', level: 'emergency' },
  '33': { ja: '大雨特別警報', en: 'Heavy rain emergency warning', level: 'emergency' },
  '35': { ja: '暴風特別警報', en: 'Storm emergency warning', level: 'emergency' },
  '36': { ja: '大雪特別警報', en: 'Heavy snow emergency warning', level: 'emergency' },
  '37': { ja: '波浪特別警報', en: 'High wave emergency warning', level: 'emergency' },
  '38': { ja: '高潮特別警報', en: 'Storm surge emergency warning', level: 'emergency' },
}

/** 船に関わりの大きい種類（波・風・高潮・霧・雷）。一覧で先に出す */
const MARINE_CODES = new Set(['02', '05', '07', '08', '13', '14', '15', '16', '19', '20', '32', '35', '37', '38'])

export interface JmaWarning {
  code: string
  name: string
  level: 'advisory' | 'warning' | 'emergency'
  /** 船に関わりの大きい種類 */
  marine: boolean
  status: string
}

export function describeWarning(code: string, status: string, lang: 'ja' | 'en'): JmaWarning {
  const known = NAMES[code]
  return {
    code,
    name: known ? known[lang] : lang === 'ja' ? `注意報・警報（${code}）` : `Advisory/warning (${code})`,
    level: known?.level ?? 'advisory',
    marine: MARINE_CODES.has(code),
    status,
  }
}

export interface AreaTable {
  offices: Record<string, { name: string }>
  class10s: Record<string, { name: string; parent: string }>
  class15s: Record<string, { name: string; parent: string }>
  class20s: Record<string, { name: string; parent: string }>
}

export interface JmaArea {
  /** 気象庁の市区町村の地域コード (7桁) */
  class20: string
  name: string
  /** 府県予報区のコード (6桁) */
  office: string
}

/**
 * 地理院の市区町村コード（5桁）から気象庁の地域を探す。
 * 政令指定都市の区（例: 14101 横浜市西区）は、気象庁では市（1410000 横浜市）単位なので、区の桁を 0 にして探し直す
 */
export function findArea(muniCd: string, table: AreaTable): JmaArea | null {
  const candidates = [`${muniCd}00`, `${muniCd.slice(0, 4)}000`, `${muniCd.slice(0, 3)}0000`]
  for (const code of candidates) {
    const c20 = table.class20s[code]
    if (!c20) continue
    const c15 = table.class15s[c20.parent]
    const c10 = c15 ? table.class10s[c15.parent] : undefined
    if (!c10) continue
    return { class20: code, name: c20.name, office: c10.parent }
  }
  return null
}

interface WarningJson {
  reportDatetime?: string
  areaTypes?: { areas?: { code: string; warnings?: { code?: string; status?: string }[] }[] }[]
}

/** 府県予報区の注意報・警報の JSON から、その市区町村に出ているもの（解除・なしは除く） */
export function warningsFor(json: WarningJson, class20: string, lang: 'ja' | 'en'): { list: JmaWarning[]; reportAt: string | null } {
  const list: JmaWarning[] = []
  for (const type of json.areaTypes ?? []) {
    for (const area of type.areas ?? []) {
      if (area.code !== class20) continue
      for (const w of area.warnings ?? []) {
        if (!w.code || !w.status || w.status === '解除' || w.status.includes('なし')) continue
        list.push(describeWarning(w.code, w.status, lang))
      }
    }
  }
  const rank = { emergency: 0, warning: 1, advisory: 2 }
  list.sort((a, b) => rank[a.level] - rank[b.level] || Number(b.marine) - Number(a.marine))
  return { list, reportAt: json.reportDatetime ?? null }
}

const AREA_URL = 'https://www.jma.go.jp/bosai/common/const/area.json'
const AREA_CACHE_KEY = 'oceanlog-jma-area'

let areaTable: Promise<AreaTable> | null = null

/** 気象庁の地域の表。大きいので一度取ったら端末に保存する（地域の区分はめったに変わらない） */
function loadAreaTable(): Promise<AreaTable> {
  areaTable ??= (async () => {
    try {
      const raw = localStorage.getItem(AREA_CACHE_KEY)
      if (raw) return JSON.parse(raw) as AreaTable
    } catch {
      // 取り直す
    }
    const res = await fetch(AREA_URL)
    if (!res.ok) throw new Error(`jma-area-${res.status}`)
    const full = (await res.json()) as AreaTable
    // 必要な項目だけ保存する
    const slim: AreaTable = { offices: {}, class10s: {}, class15s: {}, class20s: {} }
    for (const [k, v] of Object.entries(full.offices)) slim.offices[k] = { name: v.name }
    for (const key of ['class10s', 'class15s', 'class20s'] as const) {
      for (const [k, v] of Object.entries(full[key])) slim[key][k] = { name: v.name, parent: v.parent }
    }
    try {
      localStorage.setItem(AREA_CACHE_KEY, JSON.stringify(slim))
    } catch {
      // 保存できなくても、その回は使える
    }
    return slim
  })().catch((e: unknown) => {
    areaTable = null
    throw e
  })
  return areaTable
}

/** 位置の市区町村コード（地理院）。海の上など見つからなければ null */
async function muniCode(p: LatLon): Promise<string | null> {
  const res = await fetch(
    `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${p.lat.toFixed(5)}&lon=${p.lon.toFixed(5)}`,
  )
  if (!res.ok) throw new Error(`gsi-reverse-${res.status}`)
  const data = (await res.json()) as { results?: { muniCd?: string } }
  const cd = data.results?.muniCd
  return cd && /^\d{4,5}$/.test(cd) ? cd.padStart(5, '0') : null
}

/** 日本の周辺か（それ以外では気象庁の情報は使わない） */
export function inJapan(p: LatLon): boolean {
  return p.lat > 20 && p.lat < 46.5 && p.lon > 122 && p.lon < 154.5
}

export interface AreaWarnings {
  area: JmaArea
  list: JmaWarning[]
  reportAt: string | null
}

export async function fetchWarnings(p: LatLon, lang: 'ja' | 'en'): Promise<AreaWarnings | null> {
  if (!inJapan(p)) return null
  const cd = await muniCode(p)
  if (!cd) return null
  const area = findArea(cd, await loadAreaTable())
  if (!area) return null
  const res = await fetch(`https://www.jma.go.jp/bosai/warning/data/warning/${area.office}.json`)
  if (!res.ok) throw new Error(`jma-warning-${res.status}`)
  return { area, ...warningsFor((await res.json()) as WarningJson, area.class20, lang) }
}

/** 気象庁のページ（その地域の注意報・警報） */
export function jmaPageUrl(area: JmaArea): string {
  return `https://www.jma.go.jp/bosai/warning/#area_type=class20s&area_code=${area.class20}&lang=ja`
}
