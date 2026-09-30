import assert from 'node:assert/strict'
import { test } from 'node:test'
import { findExtremes, levelAt, tideState } from './tide.ts'

const HOUR = 3_600_000
// 半日周潮（周期 12.42時間、振幅 0.8m）。最初の満潮は 3.1時間後
const PERIOD = 12.42
const series = Array.from({ length: 49 }, (_, i) => ({ t: i * HOUR, h: 0.8 * Math.cos((2 * Math.PI * (i - 3.1)) / PERIOD) }))

test('満潮・干潮が交互に見つかり、時刻は1時間ごとの値より細かく求まる', () => {
  const x = findExtremes(series)
  assert.ok(x.length >= 7)
  for (let i = 1; i < x.length; i++) assert.notEqual(x[i].kind, x[i - 1].kind)
  assert.equal(x[0].kind, 'high')
  assert.ok(Math.abs(x[0].t / HOUR - 3.1) < 0.1, String(x[0].t / HOUR))
  assert.ok(Math.abs(x[0].h - 0.8) < 0.02)
  assert.equal(x[1].kind, 'low')
  assert.ok(Math.abs(x[1].t / HOUR - (3.1 + PERIOD / 2)) < 0.1)
})

test('小さな揺れは数えない', () => {
  const flat = [1, 0.5, 0, 0.01, 0, 0.5, 1, 0.5, 0.2].map((h, i) => ({ t: i * HOUR, h }))
  const x = findExtremes(flat)
  assert.deepEqual(
    x.map((e) => e.kind),
    ['low', 'high'],
  )
})

test('潮位の補間と、上げ潮・下げ潮', () => {
  assert.equal(levelAt([{ t: 0, h: 0 }, { t: HOUR, h: 1 }], HOUR / 2), 0.5)
  assert.equal(levelAt([{ t: 0, h: 0 }], HOUR), null)
  const x = findExtremes(series)
  assert.equal(tideState(x, 0)?.direction, 'rising')
  assert.equal(tideState(x, 5 * HOUR)?.direction, 'falling')
})
