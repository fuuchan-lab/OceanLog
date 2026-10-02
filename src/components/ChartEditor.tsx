import { useMemo, useRef, useState } from 'react'
import { CURVED_MIN_POINTS, fitChart, MIN_POINTS, pointsCoverage, RECOMMENDED_POINTS, type ControlPoint, type UserChart } from '../chartGeo.ts'
import { deletePhoto, putPhoto } from '../db.ts'
import { newId } from '../device.ts'
import { formatPosition, parseCoord, type LatLon } from '../geo.ts'
import { usePhotoUrl } from '../hooks/usePhotoUrl.ts'
import { useI18n } from '../i18n/useI18n.ts'
import { MapPicker } from './MapPicker.tsx'
import { PanZoomImage, type PanZoomHandle } from './PanZoomImage.tsx'
import { PhotoCapture } from './PhotoCapture.tsx'

interface Props {
  /** 編集する海図。新しく登録する時は null */
  initial: UserChart | null
  here: LatLon | null
  /** 出航地のまわりの海図として追加する時の出航地（地図で選ぶ時は、その近くから） */
  port?: { id: string; lat: number; lon: number } | null
  onSave: (chart: UserChart) => void
  onDelete?: () => void
  onClose: () => void
}

/** 海図の写真は細かい所まで読めるよう、大きめに保存する */
const CHART_MAX_SIDE = 3200
/** 基準点のずれが、これより大きければ入力を確かめてもらう (m) */
const WARN_ERROR_M = 100

/**
 * 自分の海図を登録する: 写真を撮る（四隅を合わせて補正）→ 名前 → 基準点を3〜4か所以上。
 * 基準点は、画面の中央の ＋ を海図の目印（経緯線の交点・灯台・岬など）に合わせ、その緯度経度を入力するか、地図で同じ場所を選ぶ
 */
