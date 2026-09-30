/**
 * 名刺・バッジの写真を、スキャンした書類のような画像に整える処理。ブラウザ機能に依存しない（テストできる）。
 *
 * 1. detectQuad: 写真の中の、名刺やバッジの四隅を探す（見つからなければ null。画面で四隅を手で直せる）
 * 2. warpQuad: 四隅を長方形に引き伸ばして、斜めから撮った歪みを直す（射影変換）
 * 3. enhanceDocument: 照明のムラを消し、背景を白く、文字を濃くして、読み取りやすくする
 */

export interface Point {
  x: number
  y: number
}

/** 左上・右上・右下・左下 の順 */
export type Quad = [Point, Point, Point, Point]

export interface RGBAImage {
  data: Uint8ClampedArray
  width: number
  height: number
}

export function toGray({ data, width, height }: RGBAImage): Uint8Array {
  const gray = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8
  }
  return gray
}

/** 大津の方法で、明るい部分と暗い部分を分けるしきい値を求める */
export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array<number>(256).fill(0)
  for (const v of gray) hist[v]++
  const total = gray.length
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0
  let wB = 0
  let best = 0
  let threshold = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) {
      best = between
      threshold = t
    }
  }
  return threshold
}

/**
 * 写真の中の名刺・バッジの四隅を探す（小さく縮めた画像で使う）。見つからなければ null。
 *
 * 名刺と背景の見分け方を3通り試し、候補の四角形のうち、四辺が写真の「輪郭（明るさが急に変わる所）」に
 * いちばんよく重なるものを選ぶ:
 * - 明るさ（白い名刺と暗い机など）
 * - 背景の色との違い（写真の外周の色を背景とみなす。明るさが近くても色が違えば分かれる）
 * - 輪郭（白い机の上の白い名刺など、明るさも色も近い場合。名刺の縁の影や段差で囲まれた部分）
 * どれも、中央に最も近いかたまりを名刺とみなし、名刺の文字などでできた穴は埋め、
 * かたまりの外形（凸包）に最もよく合う四角形を四隅とする（斜めに置いた名刺にも合う）。
 */
/** 名刺（91×55mm）の縦横比。長辺÷短辺 */
const CARD_ASPECT = 91 / 55

