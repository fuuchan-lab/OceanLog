import assert from 'node:assert/strict'
import { test } from 'node:test'
import { moonInfo, sunTimes, tideName } from './sun.ts'

const hm = (ms: number | null) => {
  assert.ok(ms !== null)
  // 日本時間 (UTC+9) の時:分
  const d = new Date(ms + 9 * 3_600_000)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

test('東京の春分ごろの日の出・日の入りは 5:45・17:53 前後', () => {
  const s = sunTimes(Date.UTC(2026, 2, 20, 3), 35.68, 139.77)
  assert.ok(Math.abs(hm(s.sunrise) - (5 * 60 + 45)) <= 4, String(hm(s.sunrise)))
  assert.ok(Math.abs(hm(s.sunset) - (17 * 60 + 53)) <= 4, String(hm(s.sunset)))
  assert.ok(s.dawn !== null && s.sunrise !== null && s.dawn < s.sunrise)
})

test('極夜では日の出がない', () => {
  const s = sunTimes(Date.UTC(2026, 11, 21, 12), 80, 0)
  assert.equal(s.sunrise, null)
})

test('月齢: 2026-01-03 の満月ごろは約15日', () => {
  const m = moonInfo(Date.UTC(2026, 0, 3, 10))
  assert.ok(m.age > 13.5 && m.age < 16, String(m.age))
  assert.ok(m.illumination > 0.95)
  assert.equal(tideName(m.age), 'spring')
})

test('潮の呼び名', () => {
  assert.equal(tideName(0.2), 'spring')
  assert.equal(tideName(8.5), 'neap')
  assert.equal(tideName(10.1), 'long')
  assert.equal(tideName(11.9), 'young')
  assert.equal(tideName(29.4), 'spring')
})
