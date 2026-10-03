import L from 'leaflet'
import { chartCorners, fitChart, polygonAreaKm2, type ChartTransform, type UserChart } from '../chartGeo.ts'
import { getPhoto } from '../db.ts'
import type { LatLon } from '../geo.ts'

/** 地図に重ねる海図（位置合わせ済み） */
interface Placed {
  chart: UserChart
  tr: ChartTransform
  corners: LatLon[]
  bounds: L.LatLngBounds
  /** 範囲の面積。狭い（詳しい）海図ほど上に描く */
  area: number
  image: ImageBitmap | null
}

/** タイル1枚を、この数 × この数のマス（三角形2つずつ）に分けて、海図の画像を変形して貼る */
const MESH = 8

/**
 * 自分で撮影・アップロードした海図を、地図の上の正しい位置に変形して重ねるレイヤー。
 * 地図のタイル1枚ごとに、細かい三角形に分けて、海図の画像をその形に合わせて描く（射影変換・曲がりの補正もそのまま反映）。
 * 何枚も重ねられ、重なる所は、範囲の狭い（詳しい）海図を上にする
 */
export function chartOverlay(charts: UserChart[], opacity: number): L.GridLayer {
  const placed: Placed[] = charts
    .flatMap((chart): Placed[] => {
      const tr = fitChart(chart.points, chart)
      if (!tr) return []
      const corners = chartCorners(chart, tr)
      return [{ chart, tr, corners, bounds: L.latLngBounds(corners.map((c) => [c.lat, c.lon])), area: polygonAreaKm2(corners), image: null }]
    })
    // 広い海図から先に描き、狭い（詳しい）海図を後から上に描く
    .sort((a, b) => b.area - a.area)

  const Layer = L.GridLayer.extend({
    createTile(coords: L.Coords, done: L.DoneCallback) {
      const layer = this as L.GridLayer
      const size = layer.getTileSize()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const canvas = document.createElement('canvas')
      canvas.width = size.x * dpr
      canvas.height = size.y * dpr
      const ctx = canvas.getContext('2d')!
      ctx.scale(dpr, dpr)
      ctx.imageSmoothingQuality = 'high'
      const map = (this as unknown as { _map: L.Map })._map
      const origin = coords.scaleBy(size)
      const tileBounds = L.latLngBounds(map.unproject(origin, coords.z), map.unproject(origin.add(size), coords.z))
      for (const p of placed) {
        if (!p.image || !p.bounds.intersects(tileBounds)) continue
        drawWarped(ctx, p, map, origin, coords.z, size)
      }
      // 描き終わりを知らせる（同期で描いたので、次の処理で）
      setTimeout(() => done(undefined, canvas), 0)
      return canvas
    },
  })
  const LayerCtor = Layer as unknown as new (options: L.GridLayerOptions) => L.GridLayer
  const layer = new LayerCtor({ opacity, zIndex: 3, maxZoom: 20, updateWhenZooming: false })

  // 画像を読み込んだら描き直す
  void Promise.all(
    placed.map(async (p) => {
      const blob = await getPhoto(p.chart.id)
      if (blob) p.image = await createImageBitmap(blob)
    }),
  ).then(() => layer.redraw())
  layer.on('remove', () => {
    for (const p of placed) p.image?.close()
  })
  return layer
}

/** タイルの上に、海図の画像を三角形ごとに変形して描く */
function drawWarped(ctx: CanvasRenderingContext2D, p: Placed, map: L.Map, origin: L.Point, zoom: number, size: L.Point) {
  const img = p.image!
  const W = p.chart.width
  const H = p.chart.height
  // マスの頂点: タイルの上の位置 → 緯度経度 → 海図の画像の位置
  const n = MESH
  const dst: { x: number; y: number }[] = []
  const src: { x: number; y: number }[] = []
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * size.x
      const y = (j / n) * size.y
      const ll = map.unproject(origin.add([x, y]), zoom)
      dst.push({ x, y })
      src.push(p.tr.toPixel({ lat: ll.lat, lon: ll.lng }))
    }
  }
  const at = (i: number, j: number) => j * (n + 1) + i
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = at(i, j)
      const b = at(i + 1, j)
      const c = at(i + 1, j + 1)
      const d = at(i, j + 1)
      // マスがまるごと海図の外なら描かない
      const xs = [src[a].x, src[b].x, src[c].x, src[d].x]
      const ys = [src[a].y, src[b].y, src[c].y, src[d].y]
      if (Math.max(...xs) < 0 || Math.min(...xs) > W || Math.max(...ys) < 0 || Math.min(...ys) > H) continue
      tri(ctx, img, src[a], src[b], src[c], dst[a], dst[b], dst[c])
      tri(ctx, img, src[a], src[c], src[d], dst[a], dst[c], dst[d])
    }
  }
}

type P = { x: number; y: number }

/** 画像の三角形 s0-s1-s2 を、タイルの三角形 d0-d1-d2 に貼る（アフィン変換）。継ぎ目が出ないよう、少しだけ広げて切り抜く */
function tri(ctx: CanvasRenderingContext2D, img: ImageBitmap, s0: P, s1: P, s2: P, d0: P, d1: P, d2: P) {
  // 画像の座標 → タイルの座標 の変換 [a c e; b d f]
  const sx1 = s1.x - s0.x
  const sy1 = s1.y - s0.y
  const sx2 = s2.x - s0.x
  const sy2 = s2.y - s0.y
  const det = sx1 * sy2 - sx2 * sy1
  if (Math.abs(det) < 1e-9) return
  const dx1 = d1.x - d0.x
  const dy1 = d1.y - d0.y
  const dx2 = d2.x - d0.x
  const dy2 = d2.y - d0.y
  const a = (dx1 * sy2 - dx2 * sy1) / det
  const c = (dx2 * sx1 - dx1 * sx2) / det
  const b = (dy1 * sy2 - dy2 * sy1) / det
  const d = (dy2 * sx1 - dy1 * sx2) / det
  const e = d0.x - a * s0.x - c * s0.y
  const f = d0.y - b * s0.x - d * s0.y

  // 切り抜き: 三角形を重心から 0.6px 広げる
  const cx = (d0.x + d1.x + d2.x) / 3
  const cy = (d0.y + d1.y + d2.y) / 3
  const grow = (q: P) => {
    const vx = q.x - cx
    const vy = q.y - cy
    const len = Math.hypot(vx, vy) || 1
    return { x: q.x + (vx / len) * 0.6, y: q.y + (vy / len) * 0.6 }
  }
  const g0 = grow(d0)
  const g1 = grow(d1)
  const g2 = grow(d2)
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(g0.x, g0.y)
  ctx.lineTo(g1.x, g1.y)
  ctx.lineTo(g2.x, g2.y)
  ctx.closePath()
  ctx.clip()
  ctx.transform(a, b, c, d, e, f)
  // 画像のうち、この三角形のまわりだけを描く（大きな画像全体を毎回描かない）
  const minX = Math.max(0, Math.floor(Math.min(s0.x, s1.x, s2.x)) - 2)
  const minY = Math.max(0, Math.floor(Math.min(s0.y, s1.y, s2.y)) - 2)
  const maxX = Math.min(img.width, Math.ceil(Math.max(s0.x, s1.x, s2.x)) + 2)
  const maxY = Math.min(img.height, Math.ceil(Math.max(s0.y, s1.y, s2.y)) + 2)
  if (maxX > minX && maxY > minY) ctx.drawImage(img, minX, minY, maxX - minX, maxY - minY, minX, minY, maxX - minX, maxY - minY)
  ctx.restore()
}
