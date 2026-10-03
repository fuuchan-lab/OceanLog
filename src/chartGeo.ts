/**
 * 自分で撮影・アップロードした海図の、画像の位置（画素）と緯度経度の対応（ジオリファレンス）。
 * 海図はメルカトル図法なので、緯度経度をメルカトルの座標にしてから、画像の画素へ移す変換を求める。
 * 変形の方法（回転・拡大縮小 / アフィン / 射影 / 曲がりの補正）は、基準点の数に応じて交差検証で選ぶ。最小二乗で合わせる
 */
import type { LatLon } from './geo.ts'

/** 基準点: 画像の上の位置（画素）と、その場所の緯度経度 */
export interface ControlPoint {
  id: string
  px: number
  py: number
  lat: number
  lon: number
}

/** 登録した海図 */
export interface UserChart {
  /** 画像の写真の ID（photos に保存。ドライブにも同期） */
  id: string
  name: string
  width: number
  height: number
  points: ControlPoint[]
  /** どの出航地のまわりの海図か（出航地の設定から追加した時） */
  portId: string | null
  createdAt: number
}

/** 位置合わせに必要な基準点の数（射影変換に4点） */
export const MIN_POINTS = 4
/** 基準点の散らばり（短い方向 / 長い方向）がこれより小さいと、一直線に近いとみなす */
const MIN_SPREAD = 0.15

const R = 6_378_137
const rad = Math.PI / 180

/** 緯度経度 → メルカトル図法の座標 (m) */
export function mercator(p: LatLon): { x: number; y: number } {
  return { x: R * p.lon * rad, y: R * Math.log(Math.tan(Math.PI / 4 + (p.lat * rad) / 2)) }
}

export function inverseMercator(x: number, y: number): LatLon {
  return { lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) / rad, lon: x / R / rad }
}

/** 連立方程式（最小二乗の正規方程式）をガウスの消去法で解く */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let pivot = c
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r
    if (Math.abs(m[pivot][c]) < 1e-12) return null
    ;[m[c], m[pivot]] = [m[pivot], m[c]]
    const d = m[c][c]
    for (let k = c; k <= n; k++) m[c][k] /= d
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = m[r][c]
      if (f !== 0) for (let k = c; k <= n; k++) m[r][k] -= f * m[c][k]
    }
  }
  return m.map((row) => row[n])
}

/** 最小二乗: 行列 rows（各行 n 個）と値 values から、未知数 n 個を求める */
function leastSquares(rows: number[][], values: number[]): number[] | null {
  const n = rows[0].length
  const ata = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const atb = new Array<number>(n).fill(0)
  rows.forEach((r, k) => {
    for (let i = 0; i < n; i++) {
      atb[i] += r[i] * values[k]
      for (let j = 0; j < n; j++) ata[i][j] += r[i] * r[j]
    }
  })
  return solve(ata, atb)
}

/** 画像の位置と緯度経度を行き来する変換 */
export interface ChartTransform {
  toPixel: (p: LatLon) => { x: number; y: number }
  toLatLon: (x: number, y: number) => LatLon
  /** 各基準点のずれ（m）。その点を外して合わせ直した時のずれ（入力の間違いが分かる） */
  errors: number[]
  /** ずれの平均（m） */
  rms: number
  /**
   * 見込みの精度（m）: 基準点を1つずつ外して合わせ直し、外した点がどれだけずれるか（交差検証）の平均。
   * 基準点の上だけでなく、海図全体での確かさの目安
   */
  expected: number | null
  kind: ModelKind
}

/** 曲がりの補正（レンズのゆがみ・紙のたわみ）を試す、基準点の数 */
export const CURVED_MIN_POINTS = 10
/** 基準点のおすすめの数 */
export const RECOMMENDED_POINTS = 6

type Pt = { x: number; y: number }

