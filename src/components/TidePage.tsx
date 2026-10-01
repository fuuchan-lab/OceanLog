import { useState } from 'react'
import { fmtTime } from '../format.ts'
import type { LatLon } from '../geo.ts'
import type { Conditions } from '../hooks/useConditions.ts'
import { usePortTide } from '../hooks/usePortTide.ts'
import { LOCALES } from '../i18n/context.ts'
import { useI18n } from '../i18n/useI18n.ts'
import type { HomePort, Profile } from '../profile.ts'
import { portLevels } from '../safety.ts'
import { monotonePath } from '../smoothPath.ts'
import { moonInfo, sunTimes, tideName, type SunTimes } from '../sun.ts'
import { findExtremes, levelAt, tideState } from '../tide.ts'
import type { SeaLevelPoint } from '../weather.ts'

const DAY = 86_400_000

function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const W = 340
const H = 150
const PAD_L = 30
const PAD_R = 8
const PAD_T = 30
const PAD_B = 22

const MIN = 60_000

/**
 * 昼と夜の背景（左から右へのグラデーションの区切り、0〜1）。
 * 夜明け（薄明の始まり）から日の出までと、日の入りから日暮れ（薄明の終わり）までを、なだらかに変える
 */
function skyStops(sun: SunTimes | null, from: number): { at: number; day: boolean }[] {
  if (!sun || sun.sunrise === null || sun.sunset === null) return [{ at: 0, day: true }, { at: 1, day: true }]
  const f = (tm: number) => Math.min(1, Math.max(0, (tm - from) / DAY))
  const dawn = sun.dawn ?? sun.sunrise - 30 * MIN
  const dusk = sun.dusk ?? sun.sunset + 30 * MIN
  return [
    { at: 0, day: false },
    { at: f(dawn), day: false },
    { at: f(sun.sunrise), day: true },
    { at: f(sun.sunset), day: true },
    { at: f(dusk), day: false },
    { at: 1, day: false },
  ]
}

