import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  applyHomography,
  detectDocument,
  detectQuad,
  refineQuad,
  enhanceDocument,
  homography,
  outputSize,
  rotate90,
  warpQuad,
  type Quad,
  type RGBAImage,
} from './document.ts'

/** 暗い背景の中に、明るい平行四辺形（名刺）を置いた画像 */
function syntheticCard(width: number, height: number): Uint8Array {
  const gray = new Uint8Array(width * height).fill(40)
  for (let y = 20; y < 80; y++) {
    const shift = Math.round((y - 20) * 0.2)
    for (let x = 30 + shift; x < 130 + shift; x++) gray[y * width + x] = 220
  }
  // 名刺の中の文字（暗い点）
  for (let x = 60; x < 90; x++) gray[50 * width + x] = 30
  return gray
}

test('名刺の四隅を見つける', () => {
  const quad = detectQuad(syntheticCard(200, 100), 200, 100)
  assert.ok(quad)
  assertNear(
    quad,
    [
      { x: 30, y: 20 },
      { x: 129, y: 20 },
      { x: 141, y: 79 },
      { x: 42, y: 79 },
    ],
    // 小さい画像での大まかな検出（正確な位置は refineQuad で合わせ直す）
    4,
  )
})

test('背景と区別できない（一面同じ明るさ）場合は null', () => {
  assert.equal(detectQuad(new Uint8Array(100 * 100).fill(128), 100, 100), null)
})

test('射影変換は4点を正しく移す', () => {
  const from: Quad = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 50 },
    { x: 0, y: 50 },
  ]
  const to: Quad = [
    { x: 10, y: 5 },
    { x: 120, y: 12 },
    { x: 110, y: 70 },
    { x: 3, y: 60 },
  ]
  const h = homography(from, to)
  for (let i = 0; i < 4; i++) {
    const p = applyHomography(h, from[i])
    assert.ok(Math.abs(p.x - to[i].x) < 1e-6 && Math.abs(p.y - to[i].y) < 1e-6)
  }
})

test('補正後の大きさは、四辺の長い方に合わせ、長辺を上限以内にする', () => {
  const q: Quad = [
    { x: 0, y: 0 },
    { x: 3000, y: 0 },
    { x: 3000, y: 1800 },
    { x: 0, y: 1800 },
  ]
  assert.deepEqual(outputSize(q, 1600), { width: 1600, height: 960 })
})

function solid(width: number, height: number, v: number): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data[i] = data[i + 1] = data[i + 2] = v
  return { data, width, height }
}

test('台形補正で、四隅の内側の色を取り出す', () => {
  const src = solid(50, 50, 0)
  for (let y = 10; y < 40; y++) for (let x = 10; x < 40; x++) src.data[(y * 50 + x) * 4] = 200
  const q: Quad = [
    { x: 12, y: 12 },
    { x: 37, y: 12 },
    { x: 37, y: 37 },
    { x: 12, y: 37 },
  ]
  const out = warpQuad(src, q, 20, 20)
  assert.equal(out.width, 20)
  for (let i = 0; i < out.data.length; i += 4) assert.equal(out.data[i], 200)
})

test('書類化で、影のある背景は白に、文字は黒になる', () => {
  const w = 80
  const h = 40
  const img = solid(w, h, 0)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 左から右へ暗くなる背景（影）
      const bg = 200 - x
      const text = y >= 18 && y <= 21 && x >= 20 && x <= 60
      const v = text ? bg * 0.3 : bg
      const p = (y * w + x) * 4
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v
    }
  }
  const out = enhanceDocument(img)
  const at = (x: number, y: number) => out.data[(y * w + x) * 4]
  assert.ok(at(5, 5) > 230, 'left background should be white')
  assert.ok(at(75, 35) > 230, 'shadowed background should be white')
  assert.ok(at(40, 19) < 60, 'text should be dark')
})

test('90度回すと、幅と高さが入れ替わる', () => {
  const img = solid(3, 2, 0)
  img.data[0] = 255 // 左上
  const r = rotate90(img, 1)
  assert.equal(r.width, 2)
  assert.equal(r.height, 3)
  // 右に回すと、左上は右上に来る
  assert.equal(r.data[1 * 4], 255)
  assert.equal(rotate90(img, 4), img)
})