const normOf = (ps: Pt[]) => {
  const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length
  const cy = ps.reduce((s, p) => s + p.y, 0) / ps.length
  const sc = Math.max(...ps.map((p) => Math.hypot(p.x - cx, p.y - cy)), 1e-9)
  return { cx, cy, sc }
}

const applyH = (m: number[], x: number, y: number): Pt => {
  const w = m[6] * x + m[7] * y + m[8]
  return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w }
}

/**
 * 薄板スプライン（TPS）: 点 ps での値 vs を、なめらかにつなぐ関数。smooth が大きいほど、点に合わせきらずになめらかにする
 */
function tps(ps: Pt[], vs: number[], smooth = 1e-3): ((p: Pt) => number) | null {
  const n = ps.length
  const U = (r2: number) => (r2 < 1e-20 ? 0 : r2 * Math.log(r2) * 0.5)
  const size = n + 3
  const a = Array.from({ length: size }, () => new Array<number>(size).fill(0))
  const b = new Array<number>(size).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = ps[i].x - ps[j].x
      const dy = ps[i].y - ps[j].y
      a[i][j] = U(dx * dx + dy * dy) + (i === j ? smooth : 0)
    }
    a[i][n] = a[n][i] = 1
    a[i][n + 1] = a[n + 1][i] = ps[i].x
    a[i][n + 2] = a[n + 2][i] = ps[i].y
    b[i] = vs[i]
  }
  const w = solve(a, b)
  if (!w || w.some((v) => !Number.isFinite(v))) return null
  return (p) => {
    let v = w[n] + w[n + 1] * p.x + w[n + 2] * p.y
    for (let i = 0; i < n; i++) {
      const dx = p.x - ps[i].x
      const dy = p.y - ps[i].y
      v += w[i] * U(dx * dx + dy * dy)
    }
    return v
  }
}

/** 変形の方法（下ほど自由度が高い）。自由度が高いほど基準点にぴったり合うが、点の入力のずれで海図全体がゆがみやすい */
export type ModelKind = 'similarity' | 'affine' | 'projective' | 'curved'

/** それぞれの変形を試す、基準点の数（交差検証で確かめられる数） */
const KIND_MIN_POINTS: Record<ModelKind, number> = { similarity: 2, affine: 3, projective: 6, curved: 10 }
const KINDS: ModelKind[] = ['similarity', 'affine', 'projective', 'curved']
/** それぞれの変形が解ける、最小の基準点の数 */
const SOLVE_MIN_POINTS: Record<ModelKind, number> = { similarity: 2, affine: 3, projective: 4, curved: 5 }

/**
 * 基準点から、緯度経度（メルカトル座標）→ 画像の画素 の変換を、指定した方法で求める（ずれの計算はしない）。
 * - similarity: 回転・拡大縮小・平行移動（四隅を合わせて補正した写真なら、これで十分なことが多い）
 * - affine: さらに縦横の伸び・斜めのゆがみ
 * - projective: さらに遠近のゆがみ
 * - curved: 射影変換の後、残ったずれを薄板スプラインで直す（レンズのゆがみ・紙のたわみ）
 */
