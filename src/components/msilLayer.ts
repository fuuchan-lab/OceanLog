import L from 'leaflet'
import { exportUrl } from '../msil.ts'

/**
 * 海しるの項目を地図に重ねるレイヤー。キーはヘッダー（Ocp-Apim-Subscription-Key）で送る必要があるので、
 * 画像を fetch で取ってから表示する（通常の <img> のタイルでは、ヘッダーを付けられないため）
 */
export function msilLayer(base: string, key: string, onError: (status: number) => void): L.GridLayer {
  const Layer = L.GridLayer.extend({
    createTile(coords: L.Coords, done: L.DoneCallback) {
      const img = document.createElement('img')
      img.alt = ''
      const size = (this as L.GridLayer).getTileSize()
      const map = (this as unknown as { _map: L.Map })._map
      const nw = map.unproject(coords.scaleBy(size), coords.z)
      const se = map.unproject(coords.scaleBy(size).add(size), coords.z)
      const a = L.CRS.EPSG3857.project(nw)
      const b = L.CRS.EPSG3857.project(se)
      const url = exportUrl(base, [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)], size.x)
      fetch(url, { headers: { 'Ocp-Apim-Subscription-Key': key } })
        .then(async (res) => {
          if (!res.ok) {
            onError(res.status)
            throw new Error(`msil-${res.status}`)
          }
          const blob = await res.blob()
          img.onload = () => {
            URL.revokeObjectURL(img.src)
            done(undefined, img)
          }
          img.src = URL.createObjectURL(blob)
        })
        .catch((e: unknown) => done(e instanceof Error ? e : new Error(String(e)), img))
      return img
    },
  })
  const LayerCtor = Layer as unknown as new (options: L.GridLayerOptions) => L.GridLayer
  return new LayerCtor({ opacity: 0.85, zIndex: 5, attribution: '海しる（海上保安庁）' })
}
