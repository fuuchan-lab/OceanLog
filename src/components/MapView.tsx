import L from 'leaflet'
// 地図を回す（航行モード中に、スマホの向きに合わせる）。leaflet-rotate は L（グローバル）を書き換える
import 'leaflet-rotate'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import type { LatLon } from '../geo.ts'
import type { Fix } from '../hooks/useGeolocation.ts'
import type { HomePort } from '../profile.ts'
import { isValidTileUrl, type Settings } from '../settings.ts'
import { BASE_LAYERS, GEBCO_WMS, SEAMARKS } from '../tiles.ts'
import { MARK_ICONS, type Mark, type TrackPoint } from '../types.ts'
import { splitSegments } from '../voyage.ts'
import type { Hazard, WaterLevel } from '../hazards.ts'
import type { MsilSettings } from '../msil.ts'
import { msilLayer } from './msilLayer.ts'

interface Props {
  settings: Settings
  fix: Fix | null
  follow: boolean
  /** 地図を指で動かしたら、現在地の追従をやめる */
  onUserMove: () => void
  livePoints: TrackPoint[]
  /** 一覧から選んで表示している航跡 */
  shownTrack: TrackPoint[] | null
  marks: Mark[]
  ports: HomePort[]
  /** この位置へ移動する（一覧で地点を選んだ時など）。値が変わるたびに動く */
  focus: (LatLon & { zoom?: number; key: number }) | null
  onMarkClick: (mark: Mark) => void
  /** 地図の中心が変わった時（地点の登録・海図の保存の範囲に使う） */
  onCenter: (center: LatLon, zoom: number) => void
  /** OpenSeaMap に登録された危険物（暗岩・洗岩・沈船など） */
  hazards: Hazard[]
  /** 海しるの項目（自分のキーで表示） */
  msil: MsilSettings
  onMsilError: () => void
  /** 地図を回す角度（度、時計回り）。0 なら北が上 */
  rotation: number
}

type RotatableMap = L.Map & { setBearing: (deg: number) => void; getBearing: () => number }

/** 自船の矢印の向き（画面の上からの角度）。地図を回している時は、その分を足す */
const shipCourse = (course: number | null, rotation: number) => (course === null ? null : Math.round((course + rotation + 360) % 360))

const shipIcon = (course: number | null) =>
  L.divIcon({
    className: 'ship-icon',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html:
      course === null
        ? '<svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="8" class="ship-body"/><circle cx="17" cy="17" r="3" fill="#fff"/></svg>'
        : `<svg viewBox="0 0 34 34" style="transform:rotate(${course}deg)"><path d="M17 3 25 29 17 24 9 29z" class="ship-body"/></svg>`,
  })

/** 海図の記号に近い絵（暗岩: ＋と点線の円、洗岩: ＋と4つの点、干出岩: ＊、沈船、障害物） */
function hazardSvg(kind: Hazard['kind'], level: WaterLevel): string {
  const cross = '<path d="M16 7v18M7 16h18"/>'
  if (kind === 'wreck') return '<path d="M5 18h22M10 18v-7M16 18v-9M22 18v-7"/><circle cx="16" cy="16" r="13" class="hz-danger"/>'
  if (kind === 'obstruction') return '<circle cx="16" cy="16" r="10" class="hz-danger"/><text x="16" y="19.5" text-anchor="middle">Ob</text>'
  if (level === 'submerged') return `${cross}<circle cx="16" cy="16" r="12" class="hz-danger"/>`
  if (level === 'awash') return `${cross}<circle cx="10" cy="10" r="1.8" class="hz-dot"/><circle cx="22" cy="10" r="1.8" class="hz-dot"/><circle cx="10" cy="22" r="1.8" class="hz-dot"/><circle cx="22" cy="22" r="1.8" class="hz-dot"/>`
  if (level === 'covers') return '<path d="M16 6v20M7.3 11l17.4 10M7.3 21l17.4-10"/>'
  return '<circle cx="16" cy="16" r="5" class="hz-dot"/>'
}

export const hazardIcon = (kind: Hazard['kind'], level: WaterLevel, mine = false) =>
  L.divIcon({
    className: `hazard-icon${mine ? ' hazard-mine' : ''}`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    html: `<svg viewBox="0 0 32 32">${hazardSvg(kind, level)}</svg>`,
  })

const markIcon = (emoji: string, cls = '') =>
  L.divIcon({ className: `mark-icon ${cls}`, iconSize: [30, 30], iconAnchor: [15, 28], html: `<span>${emoji}</span>` })

