import { useCallback, useMemo, useRef, useState } from 'react'
import { BottomDock, type Tab } from './components/BottomDock.tsx'
import { ChartPage } from './components/ChartPage.tsx'
import { DocsPage } from './components/DocsPage.tsx'
import { Header } from './components/Header.tsx'
import { LogPage } from './components/LogPage.tsx'
import { RenewalNotice } from './components/RenewalNotice.tsx'
import { PositionCard } from './components/PositionCard.tsx'
import { SafetyCard } from './components/SafetyCard.tsx'
import { SettingsPage } from './components/SettingsPage.tsx'
import { TidePage } from './components/TidePage.tsx'
import { WaveCard } from './components/WaveCard.tsx'
import { WeatherCard } from './components/WeatherCard.tsx'
import { WindCard } from './components/WindCard.tsx'
import type { LatLon } from './geo.ts'
import { useConditions } from './hooks/useConditions.ts'
import { useGeolocation } from './hooks/useGeolocation.ts'
import { useGoogleAuth } from './hooks/useGoogleAuth.ts'
import { useJmaWarnings } from './hooks/useJmaWarnings.ts'
import { useLog } from './hooks/useLog.ts'
import { useSync } from './hooks/useSync.ts'
import { useI18n } from './i18n/useI18n.ts'
import { loadProfile, saveProfile, upcomingRenewals, type Profile } from './profile.ts'
import { portLevels, sunsetAlert, tideAlert, tideCrossing, waveRisk } from './safety.ts'
import { sunTimes } from './sun.ts'
import { usePortTide } from './hooks/usePortTide.ts'
import { loadSettings, saveSettings, type Settings } from './settings.ts'
import type { TrackPoint } from './types.ts'
import { assessTrend } from './warning.ts'

type View = Tab | 'log'

