/** 点を通る滑らかな曲線（SVG のパス）を作る。ブラウザ機能に依存しない */

export interface Pt {
  x: number
  y: number
}

const fmt = (n: number) => n.toFixed(1)

/**
 * 与えた点をすべて通る、なめらかな曲線のパスを返す（単調3次補間）。
 * 点と点の間で、隣り合う点の高さの範囲からはみ出さない（行き過ぎて膨らんだり、谷が山に化けたりしない）。
 * 点は x が小さい順で、x が重ならないこと。
 */
export function monotonePath(points: Pt[]): string {
  const n = points.length
  if (n === 0) return ''
  if (n === 1) return `M${fmt(points[0].x)},${fmt(points[0].y)}`

  // 区間ごとの幅と傾き
  const h: number[] = []
  const s: number[] = []
  for (let i = 0; i < n - 1; i++) {
    h.push(points[i + 1].x - points[i].x)
    s.push((points[i + 1].y - points[i].y) / h[i])
  }

  // 各点での傾き。両隣で傾きの向きが変わる点（山・谷）は水平にして、行き過ぎを防ぐ
  const m: number[] = new Array<number>(n)
  m[0] = s[0]
  m[n - 1] = s[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (s[i - 1] * s[i] <= 0) {
      m[i] = 0
    } else {
      // 区間の幅で重みを付けた調和平均
      m[i] = (3 * (h[i - 1] + h[i])) / ((2 * h[i] + h[i - 1]) / s[i - 1] + (h[i] + 2 * h[i - 1]) / s[i])
    }
  }

  let d = `M${fmt(points[0].x)},${fmt(points[0].y)}`
  for (let i = 0; i < n - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const third = h[i] / 3
    d += ` C${fmt(a.x + third)},${fmt(a.y + m[i] * third)} ${fmt(b.x - third)},${fmt(b.y - m[i + 1] * third)} ${fmt(b.x)},${fmt(b.y)}`
  }
  return d
}
