/**
 * 自分で撮影・アップロードした海図の、画像の位置（画素）と緯度経度の対応（ジオリファレンス）。
 * 海図はメルカトル図法なので、緯度経度をメルカトルの座標にしてから、画像の画素へ移す変換を求める。
 * 基準点が4つ以上で射影変換（写真の傾き・遠近のゆがみも直す）、8つ以上ならさらに薄板スプラインの補正（レンズのゆがみ・紙のたわみ）。最小二乗で合わせる
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
  /** 各基準点のずれ（m）。5点以上は、その点を外して合わせ直した時のずれ（入力の間違いが分かる） */
  errors: number[]
  /** ずれの平均（m） */
  rms: number
  /**
   * 見込みの精度（m）: 基準点を1つずつ外して合わせ直し、外した点がどれだけずれるか（交差検証）の平均。
   * 基準点の上だけでなく、海図全体での確かさの目安。基準点が少なくて求められなければ null
   */
  expected: number | null
  kind: 'projective' | 'curved'
}

/** 曲がりの補正（レンズのゆがみ・紙のたわみ）を加える、基準点の数 */
export const CURVED_MIN_POINTS = 8
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

/**
 * 基準点から、緯度経度（メルカトル座標）→ 画像の画素 の変換を求める（ずれの計算はしない）。
 * 4点以上は射影変換（写真の傾き・遠近のゆがみ）。8点以上なら、残ったずれを薄板スプラインで直す（レンズのゆがみ・紙のたわみ）
 */
function fitModel(points: ControlPoint[], allowCurved = true): Pick<ChartTransform, 'toPixel' | 'toLatLon' | 'kind'> | null {
  if (points.length < MIN_POINTS) return null
  const ns = normOf(points.map((p) => mercator(p)))
  const nd = normOf(points.map((p) => ({ x: p.px, y: p.py })))
  const s = points.map((p) => {
    const m = mercator(p)
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

  // 射影変換 h: 正規化したメルカトル座標 → 正規化した画素（h[8] = 1）
  const rows: number[][] = []
  const vals: number[] = []
  s.forEach((p, i) => {
    rows.push([p.x, p.y, 1, 0, 0, 0, -d[i].x * p.x, -d[i].x * p.y])
    vals.push(d[i].x)
    rows.push([0, 0, 0, p.x, p.y, 1, -d[i].y * p.x, -d[i].y * p.y])
    vals.push(d[i].y)
  })
  const r = leastSquares(rows, vals)
  if (!r) return null
  const h = [...r, 1]
  if (h.some((v) => !Number.isFinite(v))) return null
  const inv = invert3(h)
  if (!inv) return null

  // 多いとき: 射影変換で残ったずれを、薄板スプライン（TPS）でなめらかに直す（レンズのゆがみ・紙のたわみ・写真の曲がり）
  let corr: (p: Pt) => Pt = () => ({ x: 0, y: 0 })
  let curved = false
  if (allowCurved && points.length >= CURVED_MIN_POINTS) {
    const q = s.map((p) => applyH(h, p.x, p.y))
    const tx = tps(q, q.map((p, i) => d[i].x - p.x))
    const ty = tps(q, q.map((p, i) => d[i].y - p.y))
    if (tx && ty) {
      corr = (p) => ({ x: tx(p), y: ty(p) })
      curved = true
    }
  }

  const toPixel = (p: LatLon) => {
    const mc = mercator(p)
    const q = applyH(h, (mc.x - ns.cx) / ns.sc, (mc.y - ns.cy) / ns.sc)
    const c = corr(q)
    return { x: (q.x + c.x) * nd.sc + nd.cx, y: (q.y + c.y) * nd.sc + nd.cy }
  }
  const toLatLon = (x: number, y: number) => {
    // まず射影変換だけで戻す
    const t = { x: (x - nd.cx) / nd.sc, y: (y - nd.cy) / nd.sc }
    let m = applyH(inv, t.x, t.y)
    // 曲がりの補正がある時は、ニュートン法で toPixel(緯度経度) = (x, y) になるよう直す（正規化したメルカトル座標で）
    if (curved) {
      const fwd = (u: Pt) => {
        const q = applyH(h, u.x, u.y)
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
    return inverseMercator(m.x * ns.sc + ns.cx, m.y * ns.sc + ns.cy)
  }
  return { toPixel, toLatLon, kind: curved ? 'curved' : 'projective' }
}

/**
 * 基準点から変換を求め、ずれと見込みの精度も出す。
 * 4点未満や、点が一直線に並ぶなどで解けなければ null
 */
export function fitChart(points: ControlPoint[], allowCurved = true): ChartTransform | null {
  const model = fitModel(points, allowCurved)
  if (!model) return null
  // 合わせた結果のずれ: 画像の上の基準点を緯度経度に戻し、入力した緯度経度との距離
  const fitErrors = points.map((p) => groundDistance(model.toLatLon(p.px, p.py), p))
  // 見込みの精度: 1つずつ外して合わせ直し、外した点のずれを測る（外しても合わせられる数がある時だけ）。
  // 曲がりの補正は基準点にぴったり合わせるので、点ごとの「ずれ」もこちらで出す（入力を間違えた点が目立つ）
  let expected: number | null = null
  let errors = fitErrors
  if (points.length > MIN_POINTS) {
    const loo: number[] = []
    points.forEach((p, i) => {
      const m = fitModel(points.filter((_, k) => k !== i), allowCurved)
      if (m) loo.push(groundDistance(m.toLatLon(p.px, p.py), p))
    })
    if (loo.length === points.length) {
      expected = Math.sqrt(loo.reduce((t, e) => t + e * e, 0) / loo.length)
      errors = loo
    }
  }
  const rms = Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length)
  return { ...model, errors, rms, expected }
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
