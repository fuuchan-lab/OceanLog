import type { PressureForecast } from './weather.ts'

const HOUR = 3_600_000

export interface TrendPoint {
  /** 現在からの時間 (h)。負は過去 */
  hours: number
  hpa: number
}

/** 推移グラフに出す範囲: 直前6時間〜今後12時間 */
export const TREND_PAST_HOURS = 6
export const TREND_FUTURE_HOURS = 12

/** 推移グラフの点の間隔。Open-Meteo の細かい系列 (15分ごと) をそのまま使う */
const STEP = 15 * 60_000

/**
 * 推移グラフ用の系列（15分刻み）。「今」の点（現在の気圧）を加えて時間順に返す。
 * 15分間隔のデータがない地域では1時間ごとのデータを使う。
 */
export function trendSeries(f: PressureForecast, now: number): TrendPoint[] {
  const source = f.fine.length > 0 ? f.fine : f.series
  const points = source
    .filter(
      (p) =>
        p.t % STEP === 0 &&
        p.t >= now - TREND_PAST_HOURS * HOUR &&
        p.t <= now + TREND_FUTURE_HOURS * HOUR &&
        p.t !== now,
    )
    .map((p) => ({ hours: (p.t - now) / HOUR, hpa: p.hpa }))
  points.push({ hours: 0, hpa: f.current })
  return points.sort((x, y) => x.hours - y.hours)
}

export interface Mark {
  /** 目盛りの時刻（現在からの時間 h）。-6, -4, ... のように stepHours ごと */
  hours: number
  /** その時刻に最も近い系列の点 */
  point: TrendPoint
}

/**
 * 系列から、stepHours ごと（既定は2時間ごと）の点を選ぶ。丸と数値を付ける位置になる。
 * 「今」は現在の気圧の点そのもの。近くにデータがない時刻は含めない。
 */
export function markPoints(points: TrendPoint[], stepHours = 2): Mark[] {
  if (points.length === 0) return []
  const marks: Mark[] = []
  for (let h = -TREND_PAST_HOURS; h <= TREND_FUTURE_HOURS; h += stepHours) {
    const nearest = points.reduce((best, p) => (Math.abs(p.hours - h) < Math.abs(best.hours - h) ? p : best))
    if (Math.abs(nearest.hours - h) <= 0.5) marks.push({ hours: h, point: nearest })
  }
  return marks
}
