/**
 * 航海の記録のきまり。ブラウザ機能に依存しない。
 * - 記録中は1分おきに位置を記録する（海図に点で表示）
 * - 出港地点から一度離れ（DEPART_M 以上）、また近くに戻ってきたら（RETURN_M 以内）、自動で帰港にする
 * - ウェブアプリは、画面に開いている間しか位置を受け取れない。閉じていた間は点がなく、次に開いた時から続く
 */
import { distance, type LatLon } from './geo.ts'

/** 点を記録する間隔 */
export const RECORD_INTERVAL_MS = 60_000
/** これ以上離れたら「出港した」とみなす (m) */
export const DEPART_M = 300
/** 出港した後、出港地点のこれ以内に戻ったら自動で帰港にする (m) */
export const RETURN_M = 100
/** これより誤差の大きい位置は使わない (m) */
export const MAX_ACCURACY_M = 50
/** 点の間がこれ以上あいたら、アプリを閉じていた（記録がない）区間とみなす */
export const GAP_MS = 5 * 60_000

export function shouldRecord(prev: { t: number } | null, fix: { t: number; accuracy: number }): boolean {
  if (fix.accuracy > MAX_ACCURACY_M) return false
  return prev === null || fix.t - prev.t >= RECORD_INTERVAL_MS
}

export interface VoyageState {
  start: LatLon | null
  /** 出港地点から最も離れた距離 (m) */
  maxFromStart: number
}

/** 位置が届くたびに、出港地点からの最大距離を更新し、帰港したかを判定する */
export function checkReturn(state: VoyageState, fix: LatLon & { accuracy: number }): { maxFromStart: number; returned: boolean } {
  if (!state.start || fix.accuracy > MAX_ACCURACY_M) return { maxFromStart: state.maxFromStart, returned: false }
  const d = distance(state.start, fix)
  const maxFromStart = Math.max(state.maxFromStart, d)
  return { maxFromStart, returned: maxFromStart >= DEPART_M && d <= RETURN_M }
}

/** 点の並びを、記録がない区間（GAP_MS 以上あいた所）で分ける。区間の中は線で、区間の間は点線で結ぶ */
export function splitSegments<T extends { t: number }>(points: T[]): T[][] {
  const out: T[][] = []
  for (const p of points) {
    const cur = out.at(-1)
    if (cur && p.t - (cur.at(-1) as T).t < GAP_MS) cur.push(p)
    else out.push([p])
  }
  return out
}
