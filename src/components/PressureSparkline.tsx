import { TREND_FUTURE_HOURS, TREND_PAST_HOURS, markPoints, trendSeries } from '../forecast.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { monotonePath } from '../smoothPath.ts'
import type { PressureForecast } from '../weather.ts'

// 表示幅に近い座標系にして、文字が小さくなりすぎないようにする
const W = 340
const H = 104
const PAD_X = 18
const PAD_TOP = 22
const PAD_BOTTOM = 20
/** 縦軸の最小の幅 (hPa)。変化が小さい時に、わずかな揺れが大きく見えすぎないようにする */
const MIN_RANGE = 3

/**
 * 気圧の推移（直前6時間〜今後12時間、15分刻み）の小さなグラフ。実績は実線、予報は破線。
 * 2時間ごとに丸と、その近くに小さく気圧の数値を出す。
 */
export function PressureSparkline({ forecast, now }: { forecast: PressureForecast; now: number }) {
  const { t } = useI18n()
  const points = trendSeries(forecast, now)
  if (points.length < 3) return null

  const values = points.map((p) => p.hpa)
  const mid = (Math.max(...values) + Math.min(...values)) / 2
  const half = Math.max(Math.max(...values) - Math.min(...values), MIN_RANGE) / 2
  const span = TREND_PAST_HOURS + TREND_FUTURE_HOURS
  const x = (hours: number) => PAD_X + ((hours + TREND_PAST_HOURS) / span) * (W - PAD_X * 2)
  const y = (hpa: number) => PAD_TOP + ((mid + half - hpa) / (half * 2)) * (H - PAD_TOP - PAD_BOTTOM)
  const line = (ps: typeof points) => monotonePath(ps.map((p) => ({ x: x(p.hours), y: y(p.hpa) })))
  const past = points.filter((p) => p.hours <= 0)
  const future = points.filter((p) => p.hours >= 0)
  const label = (hours: number) => (hours === 0 ? t('spark.now') : `${hours > 0 ? '+' : ''}${hours}h`)

  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('spark.aria')}>
      {/* 「今」の位置の縦線 */}
      <line x1={x(0)} x2={x(0)} y1={PAD_TOP - 6} y2={H - PAD_BOTTOM + 2} className="spark-now-line" />
      {past.length > 1 && <path d={line(past)} className="spark-line" />}
      {future.length > 1 && <path d={line(future)} className="spark-line spark-future" />}
      {markPoints(points).map(({ hours, point }) => (
        <g key={hours}>
          <circle
            cx={x(point.hours)}
            cy={y(point.hpa)}
            r={hours === 0 ? 4.5 : 3}
            className={hours === 0 ? 'spark-dot spark-dot-now' : 'spark-dot'}
          />
          {/* 数値は丸の少し上に小さく（2時間ごと） */}
          <text x={x(point.hours)} y={y(point.hpa) - 8} textAnchor="middle" className="spark-value">
            {point.hpa.toFixed(1)}
          </text>
          <text x={x(point.hours)} y={H - 6} textAnchor="middle" className="spark-label">
            {label(hours)}
          </text>
        </g>
      ))}
    </svg>
  )
}
