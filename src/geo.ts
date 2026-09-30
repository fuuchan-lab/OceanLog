/** 位置・距離・方位の計算と表示。ブラウザ機能に依存しない */

export interface LatLon {
  lat: number
  lon: number
}

/** 地球の半径 (m) */
const R = 6_371_000
/** 1海里 (m) */
export const NM = 1852
const toRad = (d: number) => (d * Math.PI) / 180
const toDeg = (r: number) => (r * 180) / Math.PI

/** 2点間の距離 (m)。大圏距離 */
export function distance(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** a から b への方位 (度、真方位。北=0 時計回り) */
export function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat))
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon))
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

/** 点の並びの合計距離 (m) */
export function pathLength(points: LatLon[]): number {
  let sum = 0
  for (let i = 1; i < points.length; i++) sum += distance(points[i - 1], points[i])
  return sum
}

/** 34°12.345'N のような、海図で使う「度・分（小数）」の表記 */
export function formatDM(value: number, isLat: boolean, digits = 3): string {
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W'
  const abs = Math.abs(value)
  let deg = Math.floor(abs)
  let min = Number(((abs - deg) * 60).toFixed(digits))
  // 丸めで 60.000' になったら繰り上げる
  if (min >= 60) {
    deg += 1
    min = 0
  }
  const degText = isLat ? String(deg).padStart(2, '0') : String(deg).padStart(3, '0')
  return `${degText}°${min.toFixed(digits).padStart(digits + 3, '0')}'${hemi}`
}

export function formatPosition(p: LatLon): string {
  return `${formatDM(p.lat, true)} ${formatDM(p.lon, false)}`
}

const COMPASS_JA = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西']
const COMPASS_EN = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

/** 方位（度）を16方位の名前にする */
export function compassPoint(deg: number, lang: 'ja' | 'en'): string {
  const i = Math.round((((deg % 360) + 360) % 360) / 22.5) % 16
  return (lang === 'ja' ? COMPASS_JA : COMPASS_EN)[i]
}

/** m/s → ノット */
export const msToKnots = (ms: number) => (ms * 3600) / NM

export type WindUnit = 'ms' | 'kn' | 'kmh'

export function convertWind(ms: number, unit: WindUnit): number {
  if (unit === 'kn') return msToKnots(ms)
  if (unit === 'kmh') return ms * 3.6
  return ms
}

export const WIND_UNIT_LABEL: Record<WindUnit, string> = { ms: 'm/s', kn: 'kn', kmh: 'km/h' }

/** 風速 (m/s) からビューフォート風力階級 (0〜12) */
export function beaufort(ms: number): number {
  const limits = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7]
  const i = limits.findIndex((l) => ms < l)
  return i === -1 ? 12 : i
}

/** 「35.1234」「35°12.345'N」「35 12.345 N」のどれでも、度（小数）にする */
export function parseCoord(text: string, isLat: boolean): number | null {
  const s = text.trim().toUpperCase().replace(/[°'′"]/g, ' ')
  const neg = /[SW]$/.test(s) || s.startsWith('-')
  const nums = s.replace(/[NSEW-]/g, ' ').trim().split(/\s+/).filter(Boolean).map(Number)
  if (nums.length === 0 || nums.some((n) => !Number.isFinite(n))) return null
  const value = nums[0] + (nums[1] ?? 0) / 60 + (nums[2] ?? 0) / 3600
  const signed = neg ? -value : value
  return Math.abs(signed) <= (isLat ? 90 : 180) ? signed : null
}