/** 1日の潮位のグラフ（0時〜24時）。昼は明るく夜は暗い背景、日の出・日の入り、満潮・干潮の時刻と、港の危険潮位の線 */
function TideChart({ points, day, now, danger, unit, at }: { points: SeaLevelPoint[]; day: number; now: number; danger: number | null; unit: string; at: LatLon | null }) {
  const { t, lang } = useI18n()
  const sun = at ? sunTimes(day + DAY / 2, at.lat, at.lon) : null
  const skyId = `tide-sky-${Math.round(day / DAY)}-${at ? `${at.lat.toFixed(3)}-${at.lon.toFixed(3)}` : 'none'}`
  const from = day
  const to = day + DAY
  const inDay = points.filter((p) => p.t >= from - 3_600_000 && p.t <= to + 3_600_000)
  if (inDay.length < 4) return <p className="muted">{t('tide.noData')}</p>
  const extremes = findExtremes(points).filter((x) => x.t >= from && x.t <= to)
  const values = [...inDay.map((p) => p.h), ...(danger !== null ? [danger] : [])]
  const lo = Math.min(...values) - 0.1
  const hi = Math.max(...values) + 0.1
  const x = (tm: number) => PAD_L + ((tm - from) / DAY) * (W - PAD_L - PAD_R)
  const y = (h: number) => PAD_T + ((hi - h) / (hi - lo)) * (H - PAD_T - PAD_B)
  const clipped = inDay.map((p) => ({ x: x(p.t), y: y(p.h) }))
  const nowLevel = now >= from && now <= to ? levelAt(points, now) : null
  const step = hi - lo > 2 ? 1 : 0.5
  const ticks: number[] = []
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(Number(v.toFixed(2)))

  return (
    <svg className="tide-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t('tide.chartAria')}>
      <defs>
        <clipPath id="tide-clip">
          <rect x={PAD_L} y={0} width={W - PAD_L - PAD_R} height={H} />
        </clipPath>
        <linearGradient id={skyId} x1="0" x2="1" y1="0" y2="0">
          {skyStops(sun, from).map((s, i) => (
            <stop key={i} offset={s.at} className={s.day ? 'sky-day' : 'sky-night'} />
          ))}
        </linearGradient>
      </defs>
      {/* 昼は明るく、夜は暗く。日の出・日の入りのあたりはグラデーション */}
      <rect x={PAD_L} y={PAD_T - 8} width={W - PAD_L - PAD_R} height={H - PAD_B - PAD_T + 8} fill={`url(#${skyId})`} className="tide-sky" />
      {sun &&
        ([
          ['sunrise', sun.sunrise, 'start'],
          ['sunset', sun.sunset, 'end'],
        ] as const).map(([kind, tm]) =>
          tm !== null && tm >= from && tm <= to ? (
            <g key={kind}>
              <line x1={x(tm)} x2={x(tm)} y1={PAD_T - 8} y2={H - PAD_B} className="sun-line" />
              <text x={x(tm)} y={10} textAnchor="middle" className="sun-label">
                {kind === 'sunrise' ? '☀↑' : '☀↓'} {fmtTime(tm, LOCALES[lang])}
              </text>
            </g>
          ) : null,
        )}
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} className="grid-line" />
          <text x={PAD_L - 4} y={y(v) + 3} textAnchor="end" className="axis-label">
            {v.toFixed(1)}
          </text>
        </g>
      ))}
      {[0, 6, 12, 18, 24].map((h) => (
        <text key={h} x={x(from + h * 3_600_000)} y={H - 6} textAnchor="middle" className="axis-label">
          {h}
        </text>
      ))}
      <text x={4} y={PAD_T - 10} className="axis-label">
        {unit}
      </text>
      {danger !== null && (
        <>
          <rect x={PAD_L} y={y(danger)} width={W - PAD_L - PAD_R} height={Math.max(0, H - PAD_B - y(danger))} className="danger-zone" />
          <line x1={PAD_L} x2={W - PAD_R} y1={y(danger)} y2={y(danger)} className="danger-line" />
        </>
      )}
      <g clipPath="url(#tide-clip)">
        <path d={`${monotonePath(clipped)} L${clipped.at(-1)?.x},${H - PAD_B} L${clipped[0].x},${H - PAD_B} Z`} className="tide-fill" />
        <path d={monotonePath(clipped)} className="tide-line" />
      </g>
      {extremes.map((e) => (
        <g key={e.t}>
          <circle cx={x(e.t)} cy={y(e.h)} r={3} className={e.kind === 'high' ? 'tide-high' : 'tide-low'} />
          <text x={x(e.t)} y={e.kind === 'high' ? y(e.h) - 6 : y(e.h) + 12} textAnchor="middle" className="tide-label">
            {fmtTime(e.t, LOCALES[lang])}
          </text>
        </g>
      ))}
      {nowLevel !== null && (
        <>
          <line x1={x(now)} x2={x(now)} y1={PAD_T - 6} y2={H - PAD_B} className="now-line" />
          <circle cx={x(now)} cy={y(nowLevel)} r={4.5} className="spark-dot-now" />
        </>
      )}
    </svg>
  )
}

function TideSection({ title, points, day, now, danger, note, at }: { title: string; points: SeaLevelPoint[]; day: number; now: number; danger: number | null; note?: string; at: LatLon | null }) {
  const { t, lang } = useI18n()
  const extremes = findExtremes(points).filter((x) => x.t >= day && x.t <= day + DAY)
  const state = tideState(findExtremes(points), now)
  const level = levelAt(points, now)
  const isToday = startOfDay(now) === day
  return (
    <section className="card">
      <h2>{title}</h2>
      {isToday && state && (
        <p className="tide-now">
          {state.direction === 'rising' ? '⬆️ ' + t('tide.rising') : '⬇️ ' + t('tide.falling')}
          {level !== null && <span className="muted"> · {t('tide.levelNow', { v: Math.round(level * 100) })}</span>}
          <br />
          <span className="small">
            {t(state.next.kind === 'high' ? 'tide.nextHigh' : 'tide.nextLow', { time: fmtTime(state.next.t, LOCALES[lang]) })}
          </span>
        </p>
      )}
      <TideChart points={points} day={day} now={now} danger={danger} unit={t('tide.unitM')} at={at} />
      <p className="muted small sky-legend">
        <span className="sky-swatch sky-swatch-day" aria-hidden="true" /> {t('tide.skyDay')} <span className="sky-swatch sky-swatch-night" aria-hidden="true" /> {t('tide.skyNight')} · ☀↑ {t('sun.sunrise')} · ☀↓ {t('sun.sunset')}
      </p>
      <ul className="extremes">
        {extremes.map((e) => (
          <li key={e.t} className={e.kind}>
            <span>{e.kind === 'high' ? t('tide.high') : t('tide.low')}</span>
            <b>{fmtTime(e.t, LOCALES[lang])}</b>
            <span className="muted">{Math.round(e.h * 100)} cm</span>
          </li>
        ))}
      </ul>
      {note && <p className="muted small">{note}</p>}
    </section>
  )
}