export function ChartEditor({ initial, here, port, onSave, onDelete, onClose }: Props) {
  const portId = port?.id ?? initial?.portId ?? null
  const { t } = useI18n()
  const [chart, setChart] = useState<UserChart | null>(initial)
  const [name, setName] = useState(initial?.name ?? '')
  const [adding, setAdding] = useState<{ px: number; py: number } | null>(null)
  const [latText, setLatText] = useState('')
  const [lonText, setLonText] = useState('')
  const [useMap, setUseMap] = useState(false)
  const [mapAt, setMapAt] = useState<LatLon | null>(null)
  const [busy, setBusy] = useState(false)
  const pz = useRef<PanZoomHandle>(null)
  const url = usePhotoUrl(chart?.id ?? null)
  const tr = useMemo(() => (chart ? fitChart(chart.points) : null), [chart])
  // 新しく撮った写真（保存せずに閉じたら消す）
  const fresh = useRef<string | null>(null)

  const onPhoto = async (blob: Blob) => {
    setBusy(true)
    try {
      const id = newId()
      await putPhoto(id, blob)
      const bmp = await createImageBitmap(blob)
      if (fresh.current) await deletePhoto(fresh.current)
      fresh.current = id
      setChart({ id, name, width: bmp.width, height: bmp.height, points: [], portId: portId ?? null, createdAt: Date.now() })
      bmp.close()
    } finally {
      setBusy(false)
    }
  }

  const close = () => {
    if (fresh.current) void deletePhoto(fresh.current)
    onClose()
  }

  const startAdd = () => {
    const c = pz.current?.center()
    if (!c || !chart) return
    setAdding({ px: c.x, py: c.y })
    // 位置合わせが済んでいれば、その場所の緯度経度を初めの値にする（地図で選ぶ時も、その近くから）
    const guess = tr ? tr.toLatLon(c.x, c.y) : null
    setLatText('')
    setLonText('')
    setMapAt(guess ?? (port ? { lat: port.lat, lon: port.lon } : here))
    setUseMap(false)
  }

  const latV = parseCoord(latText, true)
  const lonV = parseCoord(lonText, false)
  const pointAt: LatLon | null = useMap ? mapAt : latV !== null && lonV !== null ? { lat: latV, lon: lonV } : null

  const addPoint = () => {
    if (!chart || !adding || !pointAt) return
    const p: ControlPoint = { id: newId(), px: adding.px, py: adding.py, lat: pointAt.lat, lon: pointAt.lon }
    setChart({ ...chart, points: [...chart.points, p] })
    setAdding(null)
  }

  const errors = tr?.errors ?? []
  const worst = errors.length ? errors.indexOf(Math.max(...errors)) : -1
  const canSave = chart !== null && name.trim() !== '' && tr !== null

  return (
    <div className="modal-backdrop">
      <div className="modal-card modal-full" role="dialog" aria-modal="true" aria-labelledby="chart-editor-title">
        <div className="row">
          <h2 id="chart-editor-title">{initial ? t('uchart.edit') : t('uchart.add')}</h2>
          <button className="link" onClick={close} aria-label={t('common.close')}>
            ✕
          </button>
        </div>
        <label>
          {t('uchart.name')}
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('uchart.namePlaceholder')} />
        </label>

        {!chart ? (
          <>
            <p className="muted small">{t('uchart.photoLead')}</p>
            {busy ? <p className="muted">{t('common.loading')}</p> : <PhotoCapture document maxSide={CHART_MAX_SIDE} label={t('uchart.takePhoto')} onPhoto={(b) => void onPhoto(b)} />}
          </>
        ) : (
          <>
            <ol className="steps small">
              <li>{t('uchart.step1')}</li>
              <li>{t('uchart.step2')}</li>
              <li>{t('uchart.step3', { n: MIN_POINTS, r: RECOMMENDED_POINTS })}</li>
            </ol>
            {url && (
              <div className="chart-edit-view">
                <PanZoomImage
                  handle={pz}
                  src={url}
                  width={chart.width}
                  height={chart.height}
                  overlay={(scale) => {
                    const k = 1 / scale
                    return chart.points.map((p, i) => (
                      <g key={p.id} transform={`translate(${p.px} ${p.py}) scale(${k})`}>
                        <circle r={11} className={`uchart-cp${i === worst && errors[i] > WARN_ERROR_M ? ' uchart-cp-bad' : ''}`} />
                        <text textAnchor="middle" dominantBaseline="central" className="uchart-cp-num">
                          {i + 1}
                        </text>
                      </g>
                    ))
                  }}
                >
                  {/* 画面の中央の照準。ここが基準点の位置になる */}
                  <div className="picker-cross" aria-hidden="true">
                    <svg viewBox="0 0 40 40">
                      <path d="M20 2v14M20 24v14M2 20h14M24 20h14" />
                      <circle cx="20" cy="20" r="4" />
                    </svg>
                  </div>
                </PanZoomImage>
              </div>
            )}
            {!adding && (
              <button type="button" className="primary" onClick={startAdd}>
                ＋ {t('uchart.addPoint')}
              </button>
            )}
            {adding && (
              <div className="cp-form">
                <p className="small">
                  <b>{t('uchart.pointTitle', { n: chart.points.length + 1 })}</b>
                </p>
                <div className="seg">
                  <button type="button" className={!useMap ? 'on' : ''} onClick={() => setUseMap(false)}>
                    {t('uchart.byLatLon')}
                  </button>
                  <button type="button" className={useMap ? 'on' : ''} onClick={() => setUseMap(true)}>
                    {t('uchart.byMap')}
                  </button>
                </div>
                {useMap ? (
                  <MapPicker value={mapAt} here={here} onChange={setMapAt} />
                ) : (
                  <>
                    <div className="grid2">
                      <label>
                        {t('port.lat')}
                        <input value={latText} onChange={(e) => setLatText(e.target.value)} placeholder="35 10.5 N" inputMode="text" />
                      </label>
                      <label>
                        {t('port.lon')}
                        <input value={lonText} onChange={(e) => setLonText(e.target.value)} placeholder="139 35.2 E" inputMode="text" />
                      </label>
                    </div>
                    <p className="muted small">{t('uchart.latLonHint')}</p>
                  </>
                )}
                {pointAt && <p className="small">{formatPosition(pointAt)}</p>}
                <div className="row gap">
                  <button type="button" className="primary" disabled={!pointAt} onClick={addPoint}>
                    {t('uchart.savePoint')}
                  </button>
                  <button type="button" className="link" onClick={() => setAdding(null)}>
                    {t('common.cancel')}
                  </button>
                </div>
              </div>
            )}

            {chart.points.length > 0 && (
              <ul className="log-list cp-list">
                {chart.points.map((p, i) => (
                  <li key={p.id}>
                    <button type="button" className="link" onClick={() => pz.current?.centerOn(p.px, p.py)}>
                      {i + 1}. {formatPosition(p)}
                    </button>
                    <span className={`small ${errors[i] > WARN_ERROR_M ? 'error' : 'muted'}`}>{errors[i] !== undefined ? t('uchart.pointError', { m: Math.round(errors[i]) }) : ''}</span>
                    <button type="button" className="link danger" onClick={() => setChart({ ...chart, points: chart.points.filter((x) => x.id !== p.id) })}>
                      {t('common.delete')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className={`small ${tr ? (Math.max(...errors) > WARN_ERROR_M ? 'error' : 'ok') : 'muted'}`} role="status">
              {chart.points.length < MIN_POINTS
                ? t('uchart.needMore', { n: MIN_POINTS - chart.points.length })
                : !tr
                  ? t('uchart.inLine')
                  : Math.max(...errors) > WARN_ERROR_M
                    ? t('uchart.checkPoint', { n: worst + 1, m: Math.round(errors[worst]) })
                    : tr.expected !== null
                      ? t('uchart.fitExpected', { m: Math.max(1, Math.round(tr.expected)) })
                      : t('uchart.fitOk', { m: Math.max(1, Math.round(tr.rms)) })}
            </p>
            {tr && chart.points.length < RECOMMENDED_POINTS && <p className="muted small">{t('uchart.moreBetter', { r: RECOMMENDED_POINTS })}</p>}
            {tr && chart.points.length >= MIN_POINTS && pointsCoverage(chart, chart.points) < 0.35 && <p className="caution-text small">{t('uchart.spread')}</p>}
            {tr && <p className="muted small">{t(tr.kind === 'curved' ? 'uchart.curvedOn' : 'uchart.curvedOff', { n: CURVED_MIN_POINTS })}</p>}
          </>
        )}

        <button
          type="button"
          className="primary"
          disabled={!canSave}
          onClick={() => {
            if (!chart) return
            fresh.current = null
            onSave({ ...chart, name: name.trim() })
          }}
        >
          {t('common.save')}
        </button>
        {onDelete && (
          <button type="button" className="danger-btn" onClick={onDelete}>
            {t('common.delete')}
          </button>
        )}
        <p className="muted small">{t('uchart.copyright')}</p>
      </div>
    </div>
  )
}