export function detectDocument(img: RGBAImage): Quad | null {
  const { width, height } = img
  const gray = toGray(img)
  const masks: Uint8Array[] = []

  // 1. 明るさで分ける。中央付近で多い方（明るい・暗い）を名刺の側とする
  const t = otsuThreshold(gray)
  const brightMask = new Uint8Array(gray.length)
  for (let i = 0; i < gray.length; i++) brightMask[i] = gray[i] > t ? 1 : 0
  masks.push(centerMajority(brightMask, width, height) ? brightMask : invert(brightMask))

  // 2. 背景（外周）の色との違いで分ける
  const bg = borderMeanColor(img)
  const colorDist = new Uint8Array(gray.length)
  for (let i = 0, p = 0; i < colorDist.length; i++, p += 4) {
    const d = Math.hypot(img.data[p] - bg[0], img.data[p + 1] - bg[1], img.data[p + 2] - bg[2])
    colorDist[i] = Math.min(255, Math.round(d))
  }
  const td = Math.max(20, otsuThreshold(colorDist))
  const colorMask = new Uint8Array(gray.length)
  for (let i = 0; i < colorDist.length; i++) colorMask[i] = colorDist[i] > td ? 1 : 0
  masks.push(colorMask)

  // 3. 輪郭で囲まれた部分。外周からたどれない（輪郭で囲まれた）所を名刺の側とする
  const grad = gradients(img)
  const edgeThreshold = Math.max(12, percentileOf(grad.mag, 0.9))
  const edges = new Uint8Array(gray.length)
  for (let i = 0; i < edges.length; i++) edges[i] = grad.mag[i] > edgeThreshold ? 1 : 0
  const walls = dilate(edges, width, height, 1)
  // 輪郭の線の太さの分だけ少し大きめになるが、四隅は後で refineQuad が正確に合わせ直す
  masks.push(invert(reachableFromBorder(walls, width, height)))

  // 輪郭と重なっているかを見る時の、輪郭の強さの基準（背景の模様より強い、はっきりした輪郭）
  const supportThreshold = Math.max(10, percentileOf(grad.mag, 0.8))

  const candidates: { quad: Quad; score: number; area: number; support: { mean: number; min: number } }[] = []
  for (const raw of masks) {
    // 名刺の縁まである文字などの小さなすき間を埋めてから（閉じる）、
    // 細いつながり（名刺と背景の境目のかすれ・影）を切り、小さな点を消す（開く）
    const closed = erode(dilate(raw, width, height, 2), width, height, 2)
    const mask = dilate(erode(closed, width, height, 2), width, height, 2)
    const found = shapeNearCenter(mask, width, height)
    if (!found) continue
    const ratio = found.area / (width * height)
    if (ratio < 0.08 || ratio > 0.95) continue
    const quad = quadFromHull(found.hull)
    if (!quad || !plausibleQuad(quad, width, height)) continue
    const qa = quadArea(quad)
    // かたまりの面積と四角形の面積が近いほど「四角らしい」
    const rect = Math.min(found.area, qa) / Math.max(found.area, qa)
    if (rect < 0.8) continue
    // 四辺が輪郭に重なっている割合（いちばん弱い辺も重視する）
    const support = edgeSupport(quad, grad.mag, width, height, supportThreshold)
    // 名刺（91×55mm）の縦横比に近いほど加点する。バッジなど比率が違う場合もあるので、決めつけすぎない強さにする。
    // 背景をぼかすカメラの効果などで、人の腕や輪郭が輪郭検出の候補に混ざった時、名刺らしくない細長い形を選びにくくする
    const w = (dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2
    const h = (dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2
    const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h))
    const aspectFit = 1 / (1 + Math.abs(aspect - CARD_ASPECT))
    const score = support.mean * 0.6 + support.min * 0.4 + rect * 0.3 + aspectFit * 0.4
    candidates.push({ quad, score, area: qa, support })
  }
  if (candidates.length === 0) return null
  candidates.sort((a, b) => b.score - a.score)
  let best = candidates[0]
  // 名刺の縁に色の帯がある場合、帯の内側の境目も強い輪郭なので、帯を除いた少し小さい四角形が選ばれやすい。
  // いちばんの候補をすっぽり囲む少し大きい候補も、輪郭によく重なっていれば、そちらを名刺の外形とする
  for (const c of candidates.slice(1)) {
    const grow = c.area / best.area
    if (grow < 1.02 || grow > 1.35) continue
    if (c.support.mean < 0.8 || c.support.min < 0.6) continue
    if (!best.quad.every((p) => insideQuad(c.quad, p, Math.sqrt(best.area) * 0.02))) continue
    best = c
  }
  return best.quad
}

/** 点 p が四角形 q の内側（tolerance だけ外にはみ出してもよい）にあるか */
function insideQuad(q: Quad, p: Point, tolerance: number): boolean {
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    // 時計回りの四角形では、内側は辺の進む向きの右手（画像の座標）
    const side = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / len
    if (side < -tolerance) return false
  }
  return true
}

/**
 * 色の変わり目の強さ（0〜255 程度）。赤・緑・青のそれぞれで 3×3 のぼかしの後に Sobel フィルターをかけ、
 * いちばん強いものを使う（明るさが同じでも色が違う境目、例えば青い帯と暗い机の境目も見つけられるように）
 */
export function gradients(img: RGBAImage): { mag: Float32Array } {
  const { data, width, height } = img
  const n = width * height
  const mag = new Float32Array(n)
  const channel = new Uint8Array(n)
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < n; i++) channel[i] = data[i * 4 + c]
    const blur = boxBlur(channel, width, height, 1)
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        const a = blur[i - width - 1]
        const b = blur[i - width]
        const cc = blur[i - width + 1]
        const d = blur[i - 1]
        const f = blur[i + 1]
        const g = blur[i + width - 1]
        const h = blur[i + width]
        const k = blur[i + width + 1]
        const sx = cc + 2 * f + k - (a + 2 * d + g)
        const sy = g + 2 * h + k - (a + 2 * b + cc)
        const m = Math.hypot(sx, sy) / 4
        if (m > mag[i]) mag[i] = m
      }
    }
  }
  return { mag }
}

function percentileOf(values: Float32Array, q: number): number {
  // 0〜255 程度の値なので、ヒストグラムで求める
  const bins = new Uint32Array(1024)
  for (const v of values) bins[Math.min(1023, Math.floor(v * 4))]++
  const target = values.length * q
  let acc = 0
  for (let i = 0; i < bins.length; i++) {
    acc += bins[i]
    if (acc >= target) return i / 4
  }
  return 255
}