function fitModel(points: ControlPoint[], kind: ModelKind): Pick<ChartTransform, 'toPixel' | 'toLatLon' | 'kind'> | null {
  if (points.length < SOLVE_MIN_POINTS[kind]) return null
  // 画像は下向きが +y、メルカトルは北が +y なので、上下をそろえる（回転・拡大縮小だけで表せるように）
  const src = (p: LatLon) => {
    const m = mercator(p)
    return { x: m.x, y: -m.y }
  }
  const ns = normOf(points.map(src))
  const nd = normOf(points.map((p) => ({ x: p.px, y: p.py })))
  const s = points.map((p) => {
    const m = src(p)
    return { x: (m.x - ns.cx) / ns.sc, y: (m.y - ns.cy) / ns.sc }
  })
  const d = points.map((p) => ({ x: (p.px - nd.cx) / nd.sc, y: (p.py - nd.cy) / nd.sc }))

  // 基準点がほぼ一直線に並んでいると、横方向の向きが決まらない（散らばりの短い方向と長い方向の比で判定）
  const cxx = s.reduce((t, p) => t + p.x * p.x, 0)
  const cyy = s.reduce((t, p) => t + p.y * p.y, 0)
  const cxy = s.reduce((t, p) => t + p.x * p.y, 0)
  const sum = cxx + cyy
  const disc = Math.sqrt(Math.max(0, ((cxx - cyy) / 2) ** 2 + cxy * cxy))
  const minor = sum / 2 - disc
  const major = sum / 2 + disc
  if (major <= 0 || Math.sqrt(Math.max(0, minor) / major) < MIN_SPREAD) return null

  // h: 正規化した座標 → 正規化した画素（3x3、h[8] = 1）
  const rows: number[][] = []
  const vals: number[] = []
  let h: number[] | null = null
  if (kind === 'similarity') {
    s.forEach((p, i) => {
      rows.push([p.x, -p.y, 1, 0])
      vals.push(d[i].x)
      rows.push([p.y, p.x, 0, 1])
      vals.push(d[i].y)
    })
    const r = leastSquares(rows, vals)
    if (r) h = [r[0], -r[1], r[2], r[1], r[0], r[3], 0, 0, 1]
  } else if (kind === 'affine') {
    s.forEach((p, i) => {
      rows.push([p.x, p.y, 1, 0, 0, 0])
      vals.push(d[i].x)
      rows.push([0, 0, 0, p.x, p.y, 1])
      vals.push(d[i].y)
    })
    const r = leastSquares(rows, vals)
    if (r) h = [...r, 0, 0, 1]
  } else {
    s.forEach((p, i) => {
      rows.push([p.x, p.y, 1, 0, 0, 0, -d[i].x * p.x, -d[i].x * p.y])
      vals.push(d[i].x)
      rows.push([0, 0, 0, p.x, p.y, 1, -d[i].y * p.x, -d[i].y * p.y])
      vals.push(d[i].y)
    })
    const r = leastSquares(rows, vals)
    if (r) h = [...r, 1]
  }
  if (!h || h.some((v) => !Number.isFinite(v))) return null
  const H = h
  const inv = invert3(H)
  if (!inv) return null

  // 曲がりの補正: 射影変換で残ったずれを、薄板スプライン（TPS）でなめらかに直す
  let corr: (p: Pt) => Pt = () => ({ x: 0, y: 0 })
  const curved = kind === 'curved'
  if (curved) {
    const q = s.map((p) => applyH(H, p.x, p.y))
    const tx = tps(q, q.map((p, i) => d[i].x - p.x))
    const ty = tps(q, q.map((p, i) => d[i].y - p.y))
    if (!tx || !ty) return null
    corr = (p) => ({ x: tx(p), y: ty(p) })
  }

  const toPixel = (p: LatLon) => {
    const m = src(p)
    const q = applyH(H, (m.x - ns.cx) / ns.sc, (m.y - ns.cy) / ns.sc)
    const c = corr(q)
    return { x: (q.x + c.x) * nd.sc + nd.cx, y: (q.y + c.y) * nd.sc + nd.cy }
  }
  const toLatLon = (x: number, y: number) => {
    const t = { x: (x - nd.cx) / nd.sc, y: (y - nd.cy) / nd.sc }
    let m = applyH(inv, t.x, t.y)
    // 曲がりの補正がある時は、ニュートン法で toPixel(緯度経度) = (x, y) になるよう直す（正規化した座標で）
    if (curved) {
      const fwd = (u: Pt) => {
        const q = applyH(H, u.x, u.y)
        const c = corr(q)
        return { x: q.x + c.x, y: q.y + c.y }
      }
      const e = 1e-6
      for (let k = 0; k < 12; k++) {
        const f = fwd(m)
        const rx = f.x - t.x
        const ry = f.y - t.y
        if (Math.hypot(rx, ry) < 1e-12) break
        const fx = fwd({ x: m.x + e, y: m.y })
        const fy = fwd({ x: m.x, y: m.y + e })
        const a = (fx.x - f.x) / e
        const b = (fy.x - f.x) / e
        const c = (fx.y - f.y) / e
        const d2 = (fy.y - f.y) / e
        const det = a * d2 - b * c
        if (Math.abs(det) < 1e-15) break
        m = { x: m.x - (d2 * rx - b * ry) / det, y: m.y - (-c * rx + a * ry) / det }
      }
    }
    return inverseMercator(m.x * ns.sc + ns.cx, -(m.y * ns.sc + ns.cy))
  }
  return { toPixel, toLatLon, kind }
}

