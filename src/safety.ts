/**
 * 航海の安全の目安。ブラウザ機能に依存しない。
 * - 出航地の潮位が「干潮危険潮位」を下回るまでの時間
 * - 日没・薄明の終わりまでの時間
 * - 出航地に戻るのにかかる時間と、遅くとも帰路につく時刻
 * - 予報の波高が、ボートの「危険な波の高さ」を超える時刻
 */
import { distance, NM, type LatLon } from './geo.ts'
import type { Boat, HomePort } from './profile.ts'
import type { SeaLevelPoint } from './weather.ts'

const MIN = 60_000

export interface Crossing {
  /** 潮位が危険潮位を下回る時刻（今すでに下回っていれば null） */
  dropAt: number | null
  /** 今下回っている場合、危険潮位を上回る（回復する）時刻 */
  recoverAt: number | null
  /** 今、危険潮位を下回っている */
  belowNow: boolean
  /** 今の潮位（潮位表の基準, m）。分からなければ null */
  levelNow: number | null
}

/** 予報の潮位（平均水面が 0）を、港の潮位表の基準に直した系列 */
export function portLevels(port: HomePort, seaLevel: SeaLevelPoint[]): SeaLevelPoint[] {
  return seaLevel.map((p) => ({ t: p.t, h: p.h + port.z0 }))
}

/** 危険潮位を下回る・上回る時刻を、前後の点の直線補間で求める */
export function tideCrossing(levels: SeaLevelPoint[], danger: number, now: number): Crossing {
  const i = levels.findIndex((p) => p.t > now)
  if (i <= 0) return { dropAt: null, recoverAt: null, belowNow: false, levelNow: null }
  const a = levels[i - 1]
  const b = levels[i]
  const levelNow = a.h + ((b.h - a.h) * (now - a.t)) / (b.t - a.t)
  const belowNow = levelNow < danger
  const cross = (p: SeaLevelPoint, q: SeaLevelPoint) => p.t + ((danger - p.h) / (q.h - p.h)) * (q.t - p.t)
  let prev: SeaLevelPoint = { t: now, h: levelNow }
  for (let k = i; k < levels.length; k++) {
    const cur = levels[k]
    if (!belowNow && prev.h >= danger && cur.h < danger) return { dropAt: cross(prev, cur), recoverAt: null, belowNow, levelNow }
    if (belowNow && prev.h < danger && cur.h >= danger) return { dropAt: null, recoverAt: cross(prev, cur), belowNow, levelNow }
    prev = cur
  }
  return { dropAt: null, recoverAt: null, belowNow, levelNow }
}

/** 帰港の速さの目安 (ノット)。最高速度の7割。分からなければ 10 ノット */
export function cruiseKnots(boat: Boat): number {
  return boat.maxSpeed && boat.maxSpeed > 0 ? boat.maxSpeed * 0.7 : 10
}

/** 出航地までの直線距離 (m) と、戻るのにかかる時間 (ms)。直線より長くなるので 1.2 倍にする */
export function returnEstimate(here: LatLon, port: HomePort, boat: Boat): { distance: number; duration: number } {
  const d = distance(here, port)
  const hours = (d * 1.2) / NM / cruiseKnots(boat)
  return { distance: d, duration: hours * 3_600_000 }
}

export interface WaveRisk {
  level: 'none' | 'caution' | 'warning'
  /** 危険な波高（caution は8割）に初めて達する時刻 */
  at: number | null
  /** 見ている範囲の最大波高 (m) */
  max: number | null
}

/** 今後 hours 時間の波高予報から、ボートにとって危険になる時刻を探す */
export function waveRisk(
  waves: { t: number; height: number | null }[],
  dangerWave: number | null,
  now: number,
  hours = 12,
): WaveRisk {
  const ahead = waves.filter((w) => w.t >= now - 30 * MIN && w.t <= now + hours * 3_600_000 && w.height !== null)
  const max = ahead.length ? Math.max(...ahead.map((w) => w.height as number)) : null
  if (!dangerWave || dangerWave <= 0 || max === null) return { level: 'none', at: null, max }
  const over = ahead.find((w) => (w.height as number) >= dangerWave)
  if (over) return { level: 'warning', at: over.t, max }
  const near = ahead.find((w) => (w.height as number) >= dangerWave * 0.8)
  if (near) return { level: 'caution', at: near.t, max }
  return { level: 'none', at: null, max }
}

export type Level = 'ok' | 'info' | 'caution' | 'warning'

/** 残り時間から警告の強さ。1時間を切ったら warning、2時間を切ったら caution */
export function urgency(remainingMs: number | null): Level {
  if (remainingMs === null) return 'ok'
  if (remainingMs <= 60 * MIN) return 'warning'
  if (remainingMs <= 120 * MIN) return 'caution'
  return 'info'
}

/**
 * 遅くとも帰路につく時刻。危険潮位・日没のうち早いほうから、戻るのにかかる時間と余裕（15分）を引く
 */
export function latestDeparture(deadlines: (number | null)[], returnMs: number): { at: number; deadline: number } | null {
  const valid = deadlines.filter((d): d is number => d !== null)
  if (valid.length === 0) return null
  const deadline = Math.min(...valid)
  return { at: deadline - returnMs - 15 * MIN, deadline }
}

/** 残り時間を「1時間25分」のように分けるための時・分 */
export function splitDuration(ms: number): { h: number; m: number } {
  const total = Math.max(0, Math.round(ms / MIN))
  return { h: Math.floor(total / 60), m: total % 60 }
}

/** 日の出・潮のボタンに「！」を付けるか: 出航地が危険潮位を下回っている・2時間以内に下回る */
export function tideAlert(c: Crossing, now: number): boolean {
  return c.belowNow || (c.dropAt !== null && c.dropAt - now <= 120 * MIN)
}

/**
 * 日没の警告: 「日出から日没まで」の航行限定の船だけ。日没まで2時間を切ったら（出港中なら日没後も）
 */
export function sunsetAlert(sunset: number | null, now: number, daylightOnly: boolean, underway: boolean): boolean {
  if (!daylightOnly || sunset === null) return false
  if (sunset <= now) return underway
  return sunset - now <= 120 * MIN
}
