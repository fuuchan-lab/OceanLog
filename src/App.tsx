import { useCallback, useMemo, useRef, useState } from 'react'
import { BottomDock, type Tab } from './components/BottomDock.tsx'
import { ChartPage } from './components/ChartPage.tsx'
import { DocsPage } from './components/DocsPage.tsx'
import { EquipmentPage } from './components/EquipmentPage.tsx'
import { checkedToday, checklistItems } from './equipment.ts'
import { Header } from './components/Header.tsx'
import { LogPage } from './components/LogPage.tsx'
import { RenewalNotice } from './components/RenewalNotice.tsx'
import { PositionCard } from './components/PositionCard.tsx'
import { SafetyCard } from './components/SafetyCard.tsx'
import { SettingsPage } from './components/SettingsPage.tsx'
import { TidePage } from './components/TidePage.tsx'
import { WaveInfo } from './components/WaveCard.tsx'
import { WeatherCard } from './components/WeatherCard.tsx'
import { WindCard } from './components/WindCard.tsx'
import type { LatLon } from './geo.ts'
import { useConditions } from './hooks/useConditions.ts'
import { useGeolocation } from './hooks/useGeolocation.ts'
import { useGoogleAuth } from './hooks/useGoogleAuth.ts'
import { useJmaWarnings } from './hooks/useJmaWarnings.ts'
import { marksToHazards, useOsmHazards } from './hooks/useHazards.ts'
import { useLog } from './hooks/useLog.ts'
import { useSync } from './hooks/useSync.ts'
import { useI18n } from './i18n/useI18n.ts'
import { loadProfile, saveProfile, upcomingRenewals, type Profile } from './profile.ts'
import { portLevels, sunsetAlert, tideAlert, tideCrossing, waveRisk } from './safety.ts'
import { sunTimes } from './sun.ts'
import { usePortTide } from './hooks/usePortTide.ts'
import { loadSettings, saveSettings, SETTINGS_KEY, type Settings } from './settings.ts'
import { loadMsil, MSIL_KEY, saveMsil, type MsilSettings } from './msil.ts'
import { LANG_STORAGE_KEY, savedLang, type Lang } from './i18n/context.ts'
import { loadPrefStamps, savePrefStamps, type PrefSection, type PrefStamps, type PrefValues } from './prefs.ts'
import { applyTheme, loadTheme, saveTheme, THEME_STORAGE_KEY, type ThemePreference } from './theme.ts'
import type { TrackPoint } from './types.ts'
import { assessTrend } from './warning.ts'

type View = Tab | 'log' | 'equip'