function SunCard({ at, day }: { at: LatLon; day: number }) {
  const { t, lang } = useI18n()
  const locale = LOCALES[lang]
  const sun = sunTimes(day + DAY / 2, at.lat, at.lon)
  const moon = moonInfo(day + DAY / 2)
  const cell = (label: string, v: number | null) => (
    <div>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{v === null ? '—' : fmtTime(v, locale)}</span>
    </div>
  )
  return (
    <section className="card">
      <h2>{t('sun.title')}</h2>
      <div className="stats stats-4">
        {cell(t('sun.dawn'), sun.dawn)}
        {cell(t('sun.sunrise'), sun.sunrise)}
        {cell(t('sun.sunset'), sun.sunset)}
        {cell(t('sun.dusk'), sun.dusk)}
      </div>
      <p className="moon">
        <span className="moon-icon" aria-hidden="true">
          {moon.icon}
        </span>
        {t('sun.moon', { age: moon.age.toFixed(1), pct: Math.round(moon.illumination * 100) })}
        <span className="tide-name">{t(`tideName.${tideName(moon.age)}`)}</span>
      </p>
      <p className="muted small">{t('sun.hint')}</p>
    </section>
  )
}

function PortTide({ port, day, now }: { port: HomePort; day: number; now: number }) {
  const { t } = useI18n()
  const { seaLevel } = usePortTide(port)
  return (
    <TideSection
      title={t('tide.portTitle', { port: port.name })}
      points={portLevels(port, seaLevel)}
      day={day}
      now={now}
      danger={port.dangerLevel}
      at={port}
      note={t('tide.portNote', { z0: Math.round(port.z0 * 100), v: Math.round(port.dangerLevel * 100) })}
    />
  )
}

/** 日没・干満の画面。現在地と出航地の潮位、日の出・日の入り・薄明、月齢と潮の呼び名。日付を切り替えられる */
export function TidePage({ at, conditions, profile, underway }: { at: LatLon | null; conditions: Conditions | null; profile: Profile; underway: boolean }) {
  const { t, lang } = useI18n()
  const now = Date.now()
  const [offset, setOffset] = useState(0)
  const day = startOfDay(now) + offset * DAY
  const port = profile.ports.find((p) => p.id === profile.activePortId) ?? profile.ports[0] ?? null
  const place = at ?? port

  return (
    <>
      <div className="seg day-seg">
        {[-1, 0, 1, 2].map((o) => (
          <button key={o} className={offset === o ? 'on' : ''} onClick={() => setOffset(o)}>
            {o === 0 ? t('day.today') : o === 1 ? t('day.tomorrow') : o === -1 ? t('day.yesterday') : new Date(startOfDay(now) + o * DAY).toLocaleDateString(LOCALES[lang], { month: 'numeric', day: 'numeric' })}
          </button>
        ))}
      </div>
      {place ? <SunCard at={place} day={day} /> : <p className="muted">{t('pos.waiting')}</p>}
      {port && <PortTide port={port} day={day} now={now} />}
      {/* 出港してからは、現在地の潮位も出す（出港前は、出航地の潮位だけ） */}
      {(underway || !port) && conditions?.marine && conditions.marine.seaLevel.length > 0 && (
        <TideSection title={t('tide.hereTitle')} points={conditions.marine.seaLevel} day={day} now={now} danger={null} note={t('tide.hereNote')} at={at ?? conditions.at} />
      )}
      <p className="muted small">{t('tide.disclaimer')}</p>
    </>
  )
}