/** 背景色 bg の上に、四角形 poly を色 fg で塗った画像。text が true なら中に暗い文字の帯を入れる */
function scene(width: number, height: number, bg: number[], fg: number[], poly: Quad, text = false): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4)
  const inside = (x: number, y: number) => {
    let sign = 0
    for (let i = 0; i < 4; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % 4]
      const c = Math.sign((b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x))
      if (c !== 0) {
        if (sign === 0) sign = c
        else if (c !== sign) return false
      }
    }
    return true
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4
      let c = inside(x + 0.5, y + 0.5) ? fg : bg
      // 名刺の中の文字（横長の暗い帯）
      if (text && c === fg && y % 12 < 4 && x % 40 < 30) c = [20, 20, 20]
      data[p] = c[0]
      data[p + 1] = c[1]
      data[p + 2] = c[2]
      data[p + 3] = 255
    }
  }
  return { data, width, height }
}

function rotatedRect(cx: number, cy: number, w: number, h: number, deg: number): Quad {
  const r = (deg * Math.PI) / 180
  const pts = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => ({ x: cx + x * Math.cos(r) - y * Math.sin(r), y: cy + x * Math.sin(r) + y * Math.cos(r) }))
  return pts as Quad
}

function assertNear(found: Quad | null, expected: Quad, tol: number) {
  assert.ok(found, 'quad should be found')
  // 同じ角同士で比べる（並びは左上から時計回り）
  const sorted = (q: Quad) => [...q].sort((a, b) => a.x + a.y - (b.x + b.y))
  const f = sorted(found)
  const e = sorted(expected)
  for (let i = 0; i < 4; i++) {
    const d = Math.hypot(f[i].x - e[i].x, f[i].y - e[i].y)
    assert.ok(d <= tol, `corner ${i}: found (${f[i].x},${f[i].y}) expected (${e[i].x.toFixed(1)},${e[i].y.toFixed(1)})`)
  }
}

test('斜めに置いた名刺（30度）の四隅を見つける', () => {
  const card = rotatedRect(160, 120, 170, 100, 30)
  assertNear(detectDocument(scene(320, 240, [50, 50, 55], [235, 235, 230], card)), card, 5)
})

test('縦向き（ポートレート）の名刺も見つける', () => {
  const card = rotatedRect(160, 120, 100, 166, -6) // 91×55mm の名刺を縦向きに置いた比率
  assertNear(detectDocument(scene(320, 240, [60, 65, 70], [238, 236, 230], card)), card, 5)
})

test('明るさが近くても、背景と色が違えば見つける（青い机の上のベージュの名刺）', () => {
  const card = rotatedRect(160, 120, 190, 110, -8)
  assertNear(detectDocument(scene(320, 240, [70, 110, 190], [190, 170, 120], card)), card, 5)
})

test('文字が多い名刺でも、文字の穴で形が崩れない', () => {
  const card = rotatedRect(160, 120, 200, 120, 5)
  assertNear(detectDocument(scene(320, 240, [40, 40, 40], [240, 240, 240], card, true)), card, 5)
})

test('影で背景の明るさにムラがあっても見つける', () => {
  const card = rotatedRect(160, 120, 180, 110, 12)
  const img = scene(320, 240, [90, 90, 90], [230, 228, 222], card)
  // 右下へ行くほど暗くなる影
  for (let y = 0; y < 240; y++) {
    for (let x = 0; x < 320; x++) {
      const p = (y * 320 + x) * 4
      const k = 1 - (x + y) / 1400
      for (let c = 0; c < 3; c++) img.data[p + c] = img.data[p + c] * k
    }
  }
  assertNear(detectDocument(img), card, 6)
})

test('四隅を大きい画像で合わせ直すと、1.5 画素以内に合う（縁に色の帯がある名刺も、帯の外側の縁に合わせる）', () => {
  const card = rotatedRect(500, 380, 560, 340, 9)
  const img = scene(1000, 760, [70, 60, 50], [245, 245, 240], card)
  // 左の縁に緑の帯（名刺の一部）を入れる
  const [tl, , , bl] = card
  for (let y = 0; y < 760; y++) {
    for (let x = 0; x < 1000; x++) {
      const t = ((x - tl.x) * (bl.y - tl.y) - (y - tl.y) * (bl.x - tl.x)) / Math.hypot(bl.x - tl.x, bl.y - tl.y)
      const p = (y * 1000 + x) * 4
      if (img.data[p] === 245 && t < 0 && t > -24) {
        img.data[p] = 15
        img.data[p + 1] = 118
        img.data[p + 2] = 110
      }
    }
  }
  // 大まかな四隅（10 画素ほどずれている）から合わせ直す
  const rough = card.map((p, i) => ({ x: p.x + (i % 2 ? 8 : -9), y: p.y + (i < 2 ? 7 : -6) })) as Quad
  assertNear(refineQuad(img, rough), card, 1.5)
})
