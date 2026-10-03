import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState } from 'react'
import { chartCorners, fitChart, type UserChart } from '../chartGeo.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { BASE_LAYERS } from '../tiles.ts'
import { chartOverlay } from './chartOverlay.ts'

/**
 * 位置合わせの確認: 地図（航空写真・地理院地図）の上に、合わせた海図を半透明で重ねる。
 * 濃さを動かして、海岸線や防波堤が地図とそろっているかを見比べる。基準点（入力した緯度経度）も印で出す
 */
export function ChartCheckMap({ chart }: { chart: UserChart }) {
  const { t } = useI18n()
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const overlay = useRef<L.GridLayer | null>(null)
  const base = useRef<L.TileLayer | null>(null)
  const [opacity, setOpacity] = useState(0.6)
  const [photo, setPhoto] = useState(true)

  // 地図を作り、海図の範囲が収まるように表示する
  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, { zoomControl: true, rotateControl: false, touchRotate: false } as L.MapOptions)
    const tr = fitChart(chart.points, chart)
    const corners = tr ? chartCorners(chart, tr) : chart.points
    m.fitBounds(L.latLngBounds(corners.map((c) => [c.lat, c.lon])), { padding: [10, 10] })
    // 基準点（入力した緯度経度）
    chart.points.forEach((p, i) => {
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({ className: 'check-cp', html: `<span>${i + 1}</span>`, iconSize: [24, 24], iconAnchor: [12, 12] }),
        interactive: false,
      }).addTo(m)
    })
    map.current = m
    setTimeout(() => m.invalidateSize(), 100)
    return () => {
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 下の地図（航空写真 / 地理院地図）
  useEffect(() => {
    const m = map.current
    if (!m) return
    base.current?.remove()
    const src = BASE_LAYERS[photo ? 'gsi-photo' : 'gsi-pale']
    base.current = L.tileLayer(src.url, { attribution: src.attribution, maxZoom: 18 }).addTo(m)
    base.current.bringToBack()
  }, [photo])

  // 合わせた海図（基準点が変わったら作り直す）
  const sig = chart.points.map((p) => `${p.px},${p.py},${p.lat},${p.lon}`).join(';')
  useEffect(() => {
    const m = map.current
    if (!m) return
    overlay.current?.remove()
    overlay.current = chartOverlay([chart], opacity).addTo(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])
  useEffect(() => {
    overlay.current?.setOpacity(opacity)
  }, [opacity])

  return (
    <div className="check-map-box">
      <div className="check-map" ref={el} />
      <label className="small">
        {t('uchart.checkOpacity', { v: Math.round(opacity * 100) })}
        <input type="range" min={0} max={100} step={5} value={Math.round(opacity * 100)} onChange={(e) => setOpacity(Number(e.target.value) / 100)} />
      </label>
      <div className="seg">
        <button type="button" className={photo ? 'on' : ''} onClick={() => setPhoto(true)}>
          {t('layer.gsi-photo')}
        </button>
        <button type="button" className={!photo ? 'on' : ''} onClick={() => setPhoto(false)}>
          {t('layer.gsi-pale')}
        </button>
      </div>
      <p className="muted small">{t('uchart.checkHint')}</p>
    </div>
  )
}