/** 外周から、壁（印の付いた画素）を通らずにたどれる画素に印を付ける */
function reachableFromBorder(walls: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(walls.length)
  const stack: number[] = []
  const seed = (i: number) => {
    if (!out[i] && !walls[i]) {
      out[i] = 1
      stack.push(i)
    }
  }
  for (let x = 0; x < width; x++) {
    seed(x)
    seed((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    seed(y * width)
    seed(y * width + width - 1)
  }
  while (stack.length > 0) {
    const i = stack.pop()!
    const x = i % width
    const y = (i - x) / width
    if (x > 0) seed(i - 1)
    if (x < width - 1) seed(i + 1)
    if (y > 0) seed(i - width)
    if (y < height - 1) seed(i + width)
  }
  return out
}

/** 名刺らしい四角形か（角度が極端でない・細長すぎない・写真からはみ出していない） */
function plausibleQuad(q: Quad, width: number, height: number): boolean {
  if (quadArea(q) < width * height * 0.05) return false
  for (const p of q) if (p.x < -2 || p.y < -2 || p.x > width + 1 || p.y > height + 1) return false
  for (let i = 0; i < 4; i++) {
    const a = q[(i + 3) % 4]
    const b = q[i]
    const c = q[(i + 1) % 4]
    const v1 = { x: a.x - b.x, y: a.y - b.y }
    const v2 = { x: c.x - b.x, y: c.y - b.y }
    const cos = (v1.x * v2.x + v1.y * v2.y) / (Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y) || 1)
    const deg = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI
    if (deg < 45 || deg > 135) return false
  }
  const w = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2
  const h = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2
  const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h))
  return aspect < 4
}

/** 四角形の各辺のうち、輪郭（明るさの変わり目）に重なっている割合 */
function edgeSupport(q: Quad, mag: Float32Array, width: number, height: number, threshold: number) {
  const perSide: number[] = []
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const len = dist(a, b)
    const n = Math.max(8, Math.round(len / 3))
    // 辺に直角な向き（1画素分）
    const nx = -(b.y - a.y) / (len || 1)
    const ny = (b.x - a.x) / (len || 1)
    let hit = 0
    for (let k = 1; k < n; k++) {
      const x = a.x + ((b.x - a.x) * k) / n
      const y = a.y + ((b.y - a.y) * k) / n
      let m = 0
      for (let o = -2; o <= 2; o++) {
        const xx = Math.round(x + nx * o)
        const yy = Math.round(y + ny * o)
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
        m = Math.max(m, mag[yy * width + xx])
      }
      if (m > threshold) hit++
    }
    perSide.push(hit / (n - 1))
  }
  return { mean: perSide.reduce((x, y) => x + y, 0) / 4, min: Math.min(...perSide) }
}

/**
 * 四隅を、より大きい画像で正確に合わせ直す。各辺の近く（辺に直角に ±range 画素）で明るさの変わり目が
 * いちばん強い所を探し、その点の並びに直線を当てはめ、隣り合う辺の直線の交点を新しい四隅とする。
 * うまく当てはまらない辺は、元のまま
 */
