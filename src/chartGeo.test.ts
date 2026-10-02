import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chartCorners, fitChart, inverseMercator, mercator, parseUserCharts, pointsCoverage, polygonAreaKm2, polygonContains, type ControlPoint } from './chartGeo.ts'

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

test('基準点が4つ未満なら合わせない', () => {
  const pts = [pt('a', 35.25, 139.55), pt('b', 35.25, 139.68), pt('c', 35.12, 139.6)]
  assert.equal(fitChart(pts), null)
})

test('5点以上なら、1つずつ外して確かめた見込みの精度も出す', () => {
  const pts = [pt('a', 35.25, 139.55), pt('b', 35.25, 139.68), pt('c', 35.12, 139.68), pt('d', 35.12, 139.55), pt('e', 35.19, 139.62)]
  const tr = fitChart(pts)
  assert.ok(tr && tr.expected !== null && tr.expected < 1, String(tr?.expected))
  assert.equal(fitChart(pts.slice(0, 4))?.expected, null)
})

test('8点以上なら、レンズのゆがみ（たる型）も直して、海図全体で合う', () => {
  // たる型のゆがみを加えた写真
  const warp = (lat: number, lon: number) => {
    const q = project(lat, lon)
    const dx = q.px - 800
    const dy = q.py - 600
    const k = 1 + 4e-8 * (dx * dx + dy * dy)
    return { px: 800 + dx * k, py: 600 + dy * k }
  }
  const at = (id: string, lat: number, lon: number): ControlPoint => ({ id, lat, lon, ...warp(lat, lon) })
  const grid: ControlPoint[] = []
  for (const lat of [35.12, 35.185, 35.25]) for (const lon of [139.55, 139.615, 139.68]) grid.push(at(`${lat}-${lon}`, lat, lon))
  const curved = fitChart(grid)
  const flat = fitChart(grid, false)
  assert.equal(curved?.kind, 'curved')
  assert.equal(flat?.kind, 'projective')
  // 海図全体（基準点の間）で比べる
  let eCurved = 0
  let eFlat = 0
  let n = 0
  for (let lat = 35.13; lat <= 35.24; lat += 0.02) {
    for (let lon = 139.56; lon <= 139.67; lon += 0.02) {
      const truth = warp(lat, lon)
      const c = curved!.toPixel({ lat, lon })
      const f = flat!.toPixel({ lat, lon })
      eCurved += Math.hypot(c.x - truth.px, c.y - truth.py)
      eFlat += Math.hypot(f.x - truth.px, f.y - truth.py)
      n++
    }
  }
  assert.ok(eCurved / n < (eFlat / n) * 0.6, `curved ${eCurved / n} flat ${eFlat / n}`)
  const test = { lat: 35.15, lon: 139.58 }
  const truth = warp(test.lat, test.lon)
  // 行って戻ると同じ
  const px = curved!.toPixel(test)
  const back = curved!.toLatLon(px.x, px.y)
  assert.ok(Math.abs(back.lat - test.lat) < 1e-7 && Math.abs(back.lon - test.lon) < 1e-7, JSON.stringify(back))
  void truth
})

test('海図の四隅・面積・中にあるか', () => {
  const pts = [pt('a', 35.25, 139.55), pt('b', 35.25, 139.68), pt('c', 35.12, 139.68), pt('d', 35.12, 139.55)]
  const tr = fitChart(pts)!
  const corners = chartCorners({ width: 1600, height: 1200 }, tr)
  assert.ok(polygonContains(corners, { lat: 35.18, lon: 139.61 }))
  assert.ok(!polygonContains(corners, { lat: 36, lon: 139.61 }))
  assert.ok(polygonAreaKm2(corners) > 1)
  assert.ok(pointsCoverage({ width: 1600, height: 1200 }, pts) > 0)
})

test('入力を間違えた基準点は、ずれが大きく出る', () => {
  const pts = [pt('a', 35.25, 139.55), pt('b', 35.25, 139.68), pt('c', 35.12, 139.68), pt('d', 35.12, 139.55), { ...pt('e', 35.2, 139.6), lat: 35.21 }]
  const tr = fitChart(pts)
  assert.ok(tr)
  assert.ok(Math.max(...tr.errors) > 300, String(tr.errors))
})

test('一直線に並んだ基準点では解けない', () => {
  const pts = [pt('a', 35.1, 139.5), pt('b', 35.2, 139.6), pt('c', 35.3, 139.7), pt('d', 35.25, 139.65)]
  assert.equal(fitChart(pts), null)
})

test('保存した海図を読む（壊れた値は除く）', () => {
  const list = parseUserCharts([{ id: 'x', name: '相模湾', width: 100, height: 80, points: [{ id: 'p', px: 1, py: 2, lat: 35, lon: 139 }, { id: 'q' }], createdAt: 5 }, { name: 'bad' }])
  assert.equal(list.length, 1)
  assert.equal(list[0].points.length, 1)
})
