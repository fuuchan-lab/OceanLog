import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkReturn, shouldRecord, splitSegments } from './voyage.ts'

test('1分おきに記録し、誤差の大きい位置は使わない', () => {
  assert.equal(shouldRecord(null, { t: 0, accuracy: 10 }), true)
  assert.equal(shouldRecord({ t: 0 }, { t: 59_000, accuracy: 10 }), false)
  assert.equal(shouldRecord({ t: 0 }, { t: 60_000, accuracy: 10 }), true)
  assert.equal(shouldRecord(null, { t: 0, accuracy: 80 }), false)
})

test('出港地点から離れてから戻ると、自動で帰港', () => {
  const start = { lat: 35, lon: 139 }
  const near = { lat: 35.0003, lon: 139, accuracy: 10 } // 約33m
  const far = { lat: 35.01, lon: 139, accuracy: 10 } // 約1.1km
  // 離れる前は、近くにいても帰港にしない
  assert.equal(checkReturn({ start, maxFromStart: 0 }, near).returned, false)
  const out = checkReturn({ start, maxFromStart: 0 }, far)
  assert.equal(out.returned, false)
  assert.ok(out.maxFromStart > 1000)
  assert.equal(checkReturn({ start, maxFromStart: out.maxFromStart }, near).returned, true)
  // 出港地点が分からなければ判定しない
  assert.equal(checkReturn({ start: null, maxFromStart: 5000 }, near).returned, false)
})

test('記録がない区間で分ける', () => {
  const pts = [0, 60, 120, 1000, 1060].map((s) => ({ t: s * 1000 }))
  assert.deepEqual(
    splitSegments(pts).map((s) => s.length),
    [3, 2],
  )
})
