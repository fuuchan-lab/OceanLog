import { fmtNum, fmtTime } from '../format.ts'
import { compassPoint, msToKnots } from '../geo.ts'
import { LOCALES } from '../i18n/context.ts'
import { useI18n } from '../i18n/useI18n.ts'
import type { Marine } from '../weather.ts'

/** 波の高さ・周期・向き、うねり、海面水温、海流と、今後の波高の予報（風のカードの中に出す） */
export function WaveInfo({ marine, dangerWave }: { marine: Marine | null; dangerWave: number | null }) {
  const { t, lang } = useI18n()
  const n = marine?.now
  const dir = (d: number | null) => (d === null ? '' : t('wave.from', { dir: compassPoint(d, lang) }))
  const hasData = n && (n.height !== null || n.seaTemp !== null)
  const heights = marine?.waves.map((w) => w.height).filter((h): h is number => h !== null) ?? []
  const maxH = Math.max(...heights, dangerWave ?? 0, 0.5)

  return (
    <>
      <h3 className="sub-title">🌊 {t('wave.title')}</h3>
      {hasData ? (
        <>
          <div className="stats">
            <div>
              <span className="stat-label">{t('wave.height')}</span>
              <span className="stat-value big-stat">
                {fmtNum(n.height)}
                <small> m</small>
              </span>
              <span className="small muted">
                {n.period !== null ? t('wave.period', { v: fmtNum(n.period, 0) }) : ''} {dir(n.direction)}
              </span>
            </div>
            <div>
              <span className="stat-label">{t('wave.swell')}</span>
              <span className="stat-value">
                {fmtNum(n.swellHeight)}
                <small> m</small>
              </span>
              <span className="small muted">
                {n.swellPeriod !== null ? t('wave.period', { v: fmtNum(n.swellPeriod, 0) }) : ''} {dir(n.swellDirection)}
              </span>
            </div>
            <div>
              <span className="stat-label">{t('wave.seaTemp')}</span>
              <span className="stat-value">
                {fmtNum(n.seaTemp)}
                <small> ℃</small>
              </span>
            </div>
            <div>
              <span className="stat-label">{t('wave.current')}</span>
              <span className="stat-value">
                {n.currentSpeed === null ? '—' : fmtNum(msToKnots(n.currentSpeed))}
                <small> kn</small>
              </span>
              {n.currentDirection !== null && (
                <span className="small muted">{t('wave.toward', { dir: compassPoint(n.currentDirection, lang) })}</span>
              )}
            </div>
          </div>
          {heights.length > 0 && (
            <div className="bars" role="img" aria-label={t('wave.forecast')}>
              {marine.waves
                .filter((_, i) => i % 2 === 0)
                .slice(0, 12)
                .map((w) => (
                  <div className={`bar-col${w.t + 3_600_000 <= Date.now() ? ' hour-past' : w.t <= Date.now() ? ' hour-now' : ''}`} key={w.t}>
                    <span className="small">{fmtNum(w.height)}</span>
                    <div className="bar-track">
                      <div
                        className={`bar${dangerWave && w.height !== null && w.height >= dangerWave ? ' bar-danger' : dangerWave && w.height !== null && w.height >= dangerWave * 0.8 ? ' bar-caution' : ''}`}
                        style={{ height: `${((w.height ?? 0) / maxH) * 100}%` }}
                      />
                      {dangerWave && <div className="bar-limit" style={{ bottom: `${(dangerWave / maxH) * 100}%` }} />}
                    </div>
                    <span className="small muted">{fmtTime(w.t, LOCALES[lang]).replace(/:00$/, '')}</span>
                  </div>
                ))}
            </div>
          )}
          {heights.length > 0 && <p className="muted small">{t('wave.barsHint')}</p>}
          {dangerWave && <p className="muted small">{t('wave.limitHint', { v: fmtNum(dangerWave) })}</p>}
        </>
      ) : (
        <p className="muted">{t('wave.noData')}</p>
      )}
    </>
  )
}