export default function App() {
  const { t, lang } = useI18n()
  const [view, setView] = useState<View>('chart')
  const geo = useGeolocation()
  const fix = geo.fix
  const [settings, setSettingsState] = useState<Settings>(loadSettings)
  const [profile, setProfileState] = useState<Profile>(loadProfile)
  const profileRef = useRef(profile)
  profileRef.current = profile
  const [shownTrack, setShownTrack] = useState<TrackPoint[] | null>(null)
  const [focus, setFocus] = useState<(LatLon & { zoom?: number; key: number }) | null>(null)

  const auth = useGoogleAuth()
  const requestSync = useRef<() => void>(() => {})
  const [autoReturned, setAutoReturned] = useState(false)
  const log = useLog(
    fix,
    () => requestSync.current(),
    () => {
      setAutoReturned(true)
      navigator.vibrate?.([200, 100, 200])
    },
  )

  const setSettings = (s: Settings) => {
    setSettingsState(s)
    saveSettings(s)
  }

  /** 出航地・ボート・書類を変える。変えた日時を付けて保存し、同期する */
  const updateProfile = useCallback((update: (p: Profile) => Profile) => {
    const next = { ...update(profileRef.current), updatedAt: Date.now() }
    profileRef.current = next
    setProfileState(next)
    saveProfile(next)
    requestSync.current()
  }, [])

  const profileAccess = useMemo(
    () => ({
      get: () => profileRef.current,
      apply: (p: Profile) => {
        profileRef.current = p
        setProfileState(p)
        saveProfile(p)
      },
    }),
    [],
  )
  const sync = useSync(auth.account, profileAccess, () => void log.reload())
  requestSync.current = sync.request

  const conditions = useConditions(fix)
  const port = profile.ports.find((p) => p.id === profile.activePortId) ?? profile.ports[0] ?? null
  const warnings = useJmaWarnings([port, fix], lang)

  // 波・気象のボタンの「！」: 気象庁の注意報・警報・波高の危険・気圧の急な低下
  const data = conditions.data
  const alert =
    warnings.areas.some((a) => a.list.length > 0) ||
    (data?.marine ? waveRisk(data.marine.waves, profile.boat.dangerWave, Date.now()).level === 'warning' : false) ||
    (data?.weather ? assessTrend(data.weather.pressure, t, data.fetchedAt).level === 'warning' : false)

  // 日の出・潮のボタンの「！」: 出航地の危険潮位が近い・日没が近い（日出から日没までの航行限定の船）
  const portTide = usePortTide(port)
  const now = Date.now()
  const here = fix ?? port
  const noon = new Date(now)
  noon.setHours(12, 0, 0, 0)
  const tideWarn =
    (port !== null && portTide.seaLevel.length > 0 && tideAlert(tideCrossing(portLevels(port, portTide.seaLevel), port.dangerLevel, now), now)) ||
    (here !== null && sunsetAlert(sunTimes(noon.getTime(), here.lat, here.lon).sunset, now, profile.boat.daylightOnly, log.activeTrack !== null))

  // 免許の更新・次回の船舶検査（1か月前から知らせる）
  const renewals = useMemo(() => upcomingRenewals(profile, Date.now()), [profile])

  const go = (tab: View) => {
    setView(tab)
    window.scrollTo({ top: 0 })
  }

  return (
    <div className={`app${view === 'chart' ? ' app-chart' : ''}`}>
      <Header auth={auth} sync={sync} unsyncedCount={log.unsyncedCount} />
      {autoReturned && (
        <p className="banner banner-none" role="status" onClick={() => setAutoReturned(false)}>
          ⚓ {t('track.autoReturned')}
        </p>
      )}
      {view !== 'chart' && <RenewalNotice renewals={renewals} onOpen={() => go('docs')} />}

      {view === 'chart' && (
        <>
          <ChartPage
            geo={geo}
            log={log}
            profile={profile}
            settings={settings}
            onSettings={setSettings}
            onSelectPort={(id) => updateProfile((p) => ({ ...p, activePortId: id }))}
            shownTrack={shownTrack}
            onClearShown={() => setShownTrack(null)}
            focus={focus}
          />
          <button className="secondary log-open" onClick={() => go('log')}>
            📒 {t('log.open', { tracks: log.tracks.length, marks: log.marks.length })}
          </button>
        </>
      )}

      {view === 'log' && (
        <LogPage
          log={log}
          account={auth.account}
          onBack={() => go('chart')}
          onShowTrack={(points) => {
            setShownTrack(points)
            go('chart')
          }}
          onShowMark={(at) => {
            setFocus({ lat: at.lat, lon: at.lon, zoom: 15, key: Date.now() })
            go('chart')
          }}
        />
      )}

      {view === 'sea' && (
        <>
          <SafetyCard
            fix={fix}
            conditions={data}
            profile={profile}
            warnings={warnings}
            underway={log.activeTrack !== null}
            onSelectPort={(id) => updateProfile((p) => ({ ...p, activePortId: id }))}
            onOpenSettings={() => go('settings')}
          />
          <WindCard weather={data?.weather ?? null} at={fix ?? data?.at ?? null} unit={settings.windUnit} />
          <WaveCard marine={data?.marine ?? null} dangerWave={profile.boat.dangerWave} />
          <WeatherCard state={conditions} onRefresh={() => void conditions.refresh()} />
          <PositionCard geo={geo} />
          <p className="muted small">{t('sea.sources')}</p>
        </>
      )}

      {view === 'tide' && <TidePage at={fix ?? data?.at ?? null} conditions={data} profile={profile} />}

      {view === 'docs' && <DocsPage profile={profile} onChange={updateProfile} />}

      {view === 'settings' && (
        <SettingsPage
          auth={auth}
          sync={sync}
          unsyncedCount={log.unsyncedCount}
          profile={profile}
          onProfile={updateProfile}
          settings={settings}
          onSettings={setSettings}
          here={fix}
        />
      )}

      <BottomDock tab={view === 'log' ? 'chart' : view} onTab={go} recording={log.activeTrack !== null} alert={alert} tideAlert={tideWarn} docsAlert={renewals.length > 0} />
    </div>
  )
}
