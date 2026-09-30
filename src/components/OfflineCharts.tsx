import { useEffect, useRef, useState } from 'react'
import type { LatLon } from '../geo.ts'
import { useI18n } from '../i18n/useI18n.ts'
import type { HomePort } from '../profile.ts'
import type { Settings } from '../settings.ts'
import {
  BASE_LAYERS,
  cachedTileCount,
  clearTiles,
  downloadTiles,
  MAX_TILES,
  OFFLINE_MAX_ZOOM,
  SEAMARKS,
  tilesAround,
  tileUrl,
  type DownloadProgress,
} from '../tiles.ts'

const RADII = [10, 20, 30]
/** 1枚あたりのおおよその大きさ (KB)。容量の目安に使う */
const KB_PER_TILE = { 'gsi-pale': 15, 'gsi-photo': 35, seamarks: 3 }

interface Props {
  settings: Settings
  center: LatLon | null
  ports: HomePort[]
  onClose: () => void
}

/**
 * 出港前に、近辺の海図（地図と海図記号）をダウンロードしておく。沖で電波がなくても、保存した範囲は表示できる
 */
export function OfflineCharts({ settings, center, ports, onClose }: Props) {
  const { t } = useI18n()
  const [where, setWhere] = useState<string>(ports[0]?.id ?? 'center')
  const [radius, setRadius] = useState(20)
  const [photo, setPhoto] = useState(settings.baseLayer === 'gsi-photo')
  const [progress, setProgress] = useState<DownloadProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [saved, setSaved] = useState<number | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    void cachedTileCount().then(setSaved)
    return () => abort.current?.abort()
  }, [])

  const port = ports.find((p) => p.id === where)
  const target = port ?? center
  const tiles = target ? tilesAround(target, radius, 8, OFFLINE_MAX_ZOOM) : []
  const base = photo ? BASE_LAYERS['gsi-photo'] : BASE_LAYERS['gsi-pale']
  const urls = [...tiles.map((x) => tileUrl(base.url, x)), ...(settings.seamarks ? tiles.map((x) => tileUrl(SEAMARKS.url, x)) : [])]
  const mb = ((tiles.length * (photo ? KB_PER_TILE['gsi-photo'] : KB_PER_TILE['gsi-pale']) + (settings.seamarks ? tiles.length * KB_PER_TILE.seamarks : 0)) / 1024).toFixed(0)
  const tooMany = urls.length > MAX_TILES
  const supported = typeof caches !== 'undefined' && 'serviceWorker' in navigator

  const start = async () => {
    const ctrl = new AbortController()
    abort.current = ctrl
    setRunning(true)
    setProgress({ done: 0, total: urls.length, failed: 0 })
    try {
      await downloadTiles(urls, setProgress, ctrl.signal)
    } finally {
      setRunning(false)
      setSaved(await cachedTileCount())
    }
  }

  return (
    <div className="modal-backdrop" onClick={running ? undefined : onClose}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="offline-title" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 id="offline-title">{t('offline.title')}</h2>
          <button className="link" onClick={onClose} disabled={running} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <p className="muted small">{t('offline.lead')}</p>
        {!supported && <p className="error small">{t('offline.unsupported')}</p>}
        <label>
          {t('offline.where')}
          <select value={where} onChange={(e) => setWhere(e.target.value)} disabled={running}>
            {ports.map((p) => (
              <option key={p.id} value={p.id}>
                🏠 {p.name}
              </option>
            ))}
            <option value="center">{t('offline.mapCenter')}</option>
          </select>
        </label>
        <div className="seg">
          {RADII.map((r) => (
            <button key={r} className={radius === r ? 'on' : ''} onClick={() => setRadius(r)} disabled={running}>
              {t('offline.radius', { km: r })}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={photo} onChange={(e) => setPhoto(e.target.checked)} disabled={running} />
          {t('offline.photo')}
        </label>
        <p className="small">
          {t('offline.estimate', { n: urls.length, mb })}
          {settings.seamarks ? ` · ${t('offline.withSeamarks')}` : ''}
        </p>
        {tooMany && <p className="error small">{t('offline.tooMany', { max: MAX_TILES })}</p>}
        {progress && (
          <>
            <progress max={progress.total} value={progress.done} />
            <p className="small" role="status">
              {running
                ? t('offline.progress', { done: progress.done, total: progress.total })
                : t('offline.done', { n: progress.done - progress.failed, failed: progress.failed })}
            </p>
          </>
        )}
        {running ? (
          <button className="secondary" onClick={() => abort.current?.abort()}>
            {t('offline.stop')}
          </button>
        ) : (
          <button className="primary" disabled={!supported || !target || tooMany || urls.length === 0} onClick={() => void start()}>
            ⬇️ {t('offline.start')}
          </button>
        )}
        {saved !== null && (
          <div className="row">
            <span className="muted small">{t('offline.saved', { n: saved })}</span>
            {saved > 0 && !running && (
              <button
                className="link danger"
                onClick={() => {
                  if (!confirm(t('offline.clearConfirm'))) return
                  void clearTiles().then(() => setSaved(0))
                }}
              >
                {t('offline.clear')}
              </button>
            )}
          </div>
        )}
        <p className="muted small">{t('offline.osmNote')}</p>
      </div>
    </div>
  )
}