export default function App() {
  const { t, lang, setLang } = useI18n()
  // ヘルプの「戻る」から来た時（#settings）は、設定の画面を開く
  const [view, setView] = useState<View>(() => (location.hash === '#settings' ? 'settings' : 'chart'))
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

  const [msil, setMsilState] = useState<MsilSettings>(loadMsil)
  const [theme, setThemeState] = useState<ThemePreference>(loadTheme)

  // 設定は、変えた日時をまとまりごとに記録して、Google ドライブの prefs.json で別の端末と共通にする
  const prefStamps = useRef<PrefStamps>(loadPrefStamps({ settings: SETTINGS_KEY, msil: MSIL_KEY, lang: LANG_STORAGE_KEY, theme: THEME_STORAGE_KEY }))
  const touchPref = (key: PrefSection) => {
    prefStamps.current = { ...prefStamps.current, [key]: Date.now() }
    savePrefStamps(prefStamps.current)
    requestSync.current()
  }
  const prefValues = useRef<PrefValues>({ settings, msil, lang: savedLang(), theme })
  prefValues.current = { settings, msil, lang: savedLang(), theme }

  const setMsil = (m: MsilSettings) => {
    setMsilState(m)
    saveMsil(m)
    touchPref('msil')
  }

  const setSettings = (s: Settings) => {
    setSettingsState(s)
    saveSettings(s)
    touchPref('settings')
  }

  const chooseLang = (l: Lang) => {
    setLang(l)
    touchPref('lang')
  }

  const chooseTheme = (v: ThemePreference) => {
    setThemeState(v)
    saveTheme(v)
    applyTheme(v)
    touchPref('theme')
  }

  const setLangRef = useRef(setLang)
  setLangRef.current = setLang
  const prefsAccess = useMemo(
    () => ({
      get: () => ({ values: prefValues.current, stamps: prefStamps.current }),
      apply: (values: Partial<PrefValues>, stamps: PrefStamps) => {
        prefStamps.current = stamps
        savePrefStamps(stamps)
        if (values.settings) {
          setSettingsState(values.settings)
          saveSettings(values.settings)
        }
        if (values.msil) {
          setMsilState(values.msil)
          saveMsil(values.msil)
        }
        if (values.lang) setLangRef.current(values.lang)
        if (values.theme) {
          setThemeState(values.theme)
          saveTheme(values.theme)
          applyTheme(values.theme)
        }
      },
    }),
    [],
  )

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
  const sync = useSync(auth.account, profileAccess, prefsAccess, () => void log.reload())
  requestSync.current = sync.request

  const port = profile.ports.find((p) => p.id === profile.activePortId) ?? profile.ports[0] ?? null
  // 「出港」を押してから帰港するまでが「航行モード」
  const underway = log.activeTrack !== null
  // 天気・波・潮・日の出の基準の場所: 海に出るまでは出航地、出港してからは現在地（出航地が未登録なら現在地）
  const basis = underway ? fix : (port ?? fix)
  const basisLabel = underway ? t('basis.underway') : !port ? t('basis.here') : t('basis.port', { port: port.name })
  const conditions = useConditions(basis)
  // 危険物（暗岩・洗岩など）: 航行モード中は現在地、それ以外は見ている地図の周り
  const [mapCenter, setMapCenter] = useState<LatLon | null>(null)
  const osmHazards = useOsmHazards(underway ? fix : (mapCenter ?? basis))
  const hazards = useMemo(() => [...osmHazards, ...marksToHazards(log.marks)], [osmHazards, log.marks])
  const warnings = useJmaWarnings([port, underway ? fix : null], lang)

  // 波・気象のボタンの「！」: 気象庁の注意報・警報・波高の危険・気圧の急な低下
  const data = conditions.data
  const alert =
    warnings.areas.some((a) => a.list.length > 0) ||
    (data?.marine ? waveRisk(data.marine.waves, profile.boat.dangerWave, Date.now()).level === 'warning' : false) ||
    (data?.weather ? assessTrend(data.weather.pressure, t, data.fetchedAt).level === 'warning' : false)

  // 日没・干満のボタンの「！」: 出航地の危険潮位が近い・日没が近い（日出から日没までの航行限定の船）
  const portTide = usePortTide(port)
  const now = Date.now()
  const here = basis
  const noon = new Date(now)
  noon.setHours(12, 0, 0, 0)
  const tideWarn =
    (port !== null && portTide.seaLevel.length > 0 && tideAlert(tideCrossing(portLevels(port, portTide.seaLevel), port.dangerLevel, now), now)) ||
    (here !== null && sunsetAlert(sunTimes(noon.getTime(), here.lat, here.lon).sunset, now, profile.boat.daylightOnly, log.activeTrack !== null))

  // 法定備品のチェックの進み具合（今日チェックした数 / 項目の数）
  const equipItems = checklistItems(profile.equipment, profile.boat.type, profile.boat.daylightOnly, lang).filter((i) => !profile.equipment.hidden.includes(i.id))
  const equipChecked = checkedToday(profile.equipment, now)
  const equipTotal = equipItems.length
  const equipDone = equipItems.filter((i) => equipChecked.includes(i.id)).length

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
            hazards={osmHazards}
            msil={msil}
            onMsil={setMsil}
            onMapCenter={setMapCenter}
          />
          <button className="secondary log-open" onClick={() => go('log')}>
            📒 {t('log.open', { tracks: log.tracks.length, marks: log.marks.length })}
          </button>
          <button className="secondary log-open" onClick={() => go('equip')}>
            ✅ {t('equip.open', { done: equipDone, total: equipTotal })}
          </button>
        </>
      )}

      {view === 'equip' && <EquipmentPage profile={profile} onChange={updateProfile} onBack={() => go('chart')} />}

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

      {(view === 'sea' || view === 'tide') && (
        <p className="basis" role="note">
          📍 {basisLabel}
          {!underway && port && <span className="muted small"> · {t('basis.hint')}</span>}
        </p>
      )}

      {view === 'sea' && (
        <>
          <SafetyCard
            fix={fix}
            conditions={data}
            profile={profile}
            warnings={warnings}
            hazards={hazards}
            underway={underway}
            onSelectPort={(id) => updateProfile((p) => ({ ...p, activePortId: id }))}
            onOpenSettings={() => go('settings')}
          />
          <WindCard weather={data?.weather ?? null} at={basis ?? data?.at ?? null} unit={settings.windUnit}>
            <WaveInfo marine={data?.marine ?? null} dangerWave={profile.boat.dangerWave} />
          </WindCard>
          <WeatherCard state={conditions} onRefresh={() => void conditions.refresh()} />
          <PositionCard geo={geo} />
          <p className="muted small">{t('sea.sources')}</p>
        </>
      )}

      {view === 'tide' && <TidePage at={basis ?? data?.at ?? null} conditions={data} profile={profile} underway={underway} />}

      {view === 'docs' && <DocsPage profile={profile} onChange={updateProfile} signedIn={auth.account !== null} />}

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
          msil={msil}
          onMsil={setMsil}
          onLang={chooseLang}
          theme={theme}
          onTheme={chooseTheme}
        />
      )}

      <BottomDock tab={view === 'log' || view === 'equip' ? 'chart' : view} onTab={go} recording={log.activeTrack !== null} alert={alert} tideAlert={tideWarn} docsAlert={renewals.length > 0} />
    </div>
  )
}
