/**
 * 自分で撮影・アップロードした海図の、画像の位置（画素）と緯度経度の対応（ジオリファレンス）。
 * 海図はメルカトル図法なので、緯度経度をメルカトルの座標にしてから、画像の画素へ移す変換を求める。
 * 基準点が4つ以上なら射影変換（写真の傾き・遠近のゆがみも直す）、3つならアフィン変換。どちらも最小二乗で合わせる
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
  createdAt: number
}

/** 位置合わせに必要な基準点の数 */
export const MIN_POINTS = 3
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
  /** 各基準点のずれ（m）。合わせ方の確かさの目安 */
  errors: number[]
  /** ずれの平均（m） */
  rms: number
  kind: 'affine' | 'projective'
}

/**
 * 基準点から変換を求める。数値を安定させるため、メルカトル座標と画素を、それぞれの中心と大きさでそろえてから解く。
 * 3点未満や、点が一直線に並ぶなどで解けなければ null
 */
export function fitChart(points: ControlPoint[]): ChartTransform | null {
  if (points.length < MIN_POINTS) return null
  const src = points.map((p) => mercator(p))
  const dst = points.map((p) => ({ x: p.px, y: p.py }))
  const norm = (ps: { x: number; y: number }[]) => {
    const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length
    const cy = ps.reduce((s, p) => s + p.y, 0) / ps.length
    const sc = Math.max(...ps.map((p) => Math.hypot(p.x - cx, p.y - cy)), 1e-9)
    return { cx, cy, sc }
  }
  const ns = norm(src)
  const nd = norm(dst)
  const s = src.map((p) => ({ x: (p.x - ns.cx) / ns.sc, y: (p.y - ns.cy) / ns.sc }))
  const d = dst.map((p) => ({ x: (p.x - nd.cx) / nd.sc, y: (p.y - nd.cy) / nd.sc }))

  // 基準点がほぼ一直線に並んでいると、横方向の向きが決まらない（散らばりの短い方向と長い方向の比で判定）
  const cxx = s.reduce((t, p) => t + p.x * p.x, 0)
  const cyy = s.reduce((t, p) => t + p.y * p.y, 0)
  const cxy = s.reduce((t, p) => t + p.x * p.y, 0)
  const tr = cxx + cyy
  const disc = Math.sqrt(Math.max(0, ((cxx - cyy) / 2) ** 2 + cxy * cxy))
  const minor = tr / 2 - disc
  const major = tr / 2 + disc
  if (major <= 0 || Math.sqrt(Math.max(0, minor) / major) < MIN_SPREAD) return null

  // h: 正規化したメルカトル座標 → 正規化した画素（3x3、h[8] = 1）
  let h: number[] | null
  let kind: ChartTransform['kind']
  if (points.length >= 4) {
    const rows: number[][] = []
    const vals: number[] = []
    s.forEach((p, i) => {
      rows.push([p.x, p.y, 1, 0, 0, 0, -d[i].x * p.x, -d[i].x * p.y])
      vals.push(d[i].x)
      rows.push([0, 0, 0, p.x, p.y, 1, -d[i].y * p.x, -d[i].y * p.y])
      vals.push(d[i].y)
    })
    const r = leastSquares(rows, vals)
    h = r ? [...r, 1] : null
    kind = 'projective'
  } else {
    const rows: number[][] = []
    const vals: number[] = []
    s.forEach((p, i) => {
      rows.push([p.x, p.y, 1, 0, 0, 0])
      vals.push(d[i].x)
      rows.push([0, 0, 0, p.x, p.y, 1])
      vals.push(d[i].y)
    })
    const r = leastSquares(rows, vals)
    h = r ? [...r, 0, 0, 1] : null
    kind = 'affine'
  }
  if (!h || h.some((v) => !Number.isFinite(v))) return null
  const inv = invert3(h)
  if (!inv) return null

  const apply = (m: number[], x: number, y: number) => {
    const w = m[6] * x + m[7] * y + m[8]
    return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w }
  }
  const toPixel = (p: LatLon) => {
    const mc = mercator(p)
    const q = apply(h, (mc.x - ns.cx) / ns.sc, (mc.y - ns.cy) / ns.sc)
    return { x: q.x * nd.sc + nd.cx, y: q.y * nd.sc + nd.cy }
  }
  const toLatLon = (x: number, y: number) => {
    const q = apply(inv, (x - nd.cx) / nd.sc, (y - nd.cy) / nd.sc)
    return inverseMercator(q.x * ns.sc + ns.cx, q.y * ns.sc + ns.cy)
  }
  // ずれ: 画像の上の基準点を緯度経度に戻し、入力した緯度経度との距離
  const errors = points.map((p) => groundDistance(toLatLon(p.px, p.py), p))
  const rms = Math.sqrt(errors.reduce((sum, e) => sum + e * e, 0) / errors.length)
  return { toPixel, toLatLon, errors, rms, kind }
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
    return [{ id: v.id, name: typeof v.name === 'string' ? v.name : '', width, height, points, createdAt: num(v.createdAt) ?? 0 }]
  })
}
