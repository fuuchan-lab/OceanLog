import { useEffect, useState } from 'react'
import { fmtDuration, fmtNum } from '../format.ts'
import { distance, formatDM, msToKnots, NM, type LatLon } from '../geo.ts'
import type { GeoState } from '../hooks/useGeolocation.ts'
import type { LogState } from '../hooks/useLog.ts'
import { LOCALES } from '../i18n/context.ts'
import { useI18n } from '../i18n/useI18n.ts'
import type { Profile } from '../profile.ts'
import type { BaseLayer, Settings } from '../settings.ts'
import type { Mark, TrackPoint } from '../types.ts'
import { MapView } from './MapView.tsx'
import { CompassRose } from './CompassRose.tsx'
import { useCompass } from '../hooks/useCompass.ts'
import { MarkForm, type MarkDraft } from './MarkForm.tsx'
import { OfflineCharts } from './OfflineCharts.tsx'
import type { Hazard } from '../hazards.ts'
import type { MsilSettings } from '../msil.ts'

interface Props {
  geo: GeoState & { stale: boolean }
  log: LogState
  profile: Profile
  settings: Settings
  onSettings: (s: Settings) => void
  onSelectPort: (id: string) => void
  shownTrack: TrackPoint[] | null
  onClearShown: () => void
  focus: (LatLon & { zoom?: number; key: number }) | null
  hazards: Hazard[]
  msil: MsilSettings
  onMsil: (m: MsilSettings) => void
  /** 地図の中心が変わった時（危険物の取得の範囲に使う） */
  onMapCenter: (c: LatLon) => void
}

/** 画面を消さないようにする（航跡の記録中）。対応していない端末では何もしない */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    const request = async () => {
      try {
        lock = await navigator.wakeLock.request('screen')
      } catch {
        // 省電力モードなどで断られても、記録は続ける
      }
    }
    void request()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release()
    }
  }, [active])
}

const LAYERS: BaseLayer[] = ['gsi-pale', 'gsi-photo', 'osm', 'gebco']

