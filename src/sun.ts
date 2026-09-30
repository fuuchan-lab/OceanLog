/**
 * 日の出・日の入り・薄明と月齢を、端末の中で計算する（外部のサービスを使わないので、電波がなくても分かる）。
 * 計算式は、広く使われている天文計算（SunCalc と同じ近似式、誤差はおおむね1〜2分）。
 */

const DAY_MS = 86_400_000
const J1970 = 2440588
const J2000 = 2451545
const rad = Math.PI / 180
const e = rad * 23.4397
const J0 = 0.0009

const toJulian = (ms: number) => ms / DAY_MS - 0.5 + J1970
const fromJulian = (j: number) => (j + 0.5 - J1970) * DAY_MS
const toDays = (ms: number) => toJulian(ms) - J2000

const solarMeanAnomaly = (d: number) => rad * (357.5291 + 0.98560028 * d)
function eclipticLongitude(M: number) {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
  return M + C + rad * 102.9372 + Math.PI
}
const declination = (l: number) => Math.asin(Math.sin(e) * Math.sin(l))
const julianCycle = (d: number, lw: number) => Math.round(d - J0 - lw / (2 * Math.PI))
const approxTransit = (Ht: number, lw: number, n: number) => J0 + (Ht + lw) / (2 * Math.PI) + n
const solarTransitJ = (ds: number, M: number, L: number) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L)
const hourAngle = (h: number, phi: number, d: number) =>
  Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(d)) / (Math.cos(phi) * Math.cos(d)))

export interface SunTimes {
  /** 南中 (epoch ms) */
  noon: number
  /** 日の出・日の入り。白夜・極夜で起きない日は null */
  sunrise: number | null
  sunset: number | null
  /** 市民薄明の始まり・終わり（太陽が地平線の下 6°）。航海灯の点灯の目安 */
  dawn: number | null
  dusk: number | null
}

/**
 * 指定した日（day はその日の中の任意の時刻。端末の時刻の正午を渡すとよい）の日の出・日の入りなど
 */
export function sunTimes(day: number, lat: number, lon: number): SunTimes {
  const lw = rad * -lon
  const phi = rad * lat
  const d = toDays(day)
  const n = julianCycle(d, lw)
  const ds = approxTransit(0, lw, n)
  const M = solarMeanAnomaly(ds)
  const L = eclipticLongitude(M)
  const dec = declination(L)
  const Jnoon = solarTransitJ(ds, M, L)

  const pair = (angle: number): [number | null, number | null] => {
    const w = hourAngle(angle * rad, phi, dec)
    if (Number.isNaN(w)) return [null, null]
    const Jset = solarTransitJ(approxTransit(w, lw, n), M, L)
    return [fromJulian(Jnoon - (Jset - Jnoon)), fromJulian(Jset)]
  }
  const [sunrise, sunset] = pair(-0.833)
  const [dawn, dusk] = pair(-6)
  return { noon: fromJulian(Jnoon), sunrise, sunset, dawn, dusk }
}

/** 朔望月 (日) */
const SYNODIC = 29.530588853
/** 基準の新月 (2000-01-06 18:14 UTC) のユリウス日 */
const NEW_MOON_JD = 2451550.26

export interface MoonInfo {
  /** 月齢 (日, 0〜29.5) */
  age: number
  /** 輝いている割合 (0〜1) */
  illumination: number
  /** 絵文字 */
  icon: string
}

export function moonInfo(ms: number): MoonInfo {
  const jd = toJulian(ms) + 0.5
  const phase = ((((jd - NEW_MOON_JD) / SYNODIC) % 1) + 1) % 1
  const age = phase * SYNODIC
  const illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2
  const icons = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘']
  return { age, illumination, icon: icons[Math.round(phase * 8) % 8] }
}

export type TideName = 'spring' | 'middle' | 'neap' | 'long' | 'young'

// 月齢（日）ごとの潮の呼び名（日本の釣り・潮見表で一般的な区分）。index = 月齢の整数部
const TIDE_BY_AGE: TideName[] = [
  'spring', 'spring', 'spring', 'middle', 'middle', 'middle', 'middle', 'neap', 'neap', 'neap',
  'long', 'young', 'middle', 'middle', 'spring', 'spring', 'spring', 'spring', 'middle', 'middle',
  'middle', 'middle', 'neap', 'neap', 'neap', 'long', 'young', 'middle', 'middle', 'spring',
]

/** 大潮・中潮・小潮・長潮・若潮（月齢からの目安） */
export function tideName(age: number): TideName {
  return TIDE_BY_AGE[Math.min(29, Math.max(0, Math.floor(age)))]
}