export function refineQuad(img: RGBAImage, quad: Quad): Quad {
  const { width, height } = img
  const { mag } = gradients(img)
  const size = Math.max(width, height)
  const range = Math.max(4, Math.round(size * 0.02))
  const lines: ({ px: number; py: number; dx: number; dy: number } | null)[] = []
  for (let i = 0; i < 4; i++) {
    const a = quad[i]
    const b = quad[(i + 1) % 4]
    const len = dist(a, b)
    if (len < 10) {
      lines.push(null)
      continue
    }
    const ux = (b.x - a.x) / len
    const uy = (b.y - a.y) / len
    // 外向き（時計回りの四角形では、進む向きの左手が外側）
    const nx = uy
    const ny = -ux
    const pts: { x: number; y: number }[] = []
    const n = Math.max(12, Math.round(len / 4))
    // 角の近くは、隣の辺の輪郭が混ざるので使わない
    for (let k = Math.round(n * 0.1); k <= Math.round(n * 0.9); k++) {
      const cx = a.x + ((b.x - a.x) * k) / n
      const cy = a.y + ((b.y - a.y) * k) / n
      const mags: number[] = []
      for (let o = -range; o <= range; o++) {
        const xx = Math.round(cx + nx * o)
        const yy = Math.round(cy + ny * o)
        mags.push(xx < 1 || yy < 1 || xx >= width - 1 || yy >= height - 1 ? 0 : mag[yy * width + xx])
      }
      const bestM = Math.max(...mags)
      if (bestM <= 8) continue
      // いちばん強い所に近い強さの変わり目のうち、いちばん外側（名刺の縁）を選ぶ
      // （名刺の内側の色の帯や文字に吸い寄せられないように）
      let k2 = mags.length - 1
      while (k2 > 0 && mags[k2] < bestM * 0.75) k2--
      // 外側へ山を登りきった所（変わり目の真ん中）
      while (k2 + 1 < mags.length && mags[k2 + 1] > mags[k2]) k2++
      const o = k2 - range
      pts.push({ x: cx + nx * o, y: cy + ny * o })
    }
    lines.push(pts.length >= 6 ? fitLine(pts) : null)
  }
  const out = quad.map((p) => ({ ...p })) as Quad
  for (let i = 0; i < 4; i++) {
    // 角 i は、辺 i-1（前の角から角 i）と辺 i（角 i から次の角）の交点
    const l1 = lines[(i + 3) % 4]
    const l2 = lines[i]
    if (!l1 || !l2) continue
    const p = intersect(l1, l2)
    // 大きく動く（当てはめの失敗）場合は、元のまま
    if (p && dist(p, quad[i]) < range * 2.5) out[i] = p
  }
  return out
}

/** 点の並びに直線を当てはめる（最小二乗。外れた点を除いてもう一度） */
function fitLine(pts: { x: number; y: number }[]) {
  const fit = (ps: { x: number; y: number }[]) => {
    const n = ps.length
    const mx = ps.reduce((s, p) => s + p.x, 0) / n
    const my = ps.reduce((s, p) => s + p.y, 0) / n
    let sxx = 0
    let syy = 0
    let sxy = 0
    for (const p of ps) {
      sxx += (p.x - mx) ** 2
      syy += (p.y - my) ** 2
      sxy += (p.x - mx) * (p.y - my)
    }
    // 主成分の向き
    const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
    return { px: mx, py: my, dx: Math.cos(angle), dy: Math.sin(angle) }
  }
  let line = fit(pts)
  for (let iter = 0; iter < 2; iter++) {
    const d = pts.map((p) => Math.abs((p.x - line.px) * line.dy - (p.y - line.py) * line.dx))
    const sorted = [...d].sort((a, b) => a - b)
    const cut = Math.max(1.5, sorted[Math.floor(sorted.length * 0.7)] * 1.5)
    const kept = pts.filter((_, i) => d[i] <= cut)
    if (kept.length < 6) break
    line = fit(kept)
  }
  return line
}

function intersect(a: { px: number; py: number; dx: number; dy: number }, b: { px: number; py: number; dx: number; dy: number }): Point | null {
  const den = a.dx * b.dy - a.dy * b.dx
  if (Math.abs(den) < 1e-6) return null
  const t = ((b.px - a.px) * b.dy - (b.py - a.py) * b.dx) / den
  return { x: a.px + a.dx * t, y: a.py + a.dy * t }
}

/** 以前の呼び方（グレーの画像だけで探す）。明るさだけで判定する */
export function detectQuad(gray: Uint8Array, width: number, height: number): Quad | null {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < gray.length; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = gray[i]
    data[i * 4 + 3] = 255
  }
  return detectDocument({ data, width, height })
}

function invert(mask: Uint8Array): Uint8Array {
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 0 : 1
  return out
}

/** 中央付近（縦横 40〜60%）で、印の付いた画素が半分以上か */
function centerMajority(mask: Uint8Array, width: number, height: number): boolean {
  let on = 0
  let count = 0
  for (let y = Math.floor(height * 0.4); y < Math.ceil(height * 0.6); y++) {
    for (let x = Math.floor(width * 0.4); x < Math.ceil(width * 0.6); x++) {
      on += mask[y * width + x]
      count++
    }
  }
  return on * 2 >= count
}

