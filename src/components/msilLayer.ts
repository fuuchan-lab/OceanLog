import L from 'leaflet'
import { exportUrl } from '../msil.ts'

/**
 * 海しるの項目を地図に重ねるレイヤー。キーは URL の subscription-key で送る（海しる API が受け付ける方法）。
 * 普通の画像のタイルとして読み込むので、ブラウザの CORS の制限を受けない
 */
export function msilLayer(base: string, key: string, onError: () => void): L.TileLayer {
  const Layer = L.TileLayer.extend({
    getTileUrl(coords: L.Coords) {
      const size = (this as L.TileLayer).getTileSize()
      const map = (this as unknown as { _map: L.Map })._map
      const nw = map.unproject(coords.scaleBy(size), coords.z)
      const se = map.unproject(coords.scaleBy(size).add(size), coords.z)
      const a = L.CRS.EPSG3857.project(nw)
      const b = L.CRS.EPSG3857.project(se)
      return exportUrl(base, [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)], size.x, key)
    },
  })
  const LayerCtor = Layer as unknown as new (url: string, options: L.TileLayerOptions) => L.TileLayer
  const layer = new LayerCtor('', { opacity: 0.9, zIndex: 5, maxZoom: 18, attribution: '海しる（海上保安庁）' })
  layer.on('tileerror', onError)
  return layer
}
