import { useState } from 'react'
import type { LatLon } from '../geo.ts'
import { useI18n } from '../i18n/useI18n.ts'

/** 風向の矢印（風が吹いていく向きに向ける。北=0 から吹く風は南へ） */
export function WindArrow({ from, size = 40 }: { from: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" className="wind-arrow">
      <circle cx="20" cy="20" r="18" className="wind-ring" />
      <g transform={`rotate(${from + 180} 20 20)`}>
        <path d="M20 5 27 22h-5v13h-4V22h-5z" className="wind-shape" />
      </g>
    </svg>
  )
}

type Overlay = 'wind' | 'gust' | 'waves' | 'pressure' | 'rain'

/** Windy の埋め込み表示（Windy 公式の無料の埋め込み） */
export function WindyEmbed({ at }: { at: LatLon }) {
  const { t } = useI18n()
  const [overlay, setOverlay] = useState<Overlay>('wind')
  const params = new URLSearchParams({
    type: 'map',
    location: 'coordinates',
    metricRain: 'mm',
    metricTemp: '°C',
    metricWind: 'm/s',
    zoom: '8',
    overlay,
    product: 'ecmwf',
    level: 'surface',
    lat: at.lat.toFixed(3),
    lon: at.lon.toFixed(3),
    detailLat: at.lat.toFixed(3),
    detailLon: at.lon.toFixed(3),
    marker: 'true',
    message: 'true',
  })
  const overlays: Overlay[] = ['wind', 'gust', 'waves', 'pressure', 'rain']
  return (
    <div className="windy">
      <div className="seg">
        {overlays.map((o) => (
          <button key={o} className={overlay === o ? 'on' : ''} onClick={() => setOverlay(o)}>
            {t(`windy.${o}`)}
          </button>
        ))}
      </div>
      <iframe
        title="Windy"
        className="windy-frame"
        src={`https://embed.windy.com/embed.html?${params}`}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  )
}
