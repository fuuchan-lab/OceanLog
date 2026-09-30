import assert from 'node:assert/strict'
import { test } from 'node:test'
import { markPoints, trendSeries } from './forecast.ts'
import type { PressureForecast } from './weather.ts'

const HOUR = 3_600_000
const MIN15 = 15 * 60_000
// 15分の境界に合わせた「今」
const NOW = Date.UTC(2026, 8, 20, 12, 0)

function forecast(overrides: Partial<PressureForecast> = {}): PressureForecast {
  // 6時間前から12時間後まで15分ごと。気圧は 1000 + 経過時間(h)
  const fine = Array.from({ length: (6 + 12) * 4 + 1 }, (_, i) => {
    const t = NOW - 6 * HOUR + i * MIN15
    return { t, hpa: 1000 + (t - NOW) / HOUR }
  })
  const series = Array.from({ length: 19 }, (_, i) => {
    const t = NOW - 6 * HOUR + i * HOUR
    return { t, hpa: 1000 + (t - NOW) / HOUR, code: 0, isDay: true }
  })
  return { current: 1000, weather: { code: 0, isDay: true, temperature: 20, humidity: 50 }, series, fine, ...overrides }
}

test('trendSeries は直前6時間〜今後12時間を15分刻みで返し、今の点を1つだけ含む', () => {
  const s = trendSeries(forecast(), NOW)
  assert.equal(s[0].hours, -6)
  assert.equal(s.at(-1)?.hours, 12)
  assert.equal(s.length, (6 + 12) * 4 + 1)
  assert.equal(s.filter((p) => p.hours === 0).length, 1)
  assert.deepEqual(
    s.map((p) => p.hours),
    [...s.map((p) => p.hours)].sort((a, b) => a - b),
  )
})

test('trendSeries は今の点に現在の気圧を使う', () => {
  const s = trendSeries(forecast({ current: 1003.4 }), NOW)
  assert.equal(s.find((p) => p.hours === 0)?.hpa, 1003.4)
})

test('trendSeries は15分間隔のデータがなければ1時間ごとのデータを使う', () => {
  const s = trendSeries(forecast({ fine: [] }), NOW)
  assert.equal(s.length, 6 + 12 + 1)
  assert.equal(s[0].hours, -6)
})

test('trendSeries は範囲外の点を含めない', () => {
  const f = forecast()
  f.fine.push({ t: NOW + 13 * HOUR, hpa: 999 }, { t: NOW - 7 * HOUR, hpa: 999 })
  const s = trendSeries(f, NOW)
  assert.ok(s.every((p) => p.hours >= -6 && p.hours <= 12))
})

test('markPoints は2時間ごと(-6〜+12h)の10点を選び、今は現在の気圧の点にする', () => {
  const marks = markPoints(trendSeries(forecast({ current: 1003.4 }), NOW))
  assert.deepEqual(
    marks.map((m) => m.hours),
    [-6, -4, -2, 0, 2, 4, 6, 8, 10, 12],
  )
  assert.equal(marks.find((m) => m.hours === 0)?.point.hpa, 1003.4)
  assert.equal(marks.find((m) => m.hours === 4)?.point.hpa, 1004)
})

test('markPoints は今が15分の境目にない時も、最も近い点を選ぶ', () => {
  const now = NOW + 6 * 60_000 // 12:06
  const f = forecast()
  const marks = markPoints(trendSeries(f, now))
  assert.equal(marks.length, 10)
  // 範囲の下限 (06:06) より前の 06:00 は含まれないので、-6h の点は 06:15 (-5.85h)。15分刻みなので誤差は 0.25h 以内
  assert.ok(Math.abs(marks[0].point.hours - -6) <= 0.25)
  assert.equal(marks[0].hours, -6)
})

test('markPoints は近く(±0.5h)にデータがない時刻を含めない', () => {
  const points = [
    { hours: -2.2, hpa: 999 },
    { hours: -1, hpa: 1000 },
    { hours: 0, hpa: 1001 },
    { hours: 1, hpa: 1002 },
    { hours: 2.3, hpa: 1003 },
  ]
  assert.deepEqual(
    markPoints(points).map((m) => m.hours),
    [-2, 0, 2],
  )
  // -1h と +1h は、2時間ごとの目盛り(-2,0,2)から 1h 離れているので選ばれない
  assert.deepEqual(markPoints([{ hours: -1, hpa: 1000 }, { hours: 1, hpa: 1002 }]), [])
})
