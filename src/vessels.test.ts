import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boxAround, closestApproach, isCloseApproach, parseVessels, vesselAt, vesselKind } from './vessels.ts'

test('船種番号を分類する', () => {
  assert.equal(vesselKind(60), 'passenger')
  assert.equal(vesselKind(69), 'passenger')
  assert.equal(vesselKind(70), 'cargo')
  assert.equal(vesselKind(84), 'tanker')
  assert.equal(vesselKind(30), 'fishing')
  assert.equal(vesselKind(37), 'pleasure')
  assert.equal(vesselKind(52), 'service')
  assert.equal(vesselKind(40), 'fast')
  assert.equal(vesselKind(0), 'other')
})

test('中心の周りの範囲は 0.1 度単位で、少し動いても同じ', () => {
  assert.equal(boxAround({ lat: 35.31, lon: 139.62 }), '35.0,139.3,35.6,139.9')
  assert.equal(boxAround({ lat: 35.34, lon: 139.64 }), '35.0,139.3,35.6,139.9')
  const [s, w, n, e] = boxAround({ lat: -0.04, lon: 179.6 }).split(',').map(Number)
  assert.ok(n - s <= 1 && e - w <= 1)
})

test('中継サーバーの応答を読み、向きがなければ前回の位置から推定する', () => {
  const now = 1_000_000
  const first = parseVessels({ now, ships: [[1, 'A', 35, 139, 10, 90, null, 70, 'TOKYO', 5, 120], [2, '', 35.1, 139.1, null, null, null, 0, '', 0, null]] })
  assert.equal(first[0].heading, 90)
  assert.equal(first[0].moving, true)
  assert.equal(first[0].kind, 'cargo')
  assert.equal(first[0].at, now - 5000)
  assert.equal(first[1].moving, false)
  assert.equal(first[1].heading, null)
  const second = parseVessels({ now, ships: [[2, '', 35.11, 139.1, null, null, null, 0, '', 0, null]] }, first)
  assert.ok(Math.abs((second[0].heading ?? -1) - 0) < 1, '北へ動いた')
})

test('航行中の船は速力と針路で位置を進める（3分まで）', () => {
  const v = parseVessels({ now: 0, ships: [[1, 'A', 35, 139, 10, 0, null, 70, '', 0, null]] })[0]
  const p = vesselAt(v, 60_000)
  // 10 kn で 1 分 ≒ 309m 北へ
  assert.ok(Math.abs((p.lat - 35) * 111_320 - 308.7) < 2)
  const far = vesselAt(v, 600_000)
  assert.ok(Math.abs((far.lat - 35) * 111_320 - 926) < 3)
})

test('最接近: 向かい合って近づく船と、離れていく船', () => {
  // 自分は北へ 10 kn、相手は 1 海里北から南へ 10 kn → 3 分後にぶつかる
  const head = closestApproach({ lat: 35, lon: 139, knots: 10, course: 0 }, { lat: 35 + 1852 / 111_320, lon: 139, knots: 10, course: 180 })
  assert.ok(head.meters < 5)
  assert.ok(Math.abs(head.minutes - 3) < 0.05)
  assert.ok(isCloseApproach(head))
  // 相手は 1 海里北から北へ 20 kn → 離れていく
  const away = closestApproach({ lat: 35, lon: 139, knots: 10, course: 0 }, { lat: 35 + 1852 / 111_320, lon: 139, knots: 20, course: 0 })
  assert.equal(away.minutes, 0)
  assert.ok(Math.abs(away.meters - 1852) < 2)
  assert.ok(!isCloseApproach(away))
  // 自分が止まっていても、相手が近づけば分かる
  const still = closestApproach({ lat: 35, lon: 139, knots: null, course: null }, { lat: 35, lon: 139.01, knots: 5, course: 270 })
  assert.ok(still.meters < 5 && still.minutes > 0)
})