/** 海図の画面。現在地・航跡の記録（出港・帰港）・地点の登録・オフライン用の保存 */
export function ChartPage({ geo, log, profile, settings, onSettings, onSelectPort, shownTrack, onClearShown, focus, hazards, msil, onMsil, onMapCenter }: Props) {
  const [msilError, setMsilError] = useState<number | null>(null)
  const { t, lang } = useI18n()
  const { fix } = geo
  const [follow, setFollow] = useState(true)
  const [center, setCenter] = useState<LatLon | null>(null)
  const [markForm, setMarkForm] = useState<{ draft: MarkDraft; edit?: Mark } | null>(null)
  const [departOpen, setDepartOpen] = useState(false)
  const [layersOpen, setLayersOpen] = useState(false)
  const [offlineOpen, setOfflineOpen] = useState(false)
  const [focusNow, setFocusNow] = useState(focus)
  useEffect(() => setFocusNow(focus), [focus])
  const active = log.activeTrack
  const compass = useCompass()
  useWakeLock(active !== null)

  const nearestPort = fix
    ? [...profile.ports].sort((a, b) => distance(fix, a) - distance(fix, b))[0]
    : profile.ports.find((p) => p.id === profile.activePortId)

  const openNewMark = () => {
    const at = fix ?? center
    if (!at) return
    const positions = [
      ...(fix ? [{ label: t('mark.here'), at: { lat: fix.lat, lon: fix.lon } }] : []),
      ...(center ? [{ label: t('mark.mapCenter'), at: center }] : []),
    ]
    setMarkForm({ draft: { name: '', note: '', kind: 'point', lat: at.lat, lon: at.lon }, edit: undefined })
    setPositions(positions)
  }
  const [positions, setPositions] = useState<{ label: string; at: LatLon }[]>([])

  const elapsed = active ? Date.now() - active.startedAt : 0

  return (
    <div className="chart-page">
      <div className="map-wrap">
        <MapView
          settings={settings}
          fix={fix}
          follow={follow}
          onUserMove={() => setFollow(false)}
          livePoints={log.livePoints}
          shownTrack={shownTrack}
          marks={log.marks}
          ports={profile.ports}
          focus={focusNow}
          onMarkClick={(m) => setMarkForm({ draft: { ...m }, edit: m })}
          onCenter={(c) => {
            setCenter(c)
            onMapCenter(c)
          }}
          hazards={hazards}
          msil={msil}
          onMsilError={setMsilError}
        />
        {/* 地図の上に、位置・速力・針路 */}
        <div className="hud">
          {fix ? (
            <>
              <span className="hud-pos">
                {formatDM(fix.lat, true)} {formatDM(fix.lon, false)}
              </span>
              <span>
                <b>{fix.speed === null ? '—' : fmtNum(msToKnots(fix.speed))}</b> kn ·{' '}
                <b>{fix.course === null ? '—' : String(Math.round(fix.course)).padStart(3, '0')}</b>° {t('compass.cogShort')}
                {compass.heading !== null && (
                  <>
                    {' · 🧭 '}
                    <b>{String(Math.round(compass.heading) % 360).padStart(3, '0')}</b>°
                  </>
                )}
              </span>
            </>
          ) : (
            <span>{geo.errorCode ? t(geo.errorCode === 1 ? 'pos.denied' : 'pos.unavailable') : t('pos.waiting')}</span>
          )}
        </div>
        <CompassRose compass={compass} course={fix?.course ?? null} />
        <div className="map-buttons">
          <button className={`fab${follow ? ' on' : ''}`} onClick={() => setFollow(true)} aria-label={t('chart.follow')} title={t('chart.follow')}>
            ⌖
          </button>
          <button className="fab" onClick={() => setLayersOpen((o) => !o)} aria-label={t('chart.layers')} title={t('chart.layers')}>
            🗺️
          </button>
          <button className="fab" onClick={() => setOfflineOpen(true)} aria-label={t('offline.title')} title={t('offline.title')}>
            ⬇️
          </button>
        </div>
        {layersOpen && (
          <div className="layers-panel">
            {LAYERS.map((l) => (
              <label key={l} className="check">
                <input type="radio" name="base" checked={settings.baseLayer === l} onChange={() => onSettings({ ...settings, baseLayer: l })} />
                {t(`layer.${l}`)}
              </label>
            ))}
            <label className="check">
              <input type="checkbox" checked={settings.seamarks} onChange={(e) => onSettings({ ...settings, seamarks: e.target.checked })} />
              {t('layer.seamarks')}
            </label>
            <p className="small legend-line">
              <b>✚</b> {t('hazard.submerged')} · <b>✳</b> {t('hazard.awash')} · <b>✱</b> {t('hazard.covers')}
            </p>
            <p className="muted small">{t('layer.hazardsNote')}</p>
            {msil.key && msil.layers.length > 0 && (
              <>
                <p className="small legend-line">
                  <b>{t('msil.title')}</b>
                </p>
                {msil.layers.map((l) => (
                  <label key={l.id} className="check">
                    <input
                      type="checkbox"
                      checked={msil.enabled.includes(l.id)}
                      onChange={(e) =>
                        onMsil({ ...msil, enabled: e.target.checked ? [...msil.enabled, l.id] : msil.enabled.filter((x) => x !== l.id) })
                      }
                    />
                    {l.name}
                  </label>
                ))}
              </>
            )}
          </div>
        )}
        {msil.enabled.length > 0 && msil.key && (
          <p className="msil-notice">
            {t('msil.notice')}
            {msilError !== null && <span className="error"> {t('msil.error', { status: msilError })}</span>}
          </p>
        )}
        {shownTrack && (
          <button className="shown-chip" onClick={onClearShown}>
            {t('chart.hideTrack')} ✕
          </button>
        )}
      </div>

      <div className="chart-actions">
        {active ? (
          <>
            <div className="rec-status" role="status">
              <span className="rec-dot-inline" /> {t('track.recording')}
              <span className="muted small">
                {' '}
                {fmtDuration(elapsed, t)} · {(active.distance / NM).toFixed(2)} NM
              </span>
            </div>
            <button
              className="danger-btn"
              onClick={() => {
                if (confirm(t('track.stopConfirm'))) void log.stopTrack(false)
              }}
            >
              ⚓ {t('track.stop')}
            </button>
          </>
        ) : (
          <button className="primary" onClick={() => setDepartOpen(true)} disabled={!fix}>
            ⛵ {t('track.start')}
          </button>
        )}
        <button className="secondary" onClick={openNewMark} disabled={!fix && !center}>
          📍 {t('mark.add')}
        </button>
      </div>
      {!active && <p className="muted small">{t('track.hint')}</p>}

      {departOpen && (
        <DepartDialog
          profile={profile}
          defaultPortId={nearestPort?.id ?? null}
          onCancel={() => setDepartOpen(false)}
          onStart={(portId, name) => {
            if (portId) onSelectPort(portId)
            setDepartOpen(false)
            setFollow(true)
            void log.startTrack(name, fix)
          }}
          locale={LOCALES[lang]}
        />
      )}

      {markForm && (
        <MarkForm
          title={markForm.edit ? t('mark.edit') : t('mark.add')}
          initial={markForm.draft}
          positions={markForm.edit ? undefined : positions}
          onClose={() => setMarkForm(null)}
          onSave={(d) => {
            if (markForm.edit) void log.updateMark({ ...markForm.edit, ...d })
            else void log.addMark(d)
            setMarkForm(null)
          }}
          onDelete={
            markForm.edit
              ? () => {
                  if (markForm.edit && confirm(t('mark.deleteConfirm'))) {
                    void log.deleteMark(markForm.edit)
                    setMarkForm(null)
                  }
                }
              : undefined
          }
        />
      )}

      {offlineOpen && <OfflineCharts settings={settings} center={center} ports={profile.ports} onClose={() => setOfflineOpen(false)} />}
    </div>
  )
}

function DepartDialog({
  profile,
  defaultPortId,
  onCancel,
  onStart,
  locale,
}: {
  profile: Profile
  defaultPortId: string | null
  onCancel: () => void
  onStart: (portId: string | null, name: string) => void
  locale: string
}) {
  const { t } = useI18n()
  const [portId, setPortId] = useState(defaultPortId ?? '')
  const port = profile.ports.find((p) => p.id === portId)
  const date = new Date().toLocaleString(locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const [name, setName] = useState('')
  const fallback = port ? t('track.nameFrom', { port: port.name, date }) : t('track.nameDefault', { date })

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="depart-title"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          onStart(portId || null, name.trim() || fallback)
        }}
      >
        <h2 id="depart-title">{t('track.start')}</h2>
        {profile.ports.length > 0 ? (
          <label>
            {t('track.departPort')}
            <select value={portId} onChange={(e) => setPortId(e.target.value)}>
              {profile.ports.map((p) => (
                <option key={p.id} value={p.id}>
                  🏠 {p.name}
                </option>
              ))}
              <option value="">{t('track.noPort')}</option>
            </select>
          </label>
        ) : (
          <p className="muted small">{t('track.noPortsHint')}</p>
        )}
        <label>
          {t('track.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={fallback} />
        </label>
        <p className="muted small">{t('track.startHint')}</p>
        <button type="submit" className="primary">
          ⛵ {t('track.startNow')}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </form>
    </div>
  )
}
