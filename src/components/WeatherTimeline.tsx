import { TREND_FUTURE_HOURS, TREND_PAST_HOURS, markPoints, trendSeries } from '../forecast.ts'
import { fmtNum } from '../format.ts'
import { convertWind, type WindUnit } from '../geo.ts'
import { LOCALES } from '../i18n/context.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { monotonePath } from '../smoothPath.ts'
import { describeWeather, type Weather, type WindHour } from '../weather.ts'

const W = 340
const PAD_L = 34
const PAD_R = 14
/** 風の欄（時刻・天気・風向・平均・瞬間・降水）の高さ */
const TOP = 112
/** 気圧の数値の行と、気圧のグラフ */
const P_ROW = TOP + 18
const P_TOP = P_ROW + 10
const P_H = 64
const H = P_TOP + P_H + 18
const MIN_RANGE = 3
const HOUR = 3_600_000

/**
 * 天気・風・気圧を、同じ時間の軸（6時間前〜12時間後、2時間ごと）にそろえて1つの図にする。
 * 上に時刻・天気・風向・平均風速・最大瞬間風速・降水確率、下に気圧の推移（実績は実線、予報は破線）
 */
export function WeatherTimeline({ weather, now, unit }: { weather: Weather; now: number; unit: WindUnit }) {
  const { t, lang } = useI18n()
  const points = trendSeries(weather.pressure, now)
  const span = TREND_PAST_HOURS + TREND_FUTURE_HOURS
  const x = (hours: number) => PAD_L + ((hours + TREND_PAST_HOURS) / span) * (W - PAD_L - PAD_R)
  const step = ((W - PAD_L - PAD_R) / span) * 2
  const v = (ms: number) => fmtNum(convertWind(ms, unit), unit === 'ms' ? 1 : 0)

  const values = points.map((p) => p.hpa)
  const mid = (Math.max(...values) + Math.min(...values)) / 2
  const half = Math.max(Math.max(...values) - Math.min(...values), MIN_RANGE) / 2
  const y = (hpa: number) => P_TOP + 6 + ((mid + half - hpa) / (half * 2)) * (P_H - 12)
  const line = (ps: typeof points) => monotonePath(ps.map((p) => ({ x: x(p.hours), y: y(p.hpa) })))
  const past = points.filter((p) => p.hours <= 0)
  const future = points.filter((p) => p.hours >= 0)
  const marks = markPoints(points)

  const hours: number[] = []
  for (let h = -TREND_PAST_HOURS; h <= TREND_FUTURE_HOURS; h += 2) hours.push(h)
  const windAt = (h: number): WindHour | null => {
    const target = now + h * HOUR
    let best: WindHour | null = null
    for (const w of weather.hourly) if (Math.abs(w.t - target) <= 0.5 * HOUR && (!best || Math.abs(w.t - target) < Math.abs(best.t - target))) best = w
    return best
  }
  const clock = (h: number) => new Date(now + h * HOUR).toLocaleTimeString(LOCALES[lang], { hour: 'numeric' })

  return (
    <svg className="timeline" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('timeline.aria')}>
      {/* 今の列: 緑でゆっくり点滅 */}
      <rect x={x(0) - step / 2 + 1} y={2} width={step - 2} height={H - 4} rx={6} className="timeline-now" />
      {/* 行の見出し */}
      <text x={2} y={46} className="timeline-row">{t('timeline.wx')}</text>
      <text x={2} y={66} className="timeline-row">{t('timeline.dir')}</text>
      <text x={2} y={82} className="timeline-row">{t('wind.avgShort')}</text>
      <text x={2} y={96} className="timeline-row">{t('wind.gustShort')}</text>
      <text x={2} y={110} className="timeline-row">☔%</text>
      <text x={2} y={P_ROW} className="timeline-row">{t('timeline.hpa')}</text>
      <line x1={PAD_L - 4} x2={W - 2} y1={TOP + 4} y2={TOP + 4} className="grid-line" />
      {hours.map((h) => {
        const w = windAt(h)
        const cx = x(h)
        const past = h < 0
        const wx = w ? describeWeather(w.code, w.isDay, t) : null
        return (
          <g key={h} className={past ? 'timeline-past' : h === 0 ? 'timeline-col-now' : undefined}>
            <text x={cx} y={14} textAnchor="middle" className="timeline-time">
              {h === 0 ? t('spark.now') : clock(h)}
            </text>
            {wx && (
              <text x={cx} y={48} textAnchor="middle" className="timeline-icon">
                <title>{wx.label}</title>
                {wx.icon}
              </text>
            )}
            {w && (
              <>
                <g transform={`translate(${cx - 8} 54) rotate(${w.direction + 180} 8 8)`}>
                  <path d="M8 1 12.5 10H9.5v5h-3v-5H3.5z" className="timeline-arrow" />
                </g>
                <text x={cx} y={83} textAnchor="middle" className="timeline-speed">
                  {v(w.speed)}
                </text>
                <text x={cx} y={97} textAnchor="middle" className="timeline-gust">
                  {v(w.gust)}
                </text>
                {w.precipProb !== null && (
                  <text x={cx} y={111} textAnchor="middle" className="timeline-gust">
                    {Math.round(w.precipProb)}
                  </text>
                )}
              </>
            )}
          </g>
        )
      })}
      {/* 気圧 */}
      {past.length > 1 && <path d={line(past)} className="spark-line" />}
      {future.length > 1 && <path d={line(future)} className="spark-line spark-future" />}
      {marks.map(({ hours: h, point }) => (
        <g key={h}>
          <circle cx={x(point.hours)} cy={y(point.hpa)} r={h === 0 ? 4.5 : 3} className={h === 0 ? 'spark-dot spark-dot-now' : 'spark-dot'} />
          {/* 数値は線の上ではなく、上の行にそろえて出す（重ならないように） */}
          <text x={x(point.hours)} y={P_ROW} textAnchor="middle" className={h === 0 ? 'timeline-hpa timeline-hpa-now' : 'timeline-hpa'}>
            {Math.round(point.hpa)}
          </text>
        </g>
      ))}
      {hours.map((h) => (
        <text key={h} x={x(h)} y={H - 4} textAnchor="middle" className="spark-label">
          {h === 0 ? t('spark.now') : `${h > 0 ? '+' : ''}${h}h`}
        </text>
      ))}
    </svg>
  )
}
