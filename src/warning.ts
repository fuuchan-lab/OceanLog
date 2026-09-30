import type { TFn } from './i18n/context.ts'
import type { PressureForecast } from './weather.ts'

/** none: 安定 / caution・warning: 下降 / info: 上昇 */
type WarningLevel = 'none' | 'caution' | 'warning' | 'info'

/** 気圧の向き。アドバイスの出し分けに使う */
export type TrendDirection = 'falling' | 'rising' | 'stable'

export interface TrendAssessment {
  level: WarningLevel
  direction: TrendDirection
  message: string
}

const HOUR = 3_600_000

// 現在値からの変化量 (hPa) のしきい値
const CAUTION_3H = 2
const WARNING_3H = 4
const CAUTION_6H = 3
const WARNING_6H = 6

/** 予報の範囲内 (now, now+hours] での最低・最高気圧を返す */
function extremeAhead(f: PressureForecast, now: number, hours: number, pick: 'min' | 'max'): number | null {
  const pts = f.series.filter((p) => p.t > now && p.t <= now + hours * HOUR).map((p) => p.hpa)
  if (pts.length === 0) return null
  return pick === 'min' ? Math.min(...pts) : Math.max(...pts)
}

/** 気圧が下がりつつあるか・上がりつつあるかを判定し、表示する言語のメッセージにして返す */
export function assessTrend(f: PressureForecast, t: TFn, now: number): TrendAssessment {
  const drop3 = f.current - (extremeAhead(f, now, 3, 'min') ?? f.current)
  const drop6 = f.current - (extremeAhead(f, now, 6, 'min') ?? f.current)
  const rise3 = (extremeAhead(f, now, 3, 'max') ?? f.current) - f.current
  const rise6 = (extremeAhead(f, now, 6, 'max') ?? f.current) - f.current

  if (drop3 >= WARNING_3H || drop6 >= WARNING_6H) {
    return { level: 'warning', direction: 'falling', message: t('trend.warning') }
  }
  if (drop3 >= CAUTION_3H || drop6 >= CAUTION_6H) {
    return { level: 'caution', direction: 'falling', message: t('trend.caution') }
  }
  if (rise3 >= CAUTION_3H || rise6 >= CAUTION_6H) {
    return { level: 'info', direction: 'rising', message: t('trend.rising') }
  }

  const ago3 = f.series.filter((p) => p.t <= now - 3 * HOUR).at(-1)
  if (ago3 && ago3.hpa - f.current >= CAUTION_3H) {
    return { level: 'caution', direction: 'falling', message: t('trend.past', { d: (ago3.hpa - f.current).toFixed(1) }) }
  }
  if (ago3 && f.current - ago3.hpa >= CAUTION_3H) {
    return { level: 'info', direction: 'rising', message: t('trend.pastRising', { d: (f.current - ago3.hpa).toFixed(1) }) }
  }
  return { level: 'none', direction: 'stable', message: t('trend.stable') }
}
