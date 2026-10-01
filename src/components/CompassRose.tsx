import { compassPoint } from '../geo.ts'
import type { CompassState } from '../hooks/useCompass.ts'
import { useI18n } from '../i18n/useI18n.ts'

/**
 * コンパス（磁方位）。方位盤が回り、上の三角の位置が、スマホの上端が向いている方角。
 * 対地針路（GPS による進んでいる向き、真方位）とは別のもの
 */
export function CompassRose({ compass, course }: { compass: CompassState; course: number | null }) {
  const { t, lang } = useI18n()
  const { heading, needsPermission, supported, enable, disable, off } = compass

  // 止めている時・iPhone で許可がまだの時は「コンパスを使う」ボタン
  if ((needsPermission || off) && supported) {
    return (
      <button className="compass compass-enable" onClick={() => void enable()}>
        🧭
        <span className="small">{t('compass.enable')}</span>
      </button>
    )
  }
  if (!supported || heading === null) return null

  const rot = -heading
  return (
    // タップするとコンパスを止める
    <button
      type="button"
      className="compass compass-on"
      onClick={disable}
      aria-label={`${t('compass.aria', { deg: Math.round(heading), dir: compassPoint(heading, lang) })}。${t('compass.tapToStop')}`}
      title={t('compass.tapToStop')}
    >
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="47" className="compass-face" />
        <g transform={`rotate(${rot} 50 50)`}>
          {Array.from({ length: 36 }, (_, i) => (
            <line key={i} x1="50" y1="5" x2="50" y2={i % 9 === 0 ? 15 : i % 3 === 0 ? 12 : 9} transform={`rotate(${i * 10} 50 50)`} className="compass-tick" />
          ))}
          {(['N', 'E', 'S', 'W'] as const).map((d, i) => (
            <text key={d} x="50" y="25" textAnchor="middle" transform={`rotate(${i * 90} 50 50)`} className={d === 'N' ? 'compass-n' : 'compass-letter'}>
              {lang === 'ja' ? { N: '北', E: '東', S: '南', W: '西' }[d] : d}
            </text>
          ))}
          {course !== null && <path d="M50 28 L55 36 L45 36 Z" transform={`rotate(${course} 50 50)`} className="compass-cog" />}
        </g>
        {/* 中央の数字の下地（回る文字と重ならないように） */}
        <circle cx="50" cy="55" r="20" className="compass-center" />
        {/* 上端の三角: スマホが向いている方角 */}
        <path d="M50 1 L57 13 L43 13 Z" className="compass-lubber" />
        <text x="50" y="57" textAnchor="middle" className="compass-deg">
          {String(Math.round(heading) % 360).padStart(3, '0')}°
        </text>
        <text x="50" y="68" textAnchor="middle" className="compass-dir">
          {compassPoint(heading, lang)}
        </text>
      </svg>
    </button>
  )
}
