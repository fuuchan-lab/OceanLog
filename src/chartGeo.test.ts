import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fitChart, inverseMercator, mercator, parseUserCharts, type ControlPoint } from './chartGeo.ts'

// メルカトル図法で、少し回転・傾けて撮った海図の写真を作り、基準点から元に戻せるか
const project = (lat: number, lon: number) => {
  const m = mercator({ lat, lon })
  // 画像: 1m あたり 0.05 画素、10°回転、少し遠近（射影）
  const a = (10 * Math.PI) / 180
  const x0 = (m.x - 15_540_000) * 0.05
  const y0 = -(m.y - 4_180_000) * 0.05
  const x = x0 * Math.cos(a) - y0 * Math.sin(a) + 800
  const y = x0 * Math.sin(a) + y0 * Math.cos(a) + 600
  const w = 1 + x * 0.00002
  return { px: x / w, py: y / w }
}
const pt = (id: string, lat: number, lon: number): ControlPoint => ({ id, lat, lon, ...project(lat, lon) })

test('メルカトルの座標は行って戻ると同じ', () => {
  const p = inverseMercator(mercator({ lat: 35.2, lon: 139.6 }).x, mercator({ lat: 35.2, lon: 139.6 }).y)
  assert.ok(Math.abs(p.lat - 35.2) < 1e-9 && Math.abs(p.lon - 139.6) < 1e-9)
})

test('4点で、遠近のゆがみがある写真でも位置が合う', () => {
  const pts = [pt('a', 35.25, 139.55), pt('b', 35.25, 139.68), pt('c', 35.12, 139.68), pt('d', 35.12, 139.55)]
  const tr = fitChart(pts)
  assert.ok(tr)
  assert.equal(tr.kind, 'projective')
  assert.ok(tr.rms < 0.5, `rms ${tr.rms}`)
  const q = project(35.18, 139.61)
  const p = tr.toPixel({ lat: 35.18, lon: 139.61 })
  assert.ok(Math.hypot(p.x - q.px, p.y - q.py) < 0.5)
  const back = tr.toLatLon(q.px, q.py)
  assert.ok(Math.abs(back.lat - 35.18) < 1e-5 && Math.abs(back.lon - 139.61) < 1e-5)
})

test('3点ではアフィン変換。基準点が足りなければ null', () => {
  const pts = [pt('a', 35.25, 139.55), pt('b', 35.25, 139.68), pt('c', 35.12, 139.6)]
  assert.equal(fitChart(pts)?.kind, 'affine')
  assert.equal(fitChart(pts.slice(0, 2)), null)
})

test('入力を間違えた基準点は、ずれが大きく出る', () => {
  const pts = [pt('a', 35.25, 139.55), pt('b', 35.25, 139.68), pt('c', 35.12, 139.68), pt('d', 35.12, 139.55), { ...pt('e', 35.2, 139.6), lat: 35.21 }]
  const tr = fitChart(pts)
  assert.ok(tr)
  assert.ok(Math.max(...tr.errors) > 300, String(tr.errors))
})

test('一直線に並んだ基準点では解けない', () => {
  const pts = [pt('a', 35.1, 139.5), pt('b', 35.2, 139.6), pt('c', 35.3, 139.7)]
  assert.equal(fitChart(pts), null)
})

test('保存した海図を読む（壊れた値は除く）', () => {
  const list = parseUserCharts([{ id: 'x', name: '相模湾', width: 100, height: 80, points: [{ id: 'p', px: 1, py: 2, lat: 35, lon: 139 }, { id: 'q' }], createdAt: 5 }, { name: 'bad' }])
  assert.equal(list.length, 1)
  assert.equal(list[0].points.length, 1)
})
