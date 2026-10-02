import { useEffect, useMemo, useRef } from 'react'
import { fitChart, insideChart, type UserChart } from '../chartGeo.ts'
import type { LatLon } from '../geo.ts'
import type { Fix } from '../hooks/useGeolocation.ts'
import { usePhotoUrl } from '../hooks/usePhotoUrl.ts'
import { useI18n } from '../i18n/useI18n.ts'
import type { HomePort } from '../profile.ts'
import type { Mark, TrackPoint } from '../types.ts'
import { PanZoomImage, type PanZoomHandle } from './PanZoomImage.tsx'

interface Props {
  chart: UserChart
  fix: Fix | null
  follow: boolean
  onUserMove: () => void
  livePoints: TrackPoint[]
  shownTrack: TrackPoint[] | null
  marks: Mark[]
  ports: HomePort[]
  focus: (LatLon & { zoom?: number; key: number }) | null
  onCenter: (center: LatLon) => void
}

/**
 * 自分で撮影・アップロードした海図の上に、自船の位置・向き・航跡・地点・出航地を表示する。
 * 位置は、登録した基準点から求めた変換（chartGeo.ts）で、緯度経度を海図の画素に直して描く
 */
export function UserChartView({ chart, fix, follow, onUserMove, livePoints, shownTrack, marks, ports, focus, onCenter }: Props) {
  const { t } = useI18n()
  const url = usePhotoUrl(chart.id)
  const tr = useMemo(() => fitChart(chart.points), [chart.points])
  const pz = useRef<PanZoomHandle>(null)

  const boat = fix && tr ? tr.toPixel(fix) : null
  const onChart = boat !== null && insideChart(chart, boat)

  // 海図の上で、北がどちらを向いているか（画像の上からの角度、時計回り）。写真が傾いていても自船の矢印を正しい向きに
  const ref = fix ?? (tr ? tr.toLatLon(chart.width / 2, chart.height / 2) : null)
  let north = 0
  let metersPerPixel = 1
  if (tr && ref) {
    const a = tr.toPixel(ref)
    const b = tr.toPixel({ lat: ref.lat + 0.01, lon: ref.lon })
    north = (Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI
    metersPerPixel = 1111.95 / Math.max(1e-9, Math.hypot(b.x - a.x, b.y - a.y))
  }

  // 現在地を追う
  useEffect(() => {
    if (follow && boat && onChart) pz.current?.centerOn(boat.x, boat.y)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, boat?.x, boat?.y, onChart])

  // 一覧で選んだ地点・出航地へ
  useEffect(() => {
    if (!focus || !tr) return
    const p = tr.toPixel(focus)
    pz.current?.centerOn(p.x, p.y)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus])

  const line = (pts: TrackPoint[]) =>
    tr
      ? pts
          .map((p) => tr.toPixel(p))
          .map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`)
          .join(' ')
      : ''

  if (!tr) return <p className="muted user-chart-msg">{t('uchart.notReady')}</p>
  if (!url) return <p className="muted user-chart-msg">{t('common.loading')}</p>

  return (
    <PanZoomImage
      handle={pz}
      src={url}
      width={chart.width}
      height={chart.height}
      className="user-chart"
      onUserMove={() => {
        onUserMove()
        const c = pz.current?.center()
        if (c) onCenter(tr.toLatLon(c.x, c.y))
      }}
      overlay={(scale) => {
        const k = 1 / scale
        return (
          <>
            {shownTrack && shownTrack.length > 1 && <polyline points={line(shownTrack)} className="uchart-track uchart-shown" strokeWidth={3 * k} />}
            {livePoints.length > 1 && <polyline points={line(livePoints)} className="uchart-track" strokeWidth={3 * k} />}
            {marks.map((m) => {
              const p = tr.toPixel(m)
              return <circle key={m.id} cx={p.x} cy={p.y} r={6 * k} strokeWidth={2 * k} className="uchart-mark" />
            })}
            {ports.map((pt) => {
              const p = tr.toPixel(pt)
              return (
                <text key={pt.id} x={p.x} y={p.y} fontSize={22 * k} textAnchor="middle" dominantBaseline="central">
                  🏠
                </text>
              )
            })}
            {boat && (
              <g transform={`translate(${boat.x} ${boat.y})`}>
                {fix && fix.accuracy > 0 && <circle r={fix.accuracy / metersPerPixel} className="uchart-accuracy" strokeWidth={1.5 * k} />}
                <g transform={`scale(${k})`}>
                  {fix?.course !== null && fix?.course !== undefined ? (
                    <path d="M0 -16 9 12 0 7 -9 12z" transform={`rotate(${north + fix.course})`} className="uchart-boat" />
                  ) : (
                    <circle r={9} className="uchart-boat" />
                  )}
                </g>
              </g>
            )}
          </>
        )
      }}
    >
      <div className="uchart-zoom">
        <button type="button" className="fab" onClick={() => pz.current?.zoomBy(1.5)} aria-label={t('uchart.zoomIn')}>
          ＋
        </button>
        <button type="button" className="fab" onClick={() => pz.current?.zoomBy(1 / 1.5)} aria-label={t('uchart.zoomOut')}>
          −
        </button>
      </div>
      {fix && !onChart && <p className="uchart-outside">{t('uchart.outside')}</p>}
    </PanZoomImage>
  )
}