/** 交差検証: 1つずつ外して合わせ直し、外した点のずれ (m)。どれかで合わせられなければ null */
function leaveOneOut(points: ControlPoint[], kind: ModelKind): number[] | null {
  const out: number[] = []
  for (let i = 0; i < points.length; i++) {
    const m = fitModel(
      points.filter((_, k) => k !== i),
      kind,
    )
    if (!m) return null
    out.push(groundDistance(m.toLatLon(points[i].px, points[i].py), points[i]))
  }
  return out
}

const rmsOf = (v: number[]) => Math.sqrt(v.reduce((t, e) => t + e * e, 0) / v.length)

/** 海図の四隅が、ねじれずに（凸の四角形で）地図に乗るか。極端な遠近のゆがみを防ぐ */
function sane(model: Pick<ChartTransform, 'toLatLon'>, size: { width: number; height: number }): boolean {
  const c = chartCorners(size, model).map((p) => ({ x: p.lon * Math.cos((p.lat * Math.PI) / 180), y: p.lat }))
  if (c.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return false
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = c[i]
    const b = c[(i + 1) % 4]
    const e = c[(i + 2) % 4]
    const cr = (b.x - a.x) * (e.y - b.y) - (b.y - a.y) * (e.x - b.x)
    if (cr === 0) return false
    if (sign === 0) sign = Math.sign(cr)
    else if (Math.sign(cr) !== sign) return false
  }
  // 向かい合う辺の長さが極端に違う（遠近が強すぎる）ものは使わない
  const len = (i: number) => Math.hypot(c[(i + 1) % 4].x - c[i].x, c[(i + 1) % 4].y - c[i].y)
  return len(0) / len(2) < 2.5 && len(2) / len(0) < 2.5 && len(1) / len(3) < 2.5 && len(3) / len(1) < 2.5
}

/**
 * 基準点から変換を求め、点ごとのずれと見込みの精度も出す。
 * 基準点の数に応じて、使える変形の方法を交差検証で比べ、いちばんよく当たるもの（同じくらいなら単純なもの）を選ぶ。
 * 自由度の高い方法は、点が十分にあり、はっきりよく当たる時だけ使う（少ない点で無理に合わせると、海図全体がゆがむため）。
 * size（海図の画像の大きさ）を渡すと、四隅がねじれる変形は使わない。4点未満や、点が一直線に並ぶなどで解けなければ null
 */
export function fitChart(points: ControlPoint[], size?: { width: number; height: number }, maxKind: ModelKind = 'curved'): ChartTransform | null {
  if (points.length < MIN_POINTS) return null
  let best: { model: Pick<ChartTransform, 'toPixel' | 'toLatLon' | 'kind'>; loo: number[]; score: number } | null = null
  for (const kind of KINDS.slice(0, KINDS.indexOf(maxKind) + 1)) {
    if (points.length < KIND_MIN_POINTS[kind]) continue
    const model = fitModel(points, kind)
    if (!model) continue
    if (size && kind !== 'similarity' && !sane(model, size)) continue
    const loo = leaveOneOut(points, kind)
    if (!loo) continue
    const score = rmsOf(loo)
    // 自由度の高い方法は、1割以上よく当たる時だけ選ぶ
    if (!best || score < best.score * 0.9) best = { model, loo, score }
  }
  if (!best) return null
  return { ...best.model, errors: best.loo, rms: best.score, expected: best.score }
}

