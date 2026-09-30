import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCoord, bearing, beaufort, compassPoint, distance, formatDM, NM, pathLength } from './geo.ts'

test('緯度1分はおよそ1海里', () => {
  const d = distance({ lat: 35, lon: 139 }, { lat: 35 + 1 / 60, lon: 139 })
  assert.ok(Math.abs(d / NM - 1) < 0.01, String(d))
})

test('方位: 真北は0度、真東は約90度', () => {
  assert.ok(Math.abs(bearing({ lat: 35, lon: 139 }, { lat: 36, lon: 139 })) < 1e-9)
  assert.ok(Math.abs(bearing({ lat: 0, lon: 139 }, { lat: 0, lon: 140 }) - 90) < 1e-9)
})

test('度・分の表記', () => {
  assert.equal(formatDM(34.5, true), "34°30.000'N")
  assert.equal(formatDM(-0.25, true), "00°15.000'S")
  assert.equal(formatDM(139.99999999, false), "140°00.000'E")
  assert.equal(formatDM(-70.1, false, 2), "070°06.00'W")
})

test('16方位', () => {
  assert.equal(compassPoint(0, 'ja'), '北')
  assert.equal(compassPoint(359, 'en'), 'N')
  assert.equal(compassPoint(225, 'en'), 'SW')
  assert.equal(compassPoint(-90, 'ja'), '西')
})

test('ビューフォート階級', () => {
  assert.equal(beaufort(0), 0)
  assert.equal(beaufort(5), 3)
  assert.equal(beaufort(40), 12)
})

test('経路の長さ', () => {
  const p = [{ lat: 35, lon: 139 }, { lat: 35 + 1 / 60, lon: 139 }, { lat: 35 + 2 / 60, lon: 139 }]
  assert.ok(Math.abs(pathLength(p) / NM - 2) < 0.02)
})

test('座標の入力: 度（小数）・度分・南緯西経', () => {
  assert.equal(parseCoord('35.5', true), 35.5)
  assert.ok(Math.abs((parseCoord("35°12.345'N", true) ?? 0) - (35 + 12.345 / 60)) < 1e-9)
  assert.equal(parseCoord('33 30 S', true), -33.5)
  assert.equal(parseCoord('-70.25', false), -70.25)
  assert.equal(parseCoord('95', true), null)
  assert.equal(parseCoord('abc', true), null)
})
