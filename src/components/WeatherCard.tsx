import { fmtNum, fmtTime } from '../format.ts'
import type { ConditionsState } from '../hooks/useConditions.ts'
import { useOnline } from '../hooks/useOnline.ts'
import { LOCALES } from '../i18n/context.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { assessTrend } from '../warning.ts'
import { describeWeather } from '../weather.ts'
import { PressureSparkline } from './PressureSparkline.tsx'

/** 天気と気圧。気圧の推移グラフと変化の判定は頭痛ログと同じ */
export function WeatherCard({ state, onRefresh }: { state: ConditionsState; onRefresh: () => void }) {
  const { t, lang } = useI18n()
  const online = useOnline()
  const data = state.data
  const w = data?.weather
  const view = w ? describeWeather(w.pressure.weather.code, w.pressure.weather.isDay, t) : null
  const trend = w && data ? assessTrend(w.pressure, t, data.fetchedAt) : null

  return (
    <section className="card">
      <div className="row">
        <h2>{t('weather.title')}</h2>
        <button className="link" onClick={onRefresh} disabled={state.loading}>
          {state.loading ? t('common.loading') : t('common.refresh')}
        </button>
      </div>
      {w && view && data ? (
        <>
          <div className="now">
            <p className="big big-pressure">
              {w.pressure.current.toFixed(1)}
              <span className="unit"> hPa</span>
            </p>
            <div className="weather">
              <div className="weather-main">
                <span className="weather-icon" role="img" aria-label={view.label}>
                  {view.icon}
                </span>
                <span className="weather-label">{view.label}</span>
              </div>
              <div className="weather-meta">
                <span>{t('weather.temp', { v: Math.round(w.pressure.weather.temperature) })}</span>
                <span>{t('weather.humidity', { v: Math.round(w.pressure.weather.humidity) })}</span>
              </div>
            </div>
          </div>
          <PressureSparkline forecast={w.pressure} now={data.fetchedAt} />
          {trend && (
            <p className={`banner banner-${trend.level}`} role={trend.level === 'warning' || trend.level === 'caution' ? 'alert' : undefined}>
              {trend.level === 'warning' && '⚠️ '}
              {trend.level === 'caution' && '⚠ '}
              {trend.level === 'info' && '📈 '}
              {trend.message}
            </p>
          )}
          <div className="stats">
            <div>
              <span className="stat-label">{t('weather.visibility')}</span>
              <span className="stat-value">
                {w.visibility === null ? '—' : fmtNum(w.visibility / 1000)}
                <small> km</small>
              </span>
            </div>
            <div>
              <span className="stat-label">{t('weather.cloud')}</span>
              <span className="stat-value">
                {w.cloudCover === null ? '—' : Math.round(w.cloudCover)}
                <small> %</small>
              </span>
            </div>
          </div>
          <p className="muted small">
            {t('cond.fetchedAt', { time: fmtTime(data.fetchedAt, LOCALES[lang]) })}
            {!online && ` · ${t('cond.offline')}`}
          </p>
        </>
      ) : (
        <p className="muted">{state.loading ? t('cond.loading') : online ? t('cond.waitingFix') : t('cond.offlineNoData')}</p>
      )}
      {state.error && <p className="error small">{t('cond.error')} ({state.error})</p>}
    </section>
  )
}
