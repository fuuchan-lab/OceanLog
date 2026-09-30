import { useEffect, useMemo, useRef } from 'react'
import { fmtDuration, fmtNum, fmtTime } from '../format.ts'
import { NM } from '../geo.ts'
import type { Conditions } from '../hooks/useConditions.ts'
import type { Fix } from '../hooks/useGeolocation.ts'
import type { WarningsState } from '../hooks/useJmaWarnings.ts'
import { usePortTide } from '../hooks/usePortTide.ts'
import { LOCALES } from '../i18n/context.ts'
import type { MessageKey } from '../i18n/messages.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { jmaPageUrl } from '../jma.ts'
import { RENEWAL_NOTICE_DAYS, daysUntil, type Profile } from '../profile.ts'
import { latestDeparture, portLevels, returnEstimate, tideCrossing, urgency, waveRisk, type Level } from '../safety.ts'
import { sunTimes } from '../sun.ts'
import { assessTrend } from '../warning.ts'

interface Props {
  fix: Fix | null
  conditions: Conditions | null
  profile: Profile
  warnings: WarningsState
  /** 出港中（航跡を記録中） */
  underway: boolean
  onSelectPort: (id: string) => void
  onOpenSettings: () => void
}

interface Item {
  level: Level
  icon: string
  text: string
  sub?: string
  link?: { href: string; label: string }
}

/**
 * 航海の安全の目安をまとめて出す。気象庁の注意報・警報、出航地の干潮危険潮位までの時間、
 * 日没までの時間、遅くとも帰路につく時刻、波高の危険予測、気圧の急な変化
 */
