import { useState } from 'react'
import { fmtNum, fmtTime } from '../format.ts'
import { formatDM, msToKnots } from '../geo.ts'
import type { GeoState } from '../hooks/useGeolocation.ts'
import { useCompass } from '../hooks/useCompass.ts'
import { LOCALES } from '../i18n/context.ts'
import { useI18n } from '../i18n/useI18n.ts'

/** 現在地（緯度・経度を度・分で）、対地速力・針路、位置の誤差 */
export function PositionCard({ geo, compact = false }: { geo: GeoState & { stale: boolean }; compact?: boolean }) {
  const { t, lang } = useI18n()
  const [copied, setCopied] = useState(false)
  const { fix } = geo
  const compass = useCompass()

  const copy = async () => {
    if (!fix) return
    try {
      await navigator.clipboard.writeText(`${formatDM(fix.lat, true)} ${formatDM(fix.lon, false)} (${fix.lat.toFixed(6)}, ${fix.lon.toFixed(6)})`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // コピーできない環境では何もしない
    }
  }

  return (
    <section className={`card position${compact ? ' position-compact' : ''}`}>
      {!compact && (
        <div className="row">
          <h2>{t('pos.title')}</h2>
          {fix && (
            <button className="link" onClick={() => void copy()}>
              {copied ? t('pos.copied') : t('pos.copy')}
            </button>
          )}
        </div>
      )}
      {fix ? (
        <>
          <p className="latlon">
            <span>{formatDM(fix.lat, true)}</span>
            <span>{formatDM(fix.lon, false)}</span>
          </p>
          <div className="stats">
            <div>
              <span className="stat-label">{t('pos.sog')}</span>
              <span className="stat-value">
                {fix.speed === null ? '—' : fmtNum(msToKnots(fix.speed))}
                <small> kn</small>
              </span>
            </div>
            <div>
              <span className="stat-label">{t('pos.cog')}</span>
              <span className="stat-value">
                {fix.course === null ? '—' : String(Math.round(fix.course)).padStart(3, '0')}
                <small>°</small>
              </span>
            </div>
            <div>
              <span className="stat-label">{t('pos.compass')}</span>
              {compass.needsPermission && compass.supported ? (
                <button className="link" onClick={() => void compass.enable()}>
                  {t('compass.enable')}
                </button>
              ) : (
                <span className="stat-value">
                  {compass.heading === null ? '—' : String(Math.round(compass.heading) % 360).padStart(3, '0')}
                  <small>°</small>
                </span>
              )}
            </div>
            <div>
              <span className="stat-label">{t('pos.accuracy')}</span>
              <span className="stat-value">
                ±{Math.round(fix.accuracy)}
                <small> m</small>
              </span>
            </div>
          </div>
          <p className="muted small">{t('pos.compassHint')}</p>
          {geo.stale && <p className="muted small">{t('pos.stale', { time: fmtTime(fix.t, LOCALES[lang]) })}</p>}
        </>
      ) : (
        !geo.errorCode && <p className="muted">{t('pos.waiting')}</p>
      )}
      {geo.errorCode !== null && (
        <p className="error small" role="alert">
          ⚠ {t(geo.errorCode === 1 ? 'pos.denied' : 'pos.unavailable')}
          <br />
          <span className="muted">
            {t('err.detail')}: {geo.errorDetail}
          </span>
        </p>
      )}
    </section>
  )
}
