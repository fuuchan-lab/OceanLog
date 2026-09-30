import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NM } from './geo.ts'
import type { HomePort } from './profile.ts'
import { sunsetAlert, tideAlert, latestDeparture, portLevels, returnEstimate, splitDuration, tideCrossing, urgency, waveRisk } from './safety.ts'

const HOUR = 3_600_000
const port: HomePort = { id: 'p', name: '港', lat: 35, lon: 139, z0: 1, dangerLevel: 0.6 }
// 平均水面からの潮位: 0h 0, 1h -0.2, 2h -0.5, 3h -0.6, 4h -0.3, 5h 0
const raw = [0, -0.2, -0.5, -0.6, -0.3, 0].map((h, i) => ({ t: i * HOUR, h }))

test('Z0 を足して潮位表の基準にする', () => {
  assert.deepEqual(
    portLevels(port, raw).map((p) => Number(p.h.toFixed(2))),
    [1, 0.8, 0.5, 0.4, 0.7, 1],
  )
})

test('危険潮位を下回る時刻を補間で求める', () => {
  const c = tideCrossing(portLevels(port, raw), 0.6, 0)
  assert.equal(c.belowNow, false)
  assert.ok(c.dropAt !== null && Math.abs(c.dropAt / HOUR - (1 + 2 / 3)) < 1e-9)
})

test('今下回っていれば、回復する時刻を返す', () => {
  const c = tideCrossing(portLevels(port, raw), 0.6, 2.5 * HOUR)
  assert.equal(c.belowNow, true)
  assert.ok(c.recoverAt !== null && Math.abs(c.recoverAt / HOUR - (3 + 2 / 3)) < 1e-9)
})

test('帰港にかかる時間: 10海里を最高 25 ノットの7割で、直線の1.2倍', () => {
  const here = { lat: 35 + 10 / 60, lon: 139 }
  const { duration } = returnEstimate(here, port, { name: '', length: null, beam: null, horsepower: null, maxSpeed: 25, dangerWave: null })
  assert.ok(Math.abs(duration / HOUR - (10 * 1.2) / 17.5) < 0.01)
  void NM
})

test('波高の危険', () => {
  const waves = [0.5, 0.9, 1.3, 1.6].map((height, i) => ({ t: i * HOUR, height }))
  assert.equal(waveRisk(waves, 1.5, 0).level, 'warning')
  assert.equal(waveRisk(waves, 1.5, 0).at, 3 * HOUR)
  assert.equal(waveRisk(waves.slice(0, 3), 1.5, 0).level, 'caution')
  assert.equal(waveRisk(waves, null, 0).level, 'none')
  assert.equal(waveRisk(waves, 1.5, 0).max, 1.6)
})

test('残り時間と警告の強さ、帰路につく時刻', () => {
  assert.equal(urgency(30 * 60_000), 'warning')
  assert.equal(urgency(90 * 60_000), 'caution')
  assert.equal(urgency(5 * HOUR), 'info')
  assert.equal(urgency(null), 'ok')
  assert.deepEqual(latestDeparture([5 * HOUR, 3 * HOUR, null], HOUR), { at: 2 * HOUR - 15 * 60_000, deadline: 3 * HOUR })
  assert.equal(latestDeparture([null], HOUR), null)
  assert.deepEqual(splitDuration(85 * 60_000), { h: 1, m: 25 })
})

test('日没・干満の「！」: 危険潮位と、航行限定の船の日没', () => {
  assert.equal(tideAlert({ dropAt: HOUR, recoverAt: null, belowNow: false, levelNow: 1 }, 0), true)
  assert.equal(tideAlert({ dropAt: 3 * HOUR, recoverAt: null, belowNow: false, levelNow: 1 }, 0), false)
  assert.equal(tideAlert({ dropAt: null, recoverAt: HOUR, belowNow: true, levelNow: 0.3 }, 0), true)
  assert.equal(sunsetAlert(HOUR, 0, true, false), true)
  assert.equal(sunsetAlert(HOUR, 0, false, true), false)
  assert.equal(sunsetAlert(3 * HOUR, 0, true, true), false)
  assert.equal(sunsetAlert(-HOUR, 0, true, false), false)
  assert.equal(sunsetAlert(-HOUR, 0, true, true), true)
})