export function SafetyCard({ fix, conditions, profile, warnings, underway, onSelectPort, onOpenSettings }: Props) {
  const { t, lang } = useI18n()
  const locale = LOCALES[lang]
  const port = profile.ports.find((p) => p.id === profile.activePortId) ?? profile.ports[0] ?? null
  const portTide = usePortTide(port)
  const now = Date.now()
  // 1分ごとに残り時間を更新する（再描画は位置の更新でも起きる）
  const minute = Math.floor(now / 60_000)

  const items = useMemo(() => {
    const list: Item[] = []
    const here = fix ?? port

    // 気象庁の注意報・警報
    for (const a of warnings.areas) {
      for (const w of a.list) {
        list.push({
          level: w.level === 'advisory' ? 'caution' : 'warning',
          icon: w.level === 'emergency' ? '🟪' : w.level === 'warning' ? '🟥' : '🟨',
          text: t('safety.jma', { name: w.name, area: a.area.name }),
          link: { href: jmaPageUrl(a.area), label: t('safety.jmaLink') },
        })
      }
    }

    // 日没・薄明
    const deadlines: (number | null)[] = []
    if (here) {
      const noon = new Date(now)
      noon.setHours(12, 0, 0, 0)
      const sun = sunTimes(noon.getTime(), here.lat, here.lon)
      if (sun.sunset !== null && sun.sunset > now) {
        deadlines.push(sun.sunset)
        list.push({
          level: urgency(sun.sunset - now),
          icon: '🌇',
          text: t('safety.sunset', { d: fmtDuration(sun.sunset - now, t), time: fmtTime(sun.sunset, locale) }),
          sub: sun.dusk !== null ? t('safety.dusk', { time: fmtTime(sun.dusk, locale) }) : undefined,
        })
      } else if (sun.sunset !== null && sun.sunset <= now) {
        list.push({ level: underway ? 'warning' : 'info', icon: '🌙', text: t('safety.afterSunset') })
      }
    }

    // 出航地の干潮危険潮位
    if (port) {
      const levels = portLevels(port, portTide.seaLevel)
      const c = tideCrossing(levels, port.dangerLevel, now)
      const levelText = c.levelNow === null ? '' : t('safety.levelNow', { v: Math.round(c.levelNow * 100) })
      if (levels.length === 0) {
        list.push({ level: 'info', icon: '🌊', text: t('safety.noPortTide', { port: port.name }) })
      } else if (c.belowNow) {
        list.push({
          level: 'warning',
          icon: '🚫',
          text: t('safety.belowNow', { port: port.name, v: Math.round(port.dangerLevel * 100) }),
          sub: [c.recoverAt ? t('safety.recoverAt', { time: fmtTime(c.recoverAt, locale) }) : '', levelText].filter(Boolean).join(' / '),
        })
      } else if (c.dropAt !== null) {
        deadlines.push(c.dropAt)
        list.push({
          level: urgency(c.dropAt - now),
          icon: '⏬',
          text: t('safety.dropAt', { port: port.name, d: fmtDuration(c.dropAt - now, t), time: fmtTime(c.dropAt, locale) }),
          sub: [t('safety.dangerLevel', { v: Math.round(port.dangerLevel * 100) }), levelText].filter(Boolean).join(' / '),
        })
      } else {
        list.push({ level: 'ok', icon: '✅', text: t('safety.tideOk', { port: port.name }), sub: levelText || undefined })
      }

      // 帰港にかかる時間と、遅くとも帰路につく時刻
      if (fix) {
        const ret = returnEstimate(fix, port, profile.boat)
        if (ret.distance > 300) {
          const plan = latestDeparture(deadlines, ret.duration)
          const base = t('safety.return', { port: port.name, nm: (ret.distance / NM).toFixed(1), d: fmtDuration(ret.duration, t) })
          if (plan) {
            const left = plan.at - now
            list.push({
              level: left <= 0 ? 'warning' : urgency(left),
              icon: '🧭',
              text: left <= 0 ? t('safety.returnNow') : t('safety.leaveBy', { time: fmtTime(plan.at, locale), d: fmtDuration(left, t) }),
              sub: base,
            })
          } else {
            list.push({ level: 'info', icon: '🧭', text: base })
          }
        }
      }
    }

    // 波高の危険予測（ボートの危険波高と比べる）
    if (conditions?.marine) {
      const risk = waveRisk(conditions.marine.waves, profile.boat.dangerWave, now)
      if (risk.level !== 'none' && risk.at !== null) {
        const key: MessageKey = risk.level === 'warning' ? 'safety.waveWarning' : 'safety.waveCaution'
        list.push({
          level: risk.level,
          icon: '🌊',
          text: t(key, {
            time: risk.at <= now ? t('safety.now') : fmtTime(risk.at, locale),
            v: fmtNum(risk.max),
            limit: fmtNum(profile.boat.dangerWave),
          }),
        })
      } else if (profile.boat.dangerWave && risk.max !== null) {
        list.push({ level: 'ok', icon: '🌊', text: t('safety.waveOk', { v: fmtNum(risk.max), limit: fmtNum(profile.boat.dangerWave) }) })
      }
    }

    // 気圧の急な変化（頭痛ログと同じ判定）
    if (conditions?.weather) {
      const trend = assessTrend(conditions.weather.pressure, t, conditions.fetchedAt)
      if (trend.level === 'warning' || trend.level === 'caution') {
        list.push({ level: trend.level, icon: '📉', text: trend.message })
      }
    }

    // 免許・船舶検査の有効期限（1か月を切ったら）
    for (const [date, key] of [
      [profile.docs.licenseExpiry, 'docs.license'],
      [profile.docs.inspectionExpiry, 'renew.inspection'],
    ] as const) {
      const days = daysUntil(date, now)
      if (days === null || days > RENEWAL_NOTICE_DAYS) continue
      list.push({
        level: days < 0 ? 'warning' : 'caution',
        icon: '📄',
        text: days < 0 ? t('safety.expired', { name: t(key) }) : t('safety.expiry', { name: t(key), n: days }),
      })
    }

    const rank: Record<Level, number> = { warning: 0, caution: 1, info: 2, ok: 3 }
    return list.sort((a, b) => rank[a.level] - rank[b.level])
    // minute: 時間の経過で残り時間を作り直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix, port, portTide.seaLevel, conditions, profile.boat, profile.docs, warnings, underway, t, locale, minute])

  // 新しく「警告」が出たら、1回だけ振動で知らせる（対応している端末のみ）
  const warned = useRef('')
  useEffect(() => {
    const sig = items
      .filter((i) => i.level === 'warning')
      .map((i) => i.icon + i.text.replace(/\d/g, ''))
      .join('|')
    if (sig && sig !== warned.current && underway) navigator.vibrate?.([300, 150, 300])
    warned.current = sig
  }, [items, underway])

  return (
    <section className="card safety">
      <div className="row">
        <h2>{t('safety.title')}</h2>
        {profile.ports.length > 1 && port && (
          <select className="compact" value={port.id} onChange={(e) => onSelectPort(e.target.value)} aria-label={t('safety.port')}>
            {profile.ports.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {!port && (
        <p className="muted small">
          {t('safety.noPort')}{' '}
          <button className="link" onClick={onOpenSettings}>
            {t('safety.goSettings')}
          </button>
        </p>
      )}
      {port && !profile.boat.dangerWave && (
        <p className="muted small">
          {t('safety.noBoat')}{' '}
          <button className="link" onClick={onOpenSettings}>
            {t('safety.goSettings')}
          </button>
        </p>
      )}
      <ul className="safety-list">
        {items.map((i, k) => (
          <li key={k} className={`safety-item level-${i.level}`} role={i.level === 'warning' ? 'alert' : undefined}>
            <span className="safety-icon" aria-hidden="true">
              {i.icon}
            </span>
            <div>
              <p>{i.text}</p>
              {i.sub && <p className="small muted">{i.sub}</p>}
              {i.link && (
                <a className="small" href={i.link.href} target="_blank" rel="noopener">
                  {i.link.label}
                </a>
              )}
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="muted small">{t('safety.none')}</li>}
      </ul>
      {warnings.fetchedAt && (
        <p className="muted small">
          {t('safety.jmaChecked', { time: fmtTime(warnings.fetchedAt, locale) })}
          {warnings.areas.length > 0 && ` · ${warnings.areas.map((a) => a.area.name).join('・')}`}
        </p>
      )}
      <p className="muted small">{t('safety.disclaimer')}</p>
    </section>
  )
}