/** 航跡の表示: 点（1分おき）・区間の中は実線・記録がない区間は点線 */
function trackLayer(points: TrackPoint[], cls: string): L.LayerGroup {
  const group = L.layerGroup()
  const segments = splitSegments(points)
  segments.forEach((seg, i) => {
    group.addLayer(L.polyline(seg.map((p) => [p.lat, p.lon] as L.LatLngTuple), { className: cls, weight: 3 }))
    const next = segments[i + 1]
    if (next) {
      const a = seg[seg.length - 1]
      const b = next[0]
      group.addLayer(L.polyline([[a.lat, a.lon], [b.lat, b.lon]], { className: `${cls} track-gap`, weight: 2, dashArray: '4 6' }))
    }
  })
  for (const p of points) {
    group.addLayer(
      L.circleMarker([p.lat, p.lon], { radius: 3.5, className: `${cls}-dot`, weight: 1.5 }).bindTooltip(
        new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      ),
    )
  }
  return group
}

/** Leaflet の地図（海図）。React からは、表示する中身を渡すだけにする */
export function MapView({ settings, fix, follow, onUserMove, livePoints, shownTrack, marks, ports, focus, onMarkClick, onCenter, hazards, msil, onMsilError, rotation }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layers = useRef<{
    base?: L.TileLayer
    seamarks?: L.TileLayer
    custom?: L.TileLayer
    ship?: L.Marker
    accuracy?: L.Circle
    live?: L.LayerGroup
    shown?: L.LayerGroup
    marks?: L.LayerGroup
    ports?: L.LayerGroup
    hazards?: L.LayerGroup
    msil?: L.TileLayer[]
  }>({})
  const cb = useRef({ onUserMove, onMarkClick, onCenter, onMsilError })
  useEffect(() => {
    cb.current = { onUserMove, onMarkClick, onCenter, onMsilError }
  })

  // 地図を作る（1回だけ）
  useEffect(() => {
    if (!el.current || map.current) return
    const start = fix ?? ports[0] ?? { lat: 35.3, lon: 139.5 }
    // 回転は、アプリが setBearing で決める（指での回転・プラグインのボタンやコンパスは使わない）
    const options = { zoomControl: true, attributionControl: true, rotate: true, bearing: 0, rotateControl: false, touchRotate: false, shiftKeyRotate: false, compassBearing: false }
    const m = L.map(el.current, options as L.MapOptions).setView([start.lat, start.lon], fix ? 13 : 10)
    L.control.scale({ imperial: false, metric: true, position: 'bottomleft' }).addTo(m)
    m.on('dragstart', () => cb.current.onUserMove())
    const report = () => {
      const c = m.getCenter()
      cb.current.onCenter({ lat: c.lat, lon: c.lng }, m.getZoom())
    }
    m.on('moveend', report)
    report()
    map.current = m
    // 画面の切り替えで大きさが変わった時に、タイルを読み直す
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => m.invalidateSize()) : null
    ro?.observe(el.current)
    return () => {
      ro?.disconnect()
      m.remove()
      map.current = null
      layers.current = {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 地図の種類・海図記号・自分で用意したタイル
  useEffect(() => {
    const m = map.current
    if (!m) return
    const l = layers.current
    l.base?.remove()
    l.seamarks?.remove()
    l.custom?.remove()
    if (settings.baseLayer === 'gebco') {
      l.base = L.tileLayer.wms(GEBCO_WMS.url, { layers: GEBCO_WMS.layers, format: 'image/png', attribution: GEBCO_WMS.attribution, maxZoom: 18 })
    } else {
      const src = BASE_LAYERS[settings.baseLayer]
      l.base = L.tileLayer(src.url, { attribution: src.attribution, maxZoom: 18, maxNativeZoom: src.maxZoom })
    }
    l.base.addTo(m)
    if (isValidTileUrl(settings.customTileUrl)) {
      l.custom = L.tileLayer(settings.customTileUrl, { attribution: settings.customTileAttribution, maxZoom: 18, opacity: 0.9 }).addTo(m)
    }
    if (settings.seamarks) {
      l.seamarks = L.tileLayer(SEAMARKS.url, { attribution: SEAMARKS.attribution, maxZoom: 18 }).addTo(m)
    }
  }, [settings.baseLayer, settings.seamarks, settings.customTileUrl, settings.customTileAttribution])

  // 自船の位置
  useEffect(() => {
    const m = map.current
    if (!m || !fix) return
    const l = layers.current
    const ll: L.LatLngExpression = [fix.lat, fix.lon]
    if (!l.ship) {
      l.accuracy = L.circle(ll, { radius: fix.accuracy, className: 'accuracy-circle', interactive: false }).addTo(m)
      l.ship = L.marker(ll, { icon: shipIcon(shipCourse(fix.course, rotation)), zIndexOffset: 1000, interactive: false }).addTo(m)
    } else {
      l.ship.setLatLng(ll).setIcon(shipIcon(shipCourse(fix.course, rotation)))
      l.accuracy?.setLatLng(ll).setRadius(fix.accuracy)
    }
    if (follow) m.panTo(ll, { animate: true })
  }, [fix, follow, rotation])

  // 地図を回す（1° 未満の変化は無視して、描き直しを減らす）
  useEffect(() => {
    const m = map.current as RotatableMap | null
    if (!m?.setBearing) return
    const cur = m.getBearing()
    const diff = Math.abs(((rotation - cur + 540) % 360) - 180)
    if (diff >= 1) m.setBearing(rotation)
  }, [rotation])

  // 記録中の航跡: 1分おきの点と、それを結ぶ線（アプリを閉じていて記録がない区間は点線）
  useEffect(() => {
    const m = map.current
    if (!m) return
    const l = layers.current
    l.live?.remove()
    l.live = trackLayer(livePoints, 'track-live').addTo(m)
  }, [livePoints])

  // 一覧から選んだ航跡
  useEffect(() => {
    const m = map.current
    if (!m) return
    const l = layers.current
    l.shown?.remove()
    l.shown = undefined
    if (shownTrack && shownTrack.length > 0) {
      l.shown = trackLayer(shownTrack, 'track-shown').addTo(m)
      m.fitBounds(L.latLngBounds(shownTrack.map((p) => [p.lat, p.lon] as L.LatLngTuple)), { padding: [30, 30] })
      cb.current.onUserMove()
    }
  }, [shownTrack])

  // 記録した地点
  useEffect(() => {
    const m = map.current
    if (!m) return
    const l = layers.current
    l.marks?.remove()
    l.marks = L.layerGroup(
      marks.map((mk) =>
        L.marker([mk.lat, mk.lon], {
          icon:
            mk.kind === 'rockSubmerged' || mk.kind === 'rockAwash'
              ? hazardIcon('rock', mk.kind === 'rockSubmerged' ? 'submerged' : 'awash', true)
              : markIcon(MARK_ICONS[mk.kind]),
          title: mk.name,
        })
          .bindTooltip(mk.name, { direction: 'top', offset: [0, -24] })
          .on('click', () => cb.current.onMarkClick(mk)),
      ),
    ).addTo(m)
  }, [marks])

  // 海しるの項目（暗岩・洗岩・海底地形など。使う人が自分で利用登録したキーで取得する）
  const msilKey = msil.key
  const msilShown = msil.layers.filter((l) => msil.enabled.includes(l.id))
  const msilSig = msilShown.map((l) => l.url).join('|')
  useEffect(() => {
    const m = map.current
    if (!m) return
    const l = layers.current
    for (const layer of l.msil ?? []) layer.remove()
    l.msil = msilKey ? msilShown.map((x) => msilLayer(x.url, msilKey, () => cb.current.onMsilError()).addTo(m)) : []
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msilKey, msilSig])

  // OpenSeaMap の危険物（暗岩・洗岩・干出岩・沈船・障害物）
  useEffect(() => {
    const m = map.current
    if (!m) return
    const l = layers.current
    l.hazards?.remove()
    l.hazards = L.layerGroup(
      hazards.map((h) =>
        L.marker([h.lat, h.lon], { icon: hazardIcon(h.kind, h.level), zIndexOffset: -100 }).bindTooltip(
          [h.name, h.depth !== null ? `${h.depth}m` : ''].filter(Boolean).join(' ') || h.kind,
        ),
      ),
    ).addTo(m)
  }, [hazards])

  // 出航地
  useEffect(() => {
    const m = map.current
    if (!m) return
    const l = layers.current
    l.ports?.remove()
    l.ports = L.layerGroup(
      ports.map((p) =>
        L.marker([p.lat, p.lon], { icon: markIcon('🏠', 'port-icon'), title: p.name }).bindTooltip(p.name, {
          direction: 'top',
          offset: [0, -24],
        }),
      ),
    ).addTo(m)
  }, [ports])

  useEffect(() => {
    if (focus && map.current) map.current.setView([focus.lat, focus.lon], focus.zoom ?? Math.max(map.current.getZoom(), 14))
  }, [focus])

  return <div className="map" ref={el} />
}