/** 海図の四隅の緯度経度（地図に重ねる範囲・優先の判定に使う） */
export function chartCorners(c: { width: number; height: number }, tr: Pick<ChartTransform, 'toLatLon'>): LatLon[] {
  return [tr.toLatLon(0, 0), tr.toLatLon(c.width, 0), tr.toLatLon(c.width, c.height), tr.toLatLon(0, c.height)]
}

/** 多角形（緯度経度）の面積 (km²)。詳しい海図（狭い範囲）を上に重ねるための目安 */
export function polygonAreaKm2(poly: LatLon[]): number {
  const ps = poly.map((p) => ({ x: p.lon * 111.32 * Math.cos(p.lat * rad), y: p.lat * 110.57 }))
  let a = 0
  for (let i = 0; i < ps.length; i++) {
    const j = (i + 1) % ps.length
    a += ps[i].x * ps[j].y - ps[j].x * ps[i].y
  }
  return Math.abs(a) / 2
}

/** 点が多角形（緯度経度）の中にあるか */
export function polygonContains(poly: LatLon[], p: LatLon): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.lat > p.lat !== b.lat > p.lat && p.lon < ((b.lon - a.lon) * (p.lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside
  }
  return inside
}

/** 基準点が海図のどれだけを囲んでいるか（0〜1）。四隅の近くまで点があると、海図全体で位置が合いやすい */
export function pointsCoverage(c: { width: number; height: number }, points: ControlPoint[]): number {
  if (points.length < 3) return 0
  // 凸包の面積 / 画像の面積
  const pts = [...points].map((p) => ({ x: p.px, y: p.py })).sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Pt[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Pt[] = []
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)]
  let a = 0
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length
    a += hull[i].x * hull[j].y - hull[j].x * hull[i].y
  }
  return Math.min(1, Math.abs(a) / 2 / (c.width * c.height))
}

function invert3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h
  const B = -(d * i - f * g)
  const C = d * h - e * g
  const det = a * A + b * B + c * C
  if (Math.abs(det) < 1e-12) return null
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det]
}

/** 2点間の距離 (m)。基準点のずれの目安なので、近い距離の簡単な式で */
function groundDistance(a: LatLon, b: LatLon): number {
  const x = (b.lon - a.lon) * rad * Math.cos(((a.lat + b.lat) / 2) * rad)
  const y = (b.lat - a.lat) * rad
  return Math.hypot(x, y) * R
}

/** 画像の範囲に入っているか（少しはみ出しても、端まで見えるように余裕を持たせる） */
export function insideChart(c: { width: number; height: number }, p: { x: number; y: number }, margin = 0): boolean {
  return p.x >= -margin && p.y >= -margin && p.x <= c.width + margin && p.y <= c.height + margin
}

export function parseUserCharts(value: unknown): UserChart[] {
  if (!Array.isArray(value)) return []
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return value.flatMap((c): UserChart[] => {
    if (typeof c !== 'object' || c === null) return []
    const v = c as Partial<UserChart>
    const width = num(v.width)
    const height = num(v.height)
    if (typeof v.id !== 'string' || width === null || height === null) return []
    const points = Array.isArray(v.points)
      ? v.points.flatMap((p): ControlPoint[] => {
          const px = num(p?.px)
          const py = num(p?.py)
          const lat = num(p?.lat)
          const lon = num(p?.lon)
          return typeof p?.id === 'string' && px !== null && py !== null && lat !== null && lon !== null ? [{ id: p.id, px, py, lat, lon }] : []
        })
      : []
    return [{ id: v.id, name: typeof v.name === 'string' ? v.name : '', width, height, points, portId: typeof v.portId === 'string' ? v.portId : null, createdAt: num(v.createdAt) ?? 0 }]
  })
}
