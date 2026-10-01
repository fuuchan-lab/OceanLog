import { useState, type ReactNode } from 'react'
import { fmtNum, fmtTime } from '../format.ts'
import { beaufort, compassPoint, convertWind, WIND_UNIT_LABEL, type LatLon, type WindUnit } from '../geo.ts'
import type { Weather } from '../weather.ts'
import { LOCALES } from '../i18n/context.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { describeWeather } from '../weather.ts'

const HOUR_MS = 3_600_000

/** 風向の矢印（風が吹いていく向きに向ける。北=0 から吹く風は南へ） */
function WindArrow({ from, size = 40 }: { from: number; size?: number }) {
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

/** Windy の埋め込み表示（Windy 公式の無料の埋め込み。開いた時にだけ読み込む） */
function WindyEmbed({ at }: { at: LatLon }) {
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

/** 風速・最大瞬間風速・風向と、今後の風の予報。Windy のマップも開ける */
export function WindCard({ weather, at, unit, children }: { weather: Weather | null; at: LatLon | null; unit: WindUnit; children?: ReactNode }) {
  const { t, lang } = useI18n()
  const [windyOpen, setWindyOpen] = useState(false)
  const u = WIND_UNIT_LABEL[unit]
  const v = (ms: number) => fmtNum(convertWind(ms, unit), unit === 'ms' ? 1 : 0)

  return (
    <section className="card">
      <h2>{t('windWave.title')}</h2>
      <h3 className="sub-title">🌬️ {t('wind.title')}</h3>
      {weather ? (
        <>
          <div className="wind-now">
            <WindArrow from={weather.wind.direction} size={64} />
            <div>
              <p className="big">
                {v(weather.wind.speed)}
                <span className="unit"> {u}</span>
              </p>
              <p className="muted">
                {t('wind.from', { dir: compassPoint(weather.wind.direction, lang), deg: Math.round(weather.wind.direction) })} ·{' '}
                {t('wind.gust', { v: v(weather.wind.gust), u })} · {t('wind.beaufort', { b: beaufort(weather.wind.speed) })}
              </p>
            </div>
          </div>
          <div className="hourly" role="list">
            {weather.hourly
              .filter((_, i) => i % 2 === 0)
              .slice(0, 12)
              .map((h) => {
                const w = describeWeather(h.code, h.isDay, t)
                return (
                  <div className={`hour${h.t + HOUR_MS <= Date.now() ? ' hour-past' : h.t <= Date.now() ? ' hour-now' : ''}`} role="listitem" key={h.t}>
                    <span className="small muted">{fmtTime(h.t, LOCALES[lang])}</span>
                    <span title={w.label}>{w.icon}</span>
                    <WindArrow from={h.direction} size={24} />
                    <span className="small hour-wind">
                      <span className="hour-tag">{t('wind.avgShort')}</span>
                      <b>{v(h.speed)}</b>
                    </span>
                    <span className="small hour-wind">
                      <span className="hour-tag">{t('wind.gustShort')}</span>
                      {v(h.gust)}
                    </span>
                    {h.precipProb !== null && <span className="small muted">☔{Math.round(h.precipProb)}%</span>}
                  </div>
                )
              })}
          </div>
          <p className="muted small">{t('wind.hourlyHint', { u })}</p>
        </>
      ) : (
        <p className="muted">{t('cond.noData')}</p>
      )}
      {/* 波（同じカードの中にまとめる） */}
      {children}
      {at && (
        <>
          <div className="row gap">
            <button className="secondary" onClick={() => setWindyOpen((o) => !o)}>
              🌬️ {windyOpen ? t('windy.close') : t('windy.open')}
            </button>
            <a className="button secondary" href={`https://www.windy.com/${at.lat.toFixed(3)}/${at.lon.toFixed(3)}?${at.lat.toFixed(3)},${at.lon.toFixed(3)},9`} target="_blank" rel="noopener">
              {t('windy.app')}
            </a>
          </div>
          {windyOpen && <WindyEmbed at={at} />}
        </>
      )}
    </section>
  )
}