/** 写真の外周（幅の 3%）の平均の色。背景の色とみなす */
function borderMeanColor({ data, width, height }: RGBAImage): [number, number, number] {
  const m = Math.max(1, Math.round(Math.min(width, height) * 0.03))
  const sum = [0, 0, 0]
  let n = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= m && x < width - m && y >= m && y < height - m) continue
      const p = (y * width + x) * 4
      sum[0] += data[p]
      sum[1] += data[p + 1]
      sum[2] += data[p + 2]
      n++
    }
  }
  return [sum[0] / n, sum[1] / n, sum[2] / n]
}

/** 縮める（周り r 画素がすべて印付きの画素だけ残す） */
function erode(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  return morph(mask, width, height, r, 0)
}

/** 太らせる（周り r 画素のどれかが印付きなら印を付ける） */
function dilate(mask: Uint8Array, width: number, height: number, r: number): Uint8Array {
  return morph(mask, width, height, r, 1)
}

/** 横・縦の2回に分けて、四角い範囲の最小（keep=0）・最大（keep=1）を取る */
function morph(mask: Uint8Array, width: number, height: number, r: number, keep: 0 | 1): Uint8Array {
  const pass = (src: Uint8Array, horizontal: boolean) => {
    const out = new Uint8Array(src.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let v = keep === 1 ? 0 : 1
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? x + k : x
          const yy = horizontal ? y : y + k
          // 画像の外は、縮める時は印付き（外周に接した名刺を削らない）、太らせる時は印なしとみなす
          const s = xx < 0 || yy < 0 || xx >= width || yy >= height ? 1 - keep : src[yy * width + xx]
          if (s === keep) {
            v = keep
            break
          }
        }
        out[y * width + x] = v
      }
    }
    return out
  }
  return pass(pass(mask, true), false)
}

/**
 * 中央に最も近い、印付きの画素のかたまりを集め、中の穴を埋めた面積と、外形の点（各行の左端・右端）の凸包を返す
 */
