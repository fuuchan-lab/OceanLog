import { useEffect, useRef, useState } from 'react'
import { driveConfig } from '../drive.ts'
import { formatPosition, parseCoord, type LatLon, type WindUnit, WIND_UNIT_LABEL } from '../geo.ts'
import type { GoogleAuth } from '../hooks/useGoogleAuth.ts'
import type { SyncState } from '../hooks/useSync.ts'
import { LOCALES, type Lang } from '../i18n/context.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { newId } from '../device.ts'
import type { HomePort, Profile } from '../profile.ts'
import { isValidTileUrl, type Settings } from '../settings.ts'
import type { ThemePreference } from '../theme.ts'
import { syncText } from './Header.tsx'
import { DriveProgress, driveSettled, SyncNowButton } from './SyncFeedback.tsx'
import { MapPicker } from './MapPicker.tsx'
import { SliderField } from './SliderField.tsx'
import { ChartEditor } from './ChartEditor.tsx'
import { chartCorners, fitChart, polygonContains, type UserChart } from '../chartGeo.ts'
import { deletePhoto } from '../db.ts'
import { MsilSettingsCard } from './MsilSettingsCard.tsx'
import type { MsilSettings } from '../msil.ts'

interface Props {
  auth: GoogleAuth
  sync: SyncState
  unsyncedCount: number
  profile: Profile
  onProfile: (update: (p: Profile) => Profile) => void
  settings: Settings
  onSettings: (s: Settings) => void
  here: LatLon | null
  msil: MsilSettings
  onMsil: (m: MsilSettings) => void
  onLang: (l: Lang) => void
  theme: ThemePreference
  onTheme: (v: ThemePreference) => void
}

function PortForm({ initial, here, onSave, onDelete, onClose }: { initial: HomePort; here: LatLon | null; onSave: (p: HomePort) => void; onDelete?: () => void; onClose: () => void }) {
  const { t } = useI18n()
  const [name, setName] = useState(initial.name)
  const [lat, setLat] = useState(initial.lat ? initial.lat.toFixed(5) : '')
  const [lon, setLon] = useState(initial.lon ? initial.lon.toFixed(5) : '')
  // どちらも cm（潮位表の基準）。スライダーで選ぶ
  const [z0, setZ0] = useState(Math.round(initial.z0 * 100))
  const [danger, setDanger] = useState(Math.round(initial.dangerLevel * 100))
  const latV = parseCoord(lat, true)
  const lonV = parseCoord(lon, false)
  const valid = name.trim() !== '' && latV !== null && lonV !== null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="port-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (!valid) return
          onSave({ ...initial, name: name.trim(), lat: latV, lon: lonV, z0: z0 / 100, dangerLevel: danger / 100 })
        }}
      >
        <div className="row">
          <h2 id="port-title">{t('port.edit')}</h2>
          <button type="button" className="link" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <label>
          {t('port.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('port.namePlaceholder')} required />
        </label>
        <p className="field-title">{t('port.position')}</p>
        <MapPicker
          value={initial.lat || initial.lon ? { lat: initial.lat, lon: initial.lon } : null}
          here={here}
          onChange={(at) => {
            setLat(at.lat.toFixed(6))
            setLon(at.lon.toFixed(6))
          }}
        />
        <details className="details">
          <summary>{t('port.latlonDetails')}</summary>
          <div className="grid2">
            <label>
              {t('port.lat')}
              <input value={lat} onChange={(e) => setLat(e.target.value)} inputMode="decimal" placeholder="35.12345" />
            </label>
            <label>
              {t('port.lon')}
              <input value={lon} onChange={(e) => setLon(e.target.value)} inputMode="decimal" placeholder="139.12345" />
            </label>
          </div>
          {latV !== null && lonV !== null && <p className="muted small">{formatPosition({ lat: latV, lon: lonV })}</p>}
        </details>
        <SliderField
          label={t('port.danger')}
          value={danger}
          onChange={setDanger}
          min={-300}
          max={300}
          step={5}
          unit="cm"
          note={z0 > 0 ? t('port.dangerVsMsl', { v: danger - z0 }) : undefined}
          hint={t('port.dangerHint')}
        />
        <SliderField label={t('port.z0')} value={z0} onChange={setZ0} min={0} max={300} step={5} unit="cm" hint={t('port.z0Hint')} />
        <button type="submit" className="primary" disabled={!valid}>
          {t('common.save')}
        </button>
        {onDelete && (
          <button type="button" className="danger-btn" onClick={onDelete}>
            {t('common.delete')}
          </button>
        )}
      </form>
    </div>
  )
}

