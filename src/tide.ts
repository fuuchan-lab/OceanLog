/**
 * 潮位（1時間ごとの海面の高さ）から、満潮・干潮の時刻と高さを求める。ブラウザ機能に依存しない。
 * 1時間ごとの値の山・谷を見つけ、前後の3点を通る放物線で、本当の山・谷の時刻と高さを補う。
 */
import type { SeaLevelPoint } from './weather.ts'

export interface TideExtreme {
  kind: 'high' | 'low'
  /** epoch ms */
  t: number
  /** 平均海面からの高さ (m) */
  h: number
}

/** これより小さい揺れは、満潮・干潮として数えない (m) */
const MIN_RANGE = 0.03

export function findExtremes(points: SeaLevelPoint[]): TideExtreme[] {
  // まず1時間ごとの値のままで山・谷を探す
  let raw: TideExtreme[] = []
  for (let i = 1; i < points.length - 1; i++) {
    const [a, b, c] = [points[i - 1], points[i], points[i + 1]]
    if (b.h > a.h && b.h >= c.h) raw.push({ kind: 'high', t: b.t, h: b.h })
    else if (b.h < a.h && b.h <= c.h) raw.push({ kind: 'low', t: b.t, h: b.h })
  }
  // ごく小さな揺れ（隣の山・谷との差が小さい組）を取り除き、同じ種類が続いたら目立つほうを残す
  for (;;) {
    const i = raw.findIndex((x, k) => k < raw.length - 1 && Math.abs(x.h - raw[k + 1].h) < MIN_RANGE)
    if (i === -1) break
    raw.splice(i, 2)
    raw = mergeSameKind(raw)
  }
  // 前後の3点を通る放物線の頂点で、時刻と高さを細かくする
  return mergeSameKind(raw).map((x) => {
    const i = points.findIndex((p) => p.t === x.t)
    const [a, b, c] = [points[i - 1], points[i], points[i + 1]]
    const denom = a.h - 2 * b.h + c.h
    const offset = denom === 0 ? 0 : (0.5 * (a.h - c.h)) / denom
    return { kind: x.kind, t: Math.round(b.t + offset * (c.t - b.t)), h: b.h - 0.25 * (a.h - c.h) * offset }
  })
}

function mergeSameKind(list: TideExtreme[]): TideExtreme[] {
  const out: TideExtreme[] = []
  for (const x of list) {
    const prev = out.at(-1)
    if (prev && prev.kind === x.kind) {
      if ((x.kind === 'high' && x.h > prev.h) || (x.kind === 'low' && x.h < prev.h)) out[out.length - 1] = x
    } else out.push(x)
  }
  return out
}

/** 時刻 t の潮位 (m)。前後の点から直線で補う。範囲外は null */
export function levelAt(points: SeaLevelPoint[], t: number): number | null {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (t >= a.t && t <= b.t) return a.h + ((b.h - a.h) * (t - a.t)) / (b.t - a.t)
  }
  return null
}

export interface TideState {
  /** 上げ潮 / 下げ潮 */
  direction: 'rising' | 'falling'
  /** 次の満潮または干潮 */
  next: TideExtreme
}

export function tideState(extremes: TideExtreme[], now: number): TideState | null {
  const next = extremes.find((x) => x.t > now)
  if (!next) return null
  return { direction: next.kind === 'high' ? 'rising' : 'falling', next }
}