function shapeNearCenter(mask: Uint8Array, width: number, height: number): { area: number; hull: Point[] } | null {
  const start = findNearestToCenter(width, height, (i) => mask[i] === 1)
  if (start < 0) return null
  const inShape = new Uint8Array(mask.length)
  const stack = [start]
  inShape[start] = 1
  while (stack.length > 0) {
    const i = stack.pop()!
    const x = i % width
    const y = (i - x) / width
    const visit = (j: number) => {
      if (inShape[j] || !mask[j]) return
      inShape[j] = 1
      stack.push(j)
    }
    if (x > 0) visit(i - 1)
    if (x < width - 1) visit(i + 1)
    if (y > 0) visit(i - width)
    if (y < height - 1) visit(i + width)
  }
  // 穴を埋める: 外周からたどれる「かたまりの外」以外は、すべてかたまりとみなす
  const outside = new Uint8Array(mask.length)
  const queue: number[] = []
  const seed = (i: number) => {
    if (!outside[i] && !inShape[i]) {
      outside[i] = 1
      queue.push(i)
    }
  }
  for (let x = 0; x < width; x++) {
    seed(x)
    seed((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    seed(y * width)
    seed(y * width + width - 1)
  }
  while (queue.length > 0) {
    const i = queue.pop()!
    const x = i % width
    const y = (i - x) / width
    if (x > 0) seed(i - 1)
    if (x < width - 1) seed(i + 1)
    if (y > 0) seed(i - width)
    if (y < height - 1) seed(i + width)
  }
  let area = 0
  const points: Point[] = []
  for (let y = 0; y < height; y++) {
    let left = -1
    let right = -1
    for (let x = 0; x < width; x++) {
      if (outside[y * width + x]) continue
      area++
      if (left < 0) left = x
      right = x
    }
    if (left >= 0) points.push({ x: left, y }, { x: right, y })
  }
  return area > 0 ? { area, hull: convexHull(points) } : null
}

/** 凸包（Andrew の方法）。反時計回り（画像の座標では時計回りに見える）の順 */
export function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (pts.length < 3) return pts
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Point[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Point[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/**
 * 凸包に合う四角形。最も離れた2点（長方形なら対角）と、その線から両側に最も離れた点を四隅とし、
 * 左上・右上・右下・左下の順に並べる
 */
export function quadFromHull(hull: Point[]): Quad | null {
  if (hull.length < 4) return null
  let a = 0
  let b = 1
  let bestD = -1
  for (let i = 0; i < hull.length; i++) {
    for (let j = i + 1; j < hull.length; j++) {
      const d = (hull[i].x - hull[j].x) ** 2 + (hull[i].y - hull[j].y) ** 2
      if (d > bestD) {
        bestD = d
        a = i
        b = j
      }
    }
  }
  const pa = hull[a]
  const pb = hull[b]
  const side = (p: Point) => (pb.x - pa.x) * (p.y - pa.y) - (pb.y - pa.y) * (p.x - pa.x)
  let c: Point | null = null
  let d: Point | null = null
  for (const p of hull) {
    const s = side(p)
    if (s > 0 && (!c || s > side(c))) c = p
    if (s < 0 && (!d || s < side(d))) d = p
  }
  if (!c || !d) return null
  return orderQuad([pa, c, pb, d])
}

/** 凸な四角形の4点（周の順）を、左上から時計回り（画像の座標）に並べ直す */
function orderQuad(pts: Point[]): Quad {
  // 画像の座標（y が下向き）で時計回りにする
  let s = 0
  for (let i = 0; i < 4; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % 4]
    s += p.x * q.y - q.x * p.y
  }
  const cw = s > 0 ? pts : [...pts].reverse()
  let start = 0
  for (let i = 1; i < 4; i++) if (cw[i].x + cw[i].y < cw[start].x + cw[start].y) start = i
  return [0, 1, 2, 3].map((k) => cw[(start + k) % 4]) as Quad
}

function findNearestToCenter(width: number, height: number, inCard: (i: number) => boolean): number {
  const cx = Math.floor(width / 2)
  const cy = Math.floor(height / 2)
  const maxR = Math.floor(Math.min(width, height) / 4)
  for (let r = 0; r <= maxR; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const x = cx + dx
        const y = cy + dy
        if (x < 0 || y < 0 || x >= width || y >= height) continue
        const i = y * width + x
        if (inCard(i)) return i
      }
    }
  }
  return -1
}

export function quadArea(q: Quad): number {
  let s = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

/** 見つからなかった時の四隅（写真の端から少し内側） */
export function defaultQuad(width: number, height: number, inset = 0.06): Quad {
  const dx = width * inset
  const dy = height * inset
  return [
    { x: dx, y: dy },
    { x: width - dx, y: dy },
    { x: width - dx, y: height - dy },
    { x: dx, y: height - dy },
  ]
}

export function scaleQuad(q: Quad, s: number): Quad {
  return q.map((p) => ({ x: p.x * s, y: p.y * s })) as Quad
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)

/** 補正後の画像の大きさ。四辺の長さから決め、長辺は maxSide 以内にする */
export function outputSize(q: Quad, maxSide = 1600): { width: number; height: number } {
  const w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]))
  const h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]))
  const s = Math.min(1, maxSide / Math.max(w, h, 1))
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }
}

/** 8元連立方程式をガウスの消去法で解く */
function solve(a: number[][], b: number[]): number[] {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let pivot = c
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r
    ;[m[c], m[pivot]] = [m[pivot], m[c]]
    const d = m[c][c] || 1e-12
    for (let k = c; k <= n; k++) m[c][k] /= d
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = m[r][c]
      if (f === 0) continue
      for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k]
    }
  }
  return m.map((row) => row[n])
}

/** from の4点を to の4点に移す射影変換の係数（h33 = 1） */
export function homography(from: Quad, to: Quad): number[] {
  const a: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i]
    const { x: u, y: v } = to[i]
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y])
    b.push(u)
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y])
    b.push(v)
  }
  return [...solve(a, b), 1]
}

export function applyHomography(h: number[], p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8]
  return { x: (h[0] * p.x + h[1] * p.y + h[2]) / w, y: (h[3] * p.x + h[4] * p.y + h[5]) / w }
}

