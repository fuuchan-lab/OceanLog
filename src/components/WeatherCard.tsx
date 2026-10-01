import { fmtNum, fmtTime } from '../format.ts'
import type { ConditionsState } from '../hooks/useConditions.ts'
import { useOnline } from '../hooks/useOnline.ts'
import { LOCALES } from '../i18n/context.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { assessTrend } from '../warning.ts'
import { describeWeather } from '../weather.ts'
import { beaufort, compassPoint, convertWind, WIND_UNIT_LABEL, type LatLon, type WindUnit } from '../geo.ts'
import { WeatherTimeline } from './WeatherTimeline.tsx'
import { WindArrow, WindyEmbed } from './Wind.tsx'

/** 天気・気圧・風を1枚に。風と天気の予報は、気圧のグラフと時間の軸をそろえる。気圧の変化の判定は頭痛ログと同じ */
export function WeatherCard({ state, onRefresh, unit, at }: { state: ConditionsState; onRefresh: () => void; unit: WindUnit; at: LatLon | null }) {
  const { t, lang } = useI18n()
  const online = useOnline()
  const data = state.data
  const w = data?.weather
  const view = w ? describeWeather(w.pressure.weather.code, w.pressure.weather.isDay, t) : null
  const trend = w && data ? assessTrend(w.pressure, t, data.fetchedAt) : null
  const u = WIND_UNIT_LABEL[unit]
  const sp = (ms: number) => fmtNum(convertWind(ms, unit), unit === 'ms' ? 1 : 0)

  return (
    <section className="card">
      <div className="row">
        <h2>{t('weatherWind.title')}</h2>
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
          {/* いまの風 */}
          <div className="wind-now">
            <WindArrow from={w.wind.direction} size={56} />
            <div>
              <p className="big">
                {sp(w.wind.speed)}
                <span className="unit"> {u}</span>
              </p>
              <p className="muted">
                {t('wind.from', { dir: compassPoint(w.wind.direction, lang), deg: Math.round(w.wind.direction) })} · {t('wind.gust', { v: sp(w.wind.gust), u })} ·{' '}
                {t('wind.beaufort', { b: beaufort(w.wind.speed) })}
              </p>
            </div>
          </div>
          {/* 天気・風・気圧を、同じ時間の軸で */}
          <WeatherTimeline weather={w} now={data.fetchedAt} unit={unit} />
          <p className="muted small">{t('timeline.hint', { u })}</p>
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
      {/* Windy のマップ（いつも表示） */}
      {at && <WindyEmbed at={at} />}
    </section>
  )
}