/** 設定: アカウント・出航地・単位・地図・言語・配色・データの出典 */
export function SettingsPage({ auth, sync, unsyncedCount, profile, onProfile: onProfileRaw, settings, onSettings: onSettingsRaw, here, msil, onMsil, onLang: onLangRaw, theme, onTheme: onThemeRaw }: Props) {
  // 設定は変えるとすぐ保存する。保存したことが分かるよう、画面の下に「保存しました」を少しの間出す
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flash = () => {
    setSavedAt(Date.now())
    navigator.vibrate?.(20)
    clearTimeout(flashTimer.current)
  }
  // ドライブへの送信が終わってから、少しして消す
  const settled = savedAt !== null && driveSettled(sync, auth.account !== null, savedAt)
  useEffect(() => {
    if (!settled) return
    flashTimer.current = setTimeout(() => setSavedAt(null), 4000)
    return () => clearTimeout(flashTimer.current)
  }, [settled])
  const onProfile = (update: (p: Profile) => Profile) => {
    onProfileRaw(update)
    flash()
  }
  const onSettings = (s: Settings) => {
    onSettingsRaw(s)
    flash()
  }
  const onLang = (l: Lang) => {
    onLangRaw(l)
    flash()
  }
  const onTheme = (v: ThemePreference) => {
    onThemeRaw(v)
    flash()
  }
  const { t, lang } = useI18n()
  const [editing, setEditing] = useState<{ port: HomePort; isNew: boolean } | null>(null)
  // 自分の海図の登録・位置合わせ（新しく登録する時は 'new'）
  const [chartEditing, setChartEditing] = useState<{ chart: UserChart | null; port: HomePort | null } | null>(null)
  // 出航地ごとの海図: その出航地から追加した海図と、出航地を含む範囲の海図
  const placed = profile.charts.map((c) => {
    const fit = fitChart(c.points)
    return { chart: c, fit, corners: fit ? chartCorners(c, fit) : null }
  })
  const chartsFor = (port: HomePort) => placed.filter((x) => x.chart.portId === port.id || (x.chart.portId === null && x.corners !== null && polygonContains(x.corners, port)))
  const otherCharts = placed.filter((x) => !profile.ports.some((p) => chartsFor(p).includes(x)))
  const chartRow = (x: (typeof placed)[number], port: HomePort | null) => (
    <li key={x.chart.id} className="chart-row">
      <span>
        🗺️ <b>{x.chart.name || t('uchart.title')}</b>
        <br />
        <span className="small muted">
          {t('uchart.points', { n: x.chart.points.length })} ·{' '}
          {x.fit ? t('uchart.accuracy', { m: Math.max(1, Math.round(x.fit.expected ?? x.fit.rms)) }) : t('uchart.notFitted')}
        </span>
      </span>
      <button className="link" onClick={() => setChartEditing({ chart: x.chart, port })}>
        {t('common.edit')}
      </button>
    </li>
  )
  const [tileUrl, setTileUrl] = useState(settings.customTileUrl)
  const [tileAttr, setTileAttr] = useState(settings.customTileAttribution)
  // 別の端末の設定をドライブから読み込んだ時は、入力欄も合わせる
  const [tileFrom, setTileFrom] = useState(settings)
  if (tileFrom.customTileUrl !== settings.customTileUrl || tileFrom.customTileAttribution !== settings.customTileAttribution) {
    setTileFrom(settings)
    setTileUrl(settings.customTileUrl)
    setTileAttr(settings.customTileAttribution)
  }
  const tileDirty = tileUrl.trim() !== settings.customTileUrl || tileAttr.trim() !== settings.customTileAttribution

  const savePort = (port: HomePort, isNew: boolean) => {
    onProfile((p) => ({
      ...p,
      ports: isNew ? [...p.ports, port] : p.ports.map((x) => (x.id === port.id ? port : x)),
      activePortId: p.activePortId ?? port.id,
    }))
    setEditing(null)
  }

  return (
    <>
      <a className="card help-card" href={`./help.html?lang=${lang}`} target="_blank" rel="noopener">
        <span className="help-mark" aria-hidden="true">
          ?
        </span>
        <span>
          <strong>{t('help.title')}</strong>
          <br />
          <span className="muted small">{t('help.subtitle')}</span>
        </span>
      </a>

      <section className="card">
        <h2>{t('account.title')}</h2>
        {auth.account ? (
          <>
            <p>{auth.account.email ?? auth.account.name ?? t('account.fallback')}</p>
            <p className="muted small">{t('account.storage', { folder: driveConfig.folderName })}</p>
            <p className="muted small">{t('account.prefsShared')}</p>
            <p className="muted small" role="status">
              {syncText(sync, unsyncedCount, t, LOCALES[lang])}
            </p>
            <div className="row gap">
              <SyncNowButton sync={sync} />
              <button className="secondary" onClick={() => void auth.switchAccount()}>
                {t('account.switch')}
              </button>
              <button className="link danger" onClick={auth.signOut}>
                {t('account.signOut')}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted small">{t('account.loginLead', { folder: driveConfig.folderName })}</p>
            <button className="primary" disabled={auth.connecting} onClick={() => void auth.login()}>
              {auth.connecting ? t('google.connecting') : t('account.login')}
            </button>
            {/* ログインで「origin_mismatch」が出た時に、Google Cloud に登録するアドレスが分かるように */}
            <details className="details small">
              <summary>{t('account.originTitle')}</summary>
              <p>{t('account.originHelp')}</p>
              <p>
                <code>{location.origin}</code>
              </p>
            </details>
          </>
        )}
      </section>

      <section className="card">
        <h2>{t('port.title')}</h2>
        <p className="muted small">{t('port.lead')}</p>
        <ul className="log-list">
          {profile.ports.map((p) => (
            <li key={p.id}>
              <label className="check">
                <input
                  type="radio"
                  name="active-port"
                  checked={profile.activePortId === p.id}
                  onChange={() => onProfile((pr) => ({ ...pr, activePortId: p.id }))}
                  aria-label={t('port.setActive', { name: p.name })}
                />
                <span>
                  🏠 <b>{p.name}</b>
                  <br />
                  <span className="small muted">
                    {formatPosition(p)} · {t('port.summary', { v: Math.round(p.dangerLevel * 100), z0: Math.round(p.z0 * 100) })}
                  </span>
                </span>
              </label>
              <button className="link" onClick={() => setEditing({ port: p, isNew: false })}>
                {t('common.edit')}
              </button>
              {/* この出航地のまわりの海図（写真・スキャン） */}
              <div className="port-charts">
                {chartsFor(p).length > 0 && <ul className="log-list">{chartsFor(p).map((x) => chartRow(x, p))}</ul>}
                <button className="link" onClick={() => setChartEditing({ chart: null, port: p })}>
                  ＋ {t('uchart.addForPort', { name: p.name })}
                </button>
              </div>
            </li>
          ))}
        </ul>
        <p className="muted small">{t('uchart.lead')}</p>
        <button
          className="secondary"
          onClick={() =>
            setEditing({
              port: { id: newId(), name: '', lat: 0, lon: 0, z0: 0, dangerLevel: 0.5 },
              isNew: true,
            })
          }
        >
          ＋ {t('port.add')}
        </button>
      </section>

      <section className="card">
        <h2>{t('settings.units')}</h2>
        <div className="seg">
          {(['ms', 'kn', 'kmh'] as WindUnit[]).map((u) => (
            <button key={u} className={settings.windUnit === u ? 'on' : ''} onClick={() => onSettings({ ...settings, windUnit: u })}>
              {WIND_UNIT_LABEL[u]}
            </button>
          ))}
        </div>
        <p className="muted small">{t('settings.unitsHint')}</p>
      </section>

      {/* 出航地に結びつかない海図（出航地から離れた場所の海図など） */}
      <section className="card">
        <h2>🗺️ {t('uchart.title')}</h2>
        {otherCharts.length > 0 ? <ul className="log-list">{otherCharts.map((x) => chartRow(x, null))}</ul> : <p className="muted small">{t('uchart.otherLead')}</p>}
        <button className="secondary" onClick={() => setChartEditing({ chart: null, port: null })}>
          ＋ {t('uchart.add')}
        </button>
      </section>

      <MsilSettingsCard msil={msil} onChange={onMsil} signedIn={auth.account !== null} sync={sync} />

      <section className="card">
        <h2>{t('settings.customTiles')}</h2>
        <p className="muted small">{t('settings.customTilesLead')}</p>
        <label>
          URL
          <input value={tileUrl} onChange={(e) => setTileUrl(e.target.value)} placeholder="https://example.com/{z}/{x}/{y}.png" />
        </label>
        <label>
          {t('settings.customTilesAttr')}
          <input value={tileAttr} onChange={(e) => setTileAttr(e.target.value)} />
        </label>
        {tileUrl && !isValidTileUrl(tileUrl) && <p className="error small">{t('settings.customTilesInvalid')}</p>}
        <button
          className={tileDirty ? 'primary' : 'secondary'}
          disabled={!tileDirty || (tileUrl !== '' && !isValidTileUrl(tileUrl))}
          onClick={() => onSettings({ ...settings, customTileUrl: tileUrl.trim(), customTileAttribution: tileAttr.trim() })}
        >
          {tileDirty ? t('common.save') : `✓ ${t('msil.savedButton')}`}
        </button>
      </section>

      <section className="card">
        <h2>{t('settings.language')}</h2>
        <div className="seg">
          {(['ja', 'en'] as Lang[]).map((l) => (
            <button key={l} className={lang === l ? 'on' : ''} onClick={() => onLang(l)}>
              {l === 'ja' ? '日本語' : 'English'}
            </button>
          ))}
        </div>
        <h2>{t('settings.theme')}</h2>
        <div className="seg">
          {(['auto', 'light', 'dark'] as ThemePreference[]).map((v) => (
            <button
              key={v}
              className={theme === v ? 'on' : ''}
              onClick={() => onTheme(v)}
            >
              {t(`theme.${v}`)}
            </button>
          ))}
        </div>
        <p className="muted small">{t('settings.themeHint')}</p>
      </section>

      <section className="card">
        <h2>{t('about.title')}</h2>
        <p className="small">{t('about.disclaimer')}</p>
        <p className="small">
          <a href={`./help.html?lang=${lang}#${lang}-disclaimer`} target="_blank" rel="noopener">
            {t('help.disclaimerLink')}
          </a>
        </p>
        <h3>{t('about.sources')}</h3>
        <ul className="sources small">
          <li>
            <a href="https://open-meteo.com/" target="_blank" rel="noopener">
              Open-Meteo
            </a>{' '}
            — {t('about.openMeteo')}
          </li>
          <li>
            <a href="https://www.jma.go.jp/jma/kishou/info/coment.html" target="_blank" rel="noopener">
              {t('about.jmaName')}
            </a>{' '}
            — {t('about.jma')}
          </li>
          <li>
            <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">
              {t('about.gsiName')}
            </a>{' '}
            — {t('about.gsi')}
          </li>
          <li>
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">
              OpenStreetMap
            </a>{' '}
            — {t('about.osm')}
          </li>
          <li>
            <a href="https://www.openseamap.org/" target="_blank" rel="noopener">
              OpenSeaMap
            </a>{' '}
            — {t('about.openseamap')}
          </li>
          <li>
            <a href="https://www.gebco.net/" target="_blank" rel="noopener">
              GEBCO
            </a>{' '}
            — {t('about.gebco')}
          </li>
          <li>
            <a href="https://www.windy.com/" target="_blank" rel="noopener">
              Windy.com
            </a>{' '}
            — {t('about.windy')}
          </li>
        </ul>
        <p className="muted small">{t('about.local')}</p>
      </section>

      {chartEditing && (
        <ChartEditor
          initial={chartEditing.chart}
          here={here}
          port={chartEditing.port}
          onClose={() => setChartEditing(null)}
          onSave={(c) => {
            onProfile((p) => ({ ...p, charts: p.charts.some((x) => x.id === c.id) ? p.charts.map((x) => (x.id === c.id ? c : x)) : [...p.charts, c] }))
            // 海図を登録したら、地図に重ねる設定にしておく
            if (!settings.myCharts) onSettings({ ...settings, myCharts: true })
            setChartEditing(null)
          }}
          onDelete={
            chartEditing.chart === null
              ? undefined
              : () => {
                  const target = chartEditing.chart!
                  if (!confirm(t('uchart.deleteConfirm', { name: target.name }))) return
                  onProfile((p) => ({ ...p, charts: p.charts.filter((x) => x.id !== target.id) }))
                  void deletePhoto(target.id)
                  setChartEditing(null)
                }
          }
        />
      )}

      {editing && (
        <PortForm
          initial={editing.port}
          here={here}
          onClose={() => setEditing(null)}
          onSave={(p) => savePort(p, editing.isNew)}
          onDelete={
            editing.isNew
              ? undefined
              : () => {
                  if (!confirm(t('port.deleteConfirm', { name: editing.port.name }))) return
                  onProfile((p) => {
                    const ports = p.ports.filter((x) => x.id !== editing.port.id)
                    return { ...p, ports, activePortId: p.activePortId === editing.port.id ? (ports[0]?.id ?? null) : p.activePortId }
                  })
                  setEditing(null)
                }
          }
        />
      )}
      {/* 保存の状態（画面の下に固定） */}
      {/* 出航地の編集中は、編集画面の「保存」を使うので隠す */}
      {!editing && !chartEditing && (
        <div className={`save-bar${savedAt ? ' save-bar-done' : ''}`} role="status" aria-live="polite">
          <span className="small">
            {savedAt ? (
              <>
                ✅ {t('settings.saved')} <DriveProgress sync={sync} signedIn={auth.account !== null} savedAt={savedAt} />
              </>
            ) : (
              `✓ ${t('settings.autoSave')}`
            )}
          </span>
        </div>
      )}
    </>
  )
}