/** 元の画像の四隅 quad の部分を、width × height の長方形に引き伸ばす（双線形補間） */
export function warpQuad(src: RGBAImage, quad: Quad, width: number, height: number): RGBAImage {
  const rect: Quad = [
    { x: 0, y: 0 },
    { x: width - 1, y: 0 },
    { x: width - 1, y: height - 1 },
    { x: 0, y: height - 1 },
  ]
  // 出力の各画素が、元の画像のどこに当たるか（出力 → 元 の変換）
  const h = homography(rect, quad)
  const out = new Uint8ClampedArray(width * height * 4)
  const sw = src.width
  const sh = src.height
  const sd = src.data
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = h[6] * x + h[7] * y + h[8]
      let sx = (h[0] * x + h[1] * y + h[2]) / w
      let sy = (h[3] * x + h[4] * y + h[5]) / w
      sx = Math.min(sw - 1.001, Math.max(0, sx))
      sy = Math.min(sh - 1.001, Math.max(0, sy))
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      const fx = sx - x0
      const fy = sy - y0
      const p00 = (y0 * sw + x0) * 4
      const p10 = p00 + 4
      const p01 = p00 + sw * 4
      const p11 = p01 + 4
      const o = (y * width + x) * 4
      for (let c = 0; c < 3; c++) {
        const top = sd[p00 + c] * (1 - fx) + sd[p10 + c] * fx
        const bottom = sd[p01 + c] * (1 - fx) + sd[p11 + c] * fx
        out[o + c] = top * (1 - fy) + bottom * fy
      }
      out[o + 3] = 255
    }
  }
  return { data: out, width, height }
}

/** 各画素の周り (2r+1)×(2r+1) の平均。積分画像で計算する */
export function boxBlur(gray: Uint8Array, width: number, height: number, r: number): Float32Array {
  const iw = width + 1
  const integral = new Float64Array(iw * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x]
      integral[(y + 1) * iw + x + 1] = integral[y * iw + x + 1] + row
    }
  }
  const out = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(height, y + r + 1)
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(width, x + r + 1)
      const s = integral[y1 * iw + x1] - integral[y0 * iw + x1] - integral[y1 * iw + x0] + integral[y0 * iw + x0]
      out[y * width + x] = s / ((x1 - x0) * (y1 - y0))
    }
  }
  return out
}

/**
 * 書類のように整える。照明のムラ（影・反射）を、周りの明るさで割って消し、
 * 背景をほぼ白、文字をはっきり黒くなるようにコントラストを広げる。白黒（グレー）の画像になる。
 */
export function enhanceDocument(img: RGBAImage): RGBAImage {
  const { width, height } = img
  const gray = toGray(img)
  // 文字より十分大きい範囲の明るさを「背景の明るさ」とみなす
  const r = Math.max(8, Math.round(Math.max(width, height) / 20))
  const bg = boxBlur(gray, width, height, r)
  const norm = new Uint8Array(width * height)
  for (let i = 0; i < norm.length; i++) {
    norm[i] = Math.min(255, Math.round((gray[i] / Math.max(1, bg[i])) * 235))
  }
  // 暗い側 2% を黒に、背景の明るさ（書類は大半が背景なので、全体の真ん中の明るさ）より明るい部分を白にそろえる
  const hist = new Array<number>(256).fill(0)
  for (const v of norm) hist[v]++
  const lo = percentile(hist, norm.length * 0.02)
  const hi = Math.max(lo + 1, percentile(hist, norm.length * 0.5) - 4)
  const out = new Uint8ClampedArray(width * height * 4)
  for (let i = 0, p = 0; i < norm.length; i++, p += 4) {
    const t = Math.min(1, Math.max(0, (norm[i] - lo) / (hi - lo)))
    // 少しだけ濃くして、かすれた文字を読みやすくする
    const v = Math.round(255 * Math.pow(t, 1.4))
    out[p] = out[p + 1] = out[p + 2] = v
    out[p + 3] = 255
  }
  return { data: out, width, height }
}

function percentile(hist: number[], target: number): number {
  let acc = 0
  for (let v = 0; v < 256; v++) {
    acc += hist[v]
    if (acc >= target) return v
  }
  return 255
}

/** 90度単位で右に回す（縦書きの名刺や、横向きに撮った写真のため） */
export function rotate90(img: RGBAImage, times: number): RGBAImage {
  const n = ((times % 4) + 4) % 4
  if (n === 0) return img
  let cur = img
  for (let k = 0; k < n; k++) {
    const { data, width, height } = cur
    const out = new Uint8ClampedArray(data.length)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const s = (y * width + x) * 4
        const nx = height - 1 - y
        const ny = x
        const d = (ny * height + nx) * 4
        out[d] = data[s]
        out[d + 1] = data[s + 1]
        out[d + 2] = data[s + 2]
        out[d + 3] = data[s + 3]
      }
    }
    cur = { data: out, width: height, height: width }
  }
  return cur
}
