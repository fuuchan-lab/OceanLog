import assert from 'node:assert/strict'
import { test } from 'node:test'
import { monotonePath, type Pt } from './smoothPath.ts'

/** "M x,y C c1x,c1y c2x,c2y x,y C …" を数値の並びに戻す */
function parse(d: string): { start: Pt; segments: { c1: Pt; c2: Pt; end: Pt }[] } {
  const [head, ...rest] = d.split('C').map((s) => s.trim())
  const pair = (s: string): Pt => {
    const [x, y] = s.split(',').map(Number)
    return { x, y }
  }
  return {
    start: pair(head.slice(1)),
    segments: rest.map((seg) => {
      const [c1, c2, end] = seg.split(' ').map(pair)
      return { c1, c2, end }
    }),
  }
}

test('点が0個・1個でも壊れない', () => {
  assert.equal(monotonePath([]), '')
  assert.equal(monotonePath([{ x: 3, y: 4 }]), 'M3.0,4.0')
})

test('すべての点をそのまま通る', () => {
  const pts = [
    { x: 0, y: 10 },
    { x: 10, y: 4 },
    { x: 25, y: 20 },
    { x: 30, y: 18 },
  ]
  const { start, segments } = parse(monotonePath(pts))
  assert.deepEqual(start, pts[0])
  assert.deepEqual(
    segments.map((s) => s.end),
    pts.slice(1),
  )
})

test('山・谷で行き過ぎない（制御点が、隣り合う2点の高さの範囲に収まる）', () => {
  // 急な山と谷のある並び。普通のなめらかな曲線だと、山の上や谷の下に膨らんでしまう
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 20, y: 5 },
    { x: 30, y: 5 },
    { x: 40, y: 0 },
    { x: 50, y: 0 },
  ]
  const { segments } = parse(monotonePath(pts))
  segments.forEach((seg, i) => {
    const lo = Math.min(pts[i].y, pts[i + 1].y)
    const hi = Math.max(pts[i].y, pts[i + 1].y)
    for (const c of [seg.c1, seg.c2]) {
      assert.ok(c.y >= lo - 0.05 && c.y <= hi + 0.05, `区間${i}: ${c.y} が ${lo}〜${hi} の外`)
    }
  })
})

test('直線上の点は、直線のまま', () => {
  const pts = [0, 1, 2, 3].map((i) => ({ x: i * 10, y: i * 5 }))
  const { segments } = parse(monotonePath(pts))
  for (const seg of segments) {
    // 座標は小数1桁に丸めて出力するので、傾き 0.5 との差は丸め誤差の範囲で見る
    assert.ok(Math.abs((seg.c2.y - seg.c1.y) / (seg.c2.x - seg.c1.x) - 0.5) < 0.05)
  }
})
